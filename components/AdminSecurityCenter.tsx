import React, { useEffect, useState } from 'react';
import {
  ShieldCheck, AlertTriangle, Eye, EyeOff, RefreshCw, Lock, Globe, KeyRound,
  Fingerprint, Activity, Wrench, Plus,
} from 'lucide-react';
import { soportaPasskey, crearPasskey, firmarConPasskey, explicarErrorPasskey } from '../lib/webauthn';

// ─────────────────────────────────────────────────────────────
// AdminSecurityCenter — la página de Seguridad como tablero.
//
// Todo lo que se ve acá sale de datos REALES: el puntaje de la auditoría, los
// intentos del día, las cuentas con 2FA, las llaves registradas. Un tablero de
// seguridad con cifras de ejemplo es peor que no tener tablero — da confianza
// sobre algo que nadie verificó.
//
// REGLA DE ORO: nada sensible en pantalla. El almacenamiento protegido se
// llama solo «Bóveda». No se muestran comandos, ni nombres de infraestructura,
// ni la salida de emergencia — esa vive documentada en la Bóveda y punto.
//
// MODO DISCRETO (encendido por defecto): enmascara IPs, correos y los nombres
// técnicos de las defensas. Existe porque este panel se abre en cafés, en
// reuniones y con gente al lado; y porque una captura de pantalla circula más
// de lo que uno cree. Apagarlo queda en auditoría.
// ─────────────────────────────────────────────────────────────

const C = {
  base: '#070808', card: '#0C0E0D', elev: '#121413',
  border: 'rgba(255,255,255,0.06)', border2: 'rgba(255,255,255,0.14)',
  text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)',
  green: '#4ADE80', amber: '#FBBF24', red: '#F87171',
};
const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

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
  try {
    const r = await fetch(`${SURL}/functions/v1/admin-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tokenOf() ?? SKEY}` },
      body: JSON.stringify(body),
    });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { error: `respuesta ${r.status}` }; }
  } catch (e: any) { return { error: e?.message ?? 'sin conexión' }; }
};

// ── Enmascarado ──────────────────────────────────────────────────────────
const ocultarIp = (ip: string | null | undefined, on: boolean) => {
  const v = String(ip ?? '');
  if (!v) return '—';
  if (!on) return v;
  const p = v.split('.');
  return p.length === 4 ? `${p[0]}.··.···.${p[3]}` : `${v.slice(0, 4)}····`;
};
const ocultarCorreo = (correo: string | null | undefined, on: boolean) => {
  const v = String(correo ?? '');
  if (!v.includes('@')) return v || '—';
  if (!on) return v;
  const [u, d] = v.split('@');
  return `${u.slice(0, 4)}····@${d}`;
};

// Nombres genéricos de las defensas cuando el modo discreto está encendido.
// El nombre técnico le dice a quien mire por encima del hombro exactamente
// qué buscar; el genérico dice lo mismo a quien ya sabe de qué se trata.
const NOMBRE_DEFENSA: Record<string, { generico: string; tecnico: string }> = {
  rawDataGuard: { generico: 'Blindaje de datos crudos', tecnico: 'guard_raw_data_server_keys' },
  sensitiveColsGuard: { generico: 'Columnas sensibles bajo candado', tecnico: 'users_sensitive_cols_guard' },
  adjustBalancesRpc: { generico: 'Saldos atómicos', tecnico: 'adjust_balances (RPC)' },
  rlsUsers: { generico: 'Aislamiento por usuario', tecnico: 'RLS · public.users' },
  rlsTransactions: { generico: 'Aislamiento de movimientos', tecnico: 'RLS · public.transactions' },
  rlsSystemConfig: { generico: 'Configuración aislada', tecnico: 'RLS · system_config' },
};

const SEV: Record<string, { color: string; label: string; peso: number }> = {
  critica: { color: C.red, label: 'CRÍTICA', peso: 0 },
  alta: { color: C.red, label: 'ALTA', peso: 1 },
  media: { color: C.amber, label: 'MEDIA', peso: 2 },
  baja: { color: C.sub, label: 'BAJA', peso: 3 },
};

