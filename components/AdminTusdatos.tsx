import React, { useEffect, useRef, useState } from 'react';
import { useDatabase } from '../context/DatabaseContext';
import { AdminStepUp } from './AdminStepUp';

// ─────────────────────────────────────────────────────────────
// AdminTusdatos — centro de control de la verificación de antecedentes.
//
// Antes era una tarjeta de configuración: servía para encender la
// integración y poco más. Pero lo que se necesita a diario no es configurar,
// es SABER SI ESTÁ FUNCIONANDO — y cuando algo falla, saber de qué lado.
//
// Por eso la pantalla separa dos cosas que se confundían:
//   · Nuestra conexión — si llegamos con nuestra credencial.
//   · El estado del proveedor — si las fuentes oficiales están arriba.
// Una credencial perfecta y la Registraduría caída dan consultas
// incompletas, y sin esta distinción eso se lee como "la integración falla".
//
// Y una consecuencia que merece su propia tarjeta: con fuentes caídas NO se
// aprueba ni se rechaza con datos parciales. Esas verificaciones quedan en
// una cola y se completan cuando la fuente vuelve.
// ─────────────────────────────────────────────────────────────

const C = {
  doc: '#070808', chrome: '#0A0C0B', card: '#0C0E0D', elev: '#121413',
  b1: 'rgba(255,255,255,0.08)', b2: 'rgba(255,255,255,0.12)',
  text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)',
  green: '#4ADE80',
  // Los estados degradados NO usan rojo ni amarillo de sistema: un panel
  // lleno de semáforos hace que todo parezca una emergencia y se deja de
  // mirar. Van en neutro, y la gravedad la da el texto.
  tenue: 'rgba(244,244,242,0.7)',
};
const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, Menlo, monospace';

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
  const r = await fetch(`${SURL}/functions/v1/tusdatos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tokenOf() ?? SKEY}` },
    body: JSON.stringify(body),
  });
  const t = await r.text().catch(() => '');
  try { return JSON.parse(t); } catch { /* no-JSON */ }
  if (r.status === 404) return { error: 'El servicio todavía no está publicado. Espera a que termine el despliegue y recarga.' };
  return { error: `El servidor respondió ${r.status}` };
};

const hace = (iso?: string | null) => {
  if (!iso) return '—';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'hace un momento';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
};
const hora = (iso?: string | null) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
};
const enmascarar = (doc?: string | null) => {
  const d = String(doc ?? '').replace(/\D/g, '');
  return d.length > 4 ? `••••${d.slice(-4)}` : d || '—';
};
const num = (n: number) => (Number(n) || 0).toLocaleString('es-CO').replace(/\./g, ' ');

// ── Piezas ───────────────────────────────────────────────────────────────
const Ico: React.FC<{ d: string; size?: number }> = ({ d, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
    strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const I = {
  lupa: 'M9 15.5a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM17.5 17.5l-4-4',
  refrescar: 'M17 10a7 7 0 11-2-4.9M17 3.5V7h-3.5',
  enchufe: 'M7 3v5m6-5v5M5 8h10v2a5 5 0 01-10 0zM10 15v3',
  info: 'M10 9v5M10 6.5v.01M10 17.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15z',
  check: 'M4.5 10.5l3.5 3.5 7.5-8',
  chevron: 'M7.5 5l5 5-5 5',
  flecha: 'M4 10h11M11 6l4 4-4 4',
};

const Punto: React.FC<{ ok: boolean; size?: number }> = ({ ok, size = 6 }) => (
  <span style={{ width: size, height: size, borderRadius: '50%', background: ok ? C.green : C.sub, flexShrink: 0, display: 'inline-block' }} />
);

const Pill: React.FC<{ ok?: boolean; children: React.ReactNode }> = ({ ok, children }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 5,
    border: `1px solid ${ok ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.14)'}`,
    color: ok ? C.green : C.tenue, borderRadius: 999, padding: '4px 10px',
    fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', whiteSpace: 'nowrap',
  }}>{ok !== undefined && <Punto ok={!!ok} />}{children}</span>
);

const Toggle: React.FC<{ on: boolean; onClick: () => void; label: string }> = ({ on, onClick, label }) => (
  <button role="switch" aria-checked={on} aria-label={label} onClick={onClick}
    style={{
      width: 36, height: 20, borderRadius: 999, flexShrink: 0, position: 'relative', cursor: 'pointer',
      background: on ? 'rgba(74,222,128,0.25)' : 'rgba(255,255,255,0.1)',
      border: `1px solid ${on ? 'rgba(74,222,128,0.4)' : C.b2}`, transition: 'background 150ms',
    }}>
    <span style={{ position: 'absolute', top: 2, left: on ? 17 : 2, width: 14, height: 14, borderRadius: '50%', background: on ? C.green : C.sub, transition: 'left 150ms' }} />
  </button>
);

