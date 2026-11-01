// ─────────────────────────────────────────────────────────────
// Admin → Coinsenda: el aliado detrás de la Cuenta 3 de Bre-B y de ACH en los
// envíos de los clientes. El cliente nunca ve este nombre; solo el admin.
//
// Hoy esta pestaña tiene la llave de la API y la prueba de conexión (el
// correo de la cuenta + iniciar sesión y leer, sin mover plata). Coinsenda autentica a
// Lincoin con una pareja RS256: la pública se registra en su panel (Ajustes →
// Desarrollador) y con la privada firma el servidor. La pareja la crea el
// servidor con el 2FA del dueño y la privada se queda guardada allá, cifrada:
// nadie tiene que abrir una terminal ni copiar un archivo, y la privada no
// pasa nunca por esta pantalla.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { pedirAdmin } from './adminApi';

const C = {
  card: '#0C0E0D', elev: '#121413', b1: 'rgba(255,255,255,0.07)', b2: 'rgba(255,255,255,0.12)',
  text: '#F4F4F2', sub: '#878E88', green: '#4ADE80', amber: '#FBBF24', red: '#F87171',
};
const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, Menlo, monospace';
const btnPri: React.CSSProperties = { fontFamily: FONT, background: C.text, border: 'none', color: '#0A0A0A', borderRadius: 9, padding: '9px 15px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
const btnSec: React.CSSProperties = { fontFamily: FONT, background: 'transparent', border: `1px solid ${C.b2}`, color: C.text, borderRadius: 9, padding: '8px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const campoOtp: React.CSSProperties = { fontFamily: FONT, width: 150, boxSizing: 'border-box', background: 'rgba(255,255,255,0.045)', border: `1px solid ${C.b2}`, borderRadius: 9, padding: '9px 11px', color: C.text, outline: 'none', letterSpacing: 6, fontWeight: 800, fontSize: 16 };

type Llave = { publica: string; huella: string; at: string; por?: { nombre?: string; email?: string } | null };

const fecha = (d?: string) => { if (!d) return '—'; try { return new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return d; } };

export const AdminCoinsenda: React.FC = () => {
  const [cargando, setCargando] = useState(true);
  const [llave, setLlave] = useState<Llave | null>(null);
  const [desdeSecreto, setDesdeSecreto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Formulario de generar: null = cerrado; reemplazar = ya había una.
  const [gen, setGen] = useState<{ otp: string; reemplazar: boolean; ocupado: boolean; error: string | null } | null>(null);
  const [copiada, setCopiada] = useState(false);
  const [recienGenerada, setRecienGenerada] = useState(false);

  const cargar = async () => {
    setCargando(true);
    const r = await pedirAdmin({ action: 'coinsenda_llave_estado' }).catch(() => null);
    if (r?.ok) { setLlave(r.llave ?? null); setDesdeSecreto(!!r.desdeSecreto); setError(null); }
    else setError(r?.permisoDenegado ? 'Solo el dueño puede ver y generar la llave de Coinsenda.' : (r?.error ?? 'No se pudo leer la llave.'));
    setCargando(false);
  };
  useEffect(() => { cargar(); }, []);

  const generar = async () => {
    if (!gen) return;
    setGen(g => g && ({ ...g, ocupado: true, error: null }));
    const r = await pedirAdmin({ action: 'coinsenda_llave_generar', otp: gen.otp, reemplazar: gen.reemplazar }).catch(() => null);
    if (r?.ok && r.llave) { setLlave(r.llave); setGen(null); setRecienGenerada(true); setCopiada(false); return; }
    setGen(g => g && ({ ...g, ocupado: false, otp: '', error: r?.error ?? 'No se pudo generar la llave.' }));
  };

  const copiar = async () => {
    if (!llave) return;
    try { await navigator.clipboard.writeText(llave.publica.trim()); setCopiada(true); setTimeout(() => setCopiada(false), 2500); } catch { /* el navegador no dejó: se puede seleccionar a mano */ }
  };

  return (
    <div style={{ fontFamily: FONT, color: C.text, maxWidth: 820 }} className="space-y-4">
      <div>
        <p style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', margin: 0 }}>Coinsenda</p>
        <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>
          Aliado de la <b style={{ color: C.text }}>Cuenta 3</b> de Bre-B y de ACH en los envíos de los clientes. Los clientes no ven este nombre: para ellos es solo "Cuenta 3".
        </p>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.b1}`, borderRadius: 13, padding: '16px 18px' }}>
        <div className="flex items-start justify-between" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 14.5, fontWeight: 700, margin: 0 }}>Llave de la API</p>
            <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0', lineHeight: 1.5 }}>
              La <b style={{ color: C.text }}>pública</b> se pega en Coinsenda. La <b style={{ color: C.text }}>privada</b> la guarda el servidor, cifrada, y no sale de ahí.
            </p>
          </div>
          {!cargando && !error && (
            <span style={{ border: `1px solid ${llave ? 'rgba(74,222,128,0.3)' : C.b2}`, color: llave ? C.green : C.sub, borderRadius: 999, padding: '3px 9px', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.6px', whiteSpace: 'nowrap' }}>
              {llave ? 'GENERADA' : 'SIN LLAVE'}
            </span>
          )}
        </div>

        {cargando && <p style={{ fontSize: 12.5, color: C.sub, margin: '14px 0 0' }}>Cargando…</p>}
        {error && <p style={{ fontSize: 12.5, color: C.red, margin: '14px 0 0' }}>{error}</p>}

        {!cargando && !error && !llave && !gen && (
          <div style={{ marginTop: 14 }}>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '0 0 10px', lineHeight: 1.5 }}>Todavía no hay llave. Genérala aquí y luego copia la pública en Coinsenda.</p>
            <button style={btnPri} onClick={() => setGen({ otp: '', reemplazar: false, ocupado: false, error: null })}>Generar llave</button>
          </div>
        )}

        {!cargando && !error && llave && (
          <div style={{ marginTop: 14 }}>
            {recienGenerada && (
              <div style={{ background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 10, padding: '10px 12px', marginBottom: 10, fontSize: 12.5, lineHeight: 1.5 }}>
                Llave lista. Cópiala y pégala en Coinsenda: <b>Ajustes → Desarrollador → Clave pública de API</b>, y dale <b>Registrar clave</b>.
              </div>
            )}
            <div className="flex items-center justify-between" style={{ gap: 8, marginBottom: 6 }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>CLAVE PÚBLICA</p>
              <button style={{ ...btnSec, padding: '5px 11px', color: copiada ? C.green : C.text, borderColor: copiada ? 'rgba(74,222,128,0.4)' : C.b2 }} onClick={copiar}>{copiada ? 'Copiada ✓' : 'Copiar'}</button>
            </div>
            <pre style={{ fontFamily: MONO, fontSize: 11.5, color: C.text, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 9, padding: 12, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'all' }}>{llave.publica.trim()}</pre>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
              <div>
                <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>HUELLA</p>
                <p style={{ fontFamily: MONO, fontSize: 12, margin: '3px 0 0' }}>{llave.huella}</p>
              </div>
              <div>
                <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>GENERADA</p>
                <p style={{ fontSize: 12, margin: '3px 0 0' }}>{fecha(llave.at)}{llave.por?.nombre || llave.por?.email ? ` · ${llave.por?.nombre || llave.por?.email}` : ''}</p>
              </div>
            </div>
            {desdeSecreto && (
              <p style={{ fontSize: 11.5, color: C.amber, margin: '10px 0 0', lineHeight: 1.5 }}>
                Ojo: en los secretos de Supabase hay un COINSENDA_PRIVATE_KEY, y ese manda sobre esta llave. Si vas a usar la de aquí, borra ese secreto.
              </p>
            )}
            {!gen && (
              <button style={{ ...btnSec, marginTop: 12, color: C.sub }} onClick={() => setGen({ otp: '', reemplazar: true, ocupado: false, error: null })}>Generar otra llave</button>
            )}
          </div>
        )}

        {gen && (
          <div style={{ marginTop: 14, borderTop: `1px solid ${C.b1}`, paddingTop: 14 }}>
            {gen.reemplazar && (
              <p style={{ fontSize: 12, color: C.amber, margin: '0 0 10px', lineHeight: 1.5 }}>
                La llave nueva reemplaza a la actual: la que está registrada en Coinsenda deja de servir hasta que pegues la nueva allá.
              </p>
            )}
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '0 0 6px' }}>TU CÓDIGO 2FA</p>
            <div className="flex items-center" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={gen.otp} placeholder="000000"
                onChange={e => setGen(g => g && ({ ...g, otp: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                onKeyDown={e => { if (e.key === 'Enter' && gen.otp.length === 6 && !gen.ocupado) generar(); }}
                style={campoOtp} />
              <button disabled={gen.otp.length !== 6 || gen.ocupado} onClick={generar}
                style={{ ...btnPri, opacity: gen.otp.length === 6 && !gen.ocupado ? 1 : 0.45, cursor: gen.otp.length === 6 && !gen.ocupado ? 'pointer' : 'not-allowed' }}>
                {gen.ocupado ? 'Generando…' : gen.reemplazar ? 'Generar otra' : 'Generar llave'}
              </button>
              <button style={btnSec} disabled={gen.ocupado} onClick={() => setGen(null)}>Cancelar</button>
            </div>
            {gen.error && <p style={{ fontSize: 12.5, color: C.red, margin: '8px 0 0', lineHeight: 1.45 }}>{gen.error}</p>}
          </div>
        )}
      </div>

      {!error && <Conexion hayLlave={!!llave || desdeSecreto} />}

      <div style={{ background: C.card, border: `1px solid ${C.b1}`, borderRadius: 13, padding: '16px 18px' }}>
        <p style={{ fontSize: 14.5, fontWeight: 700, margin: 0 }}>Envíos por Cuenta 3</p>
        <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0', lineHeight: 1.5 }}>
          Para los clientes siguen en "Próximamente". Se activan cuando la prueba de conexión pase y quede conectado el envío.
        </p>
      </div>
    </div>
  );
};

// ── La cuenta con la que firma Lincoin y la prueba de conexión ─────────
// La prueba NO mueve plata: inicia sesión con la llave y lee el perfil, las
// billeteras y los medios de envío, con sus costos y topes.
type Paso = { paso: string; ok: boolean; detalle?: string };
type Prueba = { ok: boolean; pasos: Paso[]; perfil?: any; billeteras?: any[]; proveedores?: any[]; otras?: { billeteras?: number; proveedores?: number }; otrosMedios?: any[]; error?: string };

const esCop = (x: any) => String(x?.currency && typeof x.currency === 'object' ? (x.currency.currency ?? x.currency.symbol ?? '') : (x?.currency ?? '')).toLowerCase() === 'cop';
const esOtraMoneda = (x: any) => !esCop(x);
const copDe = (xs?: any[]) => (xs ?? []).filter(esCop);
const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n.toLocaleString('es-CO') : String(v ?? '—'); };
const costos = (p: any): string => {
  const c = p?.provider?.costs;
  if (!c || typeof c !== 'object') return '—';
  return Object.entries(c).map(([k, v]: [string, any]) => `${k}: ${v && typeof v === 'object' ? [v.fixed != null ? `$${num(v.fixed)}` : '', Number(v.percent) ? `${v.percent} %` : ''].filter(Boolean).join(' + ') || '0' : String(v)}`).join(' · ');
};
const VerDetalle: React.FC<{ v: unknown }> = ({ v }) => {
  const [abierto, setAbierto] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={() => setAbierto(a => !a)} style={{ ...btnSec, padding: '4px 9px', fontSize: 11, color: C.sub }}>{abierto ? 'Ocultar detalle' : 'Ver detalle'}</button>
      {abierto && <pre style={{ fontFamily: MONO, fontSize: 11, color: C.sub, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 9, padding: 10, marginTop: 6, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(v, null, 2)}</pre>}
    </div>
  );
};

const Conexion: React.FC<{ hayLlave: boolean }> = ({ hayLlave }) => {
  const [email, setEmail] = useState<string | null>(null);
  const [borrador, setBorrador] = useState('');
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ultima, setUltima] = useState<{ at: string; ok: boolean; detalle?: string | null } | null>(null);
  const [probando, setProbando] = useState(false);
  const [prueba, setPrueba] = useState<Prueba | null>(null);

  useEffect(() => {
    pedirAdmin({ action: 'coinsenda_config_get' }).then(r => {
      if (r?.ok) { setEmail(r.email ?? null); setBorrador(r.email ?? ''); setEditando(!r.email); setUltima(r.ultimaPrueba ?? null); }
    }).catch(() => {});
  }, []);

  const guardar = async () => {
    setGuardando(true); setMsg(null);
    const r = await pedirAdmin({ action: 'coinsenda_config_guardar', email: borrador.trim() }).catch(() => null);
    setGuardando(false);
    if (r?.ok) { setEmail(borrador.trim().toLowerCase()); setEditando(false); setMsg({ ok: true, texto: 'Guardado.' }); }
    else setMsg({ ok: false, texto: r?.needs2fa ? 'Tu sesión necesita el 2FA para cambiar esto. Sal y vuelve a entrar con tu código.' : (r?.error ?? 'No se pudo guardar.') });
  };

  const probar = async () => {
    setProbando(true); setPrueba(null);
    const r = await pedirAdmin({ action: 'coinsenda_probar' }).catch(() => null);
    setProbando(false);
    if (r && Array.isArray(r.pasos)) { setPrueba(r); setUltima({ at: new Date().toISOString(), ok: !!r.ok, detalle: r.pasos.find((p: Paso) => !p.ok)?.detalle ?? null }); }
    else setPrueba({ ok: false, pasos: [], error: r?.error ?? 'No se pudo probar la conexión.' });
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.b1}`, borderRadius: 13, padding: '16px 18px' }}>
      <p style={{ fontSize: 14.5, fontWeight: 700, margin: 0 }}>Conexión</p>
      <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0', lineHeight: 1.5 }}>
        El correo con el que entras a Coinsenda: va dentro del token que firma la llave.
      </p>

      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '14px 0 6px' }}>CORREO DE LA CUENTA</p>
      {!editando && email ? (
        <div className="flex items-center" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{email}</span>
          <button style={{ ...btnSec, padding: '5px 11px', color: C.sub }} onClick={() => { setEditando(true); setMsg(null); }}>Cambiar</button>
        </div>
      ) : (
        <div className="flex items-center" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input value={borrador} onChange={e => setBorrador(e.target.value)} placeholder="correo@empresa.com" type="email" autoComplete="off"
            onKeyDown={e => { if (e.key === 'Enter' && !guardando) guardar(); }}
            style={{ fontFamily: FONT, flex: '1 1 220px', minWidth: 0, boxSizing: 'border-box', background: 'rgba(255,255,255,0.045)', border: `1px solid ${C.b2}`, borderRadius: 9, padding: '9px 11px', color: C.text, fontSize: 13, outline: 'none' }} />
          <button style={{ ...btnPri, opacity: guardando ? 0.5 : 1 }} disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          {email && <button style={btnSec} disabled={guardando} onClick={() => { setEditando(false); setBorrador(email); setMsg(null); }}>Cancelar</button>}
        </div>
      )}
      {msg && <p style={{ fontSize: 12.5, color: msg.ok ? C.green : C.red, margin: '8px 0 0' }}>{msg.texto}</p>}

      <div style={{ borderTop: `1px solid ${C.b1}`, marginTop: 14, paddingTop: 14 }}>
        <div className="flex items-center justify-between" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Probar conexión</p>
            <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0' }}>No mueve plata: inicia sesión y lee billeteras y medios de envío.</p>
          </div>
          <button style={{ ...btnPri, opacity: (!hayLlave || !email || probando) ? 0.45 : 1, cursor: (!hayLlave || !email || probando) ? 'not-allowed' : 'pointer' }}
            disabled={!hayLlave || !email || probando} onClick={probar}>{probando ? 'Probando…' : 'Probar conexión'}</button>
        </div>
        {(!hayLlave || !email) && <p style={{ fontSize: 11.5, color: C.sub, margin: '8px 0 0' }}>{!hayLlave ? 'Primero genera la llave y regístrala en Coinsenda.' : 'Primero guarda el correo de la cuenta.'}</p>}
        {ultima && !prueba && (
          <p style={{ fontSize: 11.5, color: ultima.ok ? C.green : C.amber, margin: '8px 0 0', lineHeight: 1.45 }}>
            Última prueba: {fecha(ultima.at)} · {ultima.ok ? 'conectado' : `falló${ultima.detalle ? ` — ${ultima.detalle}` : ''}`}
          </p>
        )}

        {prueba && (
          <div style={{ marginTop: 12 }} className="space-y-3">
            {prueba.error && <p style={{ fontSize: 12.5, color: C.red, margin: 0 }}>{prueba.error}</p>}
            {prueba.pasos.map(p => (
              <div key={p.paso} className="flex items-start" style={{ gap: 8 }}>
                <span style={{ color: p.ok ? C.green : C.red, fontWeight: 800, fontSize: 13, lineHeight: '18px', width: 14, flexShrink: 0 }}>{p.ok ? '✓' : '✗'}</span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{p.paso}</p>
                  {p.detalle && <p style={{ fontSize: 12, color: C.red, margin: '2px 0 0', lineHeight: 1.45, wordBreak: 'break-word' }}>{p.detalle}</p>}
                </div>
              </div>
            ))}

            {/* Solo lo de pesos: Coinsenda devuelve también billeteras y medios
                de otras monedas (cripto) que Lincoin no usa y no se muestran. */}
            {prueba.pasos.length > 0 && (() => {
              const otrasB = Number(prueba.otras?.billeteras ?? (prueba.billeteras ?? []).filter(esOtraMoneda).length);
              const otrosP = Number(prueba.otras?.proveedores ?? (prueba.proveedores ?? []).filter(esOtraMoneda).length);
              return (otrasB + otrosP) > 0 ? <p style={{ fontSize: 11.5, color: C.sub, margin: 0 }}>Se muestra solo lo de COP ({otrasB} billeteras y {otrosP} medios de otras monedas ocultos).</p> : null;
            })()}

            {!!copDe(prueba.billeteras).length && (
              <div>
                <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '6px 0 6px' }}>BILLETERAS COP</p>
                <div className="space-y-1.5">
                  {copDe(prueba.billeteras).map((b: any, i: number) => (
                    <div key={b?.id ?? i} className="flex items-center justify-between" style={{ gap: 10, padding: '8px 11px', borderRadius: 9, background: C.elev, border: `1px solid ${C.b1}` }}>
                      <span style={{ fontSize: 12.5, minWidth: 0 }}><b>{String(b?.currency ?? '—').toUpperCase()}</b> <span style={{ color: C.sub }}>· {String(b?.type ?? '—')}{b?.name ? ` · ${b.name}` : ''}</span></span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{b?.available != null ? `$${num(b.available)} disponible` : '—'}</span>
                    </div>
                  ))}
                </div>
                <VerDetalle v={copDe(prueba.billeteras)} />
              </div>
            )}

            {!!copDe(prueba.proveedores).length && (
              <div>
                <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '6px 0 6px' }}>MEDIOS DE ENVÍO COP</p>
                <div className="space-y-1.5">
                  {copDe(prueba.proveedores).map((p: any, i: number) => (
                    <div key={p?.id ?? i} style={{ padding: '8px 11px', borderRadius: 9, background: C.elev, border: `1px solid ${C.b1}` }}>
                      <p style={{ fontSize: 12.5, margin: 0 }}>
                        <b>{String(p?.provider_type ?? '—')}</b> <span style={{ color: C.sub }}>· COP{p?.name ? ` · ${p.name}` : ''}</span>
                        {p?.enabled === false && <span style={{ color: C.amber }}> · deshabilitado</span>}
                        {p?.visible === false && <span style={{ color: C.amber }}> · no visible</span>}
                      </p>
                      <p style={{ fontSize: 11.5, color: C.sub, margin: '3px 0 0', lineHeight: 1.45 }}>
                        Mín. {p?.min_amount != null ? `$${num(p.min_amount)}` : '—'} · Máx. {p?.max_amount != null ? `$${num(p.max_amount)}` : '—'} · Costo {costos(p)}
                      </p>
                    </div>
                  ))}
                </div>
                <VerDetalle v={copDe(prueba.proveedores)} />
              </div>
            )}
            {prueba.ok && !copDe(prueba.proveedores).length && (
              <p style={{ fontSize: 12, color: C.amber, margin: 0, lineHeight: 1.5 }}>La cuenta no devolvió medios de envío en COP. Sin ellos no se puede enviar: hay que pedirle a Coinsenda que los habilite para esta cuenta.</p>
            )}
            {!!prueba.otrosMedios?.length && (
              <div>
                <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '6px 0 0' }}>MEDIOS DE OTRAS MONEDAS</p>
                <VerDetalle v={prueba.otrosMedios} />
              </div>
            )}
            {prueba.ok && !copDe(prueba.billeteras).length && (
              <p style={{ fontSize: 12, color: C.amber, margin: 0 }}>La cuenta no tiene billetera COP: hay que abrirla en Coinsenda para poder enviar.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
