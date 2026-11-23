import React, { useState } from 'react';
import { llamarFuncion } from '../lib/edge';

// ─────────────────────────────────────────────────────────────
// Inscripciones de cuentas en Finity (ACH · Cuenta 2), para la mesa.
//
// 23 nov (el dueño): "no están llegando las inscripciones a Finity desde
// Lincoin". No había dónde ver por qué: cada intento quedaba en la auditoría
// con lo que contestó Finity, pero ninguna pantalla lo mostraba, y una
// cuenta cuya primera inscripción fallaba solo se reintentaba si el cliente
// volvía a abrir sus beneficiarios. Esto muestra, en un solo lugar:
//   · si el servidor conecta con Finity y a qué dominio (el único activo es
//     api.finity.com.co);
//   · si las inscripciones están en pausa (Finity respondió 403/429);
//   · los últimos intentos con la respuesta de Finity;
//   · las cuentas que siguen sin inscribir, con su último error,
// y deja inscribir las pendientes ya, sin esperar la tarea programada.
// ─────────────────────────────────────────────────────────────

type Intento = { at: string; quien: string | null; status: number; ok: boolean; id: string | null; cuenta: string; banco: string | null; titular: string | null; tipoDoc: string | null; motivo: string | null };
type Pendiente = { userId: string; cliente: string; contacto: string; banco: string; cuenta: string; creada: string | null; ultimoIntento: string | null; http: number | null; ultimoError: string | null; datosIncompletos: string | null; listaParaReintento: boolean };
type Diag = {
  ok?: boolean; error?: string; message?: string;
  conexion?: { ok: boolean; base: string; error?: string; rechazo?: { base: string; status: number; cuerpo: string; at: string } | null };
  baseIgnorada?: string | null;
  pausa?: { hasta: string; http: number | null; seguidos: number } | null;
  intentos?: Intento[]; pendientes?: Pendiente[]; totalPendientes?: number; truncado?: boolean; errorPendientes?: string | null;
};
type Corrida = { ok?: boolean; frenado?: boolean; hasta?: string; http?: number; pendientes?: number; candidatas?: number; intentadas?: number; inscritas?: number; resultados?: { cliente: string; contacto: string; cuenta: string; ok: boolean; status: number; reutilizada: boolean; motivo: string | null }[]; error?: string; message?: string };

