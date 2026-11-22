import React, { useState } from 'react';
import { llamarFuncion } from '../lib/edge';

// ─────────────────────────────────────────────────────────────
// Bancos de ACH · Cuenta 1 (Mouv), para el dueño.
//
// Desde el 22 nov los clientes pueden enviar ACH por Mouv. Mouv pide el banco
// por SU id (GET /dictionaries/banks/ach) y los beneficiarios lo guardan por
// nombre, así que el servidor los cruza (_shared/mouv-ach.ts). Esto muestra
// ese cruce, banco por banco, sin mandar plata: si alguno sale sin cruce o
// con un banco que no es, se ve acá antes que en el envío de un cliente. Un
// banco sin cruce no se adivina: el envío por la Cuenta 1 no arranca y el
// cliente lo manda por la Cuenta 2.
// ─────────────────────────────────────────────────────────────

type Cruce = { banco: string; bankId: number | null; bancoMouv: string | null };
type Respuesta = { ok?: boolean; httpStatus?: number; total?: number; sinCruce?: string[]; cruce?: Cruce[]; crudo?: string; error?: string; message?: string };

export const AdminBancosAchMouv: React.FC = () => {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [r, setR] = useState<Respuesta | null>(null);

  const revisar = async () => {
    setAbierto(true); setCargando(true); setR(null);
    try { setR(await llamarFuncion('mouv-proxy', { action: 'mouv_bancos_ach' })); }
    catch (e: any) { setR({ error: 'red', message: String(e?.message ?? e) }); }
    finally { setCargando(false); }
  };

  return (
    <>
      <button type="button" onClick={revisar}
        style={{ marginTop: 4, background: 'transparent', border: 'none', padding: 0, color: '#878E88', fontSize: 10.5, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}>
        Bancos ACH · Cuenta 1
      </button>
      {abierto && (
        <div role="dialog" aria-label="Bancos ACH · Cuenta 1" onClick={() => setAbierto(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', background: '#121413', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: 18, color: '#F4F4F2', fontFamily: 'Archivo, system-ui, sans-serif' }}>
            <div className="flex items-start justify-between" style={{ gap: 12 }}>
              <div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Bancos de ACH · Cuenta 1 (Mouv)</p>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#878E88', lineHeight: 1.45 }}>
                  Con qué banco de Mouv se cruza cada banco de los beneficiarios. Un banco sin cruce no sale por la Cuenta 1 (no se adivina): el cliente lo envía por la Cuenta 2.
                </p>
              </div>
              <button type="button" onClick={() => setAbierto(false)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: '#F4F4F2', borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>Cerrar</button>
            </div>
            {cargando && <p style={{ marginTop: 14, fontSize: 13, color: '#878E88' }}>Consultando el diccionario de bancos…</p>}
            {!cargando && r && (r.error || !r.ok) && (
              <div style={{ marginTop: 14, fontSize: 12.5, color: '#F87171', lineHeight: 1.5 }}>
                {r.message || (r.httpStatus ? `Mouv respondió ${r.httpStatus} al pedir los bancos.` : 'No se pudo leer el diccionario de bancos.')}
                {r.crudo && <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11, color: '#878E88' }}>{r.crudo}</pre>}
              </div>
            )}
            {!cargando && r?.ok && (
              <>
                <p style={{ marginTop: 14, fontSize: 12.5, color: (r.sinCruce?.length ?? 0) > 0 ? '#FBBF24' : '#4ADE80', fontWeight: 600 }}>
                  {r.total} bancos en Mouv · {(r.sinCruce?.length ?? 0) === 0 ? 'todos los bancos cruzan' : `sin cruce: ${r.sinCruce!.join(', ')}`}
                </p>
                <table style={{ width: '100%', marginTop: 10, borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ color: '#878E88', textAlign: 'left' }}>
                      <th style={{ padding: '6px 4px', fontWeight: 600 }}>Banco del beneficiario</th>
                      <th style={{ padding: '6px 4px', fontWeight: 600 }}>Banco en Mouv</th>
                      <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(r.cruce ?? []).map(c => (
                      <tr key={c.banco} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <td style={{ padding: '6px 4px' }}>{c.banco}</td>
                        <td style={{ padding: '6px 4px', color: c.bancoMouv ? '#F4F4F2' : '#FBBF24' }}>{c.bancoMouv ?? 'Sin cruce'}</td>
                        <td style={{ padding: '6px 4px', textAlign: 'right', color: '#878E88', fontVariantNumeric: 'tabular-nums' }}>{c.bankId ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};
