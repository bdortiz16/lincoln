import React, { useEffect, useMemo, useRef, useState } from 'react';
import { geoMercator, geoPath, geoGraticule10 } from 'd3-geo';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
import { feature } from 'topojson-client';

// ─────────────────────────────────────────────────────────────
// AdminCommandCenter — mapa en vivo de las conexiones.
//
// Cada punto es una IP REAL: sale de la auditoría (ingresos de admin, avisos
// de ingreso de clientes, intentos fallidos) y de la lista de bloqueos, y se
// ubica con la misma geolocalización que ya usa el panel.
//
// NO HAY PUNTOS DE EJEMPLO NI ATAQUES SIMULADOS. Un mapa de seguridad que
// inventa incidentes enseña a ignorarlo, y el día que aparezca uno de verdad
// se va a ver igual que el relleno. Lo que se mueve acá se movió de verdad.
//
// Modo discreto (encendido por defecto): enmascara las IPs en el mapa, en las
// listas y en el detalle. Esta pantalla es para mirarla en una sala.
// ─────────────────────────────────────────────────────────────

const C = {
  base: '#070808', panel: 'rgba(12,14,13,0.92)', elev: '#121413',
  border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  tierra: '#10150f', costa: '#1c2620',
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
    return await r.json();
  } catch { return null; }
};

const ocultarIp = (ip: string, on: boolean) => {
  if (!on) return ip;
  const p = String(ip).split('.');
  return p.length === 4 ? `${p[0]}.··.···.${p[3]}` : `${String(ip).slice(0, 4)}····`;
};
// Sin acentos y en minúscula: buscar "bogota" tiene que encontrar "Bogotá".
const plano = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type Tipo = 'admin' | 'usuario' | 'fallido' | 'bloqueada';
const COLOR: Record<Tipo, string> = { admin: C.green, usuario: '#E9EDE9', fallido: C.amber, bloqueada: C.red };
const NOMBRE_TIPO: Record<Tipo, string> = { admin: 'Admins', usuario: 'Usuarios', fallido: 'Intentos fallidos', bloqueada: 'Bloqueadas' };

// Iconos de línea propios — nada de emojis en la interfaz.
const Ico: React.FC<{ d: string; size?: number; color?: string }> = ({ d, size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.3}
    strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d={d} /></svg>
);
const D = {
  ojo: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  ojoOff: 'M3 3l18 18 M10.6 10.6a3 3 0 0 0 4.2 4.2 M9.4 5.2A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4 M6.2 6.7C3.7 8.3 2 12 2 12s3.6 7 10 7c1.2 0 2.3-.2 3.3-.6',
  lupa: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.3-4.3',
  globo: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3 12h18 M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z',
  escudo: 'M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3Z',
  actividad: 'M3 12h4l3 8 4-16 3 8h4',
  expandir: 'M4 9V4h5 M20 15v5h-5 M4 4l6 6 M20 20l-6-6',
  cerrar: 'M6 6l12 12 M18 6L6 18',
  candado: 'M6 11h12v9H6z M9 11V7a3 3 0 1 1 6 0v4',
  reloj: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3 2',
};

type Punto = {
  ip: string; tipo: Tipo; sesiones: number; primera: string; ultima: string;
  nombre?: string | null; correo?: string | null; ciudad?: string | null; pais?: string | null;
  isp?: string | null; lat?: number | null; lon?: number | null; motivo?: string | null;
};

const ANCHO = 960, ALTO = 560;

