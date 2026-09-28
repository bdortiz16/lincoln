// ══════════════════════════════════════════════════════════════════
//  Panel Persona — la cuenta en pesos de un cliente de una empresa
//
//  Para qué existe: una empresa registrada en Lincoin (modelo PSP) tiene
//  clientes. Cada cliente abre su cuenta Persona, le da a la empresa su ID
//  Lincoin, y la empresa le carga saldo desde su panel. Aquí la persona ve
//  su ID, su saldo en COP y de quién le llegó cada carga.
//
//  Solo COP por ahora. USD, USDC, EURC y la tarjeta se muestran como
//  "pronto" y no llevan a ningún lado: un enlace que no abre nada es peor
//  que decir que aún no está.
// ══════════════════════════════════════════════════════════════════
import React, { useMemo, useState } from 'react';
import { Copy, Check, LogOut, RefreshCw, ArrowDownLeft, ArrowUpRight, Clock } from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';

const FONT = 'Archivo, system-ui, sans-serif';
const C = {
  fondo: '#070808', tarjeta: '#0C0E0D', elevado: '#121413', borde: 'rgba(255,255,255,0.08)',
  text: '#F4F4F2', sub: '#878E88', tenue: 'rgba(244,244,242,0.45)', verde: '#4ADE80', rojo: '#F87171',
};

