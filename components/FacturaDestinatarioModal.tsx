import React, { useEffect, useState } from 'react';
import { useFacturacion } from '../lib/facturacionEmpresa';

// ── PSP / pasarela con beneficiario EMPRESA: ¿a quién va la factura? ──────
// Decisión del dueño (26 nov): cuando la plata va a una persona jurídica, la
// factura no sale sola. La empresa que recibió puede ser la titular del
// negocio o estar recibiendo por cuenta de otro (el mandante), y eso solo lo
// sabe el cliente. Esta ventana lo pregunta:
//   · Titular  → la factura va a la empresa que recibió.
//   · Mandante → va a quien se registra acá (nombre, tipo y número de
//                documento), y queda registrado que la plata se le transfirió
//                a la empresa.
// El servidor (facturacion · factura_destinatario) valida, guarda la
// decisión con quién la tomó y emite enseguida.

const FONT = 'Archivo, system-ui, sans-serif';
const C = {
  tarjeta: '#0C0E0D', borde: 'rgba(255,255,255,0.08)', text: '#F4F4F2', sub: '#878E88',
  tenue: 'rgba(244,244,242,0.45)', verde: '#4ADE80', rojo: '#F87171',
};
const CAMPO: React.CSSProperties = { fontFamily: FONT, width: '100%', fontSize: 13.5, color: C.text, background: '#121413', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '9px 11px', outline: 'none' };
// Los mismos tipos que acepta el servidor (TIPOS_MANDANTE).
const TIPOS: { v: string; t: string; ph: string }[] = [
  { v: 'NIT', t: 'NIT', ph: '9 dígitos (sin el de verificación)' },
  { v: 'CC', t: 'Cédula de ciudadanía', ph: 'Número de cédula' },
  { v: 'CE', t: 'Cédula de extranjería', ph: 'Número de cédula de extranjería' },
  { v: 'PPT', t: 'Permiso por protección temporal', ph: 'Número del PPT' },
];

type Titular = { nombre: string; documento: string; esEmpresa?: boolean };

