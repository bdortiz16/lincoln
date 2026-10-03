// ─────────────────────────────────────────────────────────────
// Tu cuenta en Brasil (PIX · BRL) — tarjeta del panel de Empresas.
//
// Aparece cuando Brasil está encendido en Admin → Países. Según el estado:
//   · sin cuenta   → botón para pedirla (CNPJ y razón social)
//   · solicitada   → "en revisión"
//   · rechazada    → el motivo y volver a pedirla
//   · activa       → los datos para recibir PIX, con copiar
//
// El cliente no ve el nombre del aliado que abre la cuenta: ve su banco,
// agência y conta, que es lo que le sirve para cobrar.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { Copy, Check, X } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';
import { FlagImg } from './FlagImg';

const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, Menlo, monospace';
const C = { card: '#0C0E0D', b1: 'rgba(255,255,255,0.08)', b2: 'rgba(255,255,255,0.12)', text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)', green: '#4ADE80', amber: '#FBBF24', red: '#F87171' };

const docFmt = (tipo?: string, d?: string) => {
  const s = String(d ?? '');
  if (tipo === 'CNPJ' && s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
  if (tipo === 'CPF' && s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
  return s;
};
const TIPO_CONTA: Record<string, string> = { pagamento: 'Conta de pagamento', corrente: 'Conta corrente', poupanca: 'Poupança' };
const TIPO_CHAVE: Record<string, string> = { cnpj: 'CNPJ', cpf: 'CPF', email: 'Correo', telefone: 'Teléfono', aleatoria: 'Aleatoria' };

type Props = {
  saldo: number;
  empresa?: string;
  taxId?: string;
  verificada: boolean;
  showToast?: (msg: string, ms?: number, tipo?: 'success' | 'error') => void;
};

export const CuentaBrasilTarjeta: React.FC<Props> = ({ saldo, empresa, taxId, verificada, showToast }) => {
  const [cuenta, setCuenta] = useState<any>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pedir, setPedir] = useState(false);
  const [verDatos, setVerDatos] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  const cargar = async () => {
    const r = await llamarFuncion('gowd', { action: 'mi_cuenta' }, 20000);
    if (r?.ok) { setCuenta(r.cuenta ?? null); setError(null); }
    else { setCuenta(null); setError(null); }
  };
  useEffect(() => { cargar(); }, []);
  // Mientras está en revisión, se consulta sola cada 30 s: cuando el equipo
  // la asigna, los datos aparecen sin recargar la página.
  useEffect(() => {
    if (!cuenta || !['solicitada', 'en_creacion'].includes(cuenta.estado)) return;
    const t = setInterval(cargar, 30000);
    return () => clearInterval(t);
  }, [cuenta?.estado]);

  const copiar = async (k: string, v: string) => { try { await navigator.clipboard.writeText(v); setCopiado(k); setTimeout(() => setCopiado(null), 1500); } catch { /* */ } };
  const estado: string = cuenta?.estado ?? 'ninguna';

  const pie = (() => {
    if (cuenta === undefined) return <span style={{ fontSize: 11.5, color: C.sub }}>Consultando…</span>;
    if (estado === 'activa') return <button onClick={() => setVerDatos(true)} style={{ fontSize: 12, fontWeight: 600, color: C.text }} className="hover:text-[#4ADE80] transition-colors">Ver datos para recibir</button>;
    if (estado === 'solicitada' || estado === 'en_creacion') return <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.6px', color: C.amber }}>EN REVISIÓN</span>;
    return <button onClick={() => { if (!verificada) { showToast?.('Primero termina la verificación de tu empresa.', 5000, 'error'); return; } setPedir(true); }} style={{ fontSize: 12, fontWeight: 600, color: C.text }} className="hover:text-[#4ADE80] transition-colors">{estado === 'rechazada' ? 'Volver a pedirla' : 'Pedir cuenta en Brasil'}</button>;
  })();

  const texto = cuenta === undefined ? ''
    : estado === 'activa' ? `Recibe PIX en tu cuenta de ${cuenta.bancoNombre}. Lo recibido se abona a tu saldo BRL.`
    : estado === 'solicitada' || estado === 'en_creacion' ? 'Estamos abriendo tu cuenta. Te avisamos cuando los datos estén listos.'
    : estado === 'rechazada' ? (cuenta.notaCliente ? `No se pudo abrir: ${cuenta.notaCliente}` : 'No se pudo abrir tu cuenta.')
    : 'Pide tu cuenta en Brasil para recibir pagos por PIX a nombre de tu empresa.';

  return (
    <>
      <div style={{ background: C.card, border: `1px solid ${C.b1}`, borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column', fontFamily: FONT }}>
        <div style={{ padding: '18px 18px 16px', flex: 1 }}>
          <div className="flex items-center" style={{ gap: 10, marginBottom: 14 }}>
            <FlagImg code="BRL" className="w-7 h-5 object-cover rounded-sm" />
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>Real brasileño</p>
              <p style={{ fontSize: 11, color: C.sub }}>Cuenta local · Pix · BRL</p>
            </div>
          </div>
          <div className="flex items-baseline" style={{ gap: 5 }}>
            <span style={{ fontWeight: 800, fontSize: 25, letterSpacing: '-0.7px', color: C.text }}>{saldo.toLocaleString('es-CO', { maximumFractionDigits: 2 })}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginBottom: 1 }}>BRL</span>
          </div>
          <p style={{ fontSize: 10.5, color: estado === 'rechazada' ? C.red : C.dim, marginTop: 8, lineHeight: 1.45 }}>{texto}</p>
          {error && <p style={{ fontSize: 10.5, color: C.red, marginTop: 6 }}>{error}</p>}
        </div>
        <div style={{ padding: '11px 18px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10.5, color: C.sub, fontFamily: MONO }}>{estado === 'activa' && cuenta?.conta ? `${cuenta.agencia} · ${cuenta.conta}` : 'Pix · BRL'}</span>
          {pie}
        </div>
      </div>

      {pedir && <PedirCuenta empresa={empresa} taxId={taxId} onCerrar={() => setPedir(false)} onListo={(c) => { setCuenta(c); setPedir(false); showToast?.('Solicitud enviada. Te avisamos cuando tu cuenta esté lista.', 5000, 'success'); }} />}

      {verDatos && cuenta?.estado === 'activa' && (
        <Modal onCerrar={() => setVerDatos(false)} titulo="Tu cuenta en Brasil" sub="Comparte estos datos para que te paguen por PIX o transferencia.">
          {([
            ['titular', 'Titular', cuenta.titular],
            ['doc', cuenta.documentoTipo ?? 'Documento', docFmt(cuenta.documentoTipo, cuenta.documento)],
            ['banco', 'Banco', `${cuenta.bancoNombre}${cuenta.bancoCodigo ? ` (${cuenta.bancoCodigo})` : ''}`],
            ...(cuenta.ispb ? [['ispb', 'ISPB', cuenta.ispb]] : []),
            ['agencia', 'Agência', cuenta.agencia],
            ['conta', TIPO_CONTA[cuenta.contaTipo] ?? 'Conta', cuenta.conta],
            ...(cuenta.chavePix ? [['chave', `Chave PIX · ${TIPO_CHAVE[cuenta.chavePixTipo] ?? ''}`, cuenta.chavePix]] : []),
          ] as [string, string, string][]).map(([k, l, v]) => (
            <div key={k} className="flex items-center justify-between" style={{ gap: 12, padding: '12px 0', borderTop: `1px solid ${C.b1}` }}>
              <span style={{ fontSize: 12.5, color: C.sub, flexShrink: 0 }}>{l}</span>
              <span className="flex items-center" style={{ gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text, fontFamily: ['titular', 'banco'].includes(k) ? FONT : MONO, textAlign: 'right', wordBreak: 'break-all' }}>{v}</span>
                <button onClick={() => copiar(k, String(v))} aria-label={`Copiar ${l}`} style={{ flexShrink: 0, color: copiado === k ? C.green : C.sub }}>{copiado === k ? <Check size={14} /> : <Copy size={14} />}</button>
              </span>
            </div>
          ))}
          <p style={{ fontSize: 12, color: C.sub, margin: '14px 0 0', lineHeight: 1.5 }}>Lo que recibas se abona a tu saldo BRL cuando confirmamos el pago. Desde ahí lo conviertes o lo envías.</p>
        </Modal>
      )}
    </>
  );
};

// ── Pedir la cuenta ──────────────────────────────────────────────────────
const PedirCuenta: React.FC<{ empresa?: string; taxId?: string; onCerrar: () => void; onListo: (c: any) => void }> = ({ empresa, taxId, onCerrar, onListo }) => {
  const soloDig = String(taxId ?? '').replace(/\D/g, '');
  const [titular, setTitular] = useState(empresa ?? '');
  const [tipo, setTipo] = useState<'CNPJ' | 'CPF'>('CNPJ');
  const [doc, setDoc] = useState(soloDig.length === 14 ? soloDig : '');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true); setError(null);
    const r = await llamarFuncion('gowd', { action: 'solicitar', titular: titular.trim(), documentoTipo: tipo, documento: doc }, 30000);
    setOcupado(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo enviar la solicitud.'); return; }
    onListo(r.cuenta);
  };
  const campo: React.CSSProperties = { fontFamily: FONT, width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.b2}`, color: C.text, borderRadius: 10, padding: '11px 12px', fontSize: 14, outline: 'none' };
  return (
    <Modal onCerrar={onCerrar} titulo="Pedir cuenta en Brasil" sub="Una cuenta a nombre de tu empresa para recibir pagos por PIX.">
      <form onSubmit={enviar} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '0 0 6px' }}>RAZÃO SOCIAL</p>
          <input value={titular} onChange={e => setTitular(e.target.value.slice(0, 140))} style={campo} autoFocus />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '0 0 6px' }}>DOCUMENTO</p>
            <select value={tipo} onChange={e => setTipo(e.target.value as any)} style={campo}><option value="CNPJ">CNPJ</option><option value="CPF">CPF</option></select>
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '0 0 6px' }}>NÚMERO</p>
            <input value={docFmt(tipo, doc)} onChange={e => setDoc(e.target.value.replace(/\D/g, '').slice(0, tipo === 'CNPJ' ? 14 : 11))} inputMode="numeric" placeholder={tipo === 'CNPJ' ? '00.000.000/0000-00' : '000.000.000-00'} style={{ ...campo, fontFamily: MONO }} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: C.sub, margin: 0, lineHeight: 1.5 }}>Revisamos que los datos coincidan con tu empresa verificada y te avisamos cuando la cuenta esté lista.</p>
        {error && <p style={{ fontSize: 12.5, color: C.red, margin: 0, lineHeight: 1.45 }}>{error}</p>}
        <button type="submit" disabled={ocupado} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, padding: '12px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', opacity: ocupado ? 0.6 : 1 }}>{ocupado ? 'Enviando…' : 'Enviar solicitud'}</button>
      </form>
    </Modal>
  );
};

const Modal: React.FC<{ titulo: string; sub?: string; onCerrar: () => void; children: React.ReactNode }> = ({ titulo, sub, onCerrar, children }) => (
  <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
    <div onClick={e => e.stopPropagation()} style={{ fontFamily: FONT, width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto', background: C.card, border: `1px solid ${C.b2}`, borderRadius: 16, padding: 22 }}>
      <div className="flex items-start justify-between" style={{ gap: 12, marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 17, fontWeight: 800, margin: 0, color: C.text, letterSpacing: '-0.3px' }}>{titulo}</p>
          {sub && <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>{sub}</p>}
        </div>
        <button onClick={onCerrar} aria-label="Cerrar" style={{ background: 'transparent', border: 'none', color: C.sub, cursor: 'pointer', padding: 4 }}><X size={18} /></button>
      </div>
      {children}
    </div>
  </div>
);
