import React, { useState } from 'react';
import { ScanLine, AlertTriangle, CheckCircle2, Wrench } from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// AdminReconcile — envíos que salieron pero no dejaron movimiento.
//
// Ya pasó una vez: un cliente hizo una transferencia real, el dinero salió, y
// en su historial no aparecía nada. Se supo porque el cliente reclamó — que es
// la peor forma de enterarse.
//
// Cada dispersión deja DOS rastros: la fila en transactions (lo que ve el
// cliente) y la entrada en la auditoría. Esta tarjeta cruza los dos y muestra
// los envíos que solo dejaron uno. Si aparece algo acá, se reconstruye la fila
// desde la auditoría.
//
// La causa de raíz ya está corregida en el servidor. Esto es la red: sirve
// para los huecos viejos y para enterarse antes que el cliente si algo vuelve
// a fallar.
// ─────────────────────────────────────────────────────────────

const C = {
  card: '#0C0E0D', elev: '#121413',
  border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)',
  green: '#4ADE80', amber: '#FBBF24', red: '#F87171',
};
const FONT = 'Archivo, system-ui, sans-serif';

const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
const tokenOf = () => {
  try {
    const k = Object.keys(localStorage).find(x => x.startsWith('sb-') && x.endsWith('-auth-token'));
    if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) return d.access_token as string; }
  } catch { /* */ }
  return null;
};
const call = async (body: any) => {
  const r = await fetch(`${SURL}/functions/v1/admin-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tokenOf() ?? SKEY}` },
    body: JSON.stringify(body),
  });
  return r.json();
};

const cop = (n: number) => `$${Number(n || 0).toLocaleString('es-CO')}`;

export const AdminReconcile: React.FC = () => {
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const revisar = async (reparar = false) => {
    setBusy(true); setMsg(null);
    const d = await call({ action: 'conciliar_movimientos', dias: 30, ...(reparar ? { reparar: true } : {}) }).catch(() => null);
    if (!d?.ok) { setMsg(d?.error ?? 'No se pudo revisar.'); setBusy(false); return; }
    if (reparar) {
      setMsg(`Se reconstruyeron ${d.creados} de ${d.total} movimientos.`);
      const otra = await call({ action: 'conciliar_movimientos', dias: 30 }).catch(() => null);
      setRes(otra?.ok ? otra : null);
    } else {
      setRes(d);
    }
    setBusy(false);
  };

  const huerfanos: any[] = res?.huerfanos ?? [];

  return (
    <div style={{ fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16, margin: 0 }}>
            <ScanLine size={17} color={C.sub} /> Envíos sin movimiento
          </p>
          <p style={{ color: C.sub, fontSize: 12, margin: '4px 0 0', maxWidth: 600, lineHeight: 1.55 }}>
            Cruza los envíos registrados en la auditoría contra los movimientos que ve el cliente.
            Si alguno salió pero no dejó fila, aparece acá — y se puede reconstruir.
            Revisa los últimos 30 días.
          </p>
        </div>
        <button onClick={() => revisar(false)} disabled={busy}
          style={{
            background: 'transparent', border: `1px solid ${C.border2}`, color: C.text,
            borderRadius: 999, padding: '8px 16px', fontSize: 12.5, fontWeight: 800,
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap', fontFamily: FONT,
          }}>
          {busy ? 'Revisando…' : 'Revisar ahora'}
        </button>
      </div>

      {res && (
        <div style={{
          marginTop: 14, background: C.elev,
          border: `1px solid ${huerfanos.length ? 'rgba(248,113,113,0.35)' : 'rgba(74,222,128,0.28)'}`,
          borderRadius: 12, padding: '12px 14px',
        }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, margin: 0, color: huerfanos.length ? C.red : C.green }}>
            {huerfanos.length ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
            {huerfanos.length
              ? `${res.total} envío${res.total === 1 ? '' : 's'} sin movimiento`
              : 'Todo cuadra — cada envío tiene su movimiento'}
          </p>
          <p style={{ color: C.dim, fontSize: 11.5, margin: '5px 0 0' }}>
            Se revisaron {res.revisados} envíos de los últimos {res.dias} días.
          </p>
        </div>
      )}

      {huerfanos.length > 0 && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            {huerfanos.slice(0, 15).map((h: any) => (
              <div key={h.auditId} style={{ background: C.elev, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>
                    {cop(h.amount)} <span style={{ color: C.dim, fontWeight: 500 }}>· {h.railCol === 'COP_BREB' ? 'Bre-B' : 'ACH'}</span>
                  </span>
                  <span style={{ fontSize: 11, color: C.dim }}>
                    {new Date(h.at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
                <p style={{ fontSize: 11, color: C.dim, margin: '4px 0 0', fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-all' }}>
                  {h.recipient?.holderName ? `${h.recipient.holderName} · ` : ''}usuario {String(h.userId).slice(0, 8)}…
                  {h.providerRef ? ` · ref ${h.providerRef}` : ' · sin referencia del proveedor'}
                </p>
              </div>
            ))}
            {huerfanos.length > 15 && (
              <p style={{ color: C.dim, fontSize: 11.5, margin: '2px 0 0' }}>y {huerfanos.length - 15} más…</p>
            )}
          </div>

          <button onClick={() => revisar(true)} disabled={busy}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, marginTop: 13,
              background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.32)',
              color: C.green, borderRadius: 10, padding: '10px 17px', fontSize: 13, fontWeight: 800,
              cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, fontFamily: FONT,
            }}>
            <Wrench size={14} /> Reconstruir los movimientos que faltan
          </button>
          <p style={{ color: C.dim, fontSize: 11, margin: '8px 0 0', lineHeight: 1.55 }}>
            Las filas reconstruidas quedan marcadas como tales, con el id de la entrada de auditoría
            de la que salieron — para que nadie las confunda con un registro de primera mano.
          </p>
        </>
      )}

      {msg && <p style={{ marginTop: 12, fontSize: 12.5, color: C.green }}>{msg}</p>}
    </div>
  );
};
