import React, { useEffect, useState } from 'react';
import { ShieldCheck, Link2, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// KumploUserCard — Configuración → Kumplo, del lado del titular.
//
// ACÁ ES DONDE SE CONECTA. El titular pega el código EMP-… que Kumplo le dio
// a SU negocio, y con eso queda armado el vínculo. No lo pone el admin: cada
// negocio tiene su propia cuenta en Kumplo, así que el id es de cada quien.
// Lo que sí es nuestro —la credencial y las rutas— es infraestructura: una
// sola para todos, y por eso Kumplo pide el id de la empresa en cada llamada.
//
// Apenas se conecta, Lincoin le manda a Kumplo el nombre y el documento, la
// cuenta queda EN VERIFICACIÓN, y vuelve el veredicto: verificada, en
// revisión, o bloqueada.
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
  try {
    const r = await fetch(`${SURL}/functions/v1/kumplo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tokenOf() ?? SKEY}` },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch { return null; }
};

// El texto sale del ESTADO, no del nivel de riesgo a secas: "riesgo medio" no
// le dice nada a nadie, "tu cuenta está en revisión" sí. Y quien no puede
// operar tiene que enterarse acá, no al intentar una transferencia.
const TEXTO = (estado: string, riesgo: string, operable: boolean | undefined) => {
  if (estado === 'procesando') return { color: C.sub, titulo: 'Verificación en curso', cuerpo: 'Estamos esperando el resultado. Suele tardar menos de un minuto.' };
  if (riesgo === 'alto') return { color: C.red, titulo: 'Bloqueada', cuerpo: 'No se pueden hacer transferencias desde esta cuenta. Comunícate con soporte para revisar tu caso.' };
  if (riesgo === 'desconocido') return { color: C.amber, titulo: 'Documento sin validar', cuerpo: 'No pudimos validar el documento. Revisa que el número esté correcto o comunícate con soporte.' };
  if (operable === false) return { color: C.amber, titulo: 'En revisión', cuerpo: 'La cuenta está en revisión de cumplimiento. Mientras tanto no se pueden hacer transferencias.' };
  if (riesgo === 'medio') return { color: C.amber, titulo: 'Verificada · con observaciones', cuerpo: 'Puedes operar. Es posible que te pidamos documentación adicional más adelante.' };
  if (riesgo === 'bajo') return { color: C.green, titulo: 'Verificada', cuerpo: 'La cuenta puede operar con normalidad.' };
  return { color: C.sub, titulo: 'Verificación en proceso', cuerpo: 'Estamos verificando los datos. Puedes seguir usando tu cuenta mientras tanto.' };
};

export const KumploUserCard: React.FC<{ userId: string }> = ({ userId }) => {
  const [data, setData] = useState<any>(null);
  const [codigo, setCodigo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const cargar = async () => {
    const d = await call({ action: 'estado', userId });
    setData(d?.ok ? d : { ok: false });
  };
  useEffect(() => { if (userId) cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

  // Si la integración está apagada o la cuenta no entra en la prueba, la
  // sección no aparece: una sección muerta solo genera preguntas. La excepción
  // es quien YA conectó — ese tiene que poder seguir viendo su estado y
  // desconectarse aunque la integración se apague después.
  if (!data?.ok) return null;
  if ((!data.activo || !data.enLaPrueba) && !data.conectado) return null;

  const estado = data.estado ?? {};
  const conectado = !!data.conectado;
  const riesgo = String(estado.riesgo ?? '');
  const t = TEXTO(String(estado.estado ?? ''), riesgo, estado.operable);

  const conectar = async () => {
    if (!codigo.trim() || busy) return;
    setBusy(true); setMsg(null);
    const d = await call({ action: 'conectar', userId, empresaId: codigo.trim() });
    setBusy(false);
    if (d?.ok) { setCodigo(''); setMsg({ ok: true, texto: 'Cuenta conectada. Estamos verificando tus datos.' }); await cargar(); }
    else setMsg({ ok: false, texto: d?.error ?? 'No se pudo conectar. Revisa el código.' });
  };

  const revisar = async () => {
    setBusy(true); setMsg(null);
    const d = await call({ action: 'aml', userId });
    setBusy(false);
    if (d?.ok) await cargar();
    else setMsg({ ok: false, texto: d?.motivo ?? 'No se pudo consultar.' });
  };

  const desconectar = async () => {
    setBusy(true); setMsg(null);
    const d = await call({ action: 'desconectar', userId });
    setBusy(false);
    if (d?.ok) { setMsg({ ok: true, texto: 'Cuenta desconectada.' }); await cargar(); }
  };

  const btn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, background: 'transparent',
    border: `1px solid ${C.border2}`, color: C.text, borderRadius: 999,
    padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
  };

  return (
    <div style={{ fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16, margin: 0 }}>
          <Link2 size={17} color={conectado ? C.green : C.sub} /> Kumplo
        </p>
        <span style={{
          border: `1px solid ${conectado ? 'rgba(74,222,128,0.32)' : C.border2}`,
          color: conectado ? C.green : C.sub, borderRadius: 999,
          padding: '4px 12px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
        }}>
          {conectado ? '● Conectada' : '○ Sin conectar'}
        </span>
      </div>

      {!conectado ? (
        <>
          <p style={{ color: C.sub, fontSize: 12.5, margin: '7px 0 0', lineHeight: 1.6 }}>
            Conecta tu cuenta de <b style={{ color: C.text }}>Kumplo</b> para que tu verificación de
            cumplimiento quede al día. Pega el código que Kumplo le dio a tu empresa — empieza por
            <b style={{ color: C.text }}> EMP-</b>. Con eso queda listo: del resto nos encargamos nosotros.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 13 }}>
            <input
              value={codigo}
              onChange={e => setCodigo(e.target.value.trim())}
              onKeyDown={e => { if (e.key === 'Enter') conectar(); }}
              placeholder="EMP-XXXXXX"
              style={{
                flex: 1, minWidth: 180, background: C.elev, border: `1px solid ${C.border}`, color: C.text,
                borderRadius: 10, padding: '11px 13px', fontSize: 14, outline: 'none', fontFamily: MONO,
              }} />
            <button onClick={conectar} disabled={busy || !codigo.trim()}
              style={{
                background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.32)',
                color: C.green, borderRadius: 10, padding: '11px 20px', fontSize: 13.5, fontWeight: 800,
                cursor: busy || !codigo.trim() ? 'default' : 'pointer', fontFamily: FONT,
                opacity: busy || !codigo.trim() ? 0.5 : 1, whiteSpace: 'nowrap',
              }}>
              {busy ? 'Conectando…' : 'Conectar'}
            </button>
          </div>
          <p style={{ color: C.dim, fontSize: 11, margin: '10px 0 0', lineHeight: 1.55 }}>
            ¿No tienes el código? Te lo entrega Kumplo cuando crea la cuenta de tu empresa.
          </p>
        </>
      ) : (
        <>
          <div style={{ marginTop: 13, background: C.elev, border: `1px solid ${t.color}33`, borderRadius: 12, padding: '13px 15px' }}>
            <p style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 800, fontSize: 14, margin: 0, color: t.color }}>
              {String(estado.estado ?? '') === 'procesando'
                ? <Loader2 size={15} className="animate-spin" />
                : estado.operable === false ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />}
              {t.titulo}
            </p>
            <p style={{ color: C.sub, fontSize: 12.5, margin: '6px 0 0', lineHeight: 1.55 }}>{t.cuerpo}</p>
            {estado.nombreCoincide === false && estado.nombreDocumento && (
              <p style={{ color: C.amber, fontSize: 12, margin: '8px 0 0', lineHeight: 1.5 }}>
                El nombre registrado no coincide con el del documento. Verifica tus datos.
              </p>
            )}
            {estado.at && (
              <p style={{ color: C.dim, fontSize: 11, margin: '8px 0 0' }}>
                Última revisión: {new Date(estado.at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
          </div>

          <p style={{ color: C.dim, fontSize: 11.5, margin: '11px 0 0', fontFamily: MONO, wordBreak: 'break-all' }}>
            Empresa en Kumplo: {estado.empresaId}
            {estado.id ? ` · registro ${estado.id}` : ''}
          </p>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={revisar} disabled={busy} style={{ ...btn, opacity: busy ? 0.55 : 1 }}>
              <RefreshCw size={12} /> {busy ? 'Consultando…' : 'Volver a revisar'}
            </button>
            <button onClick={desconectar} disabled={busy} style={{ ...btn, color: C.dim, opacity: busy ? 0.55 : 1 }}>
              Desconectar
            </button>
          </div>
        </>
      )}

      {msg && (
        <p style={{ marginTop: 12, fontSize: 12.5, color: msg.ok ? C.green : C.red, lineHeight: 1.5 }}>{msg.texto}</p>
      )}
    </div>
  );
};
