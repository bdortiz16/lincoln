import React, { useEffect, useMemo, useState } from 'react';
import { Shield, Eye, EyeOff, Copy, QrCode, Activity, AlertTriangle, Lock, Wallet, TrendingUp, X } from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// AdminCustodyPanel — cabecera del panel GasFree · Custodia USDT.
//
// ⚠️ REGLA DE SEGURIDAD: esta UI NUNCA revela dónde ni cómo se guardan los
// secretos. Al almacenamiento protegido se le llama SOLO "Bóveda". Prohibido
// nombrar servicios, bases de datos o infraestructura.
//
// Paleta OFICIAL Lincoin (CLAUDE.md) + tipografía Archivo.
// ─────────────────────────────────────────────────────────────

const C = {
  base: '#070808', card: '#0C0E0D', elev: '#121413',
  border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)',
  green: '#4ADE80', greenDeep: '#22A35C', amber: '#FBBF24', red: '#F87171',
};
const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const num: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

export type AuditEntry = { at: number; text: string; sev: 'info' | 'warn' };

/** Enmascara una dirección: TNou··············X35r8f */
export const maskAddr = (a?: string) => {
  if (!a) return '—';
  if (a.length <= 12) return a;
  return `${a.slice(0, 4)}${'·'.repeat(14)}${a.slice(-6)}`;
};

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, ...style }}>{children}</div>
);
const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.dim, margin: 0 }}>{children}</p>
);

const ScoreRing: React.FC<{ value: number; color: string }> = ({ value, color }) => {
  const r = 30, circ = 2 * Math.PI * r;
  return (
    <svg width={74} height={74} viewBox="0 0 74 74">
      <circle cx={37} cy={37} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={7} />
      <circle cx={37} cy={37} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={circ - (value / 100) * circ} transform="rotate(-90 37 37)" />
      <text x={37} y={37} textAnchor="middle" dominantBaseline="central"
        style={{ fontFamily: FONT, fontWeight: 800, fontSize: 20, fill: color, ...num }}>{value}</text>
    </svg>
  );
};

/** Modal de confirmación 2FA para acciones sensibles. */
export const Confirm2FAModal: React.FC<{
  action: string;
  onConfirm: (code: string) => void;
  onClose: () => void;
}> = ({ action, onConfirm, onClose }) => {
  const [code, setCode] = useState('');
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 71, width: 400, maxWidth: '92vw', background: C.card, border: `1px solid ${C.border2}`, borderRadius: 14, fontFamily: FONT, color: C.text }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: `1px solid ${C.border}` }}>
          <Shield size={18} color={C.green} />
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 800, margin: 0, fontSize: 14 }}>Confirmación en dos pasos</p>
            <p style={{ color: C.sub, fontSize: 12, margin: '2px 0 0' }}>Vas a {action}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 18 }}>
          <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus inputMode="numeric" placeholder="123 456"
            onKeyDown={e => { if (e.key === 'Enter' && code.length === 6) { onConfirm(code); onClose(); } }}
            style={{ width: '100%', padding: '12px', borderRadius: 10, border: `1px solid ${C.border2}`, background: C.elev, color: C.text, fontFamily: MONO, fontSize: 18, letterSpacing: 4, textAlign: 'center', outline: 'none', ...num }} />
          <p style={{ color: C.dim, fontSize: 11, margin: '10px 0 0', lineHeight: 1.5 }}>
            Esta acción queda registrada con usuario, IP y hora, y se notifica al resto del equipo de administración.
          </p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px', borderTop: `1px solid ${C.border}` }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.sub, fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: '8px 12px' }}>Cancelar</button>
          <button onClick={() => { if (code.length === 6) { onConfirm(code); onClose(); } }} disabled={code.length !== 6}
            style={{ background: C.green, color: '#0C0E0D', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, padding: '8px 16px', cursor: code.length === 6 ? 'pointer' : 'not-allowed', opacity: code.length === 6 ? 1 : 0.5 }}>
            Confirmar
          </button>
        </div>
      </div>
    </>
  );
};

