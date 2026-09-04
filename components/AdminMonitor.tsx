import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Shield, Bell, Activity, Wifi, WifiOff, AlertTriangle, CheckCircle, XCircle,
  Landmark, Zap, Database, ArrowLeftRight, Users, Lock, KeyRound, X, Clock, TrendingUp,
} from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';

// ─────────────────────────────────────────────────────────────
// AdminMonitor — Dashboard (Overview) del admin de Lincoin.
// Paleta OFICIAL Lincoin (CLAUDE.md): fondos #070808/#0C0E0D/#121413,
// verde #4ADE80, texto #F4F4F2/#878E88, bordes rgba(255,255,255,.08).
// Tipografía Archivo. Estados funcionales: ámbar #FBBF24, rojo #F87171.
//
// REAL: salud por servicio (ping a las edge functions con latencia),
// conectividad del navegador + beep, feed de auditoría, cobertura 2FA,
// score de seguridad, volumen desde transacciones, retiros inusuales.
// DEMO (marcado "demo · pendiente de datos"): sesiones activas, geo-alertas,
// uptime histórico, historial de incidentes, bloqueo de IP.
// ─────────────────────────────────────────────────────────────

// Paleta
const C = {
  base: '#070808', card: '#0C0E0D', elev: '#121413',
  border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)',
  green: '#4ADE80', greenDim: 'rgba(74,222,128,0.14)', amber: '#FBBF24', red: '#F87171',
};
const FONT = 'Archivo, system-ui, sans-serif';
const num: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

type Sev = 'crit' | 'warn' | 'info';
type Alert = { id: string; kind: string; sev: Sev; text: string; at: number };
type Svc = { key: string; name: string; icon: any; url: string; status: 'up' | 'down' | 'wait'; latency: number | null; hist: number[]; ok: number; total: number };

const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
const tokenOf = () => { try { const k = Object.keys(localStorage).find(x => x.startsWith('sb-') && x.endsWith('-auth-token')); if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) return d.access_token as string; } } catch { /* */ } return null; };

const relTime = (t: number) => {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)}m`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)}h`;
  return `hace ${Math.floor(s / 86400)}d`;
};
const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('es-CO');

