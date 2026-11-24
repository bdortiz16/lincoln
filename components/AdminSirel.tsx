import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Download, FileText, Check, AlertTriangle, Send, X, FileSpreadsheet } from 'lucide-react';
import { pedirAdmin } from './adminApi';
import { descargarXlsx } from '../lib/xlsx';
import {
  filasClientes, filaOperacion, seleccionarOperaciones, contenidoArchivo, nombreArchivo, aCp1252,
  codigoEntidadValido, COLUMNAS_CLIENTES, COLUMNAS_TRANSACCIONES, UMBRAL_MULTIPLE_USD, UMBRAL_INDIVIDUAL_USD, type FilaUiaf,
} from '../lib/sirelUiaf';
import { AdminRosFicha } from './AdminRosFicha';

// ─────────────────────────────────────────────
// Cumplimiento → SIREL (UIAF).
//
// Pedido del dueño (2026-11): un panel que entregue lo que hay que reportar a
// la UIAF por SIREL de las operaciones con activos virtuales hechas a través
// de Lincoin — primero las empresas (clientes), después todas sus
// transacciones — para que el oficial lo descargue y lo suba él mismo.
//
// 24 nov: "en la UIAF es un solo archivo". SIREL recibe UN archivo plano por
// reporte (plantillas "PSAV Clientes" y "PSAV Transacciones Res 314"), así que
// cada reporte se descarga aparte, en el formato de los Anexos 2 y 3 de la
// Resolución 314 (lib/sirelUiaf.ts). El Excel de cada uno es solo para
// revisar fila por fila lo que va en el archivo y lo que falta.
//
// El servidor (admin-data sirel_periodo, reglas en sirel.ts) arma las filas
// del mes o del día. Nada se completa a ojo: lo que no está guardado sale
// vacío y la fila dice qué falta. Lo que se sube a SIREL se anota acá con el
// radicado, para saber qué período quedó reportado.
// ─────────────────────────────────────────────