const Tarjeta: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: C.card, border: `1px solid ${C.b1}`, borderRadius: 14, padding: '16px 17px', ...style }}>{children}</div>
);
const Etiqueta: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>{children}</p>
);
const Titulo: React.FC<{ children: React.ReactNode; extra?: React.ReactNode }> = ({ children, extra }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
    <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>{children}</p>
    {extra}
  </div>
);

const btnSec: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent',
  border: `1px solid ${C.b2}`, color: C.text, borderRadius: 9, padding: '8px 14px',
  fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
};
const btnPri: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, background: C.text,
  border: 'none', color: '#0A0A0A', borderRadius: 9, padding: '8px 15px',
  fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
};

// El texto de cada categoría, con su tono. El "bajo" es el único en verde:
// es el único que quiere decir «se puede operar sin más».
const CAT: Record<string, { t: string; ok: boolean }> = {
  bajo: { t: 'BAJO', ok: true },
  ninguno: { t: 'SIN HALLAZGOS', ok: true },
  informativo: { t: 'INFORMATIVO', ok: true },
  medio: { t: 'RIESGO MEDIO · EN REVISIÓN', ok: false },
  alto: { t: 'RIESGO ALTO · BLOQUEADO', ok: false },
  sin_validar: { t: 'SIN VALIDAR', ok: false },
};

