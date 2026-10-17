import React, { useState } from 'react';
import { BellRing, Send } from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// AdminLoginAlerts — el aviso por correo en cada ingreso.
//
// Cada vez que se abre una sesión —de un cliente o del panel— al titular le
// llega un correo con desde dónde se abrió. No impide nada por sí solo: lo
// que hace es que un ingreso ajeno se note el mismo día.
//
// El botón de prueba existe porque un correo que no llega no deja rastro
// visible: sin él, "no me llegó" obliga a adivinar entre media docena de
// causas. Aquí el servidor dice EXACTAMENTE cuál fue, y a qué dirección lo
// mandó — que suele ser el problema.
// ─────────────────────────────────────────────────────────────

const C = {
  card: '#0C0E0D', elev: '#121413',
  border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)',
  green: '#4ADE80', red: '#F87171',
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

export const AdminLoginAlerts: React.FC<{ userId: string }> = ({ userId }) => {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; texto: string } | null>(null);

  const probar = async () => {
    setBusy(true); setRes(null);
    try {
      const r = await fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tokenOf() ?? SKEY}` },
        body: JSON.stringify({ action: 'notify_login', userId, forzar: true }),
      }).then(x => x.json());
      if (r?.enviado) setRes({ ok: true, texto: `Enviado a ${r.destino}. Si no aparece, revisa correo no deseado.` });
      else setRes({ ok: false, texto: `No se envió — ${r?.motivo ?? r?.error ?? 'sin respuesta del servidor'}${r?.destino ? ` (destino: ${r.destino})` : ''}` });
    } catch (e: any) {
      setRes({ ok: false, texto: `No se pudo contactar al servidor: ${e?.message ?? 'error de red'}` });
    }
    setBusy(false);
  };

  return (
    <div style={{ fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16, margin: 0 }}>
            <BellRing size={17} color={C.green} /> Aviso en cada ingreso
          </p>
          <p style={{ color: C.sub, fontSize: 12, margin: '4px 0 0', maxWidth: 560, lineHeight: 1.55 }}>
            Cada vez que se abre una sesión —tuya o de un cliente— le llega un correo al titular
            con la hora, la IP, la ubicación aproximada y el dispositivo. Se manda una vez por
            dispositivo: recargar la página no vuelve a avisar.
          </p>
        </div>
        <button onClick={probar} disabled={busy}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: 'transparent', border: `1px solid ${C.border2}`, color: C.text,
            borderRadius: 999, padding: '8px 15px', fontSize: 12.5, fontWeight: 800,
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap', fontFamily: FONT,
          }}>
          <Send size={13} /> {busy ? 'Enviando…' : 'Enviar una prueba'}
        </button>
      </div>

      {res && (
        <div style={{
          marginTop: 13, background: C.elev,
          border: `1px solid ${res.ok ? 'rgba(74,222,128,0.32)' : 'rgba(248,113,113,0.35)'}`,
          borderRadius: 12, padding: '11px 13px',
          color: res.ok ? C.green : C.red, fontSize: 12.5, lineHeight: 1.5, wordBreak: 'break-word',
        }}>
          {res.texto}
        </div>
      )}

      <p style={{ marginTop: 13, paddingTop: 11, borderTop: `1px solid ${C.border}`, color: C.dim, fontSize: 11, lineHeight: 1.6 }}>
        La prueba se manda a la dirección registrada en la cuenta, que no siempre es la misma con la
        que inicias sesión. Si el destino que aparece arriba no es tu correo real, ese es el problema
        — corrígelo en la ficha de la cuenta.
      </p>
    </div>
  );
};