const C = { fondo: '#0C0E0D', caja: '#121413', borde: 'rgba(255,255,255,0.09)', texto: '#F4F4F2', sub: '#878E88', tenue: 'rgba(244,244,242,0.45)', verde: '#4ADE80', rojo: '#F87171', ambar: '#FBBF24' };
const TARJ: React.CSSProperties = { background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 16 };
const BTN: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, height: 36, padding: '0 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: 'none', background: '#F4F4F2', color: '#15181A' };
const BTN2: React.CSSProperties = { ...BTN, background: 'rgba(255,255,255,0.05)', color: C.texto, border: `1px solid rgba(255,255,255,0.12)` };
const INP: React.CSSProperties = { height: 36, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', padding: '0 11px', fontSize: 13, fontFamily: 'inherit', outline: 'none' };

const usd = (n: unknown) => n == null ? '—' : `US$${Number(n).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cop = (n: unknown) => n == null ? '—' : `$${Math.round(Number(n)).toLocaleString('es-CO')}`;
const cant = (n: unknown) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 6 });
const fechaHora = (iso: unknown) => { const d = new Date(String(iso ?? '')); return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const fechaCorta = (iso: unknown) => { const d = new Date(String(iso ?? '')); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' }); };
const corto = (s: unknown, n = 10) => { const t = String(s ?? ''); return t.length > n * 2 + 1 ? `${t.slice(0, n)}…${t.slice(-6)}` : t; };
const docLegible = (tipo: unknown, doc: unknown, dv?: unknown) => doc ? `${tipo ?? ''} ${doc}${dv != null && String(tipo) === 'NIT' ? `-${dv}` : ''}`.trim() : '—';

const TIPO_OP: Record<string, string> = { deposito: 'Depósito', retiro: 'Retiro / envío', venta: 'Venta (recibe COP)', compra: 'Compra (paga COP)' };
const TIPO_ENVIO: Record<string, string> = {
  clientes: 'Reporte de clientes', transacciones: 'Reporte de transacciones', ausencia_transacciones: 'Ausencia de transacciones',
  ros: 'ROS (operación sospechosa)', ausencia_ros: 'Ausencia de ROS',
};
const hoyBogota = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
const mesAnterior = () => { const d = new Date(Date.now() - 5 * 3600_000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

// Los faltantes largos («saldo después (2 movimientos…)») parten línea en vez de salirse de la celda.
const Chip: React.FC<{ c: string; children: React.ReactNode; title?: string }> = ({ c, children, title }) => (
  <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: c, background: `${c}14`, border: `1px solid ${c}40`, borderRadius: 10, padding: '2px 8px', whiteSpace: 'normal', lineHeight: 1.35, maxWidth: 260 }}>{children}</span>
);

// ── Registrar un envío a SIREL ───────────────────────────────
const RegistrarEnvio: React.FC<{ tipo: string; periodo: string; filas?: number; onCerrar: () => void; onListo: () => void }> = ({ tipo, periodo, filas, onCerrar, onListo }) => {
  const [radicado, setRadicado] = useState('');
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardar = async () => {
    setOcupado(true); setError(null);
    const r = await pedirAdmin({ action: 'sirel_registrar_envio', tipo, periodo, radicado, filas, nota });
    setOcupado(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo guardar.'); return; }
    onListo();
  };
  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(4,5,4,0.65)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Registrar envío a SIREL" style={{ ...TARJ, width: 'min(440px, 100%)', padding: 22, background: C.caja }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.texto }}>{TIPO_ENVIO[tipo]}</p>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <p style={{ margin: '4px 0 16px', fontSize: 12.5, color: C.sub }}>Período {periodo}{filas != null ? ` · ${filas.toLocaleString('es-CO')} registros` : ''}. Anótalo cuando ya lo hayas subido en SIREL.</p>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.sub, letterSpacing: '0.6px' }}>NÚMERO DE RADICADO DE SIREL</label>
        <input autoFocus value={radicado} onChange={e => setRadicado(e.target.value)} placeholder="El que te dio SIREL al cargar" style={{ ...INP, width: '100%', boxSizing: 'border-box', marginTop: 6 }} />
        <label style={{ display: 'block', marginTop: 12, fontSize: 11, fontWeight: 700, color: C.sub, letterSpacing: '0.6px' }}>NOTA (OPCIONAL)</label>
        <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2} style={{ ...INP, height: 'auto', padding: '8px 11px', width: '100%', boxSizing: 'border-box', marginTop: 6, resize: 'vertical' }} />
        {error && <p style={{ margin: '10px 0 0', fontSize: 12.5, color: C.rojo }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onCerrar} style={BTN2}>Cancelar</button>
          <button onClick={guardar} disabled={ocupado || radicado.trim().length < 3} style={{ ...BTN, opacity: ocupado || radicado.trim().length < 3 ? 0.4 : 1 }}><Check size={14} /> {ocupado ? 'Guardando…' : 'Registrar envío'}</button>
        </div>
      </div>
    </div>
  );
};

// ── Completar a mano la red, las wallets y el hash ───────────
// 24 nov: los cargues de USDT no guardaban la wallet del cliente, el hash ni
// la wallet que recibió, y SIREL rechaza el archivo con esos campos vacíos.
// El oficial los copia del comprobante del proveedor o del explorador de la
// red. El servidor valida el formato contra la red (sirel_completar_ops).
const REDES = ['TRON (TRC-20)', 'Ethereum (ERC-20)', 'BNB Smart Chain (BEP-20)', 'Polygon', 'Base', 'Arbitrum', 'Solana', 'Bitcoin', 'TON'];
const CompletarOp: React.FC<{ op: any; hermanas: any[]; onCerrar: () => void; onListo: () => void }> = ({ op, hermanas, onCerrar, onListo }) => {
  const [red, setRed] = useState<string>(op.red && REDES.some(r => op.red.includes(r.split(' ')[0])) ? REDES.find(r => op.red.includes(r.split(' ')[0]))! : (op.red ?? ''));
  const [walletCliente, setWalletCliente] = useState<string>(op.walletCliente ?? '');
  const [hash, setHash] = useState<string>(op.hash ?? '');
  const [walletContraparte, setWalletContraparte] = useState<string>(op.walletContraparte ?? '');
  const [aplicarHermanas, setAplicarHermanas] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Las otras operaciones del mismo cliente en el período a las que les falta
  // alguna de las dos wallets: el cliente suele mandar siempre desde la misma.
  const otras = hermanas.filter(h => h.id !== op.id && (!h.walletCliente || !h.walletContraparte));
  const guardar = async () => {
    setOcupado(true); setError(null);
    const limpio = (v: string) => v.trim();
    const items: any[] = [{ id: op.id, red: limpio(red), walletCliente: limpio(walletCliente), hash: limpio(hash), walletContraparte: limpio(walletContraparte) }];
    if (aplicarHermanas) for (const h of otras) {
      const it: any = { id: h.id };
      if (!h.red && red.trim()) it.red = red.trim();
      if (!h.walletCliente && walletCliente.trim()) it.walletCliente = walletCliente.trim();
      if (!h.walletContraparte && walletContraparte.trim()) it.walletContraparte = walletContraparte.trim();
      if (Object.keys(it).length > 1) items.push(it);
    }
    const r = await pedirAdmin({ action: 'sirel_completar_ops', items });
    setOcupado(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo guardar.'); if (r?.hechas) onListo(); return; }
    onListo();
  };
  const campo = (etiqueta: string, valor: string, set: (v: string) => void, ph: string, ayuda?: string) => (
    <label style={{ display: 'block', marginTop: 12 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.sub, letterSpacing: '0.6px' }}>{etiqueta}</span>
      <input value={valor} onChange={e => set(e.target.value.replace(/\s/g, ''))} placeholder={ph} spellCheck={false} autoComplete="off"
        style={{ ...INP, width: '100%', boxSizing: 'border-box', marginTop: 6, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }} />
      {ayuda && <span style={{ display: 'block', fontSize: 11, color: C.tenue, marginTop: 4 }}>{ayuda}</span>}
    </label>
  );
  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(4,5,4,0.65)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Completar datos de la operación" style={{ ...TARJ, width: 'min(520px, 100%)', maxHeight: '92vh', overflowY: 'auto', padding: 22, background: C.caja }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.texto }}>Datos de la cadena</p>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: C.sub, lineHeight: 1.5 }}>
          {op.clienteNombre ?? 'Cliente'} · {TIPO_OP[op.tipo] ?? op.tipo} de {cant(op.cantidad)} {op.activo} · {fechaHora(op.fecha)}
          <span style={{ display: 'block', marginTop: 4 }}>Cópialos del comprobante del proveedor o del explorador de la red.</span>
        </p>
        <label style={{ display: 'block', marginTop: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.sub, letterSpacing: '0.6px' }}>RED</span>
          <select value={red} onChange={e => setRed(e.target.value)} style={{ ...INP, width: '100%', marginTop: 6, background: C.fondo, color: C.texto }}>
            <option value="">Sin dato</option>
            {REDES.map(r => <option key={r} value={r}>{r}</option>)}
            {red && !REDES.includes(red) && <option value={red}>{red}</option>}
          </select>
        </label>
        {campo('WALLET DEL CLIENTE', walletCliente, setWalletCliente, red.includes('TRON') ? 'T…' : red ? '0x…' : 'Dirección desde donde salió', op.tipo === 'deposito' ? 'La wallet del cliente en Lincoin, donde llegaron los USDT.' : 'Desde donde el cliente mandó los USDT.')}
        {campo('HASH DE LA TRANSACCIÓN', hash, setHash, red.includes('TRON') ? '64 caracteres' : red ? '0x + 64 caracteres' : 'Id de la transacción en la red')}
        {campo('WALLET QUE RECIBIÓ', walletContraparte, setWalletContraparte, 'Dirección de destino', op.tipo === 'deposito' ? 'La wallet de donde vinieron los USDT (la del otro lado).' : 'La dirección a la que llegaron los USDT.')}
        {otras.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 14, fontSize: 12.5, color: C.texto, cursor: 'pointer', lineHeight: 1.45 }}>
            <input type="checkbox" checked={aplicarHermanas} onChange={e => setAplicarHermanas(e.target.checked)} style={{ accentColor: '#4ADE80', marginTop: 3 }} />
            <span>Usar la red y las wallets también en las otras {otras.length} operaciones de este cliente en el período que no las tienen. <span style={{ color: C.sub }}>El hash no: es de cada operación.</span></span>
          </label>
        )}
        {error && <p style={{ margin: '12px 0 0', fontSize: 12.5, color: C.rojo }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onCerrar} style={BTN2}>Cancelar</button>
          <button onClick={guardar} disabled={ocupado} style={{ ...BTN, opacity: ocupado ? 0.4 : 1 }}><Check size={14} /> {ocupado ? 'Guardando…' : 'Guardar'}</button>
        </div>
        {op.manual?.at && <p style={{ margin: '12px 0 0', fontSize: 11, color: C.tenue }}>Escrito a mano por {op.manual.por ?? 'alguien del equipo'} · {fechaHora(op.manual.at)}. Cada cambio queda en la auditoría.</p>}
      </div>
    </div>
  );
};

// ── Código de la entidad ante la UIAF ────────────────────────
// SSTTTCCC: lo asigna la UIAF al pedir el código en SIREL. Va en el nombre,
// el encabezado y la cola de cada archivo.
const CodigoEntidad: React.FC<{ codigo: string | null; onGuardado: () => void }> = ({ codigo, onGuardado }) => {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(codigo ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setValor(codigo ?? ''); }, [codigo]);
  const limpio = valor.trim().toUpperCase();
  const guardar = async () => {
    setOcupado(true); setError(null);
    const r = await pedirAdmin({ action: 'sirel_config_set', codigoEntidad: limpio });
    setOcupado(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo guardar.'); return; }
    setEditando(false); onGuardado();
  };
  if (!editando) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12, fontSize: 12.5 }}>
      <span style={{ color: C.sub }}>Código de la entidad ante la UIAF:</span>
      {codigo
        ? <b style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.5px' }}>{codigo}</b>
        : <Chip c={C.ambar}>Sin configurar: los archivos no se pueden armar</Chip>}
      <button onClick={() => setEditando(true)} style={{ background: 'none', border: 'none', padding: 0, color: C.verde, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{codigo ? 'Cambiar' : 'Configurar'}</button>
    </div>
  );
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input autoFocus value={valor} maxLength={8} onChange={e => setValor(e.target.value.replace(/\s/g, ''))} placeholder="SSTTTCCC" aria-label="Código de la entidad" style={{ ...INP, width: 130, fontFamily: 'ui-monospace, monospace', letterSpacing: '1px', textTransform: 'uppercase' }} />
        <button onClick={guardar} disabled={ocupado || !codigoEntidadValido(limpio)} style={{ ...BTN, height: 34, opacity: ocupado || !codigoEntidadValido(limpio) ? 0.4 : 1 }}><Check size={14} /> {ocupado ? 'Guardando…' : 'Guardar'}</button>
        <button onClick={() => { setEditando(false); setValor(codigo ?? ''); setError(null); }} style={{ ...BTN2, height: 34 }}>Cancelar</button>
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 11.5, color: C.sub }}>Los 8 caracteres que asignó la UIAF: sector (2), tipo de entidad (3) y entidad (3). Están en el correo de asignación de código de SIREL.</p>
      {error && <p style={{ margin: '6px 0 0', fontSize: 12, color: C.rojo }}>{error}</p>}
    </div>
  );
};

export const AdminSirel: React.FC = () => {
  const [periodo, setPeriodo] = useState<'mes' | 'dia'>('mes');
  const [mes, setMes] = useState(mesAnterior());
  const [dia, setDia] = useState(hoyBogota());
  const [vista, setVista] = useState<'clientes' | 'transacciones' | 'envios'>('clientes');
  const [soloConOps, setSoloConOps] = useState(false);
  const [q, setQ] = useState('');
  const [datos, setDatos] = useState<any>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrar, setRegistrar] = useState<null | { tipo: string; filas?: number }>(null);
  const [completar, setCompletar] = useState<any>(null);
  const [ros, setRos] = useState<null | { userId: string; nombre: string | null }>(null);

  const fecha = periodo === 'mes' ? `${mes}-01` : dia;
  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    const r = await pedirAdmin({ action: 'sirel_periodo', periodo, fecha });
    setCargando(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo armar el período.'); return; }
    setDatos(r);
  }, [periodo, fecha]);
  useEffect(() => { cargar(); }, [cargar]);

  const clientes: any[] = datos?.clientes ?? [];
  const ops: any[] = datos?.operaciones ?? [];
  const envios: any[] = datos?.envios ?? [];
  const uiaf = datos?.uiaf ?? {};
  const codigo: string | null = codigoEntidadValido(uiaf.codigoEntidad) ? uiaf.codigoEntidad : null;
  const clave: string = datos?.clavePeriodo ?? (periodo === 'mes' ? mes : dia);
  const esMes = datos?.periodo === 'mes';
  const texto = q.trim().toLowerCase();
  const coincide = (...v: unknown[]) => !texto || v.some(x => String(x ?? '').toLowerCase().includes(texto));
  const clientesVista = useMemo(() => clientes.filter(c => (!soloConOps || c.operaciones > 0) && coincide(c.nombre, c.documento, c.correo)), [clientes, soloConOps, texto]);
  const opsVista = useMemo(() => ops.filter(o => coincide(o.clienteNombre, o.clienteDoc, o.walletContraparte, o.hash, o.referencia)), [ops, texto]);

  // ── Lo que va en cada archivo de la UIAF ──
  const cliPorId = useMemo(() => new Map(clientes.map(c => [String(c.userId), c])), [clientes]);
  const filasCli = useMemo(() => filasClientes(clientes), [clientes]);
  const sel = useMemo(() => seleccionarOperaciones(ops), [ops]);
  const filasOps = useMemo(() => sel.reportadas.map(r => filaOperacion(r.op, cliPorId.get(String(r.op.userId)) ?? null)), [sel, cliPorId]);
  const criterioDe = useMemo(() => new Map(sel.reportadas.map(r => [String(r.op.id), r.criterio])), [sel]);
  const faltaOp = useMemo(() => new Map(filasOps.map(f => [f.ref, f.faltan])), [filasOps]);
  const faltaCli = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of filasCli) m.set(f.ref, Array.from(new Set([...(m.get(f.ref) ?? []), ...f.faltan])));
    return m;
  }, [filasCli]);
  const cliIncompletos = useMemo(() => Array.from(faltaCli.values()).filter((v: string[]) => v.length > 0).length, [faltaCli]);
  const opsIncompletas = filasOps.filter(f => f.faltan.length).length;
  const nMultiples = sel.reportadas.filter(r => r.criterio === 'multiple').length;
  const enviado = (tipo: string) => envios.find(e => e.tipo === tipo && String(e.periodo).startsWith(clave));

  // ── Descargas ──────────────────────────────
  // El archivo para SIREL: texto ANSI (Windows-1252), tal cual lo pide el anexo.
  const bajar = (nombre: string, datosArchivo: BlobPart, tipo: string) => {
    const url = URL.createObjectURL(new Blob([datosArchivo], { type: tipo }));
    const a = document.createElement('a'); a.href = url; a.download = nombre; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  const noSePuede = !esMes ? 'El reporte a la UIAF es mensual: elige Mes.' : !codigo ? 'Configura primero el código de la entidad ante la UIAF.' : null;
  const archivoUiaf = (cual: 'clientes' | 'transacciones') => {
    if (noSePuede || !codigo) return;
    const filas = cual === 'clientes' ? filasCli : filasOps;
    bajar(nombreArchivo(cual === 'clientes' ? 'CPSV' : 'TPSV', codigo, clave), aCp1252(contenidoArchivo(codigo, clave, filas)), 'text/plain;charset=windows-1252');
  };
  // El Excel de revisión: las mismas columnas del archivo, más a quién
  // corresponde cada fila y qué le falta.
  const excelRevision = (cual: 'clientes' | 'transacciones') => {
    const filas: FilaUiaf[] = cual === 'clientes' ? filasCli : filasOps;
    const cols = cual === 'clientes' ? COLUMNAS_CLIENTES : [...COLUMNAS_TRANSACCIONES.slice(0, 1), 'Criterio', ...COLUMNAS_TRANSACCIONES.slice(1)];
    const cuerpo = filas.map((f, i) => cual === 'clientes'
      ? [String(i + 1), ...f.campos.slice(1), f.titulo, f.faltan.join(' · ')]
      : [String(i + 1), criterioDe.get(f.ref) === 'multiple' ? 'Múltiple' : 'Individual', ...f.campos.slice(1), f.titulo, f.faltan.join(' · ')]);
    descargarXlsx(`SIREL_${cual}_${clave}_revision.xlsx`, [{ nombre: cual === 'clientes' ? 'Clientes' : 'Transacciones', filas: [[...cols, 'Cliente (referencia)', 'Falta'], ...cuerpo] }]);
  };

  const estadoReporte = (tipo: string, titulo: string, detalle: string, filas?: number) => {
    const e = enviado(tipo);
    return (
      <div style={{ ...TARJ, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderColor: e ? 'rgba(74,222,128,0.3)' : C.borde }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: e ? 'rgba(74,222,128,0.12)' : 'rgba(251,191,36,0.1)', color: e ? C.verde : C.ambar, flexShrink: 0 }}>{e ? <Check size={15} /> : <AlertTriangle size={14} />}</span>
        <span style={{ flex: 1, minWidth: 180 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: C.texto }}>{titulo}</span>
          <span style={{ display: 'block', fontSize: 11.5, color: C.sub, marginTop: 1 }}>{e ? `Enviado ${fechaHora(e.at)} · radicado ${e.radicado}${e.por?.nombre || e.por?.email ? ` · ${e.por.nombre || e.por.email}` : ''}` : detalle}</span>
        </span>
        {!e && <button onClick={() => setRegistrar({ tipo, filas })} style={{ ...BTN2, height: 32 }}><Send size={13} /> Ya lo envié</button>}
      </div>
    );
  };

  const avisosServidor = [
    uiaf.tcrmError && `No se pudo leer la TCRM oficial (${uiaf.tcrmError}): el valor en pesos queda vacío. Vuelve a cargar en un momento.`,
    uiaf.saldoError && `No se pudo leer el saldo de los clientes (${uiaf.saldoError}).`,
    uiaf.walletsError && `No se pudieron leer las wallets verificadas (${uiaf.walletsError}): el reporte de clientes solo trae las usadas en el período.`,
  ].filter(Boolean) as string[];

  return (
    <div style={{ color: C.texto, fontFamily: "'Archivo', system-ui, sans-serif" }}>
      <div style={{ ...TARJ, padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ maxWidth: 640 }}>
            <p style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: '-0.3px' }}>SIREL · UIAF</p>
            <p style={{ margin: '5px 0 0', fontSize: 12.5, color: C.sub, lineHeight: 1.55 }}>
              Los reportes mensuales de la Resolución 314 de 2021 para PSAV. Cada uno se descarga como el archivo plano que pide SIREL (uno por reporte): súbelo en «Cargue de archivo plano» con su plantilla y anota aquí el radicado.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div role="tablist" style={{ display: 'inline-flex', padding: 3, borderRadius: 10, background: C.caja, border: `1px solid ${C.borde}` }}>
              {(['mes', 'dia'] as const).map(p => (
                <button key={p} onClick={() => setPeriodo(p)} style={{ height: 30, padding: '0 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, background: periodo === p ? '#F4F4F2' : 'transparent', color: periodo === p ? '#15181A' : C.sub }}>{p === 'mes' ? 'Mes' : 'Día'}</button>
              ))}
            </div>
            {periodo === 'mes'
              ? <input type="month" value={mes} max={hoyBogota().slice(0, 7)} onChange={e => e.target.value && setMes(e.target.value)} aria-label="Mes" style={INP} />
              : <input type="date" value={dia} max={hoyBogota()} onChange={e => e.target.value && setDia(e.target.value)} aria-label="Día" style={INP} />}
            <button onClick={cargar} disabled={cargando} style={BTN2}><RefreshCw size={14} className={cargando ? 'animate-spin' : ''} /> Actualizar</button>
          </div>
        </div>
        {datos && <CodigoEntidad codigo={codigo} onGuardado={cargar} />}
      </div>

      {error && <div style={{ ...TARJ, marginTop: 12, padding: '12px 16px', borderColor: 'rgba(248,113,113,0.35)', color: C.rojo, fontSize: 13 }}>{error}</div>}
      {!datos && !error && <p style={{ color: C.sub, fontSize: 13, padding: 16 }}>Armando el período…</p>}

      {datos && (
        <>
          {datos.truncado && <div style={{ ...TARJ, marginTop: 12, padding: '10px 16px', borderColor: 'rgba(251,191,36,0.35)', color: C.ambar, fontSize: 12.5 }}>El período tiene demasiados movimientos y se cortó la lectura: elige un período más corto (por día).</div>}

          {/* Qué falta enviar del período. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, marginTop: 12 }}>
            {estadoReporte('clientes', 'Reporte de clientes', `${filasCli.length.toLocaleString('es-CO')} registros (${clientes.length.toLocaleString('es-CO')} clientes, uno por wallet)`, filasCli.length)}
            {sel.reportadas.length > 0
              ? estadoReporte('transacciones', 'Reporte de transacciones', `${sel.reportadas.length.toLocaleString('es-CO')} operaciones llegan al umbral de la UIAF`, sel.reportadas.length)
              : estadoReporte('ausencia_transacciones', 'Ausencia de transacciones', ops.length ? `Hubo ${ops.length} operación(es) con activos virtuales, pero ninguna llega al umbral: va el reporte de ausencia` : 'No hubo operaciones con activos virtuales en el período: va el reporte de ausencia', 0)}
            <div style={{ ...TARJ, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.06)', color: C.sub, flexShrink: 0 }}><FileText size={14} /></span>
              <span style={{ flex: 1, minWidth: 180 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>ROS (operaciones sospechosas)</span>
                <span style={{ display: 'block', fontSize: 11.5, color: C.sub, marginTop: 1 }}>Se envían apenas se detectan, sin importar el monto. Los candidatos están en la Bandeja de casos. {envios.filter(e => e.tipo === 'ros').length ? `${envios.filter(e => e.tipo === 'ros').length} enviado(s) este mes.` : ''}</span>
              </span>
              <select value="" onChange={e => { const c = clientes.find(x => String(x.userId) === e.target.value); if (c) setRos({ userId: String(c.userId), nombre: c.nombre ?? null }); }} aria-label="Preparar ROS de un cliente" style={{ ...INP, height: 32, maxWidth: 210, background: C.fondo, color: C.texto }}>
                <option value="">Preparar ROS de…</option>
                {[...clientes].sort((a, b) => String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''))).map(c => <option key={c.userId} value={c.userId}>{c.nombre ?? c.documento ?? c.userId}</option>)}
              </select>
              <button onClick={() => setRegistrar({ tipo: 'ros' })} style={{ ...BTN2, height: 32 }}><Send size={13} /> Anotar ROS</button>
              <button onClick={() => setRegistrar({ tipo: 'ausencia_ros' })} style={{ ...BTN2, height: 32 }}>Anotar ausencia</button>
            </div>
          </div>

          {/* Cifras del período. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 12 }}>
            {[
              [datos.resumen.clientes.toLocaleString('es-CO'), 'Clientes', `${datos.resumen.clientesConOperaciones} operaron con activos virtuales`],
              [datos.resumen.operaciones.toLocaleString('es-CO'), 'Operaciones con AV', `${datos.resumen.porTipo.deposito} dep. · ${datos.resumen.porTipo.retiro} ret. · ${datos.resumen.porTipo.venta} ventas · ${datos.resumen.porTipo.compra} compras`],
              [usd(datos.resumen.totalUsd), 'Valor total', 'USDT y USDC a 1 dólar'],
              [String(sel.reportadas.length), 'Van al reporte de la UIAF', `${nMultiples} por múltiples (≥ USD ${UMBRAL_MULTIPLE_USD} en el mes) · ${sel.reportadas.length - nMultiples} individuales (≥ USD ${UMBRAL_INDIVIDUAL_USD})`],
            ].map(([v, t, s]) => (
              <div key={t} style={{ ...TARJ, padding: '14px 16px' }}>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.4px' }}>{v}</p>
                <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 700 }}>{t}</p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: C.sub }}>{s}</p>
              </div>
            ))}
          </div>

          {/* Lo que falta para que SIREL acepte los archivos, en una línea. */}
          {(cliIncompletos > 0 || opsIncompletas > 0 || sel.sinUsd.length > 0 || avisosServidor.length > 0) && (
            <div style={{ ...TARJ, marginTop: 12, padding: '11px 16px', borderColor: 'rgba(251,191,36,0.3)', fontSize: 12.5, color: '#FCD34D', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {(cliIncompletos > 0 || opsIncompletas > 0) && <>{cliIncompletos} cliente(s) y {opsIncompletas} operación(es) del reporte tienen datos que no están guardados (cada fila dice cuáles). Esos campos salen vacíos y SIREL rechaza el cargue: complétalos antes de subir. </>}
                {sel.sinUsd.length > 0 && <>{sel.sinUsd.length} operación(es) no tienen valor en dólares y no se pudieron medir contra el umbral: revísalas. </>}
                {avisosServidor.map(a => <span key={a} style={{ display: 'block', marginTop: 4 }}>{a}</span>)}
              </span>
            </div>
          )}

          {/* Tablas. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {([['clientes', `Clientes · ${clientes.length}`], ['transacciones', `Transacciones · ${ops.length}`], ['envios', `Envíos · ${(datos.enviosRecientes ?? []).length}`]] as const).map(([k, t]) => (
                <button key={k} onClick={() => setVista(k)} style={{ height: 32, padding: '0 13px', whiteSpace: 'nowrap', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: vista === k ? 700 : 600, color: vista === k ? C.texto : C.sub, background: vista === k ? 'rgba(255,255,255,0.08)' : 'transparent', border: `1px solid ${vista === k ? 'rgba(255,255,255,0.18)' : C.borde}` }}>{t}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {vista !== 'envios' && <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre, documento, wallet…" aria-label="Buscar" style={{ ...INP, width: 230 }} />}
              {vista === 'clientes' && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.sub, cursor: 'pointer' }}>
                  <input type="checkbox" checked={soloConOps} onChange={e => setSoloConOps(e.target.checked)} style={{ accentColor: '#4ADE80' }} /> Solo los que operaron
                </label>
              )}
              {vista !== 'envios' && (() => {
                const cual = vista;
                const vacio = cual === 'transacciones' && filasOps.length === 0;
                const motivo = noSePuede ?? (vacio ? 'Ninguna operación llega al umbral: en SIREL va el reporte de ausencia.' : null);
                return <>
                  <button onClick={() => archivoUiaf(cual)} disabled={!!motivo} title={motivo ?? undefined} style={{ ...BTN, opacity: motivo ? 0.4 : 1, cursor: motivo ? 'not-allowed' : 'pointer' }}>
                    <Download size={14} /> {cual === 'clientes' ? 'Archivo UIAF · Clientes' : 'Archivo UIAF · Transacciones'}
                  </button>
                  <button onClick={() => excelRevision(cual)} disabled={vacio} style={{ ...BTN2, opacity: vacio ? 0.4 : 1 }}><FileSpreadsheet size={14} /> Excel de revisión</button>
                </>;
              })()}
            </div>
          </div>
          {vista !== 'envios' && (
            <p style={{ margin: '8px 2px 0', fontSize: 11.5, color: C.sub }}>
              {noSePuede
                ? noSePuede
                : <>Se descarga <b style={{ color: C.texto, fontFamily: 'ui-monospace, monospace' }}>{nombreArchivo(vista === 'clientes' ? 'CPSV' : 'TPSV', codigo!, clave)}</b> · {vista === 'clientes' ? `${filasCli.length} registros, plantilla «PSAV Clientes»` : `${filasOps.length} registros, plantilla «PSAV Transacciones Res 314»`}. Trae todos los registros del período, sin el filtro de la tabla.</>}
            </p>
          )}

          <div style={{ ...TARJ, marginTop: 10, overflow: 'hidden' }}>
            {vista === 'clientes' && (clientesVista.length === 0
              ? <p style={{ padding: 20, margin: 0, color: C.sub, fontSize: 13 }}>{q || soloConOps ? 'Nada con ese filtro.' : 'No hay clientes vinculados.'}</p>
              : <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 860 }}>
                    <thead><tr style={{ color: C.tenue, fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase', textAlign: 'left' }}>
                      {['Cliente', 'Municipio', 'Wallets', 'Vinculado', 'En el período', 'Falta para la UIAF'].map(h => <th key={h} style={{ padding: '10px 14px', fontWeight: 700, borderBottom: `1px solid ${C.borde}` }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {clientesVista.slice(0, 500).map(c => {
                        const falta = faltaCli.get(String(c.userId)) ?? [];
                        const ws: any[] = c.wallets ?? [];
                        return (
                          <tr key={c.userId} style={{ borderTop: `1px solid ${C.borde}` }}>
                            <td style={{ padding: '10px 14px' }}>
                              <span style={{ display: 'block', fontWeight: 700 }}>{c.nombre ?? '—'}</span>
                              <span style={{ display: 'block', color: C.sub, fontSize: 11.5 }}>{docLegible(c.tipoDocumento, c.documento, c.dv)} · {c.tipoPersona === 'juridica' ? 'Jurídica' : 'Natural'}{c.estado !== 'activo' ? ` · ${c.estado === 'bloqueado' ? 'bloqueado' : 'sin verificar'}` : ''}</span>
                              <button onClick={() => setRos({ userId: String(c.userId), nombre: c.nombre ?? null })} style={{ background: 'none', border: 'none', padding: 0, marginTop: 3, color: C.sub, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>Preparar ROS</button>
                            </td>
                            <td style={{ padding: '10px 14px', color: c.municipioCodigo ? C.texto : C.sub }}>{c.municipio ?? '—'}{c.municipioCodigo ? <span style={{ color: C.sub }}> · {c.municipioCodigo}</span> : null}</td>
                            <td style={{ padding: '10px 14px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>
                              {ws.length ? ws.slice(0, 3).map(w => <span key={w.address} title={w.address} style={{ display: 'block' }}>{corto(w.address, 6)}</span>) : <span style={{ color: C.tenue, fontFamily: "'Archivo', system-ui, sans-serif" }}>Ninguna (va -1)</span>}
                              {ws.length > 3 && <span style={{ display: 'block', color: C.sub }}>+{ws.length - 3}</span>}
                            </td>
                            <td style={{ padding: '10px 14px', color: C.sub, whiteSpace: 'nowrap' }}>{fechaCorta(c.vinculadoAt)}</td>
                            <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>{c.operaciones ? <>{c.operaciones} op. · {usd(c.usdPeriodo)}</> : <span style={{ color: C.tenue }}>Sin operaciones</span>}</td>
                            <td style={{ padding: '10px 14px' }}><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{falta.length ? falta.map((f: string) => <Chip key={f} c={C.ambar}>{f}</Chip>) : <Chip c={C.verde}>Completo</Chip>}</div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {clientesVista.length > 500 && <p style={{ padding: '10px 14px', margin: 0, fontSize: 12, color: C.sub }}>Se muestran 500 de {clientesVista.length.toLocaleString('es-CO')}. La descarga los trae todos.</p>}
                </div>)}

            {vista === 'transacciones' && (opsVista.length === 0
              ? <p style={{ padding: 20, margin: 0, color: C.sub, fontSize: 13 }}>{q ? 'Nada con esa búsqueda.' : 'No hubo operaciones con activos virtuales en el período.'}</p>
              : <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 1020 }}>
                    <thead><tr style={{ color: C.tenue, fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase', textAlign: 'left' }}>
                      {['Fecha', 'Cliente', 'Operación', 'Cantidad', 'USD · COP a la TCRM', 'Saldo después', 'Contraparte', 'Hash', 'Reporte UIAF'].map(h => <th key={h} style={{ padding: '10px 14px', fontWeight: 700, borderBottom: `1px solid ${C.borde}` }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {opsVista.slice(0, 500).map(o => {
                        const crit = criterioDe.get(String(o.id));
                        const falta = faltaOp.get(String(o.id)) ?? [];
                        return (
                          <tr key={o.id} style={{ borderTop: `1px solid ${C.borde}` }}>
                            <td style={{ padding: '10px 14px', color: C.sub, whiteSpace: 'nowrap' }}>{fechaHora(o.fecha)}</td>
                            <td style={{ padding: '10px 14px' }}><span style={{ display: 'block', fontWeight: 700 }}>{o.clienteNombre ?? '—'}</span><span style={{ display: 'block', color: C.sub, fontSize: 11.5 }}>{o.clienteTipoDoc ?? ''} {o.clienteDoc ?? ''}</span></td>
                            <td style={{ padding: '10px 14px' }}><span style={{ display: 'block' }}>{TIPO_OP[o.tipo] ?? o.tipo}</span><span style={{ display: 'block', color: C.sub, fontSize: 11.5 }}>{o.origen}{o.referencia ? ` · ${o.referencia}` : ''}</span></td>
                            <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}><b>{cant(o.cantidad)} {o.activo}</b><span style={{ display: 'block', color: C.sub, fontSize: 11.5 }}>{o.red ?? 'Red sin dato'}</span></td>
                            <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                              {usd(o.valorUsd)}
                              <span style={{ display: 'block', color: C.sub, fontSize: 11.5 }}>{o.valorUsd != null && o.tcrm ? <>{cop(o.valorUsd * o.tcrm)} · TCRM {cop(o.tcrm)}</> : 'Sin TCRM del día'}</span>
                            </td>
                            <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }} title={o.saldoMotivo ?? ''}>{o.saldoAv != null ? <>{cant(o.saldoAv)} {o.activo}</> : <span style={{ color: C.tenue }}>Sin dato</span>}</td>
                            <td style={{ padding: '10px 14px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }} title={o.walletContraparte ?? ''}>{o.walletContraparte ? corto(o.walletContraparte) : <span style={{ color: C.tenue, fontFamily: 'inherit' }}>—</span>}</td>
                            <td style={{ padding: '10px 14px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }} title={o.hash ?? o.traza ?? ''}>{o.hash ? corto(o.hash) : o.traza ? <span style={{ color: C.sub }}>traza {corto(o.traza, 6)}</span> : <span style={{ color: C.tenue }}>—</span>}</td>
                            <td style={{ padding: '10px 14px' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {crit
                                  ? <>{crit === 'multiple' ? <Chip c={C.verde} title={`El cliente suma ≥ USD ${UMBRAL_MULTIPLE_USD} en el mes`}>Múltiple</Chip> : <Chip c={C.verde} title={`≥ USD ${UMBRAL_INDIVIDUAL_USD}`}>Individual</Chip>}
                                      {falta.length ? falta.map((f: string) => <Chip key={f} c={C.ambar}>{f}</Chip>) : <Chip c={C.verde}>Completo</Chip>}</>
                                  : <span style={{ color: C.tenue, fontSize: 11.5 }}>{o.valorUsd == null ? 'Sin valor en USD' : 'No va (bajo el umbral)'}</span>}
                                {o.manual && <Chip c={C.sub} title={`Escrito a mano${o.manual.por ? ` por ${o.manual.por}` : ''}: ${o.manual.campos.join(', ')}`}>a mano</Chip>}
                              </div>
                              <button onClick={() => setCompletar(o)} style={{ background: 'none', border: 'none', padding: 0, marginTop: 6, color: falta.some((f: string) => /wallet|hash|red/.test(f)) ? C.verde : C.sub, fontWeight: 700, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>
                                {falta.some((f: string) => /wallet|hash|red/.test(f)) ? 'Completar wallet y hash' : 'Editar datos de la cadena'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {opsVista.length > 500 && <p style={{ padding: '10px 14px', margin: 0, fontSize: 12, color: C.sub }}>Se muestran 500 de {opsVista.length.toLocaleString('es-CO')}. La descarga las trae todas.</p>}
                </div>)}

            {vista === 'envios' && ((datos.enviosRecientes ?? []).length === 0
              ? <p style={{ padding: 20, margin: 0, color: C.sub, fontSize: 13 }}>Todavía no se ha anotado ningún envío a SIREL.</p>
              : (datos.enviosRecientes as any[]).map((e, i) => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i ? `1px solid ${C.borde}` : 'none', flexWrap: 'wrap' }}>
                  <Check size={14} style={{ color: C.verde, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 220 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{TIPO_ENVIO[e.tipo] ?? e.tipo} · {e.periodo}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: C.sub }}>Radicado {e.radicado}{e.filas != null ? ` · ${Number(e.filas).toLocaleString('es-CO')} registros` : ''} · {fechaHora(e.at)}{e.por?.nombre || e.por?.email ? ` · ${e.por.nombre || e.por.email}` : ''}{e.nota ? ` · ${e.nota}` : ''}</span>
                  </span>
                </div>
              )))}
          </div>
          <div style={{ fontSize: 11.5, color: C.tenue, margin: '10px 2px 0', lineHeight: 1.6 }}>
            <p style={{ margin: 0 }}>Formato: Anexos 2 y 3 de la Resolución 314 de 2021 (UIAF, junio de 2022). Texto ANSI CP1252 separado por «|», con encabezado y cola de 39 posiciones; fechas en hora de Bogotá.</p>
            <p style={{ margin: '4px 0 0' }}>Cómo se codifica: depósito de USDT = 1 Recaudo (medio de pago 4, activo virtual); compra = 2; venta = 3; envío a otra wallet = 5 Transferencia. Persona jurídica: la razón social va en Nombres y -1 en Apellidos. Los datos de la contraparte (identificación, nombre, nacionalidad y su PSAV) van en -1: Lincoin no los tiene. El valor y el saldo en pesos se calculan a la TCRM certificada del día (datos.gov.co, Superintendencia Financiera), con USDT y USDC a un dólar. El saldo después es el del cliente en Lincoin en ese activo, y solo se pone si ningún movimiento suyo lo cambió desde entonces.</p>
          </div>
        </>
      )}

      {completar && <CompletarOp op={completar} hermanas={ops.filter(x => x.userId === completar.userId)} onCerrar={() => setCompletar(null)} onListo={() => { setCompletar(null); cargar(); }} />}
      {ros && <AdminRosFicha userId={ros.userId} nombre={ros.nombre} desde={datos?.desde} hasta={datos?.hasta} onCerrar={() => setRos(null)} onAnotar={() => { setRos(null); setRegistrar({ tipo: 'ros' }); }} />}
      {registrar && <RegistrarEnvio tipo={registrar.tipo} periodo={clave} filas={registrar.filas} onCerrar={() => setRegistrar(null)} onListo={() => { setRegistrar(null); cargar(); }} />}
    </div>
  );
};