export const AdminCommandCenter: React.FC = () => {
  const [puntos, setPuntos] = useState<Punto[]>([]);
  const [mundo, setMundo] = useState<any>(null);
  const [discreto, setDiscreto] = useState(() => {
    try { return localStorage.getItem('lincoin_modo_discreto') !== '0'; } catch { return true; }
  });
  const [busca, setBusca] = useState('');
  const [apagados, setApagados] = useState<Set<Tipo>>(new Set());
  const [sel, setSel] = useState<Punto | null>(null);
  const [hover, setHover] = useState<{ p: Punto; x: number; y: number } | null>(null);
  const [log, setLog] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [latencias, setLatencias] = useState<Record<string, number | null>>({});
  const [confirmar, setConfirmar] = useState<null | { punto: Punto; accion: 'bloquear' | 'desbloquear' }>(null);
  const [cargando, setCargando] = useState(true);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const zoomRef = useRef<any>(null);
  const [k, setK] = useState(1);

  // ── Datos ──────────────────────────────────────────────────────────────
  const cargar = async () => {
    const [m, l, s, a] = await Promise.all([
      call({ action: 'command_map', dias: 30 }),
      call({ action: 'list_audit', limit: 20 }),
      call({ action: 'security_stats' }),
      call({ action: 'security_audit' }),
    ]);
    if (m?.ok) setPuntos(m.puntos ?? []);
    if (l?.ok) setLog(l.audit ?? []);
    if (s?.ok) setStats(s);
    if (a?.ok) setAudit(a);
    setCargando(false);
  };
  useEffect(() => {
    cargar();
    // Se refresca solo. NO se inventan eventos: si no pasó nada, no se mueve.
    const t = setInterval(cargar, 30_000);
    return () => clearInterval(t);
  }, []);

  // Geometría real del mundo.
  useEffect(() => {
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json')
      .then(r => r.json())
      .then(topo => setMundo((feature as any)(topo, topo.objects.countries)))
      .catch(() => setMundo(null));
  }, []);

  // Latencia REAL de los rieles: se mide el viaje de ida y vuelta contra cada
  // servicio. Un número inventado acá no dice nada de si el riel responde.
  useEffect(() => {
    const medir = async () => {
      const rieles: Array<[string, string]> = [
        ['Riel de conversión', 'finity-proxy'],
        ['GasFree (TRON)', 'gasfree'],
        ['Bre-B · ACH', 'mouv-proxy'],
        ['Base de datos', 'admin-data'],
      ];
      const out: Record<string, number | null> = {};
      await Promise.all(rieles.map(async ([nombre, fn]) => {
        const t0 = performance.now();
        try {
          await fetch(`${SURL}/functions/v1/${fn}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tokenOf() ?? SKEY}` },
            body: JSON.stringify({ action: 'ping' }),
          });
          out[nombre] = Math.round(performance.now() - t0);
        } catch { out[nombre] = null; }
      }));
      setLatencias(out);
    };
    medir();
    const t = setInterval(medir, 15_000);
    return () => clearInterval(t);
  }, []);

  // ── Proyección y zoom ──────────────────────────────────────────────────
  const proyeccion = useMemo(
    () => geoMercator().center([-40, 25]).scale(190).translate([ANCHO / 2, ALTO / 2]),
    []);
  const trazo = useMemo(() => geoPath(proyeccion as any), [proyeccion]);

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 16])
      .on('zoom', (ev: any) => {
        select(gRef.current as any).attr('transform', ev.transform.toString());
        setK(ev.transform.k);
      });
    zoomRef.current = z;
    select(svgRef.current as any).call(z as any);
  }, []);

  const irA = (p: Punto) => {
    if (!svgRef.current || !zoomRef.current || p.lat == null || p.lon == null) return;
    const xy = proyeccion([p.lon, p.lat] as any);
    if (!xy) return;
    const destino = zoomIdentity.translate(ANCHO / 2, ALTO / 2).scale(13).translate(-xy[0], -xy[1]);
    select(svgRef.current as any).transition().duration(750).call(zoomRef.current.transform as any, destino);
    setSel(p);
  };
  const vistaGlobal = () => {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current as any).transition().duration(600).call(zoomRef.current.transform as any, zoomIdentity);
    setSel(null);
  };

  // ── Filtros ────────────────────────────────────────────────────────────
  const alternarTipo = (t: Tipo) => setApagados(prev => {
    const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n;
  });

  const visibles = useMemo(() => puntos.filter(p => {
    if (apagados.has(p.tipo)) return false;
    if (!busca.trim()) return true;
    const q = plano(busca);
    return plano(p.ip).includes(q) || plano(p.nombre).includes(q)
      || plano(p.correo).includes(q) || plano(p.ciudad).includes(q) || plano(p.pais).includes(q);
  }), [puntos, apagados, busca]);

  const enMapa = visibles.filter(p => p.lat != null && p.lon != null);
  const bloqueadas = puntos.filter(p => p.tipo === 'bloqueada');
  const admins = puntos.filter(p => p.tipo === 'admin').length;
  const usuarios = puntos.filter(p => p.tipo === 'usuario').length;

  // ── Bloquear / desbloquear ─────────────────────────────────────────────
  const ejecutar = async () => {
    if (!confirmar) return;
    const { punto, accion } = confirmar;
    setConfirmar(null);
    const d = await call({ action: accion === 'bloquear' ? 'block_ip' : 'unblock_ip', ip: punto.ip });
    if (d?.ok) {
      setPuntos(prev => prev.map(p => p.ip === punto.ip
        ? { ...p, tipo: accion === 'bloquear' ? 'bloqueada' : (p.nombre ? 'usuario' : 'fallido') }
        : p));
      setSel(null);
      cargar();
    }
  };

  const card: React.CSSProperties = {
    background: C.panel, backdropFilter: 'blur(8px)', border: `1px solid ${C.border2}`,
    borderRadius: 13, padding: 13, fontFamily: FONT, color: C.text,
  };
  const rotulo: React.CSSProperties = { fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: C.sub, margin: 0, textTransform: 'uppercase' };

  return (
    <div style={{ position: 'relative', background: C.base, borderRadius: 16, overflow: 'hidden', minHeight: 620, fontFamily: FONT }}>

      {/* ── Barra superior ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '11px 14px', borderBottom: `1px solid ${C.border}`, background: 'rgba(7,8,8,0.85)',
        backdropFilter: 'blur(8px)', position: 'relative', zIndex: 3, flexWrap: 'nowrap', overflowX: 'auto',
      }}>
        <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.4px', whiteSpace: 'nowrap' }}>
          Lincoin<span style={{ color: C.green }}>.</span>
          <span style={{ color: C.sub, fontWeight: 700, fontSize: 12, marginLeft: 9 }}>Centro de Comando</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button onClick={() => {
            const n = !discreto; setDiscreto(n);
            try { localStorage.setItem('lincoin_modo_discreto', n ? '1' : '0'); } catch { /* */ }
          }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, background: 'transparent',
              border: `1px solid ${discreto ? 'rgba(74,222,128,0.32)' : 'rgba(251,191,36,0.35)'}`,
              color: discreto ? C.green : C.amber, borderRadius: 999, padding: '6px 13px',
              fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap',
            }}>
            <Ico d={discreto ? D.ojoOff : D.ojo} size={13} /> Modo discreto {discreto ? 'ON' : 'OFF'}
          </button>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 6, border: '1px solid rgba(74,222,128,0.28)',
            color: C.green, borderRadius: 999, padding: '6px 13px', fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green }} /> Sistema Online
          </span>
        </div>
      </div>

      {/* ── Mapa ── */}
      <div style={{ position: 'relative' }}>
        <svg ref={svgRef} viewBox={`0 0 ${ANCHO} ${ALTO}`} style={{ width: '100%', display: 'block', background: C.base, cursor: 'grab' }}>
          <g ref={gRef}>
            <path d={trazo(geoGraticule10() as any) ?? ''} fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth={0.5} />
            {mundo?.features?.map((f: any, i: number) => (
              <path key={i} d={trazo(f) ?? ''} fill={C.tierra} stroke={C.costa} strokeWidth={0.4} />
            ))}
            {enMapa.map(p => {
              const xy = proyeccion([p.lon as number, p.lat as number] as any);
              if (!xy) return null;
              const col = COLOR[p.tipo];
              return (
                <g key={p.ip} transform={`translate(${xy[0]},${xy[1]}) scale(${1 / k})`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => irA(p)}
                  onMouseEnter={() => setHover({ p, x: xy[0], y: xy[1] })}
                  onMouseLeave={() => setHover(null)}>
                  <circle r={4} fill="none" stroke={col} strokeWidth={1.1} opacity={0.75}>
                    <animate attributeName="r" values="4;13;4" dur="2.6s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.75;0;0.75" dur="2.6s" repeatCount="indefinite" />
                  </circle>
                  <circle r={3.4} fill={col} />
                  {p.tipo === 'bloqueada' && (
                    <path d="M-1.6,-1.6 L1.6,1.6 M1.6,-1.6 L-1.6,1.6" stroke={C.base} strokeWidth={1} strokeLinecap="round" />
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {hover && (() => {
          const xy = proyeccion([hover.p.lon as number, hover.p.lat as number] as any);
          if (!xy) return null;
          return (
            <div style={{
              position: 'absolute', left: `${(xy[0] / ANCHO) * 100}%`, top: `${(xy[1] / ALTO) * 100}%`,
              transform: 'translate(12px, -50%)', pointerEvents: 'none', zIndex: 4,
              background: C.panel, border: `1px solid ${C.border2}`, borderRadius: 9, padding: '7px 10px',
            }}>
              <p style={{ fontSize: 11.5, fontWeight: 700, margin: 0, color: C.text }}>{hover.p.nombre ?? NOMBRE_TIPO[hover.p.tipo]}</p>
              <p style={{ fontSize: 10.5, margin: '2px 0 0', color: C.sub, fontFamily: MONO }}>
                {ocultarIp(hover.p.ip, discreto)} · {hover.p.ciudad ?? '—'}
              </p>
            </div>
          );
        })()}

        {/* Buscador + leyenda con filtros */}
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 3, width: 'min(420px, 90%)' }}>
          <div style={{ ...card, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Ico d={D.lupa} size={14} color={C.sub} />
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar IP, usuario o ciudad…"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: C.text, fontSize: 12.5, fontFamily: FONT }} />
            {k > 1.05 && (
              <button onClick={vistaGlobal} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: `1px solid ${C.border2}`, color: C.sub, borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' }}>
                <Ico d={D.expandir} size={11} /> Vista global
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 7, justifyContent: 'center', flexWrap: 'wrap' }}>
            {(['admin', 'usuario', 'fallido', 'bloqueada'] as Tipo[]).map(t => {
              const off = apagados.has(t);
              return (
                <button key={t} onClick={() => alternarTipo(t)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, background: C.panel,
                    border: `1px solid ${C.border2}`, color: off ? C.dim : C.text, borderRadius: 999,
                    padding: '4px 11px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
                    opacity: off ? 0.5 : 1,
                  }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: COLOR[t], opacity: off ? 0.4 : 1 }} />
                  {NOMBRE_TIPO[t]}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Tarjetas izquierda ── */}
        <div style={{
          position: 'absolute', top: 12, left: 12, zIndex: 2, width: 244,
          display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 'calc(100% - 24px)', overflowY: 'auto',
        }}>
          <div style={card}>
            <p style={{ ...rotulo, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green }} /> Conexiones · 30 días
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
              {[
                ['Admins', admins, C.green],
                ['Usuarios', usuarios, C.text],
                ['Bloqueadas', bloqueadas.length, C.red],
                ['Fallidos hoy', Number(stats?.failedToday ?? 0), C.amber],
              ].map(([n, v, col]: any) => (
                <div key={n}>
                  <p style={{ fontSize: 21, fontWeight: 800, color: col, margin: 0, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{v}</p>
                  <p style={{ fontSize: 10, color: C.dim, margin: '3px 0 0' }}>{n}</p>
                </div>
              ))}
            </div>
          </div>

          <div style={card}>
            <p style={{ ...rotulo, display: 'flex', alignItems: 'center', gap: 6 }}><Ico d={D.escudo} size={12} color={C.sub} /> Postura</p>
            <p style={{ fontSize: 30, fontWeight: 800, margin: '7px 0 0', lineHeight: 1, color: (audit?.score ?? 0) >= 85 ? C.green : C.amber, fontVariantNumeric: 'tabular-nums' }}>
              {audit?.score ?? '—'}<span style={{ fontSize: 13, color: C.dim, fontWeight: 700 }}> / 100</span>
            </p>
            <p style={{ fontSize: 11, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>
              {audit ? `${(audit.findings ?? []).length} hallazgo(s) abiertos` : 'sin auditar'}
            </p>
          </div>

          <div style={card}>
            <p style={{ ...rotulo, display: 'flex', alignItems: 'center', gap: 6 }}><Ico d={D.globo} size={12} color={C.sub} /> Quién y dónde</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 9, maxHeight: 168, overflowY: 'auto' }}>
              {visibles.slice(0, 20).map(p => (
                <button key={p.ip} onClick={() => irA(p)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: 'none', padding: '3px 0', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: COLOR[p.tipo], flexShrink: 0 }} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.nombre ?? NOMBRE_TIPO[p.tipo]}
                    </span>
                    <span style={{ display: 'block', fontSize: 10, color: C.dim, fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ocultarIp(p.ip, discreto)} · {p.ciudad ?? '—'}
                    </span>
                  </span>
                </button>
              ))}
              {visibles.length === 0 && (
                <p style={{ fontSize: 11, color: C.dim, margin: 0 }}>{cargando ? 'Cargando…' : 'Sin conexiones que mostrar.'}</p>
              )}
            </div>
          </div>

          <div style={card}>
            <p style={{ ...rotulo, display: 'flex', alignItems: 'center', gap: 6 }}><Ico d={D.actividad} size={12} color={C.sub} /> Latencia de rieles</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 9 }}>
              {(Object.entries(latencias) as Array<[string, number | null]>).map(([n, ms]) => (
                <div key={n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, fontFamily: MONO, color: ms == null ? C.red : ms > 1200 ? C.amber : C.green, flexShrink: 0 }}>
                    {ms == null ? 'sin respuesta' : `${ms} ms`}
                  </span>
                </div>
              ))}
              {Object.keys(latencias).length === 0 && <p style={{ fontSize: 11, color: C.dim, margin: 0 }}>Midiendo…</p>}
            </div>
          </div>
        </div>

        {/* ── Detalle ── */}
        {sel && (
          <div style={{ ...card, position: 'absolute', top: 12, right: 12, zIndex: 4, width: 254, maxHeight: 'calc(100% - 24px)', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13.5, fontWeight: 800, margin: 0 }}>{sel.nombre ?? NOMBRE_TIPO[sel.tipo]}</p>
                <p style={{ fontSize: 10.5, color: COLOR[sel.tipo], margin: '2px 0 0', fontWeight: 700 }}>{NOMBRE_TIPO[sel.tipo].toUpperCase()}</p>
              </span>
              <button onClick={() => setSel(null)} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', display: 'flex' }}>
                <Ico d={D.cerrar} size={14} />
              </button>
            </div>
            <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {([
                ['IP', ocultarIp(sel.ip, discreto), true],
                ['Ciudad', [sel.ciudad, sel.pais].filter(Boolean).join(', ') || '—', false],
                ['Operador', sel.isp ?? '—', false],
                ['Primera vez', new Date(sel.primera).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }), true],
                ['Última actividad', new Date(sel.ultima).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }), true],
                ['Eventos', String(sel.sesiones), true],
                ...(sel.motivo ? [['Motivo', sel.motivo, false] as any] : []),
              ] as Array<[string, string, boolean]>).map(([n, v, mono]) => (
                <div key={n} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11, color: C.dim, flexShrink: 0 }}>{n}</span>
                  <span style={{ fontSize: 11, color: C.text, fontFamily: mono ? MONO : FONT, textAlign: 'right', minWidth: 0, wordBreak: 'break-word' }}>{v}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => setConfirmar({ punto: sel, accion: sel.tipo === 'bloqueada' ? 'desbloquear' : 'bloquear' })}
              style={{
                width: '100%', marginTop: 12, background: sel.tipo === 'bloqueada' ? 'transparent' : 'rgba(248,113,113,0.12)',
                border: `1px solid ${sel.tipo === 'bloqueada' ? C.border2 : 'rgba(248,113,113,0.35)'}`,
                color: sel.tipo === 'bloqueada' ? C.text : C.red, borderRadius: 9, padding: '9px 0',
                fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT,
              }}>
              {sel.tipo === 'bloqueada' ? 'Desbloquear IP' : 'Bloquear IP'}
            </button>
          </div>
        )}

        {/* ── Abajo derecha ── */}
        <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 2, width: 254, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={card}>
            <p style={{ ...rotulo, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Ico d={D.candado} size={12} color={C.sub} /> IPs bloqueadas
              <span style={{ marginLeft: 'auto', color: bloqueadas.length ? C.red : C.dim, fontWeight: 800 }}>{bloqueadas.length}</span>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 9, maxHeight: 108, overflowY: 'auto' }}>
              {bloqueadas.length === 0 && <p style={{ fontSize: 11, color: C.dim, margin: 0 }}>Ninguna.</p>}
              {bloqueadas.map(p => (
                <div key={p.ip} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 7 }}>
                  <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.sub, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ocultarIp(p.ip, discreto)}
                  </span>
                  <button onClick={() => setConfirmar({ punto: p, accion: 'desbloquear' })}
                    style={{ flexShrink: 0, background: 'transparent', border: `1px solid ${C.border2}`, color: C.sub, borderRadius: 999, padding: '2px 9px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                    Desbloquear
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div style={card}>
            <p style={{ ...rotulo, display: 'flex', alignItems: 'center', gap: 6 }}><Ico d={D.reloj} size={12} color={C.sub} /> Auditoría en vivo</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8 }}>
              {log.slice(0, 8).map((r: any, i: number) => (
                <p key={i} style={{ fontFamily: MONO, fontSize: 9.5, color: C.dim, margin: 0, lineHeight: 1.55, wordBreak: 'break-word' }}>
                  <span style={{ color: C.sub }}>{new Date(r.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>{' '}
                  {String(r.action ?? '')}
                </p>
              ))}
              {log.length === 0 && <p style={{ fontSize: 11, color: C.dim, margin: 0 }}>Sin movimientos.</p>}
            </div>
          </div>
        </div>
      </div>

      {/* ── Confirmación (propia, nunca la del navegador) ── */}
      {confirmar && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 9, background: 'rgba(7,8,8,0.86)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ ...card, maxWidth: 360, width: '100%' }}>
            <p style={{ fontWeight: 800, fontSize: 15, margin: 0 }}>
              {confirmar.accion === 'bloquear' ? 'Bloquear esta conexión' : 'Desbloquear esta conexión'}
            </p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '7px 0 0', lineHeight: 1.55 }}>
              {confirmar.accion === 'bloquear'
                ? 'Dejará de poder operar contra Lincoin desde esa dirección.'
                : 'Volverá a poder operar desde esa dirección.'}
            </p>
            <p style={{ fontSize: 12, fontFamily: MONO, color: C.text, margin: '9px 0 0' }}>{ocultarIp(confirmar.punto.ip, discreto)}</p>
            <p style={{ fontSize: 11, color: C.dim, margin: '9px 0 0', lineHeight: 1.55 }}>
              Queda en la auditoría con la cuenta, la conexión y la hora.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 13 }}>
              <button onClick={() => setConfirmar(null)}
                style={{ flex: 1, background: 'transparent', border: `1px solid ${C.border2}`, color: C.sub, borderRadius: 9, padding: '9px 0', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                Cancelar
              </button>
              <button onClick={ejecutar}
                style={{
                  flex: 1.3, background: confirmar.accion === 'bloquear' ? 'rgba(248,113,113,0.14)' : 'rgba(74,222,128,0.12)',
                  border: `1px solid ${confirmar.accion === 'bloquear' ? 'rgba(248,113,113,0.35)' : 'rgba(74,222,128,0.32)'}`,
                  color: confirmar.accion === 'bloquear' ? C.red : C.green,
                  borderRadius: 9, padding: '9px 0', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT,
                }}>
                {confirmar.accion === 'bloquear' ? 'Bloquear' : 'Desbloquear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
