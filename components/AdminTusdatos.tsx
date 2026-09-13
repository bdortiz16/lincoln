import React, { useEffect, useState } from 'react';
import { ShieldCheck, Plug, AlertTriangle } from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// AdminTusdatos — la consulta de antecedentes, hecha por nosotros.
//
// Lincoin consulta TusDatos directamente y de ahí sale la categoría: bajo,
// medio o alto. Antes el veredicto se le pedía a Kumplo y Kumplo consultaba;
// ese camino nunca devolvió nada y desde acá no había forma de saber de qué
// lado estaba el problema. Ahora el resultado es nuestro —lo vemos, lo
// guardamos y respondemos por él— y a Kumplo se le ENVÍA para que su
// expediente quede completo.
//
// Las credenciales viven en la Bóveda. Acá solo se ve si están puestas.
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
// Distingue "el servidor dijo que no" de "el servidor no está". Las dos cosas
// se veían igual y la causa real —la función sin desplegar— quedaba invisible.
const call = async (body: any) => {
  const r = await fetch(`${SURL}/functions/v1/tusdatos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tokenOf() ?? SKEY}` },
    body: JSON.stringify(body),
  });
  const texto = await r.text().catch(() => '');
  try { return JSON.parse(texto); } catch { /* no-JSON */ }
  if (r.status === 404) return { error: 'El servicio de antecedentes todavía no está publicado. Espera a que termine el despliegue y recarga.' };
  return { error: `El servidor respondió ${r.status}${texto ? `: ${texto.slice(0, 160)}` : ''}` };
};

const Campo: React.FC<{ etiqueta: string; ayuda?: string; children: React.ReactNode }> = ({ etiqueta, ayuda, children }) => (
  <div style={{ marginBottom: 12 }}>
    <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.sub, margin: '0 0 5px' }}>{etiqueta.toUpperCase()}</p>
    {children}
    {ayuda && <p style={{ fontSize: 11, color: C.dim, margin: '4px 0 0', lineHeight: 1.5 }}>{ayuda}</p>}
  </div>
);

const inputStyle: React.CSSProperties = {
  width: '100%', background: C.elev, border: `1px solid ${C.border}`, color: C.text,
  borderRadius: 9, padding: '9px 12px', fontSize: 12.5, outline: 'none', fontFamily: MONO,
};