const VERDE = '#4ADE80', AMBAR = '#FBBF24', ROJO = '#F87171', TXT = '#F4F4F2', TXT2 = '#878E88', TXT3 = 'rgba(244,244,242,0.45)';
const fecha = (d: string | null | undefined) => {
  if (!d) return '—';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
// Lo que guardó la pantalla del cliente trae el cuerpo crudo de la respuesta:
// se muestra el mensaje y no el JSON entero.
const limpiarError = (e: string | null) => {
  if (!e) return null;
  const m = e.match(/"message"\s*:\s*"([^"]+)"/) ?? e.match(/"message"\s*:\s*\[\s*"([^"]+)"/);
  return m ? `${e.match(/HTTP\s+\d+/)?.[0] ?? ''} ${m[1]}`.trim() : e.slice(0, 200);
};
const sinPermiso = (r: any) => r?.error === 'forbidden' || r?.error === 'unauthorized';

export const AdminFinityInscripciones: React.FC = () => {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [d, setD] = useState<Diag | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [corrida, setCorrida] = useState<Corrida | null>(null);
  const [reanudando, setReanudando] = useState(false);

  const cargar = async () => {
    setCargando(true);
    try { setD(await llamarFuncion('finity-proxy', { action: 'inscripciones_diag' }, 60000)); }
    catch (e: any) { setD({ error: 'red', message: String(e?.message ?? e) }); }
    finally { setCargando(false); }
  };
  const abrir = () => { setAbierto(true); setCorrida(null); cargar(); };

  const inscribirAhora = async () => {
    setCorriendo(true); setCorrida(null);
    try { setCorrida(await llamarFuncion('finity-proxy', { action: 'inscribir_pendientes', forzar: true, limite: 5 }, 130000)); }
    catch (e: any) { setCorrida({ error: 'red', message: String(e?.message ?? e) }); }
    finally { setCorriendo(false); cargar(); }
  };
  const reanudar = async () => {
    setReanudando(true);
    try { await llamarFuncion('finity-proxy', { action: 'inscripciones_reanudar' }, 30000); }
    finally { setReanudando(false); cargar(); }
  };

  const BOTON: React.CSSProperties = { background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: TXT, borderRadius: 8, padding: '6px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
  const TH: React.CSSProperties = { padding: '6px 4px', fontWeight: 600, color: TXT2, textAlign: 'left', whiteSpace: 'nowrap' };
  const TD: React.CSSProperties = { padding: '6px 4px', verticalAlign: 'top' };
  const ROT: React.CSSProperties = { margin: '18px 0 6px', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: TXT2 };

  return (
    <>
      <button type="button" onClick={abrir}
        style={{ marginTop: 4, background: 'transparent', border: 'none', padding: 0, color: TXT2, fontSize: 10.5, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}>
        Inscripciones · Cuenta 2
      </button>
      {abierto && (
        <div role="dialog" aria-label="Inscripciones a Finity" onClick={() => setAbierto(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 860, maxHeight: '88vh', overflowY: 'auto', boxSizing: 'border-box', background: '#121413', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: 18, color: TXT, fontFamily: 'Archivo, system-ui, sans-serif' }}>
            <div className="flex items-start justify-between" style={{ gap: 12 }}>
              <div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Inscripciones de cuentas · ACH Cuenta 2 (Finity)</p>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: TXT2, lineHeight: 1.45 }}>
                  Cada cuenta ACH de un beneficiario se inscribe en Finity antes de poder recibir por la Cuenta 2. Las que fallan se reintentan solas cada 15 minutos.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button type="button" onClick={cargar} disabled={cargando} style={{ ...BOTON, opacity: cargando ? 0.5 : 1 }}>Actualizar</button>
                <button type="button" onClick={() => setAbierto(false)} style={BOTON}>Cerrar</button>
              </div>
            </div>

            {cargando && !d && <p style={{ marginTop: 14, fontSize: 13, color: TXT2 }}>Consultando a Finity…</p>}
            {d && !d.ok && (
              <p style={{ marginTop: 14, fontSize: 12.5, color: ROJO, lineHeight: 1.5 }}>
                {sinPermiso(d) ? 'Tu rol no tiene acceso a las inscripciones de Finity.' : (d.message ?? d.error ?? 'No se pudo leer el estado.')}
              </p>
            )}

            {d?.ok && (
              <>
                {/* Conexión */}
                <p style={ROT}>Conexión</p>
                <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                  {d.conexion?.ok
                    ? <span style={{ color: VERDE, fontWeight: 700 }}>✓ Conectado a {d.conexion.base}</span>
                    : <>
                        <span style={{ color: ROJO, fontWeight: 700 }}>✗ No conecta con {d.conexion?.base}</span>
                        <span style={{ color: TXT2 }}> — sin conexión no se inscribe ninguna cuenta.</span>
                        {d.conexion?.rechazo && (
                          <p style={{ margin: '4px 0 0', color: TXT2 }}>
                            Finity respondió {d.conexion.rechazo.status || 'sin respuesta'} al pedir el token ({fecha(d.conexion.rechazo.at)}): <span style={{ color: TXT }}>{d.conexion.rechazo.cuerpo}</span>
                          </p>
                        )}
                        {!d.conexion?.rechazo && d.conexion?.error && <p style={{ margin: '4px 0 0', color: TXT2 }}>{d.conexion.error}</p>}
                        <p style={{ margin: '4px 0 0', color: TXT2 }}>Si dice credenciales inválidas, revisa FINITY_CLIENT_ID y FINITY_CLIENT_SECRET en Supabase → Edge Functions → Secrets.</p>
                      </>}
                  {d.baseIgnorada && (
                    <p style={{ margin: '6px 0 0', color: AMBAR }}>
                      La variable FINITY_BASE_URL apunta a {d.baseIgnorada}, que ya no es el dominio de Finity: se ignora y se usa api.finity.com.co. Bórrala en Supabase → Edge Functions → Secrets.
                    </p>
                  )}
                </div>

                {/* Pausa */}
                {d.pausa && (
                  <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, border: `1px solid ${AMBAR}55`, background: `${AMBAR}10`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, color: TXT, lineHeight: 1.5 }}>
                      <b style={{ color: AMBAR }}>Inscripciones en pausa</b> hasta {fecha(d.pausa.hasta)}: Finity respondió {d.pausa.http ?? '—'}{d.pausa.seguidos > 0 ? ` (${d.pausa.seguidos + 1} veces seguidas)` : ''}. Insistir es lo que hace que bloquee la API.
                    </span>
                    <button type="button" onClick={reanudar} disabled={reanudando} style={{ ...BOTON, opacity: reanudando ? 0.5 : 1 }}>Reanudar ahora</button>
                  </div>
                )}

                {/* Pendientes */}
                <div style={{ ...ROT, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', textTransform: 'none', letterSpacing: 0 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    Sin inscribir · {d.totalPendientes ?? 0}{d.truncado ? '+' : ''}
                  </span>
                  {(d.totalPendientes ?? 0) > 0 && (
                    <button type="button" onClick={inscribirAhora} disabled={corriendo}
                      style={{ ...BOTON, color: '#0C0E0D', background: VERDE, border: 'none', opacity: corriendo ? 0.6 : 1 }}>
                      {corriendo ? 'Inscribiendo…' : 'Inscribir pendientes ahora'}
                    </button>
                  )}
                </div>
                {d.errorPendientes && <p style={{ fontSize: 12, color: ROJO }}>{d.errorPendientes}</p>}
                {corrida && (
                  <div style={{ margin: '2px 0 8px', fontSize: 12.5, lineHeight: 1.5, color: corrida.ok === false || corrida.error ? ROJO : TXT }}>
                    {corrida.error ? (sinPermiso(corrida) ? 'Tu rol no puede inscribir cuentas.' : (corrida.message ?? corrida.error))
                      : corrida.frenado ? `No se intentó: inscripciones en pausa hasta ${fecha(corrida.hasta ?? null)} (Finity respondió ${corrida.http}).`
                      : `Intentadas ${corrida.intentadas ?? 0} · inscritas ${corrida.inscritas ?? 0}.`}
                    {(corrida.resultados ?? []).map((x, i) => (
                      <div key={i} style={{ color: x.ok ? VERDE : TXT2 }}>
                        {x.ok ? '✓' : '✗'} {x.contacto} ({x.cliente}) {x.cuenta}{x.ok ? (x.reutilizada ? ' — ya estaba en Finity' : ' — inscrita') : ` — HTTP ${x.status || 'sin respuesta'}${x.motivo ? `: ${x.motivo}` : ''}`}
                      </div>
                    ))}
                  </div>
                )}
                {(d.pendientes?.length ?? 0) === 0
                  ? <p style={{ fontSize: 12.5, color: VERDE }}>Todas las cuentas ACH de los beneficiarios están inscritas.</p>
                  : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead><tr>
                          <th style={TH}>Cliente</th><th style={TH}>Beneficiario</th><th style={TH}>Banco · cuenta</th><th style={TH}>Último intento</th><th style={TH}>Qué pasó</th>
                        </tr></thead>
                        <tbody>
                          {d.pendientes!.map((p, i) => (
                            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                              <td style={TD}>{p.cliente}</td>
                              <td style={TD}>{p.contacto}</td>
                              <td style={{ ...TD, whiteSpace: 'nowrap' }}>{p.banco} <span style={{ color: TXT3 }}>{p.cuenta}</span></td>
                              <td style={{ ...TD, whiteSpace: 'nowrap', color: TXT2 }}>{p.ultimoIntento ? `${fecha(p.ultimoIntento)}${p.http != null ? ` · ${p.http || 'sin resp.'}` : ''}` : 'nunca'}</td>
                              <td style={{ ...TD, color: p.datosIncompletos ? AMBAR : TXT2 }}>
                                {p.datosIncompletos ? `No se puede inscribir: ${p.datosIncompletos}.` : (limpiarError(p.ultimoError) ?? '—')}
                                {!p.datosIncompletos && !p.listaParaReintento && <span style={{ color: TXT3 }}> · espera antes del próximo intento</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                {/* Últimos intentos */}
                <p style={ROT}>Últimos intentos · lo que contestó Finity</p>
                {(d.intentos?.length ?? 0) === 0
                  ? <p style={{ fontSize: 12.5, color: TXT2 }}>Sin intentos registrados.</p>
                  : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead><tr>
                          <th style={TH}>Fecha</th><th style={TH}>Resultado</th><th style={TH}>Titular</th><th style={TH}>Banco · cuenta</th><th style={TH}>Respuesta</th>
                        </tr></thead>
                        <tbody>
                          {d.intentos!.map((x, i) => (
                            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                              <td style={{ ...TD, whiteSpace: 'nowrap', color: TXT2 }}>{fecha(x.at)}</td>
                              <td style={{ ...TD, whiteSpace: 'nowrap', fontWeight: 700, color: x.ok ? VERDE : ROJO }}>{x.ok ? `✓ ${x.status}` : `✗ ${x.status || 'sin respuesta'}`}</td>
                              <td style={TD}>{x.titular ?? '—'}{x.tipoDoc ? <span style={{ color: TXT3 }}> · {x.tipoDoc}</span> : null}</td>
                              <td style={{ ...TD, whiteSpace: 'nowrap' }}>{x.banco ?? '—'} <span style={{ color: TXT3 }}>{x.cuenta}</span></td>
                              <td style={{ ...TD, color: TXT2 }}>{x.ok ? (x.id ? `id ${x.id}` : 'creada') : (x.motivo ?? '—')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};
