// ════════════════════════════════════════════════════════
// ActivarDosPasosColaborador — el primer ingreso de un colaborador.
//
// El colaborador nace de una invitación: su cuenta la creó el dueño y la
// contraseña la puso él desde el correo. Antes de ver una sola sección tiene
// que activar su 2FA. El servidor también lo exige (falta2faColaborador en
// admin-data y equipoPermite en las demás): esta pantalla es la parte
// visible, no la frontera.
//
// Al terminar se cierra la sesión a propósito: activar el 2FA no deja
// verificada la sesión con la que se activó (mfa_set no la anota), así que
// las acciones del panel la rechazarían. Volver a entrar con el código es
// lo que deja la sesión completa.
// ════════════════════════════════════════════════════════

import React, { useState } from 'react';
import { ShieldCheck, Copy, Check, LogOut } from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';
import { CodeInput } from './CodeInput';
import { Logo } from './Logo';

const FONDO = 'linear-gradient(135deg, #121413 0%, #0C0E0D 60%, #0A0B0A 100%)';
const TXT = '#F4F4F2';
const TXT2 = '#878E88';

export const ActivarDosPasosColaborador: React.FC<{ onSalir: () => Promise<void> }> = ({ onSalir }) => {
  const { enrollMFA, verifyMFAEnrollment, currentUser } = useDatabase() as any;
  const [paso, setPaso] = useState<'inicio' | 'escanear' | 'codigos'>('inicio');
  const [alta, setAlta] = useState<{ qrCode: string; secret: string; factorId: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [respaldo, setRespaldo] = useState<string[]>([]);
  const [copiado, setCopiado] = useState(false);

  const empezar = async () => {
    setOcupado(true); setError(null);
    try {
      const d = await enrollMFA();
      if (!d) { setError('No se pudo generar el código QR. Intenta de nuevo.'); return; }
      setAlta(d); setPaso('escanear');
    } catch { setError('No se pudo generar el código QR. Intenta de nuevo.'); }
    finally { setOcupado(false); }
  };

  const verificar = async (v = codigo) => {
    if (!alta || v.length !== 6 || ocupado) return;
    setOcupado(true); setError(null);
    try {
      const r = await verifyMFAEnrollment(alta.factorId, v, alta.secret);
      if (!r?.ok) { setError(r?.error ?? 'Código incorrecto.'); setCodigo(''); return; }
      setRespaldo(Array.isArray(r.backupCodes) ? r.backupCodes : []);
      setPaso('codigos');
    } catch { setError('No se pudo verificar. Intenta de nuevo.'); }
    finally { setOcupado(false); }
  };

  const copiar = async () => {
    try { await navigator.clipboard.writeText(respaldo.join('\n')); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sin portapapeles */ }
  };

  const tarjeta: React.CSSProperties = { background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16, padding: 22 };
  const boton: React.CSSProperties = { width: '100%', background: '#4ADE80', color: '#0A0B0A', border: 'none', borderRadius: 12, padding: '12px 16px', fontWeight: 800, fontSize: 14, cursor: 'pointer' };

  return (
    <div style={{ minHeight: '100vh', background: FONDO, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'Archivo, system-ui, sans-serif' }}>
      <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(circle at 85% 10%, rgba(74,222,128,0.10), transparent 45%)', pointerEvents: 'none' }} />
      <div style={{ width: '100%', maxWidth: 420, position: 'relative' }}>
        <div style={{ marginBottom: 24 }}><Logo variant="white" /></div>

        <div style={tarjeta}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <ShieldCheck size={18} style={{ color: '#4ADE80' }} />
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: '-0.4px', color: TXT }}>
              {paso === 'codigos' ? 'Guarda tus códigos de respaldo' : 'Activa la verificación en dos pasos'}
            </h1>
          </div>

          {paso === 'inicio' && (<>
            <p style={{ margin: '0 0 16px', fontSize: 13.5, color: TXT2, lineHeight: 1.55 }}>
              {currentUser?.email ? <>Hola, <b style={{ color: TXT }}>{currentUser.email}</b>. </> : null}
              Antes de entrar al panel necesitas una app de códigos, como Google Authenticator o Authy.
              Cada vez que entres te pediremos el código de 6 dígitos que muestra.
            </p>
            {error && <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#F87171' }}>{error}</p>}
            <button onClick={empezar} disabled={ocupado} style={{ ...boton, opacity: ocupado ? 0.6 : 1 }}>
              {ocupado ? 'Preparando…' : 'Empezar'}
            </button>
          </>)}

          {paso === 'escanear' && alta && (<>
            <p style={{ margin: '0 0 14px', fontSize: 13.5, color: TXT2, lineHeight: 1.55 }}>
              Escanea el código con la app y escribe el código de 6 dígitos que aparece.
            </p>
            <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 10, width: 196, margin: '0 auto 10px' }}>
              {alta.qrCode
                ? <img src={alta.qrCode} alt="Código QR para la app de verificación" style={{ width: 176, height: 176, display: 'block' }} />
                : <p style={{ margin: 0, fontSize: 12, color: '#15181A' }}>QR no disponible: usa la clave de abajo.</p>}
            </div>
            <p style={{ margin: '0 0 4px', fontSize: 11, color: TXT2, textAlign: 'center' }}>¿No puedes escanear? Escribe esta clave en la app:</p>
            <p style={{ margin: '0 0 16px', fontSize: 12, fontFamily: 'ui-monospace, monospace', color: TXT, textAlign: 'center', wordBreak: 'break-all', background: '#121413', borderRadius: 8, padding: '6px 8px' }}>{alta.secret}</p>
            <CodeInput value={codigo} onChange={setCodigo} onComplete={verificar} tone="dark" autoFocus aria="Código de la app de verificación" />
            {error && <p style={{ margin: '10px 0 0', fontSize: 12.5, color: '#F87171', textAlign: 'center' }}>{error}</p>}
            <button onClick={() => verificar()} disabled={ocupado || codigo.length !== 6} style={{ ...boton, marginTop: 14, opacity: ocupado || codigo.length !== 6 ? 0.5 : 1, cursor: ocupado || codigo.length !== 6 ? 'not-allowed' : 'pointer' }}>
              {ocupado ? 'Verificando…' : 'Activar'}
            </button>
          </>)}

          {paso === 'codigos' && (<>
            <p style={{ margin: '0 0 14px', fontSize: 13.5, color: TXT2, lineHeight: 1.55 }}>
              Si pierdes el celular, con uno de estos códigos puedes entrar. Cada uno sirve una sola vez
              y no los volveremos a mostrar: guárdalos en un lugar seguro.
            </p>
            {respaldo.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, background: '#121413', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                {respaldo.map(c => <span key={c} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: TXT, textAlign: 'center' }}>{c}</span>)}
              </div>
            ) : (
              <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#FBBF24' }}>La verificación quedó activa, pero no recibimos códigos de respaldo.</p>
            )}
            {respaldo.length > 0 && (
              <button onClick={copiar} style={{ width: '100%', background: 'transparent', color: TXT, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12, padding: '10px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
                {copiado ? <><Check size={14} style={{ color: '#4ADE80' }} /> Copiados</> : <><Copy size={14} /> Copiar códigos</>}
              </button>
            )}
            <p style={{ margin: '0 0 12px', fontSize: 12.5, color: TXT2, lineHeight: 1.5 }}>
              Por seguridad, ahora vuelve a entrar con tu correo, tu contraseña y el código de la app.
            </p>
            <button onClick={onSalir} style={boton}>Ya los guardé — entrar de nuevo</button>
          </>)}
        </div>

        {paso !== 'codigos' && (
          <button onClick={onSalir} style={{ marginTop: 14, background: 'none', border: 'none', color: TXT2, fontSize: 12.5, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <LogOut size={13} /> Salir
          </button>
        )}
      </div>
    </div>
  );
};
