import React, { useEffect, useState } from 'react';
import { KeyRound, Plus, X, Fingerprint, ShieldCheck, AlertTriangle } from 'lucide-react';
import { soportaPasskey, tienePasskeyDelDispositivo, crearPasskey, firmarConPasskey, explicarErrorPasskey } from '../lib/webauthn';
import { AdminStepUp } from './AdminStepUp';

// ─────────────────────────────────────────────────────────────
// AdminPasskeys — las llaves físicas de la cuenta del panel.
//
// La llave vive DENTRO del dispositivo y nunca sale de él: lo único que viaja
// es una firma, atada al dominio real. No se puede fotografiar, ni copiar del
// portapapeles, ni sacar con una página falsa — que es exactamente como se
// pierden una contraseña, un código de 6 dígitos y unos códigos de respaldo.
//
// Registrar una llave exige que ESTA sesión ya haya superado el 2FA. Darla de
// alta desde una sesión a medio verificar sería regalarle al intruso la puerta
// definitiva.
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
  const r = await fetch(`${SURL}/functions/v1/admin-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tokenOf() ?? SKEY}` },
    body: JSON.stringify(body),
  });
  return r.json();
};

type Llave = { id: string; nombre: string; at: string };

export const AdminPasskeys: React.FC<{ userId: string }> = ({ userId }) => {
  const [llaves, setLlaves] = useState<Llave[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nombre, setNombre] = useState('');
  const [hayLector, setHayLector] = useState<boolean | null>(null);
  // Registrar o quitar una llave cambia la puerta de entrada. El servidor
  // exige volver a probar el correo y el código de la app; cuando responde
  // que falta, se muestra aquí mismo y se reintenta lo que se estaba haciendo.
  const [pidiendo, setPidiendo] = useState<null | (() => void)>(null);

  const soportado = soportaPasskey();

  const cargar = async () => {
    const d = await call({ action: 'passkey_list', userId }).catch(() => null);
    if (d?.ok) { setLlaves(d.passkeys ?? []); setError(null); }
    else if (d?.error === 'needs_2fa') { setLlaves(null); setError('Verifica el 2FA en este dispositivo para administrar tus llaves.'); }
    else { setLlaves([]); setError(d?.message ?? d?.error ?? 'No se pudieron leer las llaves.'); }
  };

  useEffect(() => {
    if (!userId) return;
    cargar();
    tienePasskeyDelDispositivo().then(setHayLector);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [userId]);

  const registrar = async () => {
    setBusy(true); setMsg(null); setError(null);
    try {
      const o = await call({ action: 'passkey_register_options', userId });
      if (o?.error === 'step_up') { setBusy(false); setPidiendo(() => registrar); return; }
      if (!o?.ok) throw new Error(o?.message ?? o?.error ?? 'No se pudo iniciar el registro.');
      const credential = await crearPasskey(o.options);
      const v = await call({
        action: 'passkey_register_verify', userId, credential,
        nombre: nombre.trim() || undefined,
      });
      if (!v?.ok) throw new Error(v?.message ?? 'La llave no se pudo registrar.');
      setLlaves(v.passkeys ?? []);
      setNombre('');
      setMsg('Llave registrada. La próxima vez que entres, te la va a pedir.');
    } catch (e: any) {
      setError(explicarErrorPasskey(e));
    }
    setBusy(false);
  };

  const probar = async () => {
    setBusy(true); setMsg(null); setError(null);
    try {
      const o = await call({ action: 'passkey_auth_options', userId });
      if (!o?.ok) throw new Error(o?.message ?? 'No hay ninguna llave registrada.');
      const credential = await firmarConPasskey(o.options);
      const v = await call({ action: 'passkey_auth_verify', userId, credential });
      if (!v?.ok) throw new Error(v?.message ?? 'La llave no se pudo verificar.');
      setMsg('La llave funciona.');
    } catch (e: any) {
      setError(explicarErrorPasskey(e));
    }
    setBusy(false);
  };

  const borrar = async (id: string) => {
    setBusy(true); setMsg(null); setError(null);
    const d = await call({ action: 'passkey_delete', userId, passkeyId: id }).catch(() => null);
    if (d?.error === 'step_up') { setBusy(false); setPidiendo(() => () => borrar(id)); return; }
    if (d?.ok) { setLlaves(d.passkeys ?? []); setMsg('Llave eliminada.'); }
    else setError(d?.message ?? 'No se pudo eliminar.');
    setBusy(false);
  };

  // Mientras el servidor pide verificación, la tarjeta se reemplaza por ella.
  if (pidiendo) {
    return (
      <AdminStepUp
        userId={userId}
        motivo="Para cambiar las llaves de tu cuenta"
        sinPasskey
        onCancelar={() => setPidiendo(null)}
        onListo={() => { const seguir = pidiendo; setPidiendo(null); seguir(); }}
      />
    );
  }

  return (
    <div style={{ fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16, margin: 0 }}>
            <KeyRound size={17} color={llaves?.length ? C.green : C.sub} /> Llave de este dispositivo (passkey)
          </p>
          <p style={{ color: C.sub, fontSize: 12, margin: '4px 0 0', maxWidth: 580, lineHeight: 1.55 }}>
            La llave se guarda dentro del dispositivo —Face ID, huella, o una llave USB— y nunca sale de él.
            Lo único que viaja es una firma atada a lincoin.me, así que no se puede fotografiar, ni copiar,
            ni sacar con una página falsa. Es la capa que aguanta aunque te roben la contraseña, el 2FA y los
            códigos de respaldo.
          </p>
        </div>
        <span style={{
          background: llaves?.length ? 'rgba(74,222,128,0.14)' : 'transparent',
          border: `1px solid ${llaves?.length ? C.green : C.border2}`,
          color: llaves?.length ? C.green : C.sub,
          borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap',
        }}>
          {llaves?.length ? `● ${llaves.length} activa${llaves.length === 1 ? '' : 's'}` : '○ Sin llaves'}
        </span>
      </div>

      {!soportado && (
        <div style={{ marginTop: 14, background: C.elev, border: '1px solid rgba(251,191,36,0.35)', borderRadius: 12, padding: '12px 14px', color: C.amber, fontSize: 12.5, display: 'flex', gap: 8 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Este navegador no soporta passkeys. Ábrelo en Chrome, Safari o Edge actualizados.</span>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 14, background: C.elev, border: '1px solid rgba(248,113,113,0.35)', borderRadius: 12, padding: '12px 14px', color: C.red, fontSize: 12.5 }}>
          {error}
        </div>
      )}

      {/* Llaves ya registradas */}
      {!!llaves?.length && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
          {llaves.map(l => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: C.elev, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                <Fingerprint size={15} color={C.green} style={{ flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, display: 'block' }}>{l.nombre}</span>
                  <span style={{ fontSize: 11, color: C.dim }}>
                    registrada el {new Date(l.at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                </span>
              </span>
              <button onClick={() => borrar(l.id)} disabled={busy}
                title="Eliminar esta llave"
                style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', display: 'flex', flexShrink: 0 }}><X size={15} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Registrar una nueva */}
      {soportado && !error && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 14 }}>
          <input
            value={nombre} onChange={e => setNombre(e.target.value.slice(0, 40))}
            placeholder={hayLector === false ? 'Llave USB' : 'Mi iPhone'}
            style={{ flex: 1, minWidth: 150, background: C.elev, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '9px 12px', fontSize: 12.5, outline: 'none', fontFamily: FONT }} />
          <button onClick={registrar} disabled={busy}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.32)', color: C.green, borderRadius: 8, padding: '9px 15px', fontSize: 12.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
            <Plus size={14} /> {busy ? 'Esperando al dispositivo…' : 'Registrar esta llave'}
          </button>
          {!!llaves?.length && (
            <button onClick={probar} disabled={busy}
              style={{ background: 'transparent', border: `1px solid ${C.border2}`, color: C.text, borderRadius: 8, padding: '9px 15px', fontSize: 12.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              Probarla
            </button>
          )}
        </div>
      )}

      {msg && <p style={{ marginTop: 12, fontSize: 12, color: C.green, fontWeight: 600 }}>{msg}</p>}

      <p style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}`, color: C.dim, fontSize: 11, lineHeight: 1.6 }}>
        <ShieldCheck size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Registra al menos <strong style={{ color: C.sub }}>dos</strong>: el teléfono y otra cosa —el computador o una llave USB—.
          Si solo hay una y pierdes ese dispositivo, se entra con el código de la app o uno de respaldo, pero es mejor no depender de eso.
          El código del correo se sigue pidiendo siempre, antes de la llave.
        </span>
      </p>
    </div>
  );
};
