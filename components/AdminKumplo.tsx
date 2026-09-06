import React, { useEffect, useState } from 'react';
import { Link2, ShieldCheck, AlertTriangle, RefreshCw, Plug } from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// AdminKumplo — la conexión con Kumplo (expediente + AML).
//
// Kumplo lleva el expediente de cada persona y responde la consulta AML.
// Lincoin le pregunta al inscribir a alguien y, si el riesgo sale ALTO,
// deja de permitirle transferir.
//
// Todo lo que depende de Kumplo se configura acá y no está escrito en el
// código: la dirección, las rutas, cómo viaja la credencial y en qué campo
// viene el riesgo. El día que Kumplo entregue su documentación se llenan
// estos campos y funciona.
//
// La credencial vive en la Bóveda. Acá solo se ve si está puesta.
// ─────────────────────────────────────────────────────────────

const C = {
  card: '#0C0E0D', elev: '#121413',
  border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)',
  green: '#4ADE80', amber: '#FBBF24', red: '#F87171',
};
const FONT = 'Archivo, system-ui, sans-serif';

const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
const tokenOf = () => {
  try {
    const k = Object.keys(localStorage).find(x => x.startsWith('sb-') && x.endsWith('-auth-token'));
    if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) return d.access_token as string; }
  } catch { /* */ }
  return null;
};
// Distingue "el servidor dijo que no" de "el servidor no está". Antes las dos
// cosas se veían igual —"No se pudo leer la configuración"— y la causa real
// (la función sin desplegar) quedaba invisible.
const call = async (body: any) => {
  const r = await fetch(`${SURL}/functions/v1/kumplo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tokenOf() ?? SKEY}` },
    body: JSON.stringify(body),
  });
  const texto = await r.text().catch(() => '');
  try { return JSON.parse(texto); } catch { /* respuesta no-JSON */ }
  if (r.status === 404) return { error: 'El servicio de Kumplo todavía no está publicado. Espera a que termine el despliegue y recarga.' };
  return { error: `El servidor respondió ${r.status}${texto ? `: ${texto.slice(0, 160)}` : ''}` };
};

const COLOR_RIESGO: Record<string, string> = {
  bajo: C.green, medio: C.amber, alto: C.red, desconocido: C.sub,
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
  borderRadius: 9, padding: '9px 12px', fontSize: 12.5, outline: 'none',
  fontFamily: 'ui-monospace, Menlo, monospace',
};

