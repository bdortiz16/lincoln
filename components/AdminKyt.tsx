import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Download, FileText, AlertTriangle, Check, X, KeyRound, Search } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';
import { descargarXlsx, type Hoja } from '../lib/xlsx';
import { hallazgosEnEspanol } from '../lib/kytTextos';
import { KytReporte } from './KytReporte';

// ─────────────────────────────────────────────
// Cumplimiento → KYT.
//
// Pedido del dueño (19 nov): para vender USDT en la mesa OTC el cliente tiene
// que decir desde qué wallet manda, y esa wallet se revisa ANTES de dejarle
// pedir el cierre (solo pasa riesgo bajo sin señalamientos). Acá vive:
//   1. La llave de MistTrack, que se pone desde el panel (queda cifrada en el
//      servidor y nunca vuelve al navegador).
//   2. Las reglas de la mesa: si se exige la wallet y cuánto sirve una revisión.
//   3. El registro para el oficial de cumplimiento: quién cargó cada wallet,
//      con qué resultado, en qué cierres, y el PDF de la consulta. Todo sale
//      del servidor (kyt otc_registro, sobre audit_log): nada se arma a ojo.
//
// La función kyt solo atiende a Cumplimiento (y al dueño) con la sesión en 2FA.
// ─────────────────────────────────────────────

const C = { fondo: '#0C0E0D', caja: '#121413', borde: 'rgba(255,255,255,0.09)', texto: '#F4F4F2', sub: '#878E88', tenue: 'rgba(244,244,242,0.45)', verde: '#4ADE80', rojo: '#F87171', ambar: '#FBBF24' };
const TARJ: React.CSSProperties = { background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 16, padding: '18px 20px' };
const BTN: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, height: 36, padding: '0 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: 'none', background: '#F4F4F2', color: '#15181A' };
const BTN2: React.CSSProperties = { ...BTN, background: 'rgba(255,255,255,0.05)', color: C.texto, border: '1px solid rgba(255,255,255,0.12)' };
const INP: React.CSSProperties = { height: 36, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: C.texto, padding: '0 11px', fontSize: 13, fontFamily: 'inherit', outline: 'none' };
const ROT: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: C.tenue, letterSpacing: '0.6px', textTransform: 'uppercase' };