export const AdminCustodyPanel: React.FC<{
  discreet: boolean;
  onToggleDiscreet: () => void;
  treasuryAddress?: string | null;
  treasuryBalance?: number | null;
  mouvCop?: number | null;
  walletsCount: number;
  providerLocked: boolean;
  providerAssigned: boolean;
  mfaCovered: number;
  mfaTotal: number;
  alertThreshold: number;
  audit: AuditEntry[];
  onAudit: (text: string, sev?: 'info' | 'warn') => void;
  services: { name: string; latency: number | null; up: boolean }[];
  flow?: { in: number; out: number }[];
  onOpenTreasury?: () => void;
}> = ({ discreet, onToggleDiscreet, treasuryAddress, treasuryBalance, mouvCop, walletsCount, providerLocked, providerAssigned, mfaCovered, mfaTotal, alertThreshold, audit, onAudit, services, flow, onOpenTreasury }) => {
  const [now, setNow] = useState(Date.now());
  const [revealed, setRevealed] = useState(false);
  const [showQr, setShowQr] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  // Al reactivar el modo discreto se vuelve a ocultar todo.
  useEffect(() => { if (discreet) { setRevealed(false); setShowQr(false); } }, [discreet]);

  const score = useMemo(() => {
    let s = 0;
    if (providerLocked) s += 35;
    if (mfaTotal > 0 && mfaCovered >= mfaTotal) s += 30; else if (mfaTotal > 0) s += Math.round((mfaCovered / mfaTotal) * 30);
    if (discreet) s += 20;
    if (providerAssigned) s += 15;
    return Math.min(100, s);
  }, [providerLocked, mfaCovered, mfaTotal, discreet, providerAssigned]);
  const scoreColor = score >= 85 ? C.green : score >= 70 ? C.amber : C.red;

  const reveal = () => { setRevealed(true); onAudit('Reveló la dirección de Tesorería', 'warn'); };
  const copy = () => { try { navigator.clipboard?.writeText(treasuryAddress ?? ''); } catch { /* */ } onAudit('Copió la dirección de Tesorería', 'warn'); };
  const toggleQr = () => { const n = !showQr; setShowQr(n); if (n) onAudit('Mostró el QR de Tesorería', 'warn'); };

  const flowData = flow && flow.length ? flow : new Array(14).fill(0).map(() => ({ in: 0, out: 0 }));
  const flowMax = Math.max(...flowData.flatMap(d => [d.in, d.out]), 1);

  const checks = [
    { ok: providerLocked, label: 'Wallet de proveedor en Bóveda', warn: 'Sin fijar en Bóveda' },
    { ok: mfaTotal > 0 && mfaCovered >= mfaTotal, label: `2FA del equipo ${mfaCovered}/${mfaTotal}`, warn: `2FA incompleto ${mfaCovered}/${mfaTotal}` },
    { ok: discreet, label: 'Direcciones enmascaradas', warn: 'Modo discreto desactivado' },
    { ok: providerAssigned, label: 'Proveedor destino asignado', warn: 'Proveedor destino sin asignar' },
  ];

  return (
    <div style={{ fontFamily: FONT, color: C.text, marginBottom: 20 }}>
      {/* Banner de alertas activas */}
      {(!providerAssigned || (treasuryBalance ?? 0) >= alertThreshold) && (
        <div style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)', color: C.amber, borderRadius: 12, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, fontWeight: 600 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <span>
            {!providerAssigned && 'Sin proveedor destino asignado'}
            {!providerAssigned && ' · '}
            <span style={num}>Umbral de alerta {alertThreshold.toLocaleString('es-CO')} USDT (saldo {(treasuryBalance ?? 0).toLocaleString('es-CO')})</span>
          </span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3, margin: 0 }}>GasFree · Custodia USDT <span style={{ color: C.dim, fontWeight: 600, fontSize: 14 }}>(TRON)</span></h2>
          <p style={{ ...num, fontFamily: MONO, color: C.sub, fontSize: 11.5, margin: '4px 0 0' }}>{new Date(now).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onToggleDiscreet}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: discreet ? 'rgba(74,222,128,0.14)' : C.elev, border: `1px solid ${discreet ? 'rgba(74,222,128,0.35)' : C.border}`, color: discreet ? C.green : C.sub, borderRadius: 999, padding: '7px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {discreet ? <EyeOff size={14} /> : <Eye size={14} />} Modo discreto {discreet ? 'ON' : 'OFF'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.elev, border: `1px solid ${C.border}`, borderRadius: 999, padding: '7px 13px', fontSize: 12, fontWeight: 700, color: C.green }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: C.green }} className="animate-pulse" /> Sistema Online
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2.1fr) minmax(260px,1fr)', gap: 16, alignItems: 'start' }} className="lincoin-custody-grid">
        {/* ── Columna principal ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
            {[
              { l: 'Tesorería GasFree', v: `${(treasuryBalance ?? 0).toLocaleString('es-CO')}`, u: 'USDT', tag: `umbral ${Math.round(alertThreshold / 1000)}k` },
              { l: 'Peso Mouv · COP', v: mouvCop != null ? `$${mouvCop.toLocaleString('es-CO')}` : '—', u: '', tag: 'cada 1 min' },
              { l: 'Comisiones del mes', v: '1.5', u: 'USDT', tag: '+1.5 activ.' },
              { l: 'Wallets activas', v: String(walletsCount), u: '', tag: 'clientes' },
            ].map((k, i) => (
              <Card key={i} style={{ padding: 14 }}>
                <Label>{k.l}</Label>
                <p style={{ ...num, fontSize: 20, fontWeight: 800, letterSpacing: -0.4, margin: '7px 0 3px' }}>{k.v}{k.u && <span style={{ fontSize: 11, color: C.dim, fontWeight: 600 }}> {k.u}</span>}</p>
                <span style={{ fontSize: 10, fontWeight: 700, color: C.dim, background: 'rgba(255,255,255,0.05)', borderRadius: 5, padding: '2px 6px' }}>{k.tag}</span>
              </Card>
            ))}
          </div>

          {/* Flujo USDT 14 días */}
          <Card style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><TrendingUp size={14} color={C.green} /><Label>Flujo USDT · 14 días</Label></div>
              <div style={{ display: 'flex', gap: 12, fontSize: 10.5, color: C.sub }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: C.green }} /> Entradas</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: C.greenDeep }} /> Salidas a proveedor</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110, borderBottom: `1px solid ${C.border}`, paddingBottom: 2 }}>
              {flowData.map((d, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 2, height: '100%' }}>
                  <div title={`Entradas ${d.in}`} style={{ flex: 1, height: `${Math.max((d.in / flowMax) * 100, 1.5)}%`, background: C.green, borderRadius: '3px 3px 0 0', opacity: 0.9 }} />
                  <div title={`Salidas ${d.out}`} style={{ flex: 1, height: `${Math.max((d.out / flowMax) * 100, 1.5)}%`, background: C.greenDeep, borderRadius: '3px 3px 0 0', opacity: 0.9 }} />
                </div>
              ))}
            </div>
          </Card>

          {/* Tesorería recaudadora */}
          <Card style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}><Wallet size={14} color={C.green} /><Label>Tesorería recaudadora · TRC-20</Label></div>
            <p style={{ fontFamily: MONO, fontSize: 13, color: C.text, margin: 0, wordBreak: 'break-all', letterSpacing: 0.2 }}>
              {revealed && !discreet ? (treasuryAddress ?? '—') : maskAddr(treasuryAddress ?? undefined)}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {!revealed || discreet ? (
                <button onClick={reveal} disabled={discreet} title={discreet ? 'Desactiva el Modo discreto para revelar' : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.elev, border: `1px solid ${C.border}`, color: discreet ? C.dim : C.text, borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: discreet ? 'not-allowed' : 'pointer' }}>
                  <Eye size={13} /> Revelar
                </button>
              ) : (
                <button onClick={() => setRevealed(false)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.elev, border: `1px solid ${C.border}`, color: C.text, borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  <EyeOff size={13} /> Ocultar
                </button>
              )}
              <button onClick={copy} style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.elev, border: `1px solid ${C.border}`, color: C.text, borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}><Copy size={13} /> Copiar</button>
              <button onClick={toggleQr} disabled={discreet} title={discreet ? 'Desactiva el Modo discreto para ver el QR' : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.elev, border: `1px solid ${C.border}`, color: discreet ? C.dim : C.text, borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: discreet ? 'not-allowed' : 'pointer' }}><QrCode size={13} /> {showQr ? 'Ocultar QR' : 'Mostrar QR'}</button>
            </div>
            {showQr && !discreet && treasuryAddress && (
              <div style={{ marginTop: 14, background: '#fff', padding: 10, borderRadius: 10, width: 'fit-content' }}>
                <img alt="QR Tesorería" width={148} height={148}
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=148x148&data=${encodeURIComponent(treasuryAddress)}`} />
              </div>
            )}
            {onOpenTreasury && (
              <button onClick={onOpenTreasury}
                style={{ marginTop: 12, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', color: C.green, borderRadius: 10, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                <Wallet size={14} /> Ver detalle de Tesorería
              </button>
            )}
            <p style={{ color: C.dim, fontSize: 11, margin: '10px 0 0' }}>Revelar, copiar o mostrar el QR queda registrado en la auditoría de esta página.</p>
          </Card>
        </div>

        {/* ── Columna derecha ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* Seguridad de custodia */}
          <Card style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}><Lock size={14} color={scoreColor} /><Label>Seguridad de custodia</Label></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
              <ScoreRing value={score} color={scoreColor} />
              <p style={{ fontSize: 12, color: C.sub, margin: 0 }}>{score >= 85 ? 'Custodia blindada.' : score >= 70 ? 'Aceptable — hay pendientes.' : 'Riesgo — revisa los puntos en ámbar.'}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {checks.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: c.ok ? C.green : C.amber, flexShrink: 0 }} />
                  <span style={{ color: c.ok ? C.text : C.amber }}>{c.ok ? c.label : c.warn}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Red y conectividad */}
          <Card style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}><Activity size={14} color={C.green} /><Label>Red y conectividad</Label></div>
            {services.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: i ? `1px solid ${C.border}` : 'none' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: C.sub }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: s.up ? C.green : C.red }} /> {s.name}
                </span>
                <span style={{ ...num, fontFamily: MONO, fontSize: 11.5, color: s.up ? C.text : C.red }}>{s.latency != null ? `${s.latency} ms` : '—'}</span>
              </div>
            ))}
          </Card>

          {/* Auditoría de la página */}
          <Card style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}><Shield size={14} color={C.green} /><Label>Auditoría de la página</Label></div>
            <div style={{ maxHeight: 190, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {audit.length === 0
                ? <p style={{ color: C.dim, fontSize: 11.5, margin: 0 }}>Sin acciones sensibles en esta sesión.</p>
                : audit.map((a, i) => (
                  <div key={i} style={{ fontFamily: MONO, fontSize: 10.5, lineHeight: 1.6, display: 'flex', gap: 7, ...num }}>
                    <span style={{ color: C.dim, flexShrink: 0 }}>{new Date(a.at).toLocaleTimeString('es-CO')}</span>
                    <span style={{ color: a.sev === 'warn' ? C.amber : C.sub }}>{a.text}</span>
                  </div>
                ))}
            </div>
          </Card>
        </div>
      </div>

      <style>{`@media (max-width: 1100px) { .lincoin-custody-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
};
