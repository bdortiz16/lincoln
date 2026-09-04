import React, { useEffect, useMemo, useState } from 'react';
import { Wallet, Plus, X, TrendingUp, TrendingDown, Shield, Lock, AlertTriangle, FileCheck } from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// AdminTreasuryPanel — cabecera del dashboard "Tesorería y Finanzas".
//
// ⚠️ Nunca se nombra la infraestructura: al almacenamiento protegido se le
// dice SOLO "Bóveda" (🔒).
//
// Paleta OFICIAL Lincoin (CLAUDE.md) + tipografía Archivo.
// COP (Mouv · Bre-B) y USDT (GasFree) son billeteras SEPARADAS.
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

export type WalletKind = 'COP' | 'USDT';

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, ...style }}>{children}</div>
);
const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.dim, margin: 0 }}>{children}</p>
);

const fmtCop = (n: number) => '$' + Math.round(n).toLocaleString('es-CO');

/** Modal de selección de billetera. COP y USDT son cuentas separadas. */
const WalletsModal: React.FC<{
  copBalance: number | null;
  usdtBalance: number | null;
  onPick: (w: WalletKind) => void;
  onClose: () => void;
}> = ({ copBalance, usdtBalance, onPick, onClose }) => {
  const activas = [
    { key: 'COP' as WalletKind, flag: '🇨🇴', name: 'COP · Peso colombiano', sub: 'Mouv · dispersión Bre-B', bal: copBalance != null ? fmtCop(copBalance) : '—' },
    { key: 'USDT' as WalletKind, flag: '🇺🇸', name: 'USD · Dólar digital (USDT)', sub: 'Tesorería GasFree · TRC-20', bal: usdtBalance != null ? `${usdtBalance.toLocaleString('es-CO')} USDT` : '—' },
  ];
  const proximas = [
    { flag: '🇲🇽', name: 'MXN · Peso mexicano', sub: 'En integración' },
    { flag: '🇧🇷', name: 'BRL · Real brasileño', sub: 'En integración' },
    { flag: '🇪🇺', name: 'EUR · Euro', sub: 'En integración' },
  ];
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 70 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 71, width: 460, maxWidth: '93vw', maxHeight: '88vh', overflowY: 'auto', background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, fontFamily: FONT, color: C.text }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: `1px solid ${C.border}` }}>
          <div>
            <p style={{ fontWeight: 800, fontSize: 15, margin: 0 }}>¿Con cuál billetera quieres operar?</p>
            <p style={{ color: C.sub, fontSize: 12, margin: '3px 0 0' }}>Cada moneda es una cuenta independiente.</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {activas.map(w => (
            <button key={w.key} onClick={() => { onPick(w.key); onClose(); }}
              style={{ display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left', background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.32)', borderRadius: 12, padding: '13px 15px', cursor: 'pointer', color: C.text }}>
              <span style={{ fontSize: 22 }}>{w.flag}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{w.name}</span>
                <span style={{ display: 'block', color: C.sub, fontSize: 11.5 }}>{w.sub}</span>
              </span>
              <span style={{ ...num, fontFamily: MONO, fontSize: 13, fontWeight: 700, color: C.green, whiteSpace: 'nowrap' }}>{w.bal}</span>
            </button>
          ))}
          {proximas.map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 13, background: C.elev, border: `1px solid ${C.border}`, borderRadius: 12, padding: '13px 15px', opacity: 0.5, cursor: 'not-allowed' }}>
              <span style={{ fontSize: 22, filter: 'grayscale(1)' }}>{w.flag}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{w.name}</span>
                <span style={{ display: 'block', color: C.dim, fontSize: 11.5 }}>{w.sub}</span>
              </span>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: C.dim, border: `1px solid ${C.border2}`, borderRadius: 6, padding: '3px 7px', whiteSpace: 'nowrap' }}>PRÓXIMAMENTE</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

