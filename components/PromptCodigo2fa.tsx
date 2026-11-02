// La ventana que pide el código 2FA cuando el servidor lo exige para una
// operación (ver lib/codigo2fa.ts). Va montada una sola vez en el panel.
import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { CodeInput } from './CodeInput';
import { registrarPromptCodigo } from '../lib/codigo2fa';

export const PromptCodigo2fa: React.FC = () => {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const resolver = useRef<((v: string | null) => void) | null>(null);

  useEffect(() => {
    registrarPromptCodigo((m) => new Promise<string | null>((resolve) => {
      // Si quedó una pregunta abierta, se cancela: solo una a la vez.
      resolver.current?.(null);
      resolver.current = resolve;
      setMotivo(m); setCodigo(''); setAbierto(true);
    }));
    return () => { registrarPromptCodigo(null); resolver.current?.(null); };
  }, []);

  const cerrar = (v: string | null) => {
    const r = resolver.current; resolver.current = null;
    setAbierto(false); setCodigo('');
    r?.(v);
  };

  if (!abierto) return null;
  const listo = codigo.length === 6;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center" style={{ padding: 12, background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }}
      onClick={() => cerrar(null)}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Confirmar con tu código 2FA"
        style={{ width: '100%', maxWidth: 380, background: '#121413', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: 18, fontFamily: "'Archivo', system-ui, sans-serif", boxShadow: '0 24px 60px rgba(0,0,0,0.55)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <ShieldCheck size={18} style={{ color: '#4ADE80' }} />
          <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#F4F4F2', letterSpacing: '-0.3px' }}>Confirma con tu código 2FA</p>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#878E88', lineHeight: 1.5 }}>
          Esta operación cambia algo sensible y se autoriza cada vez con el código de tu app de verificación.
        </p>
        <CodeInput value={codigo} onChange={setCodigo} onComplete={(v) => cerrar(v)} tone="dark" autoFocus compacto aria="Código de la app de verificación" />
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