export const AdminTusdatos: React.FC = () => {
  const [cfg, setCfg] = useState<any>(null);
  const [credencial, setCredencial] = useState<string>('');
  const [webhook, setWebhook] = useState<string>('');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [diag, setDiag] = useState<any>(null);

  const cargar = async () => {
    const d = await call({ action: 'config_get' }).catch(() => null);
    if (d?.ok) { setCfg(d.config); setCredencial(d.credencial); setWebhook(d.webhook); }
    else setMsg({ ok: false, texto: d?.error ?? 'No se pudo leer la configuración.' });
  };
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const guardar = async (next: any) => {
    setBusy(true); setMsg(null);
    const d = await call({ action: 'config_set', config: next }).catch(() => null);
    if (d?.ok) { setCfg(d.config); setCredencial(d.credencial); setMsg({ ok: true, texto: 'Guardado.' }); }
    else setMsg({ ok: false, texto: d?.error ?? 'No se pudo guardar.' });
    setBusy(false);
  };

  const probar = async () => {
    setBusy(true); setMsg(null); setDiag(null);
    const d = await call({ action: 'probar' }).catch(() => null);
    setMsg({ ok: !!d?.ok, texto: d?.motivo ?? d?.error ?? 'Sin respuesta.' });
    setBusy(false);
  };

  const diagnosticar = async () => {
    setBusy(true); setMsg(null); setDiag(null);
    setDiag(await call({ action: 'diagnostico' }).catch(() => null) ?? { ok: false });
    setBusy(false);
  };

  if (!cfg) {
    return (
      <div style={{ fontFamily: FONT, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18, color: C.sub, fontSize: 13 }}>
        {msg?.texto ?? 'Cargando la configuración de antecedentes…'}
      </div>
    );
  }

  const listo = !!cfg.baseUrl && credencial === 'configurada';
  const esPruebas = String(cfg.baseUrl ?? '').includes('docs.tusdatos');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16, margin: 0 }}>
              <ShieldCheck size={17} color={cfg.activo ? C.green : C.sub} /> Antecedentes
            </p>
            <p style={{ color: C.sub, fontSize: 12, margin: '4px 0 0', maxWidth: 620, lineHeight: 1.55 }}>
              Al inscribir a un beneficiario, Lincoin consulta sus antecedentes contra las fuentes
              oficiales y devuelve la categoría: <b style={{ color: C.green }}>bajo</b>,
              <b style={{ color: C.amber }}> medio</b> o <b style={{ color: C.red }}>alto</b>. Con riesgo alto
              no se puede transferir. El resultado y el PDF se le envían a Kumplo para su expediente.
            </p>
          </div>
          <button
            onClick={() => guardar({ ...cfg, activo: !cfg.activo })}
            disabled={busy || (!cfg.activo && !listo)}
            title={!cfg.activo && !listo ? 'Faltan la dirección base o las credenciales' : ''}
            style={{
              background: cfg.activo ? 'rgba(74,222,128,0.14)' : 'transparent',
              border: `1px solid ${cfg.activo ? C.green : C.border2}`,
              color: cfg.activo ? C.green : C.sub,
              borderRadius: 999, padding: '8px 16px', fontSize: 12.5, fontWeight: 800,
              cursor: busy || (!cfg.activo && !listo) ? 'not-allowed' : 'pointer',
              opacity: !cfg.activo && !listo ? 0.5 : 1, whiteSpace: 'nowrap', fontFamily: FONT,
            }}>
            {cfg.activo ? '● Encendida' : '○ Apagada'}
          </button>
        </div>

        {!listo && (
          <div style={{ marginTop: 13, background: C.elev, border: '1px solid rgba(251,191,36,0.3)', borderRadius: 12, padding: '11px 13px', color: C.amber, fontSize: 12.5, display: 'flex', gap: 8, lineHeight: 1.5 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Falta {[!cfg.baseUrl && 'la dirección base', credencial !== 'configurada' && 'la credencial en la Bóveda'].filter(Boolean).join(' y ')}.
              Sin eso no se puede encender — encender algo que no puede responder solo produce clientes bloqueados sin motivo.
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
          <span style={{
            border: `1px solid ${credencial === 'configurada' ? 'rgba(74,222,128,0.3)' : C.border}`,
            color: credencial === 'configurada' ? C.green : C.sub,
            borderRadius: 999, padding: '6px 12px', fontSize: 11.5, fontWeight: 700,
          }}>
            🔒 BÓVEDA · {credencial === 'configurada' ? 'credenciales puestas' : 'sin credenciales'}
          </span>
          <span style={{
            border: `1px solid ${webhook === 'configurado' ? 'rgba(74,222,128,0.3)' : C.border}`,
            color: webhook === 'configurado' ? C.green : C.sub,
            borderRadius: 999, padding: '6px 12px', fontSize: 11.5, fontWeight: 700,
          }}>
            🔒 AVISOS · {webhook === 'configurado' ? 'firmados' : 'sin secreto'}
          </span>
          <button onClick={probar} disabled={busy}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${C.border2}`, color: C.text, borderRadius: 999, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, opacity: busy ? 0.55 : 1 }}>
            <Plug size={13} /> Probar la conexión
          </button>
          <button onClick={diagnosticar} disabled={busy}
            style={{ background: 'transparent', border: `1px solid ${C.border2}`, color: C.text, borderRadius: 999, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, opacity: busy ? 0.55 : 1 }}>
            Diagnosticar
          </button>
        </div>

        {esPruebas && (
          <p style={{ marginTop: 12, fontSize: 12, color: C.amber, lineHeight: 1.55 }}>
            Estás en el <b>ambiente de pruebas</b>: las respuestas son fijas y no gastan créditos, pero
            tampoco consultan a nadie de verdad. Para operar hay que cambiar la dirección base a producción.
          </p>
        )}

        {msg && <p style={{ marginTop: 12, fontSize: 12.5, color: msg.ok ? C.green : C.red, lineHeight: 1.5 }}>{msg.texto}</p>}

        {diag && (
          <div style={{ marginTop: 14, background: C.elev, border: `1px solid ${diag.corte ? 'rgba(251,191,36,0.3)' : 'rgba(74,222,128,0.24)'}`, borderRadius: 12, padding: '13px 15px' }}>
            <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.sub, margin: 0 }}>DIAGNÓSTICO</p>
            {(diag.pasos ?? []).map((p: any) => (
              <div key={p.paso} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
                <span style={{ color: p.ok ? C.green : C.amber, fontSize: 12, fontWeight: 800, lineHeight: 1.5 }}>{p.ok ? '✓' : '×'}</span>
                <div>
                  <p style={{ fontSize: 12.5, fontWeight: 700, color: C.text, margin: 0 }}>{p.paso}</p>
                  <p style={{ fontSize: 11.5, color: C.dim, margin: '2px 0 0', lineHeight: 1.5 }}>{p.detalle}</p>
                </div>
              </div>
            ))}
            {diag.corte && (
              <p style={{ fontSize: 12.5, color: C.amber, margin: '11px 0 0', lineHeight: 1.55 }}>
                La cadena se corta acá: <b>{diag.corte}</b>
              </p>
            )}
            {diag.plan && (
              <p style={{ fontSize: 11, color: C.dim, margin: '10px 0 0', fontFamily: MONO, wordBreak: 'break-all' }}>
                Plan · HTTP {diag.plan.status} · {diag.plan.respuesta}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Qué bloquea, y qué se hace con el resultado */}
      <div style={{ fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18 }}>
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.sub, margin: 0 }}>QUÉ HACE CON EL RESULTADO</p>

        <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={cfg.bloquear !== false} onChange={e => guardar({ ...cfg, bloquear: e.target.checked })} style={{ marginTop: 3 }} />
          <span>
            <b style={{ fontSize: 13 }}>Impedir la transferencia con veredicto negativo</b>
            <p style={{ fontSize: 11.5, color: C.dim, margin: '3px 0 0', lineHeight: 1.5 }}>
              Sin esto, la categoría se muestra pero no frena nada — sirve para observar antes de aplicar.
            </p>
          </span>
        </label>

        <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!cfg.soloBloquearAlto} onChange={e => guardar({ ...cfg, soloBloquearAlto: e.target.checked })} style={{ marginTop: 3 }} />
          <span>
            <b style={{ fontSize: 13 }}>Bloquear solo el riesgo ALTO</b>
            <p style={{ fontSize: 11.5, color: C.dim, margin: '3px 0 0', lineHeight: 1.5 }}>
              Sin marcar, el riesgo <b>medio</b> también queda en revisión y no transfiere. Si se deja así,
              hace falta definir quién aprueba una cuenta en revisión y en cuánto tiempo — si no, alguien
              con un antecedente menor queda esperando sin que nadie lo esté mirando.
            </p>
          </span>
        </label>

        <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!cfg.enviarAKumplo} onChange={e => guardar({ ...cfg, enviarAKumplo: e.target.checked })} style={{ marginTop: 3 }} />
          <span>
            <b style={{ fontSize: 13 }}>Enviarle el resultado y el PDF a Kumplo</b>
            <p style={{ fontSize: 11.5, color: C.dim, margin: '3px 0 0', lineHeight: 1.5 }}>
              Apenas termina la consulta se le manda a Kumplo la categoría, los hallazgos y el enlace al
              reporte, bajo la empresa que el titular tenga conectada. Requiere que Kumplo confirme la
              ruta que recibe resultados externos.
            </p>
          </span>
        </label>
      </div>

      {/* Ajustes técnicos, plegados: ya vienen con lo que hace falta. */}
      <details style={{ fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, color: C.sub }}>Ajustes técnicos</summary>
        <div style={{ marginTop: 14 }}>
          <Campo etiqueta="Dirección base" ayuda="Producción: https://dash-board.tusdatos.co · Pruebas: http://docs.tusdatos.co (respuestas fijas, no gasta créditos).">
            <input value={cfg.baseUrl ?? ''} onChange={e => setCfg({ ...cfg, baseUrl: e.target.value })} onBlur={() => guardar(cfg)} style={inputStyle} />
          </Campo>
          <Campo etiqueta="Cuentas en la prueba" ayuda="Ids separados por coma. Vacío = todas. Mientras esto sea una prueba conviene empezar con una o dos.">
            <input value={(cfg.soloEstosUsuarios ?? []).join(', ')}
              onChange={e => setCfg({ ...cfg, soloEstosUsuarios: e.target.value.split(',').map((x: string) => x.trim()).filter(Boolean) })}
              onBlur={() => guardar(cfg)} style={inputStyle} placeholder="vacío = todas" />
          </Campo>
          <Campo etiqueta="Ruta de Kumplo para el resultado" ayuda="Dónde recibe Kumplo una consulta hecha por fuera. Hay que pedírsela a ellos.">
            <input value={cfg.kumploRutaResultado ?? ''} onChange={e => setCfg({ ...cfg, kumploRutaResultado: e.target.value })} onBlur={() => guardar(cfg)} style={inputStyle} />
          </Campo>
          <p style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.6, marginTop: 4 }}>
            Las credenciales de TusDatos y el secreto de los avisos viven en la <b style={{ color: C.sub }}>Bóveda</b> 🔒.
            Nunca se guardan en la base ni se muestran acá — este panel solo sabe si están puestas.
          </p>
        </div>
      </details>
    </div>
  );
};
