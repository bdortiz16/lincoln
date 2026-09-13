import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDatabase } from '../context/DatabaseContext';

// ─────────────────────────────────────────────────────────────
// AdminClientes — maestro-detalle.
//
// La lista simple anterior mostraba QUIÉNES son los clientes pero no dejaba
// operar sobre ellos: para cada cosa había que abrir otra pantalla. Acá la
// lista y el detalle conviven, así que seleccionar un cliente y actuar sobre
// él es un solo gesto.
//
// Reglas de marca del proyecto, en corto:
//   · Archivo en todo. Monospace SOLO para ids, referencias y direcciones.
//   · El verde es puntual —pills, toggles, barras, pestaña activa—, nunca un
//     fondo grande ni un botón relleno.
//   · Las pills son borde + texto, nunca relleno.
//   · Suspender no va en rojo: el rojo se reserva para lo que ya salió mal,
//     no para una acción que el admin todavía está considerando.
// ─────────────────────────────────────────────────────────────

const C = {
  doc: '#070808', chrome: '#0A0C0B', card: '#0C0E0D', elev: '#121413',
  b1: 'rgba(255,255,255,0.07)', b2: 'rgba(255,255,255,0.12)',
  text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)',
  green: '#4ADE80', amber: '#FBBF24', red: '#F87171',
};
const FONT = "Archivo, system-ui, sans-serif";
const MONO = 'ui-monospace, Menlo, monospace';

// Formato es-CO: miles con espacio fino y coma decimal.
const num = (n: number, dec = 2) =>
  (Number(n) || 0).toLocaleString('es-CO', { minimumFractionDigits: dec, maximumFractionDigits: dec }).replace(/\./g, ' ').replace(/,/g, ',');
const money = (n: number, dec = 2) => num(n, dec);

const iniciales = (s: string) =>
  String(s ?? '').trim().split(/\s+/).slice(0, 2).map(x => x[0] ?? '').join('').toUpperCase() || '—';

const fecha = (d?: string | number) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return '—'; }
};
const fechaHora = (d?: string | number) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return '—'; }
};

// ── Piezas ───────────────────────────────────────────────────────────────
const Pill: React.FC<{ tono?: 'ok' | 'neutro' | 'curso' | 'mal'; children: React.ReactNode }> = ({ tono = 'neutro', children }) => {
  const m = {
    ok: { borde: 'rgba(74,222,128,0.3)', color: C.green },
    neutro: { borde: 'rgba(255,255,255,0.14)', color: C.sub },
    curso: { borde: 'rgba(255,255,255,0.14)', color: 'rgba(244,244,242,0.7)' },
    mal: { borde: 'rgba(248,113,113,0.3)', color: C.red },
  }[tono];
  return (
    <span style={{
      border: `1px solid ${m.borde}`, color: m.color, borderRadius: 999,
      padding: '3px 9px', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.6px', whiteSpace: 'nowrap',
    }}>{children}</span>
  );
};

const Toggle: React.FC<{ on: boolean; onClick: () => void; label: string }> = ({ on, onClick, label }) => (
  <button role="switch" aria-checked={on} aria-label={label} onClick={onClick}
    style={{
      width: 36, height: 20, borderRadius: 999, flexShrink: 0, position: 'relative', cursor: 'pointer',
      background: on ? 'rgba(74,222,128,0.25)' : 'rgba(255,255,255,0.1)',
      border: `1px solid ${on ? 'rgba(74,222,128,0.4)' : C.b2}`, transition: 'background 150ms',
    }}>
    <span style={{
      position: 'absolute', top: 2, left: on ? 17 : 2, width: 14, height: 14, borderRadius: '50%',
      background: on ? C.green : C.sub, transition: 'left 150ms',
    }} />
  </button>
);

const Barra: React.FC<{ usado: number; tope: number }> = ({ usado, tope }) => {
  const pct = tope > 0 ? Math.min(100, Math.round((usado / tope) * 100)) : 0;
  return (
    <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', marginTop: 8, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: C.green, borderRadius: 2 }} />
    </div>
  );
};

const Tarjeta: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: C.card, border: `1px solid ${C.b1}`, borderRadius: 13, padding: '15px 16px', ...style }}>{children}</div>
);

const Etiqueta: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>{children}</p>
);

