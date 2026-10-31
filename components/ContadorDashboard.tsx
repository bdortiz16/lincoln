// ══════════════════════════════════════════════════════════════════
//  Panel del contador — Empresas → Contabilidad
//
//  Barra lateral con "Inicio" (el tablero del contador: las empresas que
//  lleva, las solicitudes en espera y el formulario para conectar otra) y
//  la lista de empresas. Al elegir una se abre su Contabilidad en modo solo
//  lectura. Los datos no salen de la sesión del contador (su RLS no ve nada
//  de la empresa): los entrega la función `contador` después de verificar
//  el vínculo.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, Search, Clock, Building2, ArrowRight, Menu, X } from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';
import { llamarFuncion } from '../lib/edge';
import { ContabilidadDashboard } from './ContabilidadDashboard';
import { ConfirmarModal } from './ConfirmarModal';
import { ContadorDetalleMovimiento } from './ContadorDetalleMovimiento';
import { DocumentosContables } from './DocumentosContables';
import type { FichaEmpresa } from './libroContable';

const FONT = 'Archivo, system-ui, sans-serif';
const C = {
  fondo: '#070808', lateral: '#0A0C0B', tarjeta: '#0C0E0D', borde: 'rgba(255,255,255,0.08)',
  activo: 'rgba(255,255,255,0.055)', hover: 'rgba(255,255,255,0.03)',
  text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c', verde: '#4ADE80', rojo: '#F87171',
};

// Misma forma que le da el contexto a los movimientos propios: raw_data se
// aplana para acceso directo y se conserva bajo su clave.
const normEstado = (s: any): string => {
  const v = String(s ?? '').toLowerCase();
  if (['completed', 'completado', 'success', 'succeeded', 'confirmed', 'confirmada', 'approved', 'aprobada'].includes(v)) return 'Completado';
  if (['rejected', 'cancelled', 'canceled', 'failed', 'denied', 'rechazada'].includes(v)) return 'Rechazado';
  if (['processing', 'procesando'].includes(v)) return 'Procesando';
  if (['pending', 'pendiente'].includes(v)) return 'Pendiente';
  return String(s ?? '');
};
const mapTx = (t: any) => ({
  id: t.id, userId: t.user_id, type: t.type,
  amount: Number(t.amount), currency: t.currency, status: normEstado(t.status),
  createdAt: t.created_at ?? t.raw_data?.createdAt,
  raw_data: t.raw_data ?? {},
  ...(t.raw_data ?? {}),
});

type Datos = { empresa: FichaEmpresa & { id: string; email: string; nit: string }; transactions: any[]; comprobantes: any[]; comprobantesError: string | null };
type Vinculo = { id: string; nombre: string };

// Iconos de trazo iguales a los de la barra de Empresas.
const Ico: React.FC<{ d: string }> = ({ d }) => (
  <svg width={18} height={18} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d={d} />
  </svg>
);
const I = {
  casa: 'M3 8.5L10 3l7 5.5V16a1 1 0 01-1 1h-3.5v-5h-5v5H4a1 1 0 01-1-1z',
  mas: 'M10 4v12M4 10h12',
  edificio: 'M4 17V4.5A1.5 1.5 0 015.5 3h6A1.5 1.5 0 0113 4.5V17M13 8h1.5A1.5 1.5 0 0116 9.5V17M2.5 17h15M7 6.5h3M7 9.5h3M7 12.5h3',
  reloj: 'M10 17.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM10 6v4.2l2.8 1.6',
  puerta: 'M12.5 6V4.5a1 1 0 00-1-1h-6a1 1 0 00-1 1v11a1 1 0 001 1h6a1 1 0 001-1V14M8.5 10h9m0 0l-2.5-2.5M17.5 10L15 12.5',
};

