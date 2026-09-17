import React, { useEffect, useState } from 'react';
import { Database, RefreshCw, Search, ChevronDown } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';

// ─────────────────────────────────────────────────────────────
// Lincoin Risk — el padrón de consultas de antecedentes.
//
// Cada consulta a TusDatos cuesta 1.400 COP. El veredicto se guardaba dentro
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

  const cargar = async (buscar = q) => {
    setBusy(true);
    const r = await llamarFuncion('tusdatos', { action: 'risk', q: buscar }).catch(() => null);
    setD(r ?? { error: 'Sin respuesta.' });
    setBusy(false);
  };
  useEffect(() => { cargar(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!d) {
    return <div style={{ fontFamily: FONT, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18, color: C.sub, fontSize: 13 }}>Cargando el padrón…</div>;
  }
  if (d.error) {
    return (
      <div style={{ fontFamily: FONT, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18, color: C.sub, fontSize: 13, lineHeight: 1.6 }}>
        {d.error}
        {/* El mensaje "no se encuentra la tabla" tiene DOS causas distintas y
            antes las juntaba en una sola pista, que mandaba a correr otra vez
            una migración ya corrida. Si la tabla no tiene ningún permiso —ni
            siquiera para el servidor— queda fuera de la caché de esquema y la
            respuesta dice que no existe, aunque exista. */}
        <p style={{ marginTop: 8, color: C.dim, fontSize: 12 }}>
          Si dice que no encuentra la tabla, puede ser que falte correr la migración
          del padrón — o que la tabla exista pero sin permiso para el servidor, que
          se lee igual. Comprobalo antes de volver a correr nada.
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
              a TusDatos se mira acá: si otra empresa ya consultó a esa persona y el dato sigue vigente,
              se reutiliza. Se busca <b style={{ color: C.text }}>por documento</b>, nunca por nombre.
            </p>
          </div>
          <button onClick={() => cargar()} disabled={busy}
            className="hover:opacity-90 transition-opacity"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: '#0A0A0A', background: C.text, border: 'none', padding: '8px 13px', borderRadius: 9, opacity: busy ? 0.6 : 1, flexShrink: 0 }}>
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Actualizar
          </button>
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
          { n: cop(r.ahorroCop ?? 0), t: `${num(r.consultasAhorradas ?? 0)} consultas que no se pagaron`, ok: true },
          { n: num(r.personas ?? 0), t: 'Personas en el padrón' },
          { n: cop(r.gastoCop ?? 0), t: `${num(r.consultasPagadas ?? 0)} consultas pagadas` },
          { n: num(r.alto ?? 0), t: 'De riesgo alto' },
          { n: num(r.limpios ?? 0), t: 'Sin hallazgos o riesgo bajo', ok: true },
        ].map(s => (
          <div key={s.t} style={{ background: C.card, border: `1px solid ${s.ok ? 'rgba(74,222,128,0.25)' : C.border}`, borderRadius: 12, padding: '13px 15px' }}>
            <p style={{ fontSize: s.n.length > 12 ? 17 : 21, fontWeight: 800, color: s.ok ? C.green : C.text, margin: 0, lineHeight: 1.15 }}>{s.n}</p>
            <p style={{ fontSize: 11.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.35 }}>{s.t}</p>
          </div>
        ))}
      </div>

      {/* Buscador por documento */}
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: C.sub }} />
        <input value={q}
          onChange={e => setQ(e.target.value.replace(/\D/g, ''))}
          onKeyDown={e => { if (e.key === 'Enter') cargar(); }}
          inputMode="numeric"
          placeholder="Buscar por número de documento y Enter…"
          style={{ width: '100%', height: 38, paddingLeft: 34, paddingRight: 12, borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, outline: 'none', fontFamily: FONT }} />
      </div>

      {/* El padrón */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
        {personas.length === 0 && (
          <p style={{ padding: 20, fontSize: 12.5, color: C.sub, margin: 0, lineHeight: 1.6 }}>
            {q
              ? 'Ese documento no está en el padrón. La próxima vez que alguien lo inscriba se consultará y quedará acá.'
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
                        ['Créditos gastados', `${p.vecesConsultado ?? 1} · ${cop((p.vecesConsultado ?? 1) * 1400)}`],
                        ['Créditos ahorrados', `${p.vecesReutilizado ?? 0} · ${cop((p.vecesReutilizado ?? 0) * 1400)}`],
                      ].map(([l, v]) => (
                        <div key={String(l)}>
                          <p style={{ fontSize: 10.5, color: C.sub, margin: 0 }}>{l}</p>
                          <p style={{ fontSize: 12.5, color: C.text, fontWeight: 600, margin: '2px 0 0' }}>{v}</p>
                        </div>
                      ))}
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
    </div>
  );
};
