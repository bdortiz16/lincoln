// ─────────────────────────────────────────────────────────────
// Admin → Coinsenda: el aliado detrás de las Cuentas 3 y 4 de Bre-B y de ACH
// en los envíos de los clientes. El cliente nunca ve este nombre; solo el
// admin. Lincoin tiene DOS cuentas en Coinsenda (otro correo, otra llave,
// otra billetera): la Cuenta 3 respalda el "Saldo Cuenta 3" de los clientes y
// la Cuenta 4 el "Saldo Cuenta 4".
//
// Arriba va el tablero (bolsa en vivo de cada cuenta, cuánto es de los
// clientes, envíos y su estado, utilidad por riel y los últimos envíos). Abajo,
// cuenta por cuenta, la llave de la API, la prueba de conexión y los
// interruptores. Coinsenda autentica a Lincoin con una pareja RS256: la
// pública se registra en su panel (Ajustes → Desarrollador) y con la privada
// firma el servidor. La pareja la crea el servidor con el 2FA del dueño y la
// privada se queda guardada allá, cifrada: nadie tiene que abrir una terminal
// ni copiar un archivo, y la privada no pasa nunca por esta pantalla.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { pedirAdmin } from './adminApi';

const C = {
  card: '#0C0E0D', elev: '#121413', b1: 'rgba(255,255,255,0.07)', b2: 'rgba(255,255,255,0.12)',
  text: '#F4F4F2', sub: '#878E88', tenue: 'rgba(244,244,242,0.45)', green: '#4ADE80', amber: '#FBBF24', red: '#F87171',
};
const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, Menlo, monospace';
const btnPri: React.CSSProperties = { fontFamily: FONT, background: C.text, border: 'none', color: '#0A0A0A', borderRadius: 9, padding: '9px 15px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
const btnSec: React.CSSProperties = { fontFamily: FONT, background: 'transparent', border: `1px solid ${C.b2}`, color: C.text, borderRadius: 9, padding: '8px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const campoOtp: React.CSSProperties = { fontFamily: FONT, width: 150, boxSizing: 'border-box', background: 'rgba(255,255,255,0.045)', border: `1px solid ${C.b2}`, borderRadius: 9, padding: '9px 11px', color: C.text, outline: 'none', letterSpacing: 6, fontWeight: 800, fontSize: 16 };
const ROT: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: 0 };
const tarjeta: React.CSSProperties = { background: C.card, border: `1px solid ${C.b1}`, borderRadius: 13, padding: '16px 18px' };

type Cuenta = 3 | 4;
const NOMBRE: Record<Cuenta, string> = { 3: 'Coinsenda', 4: 'Coinsenda 2' };
type Llave = { publica: string; huella: string; at: string; por?: { nombre?: string; email?: string } | null };

// El tramo que distingue una clave pública RSA 2048: todas empiezan con el
// mismo encabezado, y el panel de Coinsenda muestra solo el inicio de la
// registrada. Con este tramo se compara a ojo si allá está la de aquí (el 1 nov
// la subcuenta tenía registrada otra clave y la firma fallaba).
const ENCABEZADO_RSA2048 = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA';
const tramoClave = (pem?: string | null): string | null => {
  const cuerpo = String(pem ?? '').replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return cuerpo.startsWith(ENCABEZADO_RSA2048) ? cuerpo.slice(ENCABEZADO_RSA2048.length, ENCABEZADO_RSA2048.length + 10) : null;
};
const fecha = (d?: string | null) => { if (!d) return '—'; try { return new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return d; } };
const fechaCorta = (d?: string | null) => { if (!d) return '—'; try { return new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return d; } };
const pesos = (n: number | null | undefined) => n == null || !Number.isFinite(Number(n)) ? '—' : `$${Math.round(Number(n)).toLocaleString('es-CO')}`;

// ¿Está conectada? = la última «Probar conexión» de esa cuenta pasó.
const conectadaDe = (c?: { ultimaPrueba: { ok: boolean } | null } | null) => c?.ultimaPrueba?.ok === true;
const estadoConexion = (c: { configurada: boolean; ultimaPrueba: { ok: boolean } | null }) =>
  !c.configurada ? { t: 'SIN CONECTAR', c: C.amber }
  : !c.ultimaPrueba ? { t: 'SIN PROBAR', c: C.amber }
  : c.ultimaPrueba.ok ? { t: 'CONECTADA', c: C.green } : { t: 'FALLÓ LA PRUEBA', c: C.red };

// Pestañas: el tablero y cada cuenta por separado. Antes el selector de la
// cuenta quedaba al fondo, debajo de todo el tablero, y no se encontraba
// dónde conectar la segunda cuenta.
type Vista = 'tablero' | Cuenta;

export const AdminCoinsenda: React.FC = () => {
  const [vista, setVista] = useState<Vista>('tablero');
  const [d, setD] = useState<Tablero | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = async () => {
    setCargando(true);
    const r = await pedirAdmin({ action: 'coinsenda_dashboard' }).catch(() => null);
    if (r?.ok) { setD(r as Tablero); setError(null); }
    else setError(r?.permisoDenegado ? 'Tu rol no puede ver el tablero de Coinsenda.' : (r?.error ?? 'No se pudo leer el tablero.'));
    setCargando(false);
  };
  useEffect(() => { cargar(); }, []);

  const datosDe = (n: Cuenta) => d?.cuentas.find(c => c.cuenta === n) ?? null;
  const irA = (v: Vista) => { setVista(v); try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* sin scroll suave */ } };
  const sinConectar = d ? ([3, 4] as Cuenta[]).filter(n => !conectadaDe(datosDe(n))) : [];

  return (
    <div style={{ fontFamily: FONT, color: C.text, maxWidth: 1060 }} className="space-y-4">
      <div>
        <p style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', margin: 0 }}>Coinsenda</p>
        <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>
          Dos cuentas: la <b style={{ color: C.text }}>Cuenta 3</b> y la <b style={{ color: C.text }}>Cuenta 4</b> de Bre-B y de ACH. Cada una tiene su correo, su llave, su billetera y su saldo de clientes. Los clientes no ven este nombre: para ellos es solo "Cuenta 3" o "Cuenta 4".
        </p>
      </div>

      <div role="tablist" aria-label="Coinsenda" className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: 8 }}>
        {(['tablero', 3, 4] as Vista[]).map(v => {
          const activa = vista === v;
          const c = v === 'tablero' ? null : datosDe(v);
          const st = c ? estadoConexion(c) : null;
          return (
            <button key={String(v)} role="tab" aria-selected={activa} onClick={() => irA(v)}
              style={{ fontFamily: FONT, textAlign: 'left', cursor: 'pointer', borderRadius: 12, padding: '11px 14px', color: C.text,
                background: activa ? 'rgba(74,222,128,0.08)' : C.card, border: activa ? '1.5px solid rgba(74,222,128,0.55)' : `1px solid ${C.b2}` }}>
              <span className="flex items-center justify-between" style={{ gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 800 }}>{v === 'tablero' ? 'Tablero' : `Cuenta ${v}`}</span>
                {st && <span style={{ color: st.c, fontSize: 9, fontWeight: 700, letterSpacing: '0.6px', whiteSpace: 'nowrap' }}>● {st.t}</span>}
              </span>
              <span style={{ display: 'block', fontSize: 11.5, color: C.sub, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {v === 'tablero' ? 'Saldos, envíos y utilidad de las dos' : `${NOMBRE[v]} · ${c?.email ?? (c ? 'falta conectarla' : 'llave, correo y conexión')}`}
              </span>
            </button>
          );
        })}
      </div>

      {vista === 'tablero' ? (
        <>
          {sinConectar.map(n => (
            <div key={n} className="flex items-center justify-between flex-wrap" style={{ gap: 10, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 12, padding: '11px 14px' }}>
              <span style={{ fontSize: 13, lineHeight: 1.45 }}>
                <b>La Cuenta {n} todavía no está conectada.</b> <span style={{ color: C.sub }}>Genera su llave, regístrala en esa cuenta de Coinsenda, guarda el correo y prueba la conexión.</span>
              </span>
              <button style={{ ...btnPri, background: C.green }} onClick={() => irA(n)}>Conectar Cuenta {n} →</button>
            </div>
          ))}
          <TableroVista d={d} cargando={cargando} error={error} cargar={cargar} irA={n => irA(n)} />
        </>
      ) : (
        // key: cada cuenta arranca limpia (sin el formulario abierto de la otra).
        <PanelCuenta key={vista} cuenta={vista} datos={datosDe(vista)} onCambio={cargar} />
      )}
    </div>
  );
};

