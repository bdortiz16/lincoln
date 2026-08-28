import React, { useMemo, useState } from 'react';
import { Zap, Landmark, ArrowRight, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

// Dispersión Colombia (Bre-B / ACH) vía Mouv. El cliente dispersa SOLO
// contra el saldo interno que el admin le cargó en este riel — nunca ve ni
// toca el total de la wallet compartida de Mouv. Todo el asentamiento
// (validar saldo, debitar, llamar a Mouv, reintegrar si falla) lo hace el
// edge `mouv-proxy`; aquí solo se arma la orden y se muestra el resultado.

type Rail = 'COP_BREB' | 'COP_ACH';

interface Props {
  userId: string;
  rail: Rail;
  balance: number;
  authHeader: () => string;
  onDone?: () => void;
}

const BREB_KEY_TYPES = [
  { value: 'celular', label: 'Celular' },
  { value: 'cedula', label: 'Cédula' },
  { value: 'correo', label: 'Correo' },
  { value: 'alfanumerico', label: 'Llave alfanumérica' },
];

const ACH_ACCOUNT_TYPES = [
  { value: 'ahorros', label: 'Ahorros' },
  { value: 'corriente', label: 'Corriente' },
  { value: 'deposito', label: 'Depósito de bajo monto' },
];

const ACH_DOC_TYPES = ['CC', 'CE', 'NIT', 'PP', 'TI'];

const COLOMBIAN_BANKS = [
  'Bancolombia', 'Davivienda', 'Banco de Bogotá', 'BBVA Colombia', 'Banco de Occidente',
  'Banco Popular', 'Banco Caja Social', 'Scotiabank Colpatria', 'Banco Agrario', 'Banco AV Villas',
  'Itaú', 'Banco Falabella', 'Banco Pichincha', 'Nequi', 'Daviplata', 'Lulo Bank', 'Nu',
  'Movii', 'Banco Serfinanza', 'Bancoomeva', 'Coltefinanciera',
];

const fmt = (n: number) => Math.round(n).toLocaleString('es-CO');

export const MouvDispersion: React.FC<Props> = ({ userId, rail, balance, authHeader, onDone }) => {
  const isBreb = rail === 'COP_BREB';
  const railName = isBreb ? 'Bre-B' : 'ACH';

  const [amount, setAmount] = useState('');
  // Bre-B
  const [keyType, setKeyType] = useState('celular');
  const [keyValue, setKeyValue] = useState('');
  // ACH
  const [bank, setBank] = useState('');
  const [accountType, setAccountType] = useState('ahorros');
  const [accountNumber, setAccountNumber] = useState('');
  const [docType, setDocType] = useState('CC');
  const [docNumber, setDocNumber] = useState('');
  const [holderName, setHolderName] = useState('');
  const [reference, setReference] = useState('');

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'pending' | 'error'; text: string } | null>(null);

  const amt = useMemo(() => parseFloat((amount || '').replace(/[^\d.]/g, '')) || 0, [amount]);
  const overBalance = amt > balance;
  const recipientReady = isBreb
    ? keyValue.trim().length > 2
    : (bank.trim() && accountNumber.trim() && docNumber.trim() && holderName.trim());
  const canSubmit = amt > 0 && !overBalance && recipientReady && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setResult(null);
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      const recipient = isBreb
        ? { keyType, key: keyValue.trim(), holderName: holderName.trim() || undefined, reference: reference.trim() || undefined }
        : {
            bankCode: bank.trim(), accountType, accountNumber: accountNumber.trim(),
            documentType: docType, documentNumber: docNumber.trim(), holderName: holderName.trim(),
            reference: reference.trim() || undefined,
          };
      const r = await fetch(`${SURL}/functions/v1/mouv-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: authHeader() },
        body: JSON.stringify({ action: isBreb ? 'payout_breb' : 'payout_ach', userId, amount: amt, recipient }),
      });
      const d = await r.json();
      if (d?.ok) {
        setResult({ kind: 'ok', text: `Dispersión enviada por ${railName}. ${d.providerRef ? `Ref: ${d.providerRef}` : ''}` });
        setAmount(''); setKeyValue(''); setAccountNumber(''); setDocNumber(''); setHolderName(''); setReference('');
        onDone?.();
      } else if (d?.error === 'not_implemented') {
        setResult({ kind: 'pending', text: d.message || 'La dispersión con Mouv aún no está activa. Tu saldo no fue afectado.' });
      } else {
        setResult({ kind: 'error', text: d?.message || 'No se pudo completar la dispersión.' });
        if (d?.refunded) onDone?.();
      }
    } catch (e: any) {
      setResult({ kind: 'error', text: e?.message ?? 'Error de red.' });
    }
    setBusy(false);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', background: '#0A0C0B', border: '1px solid rgba(255,255,255,0.11)', borderRadius: 10,
    color: '#F4F4F2', fontSize: 14, padding: '11px 13px', outline: 'none', fontFamily: 'inherit',
  };
  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#878E88', display: 'block', marginBottom: 6 };

  return (
    <div style={{ maxWidth: 620, margin: '8px auto 40px', fontFamily: "'Archivo', system-ui, sans-serif" }}>
      {/* Cabecera del riel + saldo disponible (solo el interno del cliente) */}
      <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 18, padding: '22px 24px', marginBottom: 16 }}>
        <div className="flex items-center gap-3">
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.30)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            {isBreb ? <Zap size={20} style={{ color: '#4ADE80' }} /> : <Landmark size={20} style={{ color: '#4ADE80' }} />}
          </div>
          <div>
            <h3 style={{ color: '#F4F4F2', fontWeight: 800, fontSize: 19, letterSpacing: '-0.4px' }}>Dispersar por {railName}</h3>
            <p style={{ color: '#878E88', fontSize: 12.5 }}>{isBreb ? 'Envío inmediato 24/7 a una llave Bre-B' : 'Transferencia interbancaria a una cuenta en Colombia'}</p>
          </div>
        </div>
        <div style={{ marginTop: 16, padding: '13px 16px', background: '#0A0C0B', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ color: '#878E88', fontSize: 12.5 }}>Disponible en este riel</span>
          <span style={{ color: '#F4F4F2', fontWeight: 800, fontSize: 20, letterSpacing: '-0.5px' }}>{fmt(balance)} <span style={{ fontSize: 12, color: '#878E88', fontWeight: 600 }}>COP</span></span>
        </div>
      </div>

      {/* Formulario del destinatario */}
      <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 18, padding: '22px 24px' }}>
        {isBreb ? (
          <div className="grid gap-4">
            <div>
              <label style={labelStyle}>Tipo de llave</label>
              <div className="grid grid-cols-4 gap-2">
                {BREB_KEY_TYPES.map(k => (
                  <button key={k.value} onClick={() => setKeyType(k.value)}
                    style={{ padding: '9px 6px', borderRadius: 9, fontSize: 12, fontWeight: 600,
                      border: keyType === k.value ? '1px solid rgba(74,222,128,0.5)' : '1px solid rgba(255,255,255,0.11)',
                      background: keyType === k.value ? 'rgba(74,222,128,0.10)' : '#0A0C0B',
                      color: keyType === k.value ? '#4ADE80' : '#F4F4F2' }}>
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={labelStyle}>Llave Bre-B</label>
              <input value={keyValue} onChange={e => setKeyValue(e.target.value)} placeholder="Número, correo o llave" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Nombre del titular (opcional)</label>
              <input value={holderName} onChange={e => setHolderName(e.target.value)} placeholder="Para tu referencia" style={inputStyle} />
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <div>
              <label style={labelStyle}>Banco</label>
              <input list="mouv-banks" value={bank} onChange={e => setBank(e.target.value)} placeholder="Selecciona o escribe el banco" style={inputStyle} />
              <datalist id="mouv-banks">{COLOMBIAN_BANKS.map(b => <option key={b} value={b} />)}</datalist>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label style={labelStyle}>Tipo de cuenta</label>
                <select value={accountType} onChange={e => setAccountType(e.target.value)} style={inputStyle}>
                  {ACH_ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Número de cuenta</label>
                <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="0000000000" style={inputStyle} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label style={labelStyle}>Documento</label>
                <select value={docType} onChange={e => setDocType(e.target.value)} style={inputStyle}>
                  {ACH_DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={labelStyle}>Número de documento</label>
                <input value={docNumber} onChange={e => setDocNumber(e.target.value)} placeholder="Cédula / NIT del titular" style={inputStyle} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Nombre del titular</label>
              <input value={holderName} onChange={e => setHolderName(e.target.value)} placeholder="Como aparece en el banco" style={inputStyle} />
            </div>
          </div>
        )}

        {/* Monto */}
        <div style={{ marginTop: 16 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Monto a dispersar (COP)</label>
            <button onClick={() => setAmount(String(Math.floor(balance)))} style={{ fontSize: 11.5, fontWeight: 600, color: '#4ADE80' }}>Usar todo</button>
          </div>
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0"
            style={{ ...inputStyle, fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', borderColor: overBalance ? 'rgba(248,113,113,0.6)' : 'rgba(255,255,255,0.11)' }} />
          {overBalance && <p style={{ color: '#F87171', fontSize: 12, marginTop: 6 }}>Supera tu saldo disponible ({fmt(balance)} COP).</p>}
        </div>

        {/* Referencia */}
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Referencia (opcional)</label>
          <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Concepto del pago" style={inputStyle} />
        </div>

        {/* Resultado */}
        {result && (
          <div style={{ marginTop: 16, padding: '13px 15px', borderRadius: 12, display: 'flex', gap: 10, alignItems: 'flex-start',
            background: result.kind === 'ok' ? 'rgba(74,222,128,0.10)' : result.kind === 'pending' ? 'rgba(255,255,255,0.05)' : 'rgba(248,113,113,0.10)',
            border: `1px solid ${result.kind === 'ok' ? 'rgba(74,222,128,0.3)' : result.kind === 'pending' ? 'rgba(255,255,255,0.14)' : 'rgba(248,113,113,0.3)'}` }}>
            {result.kind === 'ok' ? <CheckCircle2 size={17} style={{ color: '#4ADE80', flexShrink: 0, marginTop: 1 }} />
              : <AlertTriangle size={17} style={{ color: result.kind === 'pending' ? '#878E88' : '#F87171', flexShrink: 0, marginTop: 1 }} />}
            <span style={{ fontSize: 13, color: '#F4F4F2', lineHeight: 1.45 }}>{result.text}</span>
          </div>
        )}

        {/* CTA */}
        <button onClick={submit} disabled={!canSubmit}
          style={{ marginTop: 18, width: '100%', padding: '13px', borderRadius: 12, fontSize: 14.5, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: canSubmit ? '#4ADE80' : 'rgba(255,255,255,0.07)',
            color: canSubmit ? '#0A0C0B' : '#878E88', cursor: canSubmit ? 'pointer' : 'not-allowed',
            border: '1px solid ' + (canSubmit ? '#4ADE80' : 'rgba(255,255,255,0.11)'), transition: 'all .15s' }}>
          {busy ? <><Loader2 size={17} className="animate-spin" /> Enviando…</> : <>Dispersar {amt > 0 ? `${fmt(amt)} COP` : ''} <ArrowRight size={16} /></>}
        </button>
        <p style={{ marginTop: 10, fontSize: 11.5, color: 'rgba(244,244,242,0.45)', textAlign: 'center', lineHeight: 1.5 }}>
          Se descuenta de tu saldo {railName}. Si la dispersión no se completa, el saldo se devuelve automáticamente.
        </p>
      </div>
    </div>
  );
};
