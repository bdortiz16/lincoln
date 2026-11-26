// ════════════════════════════════════════════════════════
// lincoin.me/desbloquear — desbloqueo de la cuenta del panel desde el correo.
//
// Antes el enlace del correo desbloqueaba con solo abrirlo. Los filtros de
// correo (Outlook, Gmail, antivirus) abren los enlaces solos para revisarlos,
// así que la cuenta se desbloqueaba sin que nadie lo decidiera. Ahora el
// enlace trae acá, y solo el botón desbloquea (un POST a admin-data con el
// token de un solo uso del correo). No hace falta sesión: quien está
// bloqueado justamente no puede entrar.
// ════════════════════════════════════════════════════════
import React, { useState } from 'react';

export const DesbloquearCuenta: React.FC = () => {
  const q = new URLSearchParams(window.location.search);
  const u = q.get('u') ?? '';
  const t = q.get('t') ?? '';
  const [estado, setEstado] = useState<'listo' | 'enviando' | 'hecho'>('listo');
  const [res, setRes] = useState<{ ok: boolean; titulo: string; texto: string } | null>(null);

  const desbloquear = async () => {
    if (estado !== 'listo') return;
    setEstado('enviando');
    try {
      const SURL = (import.meta as any).env?.VITE_SUPABASE_URL || '';
      const SKEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';
      const r = await fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${SKEY}` },
        body: JSON.stringify({ action: 'unlock_cuenta', u, t }),
      });
      const d = await r.json().catch(() => null);
      setRes(d?.titulo ? { ok: !!d.ok, titulo: String(d.titulo), texto: String(d.texto ?? '') }
        : { ok: false, titulo: 'No se pudo desbloquear', texto: 'Intenta de nuevo en un momento.' });
      setEstado('hecho');
    } catch {
      setRes({ ok: false, titulo: 'Sin conexión', texto: 'Revisa tu conexión e intenta de nuevo.' });
      setEstado('listo');
    }
  };

  const incompleto = !u || !t;
  return (
    <div style={{ minHeight: '100vh', background: '#070808', display: 'grid', placeItems: 'center', padding: 16, fontFamily: "'Archivo', system-ui, sans-serif" }}>
      <div style={{ width: '100%', maxWidth: 400, background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: '28px 26px' }}>
        <p style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: '#F4F4F2', margin: '0 0 22px' }}>Lincoin<span style={{ color: '#4ADE80' }}>.</span></p>
        {res ? (
          <>
            <h1 style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.4px', color: res.ok ? '#4ADE80' : '#F87171', margin: 0 }}>{res.titulo}</h1>
            <p style={{ fontSize: 13, color: '#878E88', marginTop: 8, lineHeight: 1.6 }}>{res.texto}</p>
            {res.ok && (
              <a href="/admin-empresas" style={{ display: 'block', textAlign: 'center', marginTop: 20, padding: '13px 0', borderRadius: 11, fontSize: 14, fontWeight: 700, background: '#F4F4F2', color: '#0C0E0D', textDecoration: 'none' }}>Ir a iniciar sesión</a>
            )}
          </>
        ) : incompleto ? (
          <>
            <h1 style={{ fontSize: 19, fontWeight: 800, color: '#F87171', margin: 0 }}>Enlace incompleto</h1>
            <p style={{ fontSize: 13, color: '#878E88', marginTop: 8, lineHeight: 1.6 }}>Vuelve a abrir el enlace del correo.</p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.4px', color: '#F4F4F2', margin: 0 }}>Desbloquear tu cuenta</h1>
            <p style={{ fontSize: 13, color: '#878E88', marginTop: 8, lineHeight: 1.6 }}>
              La cuenta se bloqueó por intentos fallidos de ingreso. Si fuiste tú, desbloquéala. Si no fuiste tú, <b style={{ color: '#F4F4F2' }}>no la desbloquees</b> y cambia la contraseña.
            </p>
            <button onClick={desbloquear} disabled={estado === 'enviando'}
              style={{ width: '100%', marginTop: 20, padding: '13px 0', borderRadius: 11, fontSize: 14, fontWeight: 700, border: 'none', background: '#4ADE80', color: '#0C0E0D', cursor: estado === 'enviando' ? 'default' : 'pointer', opacity: estado === 'enviando' ? 0.6 : 1 }}>
              {estado === 'enviando' ? 'Desbloqueando…' : 'Desbloquear mi cuenta'}
            </button>
            <p style={{ fontSize: 11.5, color: 'rgba(244,244,242,0.45)', marginTop: 14, lineHeight: 1.5 }}>El enlace sirve una sola vez.</p>
          </>
        )}
      </div>
    </div>
  );
};