const FacturaDestinatarioModal: React.FC<{
  transactionId: string;
  // Lo que ya se sabe del movimiento (para no esperar la consulta).
  titularInicial?: Titular | null;
  resumen?: string;
  onCerrar: () => void;
  onListo: (r: any) => void;
}> = ({ transactionId, titularInicial = null, resumen, onCerrar, onListo }) => {
  const fact = useFacturacion();
  const [titular, setTitular] = useState<Titular | null>(titularInicial);
  const [destino, setDestino] = useState<'titular' | 'mandante' | null>(null);
  const [nombre, setNombre] = useState('');
  const [tipoDoc, setTipoDoc] = useState('NIT');
  const [numero, setNumero] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El titular según el servidor (la misma lectura con que factura).
  useEffect(() => {
    let vivo = true;
    fact({ action: 'documento', transactionId }, 30000).then((r: any) => {
      if (!vivo || !r?.ok) return;
      const t = r.documento?.titular;
      if (t?.documento) setTitular({ nombre: String(t.nombre ?? ''), documento: String(t.documento), esEmpresa: !!t.esEmpresa });
    }).catch(() => {});
    return () => { vivo = false; };
  }, [transactionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const numLimpio = numero.replace(/[\s.\-]/g, '');
  const listoMandante = nombre.trim().length >= 3 && /^\d+$/.test(numLimpio) && numLimpio.length >= 4;
  const puede = !enviando && (destino === 'titular' || (destino === 'mandante' && listoMandante));

  const confirmar = async () => {
    if (!puede) return;
    setEnviando(true); setError(null);
    const r = await fact({
      action: 'factura_destinatario', transactionId, destino,
      ...(destino === 'mandante' ? { mandante: { nombre: nombre.trim(), tipoDoc, numero: numLimpio } } : {}),
    }, 130000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setEnviando(false);
    if (!r?.ok) { setError(String(r?.error ?? 'No se pudo emitir la factura.')); return; }
    onListo(r);
  };

  const opcion = (v: 'titular' | 'mandante', titulo: string, texto: React.ReactNode) => {
    const activa = destino === v;
    return (
      <button type="button" onClick={() => { setDestino(v); setError(null); }}
        style={{ fontFamily: FONT, textAlign: 'left', width: '100%', display: 'flex', gap: 11, alignItems: 'flex-start', padding: '13px 14px', borderRadius: 12, cursor: 'pointer',
          background: activa ? 'rgba(74,222,128,0.06)' : 'transparent', border: `1px solid ${activa ? 'rgba(74,222,128,0.45)' : C.borde}` }}>
        <span style={{ flexShrink: 0, marginTop: 2, width: 15, height: 15, borderRadius: 999, border: `2px solid ${activa ? C.verde : 'rgba(255,255,255,0.3)'}`, display: 'grid', placeItems: 'center' }}>
          {activa && <span style={{ width: 7, height: 7, borderRadius: 999, background: C.verde }} />}
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: C.text }}>{titulo}</span>
          <span style={{ display: 'block', fontSize: 12, color: C.sub, lineHeight: 1.5, marginTop: 3 }}>{texto}</span>
        </span>
      </button>
    );
  };

  const nombreTitular = titular?.nombre || 'la empresa que recibió';
  const docTitular = titular?.documento ? ` · NIT ${titular.documento}` : '';
  const tipoSel = TIPOS.find(t => t.v === tipoDoc) ?? TIPOS[0];

  return (
    <div className="fixed inset-0 z-[120] p-4" style={{ background: 'rgba(4,5,4,0.85)', display: 'grid', placeItems: 'center' }} onClick={enviando ? undefined : onCerrar}>
      <div role="dialog" aria-modal="true" aria-label="A quién va la factura" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto', background: C.tarjeta, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, fontFamily: FONT, padding: '20px 22px' }}>
        <div className="flex items-start justify-between" style={{ gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0 }}>¿A quién va la factura?</p>
            {resumen && <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0' }}>{resumen}</p>}
          </div>
          <button onClick={onCerrar} disabled={enviando} aria-label="Cerrar" style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.borde}`, background: 'transparent', color: C.sub, fontSize: 16, cursor: 'pointer' }}>×</button>
        </div>

        <p style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.55, margin: '14px 0 14px' }}>
          La plata se le transfirió a una empresa. Elige si la factura es para esa empresa o para la persona o empresa por cuenta de quien la recibió.
        </p>

        <div className="flex flex-col" style={{ gap: 8 }}>
          {opcion('titular', 'Titular', <>La factura va a <b style={{ color: C.text }}>{nombreTitular}</b>{docTitular}, la empresa que recibió la plata.</>)}
          {opcion('mandante', 'Mandante', <>La factura va a quien registres. Queda registrado que la plata se le transfirió a <b style={{ color: C.text }}>{nombreTitular}</b>{docTitular}.</>)}
        </div>

        {destino === 'mandante' && (
          <div style={{ marginTop: 14 }}>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '0 0 6px' }}>DATOS DEL MANDANTE</p>
            <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre completo o razón social" maxLength={150} style={CAMPO} autoFocus />
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 8, marginTop: 8 }}>
              <select value={tipoDoc} onChange={e => setTipoDoc(e.target.value)} style={{ ...CAMPO, appearance: 'auto' }} aria-label="Tipo de documento">
                {TIPOS.map(t => <option key={t.v} value={t.v}>{t.t}</option>)}
              </select>
              <input value={numero} onChange={e => setNumero(e.target.value)} placeholder={tipoSel.ph} inputMode="numeric" maxLength={20} style={CAMPO} aria-label="Número de documento" />
            </div>
            <p style={{ fontSize: 11.5, color: C.tenue, lineHeight: 1.5, margin: '8px 0 0' }}>
              Si no existe en tu Siigo, se crea al emitir. {tipoDoc === 'NIT' ? 'Si es persona jurídica, la comisión lleva la retención en la fuente que corresponda.' : ''}
            </p>
          </div>
        )}

        {error && <p role="alert" style={{ fontSize: 12, color: C.rojo, lineHeight: 1.5, margin: '12px 0 0' }}>{error}</p>}

        <div className="flex" style={{ gap: 8, marginTop: 18 }}>
          <button onClick={onCerrar} disabled={enviando}
            style={{ flex: 1, fontFamily: FONT, fontSize: 13, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 10, padding: '11px 0', cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={confirmar} disabled={!puede}
            style={{ flex: 2, fontFamily: FONT, fontSize: 13, fontWeight: 800, color: '#0C0E0D', background: puede ? '#F4F4F2' : 'rgba(244,244,242,0.35)', border: 'none', borderRadius: 10, padding: '11px 0', cursor: puede ? 'pointer' : 'default' }}>
            {enviando ? 'Emitiendo en Siigo…' : 'Emitir factura'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FacturaDestinatarioModal;