const Fila: React.FC<{ etiqueta: string; icono: string; activo?: boolean; apagado?: boolean; nota?: string; onClick?: () => void }> = ({ etiqueta, icono, activo, apagado, nota, onClick }) => {
  const [sobre, setSobre] = useState(false);
  return (
    <button onClick={onClick} aria-current={activo ? 'page' : undefined}
      onMouseEnter={() => setSobre(true)} onMouseLeave={() => setSobre(false)}
      className="lincoin-nav-item"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', borderRadius: 9, border: 'none', textAlign: 'left',
        background: activo ? C.activo : sobre ? C.hover : 'transparent',
        color: activo || sobre ? C.text : C.sub, opacity: apagado ? 0.6 : 1,
        fontFamily: FONT, fontSize: 14, fontWeight: activo ? 600 : 500, cursor: 'pointer', transition: 'background 150ms, color 150ms',
      }}>
      <Ico d={icono} />
      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{etiqueta}</span>
      {nota && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.6px', color: C.tenue, flexShrink: 0 }}>{nota}</span>}
    </button>
  );
};

// La bolita de la empresa: sus iniciales (MEXITECH → ME, J&J EYEWEAR → JE).
const inicialesDe = (nombre: string) => {
  const p = String(nombre ?? '').replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9 ]+/g, ' ').trim().split(/\s+/).filter(w => !/^(S|SAS|SA|LTDA|EU)$/i.test(w));
  return ((p.length > 1 ? p[0][0] + p[1][0] : (p[0] ?? '?').slice(0, 2)) || '?').toUpperCase();
};
const Bolita: React.FC<{ nombre: string; activo?: boolean; tam?: number }> = ({ nombre, activo, tam = 26 }) => (
  <span aria-hidden="true" style={{ width: tam, height: tam, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: Math.round(tam * 0.4), fontWeight: 800, letterSpacing: '-0.3px',
    color: activo ? '#0A0A0A' : C.text, background: activo ? C.verde : 'rgba(255,255,255,0.08)', border: `1px solid ${activo ? C.verde : 'rgba(255,255,255,0.12)'}` }}>
    {inicialesDe(nombre)}
  </span>
);
// Una empresa en la barra: su bolita, el nombre y una ✕ para dejar de
// trabajar con ella (pide confirmar).
const FilaEmpresa: React.FC<{ nombre: string; activo: boolean; onAbrir: () => void; onDejar: () => void }> = ({ nombre, activo, onAbrir, onDejar }) => {
  const [sobre, setSobre] = useState(false);
  return (
    <div onMouseEnter={() => setSobre(true)} onMouseLeave={() => setSobre(false)}
      style={{ display: 'flex', alignItems: 'center', borderRadius: 9, background: activo ? C.activo : sobre ? C.hover : 'transparent', transition: 'background 150ms' }}>
      <button onClick={onAbrir} aria-current={activo ? 'page' : undefined} className="lincoin-nav-item"
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px 8px 10px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer',
          color: activo || sobre ? C.text : C.sub, fontFamily: FONT, fontSize: 14, fontWeight: activo ? 600 : 500 }}>
        <Bolita nombre={nombre} activo={activo} />
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombre}</span>
      </button>
      <button onClick={onDejar} aria-label={`Dejar de trabajar con ${nombre}`} title="Dejar de trabajar con esta empresa" className="lincoin-nav-item"
        style={{ width: 28, height: 28, marginRight: 4, flexShrink: 0, borderRadius: 7, border: 'none', background: 'transparent', color: C.sub, cursor: 'pointer', fontSize: 15, lineHeight: 1,
          opacity: sobre || activo ? 1 : 0.35, transition: 'opacity 150ms' }}>×</button>
    </div>
  );
};