// ── Tablero: las dos cuentas de un vistazo ────────────────────────────
type Resumen = { n: number; completados: number; procesando: number; devueltos: number; monto: number; cobrado: number; costo: number; utilidad: number; porRiel: Record<'breb' | 'ach', { n: number; cobrado: number; costo: number; utilidad: number }> };
type CuentaTablero = {
  cuenta: Cuenta; proveedor: string; email: string | null; configurada: boolean;
  llave: { huella: string; at: string } | null; llaveDesdeSecreto: boolean;
  ultimaPrueba: { at: string | null; ok: boolean; detalle: string | null } | null;
  interruptores: { breb: boolean; ach: boolean };
  bolsa: number | null; bolsaError: string | null; clientes: number; libre: number | null;
  hoy: Resumen; mes: Resumen;
};
type Reciente = { id: string; at: string; cuenta: Cuenta; rail: string; monto: number; comision: number; costo: number | null; estado: 'completado' | 'procesando' | 'devuelto'; status: string; revision: boolean; beneficiario: string | null; cliente: string | null };
type Tablero = { cuentas: CuentaTablero[]; recientes: Reciente[]; actualizado: string; clientesParcial: boolean; mesTruncado: boolean };

const ESTADO: Record<Reciente['estado'], { t: string; c: string; bg: string }> = {
  completado: { t: 'Completado', c: C.green, bg: 'rgba(74,222,128,0.10)' },
  procesando: { t: 'En proceso', c: C.amber, bg: 'rgba(251,191,36,0.10)' },
  devuelto: { t: 'Devuelto', c: C.red, bg: 'rgba(248,113,113,0.10)' },
};