export const AdminTusdatos: React.FC = () => {
  const { currentUser } = useDatabase() as any;
  const [d, setD] = useState<any>(null);
  // Cambio que el servidor no deja aplicar sin confirmar la identidad. Se
  // guarda tal cual para reintentarlo apenas se verifique: si no, la persona
  // verifica y después tiene que acordarse de qué estaba haciendo.
  const [porVerificar, setPorVerificar] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [probando, setProbando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [diag, setDiag] = useState<any>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [mDoc, setMDoc] = useState('');
  const [mTipo, setMTipo] = useState('CC');
  const [mBusy, setMBusy] = useState(false);
  const [mRes, setMRes] = useState<any>(null);
  const [tecnica, setTecnica] = useState(false);
  const [angosta, setAngosta] = useState(false);
  const primera = useRef(true);

  const cargar = async (forzarProveedor = false) => {
    setBusy(true);
    const r = await call({ action: 'panel', forzarProveedor }).catch(() => null);
    setD(r ?? { error: 'Sin respuesta.' });
    setBusy(false);
  };
  useEffect(() => {
    cargar();
    // El estado del proveedor se refresca solo cada 5 min. Un panel de estado
    // que hay que recargar a mano deja de ser un panel de estado.
    const t = setInterval(() => cargar(), 5 * 60_000);
    return () => clearInterval(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);
  useEffect(() => {
    const mirar = () => setAngosta(window.innerWidth < 1200);
    mirar(); window.addEventListener('resize', mirar);
    return () => window.removeEventListener('resize', mirar);
  }, []);

  const guardar = async (next: any) => {
    setMsg(null);
    const r = await call({ action: 'config_set', config: next }).catch(() => null);
    if (r?.ok) {
      setD((x: any) => ({ ...x, config: r.config }));
      setMsg({ ok: true, texto: 'Guardado. El cambio queda en el registro de auditoría.' });
      return;
    }
    // El servidor pide confirmar la identidad para bajar una protección. No
    // es un error: es el control haciendo su trabajo.
    if (r?.error === 'verificacion_requerida') { setPorVerificar(next); return; }
    setMsg({ ok: false, texto: r?.message ?? r?.error ?? 'No se pudo guardar.' });
  };

  const probar = async () => {
    setProbando(true); setMsg(null); setDiag(null);
    const r = await call({ action: 'probar' }).catch(() => null);
    setProbando(false);
    setMsg({ ok: !!r?.ok, texto: r?.motivo ?? r?.error ?? 'Sin respuesta.' });
    cargar();
  };

  // Vuelve a juzgar los nombres ya consultados con la regla nueva. Gratis:
  // el nombre real ya está guardado, no hay que volver a preguntarle a nadie.
  const recalcular = async () => {
    setBusy(true); setMsg(null);
    const r = await call({ action: 'recalcular_nombres' }).catch(() => null);
    setBusy(false);
    setMsg(r?.ok
      ? { ok: true, texto: `Se revisaron ${r.revisados} nombres. ${r.liberados > 0 ? `${r.liberados} dejaron de estar bloqueados por no coincidir.` : 'Ninguno cambió de veredicto.'}` }
      : { ok: false, texto: r?.error ?? 'No se pudo recalcular.' });
    cargar();
  };

  const diagnosticar = async () => {
    setBusy(true); setMsg(null);
    setDiag(await call({ action: 'diagnostico' }).catch(() => null) ?? { ok: false });
    setBusy(false);
  };

  const reintentar = async (c: any) => {
    setMsg(null);
    const r = await call({ action: 'reintentar', userId: c.userId, documento: c.documento }).catch(() => null);
    setMsg({ ok: !!r?.ok, texto: r?.ok ? 'Consulta relanzada.' : (r?.motivo ?? 'No se pudo reintentar.') });
    cargar();
  };

  const correrManual = async () => {
    if (!mDoc.trim() || mBusy) return;
    setMBusy(true); setMRes(null);
    const r = await call({ action: 'consulta_manual', documento: mDoc.trim(), tipoDocumento: mTipo }).catch(() => null);
    setMBusy(false);
    setMRes(r ?? { ok: false, motivo: 'Sin respuesta.' });
    cargar();
  };

  if (!d) {
    return <div style={{ fontFamily: FONT, background: C.card, border: `1px solid ${C.b1}`, borderRadius: 16, padding: 18, color: C.sub, fontSize: 13 }}>Cargando el estado de TusDatos…</div>;
  }
  if (d.error) {
    return <div style={{ fontFamily: FONT, background: C.card, border: `1px solid ${C.b1}`, borderRadius: 16, padding: 18, color: C.tenue, fontSize: 13 }}>{d.error}</div>;
  }

  const cfg = d.config ?? {};
  const conectado = !!d.conexion?.ok;
  const prov = d.proveedor ?? {};
  const provEstado = String(prov.global ?? 'desconocido');
  const comps: any[] = Array.isArray(prov.componentes) ? prov.componentes : [];
  const caidos = comps.filter(c => c.estado === 'caido' || c.estado === 'degradado');
  const cola: any[] = d.cola ?? [];
  const ultimas: any[] = d.ultimas ?? [];
  const mes = d.mes ?? {};
  const ultima = ultimas[0]?.at ?? null;
  // No se deja encender sin con qué llamar: una integración encendida que no
  // puede responder deja clientes esperando un veredicto que nunca llega.
  const puedeEncender = !!cfg.baseUrl && d.credencial !== 'falta';

  return (
    <div style={{ fontFamily: FONT, color: C.text }}>
      {/* ── Topbar ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.4px', margin: 0 }}>TusDatos</h2>
            <Pill ok={conectado}>{conectado ? 'CONECTADO' : 'SIN CONEXIÓN'}</Pill>
            {d.entorno === 'pruebas' && <Pill>AMBIENTE DE PRUEBAS</Pill>}
            {!cfg.activo && <Pill>APAGADA</Pill>}
          </div>
          <p style={{ fontSize: 12, color: C.sub, margin: '4px 0 0' }}>
            Verificación de antecedentes al inscribir beneficiarios{ultima ? ` · Última consulta ${hace(ultima)}` : ' · Sin consultas todavía'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => cargar(true)} disabled={busy} style={{ ...btnSec, opacity: busy ? 0.6 : 1 }}>
            <span style={{ display: 'inline-flex', animation: busy ? 'tdspin 1s linear infinite' : 'none' }}><Ico d={I.refrescar} /></span>
            {busy ? 'Actualizando…' : 'Actualizar estado'}
          </button>
          <button onClick={probar} disabled={probando} style={{ ...btnSec, opacity: probando ? 0.6 : 1 }}>
            <Ico d={I.enchufe} /> {probando ? 'Probando…' : 'Probar conexión'}
          </button>
          <button onClick={() => { setManual(true); setMRes(null); setMDoc(''); }} style={btnPri}>
            <Ico d={I.lupa} /> Consulta manual
          </button>
        </div>
      </div>

      {msg && (
        <p style={{ fontSize: 12.5, color: msg.ok ? C.green : C.tenue, margin: '0 0 14px', lineHeight: 1.5 }}>{msg.texto}</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: angosta ? '1fr' : '1fr 380px', gap: 14, alignItems: 'start' }}>
        {/* ══ Columna izquierda ══ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>

          {/* 0. El interruptor. Va PRIMERO y solo: es la decisión de la que
              cuelga todo lo demás, y no tiene nada que ver con Kumplo — son
              dos integraciones distintas, cada una se enciende por su lado. */}
          <Tarjeta style={{ borderColor: cfg.activo ? 'rgba(74,222,128,0.22)' : C.b1 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, maxWidth: 560 }}>
                <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Verificación de antecedentes</p>
                <p style={{ fontSize: 12.5, color: C.sub, margin: '5px 0 0', lineHeight: 1.6 }}>
                  {cfg.activo
                    ? 'Encendida. Al inscribir un beneficiario se consulta su documento y vuelve la categoría: bajo, medio o alto.'
                    : 'Apagada. No se consulta a nadie y ningún envío se frena por antecedentes. Lo que ya esté consultado se conserva.'}
                </p>
                {!puedeEncender && !cfg.activo && (
                  <p style={{ fontSize: 11.5, color: C.tenue, margin: '8px 0 0', lineHeight: 1.55 }}>
                    Falta {[!cfg.baseUrl && 'la dirección base', d.credencial === 'falta' && 'la credencial en la Bóveda'].filter(Boolean).join(' y ')}.
                    Encender algo que no puede responder solo produce clientes bloqueados sin motivo.
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: cfg.activo ? C.green : C.sub }}>
                  {cfg.activo ? 'Activa' : 'Apagada'}
                </span>
                <Toggle
                  on={!!cfg.activo}
                  label="Verificación de antecedentes"
                  onClick={() => {
                    if (!cfg.activo && !puedeEncender) {
                      setMsg({ ok: false, texto: 'No se puede encender sin la dirección base y la credencial en la Bóveda.' });
                      return;
                    }
                    guardar({ ...cfg, activo: !cfg.activo });
                  }} />
              </div>
            </div>
          </Tarjeta>

          {/* 1. Estado de la conexión */}
          <Tarjeta>
            <Titulo extra={<span style={{ fontSize: 11.5, color: C.sub }}>Verificado hoy, {hora(new Date().toISOString())}</span>}>
              Estado de la conexión
            </Titulo>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 13 }}>
              <div style={{ border: `1px solid ${C.b1}`, borderRadius: 11, padding: '12px 13px' }}>
                <Etiqueta>API</Etiqueta>
                <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, margin: '7px 0 0' }}>
                  <Punto ok={conectado} /> {conectado ? 'Operativa' : 'Sin conexión'}
                </p>
                <p style={{ fontSize: 11, color: C.sub, margin: '3px 0 0' }}>
                  {d.conexion?.latencia != null ? `Latencia ${num(d.conexion.latencia)} ms` : d.conexion?.motivo}
                </p>
              </div>
              <div style={{ border: `1px solid ${C.b1}`, borderRadius: 11, padding: '12px 13px' }}>
                <Etiqueta>CREDENCIALES</Etiqueta>
                <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, margin: '7px 0 0' }}>
                  <Punto ok={d.credencial !== 'falta'} /> {d.credencial === 'falta' ? 'Revisar' : 'Válidas'}
                </p>
                <p style={{ fontSize: 11, color: C.sub, margin: '3px 0 0' }}>
                  {d.credencial === 'falta' ? 'Faltan en la Bóveda' : `En bóveda · ${d.credencial === 'token' ? 'token' : 'usuario y contraseña'}`}
                </p>
              </div>
              <div style={{ border: `1px solid ${C.b1}`, borderRadius: 11, padding: '12px 13px' }}>
                <Etiqueta>CONSULTAS HOY</Etiqueta>
                <p style={{ fontSize: 13, fontWeight: 700, margin: '7px 0 0' }}>
                  {num(d.consultasHoy ?? 0)}{d.cupo != null && <span style={{ color: C.sub, fontWeight: 500 }}> · quedan {num(d.cupo)}</span>}
                </p>
                {d.cupo != null && (
                  <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', marginTop: 8, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, Math.round(((d.consultasHoy ?? 0) / Math.max(1, (d.consultasHoy ?? 0) + d.cupo)) * 100))}%`, background: C.green }} />
                  </div>
                )}
              </div>
              <div style={{ border: `1px solid ${C.b1}`, borderRadius: 11, padding: '12px 13px' }}>
                <Etiqueta>ENVÍO A KUMPLO</Etiqueta>
                <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, margin: '7px 0 0' }}>
                  <Punto ok={!!cfg.enviarAKumplo} /> {cfg.enviarAKumplo ? 'Activo' : 'Apagado'}
                </p>
                <p style={{ fontSize: 11, color: C.sub, margin: '3px 0 0' }}>
                  {cfg.enviarAKumplo ? 'Ruta configurada' : 'Falta confirmar la ruta con Kumplo'}
                </p>
              </div>
            </div>
          </Tarjeta>

          {/* 2. Estado del proveedor */}
          <Tarjeta>
            <Titulo extra={<Pill ok={provEstado === 'operativo'}>
              {provEstado === 'operativo' ? 'OPERATIVO' : provEstado === 'caido' ? 'CAÍDO' : provEstado === 'degradado' ? 'DEGRADADO PARCIAL' : 'SIN DATOS'}
            </Pill>}>
              Estado del proveedor
            </Titulo>
            <p style={{ fontSize: 11.5, color: C.sub, margin: '4px 0 0' }}>
              status.tusdatos.co · {prov.at ? `actualizado ${hace(prov.at)}` : 'sin datos todavía'}
              {prov.alcanzado === false && prov.at ? ` · sin respuesta desde las ${hora(prov.at)}` : ''}
            </p>

            {comps.length === 0 ? (
              <p style={{ fontSize: 12.5, color: C.sub, margin: '13px 0 0', lineHeight: 1.55 }}>
                No se pudo leer la página de estado del proveedor. No significa que esté caído: significa que
                no tenemos su dato. La conexión propia se mide aparte, arriba.
              </p>
            ) : (
              <div style={{ marginTop: 13 }}>
                {comps.filter(c => !c.padre).slice(0, 8).map(c => {
                  const hijos = comps.filter(h => h.padre === c.id);
                  const abierta = abierto === c.id;
                  return (
                    <div key={c.id || c.nombre} style={{ borderTop: `1px solid ${C.b1}`, padding: '11px 0' }}>
                      <button onClick={() => setAbierto(abierta ? null : c.id)} disabled={!hijos.length}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'transparent', border: 'none', cursor: hijos.length ? 'pointer' : 'default', textAlign: 'left', fontFamily: FONT, padding: 0 }}>
                        <Punto ok={c.estado === 'operativo'} size={7} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.text, flex: 1, minWidth: 0 }}>{c.nombre}</span>
                        <Pill ok={c.estado === 'operativo'}>
                          {c.estado === 'operativo' ? 'OPERATIVO' : c.estado === 'caido' ? 'CAÍDA' : c.estado === 'degradado' ? 'CAÍDA PARCIAL' : '—'}
                        </Pill>
                        {hijos.length > 0 && (
                          <span style={{ color: C.sub, display: 'inline-flex', transform: abierta ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}>
                            <Ico d={I.chevron} size={14} />
                          </span>
                        )}
                      </button>
                      {hijos.length > 0 && (() => {
                        const mal = hijos.filter(h => h.estado !== 'operativo');
                        return (
                          <>
                            <p style={{ fontSize: 11.5, color: C.sub, margin: '5px 0 0', paddingLeft: 17, lineHeight: 1.5 }}>
                              {mal.length === 0
                                ? `${hijos.length} fuentes, todas operativas.`
                                : `${mal.length} de ${hijos.length} fuentes caídas: ${mal.slice(0, 3).map(h => h.nombre).join(', ')}${mal.length > 3 ? `, y ${mal.length - 3} más` : ''}`}
                            </p>
                            {abierta && (
                              <div style={{ paddingLeft: 17, marginTop: 9, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 6 }}>
                                {hijos.map(h => (
                                  <div key={h.id || h.nombre} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                    <Punto ok={h.estado === 'operativo'} size={5} />
                                    <span style={{ fontSize: 11.5, color: h.estado === 'operativo' ? C.sub : C.tenue }}>{h.nombre}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}

            {/* La consecuencia operativa de una fuente caída. Sin esto, el
                estado del proveedor es un dato curioso; con esto, se entiende
                por qué una verificación está esperando. */}
            <div style={{ display: 'flex', gap: 9, marginTop: 14, background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.b1}`, borderRadius: 11, padding: '12px 13px' }}>
              <span style={{ color: C.sub, flexShrink: 0, marginTop: 1 }}><Ico d={I.info} size={15} /></span>
              <p style={{ fontSize: 12, color: C.sub, margin: 0, lineHeight: 1.6 }}>
                Con fuentes caídas, las consultas nuevas pueden devolver un resultado incompleto. Las
                verificaciones afectadas quedan <b style={{ color: C.text }}>en reintento automático</b> y se
                completan cuando la fuente vuelve — no se aprueba ni se rechaza con datos parciales.
              </p>
            </div>
          </Tarjeta>

          {/* 3. Cola de reintentos */}
          <Tarjeta style={{ padding: 0 }}>
            <div style={{ padding: '16px 17px 12px' }}>
              <Titulo extra={cola.length > 0 ? (
                <button onClick={async () => { for (const c of cola.slice(0, 8)) await reintentar(c); }} style={{ ...btnSec, padding: '6px 12px', fontSize: 12 }}>
                  Reintentar todos ahora
                </button>
              ) : undefined}>
                Cola de reintentos
              </Titulo>
              <p style={{ fontSize: 11.5, color: C.sub, margin: '4px 0 0' }}>
                {cola.length === 0 ? 'Nada esperando.' : `${cola.length} verificación${cola.length === 1 ? '' : 'es'} esperando resultado o fuentes caídas`}
              </p>
            </div>
            {cola.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 17px 18px', color: C.sub }}>
                <Ico d={I.check} size={15} />
                <span style={{ fontSize: 12.5 }}>Sin verificaciones pendientes.</span>
              </div>
            ) : cola.map(c => (
              <div key={`${c.userId}:${c.documento}`} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 17px', borderTop: `1px solid ${C.b1}`, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
                    {c.nombre || 'Sin nombre'} <span style={{ color: C.sub, fontFamily: MONO, fontWeight: 400, fontSize: 11.5 }}>{c.tipoDocumento} {enmascarar(c.documento)}</span>
                  </p>
                  <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0', lineHeight: 1.45 }}>
                    {c.fuentesConError?.length
                      ? `Esperando: ${c.fuentesConError.slice(0, 2).join(', ')}${c.fuentesConError.length > 2 ? ` y ${c.fuentesConError.length - 2} más` : ''}`
                      : 'Consulta en curso'}
                    {c.reintentos > 0 ? ` · ${c.reintentos} reintento${c.reintentos === 1 ? '' : 's'}` : ''}
                    {c.at ? ` · ${hace(c.at)}` : ''}
                  </p>
                </div>
                <button onClick={() => reintentar(c)} style={{ ...btnSec, padding: '6px 12px', fontSize: 12 }}>Reintentar</button>
              </div>
            ))}
          </Tarjeta>

          {/* 4. Qué hace con el resultado */}
          <Tarjeta>
            <Titulo>Qué hace con el resultado</Titulo>
            {[
              {
                k: 'bloquear', on: cfg.bloquear !== false, l: 'Impedir la transferencia con veredicto negativo',
                s: 'Sin esto, la categoría se muestra pero no frena nada — solo observación.',
              },
              {
                k: 'soloBloquearAlto', on: !!cfg.soloBloquearAlto, l: 'Bloquear solo el riesgo alto',
                s: 'Sin marcar, el riesgo medio queda en revisión manual: lo aprueba Cumplimiento.',
              },
              {
                k: 'enviarAKumplo', on: !!cfg.enviarAKumplo, l: 'Enviar el resultado y el PDF a Kumplo',
                s: 'Categoría, hallazgos y enlace al reporte van al expediente del titular.',
              },
            ].map((x, i) => (
              <div key={x.k} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, padding: '13px 0', borderTop: `1px solid ${C.b1}`, marginTop: i === 0 ? 12 : 0 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{x.l}</p>
                  <p style={{ fontSize: 11.5, color: C.sub, margin: '3px 0 0', lineHeight: 1.5 }}>{x.s}</p>
                </div>
                <Toggle on={x.on} label={x.l} onClick={() => guardar({ ...cfg, [x.k]: !x.on })} />
              </div>
            ))}
          </Tarjeta>
        </div>

        {/* ══ Columna derecha ══ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>

          {/* Últimas consultas */}
          <Tarjeta style={{ padding: 0 }}>
            <div style={{ padding: '16px 17px 11px' }}><Titulo>Últimas consultas</Titulo></div>
            {ultimas.length === 0 ? (
              <p style={{ fontSize: 12.5, color: C.sub, padding: '0 17px 18px', margin: 0 }}>Todavía no se ha consultado a nadie.</p>
            ) : ultimas.map(u => {
              const bloq = u.operable === false;
              const cat = u.estado !== 'finalizado'
                ? { t: 'PENDIENTE', ok: false }
                : u.nombreCoincide === false ? { t: bloq ? 'NOMBRE INCORRECTO · BLOQUEADO' : 'NOMBRE INCORRECTO', ok: false }
                  : u.documentoVigente === false ? { t: bloq ? 'DOCUMENTO NO VIGENTE · BLOQUEADO' : 'DOCUMENTO NO VIGENTE', ok: false }
                    : CAT[String(u.categoria ?? '')] ?? { t: 'SIN RESULTADO', ok: false };
              return (
                <div key={`${u.userId}:${u.documento}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 17px', borderTop: `1px solid ${C.b1}` }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ fontSize: 12.5, fontWeight: 600, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.nombre || 'Sin nombre'}{u.manual && <span style={{ color: C.dim, fontWeight: 500 }}> · manual</span>}
                    </p>
                    <p style={{ fontSize: 11, color: C.sub, margin: '2px 0 0', fontFamily: MONO }}>
                      {hace(u.at)} · {enmascarar(u.documento)}
                    </p>
                  </div>
                  <Pill ok={cat.ok}>{cat.t}</Pill>
                </div>
              );
            })}
          </Tarjeta>

          {/* Últimos 30 días */}
          <Tarjeta>
            <Titulo>Últimos 30 días</Titulo>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 13 }}>
              {[
                { l: 'CONSULTAS', v: num(mes.consultas ?? 0), verde: false },
                { l: 'RIESGO BAJO', v: mes.bajoPct != null ? `${String(mes.bajoPct).replace('.', ',')} %` : '—', verde: true },
                { l: 'EN REVISIÓN', v: num(mes.enRevision ?? 0), verde: false },
                { l: 'BLOQUEADAS', v: num(mes.bloqueadas ?? 0), verde: false },
              ].map(x => (
                <div key={x.l} style={{ border: `1px solid ${C.b1}`, borderRadius: 11, padding: '12px 13px' }}>
                  <Etiqueta>{x.l}</Etiqueta>
                  <p style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.5px', margin: '6px 0 0', color: x.verde ? C.green : C.text }}>{x.v}</p>
                </div>
              ))}
            </div>
          </Tarjeta>

          {/* Avisos al equipo */}
          <Tarjeta>
            <Titulo>Avisos al equipo</Titulo>
            {[
              { k: 'avisoFuenteCaida', l: 'Cuando una fuente se cae', pre: true },
              { k: 'avisoRiesgoAlto', l: 'Cuando hay riesgo alto', pre: true },
              { k: 'avisoRevisionLenta', l: 'Revisión pendiente > 12 h', pre: false },
            ].map((x, i) => {
              const on = (cfg as any)[x.k] ?? x.pre;
              return (
                <div key={x.k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderTop: `1px solid ${C.b1}`, marginTop: i === 0 ? 12 : 0 }}>
                  <p style={{ fontSize: 12.5, fontWeight: 600, margin: 0 }}>{x.l}</p>
                  <Toggle on={!!on} label={x.l} onClick={() => guardar({ ...cfg, [x.k]: !on })} />
                </div>
              );
            })}
            <p style={{ fontSize: 11, color: C.dim, margin: '10px 0 0', lineHeight: 1.5 }}>
              Al correo del administrador y al canal de Cumplimiento.
            </p>
          </Tarjeta>

          {/* Configuración técnica */}
          <Tarjeta>
            <Titulo>Configuración técnica</Titulo>
            <div style={{ marginTop: 12 }}>
              {[
                { l: 'Credenciales', v: d.credencial === 'falta' ? 'Sin configurar' : 'En bóveda · ••••••••' },
                { l: 'Webhook de avisos', v: d.webhook === 'configurado' ? 'Configurado' : 'Sin configurar' },
                { l: 'Entorno', v: d.entorno === 'pruebas' ? 'Pruebas' : 'Producción' },
                { l: 'Cuentas en la prueba', v: (cfg.soloEstosUsuarios ?? []).length ? `${(cfg.soloEstosUsuarios ?? []).length} cuenta(s)` : 'Todas' },
              ].map((x, i) => (
                <div key={x.l} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: i === 0 ? 'none' : `1px solid ${C.b1}` }}>
                  <span style={{ fontSize: 12.5, color: C.sub }}>{x.l}</span>
                  <span style={{ fontSize: 12.5, color: C.text, fontWeight: 600, fontFamily: x.l === 'Credenciales' ? MONO : FONT }}>{x.v}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button onClick={() => setTecnica(v => !v)} style={{ ...btnSec, padding: '7px 13px', fontSize: 12 }}>
                {tecnica ? 'Cerrar ajustes' : 'Ajustes avanzados'}
              </button>
              <button onClick={diagnosticar} disabled={busy} style={{ ...btnSec, padding: '7px 13px', fontSize: 12, opacity: busy ? 0.6 : 1 }}>Diagnóstico</button>
              {/* La regla que compara nombres se hizo más tolerante. Los
                  veredictos ya guardados se calcularon con la anterior y
                  siguen bloqueando a gente que solo escribió distinto. Esto
                  los vuelve a juzgar con lo que ya está guardado — no llama a
                  TusDatos y no gasta un solo crédito. */}
              <button onClick={recalcular} disabled={busy} style={{ ...btnSec, padding: '7px 13px', fontSize: 12, opacity: busy ? 0.6 : 1 }}>
                Revisar los nombres otra vez
              </button>
            </div>

            {tecnica && (
              <div style={{ marginTop: 13, paddingTop: 13, borderTop: `1px solid ${C.b1}` }}>
                <Etiqueta>DIRECCIÓN BASE</Etiqueta>
                <input defaultValue={cfg.baseUrl ?? ''} onBlur={e => guardar({ ...cfg, baseUrl: e.target.value })}
                  style={{ width: '100%', height: 38, marginTop: 6, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 9, padding: '0 12px', color: C.text, fontSize: 12, outline: 'none', fontFamily: MONO }} />
                <p style={{ fontSize: 11, color: C.dim, margin: '5px 0 12px', lineHeight: 1.5 }}>
                  Producción gasta créditos del plan. El ambiente de pruebas devuelve respuestas fijas.
                </p>
                <Etiqueta>CUENTAS EN LA PRUEBA</Etiqueta>
                <input defaultValue={(cfg.soloEstosUsuarios ?? []).join(', ')}
                  onBlur={e => guardar({ ...cfg, soloEstosUsuarios: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })}
                  placeholder="vacío = todas"
                  style={{ width: '100%', height: 38, marginTop: 6, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 9, padding: '0 12px', color: C.text, fontSize: 12, outline: 'none', fontFamily: MONO }} />
                <p style={{ fontSize: 11, color: C.dim, margin: '9px 0 0', lineHeight: 1.5 }}>
                  Las credenciales y el secreto de los avisos viven en la <b style={{ color: C.sub }}>Bóveda</b> 🔒 y no se muestran acá.
                </p>
              </div>
            )}

            {diag && (
              <div style={{ marginTop: 13, paddingTop: 13, borderTop: `1px solid ${C.b1}` }}>
                {(diag.pasos ?? []).map((p: any) => (
                  <div key={p.paso} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
                    <span style={{ color: p.ok ? C.green : C.tenue, fontSize: 12, fontWeight: 800, lineHeight: 1.5 }}>{p.ok ? '✓' : '×'}</span>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 700, color: C.text, margin: 0 }}>{p.paso}</p>
                      <p style={{ fontSize: 11, color: C.dim, margin: '2px 0 0', lineHeight: 1.45 }}>{p.detalle}</p>
                    </div>
                  </div>
                ))}
                {diag.corte && <p style={{ fontSize: 12, color: C.tenue, margin: '11px 0 0', lineHeight: 1.5 }}>Se corta en: <b>{diag.corte}</b></p>}
              </div>
            )}
          </Tarjeta>
        </div>
      </div>

      {/* ── Consulta manual ── */}
      {manual && (
        <div className="fixed inset-0 z-[60] p-4" style={{ background: 'rgba(4,5,4,0.78)', display: 'grid', placeItems: 'center' }}
          onClick={() => setManual(false)}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true"
            style={{ maxWidth: 440, width: '100%', background: C.card, border: `1px solid ${C.b2}`, borderRadius: 18, padding: '22px 24px', fontFamily: FONT }}>
            <p style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px', margin: 0 }}>Consulta manual</p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '7px 0 0', lineHeight: 1.6 }}>
              Consulta un documento suelto, sin inscribir beneficiario. Gasta un crédito del plan y queda
              registrada con tu nombre.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <select value={mTipo} onChange={e => setMTipo(e.target.value)}
                style={{ width: 92, height: 42, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 10, padding: '0 10px', color: C.text, fontSize: 13, outline: 'none', fontFamily: FONT }}>
                {['CC', 'CE', 'NIT', 'PP', 'PPT'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input value={mDoc} onChange={e => setMDoc(e.target.value)} placeholder="Número de documento" autoFocus
                onKeyDown={e => { if (e.key === 'Enter') correrManual(); }}
                style={{ flex: 1, minWidth: 0, height: 42, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 10, padding: '0 13px', color: C.text, fontSize: 13.5, outline: 'none', fontFamily: MONO }} />
            </div>

            {mRes && (
              <div style={{ marginTop: 14, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 11, padding: '13px 14px' }}>
                {mRes.ok && mRes.ficha ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0 }}>{mRes.ficha.nombreReal || mRes.ficha.nombre || 'Sin nombre'}</p>
                      <Pill ok={['bajo', 'ninguno', 'informativo'].includes(String(mRes.ficha.categoria))}>
                        {(CAT[String(mRes.ficha.categoria ?? '')] ?? { t: mRes.ficha.estado === 'procesando' ? 'EN CURSO' : 'SIN RESULTADO' }).t}
                      </Pill>
                    </div>
                    <p style={{ fontSize: 11.5, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>
                      {mRes.ficha.estado === 'procesando'
                        ? 'La consulta sigue corriendo. Aparecerá en «Últimas consultas» cuando termine.'
                        : `${mRes.ficha.altos ?? 0} alto · ${mRes.ficha.medios ?? 0} medio · ${mRes.ficha.bajos ?? 0} bajo${mRes.ficha.documentoVigente === false ? ` · documento no vigente` : ''}`}
                    </p>
                  </>
                ) : (
                  <p style={{ fontSize: 12.5, color: C.tenue, margin: 0 }}>{mRes.motivo ?? mRes.error ?? 'No se pudo consultar.'}</p>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 9, marginTop: 18 }}>
              <button onClick={() => setManual(false)} style={{ ...btnSec, flex: 1, height: 44, justifyContent: 'center' }}>Cerrar</button>
              <button onClick={correrManual} disabled={!mDoc.trim() || mBusy}
                style={{ ...btnPri, flex: 1, height: 44, justifyContent: 'center', opacity: !mDoc.trim() || mBusy ? 0.5 : 1 }}>
                {mBusy ? 'Consultando…' : 'Consultar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Verificación para bajar una protección. Apagar la verificación de
          antecedentes deja pasar envíos que hoy se frenan: un panel abierto
          un minuto en un escritorio ajeno no puede alcanzar para eso. */}
      {porVerificar && currentUser?.id && (
        <div className="fixed inset-0 z-[60] p-4" style={{ background: 'rgba(4,5,4,0.8)', display: 'grid', placeItems: 'center', overflowY: 'auto' }}>
          <div style={{ maxWidth: 440, width: '100%' }}>
            <AdminStepUp
              userId={currentUser.id}
              motivo={porVerificar.activo === false
                ? 'para apagar la verificación de antecedentes'
                : 'para bajar esta protección'}
              sinPasskey
              onListo={() => { const n = porVerificar; setPorVerificar(null); guardar(n); }}
              onCancelar={() => { setPorVerificar(null); setMsg({ ok: false, texto: 'No se cambió nada: hace falta confirmar la identidad.' }); }}
            />
          </div>
        </div>
      )}

      <style>{`@keyframes tdspin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