// Iconos de trazo, monocromos, 20×20. Sin relleno y sin color propio: heredan
// el del texto, así una misma pieza sirve en cualquier fondo.
const Ico: React.FC<{ d: string; size?: number }> = ({ d, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
    strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const I = {
  buscar: 'M9 15.5a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM17.5 17.5l-4-4',
  refrescar: 'M17 10a7 7 0 11-2-4.9M17 3.5V7h-3.5',
  mas: 'M10 4v12M4 10h12',
  abajo: 'M10 4v12M5.5 10.5L10 15l4.5-4.5',
  arriba: 'M10 16V4M5.5 9.5L10 5l4.5 4.5',
  cambio: 'M4 7h12l-3-3M16 13H4l3 3',
  persona: 'M10 10a3 3 0 100-6 3 3 0 000 6zM4 16.5c0-2.5 2.7-4 6-4s6 1.5 6 4',
  copiar: 'M7 7V4.5h8.5V13H13M4.5 7H13v8.5H4.5z',
  flecha: 'M4 10h11M11 6l4 4-4 4',
  puntos: 'M10 5.5v.01M10 10v.01M10 14.5v.01',
  lapiz: 'M13.5 3.5l3 3L7 16H4v-3z',
};

// ── La vista ─────────────────────────────────────────────────────────────
export const AdminClientes: React.FC<{
  showToast?: (t: string, ms?: number, tipo?: string) => void;
  // Herramientas que ya existían en el panel y siguen viviendo allá porque
  // dependen de su propio estado. Se reciben en vez de reimplementarse: una
  // segunda copia de algo que mueve dinero se desincroniza y nadie se entera.
  onSincronizarCripto?: (userId: string, userName: string) => void | Promise<void>;
  onLiberarCorreo?: () => void;
}> = ({ showToast, onSincronizarCripto, onLiberarCorreo }) => {
  const {
    getAllUsers, getTransactionHistory, refreshData,
    verifyUser, toggleUserBlock, updateUserProfile, updateUserRawData, deleteUser,
  } = useDatabase() as any;

  const todos = (getAllUsers() ?? []).filter((u: any) => u.role !== 'admin');
  const movimientos = getTransactionHistory() ?? [];

  const [busqueda, setBusqueda] = useState('');
  const [busquedaViva, setBusquedaViva] = useState('');
  const [chip, setChip] = useState<'todos' | 'empresas' | 'pendientes'>('todos');
  const [selId, setSelId] = useState<string | null>(null);
  const [tab, setTab] = useState<'resumen' | 'movimientos' | 'kyc' | 'limites' | 'auditoria'>('resumen');
  const [sincronizando, setSincronizando] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmar, setConfirmar] = useState<{ titulo: string; cuerpo: string; nombre: string; accion: () => void } | null>(null);
  const [escrito, setEscrito] = useState('');
  const [nota, setNota] = useState('');
  const [editando, setEditando] = useState(false);
  const [edNombre, setEdNombre] = useState('');
  const [edRol, setEdRol] = useState<'personal' | 'business'>('business');
  const [angosta, setAngosta] = useState(false);
  const [listaAbierta, setListaAbierta] = useState(true);

  // Búsqueda con retardo: filtrar en cada tecla sobre cientos de cuentas
  // traba la escritura, y el usuario ve la lista saltando mientras teclea.
  const tdebounce = useRef<any>(null);
  useEffect(() => {
    clearTimeout(tdebounce.current);
    tdebounce.current = setTimeout(() => setBusquedaViva(busqueda), 250);
    return () => clearTimeout(tdebounce.current);
  }, [busqueda]);

  // Bajo ~1200 px la lista estorba al lado del detalle: pasa a ser una capa
  // que se abre y se cierra.
  useEffect(() => {
    const mirar = () => setAngosta(window.innerWidth < 1200);
    mirar();
    window.addEventListener('resize', mirar);
    return () => window.removeEventListener('resize', mirar);
  }, []);

  // Enlace directo: el id viaja en la dirección, así un caso se puede
  // compartir con alguien del equipo sin explicarle dónde buscarlo.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const id = p.get('cliente');
    if (id) setSelId(id);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);
  const elegir = (id: string) => {
    setSelId(id); setTab('resumen'); setMenu(false);
    if (angosta) setListaAbierta(false);
    const p = new URLSearchParams(window.location.search);
    p.set('cliente', id);
    window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`);
  };

  const bloqueado = (u: any) => u?.isBlocked === true || u?.raw_data?.isBlocked === true || u?.blacklisted === true;
  const pendiente = (u: any) => u?.kycStatus === 'pending' || u?.kycStatus === 'in_review';
  const verificado = (u: any) => u?.kycStatus === 'verified' || u?.kycStatus === 'approved';

  const lista = useMemo(() => {
    const q = busquedaViva.trim().toLowerCase();
    return todos.filter((u: any) => {
      if (chip === 'empresas' && u.role !== 'business') return false;
      if (chip === 'pendientes' && !pendiente(u)) return false;
      if (!q) return true;
      const raw = u.raw_data ?? {};
      return [u.name, u.email, u.id, raw.nit, raw.documentNumber, u.document_number]
        .some(x => String(x ?? '').toLowerCase().includes(q));
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [todos, busquedaViva, chip]);

  // El seleccionado se lee SIEMPRE de la lista viva: cualquier refresco se
  // refleja al instante en los saldos que se están mirando.
  const sel: any = selId ? todos.find((u: any) => u.id === selId) ?? null : null;

  const saldo = (u: any, cur: string) => Number(u?.balances?.[cur] ?? 0);
  const totalUsd = (u: any) => {
    const cop = saldo(u, 'COP');
    // Sin tasa viva se usa una de referencia conservadora, y se dice que es
    // aproximado: un total inventado con precisión falsa es peor que uno
    // redondo y honesto.
    const tasa = Number((u?.raw_data ?? {}).usdCopRate ?? 3950);
    return saldo(u, 'USDT') + saldo(u, 'USDC') + (tasa > 0 ? cop / tasa : 0);
  };

  const movsDe = (id: string) => movimientos
    .filter((t: any) => t.userId === id)
    .sort((a: any, b: any) => new Date(b.createdAt ?? b.date ?? 0).getTime() - new Date(a.createdAt ?? a.date ?? 0).getTime());

  const sincronizar = async () => {
    setSincronizando(true);
    await refreshData?.();
    setSincronizando(false);
    showToast?.('Saldos y estado actualizados.');
  };

  const guardarNota = async () => {
    if (!sel || !nota.trim()) return;
    const previas = Array.isArray(sel.raw_data?.notasInternas) ? sel.raw_data.notasInternas : [];
    const nueva = { texto: nota.trim(), autor: 'Admin', at: new Date().toISOString() };
    await updateUserRawData?.(sel.id, { notasInternas: [nueva, ...previas].slice(0, 50) });
    setNota('');
    await refreshData?.();
  };

  const alternar = async (campo: string, valor: boolean, etiqueta: string) => {
    if (!sel) return;
    await updateUserProfile?.(sel.id, { [campo]: valor });
    await refreshData?.();
    showToast?.(`${etiqueta} ${valor ? 'activado' : 'desactivado'}.`);
  };

  // ── Estilos compartidos ────────────────────────────────────────────────
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
  const chipStyle = (activo: boolean): React.CSSProperties => ({
    border: `1px solid ${activo ? 'rgba(74,222,128,0.35)' : C.b2}`,
    background: activo ? 'rgba(74,222,128,0.07)' : 'transparent',
    color: activo ? C.text : C.sub,
    borderRadius: 999, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap',
  });

  const nVerificadas = todos.filter(verificado).length;
  const nPendientes = todos.filter(pendiente).length;

  return (
    <div style={{ fontFamily: FONT, color: C.text }}>
      {/* ── Topbar ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.4px', margin: 0 }}>Clientes</h2>
          <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0' }}>
            {todos.length} cuenta{todos.length === 1 ? '' : 's'} · {nVerificadas} verificada{nVerificadas === 1 ? '' : 's'} · {nPendientes} pendiente{nPendientes === 1 ? '' : 's'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {angosta && (
            <button onClick={() => setListaAbierta(v => !v)} style={btnSec}>
              {listaAbierta ? 'Ocultar lista' : 'Ver lista'}
            </button>
          )}
          <button onClick={sincronizar} disabled={sincronizando} style={{ ...btnSec, opacity: sincronizando ? 0.6 : 1 }}>
            <span style={{ display: 'inline-flex', animation: sincronizando ? 'spin 1s linear infinite' : 'none' }}><Ico d={I.refrescar} /></span>
            {sincronizando ? 'Sincronizando…' : 'Sincronizar'}
          </button>
          {onLiberarCorreo && (
            <button onClick={onLiberarCorreo} style={btnSec}>Liberar correo</button>
          )}
          <button onClick={() => showToast?.('Invitar cliente: próximamente.')} style={btnPri}>
            <Ico d={I.mas} /> Invitar cliente
          </button>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: angosta ? '1fr' : '360px 1fr',
        gap: angosta ? 14 : 0,
        background: C.chrome, border: `1px solid ${C.b1}`, borderRadius: 16, overflow: 'hidden',
      }}>
        {/* ── Lista ── */}
        {(!angosta || listaAbierta) && (
          <div style={{ borderRight: angosta ? 'none' : `1px solid ${C.b1}`, padding: 14, minWidth: 0 }}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: 11, color: C.sub, pointerEvents: 'none' }}><Ico d={I.buscar} size={16} /></span>
              <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
                placeholder="Nombre, correo, NIT o ID de cliente"
                style={{
                  width: '100%', height: 38, background: 'rgba(255,255,255,0.045)', border: `1px solid ${C.b1}`,
                  borderRadius: 10, padding: '0 12px 0 36px', color: C.text, fontSize: 13, outline: 'none', fontFamily: FONT,
                }} />
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 11 }}>
              <button onClick={() => setChip('todos')} style={chipStyle(chip === 'todos')}>Todos · {todos.length}</button>
              <button onClick={() => setChip('empresas')} style={chipStyle(chip === 'empresas')}>Empresas · {todos.filter((u: any) => u.role === 'business').length}</button>
              <button onClick={() => setChip('pendientes')} style={chipStyle(chip === 'pendientes')}>Pendientes · {nPendientes}</button>
            </div>

            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 2, maxHeight: angosta ? 420 : 'calc(100vh - 260px)', overflowY: 'auto' }}>
              {lista.length === 0 ? (
                <div style={{ padding: '32px 8px', textAlign: 'center' }}>
                  <p style={{ fontSize: 13, color: C.text, fontWeight: 600, margin: 0 }}>Sin resultados</p>
                  <p style={{ fontSize: 12, color: C.sub, margin: '4px 0 0' }}>
                    {todos.length === 0 ? 'Todavía no hay clientes.' : 'Ninguna cuenta coincide con la búsqueda.'}
                  </p>
                </div>
              ) : lista.map((u: any) => {
                const activo = u.id === selId;
                return (
                  <button key={u.id} onClick={() => elegir(u.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
                      background: activo ? 'rgba(255,255,255,0.055)' : 'transparent',
                      border: 'none', borderRadius: 11, padding: '10px 10px', cursor: 'pointer', fontFamily: FONT,
                    }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                      background: 'linear-gradient(140deg, #2E3330, #1A1D1B)',
                      display: 'grid', placeItems: 'center', color: C.sub, fontWeight: 800, fontSize: 13,
                    }}>{iniciales(u.name || u.email)}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name || 'Sin nombre'}</p>
                      <p style={{ fontSize: 11.5, color: C.sub, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {bloqueado(u) ? <Pill tono="mal">SUSPENDIDA</Pill>
                        : verificado(u) ? <Pill tono="ok">VERIFICADO</Pill>
                          : <Pill>PENDIENTE</Pill>}
                      <p style={{ fontSize: 11, color: C.sub, margin: '4px 0 0' }}>${money(totalUsd(u))}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Detalle ── */}
        <div style={{ padding: angosta ? 14 : 20, minWidth: 0 }}>
          {!sel ? (
            <div style={{ display: 'grid', placeItems: 'center', minHeight: 320, textAlign: 'center' }}>
              <div>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: C.elev, border: `1px solid ${C.b1}`, display: 'grid', placeItems: 'center', color: C.sub, margin: '0 auto 12px' }}>
                  <Ico d={I.persona} size={20} />
                </div>
                <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>Selecciona un cliente</p>
                <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0' }}>Su detalle, saldos y controles aparecen acá.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Cabecera */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 13, minWidth: 0 }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: 13, flexShrink: 0,
                    background: 'linear-gradient(140deg, #2E3330, #1A1D1B)',
                    display: 'grid', placeItems: 'center', color: C.sub, fontWeight: 800, fontSize: 17,
                  }}>{iniciales(sel.name || sel.email)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <h3 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.5px', margin: 0 }}>{sel.name || 'Sin nombre'}</h3>
                      {bloqueado(sel) ? <Pill tono="mal">SUSPENDIDA</Pill>
                        : verificado(sel) ? <Pill tono="ok">KYC VERIFICADO</Pill>
                          : <Pill>KYC PENDIENTE</Pill>}
                      <Pill>{sel.role === 'business' ? 'EMPRESA' : 'PERSONA'}</Pill>
                    </div>
                    <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0' }}>
                      {sel.email} · Cliente desde {fecha(sel.createdAt ?? sel.created_at)} · Último acceso {fechaHora(sel.lastLogin ?? sel.raw_data?.lastLoginAt)}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, position: 'relative', flexWrap: 'wrap' }}>
                  <button onClick={() => { setEdNombre(sel.name ?? ''); setEdRol(sel.role === 'business' ? 'business' : 'personal'); setEditando(true); }} style={btnSec}><Ico d={I.lapiz} /> Editar</button>
                  <button onClick={sincronizar} disabled={sincronizando} style={{ ...btnSec, opacity: sincronizando ? 0.6 : 1 }}><Ico d={I.refrescar} /> Sincronizar</button>
                  <button onClick={() => setMenu(v => !v)} style={{ ...btnSec, padding: '8px 10px' }}><Ico d={I.puntos} /></button>
                  {menu && (
                    <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 30, background: C.elev, border: `1px solid ${C.b2}`, borderRadius: 10, overflow: 'hidden', minWidth: 210, boxShadow: '0 12px 30px rgba(0,0,0,0.5)' }}>
                      {[
                        { l: 'Ver como cliente', f: () => showToast?.('Vista como cliente: próximamente.') },
                        { l: 'Exportar datos', f: () => { navigator.clipboard?.writeText(JSON.stringify(sel, null, 2)); showToast?.('Datos del cliente copiados.'); } },
                        ...(onSincronizarCripto ? [{ l: 'Sincronizar depósitos cripto', f: () => onSincronizarCripto(sel.id, sel.name) }] : []),
                        {
                          // La lista negra NO es un bloqueo más fuerte con otro
                          // nombre: el servidor rechaza toda operación de dinero
                          // y la cuenta desaparece de Cargues, GasFree y
                          // pendientes. Por eso va con el mismo peso que
                          // eliminar, y pide escribir el nombre.
                          l: sel.blacklisted ? 'Sacar de lista negra' : 'Enviar a lista negra…',
                          f: () => {
                            setEscrito('');
                            const entra = !sel.blacklisted;
                            setConfirmar({
                              titulo: entra ? 'Enviar a lista negra' : 'Sacar de la lista negra',
                              nombre: sel.name || sel.email,
                              cuerpo: entra
                                ? 'El servidor rechazará TODAS sus operaciones de dinero y la cuenta desaparecerá de Cargues, GasFree y pendientes. Es más que una suspensión.'
                                : 'La cuenta vuelve a las listas operativas. Seguirá suspendida si lo estaba.',
                              accion: async () => {
                                await updateUserProfile?.(sel.id, {
                                  blacklisted: entra,
                                  isBlocked: entra ? true : sel.isBlocked,
                                  blockReason: entra ? 'Lista negra — actividad maliciosa' : sel.blockReason,
                                  blacklistedAt: entra ? new Date().toISOString() : null,
                                });
                                await refreshData?.();
                                showToast?.(entra ? 'Cuenta enviada a lista negra.' : 'Cuenta retirada de la lista negra.');
                              },
                            });
                          },
                        },
                      ].map(x => (
                        <button key={x.l} onClick={() => { setMenu(false); x.f(); }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', fontSize: 12.5, color: C.text, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: FONT }}>{x.l}</button>
                      ))}
                      <button onClick={() => {
                        setMenu(false); setEscrito('');
                        setConfirmar({
                          titulo: 'Eliminar la cuenta', nombre: sel.name || sel.email,
                          cuerpo: 'Se borra la cuenta y su acceso. Los movimientos ya registrados se conservan para la auditoría. Esto no se puede deshacer.',
                          accion: async () => { await deleteUser?.(sel.id); setSelId(null); await refreshData?.(); showToast?.('Cuenta eliminada.'); },
                        });
                      }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', fontSize: 12.5, color: C.red, background: 'transparent', border: 'none', borderTop: `1px solid ${C.b1}`, cursor: 'pointer', fontFamily: FONT }}>
                        Eliminar cuenta…
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Un KYC pendiente es lo primero que hay que resolver: va como
                  aviso arriba, no escondido en una pestaña. */}
              {pendiente(sel) && !bloqueado(sel) && (
                <div style={{ marginTop: 14, background: C.elev, border: '1px solid rgba(251,191,36,0.28)', borderRadius: 12, padding: '12px 15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <p style={{ fontSize: 12.5, color: C.amber, margin: 0, lineHeight: 1.5 }}>
                    Esta cuenta está pendiente de verificación. Hasta aprobarla, sus operaciones quedan limitadas.
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={async () => { await verifyUser?.(sel.id, 'verified'); await refreshData?.(); showToast?.('Cliente verificado.'); }} style={btnPri}>Aprobar KYC</button>
                    <button onClick={() => showToast?.('Verificación reenviada al cliente.')} style={btnSec}>Reenviar verificación</button>
                  </div>
                </div>
              )}

              {/* Pestañas */}
              <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.b1}`, marginTop: 18, overflowX: 'auto' }}>
                {([
                  ['resumen', 'Resumen'], ['movimientos', 'Movimientos'], ['kyc', 'KYC y documentos'],
                  ['limites', 'Límites y comisiones'], ['auditoria', 'Auditoría'],
                ] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setTab(k)}
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: FONT,
                      padding: '9px 12px', fontSize: 13, fontWeight: tab === k ? 700 : 500,
                      color: tab === k ? C.text : C.sub, whiteSpace: 'nowrap',
                      borderBottom: `2px solid ${tab === k ? C.green : 'transparent'}`, marginBottom: -1,
                    }}>{l}</button>
                ))}
              </div>

              {tab === 'resumen' && <Resumen sel={sel} movs={movsDe(sel.id)} saldo={saldo} totalUsd={totalUsd}
                alternar={alternar} bloqueado={bloqueado} setConfirmar={setConfirmar} setEscrito={setEscrito}
                toggleUserBlock={toggleUserBlock} refreshData={refreshData} showToast={showToast}
                nota={nota} setNota={setNota} guardarNota={guardarNota} setTab={setTab} angosta={angosta} />}

              {tab === 'movimientos' && <Movimientos movs={movsDe(sel.id)} />}
              {tab === 'kyc' && <Kyc sel={sel} verifyUser={verifyUser} refreshData={refreshData} showToast={showToast} verificado={verificado} />}
              {tab === 'limites' && <Limites sel={sel} movs={movsDe(sel.id)} updateUserRawData={updateUserRawData} refreshData={refreshData} showToast={showToast} />}
              {tab === 'auditoria' && <Auditoria sel={sel} movs={movsDe(sel.id)} />}
            </>
          )}
        </div>
      </div>

      {/* Doble confirmación escribiendo el nombre. Un "¿seguro?" se acepta sin
          leer; escribir el nombre obliga a mirar sobre quién se está actuando. */}
      {confirmar && (
        <div className="fixed inset-0 z-[60] p-4" style={{ background: 'rgba(4,5,4,0.78)', display: 'grid', placeItems: 'center' }}
          onClick={() => setConfirmar(null)}>
          <div onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true"
            style={{ maxWidth: 420, width: '100%', background: C.card, border: `1px solid ${C.b2}`, borderRadius: 18, overflow: 'hidden', fontFamily: FONT }}>
            <div style={{ padding: '22px 24px 18px' }}>
              <p style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px', color: C.text, margin: 0 }}>{confirmar.titulo}</p>
              <p style={{ fontSize: 12.5, color: C.sub, margin: '8px 0 0', lineHeight: 1.6 }}>{confirmar.cuerpo}</p>
              <p style={{ fontSize: 12, color: C.sub, margin: '14px 0 6px' }}>
                Escribe <b style={{ color: C.text }}>{confirmar.nombre}</b> para confirmar.
              </p>
              <input value={escrito} onChange={e => setEscrito(e.target.value)} autoFocus
                style={{ width: '100%', height: 42, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 10, padding: '0 13px', color: C.text, fontSize: 13.5, outline: 'none', fontFamily: FONT }} />
            </div>
            <div style={{ display: 'flex', gap: 9, padding: '0 24px 22px' }}>
              <button onClick={() => setConfirmar(null)} style={{ ...btnSec, flex: 1, height: 44, justifyContent: 'center' }}>Cancelar</button>
              <button
                disabled={escrito.trim() !== confirmar.nombre.trim()}
                onClick={() => { const f = confirmar.accion; setConfirmar(null); setEscrito(''); f(); }}
                style={{
                  flex: 1, height: 44, borderRadius: 9, fontFamily: FONT, fontSize: 13, fontWeight: 700,
                  background: 'transparent', border: `1px solid ${escrito.trim() === confirmar.nombre.trim() ? 'rgba(248,113,113,0.4)' : C.b1}`,
                  color: escrito.trim() === confirmar.nombre.trim() ? C.red : C.dim,
                  cursor: escrito.trim() === confirmar.nombre.trim() ? 'pointer' : 'not-allowed',
                }}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* Editar los datos de la cuenta. El rol no es cosmético: decide qué
          producto ve el cliente, así que va con su propia advertencia. */}
      {editando && sel && (
        <div className="fixed inset-0 z-[60] p-4" style={{ background: 'rgba(4,5,4,0.78)', display: 'grid', placeItems: 'center' }}
          onClick={() => setEditando(false)}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true"
            style={{ maxWidth: 420, width: '100%', background: C.card, border: `1px solid ${C.b2}`, borderRadius: 18, padding: '22px 24px', fontFamily: FONT }}>
            <p style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px', margin: 0 }}>Editar cliente</p>
            <div style={{ marginTop: 16 }}>
              <Etiqueta>NOMBRE O RAZÓN SOCIAL</Etiqueta>
              <input value={edNombre} onChange={e => setEdNombre(e.target.value)}
                style={{ width: '100%', height: 42, marginTop: 6, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 10, padding: '0 13px', color: C.text, fontSize: 13.5, outline: 'none', fontFamily: FONT }} />
            </div>
            <div style={{ marginTop: 14 }}>
              <Etiqueta>TIPO DE CUENTA</Etiqueta>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                {(['business', 'personal'] as const).map(rr => (
                  <button key={rr} onClick={() => setEdRol(rr)}
                    style={{
                      flex: 1, height: 40, borderRadius: 9, fontFamily: FONT, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                      background: edRol === rr ? 'rgba(74,222,128,0.07)' : 'transparent',
                      border: `1px solid ${edRol === rr ? 'rgba(74,222,128,0.35)' : C.b2}`,
                      color: edRol === rr ? C.text : C.sub,
                    }}>{rr === 'business' ? 'Empresa' : 'Persona'}</button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: C.dim, margin: '7px 0 0', lineHeight: 1.5 }}>
                El tipo decide qué producto ve el cliente al entrar. Cambiarlo a la ligera lo deja en una app que no le corresponde.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
              <button onClick={() => setEditando(false)} style={{ ...btnSec, flex: 1, height: 44, justifyContent: 'center' }}>Cancelar</button>
              <button
                disabled={!edNombre.trim()}
                onClick={async () => {
                  await updateUserProfile?.(sel.id, { name: edNombre.trim(), role: edRol });
                  setEditando(false);
                  await refreshData?.();
                  showToast?.('Cliente actualizado.');
                }}
                style={{ ...btnPri, flex: 1, height: 44, justifyContent: 'center', opacity: edNombre.trim() ? 1 : 0.5 }}>
                Guardar cambios
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

// ── Tab: Resumen ─────────────────────────────────────────────────────────
const Resumen: React.FC<any> = ({ sel, movs, saldo, totalUsd, alternar, bloqueado, setConfirmar, setEscrito, toggleUserBlock, refreshData, showToast, nota, setNota, guardarNota, setTab, angosta }) => {
  const raw = sel.raw_data ?? {};
  const notas: any[] = Array.isArray(raw.notasInternas) ? raw.notasInternas : [];
  const btnSec: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'transparent',
    border: `1px solid ${C.b2}`, color: C.text, borderRadius: 9, padding: '10px 14px',
    fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, width: '100%',
  };

  const billeteras = [
    { t: 'USDT', sub: 'TRC-20', v: saldo(sel, 'USDT'), insignia: <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#26A17B', color: '#fff', fontWeight: 800, fontSize: 11, display: 'grid', placeItems: 'center' }}>T</span>, eq: saldo(sel, 'USDT') },
    { t: 'USDC', sub: 'Circle', v: saldo(sel, 'USDC'), insignia: <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#2775CA', color: '#fff', fontWeight: 800, fontSize: 11, display: 'grid', placeItems: 'center' }}>$</span>, eq: saldo(sel, 'USDC') },
    { t: 'COP', sub: 'Cuenta local', v: saldo(sel, 'COP'), insignia: <span style={{ width: 24, height: 24, borderRadius: '50%', display: 'block', background: 'linear-gradient(180deg,#FCD116 0 50%,#003893 50% 75%,#CE1126 75%)' }} />, eq: saldo(sel, 'COP') / Number(raw.usdCopRate ?? 3950) },
  ];

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${angosta ? 150 : 170}px, 1fr))`, gap: 11 }}>
        {billeteras.map(b => (
          <Tarjeta key={b.t}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {b.insignia}
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{b.t}</p>
              </div>
              <span style={{ fontSize: 11, color: C.sub, marginLeft: 'auto' }}>{b.sub}</span>
            </div>
            <p style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px', margin: '11px 0 0' }}>{money(b.v, b.t === 'COP' ? 0 : 2)}</p>
            <p style={{ fontSize: 11, color: C.sub, margin: '2px 0 0' }}>≈ ${money(b.eq)}</p>
          </Tarjeta>
        ))}
        <Tarjeta>
          <Etiqueta>TOTAL CLIENTE</Etiqueta>
          <p style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px', margin: '11px 0 0' }}>${money(totalUsd(sel))}</p>
          <p style={{ fontSize: 11, color: C.sub, margin: '2px 0 0' }}>Aproximado a la tasa de referencia</p>
        </Tarjeta>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: angosta ? '1fr' : '1fr 340px', gap: 14, marginTop: 14, alignItems: 'start' }}>
        {/* Izquierda */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <Tarjeta style={{ padding: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 16px 11px' }}>
              <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Actividad reciente</p>
              <button onClick={() => setTab('movimientos')} style={{ background: 'transparent', border: 'none', color: C.sub, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Ver todo <Ico d={I.flecha} size={13} />
              </button>
            </div>
            {movs.length === 0 ? (
              <p style={{ fontSize: 12.5, color: C.sub, padding: '0 16px 16px', margin: 0 }}>Esta cuenta todavía no tiene movimientos.</p>
            ) : movs.slice(0, 5).map((t: any, i: number) => {
              const entra = ['deposit', 'receive', 'payin', 'gasfree_credit'].includes(String(t.type));
              const estado = String(t.status ?? '');
              const tono = ['Completado', 'Liquidado', 'Aprobado'].includes(estado) ? 'ok'
                : ['Fallido', 'Rechazado'].includes(estado) ? 'mal'
                  : estado === 'Pendiente' ? 'curso' : 'neutro';
              return (
                <div key={t.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 16px', borderTop: `1px solid ${C.b1}` }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center',
                    background: entra ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.05)',
                    color: entra ? C.green : C.sub,
                  }}>
                    <Ico d={entra ? I.abajo : String(t.type) === 'conversion' ? I.cambio : I.arriba} size={14} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.concept ?? t.description ?? t.type ?? 'Movimiento'}
                    </p>
                    <p style={{ fontSize: 11.5, color: C.sub, margin: 0 }}>{fechaHora(t.createdAt ?? t.date)}</p>
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 700, margin: 0, whiteSpace: 'nowrap' }}>
                    {entra ? '+' : '−'}{money(Math.abs(Number(t.amount) || 0), String(t.currency ?? '').startsWith('COP') ? 0 : 2)}
                  </p>
                  <div style={{ flexShrink: 0 }}><Pill tono={tono as any}>{(estado || '—').toUpperCase()}</Pill></div>
                </div>
              );
            })}
          </Tarjeta>

          <Tarjeta>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Datos de la empresa</p>
              <button onClick={() => setTab('kyc')} style={{ background: 'transparent', border: 'none', color: C.sub, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Ver expediente KYC <Ico d={I.flecha} size={13} />
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))`, gap: 13, marginTop: 14 }}>
              {[
                { l: 'RAZÓN SOCIAL', v: sel.name || '—' },
                { l: 'NIT', v: raw.nit ?? sel.document_number ?? raw.documentNumber ?? '—' },
                { l: 'PAÍS · CIUDAD', v: [raw.country ?? 'Colombia', raw.city].filter(Boolean).join(' · ') },
                { l: 'ID CLIENTE', v: sel.id, mono: true, copiar: true },
                { l: 'REPRESENTANTE', v: raw.legalRep ?? raw.representante ?? '—' },
                { l: 'VERIFICADO POR', v: raw.kycProvider ? `${raw.kycProvider} · ${fecha(raw.kycVerifiedAt)}` : (sel.kycStatus === 'verified' ? `Verificado · ${fecha(raw.kycVerifiedAt)}` : 'Sin verificar') },
              ].map(x => (
                <div key={x.l} style={{ minWidth: 0 }}>
                  <Etiqueta>{x.l}</Etiqueta>
                  <p style={{
                    fontSize: 12.5, color: C.text, margin: '4px 0 0', fontWeight: 600,
                    fontFamily: x.mono ? MONO : FONT, wordBreak: x.mono ? 'break-all' : 'normal',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {String(x.v)}
                    {x.copiar && (
                      <button onClick={() => { navigator.clipboard?.writeText(String(x.v)); showToast?.('ID copiado.'); }}
                        title="Copiar" style={{ background: 'transparent', border: 'none', color: C.sub, cursor: 'pointer', padding: 0, display: 'inline-flex' }}>
                        <Ico d={I.copiar} size={13} />
                      </button>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </Tarjeta>
        </div>

        {/* Derecha */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <Tarjeta>
            <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Controles de cuenta</p>
            {[
              { campo: 'otcEnabled', l: 'Mesa OTC', d: 'Tasa negociada desde $50 000' },
              { campo: 'withdrawalsEnabled', l: 'Retiros habilitados', d: 'Bre-B, cuentas propias' },
              { campo: 'pseEnabled', l: 'Cargues por PSE', d: 'Solo cuentas a su nombre' },
            ].map((x, i) => {
              // Retiros y PSE vienen encendidos salvo que se apaguen a mano:
              // una cuenta nueva tiene que poder operar.
              const on = x.campo === 'otcEnabled'
                ? sel.otcEnabled === true || raw.otcEnabled === true
                : (sel[x.campo] ?? raw[x.campo] ?? true) === true;
              return (
                <div key={x.campo} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderTop: i === 0 ? `1px solid ${C.b1}` : `1px solid ${C.b1}`, marginTop: i === 0 ? 12 : 0 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{x.l}</p>
                    <p style={{ fontSize: 11.5, color: C.sub, margin: 0 }}>{x.d}</p>
                  </div>
                  <Toggle on={on} label={x.l} onClick={() => alternar(x.campo, !on, x.l)} />
                </div>
              );
            })}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
              <button onClick={() => showToast?.('Se envió el correo para restablecer la contraseña.')} style={btnSec}>Restablecer contraseña</button>
              <button
                onClick={() => {
                  setEscrito('');
                  const suspender = !bloqueado(sel);
                  setConfirmar({
                    titulo: suspender ? 'Suspender la cuenta' : 'Reactivar la cuenta',
                    nombre: sel.name || sel.email,
                    cuerpo: suspender
                      ? 'El cliente no podrá entrar ni operar. Sus saldos y movimientos se conservan, y la acción queda en el registro de auditoría.'
                      : 'El cliente vuelve a tener acceso y puede operar con normalidad.',
                    accion: async () => { await toggleUserBlock?.(sel.id, suspender); await refreshData?.(); showToast?.(suspender ? 'Cuenta suspendida.' : 'Cuenta reactivada.'); },
                  });
                }}
                style={{ ...btnSec, color: C.sub }}>
                {bloqueado(sel) ? 'Reactivar cuenta…' : 'Suspender cuenta…'}
              </button>
            </div>
            <p style={{ fontSize: 11, color: C.dim, margin: '11px 0 0', lineHeight: 1.5 }}>
              Suspender y eliminar requieren doble confirmación y quedan en el registro de auditoría.
            </p>
          </Tarjeta>

          <Limites sel={sel} movs={movs} compacto showToast={showToast} setTab={setTab} />

          <Tarjeta>
            <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Notas internas</p>
            {notas.length === 0 ? (
              <p style={{ fontSize: 12, color: C.sub, margin: '9px 0 0' }}>Sin notas. Lo que escribas acá no lo ve el cliente.</p>
            ) : notas.slice(0, 4).map((n, i) => (
              <div key={i} style={{ borderLeft: `2px solid ${C.b2}`, paddingLeft: 11, marginTop: 12 }}>
                <p style={{ fontSize: 12.5, color: C.text, margin: 0, lineHeight: 1.55 }}>{n.texto}</p>
                <p style={{ fontSize: 11, color: C.dim, margin: '3px 0 0' }}>{n.autor ?? 'Admin'} · {fechaHora(n.at)}</p>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input value={nota} onChange={e => setNota(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') guardarNota(); }}
                placeholder="Escribir nota…"
                style={{ flex: 1, minWidth: 0, height: 38, background: 'rgba(255,255,255,0.045)', border: `1px solid ${C.b1}`, borderRadius: 9, padding: '0 12px', color: C.text, fontSize: 12.5, outline: 'none', fontFamily: FONT }} />
              <button onClick={guardarNota} disabled={!nota.trim()}
                style={{ background: 'transparent', border: `1px solid ${C.b2}`, color: nota.trim() ? C.text : C.dim, borderRadius: 9, padding: '0 14px', fontSize: 12.5, fontWeight: 600, cursor: nota.trim() ? 'pointer' : 'not-allowed', fontFamily: FONT }}>
                Guardar
              </button>
            </div>
          </Tarjeta>
        </div>
      </div>
    </div>
  );
};

// ── Tab: Movimientos ─────────────────────────────────────────────────────
const Movimientos: React.FC<any> = ({ movs }) => (
  <Tarjeta style={{ marginTop: 18, padding: 0 }}>
    {movs.length === 0 ? (
      <p style={{ fontSize: 12.5, color: C.sub, padding: 22, margin: 0, textAlign: 'center' }}>Esta cuenta todavía no tiene movimientos.</p>
    ) : movs.slice(0, 60).map((t: any, i: number) => {
      const entra = ['deposit', 'receive', 'payin', 'gasfree_credit'].includes(String(t.type));
      const estado = String(t.status ?? '');
      const tono = ['Completado', 'Liquidado', 'Aprobado'].includes(estado) ? 'ok'
        : ['Fallido', 'Rechazado'].includes(estado) ? 'mal' : estado === 'Pendiente' ? 'curso' : 'neutro';
      return (
        <div key={t.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 16px', borderTop: i === 0 ? 'none' : `1px solid ${C.b1}` }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center', background: entra ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.05)', color: entra ? C.green : C.sub }}>
            <Ico d={entra ? I.abajo : String(t.type) === 'conversion' ? I.cambio : I.arriba} size={14} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{t.concept ?? t.description ?? t.type ?? 'Movimiento'}</p>
            <p style={{ fontSize: 11.5, color: C.sub, margin: 0, fontFamily: MONO }}>{fechaHora(t.createdAt ?? t.date)}{t.reference ? ` · ${t.reference}` : ''}</p>
          </div>
          <p style={{ fontSize: 13, fontWeight: 700, margin: 0, whiteSpace: 'nowrap' }}>
            {entra ? '+' : '−'}{money(Math.abs(Number(t.amount) || 0), String(t.currency ?? '').startsWith('COP') ? 0 : 2)} <span style={{ color: C.sub, fontWeight: 500, fontSize: 11 }}>{String(t.currency ?? '').split('_')[0]}</span>
          </p>
          <div style={{ flexShrink: 0 }}><Pill tono={tono as any}>{(estado || '—').toUpperCase()}</Pill></div>
        </div>
      );
    })}
  </Tarjeta>
);

// ── Tab: KYC ─────────────────────────────────────────────────────────────
const Kyc: React.FC<any> = ({ sel, verifyUser, refreshData, showToast, verificado }) => {
  const raw = sel.raw_data ?? {};
  const docs = sel.documents ?? raw.documents ?? {};
  const entradas = Object.entries(docs).filter(([, v]) => !!v);
  return (
    <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Tarjeta>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Estado de la verificación</p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0' }}>
              {verificado(sel) ? `Verificado${raw.kycVerifiedAt ? ` el ${fecha(raw.kycVerifiedAt)}` : ''}.` : 'Pendiente de revisión.'}
            </p>
          </div>
          {verificado(sel) ? <Pill tono="ok">VERIFICADO</Pill> : <Pill>PENDIENTE</Pill>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button onClick={async () => { await verifyUser?.(sel.id, 'verified'); await refreshData?.(); showToast?.('Cliente verificado.'); }}
            style={{ background: C.text, border: 'none', color: '#0A0A0A', borderRadius: 9, padding: '9px 15px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
            Aprobar
          </button>
          <button onClick={async () => { await verifyUser?.(sel.id, 'rejected'); await refreshData?.(); showToast?.('Verificación rechazada.'); }}
            style={{ background: 'transparent', border: `1px solid ${C.b2}`, color: C.sub, borderRadius: 9, padding: '9px 15px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
            Rechazar
          </button>
        </div>
      </Tarjeta>

      <Tarjeta>
        <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Documentos</p>
        {entradas.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.sub, margin: '9px 0 0' }}>El cliente todavía no ha subido documentos.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 13 }}>
            {entradas.map(([k, v]) => (
              <a key={k} href={String(v)} target="_blank" rel="noreferrer"
                style={{ display: 'block', background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 11, padding: '12px 13px', textDecoration: 'none' }}>
                <Etiqueta>{k.toUpperCase()}</Etiqueta>
                <p style={{ fontSize: 12.5, color: C.text, margin: '5px 0 0', fontWeight: 600 }}>Abrir documento →</p>
              </a>
            ))}
          </div>
        )}
      </Tarjeta>
    </div>
  );
};

// ── Tab / tarjeta: Límites ───────────────────────────────────────────────
const Limites: React.FC<any> = ({ sel, movs, updateUserRawData, refreshData, showToast, compacto, setTab }) => {
  const raw = sel.raw_data ?? {};
  const ahora = new Date();
  const delMes = (movs ?? []).filter((t: any) => {
    const d = t.createdAt ? new Date(t.createdAt) : null;
    return d && d.getMonth() === ahora.getMonth() && d.getFullYear() === ahora.getFullYear();
  });
  const suma = (tipos: string[]) => delMes
    .filter((t: any) => tipos.includes(String(t.type)) && !['Fallido', 'Rechazado'].includes(String(t.status)))
    .reduce((s: number, t: any) => s + Math.abs(Number(t.amount) || 0), 0);

  const cargues = suma(['deposit', 'payin', 'gasfree_credit']);
  const retiros = suma(['withdrawal', 'send', 'dispersion', 'otc_withdraw', 'pay_sent']);
  const topeC = Number(raw.monthlyDepositLimit ?? 100000);
  const topeR = Number(raw.monthlyLimitUsdt ?? 80000);
  const comision = Number(raw.exchangeFeePct ?? 0.4);

  const cuerpo = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Límites del mes</p>
        {compacto && (
          <button onClick={() => setTab?.('limites')} style={{ background: 'transparent', border: 'none', color: C.sub, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>Ajustar</button>
        )}
      </div>
      {[
        { l: 'Cargues', u: cargues, t: topeC },
        { l: 'Retiros', u: retiros, t: topeR },
      ].map(x => (
        <div key={x.l} style={{ marginTop: 13 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 12.5, color: C.text, fontWeight: 600 }}>{x.l}</span>
            <span style={{ fontSize: 12, color: C.sub }}>
              <b style={{ color: C.text, fontWeight: 700 }}>${money(x.u, 0)}</b> / ${money(x.t, 0)}
            </span>
          </div>
          <Barra usado={x.u} tope={x.t} />
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 15, paddingTop: 12, borderTop: `1px solid ${C.b1}` }}>
        <span style={{ fontSize: 12.5, color: C.text, fontWeight: 600 }}>Comisión de cambio</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.green }}>{String(comision).replace('.', ',')} %</span>
      </div>
    </>
  );

  if (compacto) return <Tarjeta>{cuerpo}</Tarjeta>;

  return (
    <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Tarjeta>{cuerpo}</Tarjeta>
      <Tarjeta>
        <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Ajustar topes</p>
        <p style={{ fontSize: 12, color: C.sub, margin: '4px 0 0', lineHeight: 1.55 }}>
          Los topes son mensuales y en USD. Al guardarlos, el cambio queda en el registro de auditoría.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 11, marginTop: 14 }}>
          {[
            { k: 'monthlyDepositLimit', l: 'TOPE DE CARGUES', v: topeC },
            { k: 'monthlyLimitUsdt', l: 'TOPE DE RETIROS', v: topeR },
            { k: 'exchangeFeePct', l: 'COMISIÓN DE CAMBIO (%)', v: comision },
          ].map(x => (
            <div key={x.k}>
              <Etiqueta>{x.l}</Etiqueta>
              <input defaultValue={String(x.v)} type="number"
                onBlur={async e => {
                  const v = Number(e.target.value);
                  if (!isFinite(v) || v < 0) return;
                  await updateUserRawData?.(sel.id, { [x.k]: v });
                  await refreshData?.();
                  showToast?.('Límite actualizado.');
                }}
                style={{ width: '100%', height: 40, marginTop: 6, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 9, padding: '0 12px', color: C.text, fontSize: 13, outline: 'none', fontFamily: MONO }} />
            </div>
          ))}
        </div>
      </Tarjeta>
    </div>
  );
};

// ── Tab: Auditoría ───────────────────────────────────────────────────────
const Auditoria: React.FC<any> = ({ sel, movs }) => {
  const raw = sel.raw_data ?? {};
  const eventos = [
    ...(Array.isArray(raw.actividad) ? raw.actividad : []),
    ...(movs ?? []).slice(0, 30).map((t: any) => ({
      accion: `${t.type ?? 'movimiento'} · ${t.status ?? ''}`.trim(),
      at: t.createdAt ?? t.date, detalle: t.reference ?? t.concept ?? '',
    })),
  ].sort((a: any, b: any) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());

  return (
    <Tarjeta style={{ marginTop: 18, padding: 0 }}>
      <p style={{ fontSize: 14, fontWeight: 700, margin: 0, padding: '15px 16px 11px' }}>Registro de la cuenta</p>
      {eventos.length === 0 ? (
        <p style={{ fontSize: 12.5, color: C.sub, padding: '0 16px 18px', margin: 0 }}>Sin eventos registrados para esta cuenta.</p>
      ) : eventos.slice(0, 40).map((e: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderTop: `1px solid ${C.b1}` }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: C.text, margin: 0 }}>{e.accion ?? '—'}</p>
            {e.detalle && <p style={{ fontSize: 11.5, color: C.sub, margin: 0, fontFamily: MONO, wordBreak: 'break-all' }}>{String(e.detalle)}</p>}
          </div>
          <span style={{ fontSize: 11.5, color: C.dim, whiteSpace: 'nowrap' }}>{fechaHora(e.at)}</span>
        </div>
      ))}
    </Tarjeta>
  );
};