// La ficha de la empresa abierta: sus datos (los mismos del estado de
// cuenta) y sus documentos contables, que el contador anexa y la empresa
// descarga en su perfil.
const FichaEmpresaModal: React.FC<{ empresa: Datos['empresa']; onCerrar: () => void }> = ({ empresa, onCerrar }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Con la confirmación de "Retirar" abierta, Escape es de ella.
      if (e.key === 'Escape' && !document.getElementById('confirmar-titulo')) onCerrar();
    };
    window.addEventListener('keydown', onKey);
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = antes; };
  }, [onCerrar]);
  const desde = empresa.clienteDesde ? new Date(empresa.clienteDesde).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }) : '';
  const filas = ([
    ['Identificación', [empresa.tipoDocumento, empresa.nit].filter(Boolean).join(' ')],
    ['Representante legal', [empresa.representante, empresa.representanteDoc].filter(Boolean).join(' · ')],
    ['Dirección', empresa.direccion],
    ['Ciudad', [empresa.ciudad, empresa.pais].filter(Boolean).join(', ')],
    ['Teléfono', empresa.telefono],
    ['Correo', empresa.email],
    ['Cliente Lincoin desde', desde],
  ] as [string, string | undefined][]).filter(([, v]) => String(v ?? '').trim());
  return createPortal(
    <div onClick={onCerrar} role="dialog" aria-modal="true" aria-labelledby="ficha-empresa-titulo"
      style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.66)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto', fontFamily: FONT, color: C.text }}>
      <div onClick={e => e.stopPropagation()} className="animate-in zoom-in-95 fade-in duration-200"
        style={{ width: '100%', maxWidth: 640, background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 18, boxShadow: '0 30px 90px rgba(0,0,0,0.6)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -80, right: -60, width: 240, height: 240, borderRadius: '50%', background: 'radial-gradient(circle, rgba(74,222,128,0.14), transparent 65%)', pointerEvents: 'none' }} />
        <div className="flex items-center" style={{ gap: 14, padding: '22px 22px 18px', borderBottom: `1px solid ${C.borde}`, position: 'relative' }}>
          <Bolita nombre={empresa.nombre} activo tam={46} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="ficha-empresa-titulo" style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.4px', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{empresa.nombre}</h2>
            <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0' }}>{[empresa.nit ? `${empresa.tipoDocumento || 'NIT'} ${empresa.nit}` : '', empresa.idLincoin ? `ID Lincoin ${empresa.idLincoin}` : ''].filter(Boolean).join(' · ')}</p>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, color: C.sub, borderRadius: 9, padding: 7, cursor: 'pointer', display: 'inline-flex', flexShrink: 0 }}><X size={16} /></button>
        </div>
        <div style={{ padding: '18px 22px 4px', position: 'relative' }}>
          <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: '0 0 8px' }}>DATOS DE LA EMPRESA</p>
          {filas.length === 0
            ? <p style={{ fontSize: 13, color: C.tenue, margin: 0 }}>La empresa no ha completado sus datos en Lincoin.</p>
            : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px 18px' }}>
                {filas.map(([k, v]) => (
                  <div key={k} style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 11.5, color: C.sub, margin: 0 }}>{k}</p>
                    <p style={{ fontSize: 13.5, fontWeight: 600, margin: '2px 0 0', overflowWrap: 'anywhere' }}>{v}</p>
                  </div>
                ))}
              </div>
            )}
        </div>
        <div style={{ padding: '18px 22px 22px', marginTop: 14, borderTop: `1px solid ${C.borde}`, position: 'relative' }}>
          <DocumentosContables modo="contador" empresaId={empresa.id} />
        </div>
      </div>
    </div>,
    document.body,
  );
};

