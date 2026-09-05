import React, { useEffect, useState } from 'react';
import { ShieldCheck, Mail, Smartphone, Fingerprint, Loader2 } from 'lucide-react';
import { soportaPasskey, firmarConPasskey, explicarErrorPasskey } from '../lib/webauthn';

// ─────────────────────────────────────────────────────────────
// AdminStepUp — verificación reforzada.
//
// Que la sesión haya pasado el 2FA AL ENTRAR no alcanza para lo que mueve
// dinero: una sesión abierta hace horas —o robada— sigue siendo válida. Esto
// vuelve a pedir los factores AHORA, con vencimiento corto:
//
//   1. el código del correo      (siempre)
//   2. el código de la app       (siempre)
//   3. la llave del dispositivo  (solo si la cuenta tiene alguna registrada)
//
// Quién decide si ya está verificado es el SERVIDOR. Esta pantalla solo
// pregunta y muestra; no puede darse por buena sola.
// ─────────────────────────────────────────────────────────────

const C = {
  card: '#0C0E0D', elev: '#121413',
  border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)',
  green: '#4ADE80', red: '#F87171',
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

/** Le pregunta al servidor qué factores le faltan a esta sesión. */
export const consultarStepUp = async (userId: string): Promise<string[] | null> => {
  const d = await call({ action: 'step_up_status', userId }).catch(() => null);
  return d?.ok ? (d.falta ?? []) : null;
};

const ETIQUETA: Record<string, { icono: any; texto: string }> = {
  email: { icono: Mail, texto: 'Código del correo' },
  app: { icono: Smartphone, texto: 'Código de la app' },
  passkey: { icono: Fingerprint, texto: 'Llave del dispositivo' },
};

type Props = {
  userId: string;
  /** Qué se va a hacer, en una frase. Ej: "para entrar a Tesorería". */
  motivo: string;
  /** Se llama cuando ya no falta ningún factor. */
  onListo: () => void;
  /** Si se pasa, aparece un botón para salir sin verificar. */
  onCancelar?: () => void;
  /** Excluir la llave (la pantalla de llaves no puede exigirla). */
  sinPasskey?: boolean;
};