const TableroVista: React.FC<{ d: Tablero | null; cargando: boolean; error: string | null; cargar: () => void; irA: (n: Cuenta) => void }> = ({ d, cargando, error, cargar, irA }) => {
  const [filtro, setFiltro] = useState<0 | Cuenta>(0);

  const recientes = (d?.recientes ?? []).filter(r => !filtro || r.cuenta === filtro);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 10 }}>
        <p style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Las dos cuentas</p>
        <div className="flex items-center" style={{ gap: 10 }}>
          {d && <span style={{ fontSize: 11.5, color: C.sub }}>Leído {fechaCorta(d.actualizado)}</span>}
          <button style={{ ...btnSec, padding: '6px 12px' }} disabled={cargando} onClick={cargar}>{cargando ? 'Leyendo…' : 'Actualizar'}</button>
        </div>
      </div>
      {error && <p style={{ fontSize: 12.5, color: C.red, margin: 0 }}>{error}</p>}
      {!d && cargando && <p style={{ fontSize: 12.5, color: C.sub, margin: 0 }}>Leyendo las dos cuentas…</p>}
      {d?.clientesParcial && <p style={{ fontSize: 11.5, color: C.amber, margin: 0 }}>Los saldos de los clientes son una suma parcial: el "de Lincoin" puede salir de más.</p>}

      {d && (
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 14 }}>
          {d.cuentas.map(c => {
            const st = estadoConexion(c);
            const fila = (l: string, hoy: React.ReactNode, mes: React.ReactNode, color?: string) => (
              <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 12, padding: '5px 0', fontSize: 12.5, borderTop: `1px solid ${C.b1}` }}>
                <span style={{ color: C.sub }}>{l}</span>
                <span style={{ textAlign: 'right', minWidth: 70, color: color ?? C.text, fontWeight: 600 }}>{hoy}</span>
                <span style={{ textAlign: 'right', minWidth: 84, color: color ?? C.text, fontWeight: 700 }}>{mes}</span>
              </div>
            );
            return (
              <div key={c.cuenta} style={tarjeta}>
                <div className="flex items-start justify-between" style={{ gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Cuenta {c.cuenta} <span style={{ color: C.sub, fontWeight: 600, fontSize: 12 }}>· {c.proveedor}</span></p>
                    <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email ?? 'Sin correo todavía'}</p>
                  </div>
                  <span style={{ border: `1px solid ${st.c}55`, color: st.c, borderRadius: 999, padding: '3px 8px', fontSize: 9, fontWeight: 700, letterSpacing: '0.6px', whiteSpace: 'nowrap', flexShrink: 0 }}>{st.t}</span>
                </div>

                {/* Saldo de la bolsa y de quién es */}
                <div style={{ marginTop: 14 }}>
                  <p style={ROT}>BILLETERA COP</p>
                  {c.bolsa == null ? (
                    <p style={{ fontSize: 12.5, color: c.configurada ? C.red : C.sub, margin: '4px 0 0', lineHeight: 1.45 }}>{c.bolsaError ?? 'No se pudo leer.'}</p>
                  ) : (
                    <>
                      <p style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.8px', margin: '2px 0 0' }}>{pesos(c.bolsa)}</p>
                      <div className="flex flex-wrap" style={{ gap: '4px 14px', marginTop: 4, fontSize: 12 }}>
                        <span style={{ color: C.sub }}>De clientes (Saldo Cuenta {c.cuenta}) <b style={{ color: C.text }}>{pesos(c.clientes)}</b></span>
                        <span style={{ color: C.sub }}>De Lincoin <b style={{ color: (c.libre ?? 0) < 0 ? C.red : C.green }}>{pesos(c.libre)}</b></span>
                      </div>
                      {(c.libre ?? 0) < 0 && <p style={{ fontSize: 11.5, color: C.red, margin: '4px 0 0' }}>Faltan {pesos(Math.abs(c.libre ?? 0))}: los clientes tienen más de lo que hay en la billetera.</p>}
                    </>
                  )}
                </div>

                {/* Interruptores */}
                <div className="flex flex-wrap" style={{ gap: 6, marginTop: 12 }}>
                  {(['breb', 'ach'] as const).map(k => (
                    <span key={k} style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, border: `1px solid ${c.interruptores[k] ? 'rgba(74,222,128,0.35)' : C.b2}`, color: c.interruptores[k] ? C.green : C.sub }}>
                      {k === 'breb' ? 'Bre-B' : 'ACH'} · {c.interruptores[k] ? 'encendido' : 'apagado'}
                    </span>
                  ))}
                </div>

                {/* Envíos y utilidad: hoy y el mes */}
                <div style={{ marginTop: 14 }}>
                  <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 12, paddingBottom: 4 }}>
                    <span style={ROT}>ENVÍOS</span>
                    <span style={{ ...ROT, textAlign: 'right', minWidth: 70 }}>HOY</span>
                    <span style={{ ...ROT, textAlign: 'right', minWidth: 84 }}>MES</span>
                  </div>
                  {fila('Completados', c.hoy.completados, c.mes.completados)}
                  {fila('En proceso', c.hoy.procesando, c.mes.procesando, c.mes.procesando ? C.amber : undefined)}
                  {fila('Devueltos', c.hoy.devueltos, c.mes.devueltos, c.mes.devueltos ? C.red : undefined)}
                  {fila('Monto enviado', pesos(c.hoy.monto), pesos(c.mes.monto))}
                  {fila('Comisión cobrada', pesos(c.hoy.cobrado), pesos(c.mes.cobrado))}
                  {fila('Costo Coinsenda', pesos(c.hoy.costo), pesos(c.mes.costo))}
                  {fila('Utilidad', pesos(c.hoy.utilidad), pesos(c.mes.utilidad), c.mes.utilidad < 0 ? C.red : C.green)}
                </div>
                <div className="flex flex-wrap" style={{ gap: '4px 14px', marginTop: 8, fontSize: 11.5, color: C.sub }}>
                  {(['breb', 'ach'] as const).map(k => {
                    const r = c.mes.porRiel[k];
                    return <span key={k}>{k === 'breb' ? 'Bre-B' : 'ACH'} este mes: {r.n} envío{r.n === 1 ? '' : 's'} · utilidad <b style={{ color: r.utilidad < 0 ? C.red : C.text }}>{pesos(r.utilidad)}</b></span>;
                  })}
                </div>
                {conectadaDe(c)
                  ? <button style={{ ...btnSec, marginTop: 12, padding: '6px 12px', fontSize: 11.5 }} onClick={() => irA(c.cuenta)}>Ver configuración de la Cuenta {c.cuenta} →</button>
                  : <button style={{ ...btnPri, marginTop: 12, background: C.green }} onClick={() => irA(c.cuenta)}>Conectar Cuenta {c.cuenta} →</button>}
              </div>
            );
          })}
        </div>
      )}
      {d?.mesTruncado && <p style={{ fontSize: 11.5, color: C.amber, margin: 0 }}>Hay demasiados envíos este mes para sumarlos todos aquí: las cifras del mes son parciales.</p>}

      {d && (
        <div style={tarjeta}>
          <div className="flex items-center justify-between flex-wrap" style={{ gap: 10 }}>
            <p style={{ fontSize: 14.5, fontWeight: 700, margin: 0 }}>Últimos envíos</p>
            <div style={{ display: 'inline-flex', background: '#070808', border: `1px solid ${C.b2}`, borderRadius: 999, padding: 2 }}>
              {([[0, 'Las dos'], [3, 'Cuenta 3'], [4, 'Cuenta 4']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setFiltro(k)}
                  style={{ fontFamily: FONT, border: 'none', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: filtro === k ? C.text : 'transparent', color: filtro === k ? '#0C0E0D' : C.sub }}>{l}</button>
              ))}
            </div>
          </div>
          {recientes.length === 0 ? (
            <p style={{ fontSize: 12.5, color: C.sub, margin: '12px 0 0' }}>Todavía no hay envíos{filtro ? ` por la Cuenta ${filtro}` : ''}.</p>
          ) : (
            <div style={{ marginTop: 10 }}>
              {recientes.map((r, i) => {
                const e = ESTADO[r.estado];
                return (
                  <div key={r.id} className="flex items-center justify-between flex-wrap" style={{ gap: '4px 12px', padding: '9px 0', borderTop: i ? `1px solid ${C.b1}` : 'none' }}>
                    <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                      <p style={{ fontSize: 13, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.cliente || 'Cliente'} <span style={{ color: C.sub, fontWeight: 500 }}>→ {r.beneficiario || 'beneficiario'}</span>
                      </p>
                      <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0' }}>
                        {fechaCorta(r.at)} · {r.rail} · Cuenta {r.cuenta} · comisión {pesos(r.comision)}{r.costo != null ? ` · costo ${pesos(r.costo)}` : ''}{r.revision ? ' · en revisión' : ''}
                      </p>
                    </div>
                    <div className="flex items-center" style={{ gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>{pesos(r.monto)}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: e.c, background: e.bg, borderRadius: 999, padding: '3px 8px', whiteSpace: 'nowrap' }}>{e.t}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Una cuenta: llave, conexión e interruptores ─────────────────────────
const PanelCuenta: React.FC<{ cuenta: Cuenta; datos: CuentaTablero | null; onCambio: () => void }> = ({ cuenta, datos, onCambio }) => {
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
    const r = await pedirAdmin({ action: 'coinsenda_llave_estado', cuenta }).catch(() => null);
    if (r?.ok) { setLlave(r.llave ?? null); setDesdeSecreto(!!r.desdeSecreto); setError(null); }
    else setError(r?.permisoDenegado ? 'Solo el dueño puede ver y generar las llaves de Coinsenda.' : (r?.error ?? 'No se pudo leer la llave.'));
    setCargando(false);
  };
  useEffect(() => { cargar(); }, []);

  const generar = async () => {
    if (!gen) return;
    setGen(g => g && ({ ...g, ocupado: true, error: null }));
    const r = await pedirAdmin({ action: 'coinsenda_llave_generar', cuenta, otp: gen.otp, reemplazar: gen.reemplazar }).catch(() => null);
    if (r?.ok && r.llave) { setLlave(r.llave); setGen(null); setRecienGenerada(true); setCopiada(false); onCambio(); return; }
    setGen(g => g && ({ ...g, ocupado: false, otp: '', error: r?.error ?? 'No se pudo generar la llave.' }));
  };

  const copiar = async () => {
    if (!llave) return;
    try { await navigator.clipboard.writeText(llave.publica.trim()); setCopiada(true); setTimeout(() => setCopiada(false), 2500); } catch { /* el navegador no dejó: se puede seleccionar a mano */ }
  };

  return (
    <div className="space-y-4" style={{ maxWidth: 820 }}>
      {/* Los pasos para conectar esta cuenta, con lo que ya está hecho. */}
      {datos && (() => {
        const hayLlaveP = !!llave || desdeSecreto || !!datos.llave || datos.llaveDesdeSecreto;
        const okPrueba = conectadaDe(datos);
        const encendida = datos.interruptores.breb || datos.interruptores.ach;
        const tramo = tramoClave(llave?.publica);
        const pasos: { t: React.ReactNode; hecho: boolean }[] = [
          { t: <>Generar la llave de la Cuenta {cuenta} (abajo, <b>Generar llave</b>, con tu código 2FA).</>, hecho: hayLlaveP },
          { t: <>Entrar a Coinsenda con el correo de {cuenta === 4 ? <b>la Cuenta 4</b> : 'esta cuenta'} y pegar la pública en <b>Ajustes → Desarrollador → Clave pública de API</b> (<b>Registrar clave</b>, o <b>Reemplazar</b> si ya había otra){tramo ? <>. Allá debe quedar empezando «…CgKCAQEA<b>{tramo}</b>…»</> : null}.</>, hecho: okPrueba },
          { t: <>Escribir aquí ese correo y darle <b>Guardar</b>.</>, hecho: datos.configurada },
          { t: <>Darle <b>Probar conexión</b> y que pase.</>, hecho: okPrueba },
          { t: <>Encender Bre-B y/o ACH · Cuenta {cuenta} para los clientes.</>, hecho: encendida },
        ];
        const listo = pasos.every(x => x.hecho);
        return (
          <div style={{ ...tarjeta, borderColor: listo ? 'rgba(74,222,128,0.3)' : 'rgba(251,191,36,0.35)' }}>
            <p style={{ fontSize: 14.5, fontWeight: 700, margin: 0 }}>{listo ? `La Cuenta ${cuenta} está conectada y encendida` : `Conectar la Cuenta ${cuenta}`}</p>
            <ol style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }} className="space-y-2">
              {pasos.map((x, i) => (
                <li key={i} className="flex items-start" style={{ gap: 10, fontSize: 12.5, lineHeight: 1.5, color: x.hecho ? C.sub : C.text }}>
                  <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800,
                    background: x.hecho ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.06)', color: x.hecho ? C.green : C.text }}>{x.hecho ? '✓' : i + 1}</span>
                  <span>{x.t}</span>
                </li>
              ))}
            </ol>
          </div>
        );
      })()}
      <div style={tarjeta}>
        <div className="flex items-start justify-between" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 14.5, fontWeight: 700, margin: 0 }}>Llave de la API · Cuenta {cuenta}</p>
            <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0', lineHeight: 1.5 }}>
              La <b style={{ color: C.text }}>pública</b> se pega en Coinsenda, entrando con el correo de la Cuenta {cuenta}. La <b style={{ color: C.text }}>privada</b> la guarda el servidor, cifrada, y no sale de ahí.
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
            <p style={{ fontSize: 12.5, color: C.sub, margin: '0 0 10px', lineHeight: 1.5 }}>
              Todavía no hay llave para la Cuenta {cuenta}. Genérala aquí y luego copia la pública en esa cuenta de Coinsenda.
            </p>
            <button style={btnPri} onClick={() => setGen({ otp: '', reemplazar: false, ocupado: false, error: null })}>Generar llave</button>
          </div>
        )}

        {!cargando && !error && llave && (
          <div style={{ marginTop: 14 }}>
            {recienGenerada && (
              <div style={{ background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 10, padding: '10px 12px', marginBottom: 10, fontSize: 12.5, lineHeight: 1.5 }}>
                Llave lista. Entra a Coinsenda con el correo de la Cuenta {cuenta}, y pégala en <b>Ajustes → Desarrollador → Clave pública de API</b>; dale <b>Registrar clave</b> (o <b>Reemplazar</b> si allá ya había otra).
              </div>
            )}
            <div className="flex items-center justify-between" style={{ gap: 8, marginBottom: 6 }}>
              <p style={ROT}>CLAVE PÚBLICA</p>
              <button style={{ ...btnSec, padding: '5px 11px', color: copiada ? C.green : C.text, borderColor: copiada ? 'rgba(74,222,128,0.4)' : C.b2 }} onClick={copiar}>{copiada ? 'Copiada ✓' : 'Copiar'}</button>
            </div>
            <pre style={{ fontFamily: MONO, fontSize: 11.5, color: C.text, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 9, padding: 12, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'all' }}>{llave.publica.trim()}</pre>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
              <div>
                <p style={ROT}>HUELLA</p>
                <p style={{ fontFamily: MONO, fontSize: 12, margin: '3px 0 0' }}>{llave.huella}</p>
              </div>
              {tramoClave(llave.publica) && (
                <div>
                  <p style={ROT}>EN COINSENDA SE VE ASÍ</p>
                  <p style={{ fontFamily: MONO, fontSize: 12, margin: '3px 0 0', wordBreak: 'break-all' }}>…CgKCAQEA<b style={{ color: C.green }}>{tramoClave(llave.publica)}</b>…</p>
                </div>
              )}
              <div>
                <p style={ROT}>GENERADA</p>
                <p style={{ fontSize: 12, margin: '3px 0 0' }}>{fecha(llave.at)}{llave.por?.nombre || llave.por?.email ? ` · ${llave.por?.nombre || llave.por?.email}` : ''}</p>
              </div>
            </div>
            {desdeSecreto && (
              <p style={{ fontSize: 11.5, color: C.amber, margin: '10px 0 0', lineHeight: 1.5 }}>
                Ojo: en los secretos de Supabase hay un {cuenta === 4 ? 'COINSENDA_PRIVATE_KEY_C4' : 'COINSENDA_PRIVATE_KEY'}, y ese manda sobre esta llave. Si vas a usar la de aquí, borra ese secreto.
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
                La llave nueva reemplaza a la actual de la Cuenta {cuenta}: la que está registrada en Coinsenda deja de servir hasta que pegues la nueva allá.
              </p>
            )}
            <p style={{ ...ROT, margin: '0 0 6px' }}>TU CÓDIGO 2FA</p>
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

      {!error && <Conexion cuenta={cuenta} hayLlave={!!llave || desdeSecreto} onCambio={onCambio} />}
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

const Conexion: React.FC<{ cuenta: Cuenta; hayLlave: boolean; onCambio: () => void }> = ({ cuenta, hayLlave, onCambio }) => {
  const [email, setEmail] = useState<string | null>(null);
  const [borrador, setBorrador] = useState('');
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ultima, setUltima] = useState<{ at: string; ok: boolean; detalle?: string | null } | null>(null);
  const [probando, setProbando] = useState(false);
  const [prueba, setPrueba] = useState<Prueba | null>(null);
  // Esta cuenta para los clientes: encendida o no, por riel.
  const [sw, setSw] = useState<{ breb: boolean; ach: boolean }>({ breb: false, ach: false });
  const [swOcupado, setSwOcupado] = useState(false);
  const [swMsg, setSwMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    pedirAdmin({ action: 'coinsenda_config_get', cuenta }).then(r => {
      if (r?.ok) {
        setEmail(r.email ?? null); setBorrador(r.email ?? ''); setEditando(!r.email); setUltima(r.ultimaPrueba ?? null);
        const i = r.interruptores ?? (cuenta === 3 ? r.cuenta3 : null);
        if (i) setSw({ breb: i.breb === true, ach: i.ach === true });
      }
    }).catch(() => {});
  }, []);

  const cambiar = async (riel: 'breb' | 'ach') => {
    const nuevo = { ...sw, [riel]: !sw[riel] };
    setSwOcupado(true); setSwMsg(null);
    const r = await pedirAdmin({ action: 'coinsenda_cuenta_set', cuenta, ...nuevo }).catch(() => null);
    setSwOcupado(false);
    if (r?.ok) {
      setSw(nuevo); onCambio();
      setSwMsg({ ok: true, texto: `${riel === 'breb' ? 'Bre-B' : 'ACH'} · Cuenta ${cuenta} ${nuevo[riel] ? 'activada: los clientes ya la pueden usar.' : 'apagada: vuelve a «Próximamente».'}` });
    } else setSwMsg({ ok: false, texto: r?.needs2fa ? 'Tu sesión necesita el 2FA para cambiar esto. Sal y vuelve a entrar con tu código.' : (r?.error ?? 'No se pudo cambiar.') });
  };

  const guardar = async () => {
    setGuardando(true); setMsg(null);
    const r = await pedirAdmin({ action: 'coinsenda_config_guardar', cuenta, email: borrador.trim() }).catch(() => null);
    setGuardando(false);
    if (r?.ok) {
      setEmail(borrador.trim().toLowerCase()); setEditando(false); onCambio();
      if (r.cambia) { setUltima(null); setPrueba(null); }
      if (r.apagada) setSw({ breb: false, ach: false });
      setMsg({ ok: true, texto: r.apagada ? 'Guardado. Como cambió la cuenta, sus envíos quedaron apagados: prueba la conexión y vuelve a encenderlos.' : r.cambia ? 'Guardado. Como cambió la cuenta, vuelve a probar la conexión.' : 'Guardado.' });
    }
    else setMsg({ ok: false, texto: r?.needs2fa ? 'Tu sesión necesita el 2FA para cambiar esto. Sal y vuelve a entrar con tu código.' : (r?.error ?? 'No se pudo guardar.') });
  };

  const probar = async () => {
    setProbando(true); setPrueba(null);
    const r = await pedirAdmin({ action: 'coinsenda_probar', cuenta }).catch(() => null);
    setProbando(false);
    if (r && Array.isArray(r.pasos)) { setPrueba(r); setUltima({ at: new Date().toISOString(), ok: !!r.ok, detalle: r.pasos.find((p: Paso) => !p.ok)?.detalle ?? null }); onCambio(); }
    else setPrueba({ ok: false, pasos: [], error: r?.error ?? 'No se pudo probar la conexión.' });
  };

  return (
    <>
    <div style={tarjeta}>
      <p style={{ fontSize: 14.5, fontWeight: 700, margin: 0 }}>Conexión · Cuenta {cuenta}</p>
      <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0', lineHeight: 1.5 }}>
        El correo con el que entras a {cuenta === 4 ? 'la cuenta de la Cuenta 4' : 'Coinsenda'}: va dentro del token que firma la llave. Tiene que ser otro distinto al de la Cuenta {cuenta === 3 ? 4 : 3}.
      </p>

      <p style={{ ...ROT, margin: '14px 0 6px' }}>CORREO DE LA CUENTA</p>
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
      {msg && <p style={{ fontSize: 12.5, color: msg.ok ? C.green : C.red, margin: '8px 0 0', lineHeight: 1.45 }}>{msg.texto}</p>}

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
                <p style={{ ...ROT, margin: '6px 0 6px' }}>BILLETERAS COP</p>
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
                <p style={{ ...ROT, margin: '6px 0 6px' }}>MEDIOS DE ENVÍO COP</p>
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
                <p style={{ ...ROT, margin: '6px 0 0' }}>MEDIOS DE OTRAS MONEDAS</p>
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

    <div style={tarjeta}>
      <p style={{ fontSize: 14.5, fontWeight: 700, margin: 0 }}>Envíos por Cuenta {cuenta}</p>
      <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0', lineHeight: 1.5 }}>
        Apagada, el cliente la ve como «Próximamente». Encendida, puede enviar por ella. La plata sale de la billetera COP de esta cuenta de Coinsenda y al cliente se le descuenta de su <b style={{ color: C.text }}>Saldo Cuenta {cuenta}</b> (lo cargas en la Billetera con destino {NOMBRE[cuenta]}).
      </p>
      <div className="space-y-2" style={{ marginTop: 12 }}>
        {([
          { k: 'breb' as const, t: `Bre-B · Cuenta ${cuenta}`, d: `Del Saldo Cuenta ${cuenta} del cliente · comisión $2.500 · Coinsenda cobra $2.000` },
          { k: 'ach' as const, t: `ACH · Cuenta ${cuenta}`, d: `Del Saldo Cuenta ${cuenta} del cliente · comisión $2.500 · Coinsenda cobra $1.000 · llega en 6 a 24 h` },
        ]).map(f => (
          <div key={f.k} className="flex items-center justify-between" style={{ gap: 12, padding: '10px 12px', borderRadius: 10, background: C.elev, border: `1px solid ${C.b1}` }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{f.t}</p>
              <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0', lineHeight: 1.45 }}>{f.d}</p>
            </div>
            <button role="switch" aria-checked={sw[f.k]} aria-label={f.t} disabled={swOcupado} onClick={() => cambiar(f.k)}
              style={{ flexShrink: 0, width: 44, height: 24, borderRadius: 999, border: 'none', cursor: swOcupado ? 'wait' : 'pointer', position: 'relative', background: sw[f.k] ? C.green : 'rgba(255,255,255,0.14)', transition: 'background 0.15s' }}>
              <span style={{ position: 'absolute', top: 3, left: sw[f.k] ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: sw[f.k] ? '#0C0E0D' : C.text, transition: 'left 0.15s' }} />
            </button>
          </div>
        ))}
      </div>
      {swMsg && <p style={{ fontSize: 12.5, color: swMsg.ok ? C.green : C.red, margin: '8px 0 0' }}>{swMsg.texto}</p>}
      {ultima?.ok !== true && !(sw.breb || sw.ach) && <p style={{ fontSize: 11.5, color: C.sub, margin: '8px 0 0' }}>Para encenderla, la prueba de conexión de la Cuenta {cuenta} tiene que pasar primero.</p>}
      {ultima?.ok === false && (sw.breb || sw.ach) && (
        <p style={{ fontSize: 12, color: C.amber, margin: '8px 0 0', lineHeight: 1.45 }}>
          La última prueba falló y esta cuenta sigue encendida: mientras no se arregle, los envíos por la Cuenta {cuenta} no salen (al cliente no se le descuenta nada, pero ve el error). Apágala o arregla la conexión.
        </p>
      )}
    </div>
    </>
  );
};