export const ContadorDashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const { currentUser } = useDatabase();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [detalle, setDetalle] = useState<any | null>(null);
  // Vínculos del contador: empresas que lo aprobaron y solicitudes en espera.
  const [aprobadas, setAprobadas] = useState<Vinculo[] | null>(null);
  const [pendientes, setPendientes] = useState<Vinculo[]>([]);
  // null = Inicio; un id = la Contabilidad de esa empresa.
  const [empresaSel, setEmpresaSel] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [pidiendo, setPidiendo] = useState(false);
  const [avisoPedido, setAvisoPedido] = useState<string | null>(null);
  const [menuMovil, setMenuMovil] = useState(false);
  const [confirmarSalir, setConfirmarSalir] = useState(false);
  // Dejar de trabajar con una empresa (sale de su lista; lo de la empresa,
  // como su configuración de Siigo, se queda en la empresa).
  const [dejar, setDejar] = useState<Vinculo | null>(null);
  const [dejando, setDejando] = useState(false);
  // Ficha de la empresa abierta (datos y documentos contables).
  const [fichaAbierta, setFichaAbierta] = useState(false);
  const dejarEmpresa = async () => {
    if (!dejar || dejando) return;
    setDejando(true);
    const r = await llamarFuncion('contador', { action: 'salir_empresa', empresaId: dejar.id }, 30000);
    setDejando(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo dejar la empresa.'); setDejar(null); return; }
    if (empresaSel === dejar.id) { setEmpresaSel(null); setDatos(null); }
    setAprobadas(a => (a ?? []).filter(e => e.id !== dejar.id));
    setAvisoPedido(`Dejaste ${dejar.nombre}. Su configuración de Siigo y sus facturas siguen guardadas en la empresa. Para volver, pide acceso otra vez con su ID.`);
    setDejar(null);
    cargarEstado();
  };

  const cargarDatos = async (empresaId: string) => {
    setCargando(true); setError(null); setDatos(null);
    const r = await llamarFuncion('contador', { action: 'datos', empresaId }, 60000);
    setCargando(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo cargar la contabilidad.'); return; }
    setDatos({ empresa: r.empresa, transactions: (r.transactions ?? []).map(mapTx), comprobantes: r.comprobantes ?? [], comprobantesError: r.comprobantesError ?? null });
  };
  const cargarEstado = async () => {
    setCargando(true); setError(null);
    const r = await llamarFuncion('contador', { action: 'estado' }, 30000);
    setCargando(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo consultar tu acceso.'); setAprobadas(a => a ?? []); return; }
    const ap: Vinculo[] = r.aprobadas ?? [];
    setAprobadas(ap); setPendientes(r.pendientes ?? []);
    // Si la empresa abierta quitó el acceso, se vuelve a Inicio.
    if (empresaSel && !ap.some(e => e.id === empresaSel)) { setEmpresaSel(null); setDatos(null); }
  };
  useEffect(() => { cargarEstado(); }, []);

  const irInicio = () => { setEmpresaSel(null); setError(null); setMenuMovil(false); setFichaAbierta(false); };
  const abrirEmpresa = (id: string) => {
    setMenuMovil(false); setFichaAbierta(false);
    setEmpresaSel(id);
    if (datos?.empresa.id !== id) cargarDatos(id);
  };
  const irConectar = () => { irInicio(); setTimeout(() => document.getElementById('conta-conectar')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60); };
  const actualizar = () => (empresaSel ? cargarDatos(empresaSel) : cargarEstado());

  const pedirAcceso = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = codigo.trim().toUpperCase();
    if (c.length < 4 || pidiendo) return;
    setPidiendo(true); setError(null); setAvisoPedido(null);
    const r = await llamarFuncion('contador', { action: 'solicitar', codigoEmpresa: c }, 30000);
    setPidiendo(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo enviar la solicitud.'); return; }
    setCodigo('');
    setAvisoPedido(r.estado === 'aprobado' ? `Ya tienes acceso a ${r.empresa?.nombre}.` : `Listo. ${r.empresa?.nombre} tiene que aprobarte desde su Contabilidad. Cuando lo haga, aparece en tu lista de empresas.`);
    cargarEstado();
  };

  const transactions = useMemo(() => datos?.transactions ?? [], [datos]);
  const nombreSel = aprobadas?.find(e => e.id === empresaSel)?.nombre ?? datos?.empresa.nombre ?? '';
  const miNombre = currentUser?.name || currentUser?.email || 'Mi cuenta';
  const inicial = String(miNombre).trim().charAt(0).toUpperCase();
  const primerNombre = String(currentUser?.name || '').trim().split(/\s+/)[0];

  const botonSec: React.CSSProperties = { fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.sub, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '9px 12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 };
  const etiqueta: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: 0 };

  const formularioConectar = (
    <div style={{ background: `linear-gradient(135deg, #161A17 0%, ${C.tarjeta} 70%)`, border: `1px solid ${C.borde}`, borderRadius: 16, padding: '22px 22px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: -70, right: -50, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(74,222,128,0.14), transparent 65%)', pointerEvents: 'none' }} />
      <Building2 size={22} color={C.verde} />
      <h2 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.4px', margin: '10px 0 0' }}>{(aprobadas?.length ?? 0) > 0 ? 'Conectar otra empresa' : 'Conéctate a una empresa'}</h2>
      <p style={{ fontSize: 13, color: C.sub, margin: '6px 0 0', lineHeight: 1.55 }}>
        Escribe el <b style={{ color: C.text }}>ID Lincoin</b> de la empresa (está en su Contabilidad → Contador). Ellos aprueban tu acceso y desde ese momento aparece en tu lista.
      </p>
      <form onSubmit={pedirAcceso} className="flex items-center flex-wrap" style={{ gap: 8, marginTop: 16, position: 'relative' }}>
        <div style={{ position: 'relative', flex: '1 1 200px' }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.sub }} />
          <input value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} placeholder="ID de la empresa" maxLength={8}
            style={{ fontFamily: 'ui-monospace, monospace', width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, color: C.text, borderRadius: 10, padding: '12px 12px 12px 36px', fontSize: 16, fontWeight: 700, letterSpacing: '3px', outline: 'none' }} />
        </div>
        <button type="submit" disabled={pidiendo || codigo.length < 4} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, padding: '12px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', opacity: pidiendo || codigo.length < 4 ? 0.6 : 1 }}>
          {pidiendo ? 'Enviando…' : 'Pedir acceso'}
        </button>
      </form>
      {avisoPedido && <p style={{ fontSize: 13, color: C.verde, margin: '12px 0 0', lineHeight: 1.5 }}>{avisoPedido}</p>}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: C.fondo, color: C.text, fontFamily: FONT, display: 'flex' }}>
      {menuMovil && <div onClick={() => setMenuMovil(false)} aria-hidden="true" className="lg:hidden" style={{ position: 'fixed', inset: 0, zIndex: 25, background: 'rgba(0,0,0,0.55)' }} />}

      <aside className={`lincoin-sidebar-conta ${menuMovil ? 'abierta' : ''}`}
        style={{ width: 244, flexShrink: 0, background: C.lateral, borderRight: `1px solid ${C.borde}`, padding: '24px 14px 18px', display: 'flex', flexDirection: 'column' }}>
        {/* Logo — no se rediseña: wordmark Archivo 800 y el punto verde. */}
        <div style={{ padding: '0 10px 22px' }}>
          <p style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.6px', color: C.text, margin: 0, lineHeight: 1 }}>Lincoin<span style={{ color: C.verde }}>.</span></p>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '2.2px', color: C.sub, margin: '6px 0 0' }}>CONTABILIDAD</p>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0, overflowY: 'auto' }}>
          <Fila etiqueta="Inicio" icono={I.casa} activo={empresaSel == null} onClick={irInicio} />

          <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '2px', color: C.sub, margin: 0, padding: '22px 12px 7px' }}>EMPRESAS</p>
          {(aprobadas ?? []).map(e => (
            <FilaEmpresa key={e.id} nombre={e.nombre} activo={empresaSel === e.id} onAbrir={() => abrirEmpresa(e.id)} onDejar={() => setDejar(e)} />
          ))}
          {pendientes.map(p => (
            <Fila key={p.id} etiqueta={p.nombre} icono={I.reloj} apagado nota="EN ESPERA" onClick={irInicio} />
          ))}
          {aprobadas != null && aprobadas.length === 0 && pendientes.length === 0 && (
            <p style={{ fontSize: 12, color: C.tenue, margin: 0, padding: '4px 12px 6px', lineHeight: 1.45 }}>Aún no llevas ninguna empresa.</p>
          )}
          <Fila etiqueta="Conectar empresa" icono={I.mas} onClick={irConectar} />
        </nav>

        <div style={{ borderTop: `1px solid ${C.borde}`, paddingTop: 12, marginTop: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px', marginBottom: 4 }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: 'linear-gradient(140deg, #2E3330, #1A1D1B)', border: '1px solid rgba(255,255,255,0.1)', display: 'grid', placeItems: 'center', color: C.sub, fontWeight: 800, fontSize: 12 }}>{inicial}</span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{miNombre}</span>
              <span style={{ display: 'block', fontSize: 10.5, color: C.sub }}>Contador · contabilidad y facturación</span>
            </span>
          </div>
          <Fila etiqueta="Cerrar sesión" icono={I.puerta} onClick={() => setConfirmarSalir(true)} />
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0 }}>
        <header style={{ borderBottom: `1px solid ${C.borde}`, padding: '14px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div className="flex items-center" style={{ gap: 12, minWidth: 0 }}>
            <button onClick={() => setMenuMovil(true)} aria-label="Abrir menú" className="lg:hidden" style={{ background: 'transparent', border: 'none', color: C.text, padding: 4, cursor: 'pointer', display: 'inline-flex' }}><Menu size={20} /></button>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 800, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{empresaSel ? nombreSel : 'Inicio'}</p>
              <p style={{ fontSize: 11.5, color: C.sub, margin: '1px 0 0' }}>{empresaSel ? 'Contabilidad y facturación' : 'Tus empresas'}</p>
            </div>
          </div>
          <div className="flex items-center" style={{ gap: 8 }}>
            {empresaSel && datos?.empresa.id === empresaSel && (
              <button onClick={() => setFichaAbierta(true)} title={`Ficha y documentos de ${nombreSel}`} aria-label={`Ficha y documentos de ${nombreSel}`}
                style={{ ...botonSec, color: C.text, padding: '4px 12px 4px 4px' }}>
                <Bolita nombre={nombreSel} activo tam={27} />
                <span style={{ maxWidth: 'min(200px, 34vw)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombreSel}</span>
              </button>
            )}
            <button onClick={actualizar} disabled={cargando} title="Actualizar" style={{ ...botonSec, opacity: cargando ? 0.6 : 1 }}>
              <RefreshCw size={13} /> {cargando ? 'Cargando…' : 'Actualizar'}
            </button>
          </div>
        </header>

        <main style={{ padding: '22px 22px 40px', maxWidth: 1220, margin: '0 auto' }}>
          {error && (
            <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
              <p style={{ fontSize: 13.5, fontWeight: 700, color: C.rojo, margin: 0 }}>{empresaSel ? 'No se pudo abrir la contabilidad' : 'Algo no salió bien'}</p>
              <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>{error}</p>
            </div>
          )}

          {/* ── Inicio: el tablero del contador ── */}
          {empresaSel == null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 980 }}>
              <div>
                <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.6px', margin: 0 }}>{primerNombre ? `Hola, ${primerNombre}` : 'Hola'}</h1>
                <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>Elige la empresa cuya contabilidad quieres revisar, o conecta una nueva con su ID.</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                {([
                  ['EMPRESAS A CARGO', aprobadas == null ? '—' : String(aprobadas.length), 'Con acceso aprobado'],
                  ['EN ESPERA', aprobadas == null ? '—' : String(pendientes.length), 'Falta que la empresa apruebe'],
                ] as [string, string, string][]).map(([k, v, s]) => (
                  <div key={k} style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 14, padding: '14px 16px' }}>
                    <p style={etiqueta}>{k}</p>
                    <p style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.5px', margin: '6px 0 0' }}>{v}</p>
                    <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0' }}>{s}</p>
                  </div>
                ))}
              </div>

              {aprobadas == null && cargando && <p style={{ fontSize: 13, color: C.sub, margin: 0 }}>Cargando…</p>}

              {(aprobadas?.length ?? 0) > 0 && (
                <div>
                  <p style={{ ...etiqueta, marginBottom: 8 }}>TUS EMPRESAS</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                    {aprobadas!.map(e => (
                      <div key={e.id} className="conta-empresa" style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 14, display: 'flex', alignItems: 'center' }}>
                        <button onClick={() => abrirEmpresa(e.id)} className="lincoin-nav-item"
                          style={{ fontFamily: FONT, flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', borderRadius: 14, padding: '16px 8px 16px 16px', cursor: 'pointer', color: C.text, display: 'flex', alignItems: 'center', gap: 12 }}>
                          <Bolita nombre={e.nombre} tam={38} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.nombre}</span>
                            <span style={{ display: 'block', fontSize: 11.5, color: C.sub, marginTop: 2 }}>Abrir contabilidad</span>
                          </span>
                          <ArrowRight size={16} color={C.sub} />
                        </button>
                        <button onClick={() => setDejar(e)} title="Dejar de trabajar con esta empresa" className="lincoin-nav-item"
                          style={{ fontFamily: FONT, fontSize: 11.5, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 8, padding: '6px 9px', margin: '0 14px 0 4px', cursor: 'pointer', flexShrink: 0 }}>Dejar</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pendientes.length > 0 && (
                <div style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 14, padding: '14px 18px' }}>
                  <p style={etiqueta}>EN ESPERA DE APROBACIÓN</p>
                  {pendientes.map(p => (
                    <p key={p.id} className="flex items-center" style={{ fontSize: 13.5, fontWeight: 700, margin: '8px 0 0', gap: 8 }}><Clock size={14} color={C.sub} /> {p.nombre}</p>
                  ))}
                  <p style={{ fontSize: 12, color: C.tenue, margin: '10px 0 0', lineHeight: 1.5 }}>La empresa te aprueba desde su Contabilidad → Contador. Toca "Actualizar" arriba cuando te avisen.</p>
                </div>
              )}

              <div id="conta-conectar" style={{ maxWidth: 620 }}>{formularioConectar}</div>
            </div>
          )}

          {/* ── Contabilidad de la empresa elegida ── */}
          {empresaSel != null && (
            <>
              {datos?.comprobantesError && <p style={{ fontSize: 12, color: C.tenue, margin: '0 0 12px' }}>Los comprobantes no se pudieron leer: {datos.comprobantesError}</p>}
              {!datos && cargando && <p style={{ fontSize: 13, color: C.sub }}>Cargando…</p>}
              {datos && datos.empresa.id === empresaSel && (
                <ContabilidadDashboard
                  transactions={transactions}
                  userId={datos.empresa.id}
                  // Factura en nombre de la empresa: el servidor revisa en
                  // cada llamada que la empresa lo tenga aprobado.
                  empresaId={datos.empresa.id}
                  comprobantesExternos={datos.comprobantes}
                  empresa={datos.empresa}
                  onVerMovimiento={(tx: any) => setDetalle(tx)}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Detalle completo: movimiento, comprobante y documento de Siigo. */}
      {detalle && datos && (
        <ContadorDetalleMovimiento
          tx={detalle}
          empresaId={datos.empresa.id}
          empresa={{ nombre: datos.empresa.nombre || datos.empresa.email, nit: datos.empresa.nit }}
          comprobante={datos.comprobantes.find((c: any) => String(c.transaction_id) === String(detalle.id)) ?? null}
          onCerrar={() => setDetalle(null)}
        />
      )}

      {fichaAbierta && datos && datos.empresa.id === empresaSel && (
        <FichaEmpresaModal empresa={datos.empresa} onCerrar={() => setFichaAbierta(false)} />
      )}

      {dejar && (
        <ConfirmarModal
          titulo={`¿Dejar de trabajar con ${dejar.nombre}?`}
          texto={`Sales de su contabilidad y su facturación, y deja de aparecer en tu lista. La configuración de Siigo es de ${dejar.nombre} y queda guardada en su cuenta, igual que sus facturas: no se borra nada. La empresa recibe un aviso. Para volver, pides acceso otra vez con su ID.`}
          confirmar="Dejar la empresa"
          peligro
          ocupado={dejando}
          onConfirmar={dejarEmpresa}
          onCancelar={() => { if (!dejando) setDejar(null); }}
        />
      )}
      {confirmarSalir && (
        <ConfirmarModal
          titulo="¿Cerrar sesión?"
          texto="Para volver a entrar necesitarás tu correo y tu contraseña, o tu cuenta de Google."
          confirmar="Cerrar sesión"
          onConfirmar={() => { setConfirmarSalir(false); onLogout(); }}
          onCancelar={() => setConfirmarSalir(false)}
        />
      )}

      <style>{`
        .lincoin-sidebar-conta { height: 100vh; position: sticky; top: 0; }
        .lincoin-nav-item:focus-visible { outline: 2px solid rgba(74,222,128,0.5); outline-offset: 2px; }
        .conta-empresa { transition: border-color 150ms, background 150ms; }
        .conta-empresa:hover { border-color: rgba(255,255,255,0.16) !important; background: #121413 !important; }
        @media (max-width: 1023px) {
          .lincoin-sidebar-conta { position: fixed; inset: 0 auto 0 0; z-index: 30; transform: translateX(-100%); transition: transform 260ms ease; }
          .lincoin-sidebar-conta.abierta { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
};