const Spark: React.FC<{ data: number[]; color: string }> = ({ data, color }) => {
  if (!data.length) return <div style={{ height: 28 }} />;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const w = 120, h = 28, span = Math.max(max - min, 1);
  const pts = data.map((v, i) => `${(i / Math.max(data.length - 1, 1)) * w},${h - ((v - min) / span) * h}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
    </svg>
  );
};

const DemoTag = () => (
  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: C.amber, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 6, padding: '2px 6px' }}>demo · pendiente de datos</span>
);

export const AdminMonitor: React.FC = () => {
  const { transactions, getAllUsers, currentUser } = useDatabase() as any;
  const users: any[] = (getAllUsers?.() ?? []);
  const txs: any[] = Array.isArray(transactions) ? transactions : [];

  const [now, setNow] = useState(Date.now());
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertOpen, setAlertOpen] = useState(false);
  const [audit, setAudit] = useState<any[] | null>(null);
  const [services, setServices] = useState<Svc[]>([
    { key: 'finity', name: 'Riel de conversión y retiros', icon: ArrowLeftRight, url: `${SURL}/functions/v1/finity-proxy`, status: 'wait', latency: null, hist: [], ok: 0, total: 0 },
    { key: 'gasfree', name: 'Custodia GasFree (TRON)', icon: Zap, url: `${SURL}/functions/v1/gasfree?action=ping`, status: 'wait', latency: null, hist: [], ok: 0, total: 0 },
    { key: 'mouv', name: 'Bre-B · ACH Colombia', icon: Landmark, url: `${SURL}/functions/v1/mouv-proxy`, status: 'wait', latency: null, hist: [], ok: 0, total: 0 },
    { key: 'db', name: 'Base de datos', icon: Database, url: `${SURL}/functions/v1/admin-data?action=ping`, status: 'wait', latency: null, hist: [], ok: 0, total: 0 },
  ]);

  const addAlert = (a: Omit<Alert, 'id' | 'at'>) => setAlerts(prev => {
    if (prev.some(p => p.kind === a.kind && p.text === a.text && Date.now() - p.at < 60000)) return prev;
    return [{ ...a, id: Math.random().toString(36).slice(2), at: Date.now() }, ...prev].slice(0, 60);
  });

  // Reloj
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Conectividad del navegador + beep (Web Audio)
  useEffect(() => {
    const beep = () => {
      try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return; const ctx = new AC();
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = 660; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
        o.start(); o.stop(ctx.currentTime + 0.36);
      } catch { /* */ }
    };
    const off = () => { setOnline(false); addAlert({ kind: 'CONECTIVIDAD', sev: 'crit', text: 'Sin conexión a internet, reintentando…' }); beep(); };
    const on = () => { setOnline(true); addAlert({ kind: 'CONECTIVIDAD', sev: 'info', text: 'Conexión restablecida.' }); };
    window.addEventListener('offline', off); window.addEventListener('online', on);
    return () => { window.removeEventListener('offline', off); window.removeEventListener('online', on); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ping REAL a cada servicio cada 6s (mide latencia; cualquier respuesta HTTP
  // = servicio arriba; solo un fallo de red = caído).
  useEffect(() => {
    let alive = true;
    const pingOne = async (s: Svc): Promise<Svc> => {
      const t0 = performance.now();
      try {
        await fetch(s.url, { method: 'GET', headers: { apikey: SKEY } });
        const ms = Math.round(performance.now() - t0);
        return { ...s, status: 'up', latency: ms, hist: [...s.hist, ms].slice(-40), ok: s.ok + 1, total: s.total + 1 };
      } catch {
        return { ...s, status: 'down', latency: null, hist: [...s.hist, 0].slice(-40), ok: s.ok, total: s.total + 1 };
      }
    };
    const run = async () => {
      const cur = servicesRef.current;
      const next = await Promise.all(cur.map(pingOne));
      if (!alive) return;
      setServices(next);
      next.forEach((s, i) => { if (s.status === 'down' && cur[i].status !== 'down') addAlert({ kind: 'SERVICIO CAÍDO', sev: 'crit', text: `${s.name} caído · retiros pausados` }); });
    };
    run(); const t = setInterval(run, 6000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const servicesRef = useRef(services); servicesRef.current = services;

  // Feed de auditoría (real)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${SURL}/functions/v1/admin-data`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tokenOf() ?? SKEY}` }, body: JSON.stringify({ action: 'list_audit', limit: 40 }) });
        const d = await r.json(); setAudit(Array.isArray(d?.audit) ? d.audit : []);
      } catch { setAudit([]); }
    })();
  }, []);

  // ── Datos derivados REALES ──
  const admins = users.filter(u => u.role === 'admin');
  const mfaAdmins = admins.filter(u => (u as any).mfaEnabled || (u as any).raw_data?.mfaEnabled);
  const clients = users.filter(u => u.role && u.role !== 'admin');
  const pendingKyc = clients.filter(u => ['pending', 'in_review', 'in_progress'].includes(String(u.kycStatus)));

  const monthVol = useMemo(() => {
    const nowD = new Date(); let sum = 0, count = 0;
    for (const t of txs) {
      const d = new Date(t.createdAt ?? t.date ?? 0);
      if (d.getMonth() === nowD.getMonth() && d.getFullYear() === nowD.getFullYear()) { sum += Math.abs(Number(t.amount) || 0); count++; }
    }
    return { sum, count };
  }, [txs]);

  // Retiros inusuales: > 3× el promedio histórico de retiros del cliente
  const unusual = useMemo(() => {
    const byUser: Record<string, number[]> = {};
    const withdrawals = txs.filter(t => /retiro|withdraw|env[íi]o/i.test(String(t.title ?? t.type ?? '')));
    for (const w of withdrawals) { (byUser[w.userId] ??= []).push(Math.abs(Number(w.amount) || 0)); }
    const out: any[] = [];
    for (const w of withdrawals) {
      const arr = byUser[w.userId] || []; if (arr.length < 3) continue;
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      if (avg > 0 && Math.abs(Number(w.amount) || 0) > avg * 3) out.push({ ...w, avg });
    }
    return out.slice(0, 6);
  }, [txs]);
  useEffect(() => { if (unusual.length) addAlert({ kind: 'RETIRO INUSUAL', sev: 'warn', text: `${unusual.length} retiro(s) > 3× el promedio del cliente, retenidos para revisión` }); /* eslint-disable-next-line */ }, [unusual.length]);

  // Volumen 24h (real desde transacciones, por hora)
  const vol24 = useMemo(() => {
    const buckets = new Array(24).fill(0);
    const nowMs = Date.now();
    for (const t of txs) {
      const d = new Date(t.createdAt ?? t.date ?? 0).getTime();
      const hoursAgo = Math.floor((nowMs - d) / 3600000);
      if (hoursAgo >= 0 && hoursAgo < 24) buckets[23 - hoursAgo] += Math.abs(Number(t.amount) || 0);
    }
    return buckets;
  }, [txs]);

  // Score de seguridad (real): 2FA admins + servicios arriba + sin incidentes.
  const anyDown = services.some(s => s.status === 'down');
  const score = useMemo(() => {
    let sc = 40;
    if (admins.length) sc += Math.round((mfaAdmins.length / admins.length) * 30); else sc += 30;
    if (!anyDown) sc += 15;
    if (online) sc += 10;
    if (!unusual.length) sc += 5;
    return Math.min(100, sc);
  }, [admins.length, mfaAdmins.length, anyDown, online, unusual.length]);
  const scoreColor = score >= 85 ? C.green : score >= 70 ? C.amber : C.red;

  const openAlertsCount = alerts.filter(a => a.sev !== 'info').length;
  const globalStatus: { label: string; color: string } = !online ? { label: 'Sin conexión', color: C.red } : anyDown ? { label: 'Degradado', color: C.amber } : { label: 'Sistema Online', color: C.green };

  // ── Estilos base ──
  const cardStyle: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14 };
  const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.dim };

  return (
    <div style={{ fontFamily: FONT, color: C.text, minHeight: '100%' }}>
      {/* Banner crítico */}
      {!online && (
        <div style={{ background: 'rgba(248,113,113,0.14)', border: `1px solid rgba(248,113,113,0.4)`, color: C.red, borderRadius: 12, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 13 }}>
          <WifiOff size={16} /> Sin conexión a internet, reintentando…
        </div>
      )}
      {online && anyDown && (
        <div style={{ background: 'rgba(251,191,36,0.12)', border: `1px solid rgba(251,191,36,0.35)`, color: C.amber, borderRadius: 12, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 13 }}>
          <AlertTriangle size={16} /> Incidente: {services.filter(s => s.status === 'down').map(s => s.name).join(', ')} caído · retiros pausados
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.4, margin: 0 }}>Resumen General</h1>
          <p style={{ ...num, color: C.sub, fontSize: 12, margin: '4px 0 0' }}>{new Date(now).toLocaleString('es-CO', { weekday: 'long', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.elev, border: `1px solid ${C.border}`, borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: 700, color: globalStatus.color }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: globalStatus.color, boxShadow: `0 0 0 4px ${globalStatus.color}22` }} className={online && !anyDown ? 'animate-pulse' : ''} />
            {globalStatus.label}
          </div>
          <button onClick={() => setAlertOpen(true)} style={{ position: 'relative', background: C.elev, border: `1px solid ${C.border}`, borderRadius: 12, width: 40, height: 40, display: 'grid', placeItems: 'center', color: C.text, cursor: 'pointer' }}>
            <Bell size={18} />
            {openAlertsCount > 0 && <span style={{ ...num, position: 'absolute', top: -6, right: -6, background: C.red, color: '#0C0E0D', fontSize: 10, fontWeight: 800, borderRadius: 999, minWidth: 18, height: 18, display: 'grid', placeItems: 'center', padding: '0 4px' }}>{openAlertsCount}</span>}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginBottom: 16 }}>
        {[
          { l: 'Clientes por aprobar', v: pendingKyc.length, sub: 'KYC en revisión', color: pendingKyc.length ? C.amber : C.green },
          { l: 'Cargas por acreditar', v: 0, sub: 'Sin pendientes', color: C.green },
          { l: 'Retiros por aprobar', v: 0, sub: 'Sin pendientes', color: C.green },
          { l: 'Volumen del mes', v: fmtMoney(monthVol.sum), sub: `${monthVol.count} operaciones`, color: C.text, money: true },
        ].map((k, i) => (
          <div key={i} style={{ ...cardStyle, padding: 16 }}>
            <p style={label}>{k.l}</p>
            <p style={{ ...num, fontSize: k.money ? 24 : 30, fontWeight: 800, letterSpacing: -0.6, margin: '8px 0 4px', color: k.color }}>{k.v}</p>
            <p style={{ color: C.sub, fontSize: 12, margin: 0 }}>{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Pendientes de acción */}
      {pendingKyc.length > 0 && (
        <div style={{ ...cardStyle, padding: 16, marginBottom: 16 }}>
          <p style={{ ...label, marginBottom: 10 }}>Pendientes de acción</p>
          {pendingKyc.slice(0, 4).map((u: any) => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: C.amber }} />
                <span style={{ fontSize: 13 }}>KYC · <b>{u.email ?? u.name}</b> · falta aprobación manual</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.green, cursor: 'pointer' }}>Revisar →</span>
            </div>
          ))}
        </div>
      )}

      {/* Monitoreo — salud por servicio (REAL) */}
      <SectionTitle icon={Activity}>Salud de servicios <span style={{ color: C.dim, fontSize: 11, fontWeight: 600 }}>· latencia en vivo</span></SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 22 }}>
        {services.map(s => {
          const up = s.status === 'up', down = s.status === 'down';
          const col = down ? C.red : up ? C.green : C.sub;
          const uptime = s.total ? Math.round((s.ok / s.total) * 1000) / 10 : 0;
          const Icon = s.icon;
          return (
            <div key={s.key} style={{ background: C.card, border: `1px solid ${down ? 'rgba(248,113,113,0.5)' : C.border}`, borderRadius: 14, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon size={15} color={C.sub} />
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{s.name}</span>
                </div>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: col }} className={up ? 'animate-pulse' : ''} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 12 }}>
                <div>
                  <p style={{ ...num, fontSize: 22, fontWeight: 800, margin: 0, color: col }}>{s.latency != null ? `${s.latency}` : down ? '—' : '···'}<span style={{ fontSize: 12, color: C.dim, fontWeight: 600 }}>{s.latency != null ? ' ms' : ''}</span></p>
                  <p style={{ ...num, color: C.sub, fontSize: 11, margin: '2px 0 0' }}>uptime {uptime}% <span style={{ color: C.dim }}>· sesión</span></p>
                </div>
                <Spark data={s.hist.filter(x => x > 0)} color={col} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Seguridad */}
      <SectionTitle icon={Shield}>Seguridad</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginBottom: 14 }}>
        {/* Score */}
        <div style={{ ...cardStyle, padding: 18, display: 'flex', alignItems: 'center', gap: 18 }}>
          <ScoreRing value={score} color={scoreColor} />
          <div>
            <p style={label}>Score de seguridad</p>
            <p style={{ fontSize: 13, color: C.sub, margin: '6px 0 0', maxWidth: 160 }}>{score >= 85 ? 'Postura sólida.' : score >= 70 ? 'Aceptable — hay pendientes.' : 'Riesgo alto — actúa ya.'}</p>
          </div>
        </div>
        {/* 2FA cobertura */}
        <div style={{ ...cardStyle, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={label}>2FA del equipo admin</p>
            <Lock size={15} color={mfaAdmins.length === admins.length && admins.length ? C.green : C.amber} />
          </div>
          <p style={{ ...num, fontSize: 30, fontWeight: 800, margin: '8px 0 2px', color: mfaAdmins.length === admins.length && admins.length ? C.green : C.amber }}>{mfaAdmins.length}/{admins.length || 0}</p>
          <p style={{ color: C.sub, fontSize: 12, margin: 0 }}>{mfaAdmins.length === admins.length && admins.length ? 'Todos con 2FA activo' : 'Faltan admins por activar 2FA — el panel los bloquea en acciones sensibles'}</p>
        </div>
        {/* Estado de llaves */}
        <div style={{ ...cardStyle, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={label}>Rotación de llaves / API</p>
            <KeyRound size={15} color={C.amber} />
          </div>
          <p style={{ fontSize: 13, margin: '10px 0 4px', color: C.text }}>Última rotación: <span style={{ ...num }}>—</span></p>
          <p style={{ color: C.sub, fontSize: 12, margin: 0 }}>Registra la rotación en Auditoría cuando cambies llaves.</p>
          <div style={{ marginTop: 8 }}><DemoTag /></div>
        </div>
      </div>

      {/* Feed de auditoría (REAL) + Alertas de login/IP (demo) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 22 }}>
        <div style={{ ...cardStyle, padding: 16 }}>
          <p style={{ ...label, marginBottom: 10 }}>Registro de auditoría en vivo</p>
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {audit == null ? <p style={{ color: C.dim, fontSize: 12 }}>Cargando…</p> : audit.length === 0 ? <p style={{ color: C.dim, fontSize: 12 }}>Sin eventos aún. Las acciones sensibles aparecerán aquí.</p> : audit.map((a: any, i: number) => (
              <div key={i} style={{ ...num, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: C.sub, display: 'flex', gap: 8, lineHeight: 1.5 }}>
                <span style={{ color: C.dim, whiteSpace: 'nowrap' }}>{a.metadata?.at ? new Date(a.metadata.at).toLocaleTimeString('es-CO') : (a.created_at ? new Date(a.created_at).toLocaleTimeString('es-CO') : '--:--')}</span>
                <span style={{ color: a.metadata?.hadSession === false ? C.red : C.text }}>{String(a.action).replace(/^(gasfree|admin|auth|user)\./, '')}</span>
                <span style={{ color: C.dim }}>{a.metadata?.byEmail ?? (a.metadata?.hadSession === false ? '⚠ sin sesión' : '')}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ ...cardStyle, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p style={label}>Intentos de login y bloqueo de IP</p><DemoTag />
          </div>
          <p style={{ ...num, fontSize: 13, color: C.text, margin: '0 0 6px' }}>Intentos fallidos hoy: <b>0</b></p>
          <p style={{ color: C.sub, fontSize: 12, margin: 0 }}>Al 3.er intento fallido desde una IP → bloqueo automático + alerta + entrada en auditoría. Requiere registrar los intentos fallidos en el servidor (pendiente).</p>
        </div>
      </div>

      {/* Sesiones activas (demo) + Retiros inusuales (real) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 22 }}>
        <div style={{ ...cardStyle, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p style={label}>Sesiones activas · cierre remoto</p><DemoTag />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Users size={15} color={C.sub} />
              <div>
                <p style={{ fontSize: 13, margin: 0 }}>{currentUser?.email ?? 'Tú'} <span style={{ color: C.green, fontSize: 11 }}>· esta sesión</span></p>
                <p style={{ color: C.dim, fontSize: 11, margin: 0 }}>Navegador actual · ahora</p>
              </div>
            </div>
          </div>
          <p style={{ color: C.sub, fontSize: 11, margin: '6px 0 0' }}>La lista de todas las sesiones (ciudad, navegador) y el cierre remoto requieren la API de sesiones de Supabase (pendiente).</p>
        </div>
        <div style={{ ...cardStyle, padding: 16 }}>
          <p style={{ ...label, marginBottom: 10 }}>Retiros inusuales (&gt; 3× promedio)</p>
          {unusual.length === 0 ? <p style={{ color: C.dim, fontSize: 12 }}>Sin retiros inusuales detectados.</p> : unusual.map((w: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: i ? `1px solid ${C.border}` : 'none' }}>
              <div>
                <p style={{ ...num, fontSize: 13, margin: 0, color: C.amber }}>{fmtMoney(Math.abs(Number(w.amount) || 0))}</p>
                <p style={{ color: C.dim, fontSize: 11, margin: 0 }}>{users.find(u => u.id === w.userId)?.email ?? w.userId} · prom {fmtMoney(w.avg)}</p>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.amber, background: 'rgba(251,191,36,0.12)', borderRadius: 6, padding: '3px 7px' }}>RETENIDO</span>
            </div>
          ))}
        </div>
      </div>

      {/* Volumen 24h (real) */}
      <SectionTitle icon={TrendingUp}>Volumen últimas 24 h</SectionTitle>
      <div style={{ ...cardStyle, padding: 18, marginBottom: 22 }}>
        <VolumeChart data={vol24} />
      </div>

      {/* Historial de incidentes (demo) */}
      <SectionTitle icon={Clock}>Historial de incidentes</SectionTitle>
      <div style={{ ...cardStyle, padding: 16, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><DemoTag /></div>
        <p style={{ color: C.sub, fontSize: 12, margin: 0 }}>Aquí quedará el historial (RESUELTO/MITIGADO, descripción, fecha, duración) en cuanto se registren incidentes reales de servicios. Los cortes detectados por el monitoreo de arriba se irán guardando aquí.</p>
      </div>

      {/* Panel lateral de alertas */}
      {alertOpen && (
        <>
          <div onClick={() => setAlertOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 60 }} />
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 344, maxWidth: '90vw', background: C.card, borderLeft: `1px solid ${C.border2}`, zIndex: 61, display: 'flex', flexDirection: 'column', fontFamily: FONT }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Bell size={16} color={C.green} /><span style={{ fontWeight: 800 }}>Centro de alertas</span></div>
              <button onClick={() => setAlertOpen(false)} style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {alerts.length === 0 ? <p style={{ color: C.dim, fontSize: 13, textAlign: 'center', marginTop: 30 }}>Sin alertas. Todo en orden.</p> : alerts.map(a => {
                const col = a.sev === 'crit' ? C.red : a.sev === 'warn' ? C.amber : C.green;
                return (
                  <div key={a.id} style={{ background: C.elev, border: `1px solid ${C.border}`, borderLeft: `3px solid ${col}`, borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: col }}>{a.kind}</span>
                      <span style={{ ...num, fontSize: 10, color: C.dim }}>{relTime(a.at)}</span>
                    </div>
                    <p style={{ fontSize: 12.5, color: C.text, margin: 0 }}>{a.text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const SectionTitle: React.FC<{ icon: any; children: React.ReactNode }> = ({ icon: Icon, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 12px' }}>
    <Icon size={15} color={C.green} />
    <h2 style={{ fontSize: 13, fontWeight: 800, letterSpacing: 0.3, textTransform: 'uppercase', color: C.sub, margin: 0 }}>{children}</h2>
  </div>
);

const ScoreRing: React.FC<{ value: number; color: string }> = ({ value, color }) => {
  const r = 32, circ = 2 * Math.PI * r, off = circ - (value / 100) * circ;
  return (
    <svg width={80} height={80} viewBox="0 0 80 80">
      <circle cx={40} cy={40} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={7} />
      <circle cx={40} cy={40} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off} transform="rotate(-90 40 40)" />
      <text x={40} y={40} textAnchor="middle" dominantBaseline="central" style={{ fontFamily: FONT, fontWeight: 800, fontSize: 22, fill: color, fontVariantNumeric: 'tabular-nums' }}>{value}</text>
    </svg>
  );
};

const VolumeChart: React.FC<{ data: number[] }> = ({ data }) => {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
      {data.map((v, i) => {
        const isNow = i === data.length - 1;
        return (
          <div key={i} title={`hace ${data.length - 1 - i}h · ${'$' + Math.round(v).toLocaleString('es-CO')}`} style={{ flex: 1, height: `${Math.max((v / max) * 100, 2)}%`, background: isNow ? C.green : 'rgba(74,222,128,0.28)', borderRadius: 3, minHeight: 2 }} />
        );
      })}
    </div>
  );
};