export const AdminKumplo: React.FC = () => {
  const [cfg, setCfg] = useState<any>(null);
  const [credencial, setCredencial] = useState<string>('');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filas, setFilas] = useState<any[] | null>(null);

  const cargar = async () => {
    const d = await call({ action: 'config_get' }).catch(() => null);
    if (d?.ok) { setCfg(d.config); setCredencial(d.credencial); }
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
    setBusy(true); setMsg(null);
    const d = await call({ action: 'probar' }).catch(() => null);
    setMsg({ ok: !!d?.ok, texto: d?.motivo ?? 'Sin respuesta.' });
    setBusy(false);
  };

  const verListado = async () => {
    setBusy(true);
    const d = await call({ action: 'listado' }).catch(() => null);
    setFilas(d?.ok ? d.filas : []);
    setBusy(false);
  };

  if (!cfg) {
    return (
      <div style={{ fontFamily: FONT, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18, color: C.sub, fontSize: 13 }}>
        {msg?.texto ?? 'Cargando la configuración de Kumplo…'}
      </div>
    );
  }

  const listo = !!cfg.baseUrl && !!cfg.rutaCrear && !!cfg.rutaAml && !!cfg.empresaId && credencial === 'configurada';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Encendido */}
      <div style={{ fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16, margin: 0 }}>
              <Link2 size={17} color={cfg.activo ? C.green : C.sub} /> Kumplo
            </p>
            <p style={{ color: C.sub, fontSize: 12, margin: '4px 0 0', maxWidth: 600, lineHeight: 1.55 }}>
              Al inscribirse alguien en Lincoin —persona o empresa— se manda a Kumplo su nombre y
              su documento, y queda <b style={{ color: C.sub }}>en verificación</b>. Kumplo lo consulta
              contra TusDatos y devuelve el veredicto: verificada, en revisión, o
              <b style={{ color: C.red }}> bloqueada</b>. Con el veredicto negativo, Lincoin no la deja
              transferir. El usuario no configura nada.
            </p>
          </div>
          <button
            onClick={() => guardar({ ...cfg, activo: !cfg.activo })}
            disabled={busy || (!cfg.activo && !listo)}
            title={!cfg.activo && !listo ? 'Faltan datos para poder encenderla' : ''}
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
              Falta {[
                !cfg.baseUrl && 'la dirección base',
                !cfg.rutaCrear && 'la ruta de alta',
                !cfg.rutaAml && 'la ruta de consulta AML',
                !cfg.empresaId && 'el id de la empresa en Kumplo',
                credencial !== 'configurada' && 'la credencial en la Bóveda',
              ].filter(Boolean).join(', ')}. Sin eso no se puede encender —
              encender algo que no puede responder solo produce clientes bloqueados sin motivo.
            </span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 13, flexWrap: 'wrap' }}>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 6, background: C.elev,
            border: `1px solid ${credencial === 'configurada' ? 'rgba(74,222,128,0.3)' : C.border}`,
            color: credencial === 'configurada' ? C.green : C.sub,
            borderRadius: 999, padding: '6px 12px', fontSize: 11.5, fontWeight: 700,
          }}>
            🔒 BÓVEDA · {credencial === 'configurada' ? 'credencial puesta' : 'sin credencial'}
          </span>
          <button onClick={probar} disabled={busy || !cfg.baseUrl}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${C.border2}`, color: C.text, borderRadius: 999, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, opacity: busy || !cfg.baseUrl ? 0.55 : 1 }}>
            <Plug size={13} /> Probar la conexión
          </button>
        </div>

        {/* El id de la empresa NO se pone acá. Cada negocio tiene su propia
            cuenta en Kumplo, así que lo conecta el titular desde su
            Configuración → Kumplo. Lo que se arma en este panel es la
            infraestructura, que es una sola para todos. */}
        <div style={{ marginTop: 15, background: C.elev, border: `1px solid ${C.border}`, borderRadius: 12, padding: '13px 15px' }}>
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.sub, margin: 0 }}>CÓMO SE CONECTA CADA CUENTA</p>
          <p style={{ fontSize: 12.5, color: C.dim, margin: '6px 0 0', lineHeight: 1.6 }}>
            Cada negocio tiene su propia cuenta en Kumplo, con su código <b style={{ color: C.sub }}>EMP-…</b>.
            Lo pega <b style={{ color: C.sub }}>el titular</b> en su <b style={{ color: C.sub }}>Configuración → Kumplo</b>,
            no se configura desde acá. Apenas lo conecta, Lincoin le manda a Kumplo su nombre y su
            documento, la cuenta queda en verificación y vuelve el veredicto.
          </p>
          <p style={{ fontSize: 12.5, color: C.dim, margin: '9px 0 0', lineHeight: 1.6 }}>
            Lo de este panel es la infraestructura: la credencial y las rutas. Una sola para todos —
            por eso Kumplo pide el id de la empresa en cada llamada.
          </p>
        </div>

        {msg && (
          <p style={{ marginTop: 12, fontSize: 12.5, color: msg.ok ? C.green : C.red, lineHeight: 1.5, wordBreak: 'break-word' }}>{msg.texto}</p>
        )}
      </div>

      {/* Ajustes técnicos: PLEGADOS. Ya vienen con los valores que entregó
          Kumplo; solo se abren el día que ellos cambien algo. Tenerlos
          desplegados hacía parecer que había que llenar diez cosas cuando
          en realidad falta una. */}
      <details style={{ fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16 }}>
        <summary style={{ cursor: 'pointer', listStyle: 'none', padding: '15px 18px', fontWeight: 800, fontSize: 14.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span>Ajustes técnicos</span>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: C.dim }}>ya configurados · ábrelos solo si Kumplo cambia algo</span>
        </summary>
        <div style={{ padding: '0 18px 18px' }}>

        <Campo etiqueta="Dirección base" ayuda="La raíz de su API. Ejemplo: https://api.usekumplo.com/v1">
          <input style={inputStyle} value={cfg.baseUrl} onChange={e => setCfg({ ...cfg, baseUrl: e.target.value.trim() })} placeholder="https://api.usekumplo.com/v1" />
        </Campo>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          <Campo etiqueta="Cabecera de la credencial" ayuda="Cómo esperan la llave.">
            <input style={inputStyle} value={cfg.authHeader} onChange={e => setCfg({ ...cfg, authHeader: e.target.value.trim() })} placeholder="Authorization" />
          </Campo>
          <Campo etiqueta="Prefijo" ayuda="Lo que va antes de la llave. Puede ir vacío.">
            <input style={inputStyle} value={cfg.authPrefix} onChange={e => setCfg({ ...cfg, authPrefix: e.target.value })} placeholder="Bearer " />
          </Campo>

        </div>

        <Campo etiqueta="Ruta para dar de alta a una persona" ayuda="POST. Ejemplo: /usuarios">
          <input style={inputStyle} value={cfg.rutaCrear} onChange={e => setCfg({ ...cfg, rutaCrear: e.target.value.trim() })} placeholder="/usuarios" />
        </Campo>
        <Campo etiqueta="Ruta de la consulta AML" ayuda="POST. Kumplo la consulta por documento, no por id.">
          <input style={inputStyle} value={cfg.rutaAml} onChange={e => setCfg({ ...cfg, rutaAml: e.target.value.trim() })} placeholder="/usuarios/{id}/aml" />
        </Campo>
        <Campo etiqueta="Ruta para releer el estado (opcional)" ayuda="GET. Acepta los marcadores {documento} y {empresa}, por si los piden en la URL.">
          <input style={inputStyle} value={cfg.rutaEstado} onChange={e => setCfg({ ...cfg, rutaEstado: e.target.value.trim() })} placeholder="/usuarios/{id}" />
        </Campo>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          <Campo etiqueta="Campo del id en la respuesta" ayuda="Ruta dentro del JSON. Ejemplo: data.id">
            <input style={inputStyle} value={cfg.campoId} onChange={e => setCfg({ ...cfg, campoId: e.target.value.trim() })} placeholder="data.id" />
          </Campo>
          <Campo etiqueta="Campo del riesgo" ayuda="Kumplo: data.riesgo (bajo | medio | alto | desconocido).">
            <input style={inputStyle} value={cfg.campoRiesgo} onChange={e => setCfg({ ...cfg, campoRiesgo: e.target.value.trim() })} placeholder="data.riesgo" />
          </Campo>
          <Campo etiqueta="Campo del veredicto" ayuda="Kumplo: data.operable. Es el que manda sobre el nivel de riesgo.">
            <input style={inputStyle} value={cfg.campoOperable ?? ''} onChange={e => setCfg({ ...cfg, campoOperable: e.target.value.trim() })} placeholder="data.operable" />
          </Campo>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          <Campo etiqueta="Valores que significan ALTO" ayuda="Separados por coma.">
            <input style={inputStyle} value={(cfg.valoresAlto ?? []).join(', ')}
              onChange={e => setCfg({ ...cfg, valoresAlto: e.target.value.split(',').map((x: string) => x.trim()).filter(Boolean) })} />
          </Campo>
          <Campo etiqueta="Valores que significan MEDIO" ayuda="Separados por coma.">
            <input style={inputStyle} value={(cfg.valoresMedio ?? []).join(', ')}
              onChange={e => setCfg({ ...cfg, valoresMedio: e.target.value.split(',').map((x: string) => x.trim()).filter(Boolean) })} />
          </Campo>
        </div>

        <Campo etiqueta="Cuentas en la prueba" ayuda="Ids de Lincoin separados por coma. Vacío = todas. Mientras esto sea una prueba, conviene empezar con una o dos.">
          <input style={inputStyle} value={(cfg.soloEstosUsuarios ?? []).join(', ')}
            onChange={e => setCfg({ ...cfg, soloEstosUsuarios: e.target.value.split(',').map((x: string) => x.trim()).filter(Boolean) })}
            placeholder="(vacío = todas las cuentas)" />
        </Campo>

        <label style={{ display: 'flex', alignItems: 'center', gap: 9, color: C.text, fontSize: 12.5, margin: '4px 0 9px', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!cfg.bloquearEnAlto} onChange={e => setCfg({ ...cfg, bloquearEnAlto: e.target.checked })} />
          Aplicar el veredicto de Kumplo a las transferencias
        </label>

        {/* Decisión de negocio, no técnica: Kumplo marca 'medio' como NO
            operable (queda en revisión del Oficial). Dejar operar a quien está
            en revisión es una postura legítima, pero tiene que ser una
            elección consciente y no un descuido. */}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, color: C.text, fontSize: 12.5, margin: '0 0 6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!cfg.soloBloquearAlto} onChange={e => setCfg({ ...cfg, soloBloquearAlto: e.target.checked })} style={{ marginTop: 2 }} />
          <span>
            Bloquear <b>solo</b> el riesgo alto
            <span style={{ display: 'block', color: C.dim, fontSize: 11, marginTop: 2, lineHeight: 1.5 }}>
              Kumplo marca el riesgo <b>medio</b> como «en revisión» y tampoco lo deja operar, igual que un
              documento que no pudo validar. Con esta casilla marcada, esos dos casos sí operan y solo se
              bloquea el riesgo alto.
            </span>
          </span>
        </label>

        <div style={{ marginBottom: 14 }} />

        <button onClick={() => guardar(cfg)} disabled={busy}
          style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.32)', color: C.green, borderRadius: 10, padding: '10px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
        </div>
      </details>

      {/* Personas ya evaluadas */}
      <div style={{ fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 15, margin: 0 }}>
            <ShieldCheck size={16} color={C.sub} /> Personas evaluadas
          </p>
          <button onClick={verListado} disabled={busy}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${C.border2}`, color: C.text, borderRadius: 999, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
            <RefreshCw size={12} /> Actualizar
          </button>
        </div>

        {filas === null ? (
          <p style={{ color: C.dim, fontSize: 12, margin: '12px 0 0' }}>Toca «Actualizar» para ver quiénes ya tienen resultado.</p>
        ) : filas.length === 0 ? (
          <p style={{ color: C.dim, fontSize: 12, margin: '12px 0 0' }}>Todavía no hay ninguna persona evaluada en Kumplo.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            {filas.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: C.elev, border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 12px', flexWrap: 'wrap' }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, display: 'block' }}>{f.nombre || f.correo}</span>
                  <span style={{ fontSize: 11, color: C.dim, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                    Kumplo: {f.kumplo?.id ?? '—'}
                  </span>
                </span>
                <span style={{
                  border: `1px solid ${COLOR_RIESGO[f.kumplo?.riesgo ?? 'desconocido']}44`,
                  color: COLOR_RIESGO[f.kumplo?.riesgo ?? 'desconocido'],
                  borderRadius: 999, padding: '4px 11px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
                }}>
                  {(f.kumplo?.riesgo ?? 'sin consultar').toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
