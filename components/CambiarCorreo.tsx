import React, { useState } from 'react';
import { llamarFuncion } from '../lib/edge';

// ─────────────────────────────────────────────────────────────
// El cliente cambia su correo de ACCESO desde Ajustes.
//
// El correo es la llave de la cuenta (con él se entra, ahí llegan los
// códigos y la recuperación de contraseña), así que va en dos pasos y los
// dos los verifica el servidor (admin-data correo_cambio_*):
//   1) el correo nuevo + el código de su app de 2FA;
//   2) el código que llega al correo NUEVO — prueba que es suyo y que está
//      bien escrito (con un correo mal escrito perdería el acceso).
// Al correo anterior le llega el aviso del cambio.
// ─────────────────────────────────────────────────────────────

const C = {
  card: '#0C0E0D', elev: '#121413', b1: 'rgba(255,255,255,0.08)', b2: 'rgba(255,255,255,0.14)',
  text: '#F4F4F2', sub: '#878E88', green: '#4ADE80', red: '#F87171', amber: '#FBBF24',
};
const FONT = 'Archivo, system-ui, sans-serif';
const campo: React.CSSProperties = {
  width: '100%', height: 44, marginTop: 6, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 10,
  padding: '0 13px', color: C.text, fontSize: 14, outline: 'none', fontFamily: FONT,
};
const etiqueta: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub };

export const CambiarCorreo: React.FC<{
  correoActual: string;
  onCerrar: () => void;
  onListo: (correoNuevo: string) => void;
}> = ({ correoActual, onCerrar, onListo }) => {
  const [paso, setPaso] = useState<1 | 2>(1);
  const [correo, setCorreo] = useState('');
  const [otp, setOtp] = useState('');
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const nuevo = correo.trim().toLowerCase();
  const correoOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(nuevo) && nuevo !== correoActual.trim().toLowerCase();

  const iniciar = async () => {
    if (!correoOk || otp.length !== 6 || ocupado) return;
    setOcupado(true); setError(null);
    const r = await llamarFuncion('admin-data', { action: 'correo_cambio_iniciar', email: nuevo, otp }, 30000);
    setOcupado(false);
    if (!r?.ok) { setError(String(r?.error ?? 'No se pudo iniciar el cambio.')); setOtp(''); return; }
    setPaso(2);
  };
  const confirmar = async () => {
    if (codigo.length !== 6 || ocupado) return;
    setOcupado(true); setError(null);
    const r = await llamarFuncion('admin-data', { action: 'correo_cambio_confirmar', codigo }, 30000);
    setOcupado(false);
    if (!r?.ok) { setError(String(r?.error ?? 'No se pudo confirmar.')); setCodigo(''); return; }
    onListo(String(r.email ?? nuevo));
  };

  return (
    <div className="fixed inset-0 z-[70] p-4" style={{ background: 'rgba(4,5,4,0.78)', display: 'grid', placeItems: 'center' }} onClick={onCerrar}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Cambiar correo de acceso"
        style={{ maxWidth: 420, width: '100%', background: C.card, border: `1px solid ${C.b2}`, borderRadius: 18, padding: '22px 24px', fontFamily: FONT, color: C.text }}>
        <p style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px', margin: 0 }}>Cambiar correo de acceso</p>
        <p style={{ fontSize: 12.5, color: C.sub, margin: '6px 0 0', lineHeight: 1.55 }}>
          {paso === 1
            ? <>Con este correo entras a Lincoin y ahí te llegan los códigos. Hoy es <b style={{ color: C.text }}>{correoActual}</b>.</>
            : <>Te enviamos un código a <b style={{ color: C.text }}>{nuevo}</b>. Escríbelo para confirmar que ese correo es tuyo.</>}
        </p>

        {paso === 1 ? (
          <>
            <div style={{ marginTop: 16 }}>
              <span style={etiqueta}>CORREO NUEVO</span>
              <input value={correo} onChange={e => setCorreo(e.target.value)} type="email" autoComplete="email" spellCheck={false} autoFocus
                placeholder="nombre@empresa.com" style={campo} />
            </div>
            <div style={{ marginTop: 14 }}>
              <span style={etiqueta}>CÓDIGO DE TU APP (2FA)</span>
              <input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code"
                placeholder="123456" style={{ ...campo, fontFamily: 'ui-monospace, monospace', letterSpacing: '4px', textAlign: 'center' }}
                onKeyDown={e => { if (e.key === 'Enter') iniciar(); }} />
            </div>
          </>
        ) : (
          <div style={{ marginTop: 16 }}>
            <span style={etiqueta}>CÓDIGO DEL CORREO</span>
            <input value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus
              placeholder="123456" style={{ ...campo, fontFamily: 'ui-monospace, monospace', letterSpacing: '4px', textAlign: 'center' }}
              onKeyDown={e => { if (e.key === 'Enter') confirmar(); }} />
            <p style={{ fontSize: 11.5, color: C.sub, margin: '8px 0 0', lineHeight: 1.5 }}>
              Vence en 15 minutos. Si no llega, revisa spam o{' '}
              <button type="button" onClick={() => { setPaso(1); setCodigo(''); setOtp(''); setError(null); }} style={{ color: C.text, textDecoration: 'underline', fontWeight: 600, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT, fontSize: 11.5 }}>
                vuelve a pedirlo
              </button>.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" style={{ fontSize: 12.5, color: C.red, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 10, padding: '9px 12px', margin: '14px 0 0', lineHeight: 1.5 }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
          <button type="button" onClick={onCerrar}
            style={{ flex: 1, height: 44, borderRadius: 10, background: 'transparent', border: `1px solid ${C.b2}`, color: C.text, fontFamily: FONT, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Cancelar
          </button>
          {paso === 1 ? (
            <button type="button" onClick={iniciar} disabled={!correoOk || otp.length !== 6 || ocupado} className="lincoin-btn-white"
              style={{ flex: 1.4, height: 44, borderRadius: 10, border: 'none', fontFamily: FONT, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: !correoOk || otp.length !== 6 || ocupado ? 0.5 : 1 }}>
              {ocupado ? 'Enviando…' : 'Enviar código'}
            </button>
          ) : (
            <button type="button" onClick={confirmar} disabled={codigo.length !== 6 || ocupado} className="lincoin-btn-white"
              style={{ flex: 1.4, height: 44, borderRadius: 10, border: 'none', fontFamily: FONT, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: codigo.length !== 6 || ocupado ? 0.5 : 1 }}>
              {ocupado ? 'Confirmando…' : 'Cambiar correo'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
