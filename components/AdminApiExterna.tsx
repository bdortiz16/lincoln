import React, { useCallback, useEffect, useState } from 'react';
import { llamarFuncion } from '../lib/edge';
// @ts-ignore — Vite importa el .md como texto (?raw)
import guiaCompleta from '../docs/api-empresas.md?raw';

// ══════════════════════════════════════════════════════════════════
//  API externa — credenciales del sistema que lee los saldos de los
//  clientes de cada empresa (función api-empresas).
//
//  Se crea la credencial (el secreto se ve UNA sola vez), se revoca, y se
//  ve el registro de cada consulta: IP, país, programa, dispositivo y
//  resultado. Solo el dueño (lo exige el servidor).
//  Guía para el sistema externo: docs/api-empresas.md
// ══════════════════════════════════════════════════════════════════

const FONT = 'Archivo, system-ui, sans-serif';
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const C = { card: '#0C0E0D', elev: '#121413', border: 'rgba(255,255,255,0.08)', text: '#F4F4F2', sub: '#878E88', verde: '#4ADE80', rojo: '#F87171', ambar: '#FBBF24' };

const RESULTADOS = ['ok', 'firma_invalida', 'hora_fuera_de_rango', 'nonce_repetido', 'generacion_vencida', 'reuso_detectado', 'credencial_revocada', 'ip_no_permitida', 'demasiadas_consultas', 'id_no_existe', 'error'];

const fecha = (iso?: string | null) => iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 };
const input: React.CSSProperties = { width: '100%', background: C.elev, border: `1px solid ${C.border}`, borderRadius: 9, padding: '9px 11px', color: C.text, fontSize: 13, fontFamily: FONT };
const btn: React.CSSProperties = { padding: '9px 14px', borderRadius: 9, fontSize: 13, fontWeight: 700, border: `1px solid rgba(255,255,255,0.18)`, background: 'rgba(255,255,255,0.06)', color: C.text, cursor: 'pointer' };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 10.5, letterSpacing: '0.8px', color: C.sub, fontWeight: 700, padding: '8px 8px', borderBottom: `1px solid ${C.border}` };
const td: React.CSSProperties = { fontSize: 12.5, color: C.text, padding: '8px 8px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' };

const BASE_API = 'https://wqleypebmfiaygrurnrc.supabase.co/functions/v1/api-empresas';

