import React, { useEffect, useState } from 'react';
import { ShieldCheck, Link2, AlertTriangle, RefreshCw } from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// KumploUserCard — lo que ve el usuario en Configuración → Kumplo.
//
// Kumplo lleva el expediente de cumplimiento. Al inscribirse, Lincoin lo da
// de alta allá y pide la consulta AML; acá se ve el resultado y, si hace
// falta, se puede vincular a mano un id que ya exista en Kumplo.
//
// La tarjeta NO aparece si la integración está apagada o si la cuenta no
// entra en la prueba: mostrar una sección muerta solo genera preguntas.
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
  const r = await fetch(`${SURL}/functions/v1/kumplo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tokenOf() ?? SKEY}` },
    body: JSON.stringify(body),
  });
  return r.json();
};

const TEXTO: Record<string, { color: string; titulo: string; cuerpo: string }> = {
  bajo: { color: C.green, titulo: 'Riesgo bajo', cuerpo: 'Tu cuenta puede operar con normalidad.' },
  medio: { color: C.amber, titulo: 'Riesgo medio', cuerpo: 'Puedes operar. Es posible que te pidamos documentación adicional más adelante.' },
  alto: { color: C.red, titulo: 'Riesgo alto', cuerpo: 'No se pueden hacer transferencias desde esta cuenta. Comunícate con soporte para revisar tu caso.' },
  desconocido: { color: C.sub, titulo: 'Sin resultado todavía', cuerpo: 'La consulta aún no ha devuelto un resultado.' },
};

export const KumploUserCard: React.FC<{ userId: string }> = ({ userId }) => {
  const [data, setData] = useState<any>(null);
  const [idManual, setIdManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const cargar = async () => {
    const d = await call({ action: 'estado', userId }).catch(() => null);
    setData(d?.ok ? d : { ok: false });
  };
  useEffect(() => { if (userId) cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

  // Apagada o fuera de la prueba: no se muestra nada.
  if (!data?.ok || !data.activo || !data.enLaPrueba) return null;

  const estado = data.estado ?? {};
  const riesgo = String(estado.riesgo ?? 'desconocido');
  const t = TEXTO[riesgo] ?? TEXTO.desconocido;

  const vincular = async () => {
    if (!idManual.trim()) return;
    setBusy(true); setMsg(null);
    const d = await call({ action: 'vincular', userId, kumploId: idManual.trim() }).catch(() => null);
    if (d?.ok) { setIdManual(''); setMsg('Cuenta vinculada.'); await cargar(); }
    else setMsg(d?.error ?? 'No se pudo vincular.');
    setBusy(false);
  };

  const revisar = async () => {
    setBusy(true); setMsg(null);
    const d = await call({ action: 'aml', userId }).catch(() => null);
    if (d?.ok) await cargar(); else setMsg(d?.motivo ?? 'No se pudo consultar.');
    setBusy(false);
  };

  return (
    <div style={{ fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18 }}>
      <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16, margin: 0 }}>
        <Link2 size={17} color={C.sub} /> Kumplo
      </p>
      <p style={{ color: C.sub, fontSize: 12, margin: '4px 0 0', lineHeight: 1.55 }}>
        Kumplo es donde vive tu expediente de cumplimiento. Lincoin consulta ahí para verificar
        que tu cuenta puede operar.
      </p>

      <div style={{
        marginTop: 14, background: C.elev, border: `1px solid ${t.color}33`,
        borderRadius: 12, padding: '13px 15px',
      }}>
        <p style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 800, fontSize: 14, margin: 0, color: t.color }}>
          {riesgo === 'alto' ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />} {t.titulo}
        </p>
        <p style={{ color: C.sub, fontSize: 12.5, margin: '6px 0 0', lineHeight: 1.55 }}>{t.cuerpo}</p>
        {estado.at && (
          <p style={{ color: C.dim, fontSize: 11, margin: '8px 0 0' }}>
            Última revisión: {new Date(estado.at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        )}
      </div>

      {estado.id ? (
        <p style={{ color: C.dim, fontSize: 11.5, margin: '12px 0 0', fontFamily: 'ui-monospace, Menlo, monospace' }}>
          Id en Kumplo: {estado.id}
        </p>
      ) : (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.sub, margin: '0 0 6px' }}>
            ¿YA TIENES EXPEDIENTE EN KUMPLO?
          </p>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <input value={idManual} onChange={e => setIdManual(e.target.value)} placeholder="Pega tu id de Kumplo"
              style={{ flex: 1, minWidth: 170, background: C.elev, border: `1px solid ${C.border}`, color: C.text, borderRadius: 9, padding: '9px 12px', fontSize: 12.5, outline: 'none', fontFamily: 'ui-monospace, Menlo, monospace' }} />
            <button onClick={vincular} disabled={busy || !idManual.trim()}
              style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.32)', color: C.green, borderRadius: 9, padding: '9px 16px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, opacity: busy || !idManual.trim() ? 0.55 : 1 }}>
              Vincular
            </button>
          </div>
        </div>
      )}

      {estado.id && (
        <button onClick={revisar} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, background: 'transparent', border: `1px solid ${C.border2}`, color: C.text, borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, opacity: busy ? 0.55 : 1 }}>
          <RefreshCw size={12} /> {busy ? 'Consultando…' : 'Volver a revisar'}
        </button>
      )}

      {msg && <p style={{ marginTop: 11, fontSize: 12, color: C.sub }}>{msg}</p>}
    </div>
  );
};
