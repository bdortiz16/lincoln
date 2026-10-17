import React, { useEffect, useRef, useState } from 'react';

// Puerta de verificación por correo tras el login (Google incluido).
// Envía un código de 6 dígitos al correo del usuario y no deja pasar al
// dashboard hasta confirmarlo. "Recordar este dispositivo" evita pedirlo
// de nuevo por 30 días en el mismo navegador.
// ── Identificador de este dispositivo ─────────────────────────────────────
//
// Antes "confiar en este dispositivo" era una FECHA en localStorage. Eso lo
// hacía frágil por los dos lados: cualquier limpieza del almacenamiento la
// borraba y el código se volvía a pedir en cada ingreso; y escribiendo esa
// fecha a mano se saltaba el paso entero.
//
// Ahora acá solo vive un identificador aleatorio, que por sí mismo no abre
// nada: quien decide si este dispositivo ya pasó el código es el SERVIDOR,
// que lleva la lista. Si el identificador se pierde, se vuelve a pedir el
// código una vez y se registra otro — que es lo correcto.
//
// RESPALDO LOCAL: se conserva la marca de antes (una fecha por usuario) y se
// usa SOLO cuando el servidor todavía no conoce esta función — o sea, cuando
// la versión desplegada es anterior a este cambio. Sin ese respaldo, el
// navegador nuevo contra el servidor viejo pide el código en CADA ingreso:
// pregunta por el dispositivo, recibe "acción desconocida", y por diseño ante
// la duda se pide el código. El arreglo terminaba empeorando el síntoma.
// Cuando el servidor esté al día, manda él y esto deja de usarse.
const DEVICE_KEY = 'lincoin_device';
const LEGACY_KEY = (userId: string) => `lincoin_otp_ok_${userId}`;
export function recuerdoLocal(userId?: string): boolean {
  if (!userId) return false;
  try { return Number(localStorage.getItem(LEGACY_KEY(userId))) > Date.now(); } catch { return false; }
}
function guardarRecuerdoLocal(userId: string) {
  try { localStorage.setItem(LEGACY_KEY(userId), String(Date.now() + 30 * 864e5)); } catch { /* sin almacenamiento */ }
}
export function deviceId(): string {
  try {
    let v = localStorage.getItem(DEVICE_KEY);
    if (v && /^[A-Za-z0-9_-]{16,64}$/.test(v)) return v;
    const b = new Uint8Array(24);
    crypto.getRandomValues(b);
    v = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    localStorage.setItem(DEVICE_KEY, v);
    return v;
  } catch { return ''; }   // sin almacenamiento: se pide el código siempre
}

interface Props {
  userId: string;
  email?: string;
  onVerified: () => void;
  onLogout: () => void;
}