export const AdminStepUp: React.FC<Props> = ({ userId, motivo, onListo, onCancelar, sinPasskey }) => {
  const [falta, setFalta] = useState<string[] | null>(null);
  const [codigo, setCodigo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [correoEnviado, setCorreoEnviado] = useState(false);

  const filtrar = (l: string[]) => (sinPasskey ? l.filter(f => f !== 'passkey') : l);

  const refrescar = async () => {
    const f = await consultarStepUp(userId);
    if (f === null) { setError('No se pudo consultar la verificación.'); return; }
    const pendiente = filtrar(f);
    setFalta(pendiente);
    if (pendiente.length === 0) onListo();
  };

  useEffect(() => {
    if (!userId) return;
    refrescar();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [userId]);

  // El código del correo se manda solo al llegar al paso, no antes: enviarlo
  // en cuanto se abre la pantalla llenaría el buzón de códigos sin usar.
  useEffect(() => {
    if (!falta?.length || falta[0] !== 'email' || correoEnviado) return;
    setCorreoEnviado(true);
    call({ action: 'mfa_start_login', userId })
      .then(d => setAviso(d?.ok ? 'Te enviamos un código.' : (d?.message ?? 'No se pudo enviar el código.')))
      .catch(() => setAviso('No se pudo enviar el código.'));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [falta, correoEnviado]);

  const paso = falta?.[0] ?? null;

  const enviarCodigo = async () => {
    if (busy || codigo.length !== 6 || !paso) return;
    setBusy(true); setError(null); setAviso(null);
    const d = paso === 'email'
      ? await call({ action: 'mfa_verify_email', userId, code: codigo }).catch(() => null)
      : await call({ action: 'mfa_verify', userId, code: codigo }).catch(() => null);
    setBusy(false);
    if (!d?.ok) { setError(d?.message ?? 'Código incorrecto o vencido.'); return; }
    setCodigo('');
    await refrescar();
  };

  const usarLlave = async () => {
    if (busy) return;
    setBusy(true); setError(null); setAviso(null);
    try {
      const o = await call({ action: 'passkey_auth_options', userId });
      if (!o?.ok) throw new Error(o?.message ?? 'No hay ninguna llave registrada.');
      const credential = await firmarConPasskey(o.options);
      const v = await call({ action: 'passkey_auth_verify', userId, credential });
      if (!v?.ok) throw new Error(v?.message ?? 'La llave no se pudo verificar.');
      await refrescar();
    } catch (e: any) { setError(explicarErrorPasskey(e)); }
    setBusy(false);
  };

  if (falta === null) {
    return (
      <div style={{ fontFamily: FONT, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 20, color: C.sub, fontSize: 13, display: 'flex', alignItems: 'center', gap: 9 }}>
        <Loader2 size={15} className="animate-spin" /> Comprobando la verificación…
      </div>
    );
  }
  if (!falta.length) return null;

  return (
    <div style={{ fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 22, maxWidth: 460, margin: '0 auto' }}>
      <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16, margin: 0 }}>
        <ShieldCheck size={17} color={C.green} /> Verifica tu identidad
      </p>
      <p style={{ color: C.sub, fontSize: 12.5, margin: '5px 0 0', lineHeight: 1.55 }}>
        {motivo} hay que confirmar quién eres, aquí y ahora. Una sesión ya abierta no basta.
      </p>

      {/* Los pasos, para saber cuántos faltan */}
      <div style={{ display: 'flex', gap: 7, margin: '16px 0 4px', flexWrap: 'wrap' }}>
        {falta.map((f, i) => {
          const meta = ETIQUETA[f];
          if (!meta) return null;
          const Icono = meta.icono;
          const activo = i === 0;
          return (
            <span key={f} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: activo ? 'rgba(74,222,128,0.12)' : C.elev,
              border: `1px solid ${activo ? 'rgba(74,222,128,0.32)' : C.border}`,
              color: activo ? C.green : C.dim,
              borderRadius: 999, padding: '6px 12px', fontSize: 11.5, fontWeight: 700,
            }}>
              <Icono size={12} /> {meta.texto}
            </span>
          );
        })}
      </div>

      {(paso === 'email' || paso === 'app') && (
        <div style={{ marginTop: 12 }}>
          <input
            value={codigo}
            onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => { if (e.key === 'Enter') enviarCodigo(); }}
            autoFocus
            inputMode="numeric"
            placeholder="123 456"
            style={{
              width: '100%', background: C.elev, border: `1px solid ${C.border}`, color: C.text,
              borderRadius: 10, padding: '12px 14px', fontSize: 18, letterSpacing: 6,
              textAlign: 'center', fontFamily: 'ui-monospace, Menlo, monospace', outline: 'none',
            }} />
          <button onClick={enviarCodigo} disabled={busy || codigo.length !== 6}
            style={{
              width: '100%', marginTop: 9, background: 'rgba(74,222,128,0.12)',
              border: '1px solid rgba(74,222,128,0.32)', color: C.green, borderRadius: 10,
              padding: '11px 0', fontSize: 13, fontWeight: 800,
              cursor: busy || codigo.length !== 6 ? 'default' : 'pointer',
              opacity: busy || codigo.length !== 6 ? 0.55 : 1, fontFamily: FONT,
            }}>
            {busy ? 'Verificando…' : 'Continuar'}
          </button>
          {paso === 'email' && (
            <button onClick={async () => { setAviso('Enviando…'); const d = await call({ action: 'mfa_resend_email', userId }).catch(() => null); setAviso(d?.ok ? 'Código reenviado.' : 'No se pudo reenviar. Espera un momento.'); }}
              style={{ width: '100%', marginTop: 6, background: 'none', border: 'none', color: C.sub, fontSize: 11.5, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', fontFamily: FONT }}>
              Reenviar código
            </button>
          )}
        </div>
      )}

      {paso === 'passkey' && (
        <div style={{ marginTop: 12 }}>
          {soportaPasskey() ? (
            <button onClick={usarLlave} disabled={busy}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.32)',
                color: C.green, borderRadius: 10, padding: '12px 0', fontSize: 13, fontWeight: 800,
                cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1, fontFamily: FONT,
              }}>
              <Fingerprint size={15} /> {busy ? 'Esperando al dispositivo…' : 'Confirmar con la llave'}
            </button>
          ) : (
            <p style={{ color: C.sub, fontSize: 12.5, lineHeight: 1.5 }}>
              Este navegador no puede usar la llave. Abre el panel en Chrome, Safari o Edge en el dispositivo donde la registraste.
            </p>
          )}
        </div>
      )}

      {error && <p style={{ marginTop: 11, fontSize: 12, color: C.red, lineHeight: 1.5 }}>{error}</p>}
      {aviso && !error && <p style={{ marginTop: 11, fontSize: 12, color: C.sub }}>{aviso}</p>}

      {onCancelar && (
        <button onClick={onCancelar}
          style={{ width: '100%', marginTop: 12, background: 'none', border: 'none', color: C.dim, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
          Cancelar
        </button>
      )}
    </div>
  );
};
