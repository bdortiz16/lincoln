// La ventana que pide un código cuando el servidor lo exige para una
// operación (ver lib/codigo2fa.ts): el de la app de verificación o el que
// llega al correo. Va montada una sola vez en el panel y una en la app.
import React, { useEffect, useRef, useState } from 'react';
import { Mail, ShieldCheck } from 'lucide-react';
import { CodeInput } from './CodeInput';
import { quitarPromptCodigo, registrarPromptCodigo, TipoCodigo } from '../lib/codigo2fa';

export const PromptCodigo2fa: React.FC = () => {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoCodigo>('app');
  const [codigo, setCodigo] = useState('');
  const resolver = useRef<((v: string | null) => void) | null>(null);

  useEffect(() => {
    const p = (m: string | null, t: TipoCodigo) => new Promise<string | null>((resolve) => {
      // Si quedó una pregunta abierta, se cancela: solo una a la vez.
      resolver.current?.(null);
      resolver.current = resolve;
      setMotivo(m); setTipo(t); setCodigo(''); setAbierto(true);
    });
    registrarPromptCodigo(p);
    return () => { quitarPromptCodigo(p); resolver.current?.(null); };
  }, []);

  const cerrar = (v: string | null) => {
    const r = resolver.current; resolver.current = null;
    setAbierto(false); setCodigo('');
    r?.(v);
  };

  if (!abierto) return null;
  const listo = codigo.length === 6;
  const correo = tipo === 'correo';
  const titulo = correo ? 'Confirma con el código del correo' : 'Confirma con tu código 2FA';
  const Icono = correo ? Mail : ShieldCheck;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center" style={{ padding: 12, background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }}
      onClick={() => cerrar(null)}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={titulo}
        style={{ width: '100%', maxWidth: 380, background: '#121413', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: 18, fontFamily: "'Archivo', system-ui, sans-serif", boxShadow: '0 24px 60px rgba(0,0,0,0.55)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Icono size={18} style={{ color: '#4ADE80' }} />
          <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#F4F4F2', letterSpacing: '-0.3px' }}>{titulo}</p>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#878E88', lineHeight: 1.5 }}>
          {correo
            ? 'Te enviamos un código de 6 dígitos al correo de tu cuenta. Así confirmamos que eres tú antes de activar la verificación en dos pasos.'
            : 'Esta operación cambia algo sensible y se autoriza cada vez con el código de tu app de verificación.'}
        </p>
        <CodeInput value={codigo} onChange={setCodigo} onComplete={(v) => cerrar(v)} tone="dark" autoFocus compacto aria={correo ? 'Código del correo' : 'Código de la app de verificación'} />
        {motivo && <p style={{ margin: '10px 0 0', fontSize: 12.5, color: '#F87171', textAlign: 'center' }}>{motivo}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={() => cerrar(null)}
            style={{ flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: '#F4F4F2', borderRadius: 10, padding: 10, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={() => listo && cerrar(codigo)} disabled={!listo}
            style={{ flex: 1, border: 'none', borderRadius: 10, padding: 10, fontWeight: 800, cursor: listo ? 'pointer' : 'not-allowed', background: listo ? '#4ADE80' : 'rgba(255,255,255,0.08)', color: listo ? '#0C0E0D' : 'rgba(244,244,242,0.45)' }}>Confirmar</button>
        </div>
      </div>
    </div>
  );
};