const RIESGO: Record<string, { t: string; c: string }> = {
  bajo: { t: 'Bajo', c: C.verde }, medio: { t: 'Medio', c: C.ambar }, alto: { t: 'Alto', c: C.rojo }, sin_dato: { t: 'Sin dato', c: C.sub },
};
const RED: Record<string, string> = { TRX: 'TRON (TRC20)', ETH: 'Ethereum (ERC20)', BNB: 'BNB Chain (BEP20)' };
const fechaHora = (iso: unknown) => { const d = new Date(String(iso ?? '')); return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const fechaPlana = (iso: unknown) => { const t = Date.parse(String(iso ?? '')); return isNaN(t) ? '' : new Date(t - 5 * 3600_000).toISOString().slice(0, 16).replace('T', ' '); };
const corto = (s: unknown) => { const t = String(s ?? ''); return t.length > 22 ? `${t.slice(0, 10)}…${t.slice(-8)}` : t; };

const Chip: React.FC<{ c: string; children: React.ReactNode; title?: string }> = ({ c, children, title }) => (
  <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: c, background: `${c}14`, border: `1px solid ${c}40`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{children}</span>
);

// ── Conexión con MistTrack ───────────────────────────────────
const Conexion: React.FC<{ estado: any; onCambio: () => void }> = ({ estado, onCambio }) => {
  const [llave, setLlave] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const correr = async (cuerpo: Record<string, unknown>) => {
    setOcupado(true); setMsg(null);
    const r = await llamarFuncion('kyt', cuerpo, 30000).catch(() => null);
    setOcupado(false);
    return r;
  };
  const guardar = async () => {
    const r = await correr({ action: 'llave_set', llave: llave.trim() });
    if (r?.ok) { setLlave(''); setMsg({ ok: !!r.prueba, t: r.mensaje }); onCambio(); }
    else setMsg({ ok: false, t: r?.mensaje ?? r?.error ?? 'No se pudo guardar la llave.' });
  };
  const probar = async () => {
    const r = await correr({ action: 'llave_probar' });
    setMsg({ ok: !!r?.ok, t: r?.mensaje ?? r?.error ?? 'Sin respuesta.' });
  };
  const quitar = async () => {
    if (!window.confirm('¿Quitar la llave guardada en el panel? Si el servidor tiene la de respaldo, se usa esa; si no, la verificación de wallets deja de funcionar.')) return;
    const r = await correr({ action: 'llave_quitar' });
    if (r?.ok) { setMsg({ ok: true, t: r.credencial ? 'Quitada. Se usa la llave de respaldo del servidor.' : 'Quitada. No queda ninguna llave: la verificación no funciona hasta poner otra.' }); onCambio(); }
    else setMsg({ ok: false, t: r?.error ?? 'No se pudo quitar.' });
  };

  const chip = !estado ? null
    : estado.llaveIlegible ? <Chip c={C.rojo}>La llave guardada no se puede leer</Chip>
    : estado.desdePanel ? <Chip c={C.verde}><Check size={11} /> Llave del panel</Chip>
    : estado.credencial ? <Chip c={C.ambar}>Llave de respaldo del servidor</Chip>
    : <Chip c={C.rojo}>Sin llave</Chip>;

  return (
    <div style={TARJ}>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 10 }}>
        <div className="flex items-center" style={{ gap: 8 }}>
          <KeyRound size={15} style={{ color: C.verde }} />
          <p style={{ fontSize: 15, fontWeight: 800, color: C.texto }}>Conexión con MistTrack</p>
        </div>
        {chip}
      </div>
      <p style={{ fontSize: 12, color: C.sub, marginTop: 6, lineHeight: 1.55 }}>
        La llave queda cifrada en el servidor y no se vuelve a mostrar. Al guardarla se prueba en el acto.
      </p>
      <div className="flex flex-wrap" style={{ gap: 8, marginTop: 12 }}>
        <input type="password" autoComplete="off" value={llave} onChange={e => setLlave(e.target.value)}
          placeholder={estado?.desdePanel ? 'Pega una llave nueva para reemplazarla' : 'Pega la API key de MistTrack'}
          style={{ ...INP, flex: '1 1 260px', fontFamily: 'ui-monospace, monospace' }} />
        <button onClick={guardar} disabled={ocupado || llave.trim().length < 16} style={{ ...BTN, opacity: ocupado || llave.trim().length < 16 ? 0.5 : 1 }}>
          {ocupado ? 'Guardando…' : 'Guardar llave'}
        </button>
        <button onClick={probar} disabled={ocupado} style={{ ...BTN2, opacity: ocupado ? 0.5 : 1 }}>Probar conexión</button>
        {estado?.desdePanel && <button onClick={quitar} disabled={ocupado} style={{ ...BTN2, color: C.rojo, borderColor: `${C.rojo}44` }}>Quitar</button>}
      </div>
      {msg && (
        <p style={{ fontSize: 12, marginTop: 10, color: msg.ok ? C.verde : C.rojo, lineHeight: 1.5 }}>{msg.t}</p>
      )}
    </div>
  );
};

