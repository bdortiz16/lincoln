// ══════════════════════════════════════════════════════════════════
//  Acceso para el contador — lo administra la empresa desde Contabilidad.
//
//  La empresa escribe el correo y el nombre de su contador. El servidor le
//  crea una cuenta aparte (rol contador) atada a esta empresa y le manda un
//  correo para que fije su contraseña. El contador entra por
//  Empresas → Contabilidad y ve solo la contabilidad: nada de saldos
//  operables, ni enviar, ni configurar. Se puede quitar cuando se quiera.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from 'react';
import { X, Trash2, Mail, ShieldCheck } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';

const FONT = 'Archivo, system-ui, sans-serif';
const C = { tarjeta: '#0C0E0D', borde: 'rgba(255,255,255,0.10)', text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c', verde: '#4ADE80', rojo: '#F87171' };

type Contador = { id: string; email: string; nombre: string; creadoEn?: string | null };

export const AccesoContadorModal: React.FC<{ onCerrar: () => void }> = ({ onCerrar }) => {
  const [lista, setLista] = useState<Contador[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [creando, setCreando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  const cargar = async () => {
    const r = await llamarFuncion('contador', { action: 'listar_accesos' }, 30000);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo consultar.'); setLista([]); return; }
    setLista(r.contadores ?? []);
  };
  useEffect(() => { cargar(); }, []);

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creando) return;
    setCreando(true); setError(null); setAviso(null);
    const r = await llamarFuncion('contador', { action: 'crear_acceso', email: email.trim(), nombre: nombre.trim(), origen: window.location.origin }, 60000);
    setCreando(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo crear el acceso.'); return; }
    setEmail(''); setNombre('');
    setAviso(r.correoEnviado
      ? `Listo. Le llegó un correo a ${r.contador.email} para fijar su contraseña. Después entra por Empresas → Contabilidad.`
      : `El acceso quedó creado, pero el correo no salió (${r.motivoCorreo || 'sin detalle'}). Dile que use "Recuperar contraseña" en el login con ese correo.`);
    cargar();
  };

  const quitar = async (c: Contador) => {
    if (!window.confirm(`¿Quitar el acceso de ${c.nombre} (${c.email})? Ya no podrá entrar.`)) return;
    setBorrando(c.id); setError(null);
    const r = await llamarFuncion('contador', { action: 'revocar_acceso', contadorId: c.id }, 30000);
    setBorrando(null);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo quitar.'); return; }
    cargar();
  };

  const campo: React.CSSProperties = { fontFamily: FONT, width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, color: C.text, borderRadius: 9, padding: '10px 12px', fontSize: 13.5, outline: 'none' };

  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ fontFamily: FONT, width: '100%', maxWidth: 540, background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 16, padding: 22, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="flex items-start justify-between" style={{ gap: 12 }}>
          <div>
            <p style={{ fontSize: 17, fontWeight: 800, color: C.text, margin: 0, letterSpacing: '-0.3px' }}>Acceso para tu contador</p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '5px 0 0', lineHeight: 1.5 }}>
              Entra con su propio correo por <b style={{ color: C.text }}>Empresas → Contabilidad</b> y ve solo esta pantalla: movimientos, comprobantes y facturas. No ve saldos operables ni puede mover dinero.
            </p>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ background: 'transparent', border: 'none', color: C.sub, cursor: 'pointer', padding: 4 }}><X size={18} /></button>
        </div>

        <form onSubmit={crear} style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: '0 0 6px' }}>NOMBRE</p>
            <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre del contador o de la firma" style={campo} maxLength={80} required />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: '0 0 6px' }}>CORREO</p>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="contador@firma.com" type="email" style={campo} required />
            <p style={{ fontSize: 11.5, color: C.tenue, margin: '6px 0 0' }}>Tiene que ser un correo que no tenga cuenta en Lincoin.</p>
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" disabled={creando} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, padding: '10px 18px', borderRadius: 9, border: 'none', cursor: 'pointer', opacity: creando ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Mail size={14} /> {creando ? 'Creando…' : 'Crear acceso y enviar correo'}
            </button>
          </div>
        </form>

        {error && <p style={{ fontSize: 12.5, color: C.rojo, margin: '12px 0 0', lineHeight: 1.45 }}>{error}</p>}
        {aviso && <p style={{ fontSize: 12.5, color: C.verde, margin: '12px 0 0', lineHeight: 1.45 }}>{aviso}</p>}

        <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: '22px 0 8px' }}>CON ACCESO HOY</p>
        {lista == null ? (
          <p style={{ fontSize: 12.5, color: C.tenue, margin: 0 }}>Consultando…</p>
        ) : lista.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.tenue, margin: 0 }}>Nadie todavía.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lista.map(c => (
              <div key={c.id} className="flex items-center justify-between" style={{ gap: 10, background: 'rgba(255,255,255,0.035)', border: `1px solid ${C.borde}`, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ minWidth: 0 }}>
                  <p className="flex items-center" style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: 0, gap: 6 }}><ShieldCheck size={13} color={C.verde} /> {c.nombre}</p>
                  <p style={{ fontSize: 12, color: C.sub, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}{c.creadoEn ? ` · desde ${new Date(c.creadoEn).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}</p>
                </div>
                <button onClick={() => quitar(c)} disabled={borrando === c.id} title="Quitar acceso"
                  style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: borrando === c.id ? 0.5 : 1, flexShrink: 0 }}>
                  <Trash2 size={13} /> {borrando === c.id ? '…' : 'Quitar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