// ── Piezas ───────────────────────────────────────────────────────────────
const Casilla: React.FC<{
  titulo: string; icono?: React.ReactNode; insignia?: { texto: string; color: string } | null;
  ancho?: number; children: React.ReactNode;
}> = ({ titulo, icono, insignia, ancho = 1, children }) => (
  <div style={{
    gridColumn: `span ${ancho}`, background: C.card, border: `1px solid ${C.border2}`,
    borderRadius: 13, padding: 15, display: 'flex', flexDirection: 'column', minWidth: 0,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 9, marginBottom: 12 }}>
      <p style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 800, fontSize: 13.5, margin: 0, color: C.text, minWidth: 0 }}>
        {icono} <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titulo}</span>
      </p>
      {insignia && (
        <span style={{
          flexShrink: 0, border: `1px solid ${insignia.color}44`, color: insignia.color,
          borderRadius: 999, padding: '3px 9px', fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
        }}>{insignia.texto}</span>
      )}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
  </div>
);

const Kpi: React.FC<{ etiqueta: string; valor: string; nota: string; color: string }> = ({ etiqueta, valor, nota, color }) => (
  <div style={{ background: C.card, border: `1px solid ${C.border2}`, borderRadius: 13, padding: '14px 15px', minWidth: 0 }}>
    <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, color: C.sub, margin: 0, textTransform: 'uppercase' }}>{etiqueta}</p>
    <p style={{ fontSize: 27, fontWeight: 800, color: C.text, margin: '6px 0 0', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{valor}</p>
    <p style={{ fontSize: 11, color, margin: '6px 0 0', lineHeight: 1.4 }}>{nota}</p>
  </div>
);

const Anillo: React.FC<{ puntaje: number }> = ({ puntaje }) => {
  const r = 46, c = 2 * Math.PI * r;
  const color = puntaje >= 85 ? C.green : puntaje >= 60 ? C.amber : C.red;
  return (
    <svg width={116} height={116} viewBox="0 0 116 116" style={{ flexShrink: 0 }}>
      <circle cx="58" cy="58" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
      <circle cx="58" cy="58" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={`${(c * puntaje) / 100} ${c}`} transform="rotate(-90 58 58)" />
      <text x="58" y="55" textAnchor="middle" fill={C.text} style={{ font: `800 27px ${FONT}` }}>{puntaje}</text>
      <text x="58" y="72" textAnchor="middle" fill={C.dim} style={{ font: `700 10px ${FONT}` }}>/ 100</text>
    </svg>
  );
};

// ── Modal de confirmación con código ─────────────────────────────────────
const ModalConfirmar: React.FC<{
  userId: string; que: string; onCancelar: () => void; onListo: () => void;
}> = ({ userId, que, onCancelar, onListo }) => {
  const [codigo, setCodigo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const confirmar = async () => {
    if (codigo.length !== 6 || busy) return;
    setBusy(true); setErr(null);
    const d = await call({ action: 'mfa_verify', userId, code: codigo });
    setBusy(false);
    if (d?.ok) onListo(); else setErr(d?.message ?? 'Código incorrecto o vencido.');
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(7,8,8,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{ fontFamily: FONT, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 14, padding: 22, maxWidth: 380, width: '100%' }}>
        <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 15, margin: 0, color: C.text }}>
          <Lock size={16} color={C.green} /> Confirma con tu código
        </p>
        <p style={{ color: C.sub, fontSize: 12.5, margin: '6px 0 0', lineHeight: 1.55 }}>{que}</p>
        <input
          value={codigo} autoFocus inputMode="numeric"
          onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={e => { if (e.key === 'Enter') confirmar(); }}
          placeholder="123 456"
          style={{
            width: '100%', marginTop: 14, background: C.elev, border: `1px solid ${C.border2}`, color: C.text,
            borderRadius: 10, padding: '12px 14px', fontSize: 18, letterSpacing: 6, textAlign: 'center',
            fontFamily: MONO, outline: 'none',
          }} />
        {err && <p style={{ color: C.red, fontSize: 12, margin: '9px 0 0' }}>{err}</p>}
        <p style={{ color: C.dim, fontSize: 11, margin: '11px 0 0', lineHeight: 1.55 }}>
          Queda registrado en la auditoría con la cuenta, la conexión y la hora.
        </p>
        <button onClick={confirmar} disabled={busy || codigo.length !== 6}
          style={{
            width: '100%', marginTop: 13, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.32)',
            color: C.green, borderRadius: 10, padding: '11px 0', fontSize: 13, fontWeight: 800, fontFamily: FONT,
            cursor: busy || codigo.length !== 6 ? 'default' : 'pointer', opacity: busy || codigo.length !== 6 ? 0.55 : 1,
          }}>
          {busy ? 'Verificando…' : 'Confirmar'}
        </button>
        <button onClick={onCancelar}
          style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: C.dim, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
          Cancelar
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
export const AdminSecurityCenter: React.FC<{ userId: string }> = ({ userId }) => {
  const [discreto, setDiscreto] = useState<boolean>(() => {
    try { return localStorage.getItem('lincoin_modo_discreto') !== '0'; } catch { return true; }
  });
  const [audit, setAudit] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [salud, setSalud] = useState<any>(null);
  const [pol, setPol] = useState<any>(null);
  const [tuIp, setTuIp] = useState<{ ip: string | null; ubi: string | null; pais: string | null }>({ ip: null, ubi: null, pais: null });
  const [llaves, setLlaves] = useState<any[] | null>(null);
  const [serie, setSerie] = useState<any[]>([]);
  const [log, setLog] = useState<any[]>([]);
  const [cuentas, setCuentas] = useState<any[]>([]);
  const [buscar, setBuscar] = useState('');
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<null | { que: string; hacer: () => void }>(null);

  const cargar = async () => {
    setCargando(true);
    const [a, s, h, p, k, se, l] = await Promise.all([
      call({ action: 'security_audit' }),
      call({ action: 'security_stats' }),
      call({ action: 'mfa_health' }),
      call({ action: 'access_policy_get' }),
      call({ action: 'passkey_list', userId }),
      call({ action: 'security_series' }),
      call({ action: 'list_audit', limit: 40 }),
    ]);
    if (a?.ok) setAudit(a);
    if (s?.ok) setStats(s);
    if (h?.ok) { setSalud(h); setCuentas(h.cuentas ?? []); }
    if (p?.ok) { setPol(p.policy); setTuIp({ ip: p.tuIp ?? null, ubi: p.tuUbicacion ?? null, pais: p.tuPais ?? null }); }
    if (k?.ok) setLlaves(k.passkeys ?? []);
    if (se?.ok) setSerie(se.serie ?? []);
    if (l?.ok) setLog(l.audit ?? []);
    setCargando(false);
  };
  useEffect(() => { if (userId) cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

  const cambiarDiscreto = async () => {
    const nuevo = !discreto;
    setDiscreto(nuevo);
    try { localStorage.setItem('lincoin_modo_discreto', nuevo ? '1' : '0'); } catch { /* */ }
    // Apagarlo destapa IPs y correos en pantalla: tiene que quedar registrado.
    if (!nuevo) await call({ action: 'log_incident', service: 'panel · modo discreto apagado', kind: 'down' });
  };

  // ── Acciones sensibles ─────────────────────────────────────────────────
  const pedirConfirmacion = (que: string, hacer: () => void) => setConfirmar({ que, hacer });

  const agregarEstaConexion = () => pedirConfirmacion(
    'Vas a autorizar esta conexión para entrar al panel.',
    async () => {
      if (!pol || !tuIp.ip) return;
      const d = await call({ action: 'access_policy_set', policy: { ...pol, ips: [tuIp.ip, ...(pol.ips ?? [])] } });
      setAviso(d?.ok ? 'Conexión autorizada.' : (d?.error ?? 'No se pudo guardar.'));
      if (d?.ok) setPol(d.policy);
    });

  const registrarLlave = () => pedirConfirmacion(
    'Vas a registrar una llave nueva para entrar al panel.',
    async () => {
      try {
        const o = await call({ action: 'passkey_register_options', userId });
        if (!o?.ok) throw new Error(o?.message ?? 'No se pudo iniciar.');
        const credential = await crearPasskey(o.options);
        const v = await call({ action: 'passkey_register_verify', userId, credential });
        if (!v?.ok) throw new Error(v?.message ?? 'No se pudo registrar.');
        setLlaves(v.passkeys ?? []); setAviso('Llave registrada.');
      } catch (e: any) { setAviso(explicarErrorPasskey(e)); }
    });

  const probarLlave = async () => {
    setAviso(null);
    try {
      const o = await call({ action: 'passkey_auth_options', userId });
      if (!o?.ok) throw new Error(o?.message ?? 'No hay ninguna llave.');
      const credential = await firmarConPasskey(o.options);
      const v = await call({ action: 'passkey_auth_verify', userId, credential });
      setAviso(v?.ok ? 'La llave funciona.' : (v?.message ?? 'No se pudo verificar.'));
    } catch (e: any) { setAviso(explicarErrorPasskey(e)); }
  };

  // ── Derivados ──────────────────────────────────────────────────────────
  const puntaje = Number(audit?.score ?? 0);
  const hallazgos: any[] = (audit?.findings ?? []).slice().sort((a: any, b: any) => (SEV[a.sev]?.peso ?? 9) - (SEV[b.sev]?.peso ?? 9));
  const criticos = hallazgos.filter(h => h.sev === 'critica' || h.sev === 'alta').length;
  const fallidosHoy = Number(stats?.failedToday ?? 0);
  const ipsBloqueadas = (stats?.blockedIps ?? []).length;
  const total2fa = Number(salud?.total ?? 0);
  const sinRespaldo = Number(salud?.noBackup ?? 0);
  const conLlave = (llaves ?? []).length;
  const cubierto = !!(tuIp.ip && pol && (pol.ips?.includes(tuIp.ip) || (tuIp.pais && pol.countries?.includes(tuIp.pais))));
  const maxSerie = Math.max(1, ...serie.map((d: any) => Math.max(d.ok, d.fail)));

  const PAISES: Array<[string, string]> = [
    ['CO', 'Colombia'], ['MX', 'México'], ['PE', 'Perú'], ['CL', 'Chile'], ['AR', 'Argentina'],
    ['BR', 'Brasil'], ['EC', 'Ecuador'], ['US', 'EE. UU.'], ['ES', 'España'],
  ];

  const btn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, background: 'transparent',
    border: `1px solid ${C.border2}`, color: C.text, borderRadius: 999,
    padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
  };

  return (
    <div style={{ fontFamily: FONT, color: C.text, background: C.base, borderRadius: 16, padding: 16 }}>
      {/* ── Encabezado ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.5px', margin: 0 }}>Centro de Seguridad</p>
          <p style={{ fontSize: 12, color: C.dim, margin: '3px 0 0', fontFamily: MONO }}>
            última auditoría: {audit?.checkedAt ? new Date(audit.checkedAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={cambiarDiscreto} style={{ ...btn, color: discreto ? C.green : C.amber, borderColor: discreto ? 'rgba(74,222,128,0.32)' : 'rgba(251,191,36,0.35)' }}>
            {discreto ? <EyeOff size={13} /> : <Eye size={13} />} Modo discreto {discreto ? 'ON' : 'OFF'}
          </button>
          <button onClick={cargar} disabled={cargando}
            style={{ ...btn, background: '#F4F4F2', color: '#0A0A0A', borderColor: 'transparent', fontWeight: 800, opacity: cargando ? 0.6 : 1 }}>
            <RefreshCw size={13} /> {cargando ? 'Auditando…' : 'Auditar ahora'}
          </button>
        </div>
      </div>

      {aviso && (
        <div style={{ background: C.elev, border: `1px solid ${C.border2}`, borderRadius: 11, padding: '10px 13px', marginBottom: 14, fontSize: 12.5, color: C.sub }}>
          {aviso}
        </div>
      )}

      {/* ── Fila superior ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div style={{ gridColumn: 'span 2', background: C.card, border: `1px solid ${C.border2}`, borderRadius: 13, padding: 15, display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <Anillo puntaje={puntaje} />
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: C.sub, margin: 0 }}>POSTURA</p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '5px 0 0', lineHeight: 1.5 }}>
              {!audit ? 'Sin auditar todavía.'
                : criticos ? `${criticos} hallazgo${criticos === 1 ? '' : 's'} de atención inmediata.`
                : hallazgos.length ? 'Nada crítico. Cerrar el resto igual.'
                : 'Sin hallazgos abiertos.'}
            </p>
          </div>
        </div>
        <Kpi etiqueta="Hallazgos abiertos" valor={String(hallazgos.length)}
          nota={hallazgos.length ? hallazgos.slice(0, 3).map(h => SEV[h.sev]?.label.toLowerCase()).join(' · ') : 'ninguno'}
          color={criticos ? C.red : hallazgos.length ? C.amber : C.green} />
        <Kpi etiqueta="Fallidos hoy" valor={String(fallidosHoy)}
          nota={fallidosHoy > 20 ? 'bloqueo automático activo' : 'dentro de lo normal'}
          color={fallidosHoy > 20 ? C.red : C.sub} />
        <Kpi etiqueta="IPs bloqueadas" valor={String(ipsBloqueadas)} nota="regla: 3 intentos" color={C.sub} />
        <Kpi etiqueta="Cuentas 2FA" valor={total2fa ? `${total2fa - sinRespaldo}/${total2fa}` : '—'}
          nota={sinRespaldo ? `${sinRespaldo} sin códigos de respaldo` : 'todas con respaldo'}
          color={sinRespaldo ? C.amber : C.green} />
      </div>

      {/* ── Casillas ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 12 }}>

        {/* 1 · Intentos de ingreso */}
        <Casilla titulo="Intentos de ingreso · 14 días" icono={<Activity size={15} color={C.sub} />} ancho={2}>
          {serie.length === 0 ? (
            <p style={{ color: C.dim, fontSize: 12 }}>Sin datos todavía.</p>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 108 }}>
                {serie.map((d: any, i: number) => {
                  const hoy = i === serie.length - 1;
                  return (
                    <div key={d.dia} title={`${d.dia} · ${d.ok} ok · ${d.fail} fallidos`}
                      style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 2, height: '100%', minWidth: 0 }}>
                      <div style={{ flex: 1, height: `${(d.ok / maxSerie) * 100}%`, background: 'rgba(74,222,128,0.42)', borderRadius: '2px 2px 0 0', minHeight: d.ok ? 2 : 0 }} />
                      <div style={{ flex: 1, height: `${(d.fail / maxSerie) * 100}%`, background: hoy ? C.red : 'rgba(248,113,113,0.45)', borderRadius: '2px 2px 0 0', minHeight: d.fail ? 2 : 0 }} />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7, fontSize: 10, color: C.dim, fontFamily: MONO }}>
                <span>−14d</span><span>−7d</span><span>hoy</span>
              </div>
              <div style={{ display: 'flex', gap: 13, marginTop: 8, fontSize: 11, color: C.sub }}>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgba(74,222,128,0.42)', marginRight: 5 }} />exitosos</span>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgba(248,113,113,0.45)', marginRight: 5 }} />fallidos</span>
              </div>
            </>
          )}
        </Casilla>

        {/* 2 · Respaldo */}
        {(() => {
          const pendientes = (sinRespaldo ? 1 : 0) + (conLlave < 2 ? 1 : 0);
          const fila = (nombre: string, valor: string, color: string) => (
            <div key={nombre} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderTop: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 12.5, color: C.sub }}>{nombre}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color, textAlign: 'right' }}>{valor}</span>
            </div>
          );
          return (
            <Casilla titulo="Respaldo" icono={<Wrench size={15} color={C.sub} />}
              insignia={pendientes ? { texto: `${pendientes} PENDIENTE${pendientes === 1 ? '' : 'S'}`, color: C.amber } : { texto: 'AL DÍA', color: C.green }}>
              {fila('Códigos de respaldo 2FA', sinRespaldo ? `${sinRespaldo} sin generar` : '✓ Generados', sinRespaldo ? C.amber : C.green)}
              {fila('Segunda llave', conLlave >= 2 ? '✓ Registrada' : 'Pendiente', conLlave >= 2 ? C.green : C.amber)}
              {fila('Copia de configuración', '✓ En bóveda 🔒', C.green)}
              {fila('Salida de emergencia', '✓ En bóveda 🔒', C.green)}
              <p style={{ color: C.dim, fontSize: 10.5, margin: '10px 0 0', lineHeight: 1.5 }}>
                La salida de emergencia está documentada en la Bóveda. No se muestra acá, a propósito.
              </p>
            </Casilla>
          );
        })()}

        {/* 3 · Hallazgos */}
        <Casilla titulo="Hallazgos" icono={<AlertTriangle size={15} color={hallazgos.length ? C.amber : C.sub} />}
          insignia={hallazgos.length ? { texto: `${hallazgos.length} ABIERTO${hallazgos.length === 1 ? '' : 'S'}`, color: criticos ? C.red : C.amber } : { texto: 'LIMPIO', color: C.green }}>
          {hallazgos.length === 0 ? (
            <p style={{ color: C.sub, fontSize: 12.5, lineHeight: 1.5 }}>
              {audit ? 'No hay nada abierto en la última auditoría.' : 'Toca «Auditar ahora» para revisar.'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {hallazgos.slice(0, 6).map((h: any) => (
                <div key={h.id} style={{ display: 'flex', gap: 8 }}>
                  <span style={{ flexShrink: 0, color: SEV[h.sev]?.color ?? C.sub, fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, marginTop: 2 }}>
                    {SEV[h.sev]?.label ?? h.sev}
                  </span>
                  <span style={{ fontSize: 12.5, color: C.text, lineHeight: 1.45, minWidth: 0 }}>{h.title}</span>
                </div>
              ))}
            </div>
          )}
        </Casilla>

        {/* 4 · Defensas de la base */}
        {(() => {
          const p = audit?.posture ?? null;
          const claves = Object.keys(NOMBRE_DEFENSA).filter(k => p && k in p);
          const ok = claves.filter(k => p[k] !== false).length;
          return (
            <Casilla titulo="Defensas de la base" icono={<ShieldCheck size={15} color={C.sub} />}
              insignia={claves.length ? { texto: `${ok}/${claves.length} OK`, color: ok === claves.length ? C.green : C.red } : null}>
              {!p ? (
                <p style={{ color: C.sub, fontSize: 12.5, lineHeight: 1.5 }}>No se pudo verificar el blindaje. Corre la auditoría.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {claves.map(k => (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12.5, color: C.sub, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: discreto ? FONT : MONO }}>
                        {discreto ? NOMBRE_DEFENSA[k].generico : NOMBRE_DEFENSA[k].tecnico}
                      </span>
                      <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 800, color: p[k] === false ? C.red : C.green }}>
                        {p[k] === false ? '✕' : '✓'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Casilla>
          );
        })()}

        {/* 5 · Acceso permitido */}
        <Casilla titulo="Acceso permitido" icono={<Globe size={15} color={pol?.enabled ? C.green : C.sub} />}
          insignia={pol ? { texto: pol.enabled ? 'ENCENDIDO' : 'APAGADO', color: pol.enabled ? C.green : C.sub } : null}>
          <div style={{ background: C.elev, border: `1px solid ${cubierto || !pol?.enabled ? C.border : 'rgba(251,191,36,0.35)'}`, borderRadius: 10, padding: '10px 12px' }}>
            <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: C.sub, margin: '0 0 5px' }}>ESTA CONEXIÓN</p>
            <p style={{ fontFamily: MONO, fontSize: 12.5, margin: 0, color: C.text }}>
              {ocultarIp(tuIp.ip, discreto)} <span style={{ color: C.dim }}>· {tuIp.ubi ?? 'ubicación no disponible'}</span>
            </p>
            {pol?.enabled && (
              <p style={{ fontSize: 11, margin: '5px 0 0', color: cubierto ? C.green : C.amber }}>
                {cubierto ? '✓ permitida' : '⚠ NO está en la lista'}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 11 }}>
            {PAISES.map(([cc, nombre]) => {
              const on = pol?.countries?.includes(cc);
              return (
                <span key={cc} style={{
                  background: on ? 'rgba(74,222,128,0.12)' : C.elev,
                  border: `1px solid ${on ? 'rgba(74,222,128,0.32)' : C.border}`,
                  color: on ? C.green : C.dim, borderRadius: 7, padding: '4px 9px', fontSize: 11, fontWeight: 700,
                }}>{nombre}</span>
              );
            })}
          </div>
          {tuIp.ip && !pol?.ips?.includes(tuIp.ip) && (
            <button onClick={agregarEstaConexion} style={{ ...btn, marginTop: 11, borderRadius: 9, color: C.green, borderColor: 'rgba(74,222,128,0.32)' }}>
              <Plus size={13} /> Agregar esta conexión
            </button>
          )}
          <p style={{ color: C.amber, fontSize: 10.5, margin: '10px 0 0', lineHeight: 1.5 }}>
            Si viajas, agrega la conexión nueva ANTES de moverte.
          </p>
        </Casilla>

        {/* 6 · Passkeys */}
        <Casilla titulo="Llaves del dispositivo" icono={<KeyRound size={15} color={conLlave ? C.green : C.sub} />}
          insignia={{ texto: `${conLlave} DE 2`, color: conLlave >= 2 ? C.green : C.amber }}>
          {conLlave === 0 ? (
            <p style={{ color: C.sub, fontSize: 12.5, lineHeight: 1.5 }}>Todavía no hay ninguna llave registrada.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(llaves ?? []).map((l: any) => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: C.elev, border: `1px solid ${C.border}`, borderRadius: 9, padding: '8px 10px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, minWidth: 0 }}>
                    <Fingerprint size={13} color={C.green} style={{ flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.nombre}</span>
                  </span>
                  <button onClick={probarLlave} style={{ ...btn, padding: '4px 10px', fontSize: 11 }}>Probar</button>
                </div>
              ))}
            </div>
          )}
          {soportaPasskey() && (
            <button onClick={registrarLlave} style={{ ...btn, marginTop: 10, borderRadius: 9, color: C.green, borderColor: 'rgba(74,222,128,0.32)' }}>
              <Plus size={13} /> Registrar {conLlave ? 'segunda ' : ''}llave
            </button>
          )}
          <p style={{ color: C.dim, fontSize: 10.5, margin: '10px 0 0', lineHeight: 1.5 }}>
            La llave nunca sale del dispositivo. Registra dos: con una sola, perderla cierra el ingreso.
          </p>
        </Casilla>

        {/* 7 · Salud 2FA por cuenta */}
        <Casilla titulo="Salud del 2FA por cuenta" icono={<Lock size={15} color={C.sub} />} ancho={2}
          insignia={total2fa ? { texto: `${total2fa} CON 2FA`, color: sinRespaldo ? C.amber : C.green } : null}>
          <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar cuenta…"
            style={{ width: '100%', background: C.elev, border: `1px solid ${C.border}`, color: C.text, borderRadius: 9, padding: '8px 11px', fontSize: 12.5, outline: 'none', fontFamily: FONT, marginBottom: 10 }} />
          {cuentas.length === 0 ? (
            <p style={{ color: C.sub, fontSize: 12.5, lineHeight: 1.5 }}>
              {salud ? 'Ninguna cuenta tiene el 2FA activo todavía.' : 'Corre la auditoría para revisarlas.'}
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 6 }}>
              {cuentas
                .filter((c: any) => !buscar || String(c.email ?? '').toLowerCase().includes(buscar.toLowerCase()))
                .slice(0, 12)
                .map((c: any, i: number) => {
                  const mal = !!c.problema || !c.conRespaldo;
                  const etiqueta = c.problema ? String(c.problema).toUpperCase() : (c.conRespaldo ? '2FA + RESPALDO' : 'SIN RESPALDO');
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: C.elev, border: `1px solid ${C.border}`, borderRadius: 9, padding: '8px 10px', minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontFamily: MONO, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ocultarCorreo(c.email, discreto)}
                      </span>
                      <span style={{ flexShrink: 0, border: `1px solid ${(mal ? C.amber : C.green)}44`, color: mal ? C.amber : C.green, borderRadius: 999, padding: '2px 8px', fontSize: 9.5, fontWeight: 800, whiteSpace: 'nowrap' }}>
                        {etiqueta}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </Casilla>

        {/* 8 · Auditoría en vivo */}
        <Casilla titulo="Auditoría en vivo" icono={<Activity size={15} color={C.sub} />}>
          {log.length === 0 ? (
            <p style={{ color: C.sub, fontSize: 12.5 }}>Sin movimientos registrados.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 200, overflowY: 'auto' }}>
              {log.slice(0, 25).map((r: any, i: number) => (
                <p key={i} style={{ fontFamily: MONO, fontSize: 10.5, color: C.dim, margin: 0, lineHeight: 1.6, wordBreak: 'break-word' }}>
                  <span style={{ color: C.sub }}>
                    {new Date(r.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                  </span>{' '}
                  {String(r.action ?? '').replace(/[._]/g, ' ')}
                  {r?.metadata?.ip ? ` · ${ocultarIp(r.metadata.ip, discreto)}` : ''}
                </p>
              ))}
            </div>
          )}
        </Casilla>
      </div>

      {confirmar && (
        <ModalConfirmar
          userId={userId} que={confirmar.que}
          onCancelar={() => setConfirmar(null)}
          onListo={() => { const f = confirmar.hacer; setConfirmar(null); f(); }}
        />
      )}
    </div>
  );
};
