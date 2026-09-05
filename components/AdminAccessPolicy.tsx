import React, { useEffect, useState } from 'react';
import { Globe, Plus, X, ShieldCheck } from 'lucide-react';
import { AdminStepUp } from './AdminStepUp';

// ─────────────────────────────────────────────────────────────
// AdminAccessPolicy — lista blanca de acceso al panel.
//
// Deja entrar solo desde los países o las IPs autorizadas. Es la defensa que
// sigue funcionando aunque el atacante tenga la contraseña, el 2FA y los
// códigos de respaldo: si no está en el sitio permitido, no llega ni a la
// pantalla del código.
//
// La pantalla muestra SIEMPRE la IP y el país desde donde se está mirando, y
// el servidor se agrega solo la conexión actual al encender. Encender un
// candado desde afuera de la puerta es la forma más rápida de quedarse sin
// panel, y eso ya pasó suficientes veces hoy.
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

const PAISES: Array<[string, string]> = [
  ['CO', 'Colombia'], ['MX', 'México'], ['PE', 'Perú'], ['CL', 'Chile'],
  ['AR', 'Argentina'], ['BR', 'Brasil'], ['EC', 'Ecuador'], ['US', 'Estados Unidos'], ['ES', 'España'],
];

export const AdminAccessPolicy: React.FC<{ userId?: string }> = ({ userId }) => {
  const [pol, setPol] = useState<{ enabled: boolean; countries: string[]; ips: string[] } | null>(null);
  // Bajar la guardia —apagar el candado, quitar un país o una IP— exige
  // verificarse de nuevo. Subirla no pide nada.
  const [pidiendo, setPidiendo] = useState<null | (() => void)>(null);
  const [tuIp, setTuIp] = useState<string | null>(null);
  const [tuPais, setTuPais] = useState<string | null>(null);
  const [tuUbi, setTuUbi] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nuevaIp, setNuevaIp] = useState('');

  const cargar = async () => {
    const d = await call({ action: 'access_policy_get' }).catch(() => null);
    if (d?.ok) { setPol(d.policy); setTuIp(d.tuIp); setTuPais(d.tuPais); setTuUbi(d.tuUbicacion); }
    else setMsg(d?.error ?? 'No se pudo leer la política de acceso.');
  };
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const guardar = async (next: typeof pol) => {
    if (!next) return;
    setBusy(true); setMsg(null);
    const d = await call({ action: 'access_policy_set', policy: next }).catch(() => null);
    if (d?.stepUp) { setBusy(false); setPidiendo(() => () => guardar(next)); return; }
    if (d?.ok) { setPol(d.policy); setMsg('Guardado.'); }
    else setMsg(d?.error ?? 'No se pudo guardar.');
    setBusy(false);
  };

  if (pidiendo && userId) {
    return (
      <AdminStepUp
        userId={userId}
        motivo="Para bajar esta protección"
        sinPasskey
        onCancelar={() => { setPidiendo(null); cargar(); }}
        onListo={() => { const seguir = pidiendo; setPidiendo(null); seguir(); }}
      />
    );
  }

  if (!pol) {
    return (
      <div style={{ fontFamily: FONT, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18, color: C.sub, fontSize: 13 }}>
        {msg ?? 'Cargando política de acceso…'}
      </div>
    );
  }

  const cubierto = !!(tuIp && (pol.ips.includes(tuIp) || (tuPais && pol.countries.includes(tuPais))));

  return (
    <div style={{ fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16, margin: 0 }}>
            <Globe size={17} color={pol.enabled ? C.green : C.sub} /> Desde dónde se puede entrar
          </p>
          <p style={{ color: C.sub, fontSize: 12, margin: '4px 0 0', maxWidth: 560, lineHeight: 1.5 }}>
            Con esto encendido, el panel solo abre desde los países o las IPs de la lista.
            Sigue funcionando aunque alguien tenga tu contraseña, tu 2FA y tus códigos de respaldo.
          </p>
        </div>
        <button
          onClick={() => guardar({ ...pol, enabled: !pol.enabled })}
          disabled={busy}
          style={{
            background: pol.enabled ? 'rgba(74,222,128,0.14)' : 'transparent',
            border: `1px solid ${pol.enabled ? C.green : C.border2}`,
            color: pol.enabled ? C.green : C.sub,
            borderRadius: 999, padding: '8px 16px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
          {pol.enabled ? '● Encendida' : '○ Apagada'}
        </button>
      </div>

      {/* Desde dónde estás mirando ahora mismo */}
      <div style={{ marginTop: 14, background: C.elev, border: `1px solid ${cubierto || !pol.enabled ? C.border : 'rgba(251,191,36,0.35)'}`, borderRadius: 12, padding: '12px 14px' }}>
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: C.sub, margin: '0 0 6px' }}>ESTA CONEXIÓN</p>
        <p style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, margin: 0, color: C.text }}>
          {tuIp ?? 'IP no detectada'} <span style={{ color: C.dim }}>· {tuUbi ?? 'ubicación no disponible'}</span>
        </p>
        {pol.enabled && (
          <p style={{ fontSize: 11.5, margin: '6px 0 0', color: cubierto ? C.green : C.amber }}>
            {cubierto ? '✓ Tu conexión está permitida.' : '⚠ Tu conexión NO está en la lista. Agrégala antes de cerrar sesión.'}
          </p>
        )}
      </div>

      {/* Países */}
      <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: C.sub, margin: '16px 0 8px' }}>PAÍSES PERMITIDOS</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {PAISES.map(([cc, nombre]) => {
          const on = pol.countries.includes(cc);
          return (
            <button key={cc} disabled={busy}
              onClick={() => guardar({ ...pol, countries: on ? pol.countries.filter(c => c !== cc) : [...pol.countries, cc] })}
              style={{
                background: on ? 'rgba(74,222,128,0.12)' : C.elev,
                border: `1px solid ${on ? 'rgba(74,222,128,0.32)' : C.border}`,
                color: on ? C.green : C.sub,
                borderRadius: 8, padding: '6px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
              {on ? '✓ ' : ''}{nombre}
            </button>
          );
        })}
      </div>

      {/* IPs sueltas */}
      <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: C.sub, margin: '16px 0 8px' }}>IPS AUTORIZADAS</p>
      {pol.ips.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 9 }}>
          {pol.ips.map(ip => (
            <div key={ip} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: C.elev, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 11px' }}>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }}>
                {ip}{ip === tuIp && <span style={{ color: C.green, fontSize: 11 }}> · esta conexión</span>}
              </span>
              <button onClick={() => guardar({ ...pol, ips: pol.ips.filter(x => x !== ip) })} disabled={busy}
                style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', display: 'flex' }}><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <input value={nuevaIp} onChange={e => setNuevaIp(e.target.value.trim())} placeholder="190.0.0.0"
          style={{ flex: 1, minWidth: 160, background: C.elev, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '8px 11px', fontSize: 12.5, fontFamily: 'ui-monospace, Menlo, monospace', outline: 'none' }} />
        <button disabled={busy || !nuevaIp} onClick={() => { guardar({ ...pol, ips: [...pol.ips, nuevaIp] }); setNuevaIp(''); }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${C.border2}`, color: C.text, borderRadius: 8, padding: '8px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={13} /> Agregar
        </button>
        {tuIp && !pol.ips.includes(tuIp) && (
          <button disabled={busy} onClick={() => guardar({ ...pol, ips: [tuIp, ...pol.ips] })}
            style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.32)', color: C.green, borderRadius: 8, padding: '8px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Agregar esta conexión
          </button>
        )}
      </div>

      {msg && <p style={{ marginTop: 12, fontSize: 12, color: msg === 'Guardado.' ? C.green : C.red }}>{msg}</p>}

      <p style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}`, color: C.dim, fontSize: 11, lineHeight: 1.55 }}>
        <ShieldCheck size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Si viajas, agrega la IP nueva ANTES de moverte, o quedarás fuera. Salida de emergencia por SQL:
          <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: C.sub }}> delete from system_config where key = 'admin_access_policy';</span>
        </span>
      </p>
    </div>
  );
};