export const AdminTreasuryPanel: React.FC<{
  pendingLoads: number;
  pendingWithdrawals: number;
  monthVolume: number;
  monthOps: number;
  heldForReview: number;
  inflow: number;
  outflow: number;
  flow14: { in: number; out: number }[];
  copBalance: number | null;
  usdtBalance: number | null;
  onPickWallet?: (w: WalletKind) => void;
  onRegisterMovement?: () => void;
}> = ({ pendingLoads, pendingWithdrawals, monthVolume, monthOps, heldForReview, inflow, outflow, flow14, copBalance, usdtBalance, onPickWallet, onRegisterMovement }) => {
  const [now, setNow] = useState(Date.now());
  const [walletsOpen, setWalletsOpen] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const data = flow14.length ? flow14 : new Array(14).fill(0).map(() => ({ in: 0, out: 0 }));
  const max = Math.max(...data.flatMap(d => [d.in, d.out]), 1);
  const neto = inflow - outflow;

  const kpis = [
    { l: 'Cargas pendientes', v: pendingLoads, tag: pendingLoads === 0 ? 'al día' : 'por revisar', color: pendingLoads ? C.amber : C.green },
    { l: 'Retiros pendientes', v: pendingWithdrawals, tag: pendingWithdrawals === 0 ? 'al día' : 'por aprobar', color: pendingWithdrawals ? C.amber : C.green },
    { l: 'Volumen del mes', v: fmtCop(monthVolume), tag: `${monthOps} operaciones`, color: C.text, small: true },
    { l: 'Retenidos por revisión', v: heldForReview, tag: heldForReview ? 'regla 3× · revisar' : 'sin retenciones', color: heldForReview ? C.amber : C.green },
  ];

  const controles = [
    { icon: FileCheck, l: 'Aprobación de retiros', v: 'Manual · 2FA', ok: true },
    { icon: AlertTriangle, l: 'Retiros inusuales (>3× promedio)', v: 'Retención automática', ok: true },
    { icon: Shield, l: 'Registro de movimientos', v: 'Auditado', ok: true },
    { icon: Lock, l: 'Salidas USDT', v: 'Solo Bóveda 🔒', ok: true },
  ];

  return (
    <div style={{ fontFamily: FONT, color: C.text, marginBottom: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h2 style={{ fontSize: 21, fontWeight: 800, letterSpacing: -0.4, margin: 0 }}>Tesorería y Finanzas</h2>
          <p style={{ ...num, color: C.sub, fontSize: 12, margin: '4px 0 0' }}>{new Date(now).toLocaleDateString('es-CO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 999, padding: '7px 13px', fontSize: 12, fontWeight: 700, color: C.green }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: C.green }} className="animate-pulse" /> Sistema Operativo
          </div>
          <button onClick={() => setWalletsOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: `1px solid ${C.green}`, color: C.green, borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            <Wallet size={14} /> Billeteras
          </button>
          {onRegisterMovement && (
            <button onClick={onRegisterMovement}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.text, border: 'none', color: '#0C0E0D', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
              <Plus size={14} /> Registrar Movimiento
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 16 }}>
        {kpis.map((k, i) => (
          <Card key={i} style={{ padding: 15 }}>
            <Label>{k.l}</Label>
            <p style={{ ...num, fontSize: k.small ? 21 : 28, fontWeight: 800, letterSpacing: -0.5, margin: '8px 0 4px', color: k.color }}>{k.v}</p>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.dim, background: 'rgba(255,255,255,0.05)', borderRadius: 5, padding: '2px 6px' }}>{k.tag}</span>
          </Card>
        ))}
      </div>

      {/* Flujo 14 días + Resumen del mes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2.2fr) minmax(230px,1fr)', gap: 14, marginBottom: 16 }} className="lincoin-treasury-grid">
        <Card style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <Label>Flujo de tesorería · 14 días</Label>
            <div style={{ display: 'flex', gap: 12, fontSize: 10.5, color: C.sub }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: C.green }} /> Entradas</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: C.red }} /> Salidas</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 130, borderBottom: `1px solid ${C.border}`, paddingBottom: 2 }}>
            {data.map((d, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 2, height: '100%' }}>
                <div title={`Entradas ${fmtCop(d.in)}`} style={{ flex: 1, height: `${Math.max((d.in / max) * 100, 1.5)}%`, background: C.green, borderRadius: '3px 3px 0 0', opacity: 0.9 }} />
                <div title={`Salidas ${fmtCop(d.out)}`} style={{ flex: 1, height: `${Math.max((d.out / max) * 100, 1.5)}%`, background: C.red, borderRadius: '3px 3px 0 0', opacity: 0.85 }} />
              </div>
            ))}
          </div>
          <div style={{ ...num, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.dim, marginTop: 6 }}>
            <span>−14d</span><span>−7d</span><span>hoy</span>
          </div>
        </Card>

        <Card style={{ padding: 16 }}>
          <Label>Resumen del mes</Label>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 13 }}>
            <div>
              <p style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.sub, fontSize: 12, margin: 0 }}><TrendingUp size={13} color={C.green} /> Entradas (cargas)</p>
              <p style={{ ...num, fontSize: 19, fontWeight: 800, color: C.green, margin: '3px 0 0' }}>+{fmtCop(inflow)}</p>
            </div>
            <div>
              <p style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.sub, fontSize: 12, margin: 0 }}><TrendingDown size={13} color={C.red} /> Salidas (retiros + proveedor)</p>
              <p style={{ ...num, fontSize: 19, fontWeight: 800, color: C.red, margin: '3px 0 0' }}>−{fmtCop(outflow)}</p>
            </div>
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 11 }}>
              <p style={{ color: C.sub, fontSize: 12, margin: 0 }}>Neto</p>
              <p style={{ ...num, fontSize: 21, fontWeight: 800, color: neto >= 0 ? C.green : C.red, margin: '3px 0 0' }}>{neto >= 0 ? '+' : '−'}{fmtCop(Math.abs(neto))}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Controles de tesorería */}
      <Card style={{ padding: 16, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}><Shield size={14} color={C.green} /><Label>Controles de tesorería</Label></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10 }}>
          {controles.map((c, i) => {
            const Icon = c.icon;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.elev, border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 13px' }}>
                <Icon size={15} color={C.green} style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 11.5, color: C.sub, margin: 0 }}>{c.l}</p>
                  <p style={{ fontSize: 12.5, fontWeight: 700, color: C.text, margin: '1px 0 0' }}>{c.v}</p>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {walletsOpen && (
        <WalletsModal copBalance={copBalance} usdtBalance={usdtBalance}
          onPick={(w) => onPickWallet?.(w)} onClose={() => setWalletsOpen(false)} />
      )}

      <style>{`@media (max-width: 1000px) { .lincoin-treasury-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
};
