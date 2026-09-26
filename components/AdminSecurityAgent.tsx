import React, { useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2 } from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// AdminSecurityAgent — auditor de seguridad del panel.
//
// Qué ES: corre chequeos REALES contra el estado vivo (triggers de la base,
// RLS, 2FA de cada admin, secretos ilegibles, correos duplicados, presión de
// intentos de ingreso, wallet del proveedor fijada) y lista lo que está
// flojo, con severidad y cómo arreglarlo.
//
// Qué NO es: un escudo. Nada de esto impide un ataque por sí solo; lo que
// hace es que ningún hueco conocido pase inadvertido. Decirlo así importa:
// un panel que promete "protegido" invita a dejar de mirar.
//
// Paleta oficial Lincoin (CLAUDE.md).
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

type Sev = 'critica' | 'alta' | 'media' | 'baja';
type Finding = { id: string; sev: Sev; title: string; detail: string; fix: string; count?: number };

const SEV: Record<Sev, { label: string; color: string; bg: string }> = {
  critica: { label: 'CRÍTICA', color: C.red, bg: 'rgba(248,113,113,0.12)' },
  alta: { label: 'ALTA', color: '#FB923C', bg: 'rgba(251,146,60,0.12)' },
  media: { label: 'MEDIA', color: C.amber, bg: 'rgba(251,191,36,0.12)' },
  baja: { label: 'BAJA', color: C.sub, bg: 'rgba(255,255,255,0.05)' },
};

export const AdminSecurityAgent: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tokenOf() ?? SKEY}` },
        body: JSON.stringify({ action: 'security_audit' }),
      });
      const d = await r.json();
      if (d?.ok) setData(d);
      else setErr(d?.error ?? 'No se pudo completar la auditoría.');
    } catch { setErr('No se pudo conectar para auditar.'); }
    setBusy(false);
  };
  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const findings: Finding[] = data?.findings ?? [];
  const score: number = data?.score ?? 0;
  const criticas = findings.filter(f => f.sev === 'critica').length;
  const scoreColor = criticas > 0 ? C.red : score >= 85 ? C.green : score >= 60 ? C.amber : C.red;

  return (
    <div style={{ fontFamily: FONT, color: C.text, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16, margin: 0 }}>
            <ShieldCheck size={17} color={C.green} /> Agente de seguridad
          </p>
          <p style={{ color: C.sub, fontSize: 12, margin: '4px 0 0', maxWidth: 560, lineHeight: 1.5 }}>
            Revisa el estado real del sistema y lista lo que está flojo. No bloquea ataques por sí mismo —
            sirve para que ningún hueco conocido pase inadvertido.
          </p>
        </div>
        <button onClick={run} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: `1px solid ${C.green}`, color: C.green, borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> {busy ? 'Auditando…' : 'Auditar ahora'}
        </button>
      </div>

      {err && (
        <p style={{ marginTop: 12, color: C.red, fontSize: 12.5, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.28)', borderRadius: 10, padding: '9px 12px' }}>{err}</p>
      )}

      {data && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16, padding: '14px 16px', background: C.elev, border: `1px solid ${C.border}`, borderRadius: 12, flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontSize: 32, fontWeight: 800, margin: 0, color: scoreColor, fontVariantNumeric: 'tabular-nums' }}>{score}<span style={{ fontSize: 15, color: C.dim }}>/100</span></p>
              <p style={{ color: C.sub, fontSize: 11, margin: 0 }}>Puntaje de postura</p>
            </div>
            <div style={{ flex: 1, minWidth: 190 }}>
              {findings.length === 0 ? (
                <p style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, margin: 0, color: C.green, fontWeight: 700 }}>
                  <CheckCircle2 size={15} /> Sin hallazgos. Todos los chequeos pasaron.
                </p>
              ) : (
                <>
                  <p style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, margin: 0, fontWeight: 700, color: criticas ? C.red : C.amber }}>
                    <AlertTriangle size={15} /> {findings.length} hallazgo{findings.length === 1 ? '' : 's'}
                    {criticas > 0 && ` · ${criticas} crítico${criticas === 1 ? '' : 's'}`}
                  </p>
                  <p style={{ color: C.sub, fontSize: 11.5, margin: '3px 0 0' }}>
                    {criticas > 0 ? 'Atiende primero los críticos: son huecos por los que se saca dinero o se entra al panel.' : 'Nada crítico. Vale la pena cerrar el resto igual.'}
                  </p>
                </>
              )}
            </div>
            <p style={{ color: C.dim, fontSize: 10.5, margin: 0, whiteSpace: 'nowrap' }}>
              {data.checkedAt ? new Date(data.checkedAt).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {findings.map(f => {
              const s = SEV[f.sev];
              const isOpen = open === f.id;
              return (
                <div key={f.id} style={{ background: C.elev, border: `1px solid ${isOpen ? s.color : C.border}`, borderRadius: 11, overflow: 'hidden' }}>
                  <button onClick={() => setOpen(isOpen ? null : f.id)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', background: 'none', border: 'none', padding: '11px 13px', cursor: 'pointer', color: C.text }}>
                    {isOpen ? <ChevronDown size={15} color={C.sub} /> : <ChevronRight size={15} color={C.sub} />}
                    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, color: s.color, background: s.bg, borderRadius: 5, padding: '3px 7px', whiteSpace: 'nowrap' }}>{s.label}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>{f.title}</span>
                  </button>
                  {isOpen && (
                    <div style={{ padding: '0 13px 13px 38px' }}>
                      <p style={{ color: C.sub, fontSize: 12.5, margin: '0 0 9px', lineHeight: 1.55 }}>{f.detail}</p>
                      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: '9px 11px' }}>
                        <p style={{ color: C.green, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, margin: '0 0 3px' }}>CÓMO SE ARREGLA</p>
                        <p style={{ color: C.text, fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>{f.fix}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {data.posture && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
              <p style={{ color: C.sub, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, margin: '0 0 8px' }}>DEFENSAS VERIFICADAS EN LA BASE</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {[
                  ['Blindaje de raw_data', data.posture.rawDataGuard],
                  ['Candado de columnas sensibles', data.posture.sensitiveColsGuard],
                  ['Saldos atómicos', data.posture.adjustBalancesRpc],
                  ['RLS en usuarios', data.posture.rlsUsers],
                  ['RLS en movimientos', data.posture.rlsTransactions],
                ].map(([label, ok]: any) => (
                  <span key={label} style={{ fontSize: 11, fontWeight: 600, borderRadius: 7, padding: '5px 9px', color: ok ? C.green : C.red, background: ok ? 'rgba(74,222,128,0.10)' : 'rgba(248,113,113,0.10)', border: `1px solid ${ok ? 'rgba(74,222,128,0.28)' : 'rgba(248,113,113,0.28)'}` }}>
                    {ok ? '✓' : '✕'} {label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