const fmtCop = (v: number) => `$ ${Math.round(v).toLocaleString('es-CO')}`;
const fecha = (ts: any) => { const d = new Date(ts ?? 0); return isNaN(d.getTime()) ? '' : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

const ROTULO: Record<string, string> = {
  pay_received: 'Saldo recibido', pay_sent: 'Pago enviado', load: 'Carga de saldo', send: 'Retiro',
  adjustment: 'Ajuste de saldo', referral_payout: 'Bono de referido', receive: 'Recibido',
};
const ENTRA = new Set(['pay_received', 'load', 'adjustment', 'referral_payout', 'receive']);

export const PersonaDashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const { currentUser, transactions, refreshData } = useDatabase();
  const [copiado, setCopiado] = useState(false);
  const [refrescando, setRefrescando] = useState(false);

  const cu: any = currentUser ?? {};
  const codigo: string = String(cu.ownReferralCode ?? '').toUpperCase() || String(cu.id ?? '').slice(-6).toUpperCase();
  const saldoCop = Number(cu.balances?.COP ?? 0) || 0;
  const nombre = String(cu.name || cu.fullName || cu.email || 'Tu cuenta');

  const movs = useMemo(() => (transactions ?? [])
    .filter((t: any) => t.userId === cu.id && String(t.currency ?? '').toUpperCase().startsWith('COP'))
    .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, 60), [transactions, cu.id]);

  const copiar = async () => {
    try { await navigator.clipboard.writeText(codigo); setCopiado(true); setTimeout(() => setCopiado(false), 1800); } catch { /* sin portapapeles */ }
  };
  const refrescar = async () => {
    setRefrescando(true);
    try { await refreshData(); } finally { setRefrescando(false); }
  };

  const kyc = String(cu.kycStatus ?? 'pending');
  const kycTxt = kyc === 'approved' ? 'Cuenta verificada' : kyc === 'rejected' ? 'Verificación rechazada' : 'Cuenta creada';

  const contraparte = (t: any) => t.counterpartyName ?? t.senderName ?? t.recipientName ?? t.beneficiaryName ?? t.method ?? '';

  return (
    <div style={{ minHeight: '100vh', background: C.fondo, color: C.text, fontFamily: FONT }}>
      <header style={{ borderBottom: `1px solid ${C.borde}`, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div className="flex items-center" style={{ gap: 14 }}>
          <p style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.6px', margin: 0, lineHeight: 1 }}>Lincoin<span style={{ color: C.verde }}>.</span></p>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '2.2px', color: C.sub }}>PERSONAS</span>
        </div>
        <button onClick={onLogout} style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '9px 12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <LogOut size={13} /> Salir
        </button>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '22px 16px 48px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <p style={{ fontSize: 12.5, color: C.sub, margin: 0 }}>Hola,</p>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.6px', margin: '2px 0 0' }}>{nombre}</h1>
          <span style={{ display: 'inline-block', marginTop: 8, fontSize: 10.5, fontWeight: 800, letterSpacing: '1px', color: kyc === 'approved' ? C.verde : C.sub, border: `1px solid ${kyc === 'approved' ? 'rgba(74,222,128,0.35)' : C.borde}`, borderRadius: 999, padding: '3px 9px' }}>{kycTxt.toUpperCase()}</span>
        </div>

        {/* Saldo */}
        <section style={{ background: `linear-gradient(135deg, #161A17 0%, ${C.tarjeta} 70%)`, border: `1px solid ${C.borde}`, borderRadius: 16, padding: '20px 20px 18px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -60, right: -40, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(74,222,128,0.14), transparent 65%)', pointerEvents: 'none' }} />
          <div className="flex items-center justify-between" style={{ gap: 10 }}>
            <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>SALDO EN PESOS</p>
            <button onClick={refrescar} disabled={refrescando} title="Actualizar" style={{ background: 'transparent', border: 'none', color: C.sub, cursor: 'pointer', padding: 4, opacity: refrescando ? 0.5 : 1 }}><RefreshCw size={14} /></button>
          </div>
          <p style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-1px', margin: '8px 0 0', fontVariantNumeric: 'tabular-nums' }}>{fmtCop(saldoCop)} <span style={{ fontSize: 15, color: C.sub, fontWeight: 700 }}>COP</span></p>
          <p style={{ fontSize: 12, color: C.tenue, margin: '6px 0 0' }}>Pesos colombianos · saldo que te cargan las empresas con las que trabajas.</p>
        </section>

        {/* ID Lincoin: lo que la persona le da a la empresa. */}
        <section style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 16, padding: '18px 20px' }}>
          <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>MI ID LINCOIN</p>
          <div className="flex items-center justify-between" style={{ gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
            <p style={{ fontSize: 30, fontWeight: 800, letterSpacing: '4px', margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{codigo}</p>
            <button onClick={copiar} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, padding: '10px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {copiado ? <Check size={14} /> : <Copy size={14} />} {copiado ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <p style={{ fontSize: 12.5, color: C.sub, margin: '10px 0 0', lineHeight: 1.5 }}>
            Dáselo a la empresa que te va a cargar saldo. Con este ID te encuentran en Lincoin y te acreditan en pesos, sin comisión.
          </p>
        </section>

        {/* Lo que viene. Sin botones: no hay a dónde ir todavía. */}
        <section style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 16, padding: '16px 20px' }}>
          <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>PRÓXIMAMENTE</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 10 }}>
            {[['USD', 'Dólares digitales'], ['USDC', 'Dólar de Circle'], ['EURC', 'Euro de Circle'], ['Tarjeta', 'Mastercard Lincoin']].map(([t, d]) => (
              <div key={t} style={{ background: 'rgba(255,255,255,0.03)', border: `1px dashed ${C.borde}`, borderRadius: 11, padding: '10px 12px', opacity: 0.85 }}>
                <div className="flex items-center justify-between"><span style={{ fontSize: 13.5, fontWeight: 800 }}>{t}</span><span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '1px', color: C.sub, border: `1px solid ${C.borde}`, borderRadius: 999, padding: '2px 7px' }}>PRONTO</span></div>
                <p style={{ fontSize: 11.5, color: C.tenue, margin: '4px 0 0' }}>{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Movimientos */}
        <section style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 16, padding: '16px 20px' }}>
          <div className="flex items-center justify-between">
            <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>MOVIMIENTOS</p>
            <span style={{ fontSize: 11.5, color: C.tenue }}>{movs.length ? `${movs.length} en pesos` : ''}</span>
          </div>
          {movs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '26px 8px 18px' }}>
              <Clock size={26} color={C.sub} style={{ margin: '0 auto 10px' }} />
              <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0 }}>Todavía no tienes movimientos</p>
              <p style={{ fontSize: 12.5, color: C.sub, margin: '5px 0 0', lineHeight: 1.5 }}>Cuando una empresa te cargue saldo con tu ID, aparece aquí con su nombre y la fecha.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
              {movs.map((t: any) => {
                const entra = ENTRA.has(String(t.type));
                const rech = t.status === 'Rechazado' || t.status === 'Fallido';
                return (
                  <div key={t.id} className="flex items-center" style={{ gap: 12, padding: '11px 0', borderBottom: `1px solid ${C.borde}` }}>
                    <span style={{ width: 34, height: 34, borderRadius: '50%', background: entra ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {entra ? <ArrowDownLeft size={16} color={C.verde} /> : <ArrowUpRight size={16} color={C.text} />}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || ROTULO[t.type] || t.type}{contraparte(t) && !String(t.title ?? '').includes(contraparte(t)) ? ` · ${contraparte(t)}` : ''}</p>
                      <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fecha(t.createdAt)}{t.note ? ` · ${t.note}` : ''}{t.status && t.status !== 'Completado' ? ` · ${t.status}` : ''}</p>
                    </div>
                    <p style={{ fontSize: 14, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: rech ? C.tenue : entra ? C.verde : C.text, textDecoration: rech ? 'line-through' : 'none' }}>
                      {entra ? '+' : '−'}{fmtCop(Number(t.amount) || 0)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <p style={{ fontSize: 11.5, color: C.tenue, textAlign: 'center', margin: '6px 0 0', lineHeight: 1.5 }}>
          {cu.email}<br />Lincoin no es un banco. El saldo en pesos te lo cargan las empresas con las que trabajas.
        </p>
      </main>
    </div>
  );
};