export const EmailOtpGate: React.FC<Props> = ({ userId, email, onVerified, onLogout }) => {
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string>('');
  const [cooldown, setCooldown] = useState(0);
  const [remember, setRemember] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentOnce = useRef(false);

  const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
  const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
  const call = (action: string, extra: Record<string, unknown> = {}) =>
    fetch(`${SURL}/functions/v1/email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${SKEY}` },
      body: JSON.stringify({ action, userId, email, ...extra }),
    }).then(r => r.json()).catch(() => null);

  const send = async () => {
    if (sending || cooldown > 0) return;
    setSending(true); setErr(null); setMsg(null);
    const r = await call('send');
    setSending(false);
    if (r?.ok) {
      setSentTo(r.to || '');
      setMsg(r.throttled ? 'Ya te enviamos un código. Revisa tu correo.' : `Enviamos un código a ${r.to || 'tu correo'}.`);
      setCooldown(30);
    } else if (r?.error === 'email_not_configured') {
      setErr('El envío de correos no está configurado. Contacta a soporte.');
    } else {
      setErr(r?.detail ? `No se pudo enviar el código (${r.detail})` : 'No se pudo enviar el código. Reintenta.');
    }
  };

  // Enviar automáticamente al montar (una sola vez).
  useEffect(() => { if (!sentOnce.current) { sentOnce.current = true; send(); } setTimeout(() => inputRef.current?.focus(), 200); /* eslint-disable-next-line */ }, []);
  // Cuenta regresiva del reenvío.
  useEffect(() => { if (cooldown <= 0) return; const t = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000); return () => clearInterval(t); }, [cooldown]);

  const verify = async () => {
    if (verifying || code.length !== 6) return;
    setVerifying(true); setErr(null);
    // La confianza del dispositivo se pide EN LA MISMA llamada que verifica
    // el código: así el servidor la registra solo si el código era bueno.
    const r = await call('verify', { code, trust: remember, deviceId: deviceId() });
    setVerifying(false);
    if (r?.ok) {
      // También la marca local, por si el servidor aún no guarda dispositivos.
      if (remember) guardarRecuerdoLocal(userId);
      onVerified();
    } else {
      setErr(r?.message || 'Código incorrecto.');
      setCode('');
      inputRef.current?.focus();
    }
  };
  useEffect(() => { if (code.length === 6) verify(); /* eslint-disable-next-line */ }, [code]);

  const secBtn: React.CSSProperties = { border: '1px solid rgba(255,255,255,0.11)', background: 'rgba(255,255,255,0.045)', borderRadius: 10, padding: '11px 0', fontSize: 13.5, fontWeight: 600, color: '#F4F4F2' };

  return (
    <div style={{ minHeight: '100vh', background: '#070808', display: 'grid', placeItems: 'center', padding: 16, fontFamily: "'Archivo', system-ui, sans-serif" }}>
      <div style={{ width: '100%', maxWidth: 400, background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: '28px 26px' }}>
        <p style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: '#F4F4F2', marginBottom: 22 }}>Lincoin<span style={{ color: '#4ADE80' }}>.</span></p>
        <div style={{ width: 46, height: 46, borderRadius: '50%', border: '1.5px solid rgba(74,222,128,0.4)', background: 'rgba(74,222,128,0.08)', display: 'grid', placeItems: 'center', marginBottom: 16 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 7l8 5 8-5M4 7v10a1 1 0 001 1h14a1 1 0 001-1V7M4 7a1 1 0 011-1h14a1 1 0 011 1" stroke="#4ADE80" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <h2 style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.4px', color: '#F4F4F2' }}>Verifica tu ingreso</h2>
        <p style={{ fontSize: 13, color: '#878E88', marginTop: 6, lineHeight: 1.5 }}>
          Por tu seguridad, enviamos un código de 6 dígitos a {sentTo || 'tu correo'}. Ingrésalo para continuar.
        </p>

        <input
          ref={inputRef}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric" autoComplete="one-time-code" placeholder="••••••"
          style={{ width: '100%', marginTop: 20, textAlign: 'center', letterSpacing: 12, fontSize: 30, fontWeight: 800, fontFamily: 'ui-monospace, Menlo, monospace', color: '#F4F4F2', background: 'rgba(255,255,255,0.03)', border: `1px solid ${err ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 12, padding: '14px 0', outline: 'none' }}
        />

        {msg && !err && <p style={{ fontSize: 12, color: '#4ADE80', marginTop: 10 }}>{msg}</p>}
        {err && <p style={{ fontSize: 12.5, color: '#F4F4F2', marginTop: 10, fontWeight: 600 }}>{err}</p>}

        <label className="flex items-center" style={{ gap: 8, marginTop: 16, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} style={{ width: 15, height: 15, accentColor: '#4ADE80' }} />
          <span style={{ fontSize: 12.5, color: '#878E88' }}>Confiar en este dispositivo por 30 días</span>
        </label>

        <button onClick={verify} disabled={code.length !== 6 || verifying} className="lincoin-btn-white transition-colors" style={{ width: '100%', marginTop: 18, padding: '13px 0', borderRadius: 11, fontSize: 14, fontWeight: 700, border: 'none', opacity: (code.length !== 6 || verifying) ? 0.5 : 1 }}>
          {verifying ? 'Verificando…' : 'Confirmar y entrar'}
        </button>

        <div className="flex items-center justify-between" style={{ marginTop: 14 }}>
          <button onClick={send} disabled={cooldown > 0 || sending} style={{ fontSize: 12.5, fontWeight: 600, color: cooldown > 0 ? '#878E88' : '#F4F4F2', textDecoration: cooldown > 0 ? 'none' : 'underline' }}>
            {sending ? 'Enviando…' : cooldown > 0 ? `Reenviar en ${cooldown}s` : 'Reenviar código'}
          </button>
          <button onClick={onLogout} style={{ fontSize: 12.5, fontWeight: 600, color: '#878E88' }}>Salir</button>
        </div>
      </div>
    </div>
  );
};