const Codigo: React.FC<{ children: string }> = ({ children }) => (
  <pre style={{ fontFamily: MONO, fontSize: 12, color: C.text, background: C.elev, border: `1px solid ${C.border}`, borderRadius: 9, padding: 12, margin: '8px 0 14px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{children}</pre>
);
const H: React.FC<{ children: React.ReactNode }> = ({ children }) => <p style={{ fontSize: 13.5, fontWeight: 800, color: C.text, margin: '18px 0 4px' }}>{children}</p>;
const P: React.FC<{ children: React.ReactNode }> = ({ children }) => <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0', lineHeight: 1.6 }}>{children}</p>;

const Documentacion: React.FC = () => {
  const descargar = () => {
    const url = URL.createObjectURL(new Blob([guiaCompleta as string], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'lincoin-api-empresas.md';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0 }}>API de saldos por empresa</p>
        <button style={btn} onClick={descargar}>Descargar guía completa (.md)</button>
      </div>
      <P>Solo lectura. Un sistema externo consulta, de todas las empresas, los saldos de sus clientes (operadores aprobados). Cada consulta va firmada y el secreto rota cada hora.</P>

      <H>Endpoints</H>
      <Codigo>{`GET  ${BASE_API}              → todas las empresas
GET  ${BASE_API}?id=JERO123   → detalle de una empresa y sus clientes
POST ${BASE_API}/rotar        → nueva generación del secreto (cada hora)`}</Codigo>

      <H>Encabezados de cada consulta</H>
      <Codigo>{`X-Llave-Id     lk_xxxxxxxxxxxx (público)
X-Generacion   número de la generación del secreto en uso
X-Hora         UTC ISO-8601, ±5 min de la hora de Lincoin
X-Nonce        aleatorio, distinto en cada consulta (16–128 caracteres)
X-Firma        HMAC-SHA256 en hex (ver abajo)
X-Dispositivo  opcional: nombre del equipo, queda en el registro`}</Codigo>

      <H>Qué se firma</H>
      <Codigo>{`METODO \n RUTA (/functions/v1/…) \n QUERY ordenada (k=v&k=v) \n X-Hora \n X-Nonce \n SHA256_HEX(cuerpo)
clave = bytes del SECRETO decodificado de base64url`}</Codigo>
      <P>Vector de prueba: secreto <code>AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA</code>, GET, ruta <code>/functions/v1/api-empresas</code>, query <code>id=JERO123</code>, hora <code>2026-11-12T22:10:00Z</code>, nonce <code>n0nce-0000-1111</code>, cuerpo vacío → firma <code>2f322d5c…7b03f1ad</code>.</P>

      <H>Rotación y seguridad</H>
      <P>• Rotar cada hora con <code>POST /rotar</code> y guardar el nuevo secreto ANTES de usarlo. La generación anterior vale 5 minutos más; cada generación vence a las 24 h.</P>
      <P>• Si un secreto ya reemplazado se vuelve a usar, la credencial se revoca sola (posible robo) y llega un correo. Si se pierde la respuesta de /rotar, se puede repetir con la misma generación.</P>
      <P>• Máximo 60 consultas por minuto. Los errores de autenticación son siempre 401 genérico; el motivo exacto queda en el registro.</P>
      <P>• La primera consulta desde una IP nueva envía un correo de aviso.</P>
    </div>
  );
};

const Probar: React.FC<{ creds: any[] | null }> = ({ creds }) => {
  const activas = (creds ?? []).filter(c => c.estado === 'activa');
  const [credId, setCredId] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [cargando, setCargando] = useState(false);
  const [res, setRes] = useState<any>(null);
  const elegida = credId || activas[0]?.id || '';
  const probar = async () => {
    setCargando(true); setRes(null);
    const r = await llamarFuncion('api-empresas', { action: 'probar', credencial_id: elegida, id: empresa });
    setCargando(false); setRes(r);
  };
  return (
    <div style={card}>
      <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0 }}>Probar la API</p>
      <P>El servidor firma una consulta con el secreto vigente de la credencial y la pasa por las mismas validaciones que una externa. No rota el secreto: no afecta al sistema que la usa. Queda en el registro como «prueba-panel-admin».</P>
      {activas.length === 0 ? <P>No hay credenciales activas. Crea una en la pestaña Llaves.</P> : (
        <>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: 12 }}>
            <select style={input} value={elegida} onChange={e => setCredId(e.target.value)}>
              {activas.map(c => <option key={c.id} value={c.id}>{c.etiqueta} · {c.llave_id}</option>)}
            </select>
            <input style={input} placeholder="ID Lincoin de la empresa (vacío = todas)" value={empresa} onChange={e => setEmpresa(e.target.value)} />
          </div>
          <button style={{ ...btn, marginTop: 12, background: '#F4F4F2', color: '#0A0A0A' }} disabled={cargando || !elegida} onClick={probar}>
            {cargando ? 'Consultando…' : empresa.trim() ? 'Consultar empresa' : 'Listar empresas'}
          </button>
        </>
      )}
      {res && (
        <div style={{ marginTop: 14 }}>
          {res.ok === false
            ? <p style={{ color: C.rojo, fontSize: 13 }}>{res.error}</p>
            : <p style={{ fontSize: 12.5, color: res.status === 200 ? C.verde : C.ambar, margin: 0 }}>HTTP {res.status} · {res.duracion_ms} ms · generación {res.generacion}</p>}
          {res.cuerpo !== undefined && <Codigo>{typeof res.cuerpo === 'string' ? res.cuerpo : JSON.stringify(res.cuerpo, null, 2)}</Codigo>}
        </div>
      )}
    </div>
  );
};