// ── Reglas de la mesa OTC ────────────────────────────────────
const ReglasOtc: React.FC<{ config: any; onGuardado: (c: any) => void }> = ({ config, onGuardado }) => {
  const [exige, setExige] = useState<boolean>(config?.otcExigeWallet !== false);
  const [horas, setHoras] = useState<string>(String(config?.otcHorasVigencia ?? 24));
  const [tope, setTope] = useState<string>(String(config?.topeDiarioPorCliente ?? 25));
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => {
    setExige(config?.otcExigeWallet !== false);
    setHoras(String(config?.otcHorasVigencia ?? 24));
    setTope(String(config?.topeDiarioPorCliente ?? 25));
  }, [config]);
  const guardar = async () => {
    if (!exige && !window.confirm('Sin la exigencia, un cliente puede pedir un cierre de venta de USDT sin decir desde qué wallet manda. ¿Apagarla?')) return;
    setOcupado(true); setMsg(null);
    const r = await llamarFuncion('kyt', { action: 'config_set', config: { otcExigeWallet: exige, otcHorasVigencia: Number(horas) || 24, topeDiarioPorCliente: Number(tope) || 0 } }, 20000).catch(() => null);
    setOcupado(false);
    if (r?.ok) { setMsg({ ok: true, t: 'Guardado.' }); onGuardado(r.config); }
    else setMsg({ ok: false, t: r?.mensaje ?? r?.error ?? 'No se pudo guardar.' });
  };
  return (
    <div style={TARJ}>
      <p style={{ fontSize: 15, fontWeight: 800, color: C.texto }}>Mesa OTC</p>
      <p style={{ fontSize: 12, color: C.sub, marginTop: 6, lineHeight: 1.55 }}>
        Para vender USDT, el cliente escribe la wallet desde donde envía y se revisa antes de habilitar «Solicitar cierre». Solo pasa riesgo <b style={{ color: C.verde }}>bajo</b> sin señalamientos propios; medio, alto o sin resultado no pasan. El servidor de la mesa vuelve a comprobarlo al crear el cierre.
      </p>
      <label className="flex items-center" style={{ gap: 9, marginTop: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={exige} onChange={e => setExige(e.target.checked)} />
        <span style={{ fontSize: 13, color: C.texto, fontWeight: 600 }}>Exigir wallet verificada para vender USDT</span>
      </label>
      <div className="flex flex-wrap" style={{ gap: 14, marginTop: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={ROT}>Horas que sirve una revisión</span>
          <input value={horas} onChange={e => setHoras(e.target.value.replace(/[^\d]/g, ''))} style={{ ...INP, width: 120 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={ROT}>Consultas pagadas por cliente al día</span>
          <input value={tope} onChange={e => setTope(e.target.value.replace(/[^\d]/g, ''))} style={{ ...INP, width: 120 }} />
        </label>
      </div>
      <p style={{ fontSize: 11, color: C.tenue, marginTop: 8, lineHeight: 1.5 }}>
        Una wallet revisada dentro de ese plazo no se vuelve a pagar. 0 consultas = sin tope.
      </p>
      <div className="flex items-center" style={{ gap: 10, marginTop: 12 }}>
        <button onClick={guardar} disabled={ocupado} style={{ ...BTN, opacity: ocupado ? 0.5 : 1 }}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
        {msg && <span style={{ fontSize: 12, color: msg.ok ? C.verde : C.rojo }}>{msg.t}</span>}
      </div>
    </div>
  );
};

// ── Quién analiza las wallets ────────────────────────────────
// 23 nov: Sarblock para EVM y TRON (1 crédito por análisis; MistTrack cobraba
// cada llamada). Desde acá se vuelve a MistTrack sin desplegar, por si
// Sarblock se cae o se queda sin créditos. Las redes que Sarblock no analiza
// (BTC, SOL, TON…) y el análisis profundo van a MistTrack siempre.
const ProveedorWallets: React.FC<{ estado: any; onGuardado: (c: any) => void }> = ({ estado, onGuardado }) => {
  const actual: 'sarblock' | 'misttrack' = estado?.config?.proveedorWallets === 'misttrack' ? 'misttrack' : 'sarblock';
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [prueba, setPrueba] = useState<any>(null);
  const [probando, setProbando] = useState(false);
  const probar = async () => {
    setProbando(true);
    const r = await llamarFuncion('kyt', { action: 'sarblock_probar' }, 30000).catch(() => null);
    setProbando(false);
    setPrueba(r ?? { ok: false, mensaje: 'Sin respuesta del servidor.' });
  };
  const fallo = prueba?.ultimoFallo ?? estado?.ultimoFalloSarblock ?? null;
  const cambiar = async (v: 'sarblock' | 'misttrack') => {
    if (v === actual) return;
    if (v === 'misttrack' && !window.confirm('Con MistTrack cada consulta cuesta varias llamadas pagadas. ¿Pasar EVM y TRON a MistTrack?')) return;
    setOcupado(true); setMsg(null);
    const r = await llamarFuncion('kyt', { action: 'config_set', config: { proveedorWallets: v } }, 20000).catch(() => null);
    setOcupado(false);
    if (r?.ok) { setMsg({ ok: true, t: 'Guardado.' }); onGuardado(r.config); }
    else setMsg({ ok: false, t: r?.mensaje ?? r?.error ?? 'No se pudo guardar.' });
  };
  const opcion = (v: 'sarblock' | 'misttrack', t: string, d: string) => (
    <button onClick={() => cambiar(v)} disabled={ocupado}
      style={{ ...BTN2, flex: '1 1 200px', flexDirection: 'column', alignItems: 'flex-start', gap: 3, textAlign: 'left',
        border: actual === v ? `1px solid ${C.verde}` : BTN2.border, opacity: ocupado ? 0.5 : 1 }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: actual === v ? C.verde : C.texto }}>{actual === v ? '● ' : ''}{t}</span>
      <span style={{ fontSize: 11, color: C.sub, fontWeight: 500, lineHeight: 1.45 }}>{d}</span>
    </button>
  );
  return (
    <div style={TARJ}>
      <p style={{ fontSize: 15, fontWeight: 800, color: C.texto }}>Proveedor de las consultas (EVM y TRON)</p>
      <p style={{ fontSize: 12, color: C.sub, marginTop: 6, lineHeight: 1.55 }}>
        La consulta normal, el monitoreo diario y la mesa OTC. BTC, SOL, TON y las demás redes que Sarblock
        no analiza van siempre a MistTrack, igual que «Rastrear intermediarios».
      </p>
      {!estado?.sarblockListo && (
        <p style={{ fontSize: 12, color: C.ambar, marginTop: 8, lineHeight: 1.5 }}>
          Falta SARBLOCK_ORG_API_KEY en los secrets de Supabase: mientras tanto todo va a MistTrack.
        </p>
      )}
      <div className="flex flex-wrap" style={{ gap: 8, marginTop: 12 }}>
        {opcion('sarblock', 'Sarblock', '1 crédito por análisis; repetir la dirección en 24 h no se cobra.')}
        {opcion('misttrack', 'MistTrack', 'Varias llamadas pagadas por consulta. Para volver atrás si Sarblock falla.')}
      </div>
      <p style={{ fontSize: 11, color: C.tenue, marginTop: 8, lineHeight: 1.5 }}>
        La llave de Sarblock necesita los permisos wallets:analyze y wallets:read (se dan en Sarblock).
      </p>
      {/* Por qué falló la última consulta: sin esto el cliente ve "no
          habilitado" y acá no había forma de saber si era la llave, los
          créditos o el límite por minuto. */}
      {fallo && (
        <p style={{ fontSize: 12, color: C.rojo, marginTop: 8, lineHeight: 1.5 }}>
          Última falla de Sarblock ({fechaHora(fallo.at)}): {fallo.mensaje ?? fallo.codigo ?? 'sin detalle'}
        </p>
      )}
      <div className="flex items-center flex-wrap" style={{ gap: 10, marginTop: 10 }}>
        <button onClick={probar} disabled={probando || !estado?.sarblockListo} style={{ ...BTN2, opacity: probando || !estado?.sarblockListo ? 0.5 : 1 }}>
          {probando ? 'Probando…' : 'Probar Sarblock'}
        </button>
        <span style={{ fontSize: 11, color: C.tenue }}>Revisa la llave y los créditos sin pagar un análisis.</span>
      </div>
      {prueba && (
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6 }}>
          {!prueba.ok ? <p style={{ color: C.rojo }}>{prueba.mensaje ?? 'No se pudo probar.'}</p> : (
            <>
              <p style={{ color: prueba.lectura?.ok ? C.verde : C.rojo }}>{prueba.lectura?.ok ? '✓ ' : '✗ '}{prueba.lectura?.mensaje}</p>
              <p style={{ color: prueba.analizar === true ? C.verde : prueba.analizar === false ? C.rojo : C.sub }}>
                {prueba.analizar === true ? '✓ La llave tiene wallets:analyze.'
                  : prueba.analizar === false ? '✗ La llave NO tiene permiso para analizar wallets (wallets: analyze). Dáselo en Sarblock, o crea una llave con los permisos de screening y de wallets y reemplaza SARBLOCK_ORG_API_KEY en Supabase.'
                  : 'Sarblock no informa los permisos de la llave: wallets:analyze solo se confirma con una consulta.'}
              </p>
              {Array.isArray(prueba.permisos) && <p style={{ color: C.sub, fontFamily: 'ui-monospace, monospace', fontSize: 11, wordBreak: 'break-word' }}>Permisos de la llave: {prueba.permisos.join(', ') || 'ninguno'}</p>}
              {(prueba.organizacion || prueba.llave || prueba.modo) && (
                <p style={{ color: C.sub, fontSize: 11 }}>
                  {prueba.organizacion ? `Organización ${prueba.organizacion}` : ''}{prueba.llave ? ` · llave ${prueba.llave}…` : ''}{prueba.modo ? ` · modo ${prueba.modo}` : ''}
                  {prueba.modo === 'test' ? ' (de pruebas: no analiza wallets reales)' : ''}
                </p>
              )}
              {prueba.creditos != null && <p style={{ color: C.sub }}>Créditos disponibles: {prueba.creditos}</p>}
            </>
          )}
        </div>
      )}
      {msg && <p style={{ fontSize: 12, color: msg.ok ? C.verde : C.rojo, marginTop: 8 }}>{msg.t}</p>}
    </div>
  );
};

// ── Registro para Cumplimiento ───────────────────────────────
const Registro: React.FC<{ onAbrirCliente?: (userId: string) => void }> = ({ onAbrirCliente }) => {
  const [dias, setDias] = useState(30);
  const [datos, setDatos] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<'todas' | 'permitidas' | 'bloqueadas' | 'compartidas' | 'con_cierre'>('todas');
  const [reporte, setReporte] = useState<any>(null);
  const [armando, setArmando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    const r = await llamarFuncion('kyt', { action: 'otc_registro', dias }, 30000).catch(() => null);
    setCargando(false);
    if (r?.ok) setDatos(r); else setError(r?.mensaje ?? r?.error ?? 'No se pudo leer el registro.');
  }, [dias]);
  useEffect(() => { cargar(); }, [cargar]);

  const filas: any[] = datos?.filas ?? [];
  const texto = q.trim().toLowerCase();
  const vista = useMemo(() => filas.filter(f => {
    if (filtro === 'permitidas' && !f.permitido) return false;
    if (filtro === 'bloqueadas' && f.permitido) return false;
    if (filtro === 'compartidas' && !(f.empresasDistintas > 1)) return false;
    if (filtro === 'con_cierre' && !(f.cierres?.length)) return false;
    if (!texto) return true;
    return [f.address, f.empresa, f.nombre, f.email, ...(f.cierres ?? []).map((c: any) => c.ref)].some(v => String(v ?? '').toLowerCase().includes(texto));
  }), [filas, filtro, texto]);

  // El PDF: el mismo reporte de la KYT, con el contexto de la mesa arriba.
  const abrirPdf = async (f: any) => {
    setArmando(f.id);
    const r = await llamarFuncion('kyt', { action: 'reporte', coin: f.coin, address: f.address }, 90000).catch(() => null);
    setArmando(null);
    if (!r?.ok) { alert(r?.mensaje ?? r?.error ?? 'No se pudo armar el reporte.'); return; }
    setReporte({ ...r, contextoOtc: f });
  };

  const excel = () => {
    const COL = ['Fecha (Bogotá)', 'Empresa', 'Persona', 'Correo', 'Id cliente', 'Red', 'Wallet', 'Riesgo', 'Puntaje', 'Nivel del proveedor', 'Resultado', 'Motivo', 'Hallazgos', 'Saldo USDT al revisar', 'Revisión del proveedor', 'Cierres OTC', 'Empresas que la cargaron'];
    const fila = (f: any) => [
      fechaPlana(f.fecha), f.empresa ?? '', f.nombre ?? '', f.email ?? '', f.userId ?? '', RED[f.coin] ?? f.coin ?? '', f.address ?? '',
      RIESGO[f.categoria]?.t ?? f.categoria ?? '', f.puntaje ?? '', f.nivel ?? '', f.permitido ? 'Permitida' : 'Bloqueada', f.motivo ?? '',
      hallazgosEnEspanol(f.hallazgos ?? [], 10).join(' · '), f.saldoUsdt ?? '', fechaPlana(f.consultadoAt),
      (f.cierres ?? []).map((c: any) => `${c.ref} (${c.status})`).join(' · '), f.empresasDistintas ?? 1,
    ];
    const hojas: Hoja[] = [{ nombre: 'Wallets OTC', filas: [COL, ...vista.map(fila)] }];
    descargarXlsx(`KYT_wallets_OTC_${new Date().toISOString().slice(0, 10)}.xlsx`, hojas);
  };

  const r = datos?.resumen;
  return (
    <div style={TARJ}>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 10 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 800, color: C.texto }}>Wallets cargadas en la mesa OTC</p>
          <p style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>Cada revisión, permitida o bloqueada, con quién la cargó y en qué cierres se usó.</p>
        </div>
        <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
          <select value={dias} onChange={e => setDias(Number(e.target.value))} style={{ ...INP, background: C.caja }}>
            {[7, 30, 90, 365].map(d => <option key={d} value={d}>Últimos {d} días</option>)}
          </select>
          <button onClick={cargar} style={BTN2}><RefreshCw size={13} className={cargando ? 'animate-spin' : ''} /> Actualizar</button>
          <button onClick={excel} disabled={!vista.length} style={{ ...BTN2, opacity: vista.length ? 1 : 0.5 }}><Download size={13} /> Excel</button>
        </div>
      </div>

      {r && (
        <div className="flex flex-wrap" style={{ gap: 8, marginTop: 14 }}>
          {([
            ['todas', `${r.verificaciones} revisiones`, C.texto],
            ['permitidas', `${r.permitidas} permitidas`, C.verde],
            ['bloqueadas', `${r.bloqueadas} bloqueadas`, C.rojo],
            ['con_cierre', `${r.conCierre} con cierre`, C.texto],
            ['compartidas', `${r.compartidas} compartidas entre empresas`, C.ambar],
          ] as const).map(([k, t, c]) => (
            <button key={k} onClick={() => setFiltro(k)}
              style={{ padding: '6px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, color: filtro === k ? '#0C0E0D' : c,
                background: filtro === k ? '#F4F4F2' : 'rgba(255,255,255,0.04)', border: filtro === k ? 'none' : '1px solid rgba(255,255,255,0.10)' }}>
              {t}
            </button>
          ))}
          <span style={{ fontSize: 11.5, color: C.sub, alignSelf: 'center' }}>{r.wallets} wallets distintas</span>
        </div>
      )}

      <div className="flex items-center" style={{ gap: 8, marginTop: 12 }}>
        <Search size={14} style={{ color: C.sub }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por wallet, empresa, correo o referencia del cierre" style={{ ...INP, flex: 1 }} />
      </div>

      {error && <p style={{ fontSize: 12.5, color: C.rojo, marginTop: 12 }}><AlertTriangle size={13} style={{ display: 'inline', marginRight: 5 }} />{error}</p>}
      {cargando && !datos && <p style={{ fontSize: 12.5, color: C.sub, marginTop: 14 }}>Cargando…</p>}
      {!cargando && datos && !vista.length && <p style={{ fontSize: 12.5, color: C.sub, marginTop: 14 }}>No hay revisiones en este período{filtro !== 'todas' || texto ? ' con ese filtro' : ''}.</p>}

      {vista.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                {['Fecha', 'Quién la cargó', 'Wallet', 'Riesgo', 'Resultado', 'Cierres', ''].map(h => (
                  <th key={h} style={{ ...ROT, padding: '8px 10px', borderBottom: `1px solid ${C.borde}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vista.map(f => {
                const rz = RIESGO[f.categoria] ?? RIESGO.sin_dato;
                return (
                  <tr key={f.id} style={{ borderBottom: `1px solid ${C.borde}`, verticalAlign: 'top' }}>
                    <td style={{ padding: '10px', color: C.sub, whiteSpace: 'nowrap' }}>{fechaHora(f.fecha)}</td>
                    <td style={{ padding: '10px' }}>
                      {onAbrirCliente && f.userId
                        ? <button onClick={() => onAbrirCliente(String(f.userId))} style={{ color: C.texto, fontWeight: 700, textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,0.25)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>{f.empresa || '—'}</button>
                        : <span style={{ color: C.texto, fontWeight: 700 }}>{f.empresa || '—'}</span>}
                      <p style={{ color: C.sub, marginTop: 2 }}>{[f.nombre, f.email].filter(Boolean).join(' · ') || '—'}</p>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <span title={f.address} style={{ fontFamily: 'ui-monospace, monospace', color: C.texto }}>{corto(f.address)}</span>
                      <button onClick={() => { try { navigator.clipboard.writeText(String(f.address ?? '')); } catch { /* */ } }} title="Copiar"
                        style={{ marginLeft: 6, color: C.sub, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11 }}>copiar</button>
                      <p style={{ color: C.sub, marginTop: 2 }}>{RED[f.coin] ?? f.coin}</p>
                      {f.empresasDistintas > 1 && <div style={{ marginTop: 4 }}><Chip c={C.ambar} title="La misma wallet la cargó más de una empresa">{f.empresasDistintas} empresas</Chip></div>}
                    </td>
                    <td style={{ padding: '10px' }}>
                      <Chip c={rz.c}>{rz.t}{f.puntaje != null ? ` · ${f.puntaje}` : ''}</Chip>
                      {(f.hallazgos ?? []).length > 0 && (
                        <p style={{ color: C.sub, marginTop: 4, maxWidth: 220, lineHeight: 1.4 }}>{hallazgosEnEspanol(f.hallazgos, 3).join(' · ')}</p>
                      )}
                    </td>
                    <td style={{ padding: '10px' }}>
                      {f.permitido ? <Chip c={C.verde}><Check size={11} /> Permitida</Chip> : <Chip c={C.rojo}><X size={11} /> Bloqueada</Chip>}
                      {!f.permitido && f.motivo && <p style={{ color: C.sub, marginTop: 4, maxWidth: 200, lineHeight: 1.4 }}>{f.motivo === 'sin_resultado' ? 'Sin resultado del proveedor' : f.motivo}</p>}
                    </td>
                    <td style={{ padding: '10px', color: C.texto }}>
                      {(f.cierres ?? []).length
                        ? (f.cierres as any[]).map(c => <p key={c.id} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>{c.ref} <span style={{ color: C.sub, fontFamily: 'inherit' }}>· {c.status}</span></p>)
                        : <span style={{ color: C.tenue }}>—</span>}
                    </td>
                    <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
                      <button onClick={() => abrirPdf(f)} disabled={armando === f.id} style={{ ...BTN2, height: 30, padding: '0 10px', fontSize: 11.5, opacity: armando === f.id ? 0.5 : 1 }}>
                        <FileText size={12} /> {armando === f.id ? 'Armando…' : 'PDF'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {reporte && <KytReporte d={reporte} onClose={() => setReporte(null)} />}
    </div>
  );
};

// ── El PDF ORIGINAL del proveedor ───────────────────────────────
// Desde el 22 nov cada consulta archiva el reporte de MistTrack (con su marca
// y su fecha) y su huella SHA-256, y anota el registro STR de MistTrack. Es lo
// que se le entrega a un banco, a la UIAF o a una autoridad junto con nuestro
// reporte: el nuestro dice lo mismo, este es la fuente. Solo Cumplimiento lo
// descarga: el cliente nunca ve el nombre del proveedor.
const PdfProveedor: React.FC = () => {
  const [coin, setCoin] = useState('TRX');
  const [dir, setDir] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [res, setRes] = useState<any>(null);
  const buscar = async (archivar = false) => {
    if (!dir.trim()) return;
    setOcupado(true);
    const r = await llamarFuncion('kyt', { action: 'pdf_proveedor', coin, address: dir.trim(), archivar }, 60000).catch(() => null);
    setOcupado(false);
    setRes(r ?? { ok: false, error: 'sin_respuesta' });
  };
  return (
    <div style={TARJ}>
      <p style={{ fontSize: 14, fontWeight: 800, color: C.texto }}>Respaldo original del proveedor</p>
      <p style={{ fontSize: 12, color: C.sub, marginTop: 4, lineHeight: 1.55 }}>
        Las copias archivadas para una dirección, con su huella SHA-256: el PDF de MistTrack (con el
        registro de la consulta en MistTrack) o la respuesta del análisis de Sarblock (con su id, que se
        verifica en su plataforma). Se archiva solo en cada consulta; «Archivar ahora» lo vuelve a
        descargar si el enlace de MistTrack sigue vigente, o relee el análisis de Sarblock (gratis).
      </p>
      <div className="flex flex-wrap items-center" style={{ gap: 8, marginTop: 12 }}>
        <select value={coin} onChange={e => setCoin(e.target.value)} style={{ ...INP, width: 110 }}>
          {['TRX', 'ETH', 'BNB', 'BTC', 'SOL', 'MATIC', 'ARB', 'BASE', 'OP', 'AVAX', 'TON'].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={dir} onChange={e => setDir(e.target.value)} placeholder="Dirección" spellCheck={false}
          style={{ ...INP, flex: '1 1 280px', fontFamily: 'ui-monospace, monospace' }} />
        <button onClick={() => buscar(false)} disabled={ocupado || !dir.trim()} style={{ ...BTN2, opacity: ocupado || !dir.trim() ? 0.5 : 1 }}><Search size={14} /> Buscar copias</button>
        <button onClick={() => buscar(true)} disabled={ocupado || !dir.trim()} style={{ ...BTN2, opacity: ocupado || !dir.trim() ? 0.5 : 1 }}><Download size={14} /> Archivar ahora</button>
      </div>
      {res && !res.ok && <p style={{ fontSize: 12, color: C.rojo, marginTop: 10 }}>No se pudo consultar ({res.error ?? 'error'}).</p>}
      {res?.ok && (
        <div style={{ marginTop: 12 }}>
          {res.copias?.length ? res.copias.map((k: any, i: number) => (
            <div key={i} className="flex items-center justify-between flex-wrap" style={{ gap: 10, padding: '10px 0', borderTop: i ? `1px solid ${C.borde}` : 'none' }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 12.5, fontWeight: 700, color: C.texto }}>
                  {k.proveedor === 'sarblock' ? 'Sarblock · respuesta JSON' : 'MistTrack · PDF'} · archivado el {fechaHora(k.archivadoAt)}{k.bytes ? ` · ${Math.max(1, Math.round(k.bytes / 1024))} KB` : ''}
                </p>
                {k.analisisId && <p style={{ fontSize: 11, color: C.sub, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all', marginTop: 2 }}>Análisis {k.analisisId}</p>}
                <p style={{ fontSize: 11, color: C.sub, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all', marginTop: 2 }}>SHA-256 {k.sha256 ?? '—'}</p>
                {k.str?.at && <p style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>Registro en MistTrack: {k.str.at} UTC · puntaje {k.str.puntaje ?? '—'} · {k.str.nivel ?? '—'}</p>}
              </div>
              {k.url
                ? <a href={k.url} target="_blank" rel="noopener noreferrer" style={{ ...BTN, textDecoration: 'none' }}><FileText size={14} /> {k.tipo === 'json' ? 'Descargar JSON' : 'Descargar PDF'}</a>
                : <span style={{ fontSize: 11.5, color: C.sub }}>Sin enlace</span>}
            </div>
          )) : (
            <p style={{ fontSize: 12, color: C.sub }}>
              {res.archivadoAhora ? 'Se archivó, pero no aparece todavía. Vuelve a buscar.' : 'No hay copias archivadas para esa dirección. Usa «Archivar ahora» o consulta la dirección de nuevo.'}
            </p>
          )}
          {/* Por qué no se pudo archivar: el de este intento, o el último
              registrado. Cada motivo se arregla en un lugar distinto. */}
          {(res.motivo || res.ultimoFallo) && (
            <p style={{ fontSize: 12, color: C.rojo, marginTop: 8, lineHeight: 1.55 }}>
              {res.motivo
                ? <>No se pudo archivar: {res.motivo}.</>
                : <>Último intento fallido ({fechaHora(res.ultimoFallo.at)}): {res.ultimoFallo.motivo}.</>}
            </p>
          )}
          {/* Lo que contestó el servidor de MistTrack, tal cual (sin token ni
              llave): con esto se le puede escribir a su soporte. */}
          {res.ultimoFallo?.detalle && (
            <p style={{ fontSize: 11, color: C.sub, marginTop: 4, lineHeight: 1.5, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word' }}>
              {res.ultimoFallo.detalle}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export const AdminKyt: React.FC<{ onAbrirCliente?: (userId: string) => void }> = ({ onAbrirCliente }) => {
  const [estado, setEstado] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    const r = await llamarFuncion('kyt', { action: 'config_get' }, 20000).catch(() => null);
    if (r?.ok) { setEstado(r); setError(null); }
    else setError(r?.error === 'no_autorizado' ? 'Esta sección es de Cumplimiento (y del dueño), con la sesión en 2FA.' : (r?.error ?? 'No se pudo leer la configuración de la KYT.'));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: "'Archivo', system-ui, sans-serif" }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: C.texto, letterSpacing: '-0.5px' }}>KYT · Wallets</h2>
        <p style={{ fontSize: 12.5, color: C.sub, marginTop: 4 }}>Revisión de riesgo de las wallets desde donde los clientes mandan USDT a la mesa OTC.</p>
      </div>
      {error && <p style={{ fontSize: 12.5, color: C.rojo }}>{error}</p>}
      <div className="grid md:grid-cols-2" style={{ gap: 14 }}>
        <Conexion estado={estado} onCambio={cargar} />
        <ReglasOtc config={estado?.config} onGuardado={(c) => setEstado((e: any) => ({ ...(e ?? {}), config: c }))} />
      </div>
      <ProveedorWallets estado={estado} onGuardado={(c) => setEstado((e: any) => ({ ...(e ?? {}), config: c }))} />
      <PdfProveedor />
      <Registro onAbrirCliente={onAbrirCliente} />
    </div>
  );
};

export default AdminKyt;