export const AdminApiExterna: React.FC = () => {
  const [pestana, setPestana] = useState<'llaves' | 'docs' | 'probar'>('llaves');
  const [creds, setCreds] = useState<any[] | null>(null);
  const [consultas, setConsultas] = useState<any[] | null>(null);
  const [filtro, setFiltro] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [etiqueta, setEtiqueta] = useState('');
  const [ips, setIps] = useState('');
  const [creando, setCreando] = useState(false);
  const [nueva, setNueva] = useState<{ llave_id: string; secreto: string; generacion: number; expira_at: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    const [a, b] = await Promise.all([
      llamarFuncion('api-empresas', { action: 'listar' }),
      llamarFuncion('api-empresas', { action: 'registro', ...(filtro ? { resultado: filtro } : {}) }),
    ]);
    if (a?.ok === false) { setError(a.error ?? 'No se pudo cargar.'); return; }
    setCreds(a?.credenciales ?? []);
    setConsultas(b?.consultas ?? []);
  }, [filtro]);

  useEffect(() => { cargar(); }, [cargar]);

  const crear = async () => {
    setCreando(true); setError(null);
    const r = await llamarFuncion('api-empresas', { action: 'crear', etiqueta, ips });
    setCreando(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo crear.'); return; }
    setNueva(r); setEtiqueta(''); setIps(''); setCopiado(false);
    cargar();
  };

  const revocar = async (c: any) => {
    if (!window.confirm(`¿Revocar la credencial "${c.etiqueta}"? El sistema que la usa deja de poder consultar de inmediato.`)) return;
    const r = await llamarFuncion('api-empresas', { action: 'revocar', id: c.id });
    if (!r?.ok) { setError(r?.error ?? 'No se pudo revocar.'); return; }
    cargar();
  };

  const copiar = () => {
    if (!nueva) return;
    const texto = `LLAVE_ID=${nueva.llave_id}\nGENERACION=${nueva.generacion}\nSECRETO=${nueva.secreto}`;
    navigator.clipboard?.writeText(texto).then(() => setCopiado(true)).catch(() => {});
  };

  const pestanas: { k: typeof pestana; t: string }[] = [{ k: 'llaves', t: 'Llaves' }, { k: 'docs', t: 'Documentación' }, { k: 'probar', t: 'Probar' }];
  return (
    <div style={{ fontFamily: FONT, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {pestanas.map(p => (
          <button key={p.k} onClick={() => setPestana(p.k)} style={{ ...btn, padding: '7px 13px', fontSize: 12.5, background: pestana === p.k ? 'rgba(255,255,255,0.10)' : 'transparent', color: pestana === p.k ? C.text : C.sub }}>{p.t}</button>
        ))}
      </div>
      {error && <div style={{ ...card, borderColor: 'rgba(248,113,113,0.35)', color: C.rojo, fontSize: 13 }}>{error}</div>}
      {pestana === 'docs' && <Documentacion />}
      {pestana === 'probar' && <Probar creds={creds} />}
      {pestana === 'llaves' && <>

      <div style={card}>
        <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0 }}>Nueva credencial</p>
        <p style={{ fontSize: 12.5, color: C.sub, margin: '6px 0 14px', lineHeight: 1.5 }}>
          Para el sistema externo que lee los saldos de los clientes de todas las empresas. Firma cada consulta y rota su secreto cada hora; si un secreto viejo se usa después de rotar, la credencial se revoca sola y llega un aviso.
        </p>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <input style={input} placeholder="Nombre del sistema (ej. Sistema contable Jero)" value={etiqueta} onChange={e => setEtiqueta(e.target.value)} />
          <input style={input} placeholder="IPs permitidas, separadas por coma (opcional)" value={ips} onChange={e => setIps(e.target.value)} />
        </div>
        <button style={{ ...btn, marginTop: 12, background: '#F4F4F2', color: '#0A0A0A' }} disabled={creando || etiqueta.trim().length < 3} onClick={crear}>
          {creando ? 'Creando…' : 'Crear credencial'}
        </button>
      </div>

      {nueva && (
        <div style={{ ...card, borderColor: 'rgba(251,191,36,0.4)' }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: C.ambar, margin: 0 }}>Copia esto ahora: el secreto no se vuelve a mostrar</p>
          <pre style={{ fontFamily: MONO, fontSize: 12, color: C.text, background: C.elev, border: `1px solid ${C.border}`, borderRadius: 9, padding: 12, margin: '12px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{`LLAVE_ID=${nueva.llave_id}
GENERACION=${nueva.generacion}
SECRETO=${nueva.secreto}`}
          </pre>
          <p style={{ fontSize: 12, color: C.sub, margin: '0 0 12px' }}>Entrégalo por un canal seguro (no por correo ni chat abierto). Este secreto vence el {fecha(nueva.expira_at)} si el sistema no rota antes.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn} onClick={copiar}>{copiado ? 'Copiado' : 'Copiar'}</button>
            <button style={btn} onClick={() => setNueva(null)}>Ya lo guardé</button>
          </div>
        </div>
      )}

      <div style={card}>
        <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: '0 0 10px' }}>Credenciales</p>
        {creds === null ? <p style={{ color: C.sub, fontSize: 13 }}>Cargando…</p> : creds.length === 0 ? <p style={{ color: C.sub, fontSize: 13 }}>Todavía no hay credenciales.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['SISTEMA', 'LLAVE', 'ESTADO', 'GENERACIÓN', 'ÚLTIMA ROTACIÓN', 'ÚLTIMO USO', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {creds.map(c => (
                  <tr key={c.id}>
                    <td style={td}>{c.etiqueta}{c.ips_permitidas?.length ? <div style={{ color: C.sub, fontSize: 11 }}>IPs: {c.ips_permitidas.join(', ')}</div> : null}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{c.llave_id}</td>
                    <td style={{ ...td, color: c.estado === 'activa' ? C.verde : C.rojo }}>{c.estado === 'activa' ? 'Activa' : `Revocada${c.motivo_revocacion === 'reuso' ? ' (posible robo)' : ''}`}</td>
                    <td style={td}>{c.generacion ?? '—'}</td>
                    <td style={td}>{fecha(c.ultima_rotacion)}</td>
                    <td style={td}>{c.ultimo_uso ? <>{fecha(c.ultimo_uso.at)}<div style={{ color: C.sub, fontSize: 11 }}>{c.ultimo_uso.ip ?? '—'} · {c.ultimo_uso.pais ?? '—'}</div></> : '—'}</td>
                    <td style={td}>{c.estado === 'activa' && <button style={{ ...btn, color: C.rojo, borderColor: 'rgba(248,113,113,0.35)' }} onClick={() => revocar(c)}>Revocar</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0 }}>Registro de consultas</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <select style={{ ...input, width: 'auto' }} value={filtro} onChange={e => setFiltro(e.target.value)}>
              <option value="">Todos los resultados</option>
              {RESULTADOS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <button style={btn} onClick={cargar}>Actualizar</button>
          </div>
        </div>
        {consultas === null ? <p style={{ color: C.sub, fontSize: 13 }}>Cargando…</p> : consultas.length === 0 ? <p style={{ color: C.sub, fontSize: 13 }}>Sin consultas.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['FECHA', 'ACCIÓN', 'EMPRESA', 'RESULTADO', 'IP', 'PAÍS', 'PROGRAMA', 'DISPOSITIVO', 'GEN.'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {consultas.map(q => (
                  <tr key={q.id}>
                    <td style={td}>{fecha(q.at)}</td>
                    <td style={td}>{q.accion ?? '—'}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{q.id_consultado ?? '—'}</td>
                    <td style={{ ...td, color: q.resultado === 'ok' ? C.verde : q.resultado === 'reuso_detectado' ? C.rojo : C.ambar }}>{q.resultado}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{q.ip ?? '—'}</td>
                    <td style={td}>{q.pais ?? '—'}</td>
                    <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={q.user_agent ?? ''}>{q.user_agent ?? '—'}</td>
                    <td style={td}>{q.dispositivo ?? '—'}</td>
                    <td style={td}>{q.generacion ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>}
    </div>
  );
};
