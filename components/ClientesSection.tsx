// ══════════════════════════════════════════════════════════════════
//  Clientes — los operadores de la empresa (clientes de nuestros clientes)
//
//  El cliente de una empresa abre una cuenta de operador en Lincoin (persona
//  natural o empresa), escribe el ID Lincoin de la empresa y manda sus datos,
//  sus documentos y el origen de sus fondos. Aquí la empresa lo ACEPTA como
//  su cliente (o lo rechaza); después el equipo de cumplimiento de Lincoin
//  revisa los documentos, le fija el tope mensual y lo aprueba. Ya aprobado,
//  la empresa le carga saldo desde aquí o deja de operar con él.
//
//  Cuatro vistas: Resumen (el tablero), Clientes (los aprobados, con su
//  ficha), Solicitudes (por aceptar y en revisión) y Movimientos (las cargas
//  y lo recibido de los clientes, con filtros y Excel).
//
//  Los vínculos viven en raw_data.personasAutorizadas / personasSolicitudes
//  de la empresa y los escribe solo el servidor (función `autorizaciones`).
//  La carga de saldo la hace la base de una sola vez (lincoin_cargar_cliente):
//  descuenta de la empresa, acredita al operador y deja un movimiento de
//  cada lado. Mueve plata, así que exige lo mismo que Enviar: 2FA.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Trash2, X, Wallet, ArrowUpRight, ArrowDownLeft, Copy, Check, Clock, ShieldCheck, Image as ImageIcon, Building2, User, Search, Download, ChevronRight, AlertTriangle, Users, LayoutGrid, Inbox, ListFilter } from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';
import { supabase } from '../lib/supabaseClient';
import { llamarFuncion } from '../lib/edge';
import { descargarXlsx } from '../lib/xlsx';
import { ConfirmarModal } from './ConfirmarModal';

const FONT = 'Archivo, system-ui, sans-serif';
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const C = {
  tarjeta: '#0C0E0D', elevado: '#121413', borde: 'rgba(255,255,255,0.08)', text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c',
  verde: '#4ADE80', rojo: '#F87171', naranja: '#FB923C',
  // Barras de los gráficos: el verde de la marca un paso más oscuro (el
  // #4ADE80 se sale de la banda de luminosidad sobre el carbón); al pasar
  // el puntero la barra sube al verde de la marca.
  serie: '#22A35C', grilla: 'rgba(255,255,255,0.06)',
};

export type PersonaVinculo = {
  id: string; email: string; nombre: string; docType: string; docNumber: string; at: string; codigo?: string; topeMensual?: number | null;
  tipoOperador?: 'persona' | 'empresa'; representante?: { nombre?: string; docType?: string; docNumber?: string };
  // 'empresa' = espera que la empresa lo acepte; 'cumplimiento' = ya lo aceptó.
  estado?: 'empresa' | 'cumplimiento'; aceptadaAt?: string;
  // Lo que lleva contra su tope este mes (lo calcula el servidor).
  usadoMes?: number;
};

const fmtCop = (v: number) => `$ ${Math.round(v).toLocaleString('es-CO')}`;
const compacto = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `$ ${(v / 1e9).toLocaleString('es-CO', { maximumFractionDigits: 1 })} mil M`;
  if (a >= 1e6) return `$ ${(v / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
  if (a >= 1e3) return `$ ${Math.round(v / 1e3).toLocaleString('es-CO')} mil`;
  return fmtCop(v);
};
const soloDigitos = (s: string) => s.replace(/[^\d]/g, '');
const fmtEntrada = (s: string) => { const d = soloDigitos(s); return d ? Number(d).toLocaleString('es-CO') : ''; };
const fecha = (ts: any) => { const d = new Date(ts ?? 0); return isNaN(d.getTime()) || !ts ? '' : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const fechaCorta = (ts: any) => fecha(ts).split(',')[0];
const DOCS: Record<string, string> = { CC: 'Cédula', CE: 'Cédula de extranjería', PAS: 'Pasaporte', PPT: 'PPT', NIT: 'NIT' };
const doc = (p: PersonaVinculo) => `${DOCS[p.docType] ?? p.docType} ${p.docNumber}`.trim();
const esEmpresa = (p: PersonaVinculo) => p.tipoOperador === 'empresa' || p.docType === 'NIT';

// Campos del movimiento: vienen arriba o en raw_data según quién lo mapeó.
const ms = (ts: any) => { const n = new Date(ts ?? 0).getTime(); return isNaN(n) ? 0 : n; };
const cpId = (t: any) => String(t.counterpartyId ?? t.raw_data?.counterpartyId ?? '');
const cpNombre = (t: any) => String(t.counterpartyName ?? t.raw_data?.counterpartyName ?? t.senderName ?? t.beneficiaryName ?? 'Cliente');
const cpCodigo = (t: any) => String(t.counterpartyCode ?? t.raw_data?.counterpartyCode ?? '');
const notaDe = (t: any) => String(t.note ?? t.raw_data?.note ?? '');
const sale = (t: any) => t.type === 'pay_sent';
const inicioDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const inicioMes = (delta = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + delta, 1).getTime(); };
const DIA = 86_400_000;
const diaIso = (n: number) => { const d = new Date(n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const desdeIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return y ? new Date(y, (m || 1) - 1, d || 1).getTime() : NaN; };

// Persona natural o empresa: lo eligió el cliente al registrarse.
const TipoChip: React.FC<{ p: PersonaVinculo }> = ({ p }) => {
  const emp = esEmpresa(p);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 800, letterSpacing: '1px', color: C.sub, border: `1px solid ${C.borde}`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>
      {emp ? <Building2 size={10} /> : <User size={10} />} {emp ? 'EMPRESA' : 'PERSONA'}
    </span>
  );
};
const Rotulo: React.FC<{ children: React.ReactNode }> = ({ children }) => <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>{children}</p>;
const Modal: React.FC<{ onCerrar: () => void; ancho?: number; children: React.ReactNode }> = ({ onCerrar, ancho = 440, children }) => (
  <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
    <div onClick={e => e.stopPropagation()} style={{ fontFamily: FONT, width: '100%', maxWidth: ancho, background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 16, padding: 22, maxHeight: '92vh', overflowY: 'auto' }}>{children}</div>
  </div>
);
const Tarjeta: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <section style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 14, overflow: 'hidden', ...style }}>{children}</section>
);
const Cabecera: React.FC<{ titulo: React.ReactNode; children?: React.ReactNode }> = ({ titulo, children }) => (
  <div className="flex items-center justify-between flex-wrap" style={{ gap: 8, padding: '13px 18px', borderBottom: `1px solid ${C.borde}` }}>
    <Rotulo>{titulo}</Rotulo>
    {children}
  </div>
);

// Indicador: rótulo, cifra y una línea de contexto.
const Indicador: React.FC<{ rotulo: string; valor: React.ReactNode; pie?: React.ReactNode; alerta?: boolean; onClick?: () => void }> = ({ rotulo, valor, pie, alerta, onClick }) => (
  <button type="button" onClick={onClick} disabled={!onClick} style={{ fontFamily: FONT, textAlign: 'left', background: C.tarjeta, border: `1px solid ${alerta ? 'rgba(251,146,60,0.45)' : C.borde}`, borderRadius: 14, padding: '14px 16px', cursor: onClick ? 'pointer' : 'default', color: C.text, minWidth: 0 }}>
    <p style={{ fontSize: 12, fontWeight: 600, color: C.sub, margin: 0 }}>{rotulo}</p>
    <p style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', margin: '6px 0 0', color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{valor}</p>
    {pie && <p style={{ fontSize: 11.5, color: alerta ? C.naranja : C.tenue, margin: '4px 0 0', lineHeight: 1.4 }}>{pie}</p>}
  </button>
);

// Uso del tope mensual: el relleno lleva el estado (verde, naranja desde el
// 80 %, rojo al llegar) y la pista es el mismo color, más tenue.
const UsoTope: React.FC<{ usado: number; tope?: number | null; ancho?: number | string }> = ({ usado, tope, ancho = 150 }) => {
  if (!tope) return <span style={{ fontSize: 12, color: C.sub }}>{usado ? `${compacto(usado)} · sin tope` : 'Sin tope'}</span>;
  const pct = Math.max(0, (usado / tope) * 100);
  const [color, pista] = pct >= 100 ? [C.rojo, 'rgba(248,113,113,0.18)'] : pct >= 80 ? [C.naranja, 'rgba(251,146,60,0.18)'] : [C.serie, 'rgba(34,163,92,0.2)'];
  return (
    <div style={{ width: ancho, maxWidth: '100%' }} title={`${fmtCop(usado)} de ${fmtCop(tope)} este mes`}>
      <div className="flex items-center justify-between" style={{ gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{compacto(usado)} <span style={{ color: C.tenue, fontWeight: 500 }}>de {compacto(tope)}</span></span>
        <span style={{ fontSize: 11, fontWeight: 700, color: pct >= 80 ? color : C.sub, fontVariantNumeric: 'tabular-nums', display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>{pct >= 100 && <AlertTriangle size={11} />}{Math.round(pct)} %</span>
      </div>
      <div style={{ height: 6, background: pista, borderRadius: 999, marginTop: 5, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, minWidth: usado > 0 ? 3 : 0, height: '100%', background: color, borderRadius: 999 }} />
      </div>
    </div>
  );
};

// Cargas por día: una sola serie, columnas finas, eje con números redondos,
// el máximo rotulado y el resto en el tooltip (y en la vista de tabla).
const GraficoCargas: React.FC<{ dias: { t: number; total: number; n: number }[] }> = ({ dias }) => {
  const [sobre, setSobre] = useState<number | null>(null);
  const [tabla, setTabla] = useState(false);
  const max = Math.max(0, ...dias.map(d => d.total));
  const paso = (() => { if (max <= 0) return 1; const bruto = max / 3; const p = 10 ** Math.floor(Math.log10(bruto)); return [1, 2, 2.5, 5, 10].map(k => k * p).find(k => k >= bruto) ?? 10 * p; })();
  const tope = Math.max(paso, Math.ceil(max / paso) * paso);
  const marcas = Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso);
  const iMax = dias.findIndex(d => d.total === max && max > 0);
  const total = dias.reduce((s, d) => s + d.total, 0);
  const n = dias.reduce((s, d) => s + d.n, 0);
  const ALTO = 150;
  const diaTxt = (t: number) => { const d = new Date(t); return `${d.getDate()} ${d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '')}`; };
  return (
    <Tarjeta>
      <Cabecera titulo="CARGAS POR DÍA · ÚLTIMOS 30 DÍAS">
        <div className="flex items-center" style={{ gap: 10 }}>
          <span style={{ fontSize: 12, color: C.sub }}><b style={{ color: C.text }}>{fmtCop(total)}</b> en {n} {n === 1 ? 'carga' : 'cargas'}</span>
          <button type="button" onClick={() => setTabla(v => !v)} style={{ fontFamily: FONT, fontSize: 11.5, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 8, padding: '4px 9px', cursor: 'pointer' }}>{tabla ? 'Ver gráfico' : 'Ver tabla'}</button>
        </div>
      </Cabecera>
      {n === 0 ? (
        <p style={{ fontSize: 12.5, color: C.tenue, padding: '28px 18px', margin: 0 }}>No hay cargas en los últimos 30 días.</p>
      ) : tabla ? (
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['DÍA', 'CARGAS', 'MONTO'].map((h, i) => <th key={h} style={{ textAlign: i ? 'right' : 'left', padding: '8px 18px', fontSize: 10, fontWeight: 800, letterSpacing: '1px', color: C.sub, borderBottom: `1px solid ${C.borde}` }}>{h}</th>)}</tr></thead>
            <tbody>
              {dias.filter(d => d.n > 0).reverse().map(d => (
                <tr key={d.t}>
                  <td style={{ padding: '8px 18px', fontSize: 12.5, color: C.text, borderBottom: `1px solid ${C.borde}` }}>{diaTxt(d.t)}</td>
                  <td style={{ padding: '8px 18px', fontSize: 12.5, color: C.sub, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}` }}>{d.n}</td>
                  <td style={{ padding: '8px 18px', fontSize: 12.5, fontWeight: 700, color: C.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.borde}` }}>{fmtCop(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: '18px 18px 12px', display: 'flex', gap: 10 }}>
          {/* Eje Y */}
          <div style={{ position: 'relative', width: 52, height: ALTO, flexShrink: 0 }}>
            {marcas.map(m => <span key={m} style={{ position: 'absolute', right: 0, bottom: (m / tope) * ALTO - 7, fontSize: 10.5, color: C.tenue, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{m === 0 ? '0' : compacto(m).replace('$ ', '')}</span>)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ position: 'relative', height: ALTO }} onMouseLeave={() => setSobre(null)}>
              {marcas.map(m => <div key={m} style={{ position: 'absolute', left: 0, right: 0, bottom: (m / tope) * ALTO, height: 1, background: m === 0 ? 'rgba(255,255,255,0.14)' : C.grilla }} />)}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
                {dias.map((d, i) => {
                  const h = d.total > 0 ? Math.max(3, (d.total / tope) * ALTO) : 0;
                  const activo = sobre === i;
                  return (
                    <button key={d.t} type="button" aria-label={`${diaTxt(d.t)}: ${fmtCop(d.total)} en ${d.n} ${d.n === 1 ? 'carga' : 'cargas'}`}
                      onMouseEnter={() => setSobre(i)} onFocus={() => setSobre(i)} onBlur={() => setSobre(null)}
                      style={{ flex: 1, minWidth: 0, height: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'default', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', position: 'relative' }}>
                      <span style={{ display: 'block', width: '70%', maxWidth: 24, height: h, background: activo ? C.verde : C.serie, borderRadius: '4px 4px 0 0' }} />
                      {i === iMax && !activo && <span style={{ position: 'absolute', bottom: h + 4, left: '50%', transform: 'translateX(-50%)', fontSize: 10.5, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{compacto(d.total)}</span>}
                    </button>
                  );
                })}
              </div>
              {sobre != null && (() => {
                const d = dias[sobre];
                const izq = ((sobre + 0.5) / dias.length) * 100;
                // Encima de la barra; si la barra es alta, se monta sobre ella
                // sin salirse del área del gráfico.
                const h = d.total > 0 ? Math.max(3, (d.total / tope) * ALTO) : 0;
                return (
                  <div role="status" style={{ position: 'absolute', bottom: Math.min(h + 8, ALTO - 50), left: `${izq}%`, transform: `translateX(${izq > 75 ? '-100%' : izq < 25 ? '0' : '-50%'})`, background: C.elevado, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: '8px 11px', pointerEvents: 'none', whiteSpace: 'nowrap', boxShadow: '0 8px 24px rgba(0,0,0,0.45)', zIndex: 2 }}>
                    <p style={{ fontSize: 13.5, fontWeight: 800, color: C.text, margin: 0 }}>{fmtCop(d.total)}</p>
                    <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0' }}>{diaTxt(d.t)} · {d.n} {d.n === 1 ? 'carga' : 'cargas'}</p>
                  </div>
                );
              })()}
            </div>
            {/* Eje X: una fecha cada semana, y hoy */}
            <div style={{ position: 'relative', height: 18, marginTop: 6 }}>
              {dias.map((d, i) => ((i % 7 === 0 && i <= dias.length - 5) || i === dias.length - 1) && (
                <span key={d.t} style={{ position: 'absolute', left: `${((i + 0.5) / dias.length) * 100}%`, transform: `translateX(${i === dias.length - 1 ? '-80%' : i === 0 ? '-20%' : '-50%'})`, fontSize: 10.5, color: C.tenue, whiteSpace: 'nowrap' }}>{i === dias.length - 1 ? 'Hoy' : diaTxt(d.t)}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </Tarjeta>
  );
};

type Vista = 'resumen' | 'clientes' | 'solicitudes' | 'movimientos';
type Periodo = 'hoy' | '7d' | '30d' | 'mes' | 'mesAnt' | 'todo' | 'rango';
const PERIODOS: [Periodo, string][] = [['todo', 'Todo'], ['hoy', 'Hoy'], ['7d', '7 días'], ['30d', '30 días'], ['mes', 'Este mes'], ['mesAnt', 'Mes anterior'], ['rango', 'Fechas…']];
const CLAVE_VISTA = 'lincoin.clientes.vista';

type Props = {
  showToast: (msg: string, ms?: number, tipo?: 'success' | 'error') => void;
  handleActionRestricted: () => boolean;
  mfaEnrolled: boolean;
  irAjustes: () => void;
  onVerMovimiento?: (tx: any) => void;
};

export const ClientesSection: React.FC<Props> = ({ showToast, handleActionRestricted, mfaEnrolled, irAjustes, onVerMovimiento }) => {
  const { currentUser, transactions, refreshData, verificarCodigo2fa } = useDatabase();
  const cu: any = currentUser ?? {};
  const disponibleCop = ['COP', 'COP_BREB', 'COP_ACH'].reduce((s, k) => s + (Number(cu.balances?.[k]) || 0), 0);

  const [vista, setVistaEstado] = useState<Vista>(() => {
    try { const v = sessionStorage.getItem(CLAVE_VISTA); if (v === 'resumen' || v === 'clientes' || v === 'solicitudes' || v === 'movimientos') return v; } catch { /* */ }
    return 'resumen';
  });
  const setVista = (v: Vista) => { setVistaEstado(v); try { sessionStorage.setItem(CLAVE_VISTA, v); } catch { /* */ } };

  // ── Vínculos (los trae el servidor) ────────────────────────────────
  const [miId, setMiId] = useState('');
  const [autorizadas, setAutorizadas] = useState<PersonaVinculo[] | null>(null);
  const [solicitudes, setSolicitudes] = useState<PersonaVinculo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const aplicar = (r: any) => {
    // aceptar/rechazar/revocar devuelven las listas sin `codigo` ni el uso
    // del tope: conservamos lo que ya teníamos para no perderlos.
    setAutorizadas(prev => (r.autorizadas ?? []).map((a: PersonaVinculo) => {
      const antes = prev?.find(p => p.id === a.id);
      return { ...a, codigo: a.codigo || antes?.codigo || solicitudes.find(s => s.id === a.id)?.codigo || '', usadoMes: a.usadoMes ?? antes?.usadoMes };
    }));
    setSolicitudes(prev => (r.solicitudes ?? []).map((s: PersonaVinculo) => ({ ...s, codigo: s.codigo || prev.find(p => p.id === s.id)?.codigo || '' })));
    if (r.miId) setMiId(String(r.miId));
  };
  const cargar = async (silencioso = false) => {
    const r = await llamarFuncion('autorizaciones', { action: 'listar' }, 30000);
    if (!r?.ok) { if (!silencioso) { setError(r?.error ?? 'No se pudo consultar.'); setAutorizadas([]); } return; }
    setError(null); aplicar(r);
  };
  useEffect(() => { cargar(); }, []);
  // Las solicitudes nuevas aparecen solas, sin recargar la página.
  useEffect(() => { const t = setInterval(() => cargar(true), 20000); return () => clearInterval(t); }, []);

  const copiar = async () => { try { await navigator.clipboard.writeText(miId); setCopiado(true); setTimeout(() => setCopiado(false), 1800); } catch { /* */ } };

  const accion = async (action: 'rechazar' | 'revocar' | 'aceptar', p: PersonaVinculo, extra: Record<string, unknown> = {}) => {
    setOcupado(p.id); setError(null);
    const r = await llamarFuncion('autorizaciones', { action, personaId: p.id, ...extra }, 30000);
    setOcupado(null);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo.'); return false; }
    aplicar(r);
    return true;
  };

  // ── Ver la foto del cliente sosteniendo su documento ───────────────
  // Los documentos (cédula, RUT, cámara, declaración) y el origen de fondos
  // los revisa Cumplimiento; la empresa ve los datos y la foto.
  const [fotoDe, setFotoDe] = useState<PersonaVinculo | null>(null);
  const [foto, setFoto] = useState<string | null | 'cargando'>(null);
  const verFoto = async (p: PersonaVinculo) => {
    setFotoDe(p); setFoto('cargando');
    const r = await llamarFuncion('autorizaciones', { action: 'ver_foto', personaId: p.id }, 30000);
    setFoto(r?.ok && r.foto ? String(r.foto) : null);
  };

  // Aceptar = es mi cliente. El tope y la aprobación los pone Cumplimiento.
  const [aceptarA, setAceptarA] = useState<PersonaVinculo | null>(null);
  const porAceptar = solicitudes.filter(s => s.estado !== 'cumplimiento');
  const enRevision = solicitudes.filter(s => s.estado === 'cumplimiento');

  const [rechazarA, setRechazarA] = useState<PersonaVinculo | null>(null);
  const [revocarA, setRevocarA] = useState<PersonaVinculo | null>(null);

  // ── Movimientos con clientes ───────────────────────────────────────
  // Las cargas (pay_sent marcados psp) y lo que un cliente le envió a la
  // empresa (pay_received cuyo remitente es uno de sus clientes).
  const idsClientes = useMemo(() => new Set([...(autorizadas ?? []), ...solicitudes].map(p => p.id)), [autorizadas, solicitudes]);
  const movs = useMemo(() => (transactions ?? [])
    .filter((t: any) => t.userId === cu.id && (
      (t.type === 'pay_sent' && (t.psp || t.raw_data?.psp)) ||
      (t.type === 'pay_received' && idsClientes.has(cpId(t)))))
    .sort((a: any, b: any) => ms(b.createdAt) - ms(a.createdAt)), [transactions, cu.id, idsClientes]);
  const cargas = useMemo(() => movs.filter(sale), [movs]);
  const hechas = useMemo(() => cargas.filter((t: any) => t.status === 'Completado'), [cargas]);

  const iniMes = inicioMes(0), iniMesAnt = inicioMes(-1);
  const resumenPor = useMemo(() => {
    const m = new Map<string, { n: number; total: number; ultima: any; mes: number; nMes: number }>();
    for (const t of hechas) {
      const id = cpId(t); const r = m.get(id) ?? { n: 0, total: 0, ultima: null, mes: 0, nMes: 0 };
      const v = Number(t.amount) || 0;
      r.n++; r.total += v; if (!r.ultima) r.ultima = t.createdAt;
      if (ms(t.createdAt) >= iniMes) { r.mes += v; r.nMes++; }
      m.set(id, r);
    }
    return (id: string) => m.get(id) ?? { n: 0, total: 0, ultima: null, mes: 0, nMes: 0 };
  }, [hechas, iniMes]);

  const delMes = hechas.filter((t: any) => ms(t.createdAt) >= iniMes);
  const delMesAnt = hechas.filter((t: any) => ms(t.createdAt) >= iniMesAnt && ms(t.createdAt) < iniMes);
  const sumar = (l: any[]) => l.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);
  const totalMes = sumar(delMes), totalMesAnt = sumar(delMesAnt);
  const activosMes = new Set(delMes.map(cpId)).size;
  const dias30 = useMemo(() => {
    const hoy = inicioDia(new Date());
    const ds = Array.from({ length: 30 }, (_, i) => ({ t: hoy - (29 - i) * DIA, total: 0, n: 0 }));
    for (const t of hechas) {
      const d = inicioDia(new Date(ms(t.createdAt)));
      const i = Math.round((d - ds[0].t) / DIA);
      if (i >= 0 && i < 30) { ds[i].total += Number(t.amount) || 0; ds[i].n++; }
    }
    return ds;
  }, [hechas]);
  const cercaDelTope = (autorizadas ?? []).filter(p => p.topeMensual && (p.usadoMes ?? 0) / p.topeMensual >= 0.8);

  // ── Ficha del cliente ──────────────────────────────────────────────
  const [fichaId, setFichaId] = useState<string | null>(null);
  const ficha = fichaId ? (autorizadas ?? []).find(p => p.id === fichaId) ?? null : null;

  // ── Clientes: búsqueda, filtros y orden ────────────────────────────
  const [cBusca, setCBusca] = useState('');
  const [cTipo, setCTipo] = useState<'todos' | 'persona' | 'empresa'>('todos');
  const [cFiltro, setCFiltro] = useState<'todos' | 'conCargas' | 'sinCargas' | 'tope'>('todos');
  const [cOrden, setCOrden] = useState<'reciente' | 'nombre' | 'cargadoMes' | 'ultima' | 'tope'>('reciente');
  const clientesFiltrados = useMemo(() => {
    const q = cBusca.trim().toLowerCase(); const qd = q.replace(/\D/g, '');
    const l = (autorizadas ?? []).filter(p => {
      if (cTipo !== 'todos' && (cTipo === 'empresa') !== esEmpresa(p)) return false;
      const r = resumenPor(p.id);
      if (cFiltro === 'conCargas' && !r.nMes) return false;
      if (cFiltro === 'sinCargas' && r.nMes) return false;
      if (cFiltro === 'tope' && !(p.topeMensual && (p.usadoMes ?? 0) / p.topeMensual >= 0.8)) return false;
      if (!q) return true;
      return `${p.nombre} ${p.email} ${p.codigo ?? ''} ${p.representante?.nombre ?? ''}`.toLowerCase().includes(q) || (qd.length >= 3 && p.docNumber.replace(/\D/g, '').includes(qd));
    });
    const uso = (p: PersonaVinculo) => p.topeMensual ? (p.usadoMes ?? 0) / p.topeMensual : -1;
    return [...l].sort((a, b) =>
      cOrden === 'nombre' ? a.nombre.localeCompare(b.nombre, 'es') :
      cOrden === 'cargadoMes' ? resumenPor(b.id).mes - resumenPor(a.id).mes :
      cOrden === 'ultima' ? ms(resumenPor(b.id).ultima) - ms(resumenPor(a.id).ultima) :
      cOrden === 'tope' ? uso(b) - uso(a) :
      ms(b.at) - ms(a.at));
  }, [autorizadas, cBusca, cTipo, cFiltro, cOrden, resumenPor]);

  const exportarClientes = () => {
    const filas: (string | number | Date | null)[][] = [['Cliente', 'Tipo', 'Documento', 'Correo', 'ID Lincoin', 'Cliente desde', 'Tope mensual', 'Usado del tope este mes', 'Cargado este mes', 'Cargas este mes', 'Cargado en total', 'Cargas en total', 'Última carga']];
    for (const p of clientesFiltrados) {
      const r = resumenPor(p.id);
      filas.push([p.nombre, esEmpresa(p) ? 'Empresa' : 'Persona', doc(p), p.email, p.codigo ?? '', p.at ? new Date(p.at) : null, p.topeMensual ?? 'Sin tope', p.usadoMes ?? 0, r.mes, r.nMes, r.total, r.n, r.ultima ? new Date(r.ultima) : null]);
    }
    descargarXlsx(`lincoin-clientes-${diaIso(Date.now())}.xlsx`, [{ nombre: 'Clientes', filas, anchos: [30, 10, 22, 28, 12, 14, 16, 18, 16, 10, 16, 10, 18] }]);
  };

  // ── Movimientos: filtros ───────────────────────────────────────────
  const [mBusca, setMBusca] = useState('');
  const [mPeriodo, setMPeriodo] = useState<Periodo>('todo');
  const [mDesde, setMDesde] = useState('');
  const [mHasta, setMHasta] = useState('');
  const [mCliente, setMCliente] = useState('');
  const [mTipo, setMTipo] = useState<'todos' | 'cargas' | 'recibidos'>('todos');
  const [mEstado, setMEstado] = useState('');
  const [mMin, setMMin] = useState('');
  const [mMax, setMMax] = useState('');
  const [mLimite, setMLimite] = useState(50);
  useEffect(() => { setMLimite(50); }, [mBusca, mPeriodo, mDesde, mHasta, mCliente, mTipo, mEstado, mMin, mMax]);
  const estados = useMemo(() => [...new Set(movs.map((t: any) => String(t.status ?? '')).filter(Boolean))], [movs]);
  const clientesEnMovs = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of autorizadas ?? []) m.set(p.id, p.nombre);
    for (const t of movs) { const id = cpId(t); if (id && !m.has(id)) m.set(id, cpNombre(t)); }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [movs, autorizadas]);
  const rango = useMemo((): [number, number] => {
    const hoy = inicioDia(new Date());
    switch (mPeriodo) {
      case 'hoy': return [hoy, Infinity];
      case '7d': return [hoy - 6 * DIA, Infinity];
      case '30d': return [hoy - 29 * DIA, Infinity];
      case 'mes': return [inicioMes(0), Infinity];
      case 'mesAnt': return [inicioMes(-1), inicioMes(0)];
      case 'rango': {
        const a = desdeIso(mDesde), b = desdeIso(mHasta);
        return [isNaN(a) ? -Infinity : a, isNaN(b) ? Infinity : b + DIA];
      }
      default: return [-Infinity, Infinity];
    }
  }, [mPeriodo, mDesde, mHasta]);
  const movsFiltrados = useMemo(() => {
    const q = mBusca.trim().toLowerCase(); const qd = q.replace(/\D/g, '');
    const min = Number(soloDigitos(mMin)) || 0, max = Number(soloDigitos(mMax)) || Infinity;
    return movs.filter((t: any) => {
      const f = ms(t.createdAt); if (f < rango[0] || f >= rango[1]) return false;
      if (mCliente && cpId(t) !== mCliente) return false;
      if (mTipo === 'cargas' && !sale(t)) return false;
      if (mTipo === 'recibidos' && sale(t)) return false;
      if (mEstado && t.status !== mEstado) return false;
      const v = Number(t.amount) || 0; if (v < min || v > max) return false;
      if (!q) return true;
      return `${cpNombre(t)} ${cpCodigo(t)} ${notaDe(t)} ${t.status ?? ''}`.toLowerCase().includes(q) || (qd.length >= 3 && String(Math.round(v)).includes(qd));
    });
  }, [movs, rango, mBusca, mCliente, mTipo, mEstado, mMin, mMax]);
  const filtrosActivos = !!(mBusca || mPeriodo !== 'todo' || mCliente || mTipo !== 'todos' || mEstado || mMin || mMax);
  const limpiarFiltros = () => { setMBusca(''); setMPeriodo('todo'); setMDesde(''); setMHasta(''); setMCliente(''); setMTipo('todos'); setMEstado(''); setMMin(''); setMMax(''); };
  const fCargado = sumar(movsFiltrados.filter((t: any) => sale(t) && t.status === 'Completado'));
  const fRecibido = sumar(movsFiltrados.filter((t: any) => !sale(t) && t.status === 'Completado'));
  const verMovimientosDe = (p: PersonaVinculo) => { limpiarFiltros(); setMCliente(p.id); setFichaId(null); setVista('movimientos'); };

  const exportarMovs = () => {
    const filas: (string | number | Date)[][] = [['Fecha', 'Cliente', 'ID Lincoin', 'Tipo', 'Nota', 'Estado', 'Monto (COP)', 'Id']];
    for (const t of movsFiltrados) filas.push([new Date(ms(t.createdAt)), cpNombre(t), cpCodigo(t), sale(t) ? 'Carga de saldo' : 'Recibido del cliente', notaDe(t), String(t.status ?? ''), (sale(t) ? -1 : 1) * (Number(t.amount) || 0), String(t.id)]);
    descargarXlsx(`lincoin-movimientos-clientes-${diaIso(Date.now())}.xlsx`, [{ nombre: 'Movimientos', filas, anchos: [18, 30, 12, 20, 30, 12, 16, 38] }]);
  };

  // ── Carga de saldo ─────────────────────────────────────────────────
  const [cargaPara, setCargaPara] = useState<PersonaVinculo | null>(null);
  const [monto, setMonto] = useState('');
  const [nota, setNota] = useState('');
  const [paso, setPaso] = useState<'monto' | 'codigo'>('monto');
  const [codigo2fa, setCodigo2fa] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const abrirCarga = (p: PersonaVinculo) => {
    if (handleActionRestricted()) return;
    if (!mfaEnrolled) { showToast('Para cargar saldo primero activa la verificación en dos pasos (2FA) en Ajustes → Seguridad.', 8000, 'error'); irAjustes(); return; }
    if (!p.codigo) { showToast('No se encontró el ID Lincoin de este cliente. Recarga la sección e intenta de nuevo.', 5000, 'error'); return; }
    setCargaPara(p); setMonto(''); setNota(''); setPaso('monto'); setCodigo2fa(''); setErrorCarga(null);
  };
  const montoNum = Number(soloDigitos(monto)) || 0;

  const confirmarMonto = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorCarga(null);
    if (montoNum < 1000) { setErrorCarga('El mínimo es $ 1.000 COP.'); return; }
    if (montoNum > disponibleCop) { setErrorCarga(`Tienes ${fmtCop(disponibleCop)} COP disponibles.`); return; }
    setPaso('codigo');
  };

  // Candado síncrono contra el doble toque: se marca antes de cualquier await
  // (el estado de React tarda un render y dos toques seguidos pasaban los dos).
  const ejecutarEnCursoRef = useRef(false);
  const ejecutar = async (e: React.FormEvent) => {
    e.preventDefault(); if (ejecutarEnCursoRef.current) return;
    ejecutarEnCursoRef.current = true;
    try { return await ejecutarUnaVez(e); } finally { ejecutarEnCursoRef.current = false; }
  };
  const ejecutarUnaVez = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cargaPara || enviando || codigo2fa.length !== 6) return;
    setEnviando(true); setErrorCarga(null);
    try {
      const v = await verificarCodigo2fa(codigo2fa);
      if (!v.ok) { setErrorCarga(v.motivo ?? 'Código incorrecto. Intenta de nuevo.'); setCodigo2fa(''); return; }
      const { data, error } = await supabase.rpc('lincoin_cargar_cliente', { p_codigo: cargaPara.codigo, p_monto: montoNum, p_nota: nota.trim() || null });
      if (error) {
        // "does not exist" no alcanza para decir que falta la función: la
        // versión vieja SÍ estaba y fallaba por dentro con "function
        // isfinite(numeric) does not exist", y se leía como si no existiera.
        const m = String(error.message ?? '');
        const code = String((error as any).code ?? '');
        setErrorCarga(code === 'PGRST202' || /could not find the function/i.test(m)
          ? 'La función de carga todavía no está en la base. Falta correr la migración 2026_personas_autorizadas.sql en Supabase.'
          : code === '42883' || /isfinite|cannot change column/i.test(m)
            ? 'La base tiene una versión vieja de la carga o de su candado de saldos. Corre de nuevo 2026_personas_autorizadas.sql en Supabase.'
            : m);
        return;
      }
      if (data?.error) { setErrorCarga(String(data.error) + (data.disponible != null ? ` (disponible: ${fmtCop(Number(data.disponible))})` : '')); return; }
      showToast(`Listo: ${fmtCop(montoNum)} COP cargados a ${data?.cliente_nombre ?? cargaPara.nombre}.`, 5000, 'success');
      setCargaPara(null);
      refreshData().catch(() => {});
    } finally { setEnviando(false); }
  };

  const campo: React.CSSProperties = { fontFamily: FONT, width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, color: C.text, borderRadius: 9, padding: '10px 12px', fontSize: 13.5, outline: 'none' };
  const control: React.CSSProperties = { ...campo, width: 'auto', padding: '8px 10px', fontSize: 12.5, colorScheme: 'dark' };
  const botonSec: React.CSSProperties = { fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '8px 12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };
  const botonPri: React.CSSProperties = { fontFamily: FONT, fontWeight: 700, fontSize: 12.5, padding: '8px 12px', borderRadius: 9, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };
  const celda: React.CSSProperties = { padding: '11px 18px', borderBottom: `1px solid ${C.borde}` };
  const th = (h: string, i: number, derecha = false) => <th key={i} style={{ textAlign: derecha ? 'right' : 'left', padding: '9px 18px', fontSize: 10, fontWeight: 800, letterSpacing: '1px', color: C.sub, borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }}>{h}</th>;
  const chip = (activo: boolean): React.CSSProperties => ({ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: activo ? '#0A0A0A' : C.sub, background: activo ? C.text : 'transparent', border: `1px solid ${activo ? C.text : C.borde}`, borderRadius: 999, padding: '6px 11px', cursor: 'pointer', whiteSpace: 'nowrap' });
  const buscador = (valor: string, set: (v: string) => void, ph: string) => (
    <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180, maxWidth: 360 }}>
      <Search size={14} color={C.tenue} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
      <input value={valor} onChange={e => set(e.target.value)} placeholder={ph} style={{ ...campo, padding: '8px 10px 8px 32px', fontSize: 12.5 }} />
    </div>
  );

  // Una fila de movimiento (Resumen, Movimientos y la ficha).
  const filaMov = (t: any, conCliente = true) => (
    <div key={t.id} onClick={() => onVerMovimiento?.(t)} className="flex items-center lincoin-fila-mov" style={{ gap: 12, padding: '11px 18px', borderBottom: `1px solid ${C.borde}`, cursor: onVerMovimiento ? 'pointer' : 'default' }}>
      <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{sale(t) ? <ArrowUpRight size={15} color={C.text} /> : <ArrowDownLeft size={15} color={C.verde} />}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conCliente ? cpNombre(t) : (sale(t) ? 'Carga de saldo' : 'Te envió')} {conCliente && <span style={{ color: C.tenue, fontWeight: 500, fontFamily: MONO, fontSize: 11.5 }}>{cpCodigo(t)}</span>}</p>
        <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fecha(t.createdAt)}{conCliente && !sale(t) ? ' · te envió' : ''}{notaDe(t) ? ` · ${notaDe(t)}` : ''}{t.status !== 'Completado' ? ` · ${t.status}` : ''}</p>
      </div>
      <p style={{ fontSize: 13.5, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: sale(t) ? C.text : C.verde }}>{sale(t) ? '−' : '+'}{fmtCop(Number(t.amount) || 0)}</p>
    </div>
  );

  const pestanas: { v: Vista; txt: string; icono: React.ElementType; n?: number; alerta?: boolean }[] = [
    { v: 'resumen', txt: 'Resumen', icono: LayoutGrid },
    { v: 'clientes', txt: 'Clientes', icono: Users, n: autorizadas?.length || undefined },
    { v: 'solicitudes', txt: 'Solicitudes', icono: Inbox, n: porAceptar.length || enRevision.length || undefined, alerta: porAceptar.length > 0 },
    { v: 'movimientos', txt: 'Movimientos', icono: ListFilter },
  ];
  const sinClientes = autorizadas != null && autorizadas.length === 0 && solicitudes.length === 0;

  // ── Vistas ─────────────────────────────────────────────────────────
  const vistaResumen = (
    <>
      {sinClientes ? (
        <Tarjeta style={{ padding: '20px 20px 22px' }}>
          <p style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0, letterSpacing: '-0.3px' }}>Así empiezas a operar con tus clientes</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 14 }}>
            {[
              ['1', 'Comparte tu ID', `Tu cliente abre su cuenta de operador en Lincoin y escribe tu ID${miId ? ` (${miId})` : ''}.`],
              ['2', 'Acéptalo', 'Su solicitud llega a Solicitudes con sus datos y su foto. Si es tu cliente, lo aceptas.'],
              ['3', 'Cumplimiento lo aprueba', 'El equipo de cumplimiento de Lincoin revisa sus documentos y le fija el tope mensual.'],
              ['4', 'Cárgale saldo', 'Ya aprobado, le cargas pesos desde Clientes, con tu código 2FA.'],
            ].map(([n, t, d]) => (
              <div key={n} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.borde}`, borderRadius: 12, padding: '12px 14px' }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: C.sub, fontFamily: MONO }}>{n}</span>
                <p style={{ fontSize: 13.5, fontWeight: 800, color: C.text, margin: '6px 0 0' }}>{t}</p>
                <p style={{ fontSize: 12, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>{d}</p>
              </div>
            ))}
          </div>
        </Tarjeta>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <Indicador rotulo="Clientes aprobados" valor={autorizadas == null ? '…' : autorizadas.length} pie={enRevision.length ? `${enRevision.length} en revisión de Cumplimiento` : 'Pueden recibir carga de saldo'} onClick={() => setVista('clientes')} />
            <Indicador rotulo="Solicitudes por aceptar" valor={porAceptar.length} alerta={porAceptar.length > 0} pie={porAceptar.length ? 'Revísalas y acéptalas o recházalas' : 'Ninguna pendiente'} onClick={() => setVista('solicitudes')} />
            <Indicador rotulo="Cargado este mes" valor={compacto(totalMes)} pie={`${delMes.length} ${delMes.length === 1 ? 'carga' : 'cargas'} · mes anterior ${compacto(totalMesAnt)}`} onClick={() => { limpiarFiltros(); setMPeriodo('mes'); setMTipo('cargas'); setVista('movimientos'); }} />
            <Indicador rotulo="Clientes con carga este mes" valor={`${activosMes}${autorizadas?.length ? ` de ${autorizadas.length}` : ''}`} pie={delMes.length ? `Promedio por carga ${compacto(totalMes / delMes.length)}` : 'Aún no cargas este mes'} />
          </div>

          <GraficoCargas dias={dias30} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <Tarjeta>
              <Cabecera titulo="REQUIERE TU ATENCIÓN" />
              {porAceptar.length === 0 && cercaDelTope.length === 0 && enRevision.length === 0 ? (
                <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0 }}>Todo al día. No hay solicitudes ni clientes cerca de su tope.</p>
              ) : (
                <div>
                  {porAceptar.slice(0, 4).map(p => (
                    <div key={p.id} className="flex items-center justify-between" style={{ gap: 10, padding: '11px 18px', borderBottom: `1px solid ${C.borde}` }}>
                      <div style={{ minWidth: 0 }}>
                        <p className="flex items-center" style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: 0, gap: 6 }}><Clock size={13} color={C.naranja} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span></p>
                        <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0' }}>Pide operar contigo{p.at ? ` · ${fechaCorta(p.at)}` : ''}</p>
                      </div>
                      <button onClick={() => setVista('solicitudes')} style={botonSec}>Revisar</button>
                    </div>
                  ))}
                  {porAceptar.length > 4 && <button onClick={() => setVista('solicitudes')} style={{ ...botonSec, border: 'none', background: 'transparent', color: C.sub, padding: '10px 18px' }}>Ver las {porAceptar.length} solicitudes <ChevronRight size={13} /></button>}
                  {cercaDelTope.slice(0, 4).map(p => (
                    <div key={p.id} className="flex items-center justify-between" style={{ gap: 10, padding: '11px 18px', borderBottom: `1px solid ${C.borde}` }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p className="flex items-center" style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: 0, gap: 6 }}><AlertTriangle size={13} color={C.naranja} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span></p>
                        <div style={{ marginTop: 6 }}><UsoTope usado={p.usadoMes ?? 0} tope={p.topeMensual} ancho={220} /></div>
                      </div>
                      <button onClick={() => setFichaId(p.id)} style={botonSec}>Ver</button>
                    </div>
                  ))}
                  {enRevision.length > 0 && (
                    <button onClick={() => setVista('solicitudes')} className="flex items-center justify-between lincoin-fila-mov" style={{ fontFamily: FONT, width: '100%', gap: 10, padding: '11px 18px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                      <span className="flex items-center" style={{ fontSize: 12.5, color: C.sub, gap: 6 }}><ShieldCheck size={13} /> {enRevision.length} {enRevision.length === 1 ? 'cliente' : 'clientes'} en revisión de Cumplimiento</span>
                      <ChevronRight size={14} color={C.tenue} />
                    </button>
                  )}
                </div>
              )}
            </Tarjeta>

            <Tarjeta>
              <Cabecera titulo="MÁS CARGADOS ESTE MES" />
              {(() => {
                const top = (autorizadas ?? []).map(p => ({ p, r: resumenPor(p.id) })).filter(x => x.r.mes > 0).sort((a, b) => b.r.mes - a.r.mes).slice(0, 5);
                if (!top.length) return <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0 }}>Aún no has cargado saldo este mes.</p>;
                const tope = top[0].r.mes;
                return (
                  <div style={{ padding: '6px 0' }}>
                    {top.map(({ p, r }) => (
                      <button key={p.id} onClick={() => setFichaId(p.id)} className="lincoin-fila-mov" style={{ fontFamily: FONT, display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', padding: '9px 18px' }}>
                        <div className="flex items-center justify-between" style={{ gap: 10 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtCop(r.mes)} <span style={{ color: C.tenue, fontWeight: 500 }}>· {r.nMes}</span></span>
                        </div>
                        <div style={{ height: 8, marginTop: 6 }}>
                          <div style={{ width: `${Math.max(2, (r.mes / tope) * 100)}%`, height: '100%', background: C.serie, borderRadius: '0 4px 4px 0' }} />
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </Tarjeta>
          </div>

          <Tarjeta>
            <Cabecera titulo="ÚLTIMOS MOVIMIENTOS">
              {movs.length > 0 && <button onClick={() => { limpiarFiltros(); setVista('movimientos'); }} style={{ ...botonSec, padding: '5px 10px', fontSize: 12 }}>Ver todos <ChevronRight size={13} /></button>}
            </Cabecera>
            {movs.length === 0
              ? <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0 }}>Aún no hay movimientos con tus clientes.</p>
              : movs.slice(0, 6).map((t: any) => filaMov(t))}
          </Tarjeta>
        </>
      )}
    </>
  );

  const vistaClientes = (
    <Tarjeta>
      <div className="flex items-center flex-wrap" style={{ gap: 8, padding: '12px 18px', borderBottom: `1px solid ${C.borde}` }}>
        {buscador(cBusca, setCBusca, 'Buscar por nombre, ID, documento o correo')}
        <div className="flex items-center" style={{ gap: 4 }}>
          {([['todos', 'Todos'], ['persona', 'Personas'], ['empresa', 'Empresas']] as const).map(([v, t]) => <button key={v} onClick={() => setCTipo(v)} style={chip(cTipo === v)}>{t}</button>)}
        </div>
        <select value={cFiltro} onChange={e => setCFiltro(e.target.value as any)} style={control} aria-label="Filtrar clientes">
          <option value="todos">Todos los clientes</option>
          <option value="conCargas">Con cargas este mes</option>
          <option value="sinCargas">Sin cargas este mes</option>
          <option value="tope">Cerca de su tope (80 %+)</option>
        </select>
        <select value={cOrden} onChange={e => setCOrden(e.target.value as any)} style={control} aria-label="Ordenar clientes">
          <option value="reciente">Más recientes</option>
          <option value="nombre">Nombre (A–Z)</option>
          <option value="cargadoMes">Más cargados este mes</option>
          <option value="ultima">Última carga</option>
          <option value="tope">Más uso del tope</option>
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={exportarClientes} disabled={!clientesFiltrados.length} style={{ ...botonSec, opacity: clientesFiltrados.length ? 1 : 0.5 }}><Download size={13} /> Excel</button>
      </div>
      {autorizadas == null ? (
        <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0 }}>Consultando…</p>
      ) : autorizadas.length === 0 ? (
        <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0, lineHeight: 1.5 }}>Todavía no tienes clientes aprobados. Comparte tu ID con tus clientes para que te pidan autorización{solicitudes.length ? '; las que ya llegaron están en Solicitudes' : ''}.</p>
      ) : clientesFiltrados.length === 0 ? (
        <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0 }}>Ningún cliente coincide con la búsqueda o el filtro.</p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
              <thead><tr>{th('CLIENTE', 0)}{th('ID', 1)}{th('TOPE DEL MES', 2)}{th('CARGADO ESTE MES', 3, true)}{th('ÚLTIMA CARGA', 4)}{th('', 5)}</tr></thead>
              <tbody>
                {clientesFiltrados.map(p => {
                  const r = resumenPor(p.id);
                  return (
                    <tr key={p.id} className="lincoin-fila-mov" onClick={() => setFichaId(p.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ ...celda, maxWidth: 340 }}>
                        <p className="flex items-center" style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: C.text, gap: 6, whiteSpace: 'nowrap' }}><ShieldCheck size={13} color={C.verde} style={{ flexShrink: 0 }} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nombre}</span> <TipoChip p={p} /></p>
                        <p style={{ fontSize: 11.5, color: C.sub, margin: '3px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc(p)} · {p.email}</p>
                      </td>
                      <td style={{ ...celda, fontFamily: MONO, letterSpacing: '1px', fontSize: 12.5, color: C.text }}>{p.codigo || '—'}</td>
                      <td style={celda} title="Lo fija el equipo de cumplimiento de Lincoin. Cuenta los envíos del cliente a banco y Bre-B del mes."><UsoTope usado={p.usadoMes ?? 0} tope={p.topeMensual} /></td>
                      <td style={{ ...celda, fontSize: 13, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.text, whiteSpace: 'nowrap' }}>{r.mes ? fmtCop(r.mes) : '—'}<span style={{ fontSize: 11, color: C.tenue, fontWeight: 500 }}>{r.nMes ? ` · ${r.nMes}` : ''}</span></td>
                      <td style={{ ...celda, fontSize: 12, color: C.sub, whiteSpace: 'nowrap' }}>{r.ultima ? fechaCorta(r.ultima) : '—'}</td>
                      <td style={{ ...celda, whiteSpace: 'nowrap', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end" style={{ gap: 6 }}>
                          <button onClick={() => verFoto(p)} title="Ver foto" aria-label={`Ver foto de ${p.nombre}`} style={{ ...botonSec, padding: '7px 9px', color: C.sub }}><ImageIcon size={13} /></button>
                          <button onClick={() => abrirCarga(p)} className="lincoin-btn-white" style={{ ...botonPri, fontSize: 12, padding: '7px 12px' }}><Wallet size={12} /> Cargar saldo</button>
                          <button onClick={() => setFichaId(p.id)} title="Ver ficha" aria-label={`Ver ficha de ${p.nombre}`} style={{ ...botonSec, padding: '7px 9px', color: C.sub }}><ChevronRight size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11.5, color: C.tenue, margin: 0, padding: '10px 18px' }}>{clientesFiltrados.length === autorizadas.length ? `${autorizadas.length} ${autorizadas.length === 1 ? 'cliente' : 'clientes'}` : `${clientesFiltrados.length} de ${autorizadas.length} clientes`}</p>
        </>
      )}
    </Tarjeta>
  );

  const vistaSolicitudes = (
    <>
      <p style={{ fontSize: 12.5, color: C.sub, margin: 0, lineHeight: 1.55, maxWidth: 760 }}>
        Tus clientes (personas o empresas) abren una cuenta de <b style={{ color: C.text }}>operador</b> en Lincoin, escriben tu ID y mandan sus datos y sus documentos. Tú los <b style={{ color: C.text }}>aceptas</b> como clientes; después el equipo de cumplimiento de Lincoin revisa los documentos, fija el tope mensual y los aprueba.
      </p>
      <Tarjeta>
        <Cabecera titulo="POR ACEPTAR">
          {porAceptar.length > 0 && <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1px', color: C.naranja, border: '1px solid rgba(251,146,60,0.4)', borderRadius: 999, padding: '3px 9px' }}>{porAceptar.length}</span>}
        </Cabecera>
        {autorizadas == null ? (
          <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0 }}>Consultando…</p>
        ) : porAceptar.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0, lineHeight: 1.5 }}>Ninguna. Cuando un cliente escriba tu ID desde su portal de operador, aparece aquí para que lo aceptes.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {porAceptar.map(p => (
              <div key={p.id} className="flex items-center justify-between flex-wrap" style={{ gap: 10, padding: '12px 18px', borderBottom: `1px solid ${C.borde}` }}>
                <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                  <p className="flex items-center" style={{ fontSize: 14, fontWeight: 800, color: C.text, margin: 0, gap: 6 }}><Clock size={13} color={C.naranja} /> {p.nombre} <TipoChip p={p} /></p>
                  <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0' }}>{doc(p)} · {p.email}</p>
                  {p.representante?.nombre && <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0' }}>Representante legal: {p.representante.nombre}</p>}
                  <p style={{ fontSize: 11.5, color: C.tenue, margin: '2px 0 0' }}>ID <span style={{ fontFamily: MONO, letterSpacing: '1px', color: C.sub }}>{p.codigo || '—'}</span>{p.at ? ` · pidió el ${fecha(p.at)}` : ''}</p>
                </div>
                <div className="flex items-center flex-wrap" style={{ gap: 6 }}>
                  <button onClick={() => verFoto(p)} style={botonSec}><ImageIcon size={13} /> Ver foto</button>
                  <button onClick={() => setRechazarA(p)} disabled={ocupado === p.id} style={{ ...botonSec, color: C.sub }}>Rechazar</button>
                  <button onClick={() => setAceptarA(p)} disabled={ocupado === p.id} className="lincoin-btn-white" style={{ ...botonPri, opacity: ocupado === p.id ? 0.6 : 1 }}><Check size={13} /> {ocupado === p.id ? '…' : 'Aceptar'}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>

      <Tarjeta>
        <Cabecera titulo="EN REVISIÓN DE CUMPLIMIENTO"><span style={{ fontSize: 11.5, color: C.tenue }}>{enRevision.length || ''}</span></Cabecera>
        {enRevision.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0 }}>Ninguno. Los clientes que aceptes esperan aquí la aprobación de Cumplimiento.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {enRevision.map(p => (
              <div key={p.id} className="flex items-center justify-between flex-wrap" style={{ gap: 10, padding: '12px 18px', borderBottom: `1px solid ${C.borde}` }}>
                <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                  <p className="flex items-center" style={{ fontSize: 14, fontWeight: 800, color: C.text, margin: 0, gap: 6 }}>{p.nombre} <TipoChip p={p} /></p>
                  <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0' }}>{doc(p)} · {p.email}</p>
                  <p style={{ fontSize: 11.5, color: C.tenue, margin: '2px 0 0' }}>Aceptado{p.aceptadaAt ? ` el ${fecha(p.aceptadaAt)}` : ''} · Cumplimiento revisa sus documentos y fija su tope; te avisamos cuando lo apruebe.</p>
                </div>
                <div className="flex items-center flex-wrap" style={{ gap: 6 }}>
                  <button onClick={() => verFoto(p)} style={botonSec}><ImageIcon size={13} /> Ver foto</button>
                  <button onClick={() => setRechazarA(p)} disabled={ocupado === p.id} style={{ ...botonSec, color: C.sub }}>Ya no es mi cliente</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>
    </>
  );

  const vistaMovimientos = (
    <>
      {/* Filtros: una fila arriba de todo lo que acotan; el período primero. */}
      <Tarjeta style={{ overflow: 'visible' }}>
        <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="flex items-center flex-wrap" style={{ gap: 4 }}>
            {PERIODOS.map(([v, t]) => <button key={v} onClick={() => setMPeriodo(v)} style={chip(mPeriodo === v)}>{t}</button>)}
            {mPeriodo === 'rango' && (
              <span className="flex items-center flex-wrap" style={{ gap: 6, marginLeft: 4 }}>
                <input type="date" value={mDesde} max={mHasta || undefined} onChange={e => setMDesde(e.target.value)} style={control} aria-label="Desde" />
                <span style={{ fontSize: 12, color: C.tenue }}>a</span>
                <input type="date" value={mHasta} min={mDesde || undefined} onChange={e => setMHasta(e.target.value)} style={control} aria-label="Hasta" />
              </span>
            )}
          </div>
          <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
            {buscador(mBusca, setMBusca, 'Buscar por cliente, ID, nota o monto')}
            <select value={mCliente} onChange={e => setMCliente(e.target.value)} style={{ ...control, maxWidth: 240 }} aria-label="Cliente">
              <option value="">Todos los clientes</option>
              {clientesEnMovs.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
            <select value={mTipo} onChange={e => setMTipo(e.target.value as any)} style={control} aria-label="Tipo">
              <option value="todos">Cargas y recibidos</option>
              <option value="cargas">Cargas de saldo</option>
              <option value="recibidos">Recibido de clientes</option>
            </select>
            {estados.length > 1 && (
              <select value={mEstado} onChange={e => setMEstado(e.target.value)} style={control} aria-label="Estado">
                <option value="">Todos los estados</option>
                {estados.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <span className="flex items-center" style={{ gap: 6 }}>
              <input value={fmtEntrada(mMin)} onChange={e => setMMin(soloDigitos(e.target.value))} inputMode="numeric" placeholder="Monto mín." aria-label="Monto mínimo" style={{ ...control, width: 110 }} />
              <span style={{ fontSize: 12, color: C.tenue }}>–</span>
              <input value={fmtEntrada(mMax)} onChange={e => setMMax(soloDigitos(e.target.value))} inputMode="numeric" placeholder="Monto máx." aria-label="Monto máximo" style={{ ...control, width: 110 }} />
            </span>
            {filtrosActivos && <button onClick={limpiarFiltros} style={{ ...botonSec, background: 'transparent', color: C.sub }}><X size={13} /> Limpiar</button>}
          </div>
        </div>
      </Tarjeta>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Indicador rotulo="Movimientos" valor={movsFiltrados.length} pie={filtrosActivos ? `de ${movs.length} en total` : 'Todos los registrados'} />
        <Indicador rotulo="Cargado a clientes" valor={compacto(fCargado)} pie={`${movsFiltrados.filter((t: any) => sale(t) && t.status === 'Completado').length} cargas completadas`} />
        <Indicador rotulo="Recibido de clientes" valor={compacto(fRecibido)} pie={`${movsFiltrados.filter((t: any) => !sale(t) && t.status === 'Completado').length} envíos recibidos`} />
      </div>

      <Tarjeta>
        <Cabecera titulo="MOVIMIENTOS CON CLIENTES">
          <button onClick={exportarMovs} disabled={!movsFiltrados.length} style={{ ...botonSec, padding: '5px 10px', fontSize: 12, opacity: movsFiltrados.length ? 1 : 0.5 }}><Download size={13} /> Excel</button>
        </Cabecera>
        {movsFiltrados.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0 }}>{movs.length ? 'Ningún movimiento coincide con los filtros.' : 'Aún no hay movimientos con tus clientes.'}</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead><tr>{th('FECHA', 0)}{th('CLIENTE', 1)}{th('TIPO', 2)}{th('NOTA', 3)}{th('ESTADO', 4)}{th('MONTO', 5, true)}</tr></thead>
                <tbody>
                  {movsFiltrados.slice(0, mLimite).map((t: any) => (
                    <tr key={t.id} className="lincoin-fila-mov" onClick={() => onVerMovimiento?.(t)} style={{ cursor: onVerMovimiento ? 'pointer' : 'default' }}>
                      <td style={{ ...celda, fontSize: 12, color: C.sub, whiteSpace: 'nowrap' }}>{fecha(t.createdAt)}</td>
                      <td style={celda}>
                        <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: C.text }}>{cpNombre(t)}</p>
                        <p style={{ fontSize: 11, color: C.tenue, margin: '1px 0 0', fontFamily: MONO, letterSpacing: '1px' }}>{cpCodigo(t)}</p>
                      </td>
                      <td style={{ ...celda, whiteSpace: 'nowrap' }}>
                        <span className="flex items-center" style={{ gap: 5, fontSize: 12, color: C.sub }}>{sale(t) ? <ArrowUpRight size={13} /> : <ArrowDownLeft size={13} color={C.verde} />} {sale(t) ? 'Carga de saldo' : 'Recibido'}</span>
                      </td>
                      <td style={{ ...celda, fontSize: 12, color: C.sub, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{notaDe(t) || '—'}</td>
                      <td style={{ ...celda, fontSize: 12, color: t.status === 'Completado' ? C.sub : C.naranja, whiteSpace: 'nowrap' }}>{t.status}</td>
                      <td style={{ ...celda, fontSize: 13, fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: sale(t) ? C.text : C.verde }}>{sale(t) ? '−' : '+'}{fmtCop(Number(t.amount) || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between flex-wrap" style={{ gap: 8, padding: '10px 18px' }}>
              <span style={{ fontSize: 11.5, color: C.tenue }}>Mostrando {Math.min(mLimite, movsFiltrados.length)} de {movsFiltrados.length}</span>
              {movsFiltrados.length > mLimite && <button onClick={() => setMLimite(l => l + 50)} style={botonSec}>Ver 50 más</button>}
            </div>
          </>
        )}
      </Tarjeta>
    </>
  );

  return (
    <div style={{ fontFamily: FONT, maxWidth: 1180, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="flex items-end justify-between flex-wrap" style={{ gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: C.text, margin: 0 }}>Clientes</h2>
          <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5, maxWidth: 560 }}>Acepta a tus clientes, cárgales saldo en pesos y sigue sus movimientos.</p>
        </div>
        <div className="flex flex-wrap" style={{ gap: 10 }}>
          {/* El ID que la empresa le da a sus clientes. */}
          <div className="flex items-center" style={{ gap: 12, background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 12, padding: '10px 12px 10px 14px' }}>
            <div>
              <Rotulo>TU ID · DÁSELO A TUS CLIENTES</Rotulo>
              <p style={{ fontSize: 19, fontWeight: 700, letterSpacing: '3px', margin: '4px 0 0', color: C.text, fontFamily: MONO }}>{miId || '······'}</p>
            </div>
            <button onClick={copiar} disabled={!miId} aria-label="Copiar tu ID" style={{ ...botonSec, padding: '7px 10px' }}>{copiado ? <Check size={14} color={C.verde} /> : <Copy size={14} />} {copiado ? 'Copiado' : 'Copiar'}</button>
          </div>
          <div style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 12, padding: '10px 14px', minWidth: 190 }}>
            <Rotulo>DISPONIBLE PARA CARGAR</Rotulo>
            <p style={{ fontSize: 19, fontWeight: 800, margin: '4px 0 0', color: C.text }}>{fmtCop(disponibleCop)} <span style={{ fontSize: 12, color: C.sub }}>COP</span></p>
          </div>
        </div>
      </div>

      {/* Pestañas */}
      <div role="tablist" className="flex" style={{ gap: 4, overflowX: 'auto', borderBottom: `1px solid ${C.borde}`, paddingBottom: 0 }}>
        {pestanas.map(({ v, txt, icono: Icono, n, alerta }) => {
          const activa = vista === v;
          return (
            <button key={v} role="tab" aria-selected={activa} onClick={() => setVista(v)}
              style={{ fontFamily: FONT, display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 700, color: activa ? C.text : C.sub, background: 'transparent', border: 'none', borderBottom: `2px solid ${activa ? C.text : 'transparent'}`, padding: '10px 14px 11px', marginBottom: -1, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <Icono size={15} /> {txt}
              {n != null && <span style={{ fontSize: 10.5, fontWeight: 800, minWidth: 18, textAlign: 'center', borderRadius: 999, padding: '1px 6px', color: alerta ? '#0A0A0A' : C.sub, background: alerta ? C.naranja : 'rgba(255,255,255,0.07)' }}>{n}</span>}
            </button>
          );
        })}
      </div>

      {error && <p style={{ fontSize: 12.5, color: C.rojo, margin: 0, lineHeight: 1.45 }}>{error}</p>}

      {vista === 'resumen' && vistaResumen}
      {vista === 'clientes' && vistaClientes}
      {vista === 'solicitudes' && vistaSolicitudes}
      {vista === 'movimientos' && vistaMovimientos}

      {/* Ficha del cliente */}
      {ficha && (() => {
        const p = ficha; const r = resumenPor(p.id);
        const suyos = movs.filter((t: any) => cpId(t) === p.id);
        return (
          <div onClick={() => setFichaId(null)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'flex-end' }}>
            <aside onClick={e => e.stopPropagation()} aria-label={`Ficha de ${p.nombre}`} style={{ fontFamily: FONT, width: 'min(480px, 100%)', height: '100%', background: C.tarjeta, borderLeft: `1px solid ${C.borde}`, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <div className="flex items-start justify-between" style={{ gap: 12, padding: '18px 20px', borderBottom: `1px solid ${C.borde}` }}>
                <div style={{ minWidth: 0 }}>
                  <p className="flex items-center flex-wrap" style={{ fontSize: 18, fontWeight: 800, margin: 0, color: C.text, letterSpacing: '-0.3px', gap: 8 }}>{p.nombre} <TipoChip p={p} /></p>
                  <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0' }}>{doc(p)} · {p.email}</p>
                  {p.representante?.nombre && <p style={{ fontSize: 12, color: C.sub, margin: '2px 0 0' }}>Representante legal: {p.representante.nombre}</p>}
                  <p style={{ fontSize: 12, color: C.tenue, margin: '4px 0 0' }}>ID <span style={{ fontFamily: MONO, letterSpacing: '1px', color: C.text }}>{p.codigo || '—'}</span>{p.at ? ` · cliente desde ${fechaCorta(p.at)}` : ''}</p>
                </div>
                <button onClick={() => setFichaId(null)} aria-label="Cerrar" style={{ background: 'transparent', border: 'none', color: C.sub, cursor: 'pointer', padding: 4 }}><X size={18} /></button>
              </div>

              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="flex flex-wrap" style={{ gap: 8 }}>
                  <button onClick={() => abrirCarga(p)} className="lincoin-btn-white" style={{ ...botonPri, fontSize: 13, padding: '9px 14px' }}><Wallet size={13} /> Cargar saldo</button>
                  <button onClick={() => verFoto(p)} style={botonSec}><ImageIcon size={13} /> Ver foto</button>
                  <button onClick={() => verMovimientosDe(p)} style={botonSec}><ListFilter size={13} /> Sus movimientos</button>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.borde}`, borderRadius: 12, padding: '12px 14px' }}>
                  <Rotulo>TOPE DEL MES</Rotulo>
                  <div style={{ marginTop: 8 }}><UsoTope usado={p.usadoMes ?? 0} tope={p.topeMensual} ancho="100%" /></div>
                  <p style={{ fontSize: 11.5, color: C.tenue, margin: '8px 0 0', lineHeight: 1.5 }}>
                    {p.topeMensual ? `Le quedan ${fmtCop(Math.max(0, p.topeMensual - (p.usadoMes ?? 0)))} este mes. ` : ''}Cuenta sus envíos a banco y Bre-B del mes. Lo fija el equipo de cumplimiento de Lincoin.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    ['Cargado este mes', fmtCop(r.mes), `${r.nMes} ${r.nMes === 1 ? 'carga' : 'cargas'}`],
                    ['Cargado en total', fmtCop(r.total), `${r.n} ${r.n === 1 ? 'carga' : 'cargas'}`],
                    ['Última carga', r.ultima ? fechaCorta(r.ultima) : '—', r.ultima ? fecha(r.ultima).split(', ')[1] ?? '' : 'Sin cargas'],
                    ['Promedio por carga', r.n ? fmtCop(r.total / r.n) : '—', 'Histórico'],
                  ].map(([a, b, c]) => (
                    <div key={a} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.borde}`, borderRadius: 12, padding: '10px 12px', minWidth: 0 }}>
                      <p style={{ fontSize: 11.5, color: C.sub, margin: 0 }}>{a}</p>
                      <p style={{ fontSize: 15.5, fontWeight: 800, color: C.text, margin: '4px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b}</p>
                      <p style={{ fontSize: 11, color: C.tenue, margin: '2px 0 0' }}>{c}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ borderTop: `1px solid ${C.borde}` }}>
                <div className="flex items-center justify-between" style={{ padding: '12px 20px' }}>
                  <Rotulo>MOVIMIENTOS RECIENTES</Rotulo>
                  {suyos.length > 8 && <button onClick={() => verMovimientosDe(p)} style={{ ...botonSec, padding: '4px 9px', fontSize: 11.5 }}>Ver los {suyos.length}</button>}
                </div>
                {suyos.length === 0
                  ? <p style={{ fontSize: 12.5, color: C.tenue, padding: '4px 20px 18px', margin: 0 }}>Aún no hay movimientos con este cliente.</p>
                  : suyos.slice(0, 8).map((t: any) => filaMov(t, false))}
              </div>

              <div style={{ marginTop: 'auto', padding: '16px 20px', borderTop: `1px solid ${C.borde}` }}>
                <button onClick={() => setRevocarA(p)} disabled={ocupado === p.id} style={{ ...botonSec, background: 'transparent', color: C.rojo, borderColor: 'rgba(248,113,113,0.35)' }}><Trash2 size={13} /> Dejar de operar con este cliente</button>
              </div>
            </aside>
          </div>
        );
      })()}

      {rechazarA && (
        <ConfirmarModal titulo={rechazarA.estado === 'cumplimiento' ? `¿${rechazarA.nombre} ya no es tu cliente?` : `¿Rechazar la solicitud de ${rechazarA.nombre}?`} texto="Su cuenta sigue con identificación pendiente y sale de la revisión de Cumplimiento. Puede volver a pedirte autorización con tu ID." confirmar={rechazarA.estado === 'cumplimiento' ? 'Sí, retirar' : 'Rechazar'} peligro ocupado={ocupado === rechazarA.id}
          onConfirmar={async () => { const p = rechazarA; if (await accion('rechazar', p)) { setRechazarA(null); showToast(`Solicitud de ${p.nombre} rechazada.`, 3500); } }} onCancelar={() => setRechazarA(null)} />
      )}
      {revocarA && (
        <ConfirmarModal titulo={`¿Dejar de operar con ${revocarA.nombre}?`} texto="Deja de poder recibir dinero tuyo y de enviar. Su saldo y sus movimientos no cambian. Puede volver a pedirte autorización." confirmar="Dejar de operar" peligro ocupado={ocupado === revocarA.id}
          onConfirmar={async () => { const p = revocarA; if (await accion('revocar', p)) { setRevocarA(null); setFichaId(null); showToast(`${p.nombre} ya no opera con tu empresa.`, 3500); } }} onCancelar={() => setRevocarA(null)} />
      )}
      {aceptarA && (
        <ConfirmarModal titulo={`¿Aceptar a ${aceptarA.nombre} como tu cliente?`} texto="Pasa al equipo de cumplimiento de Lincoin, que revisa sus documentos, fija su tope mensual y lo aprueba. Cuando lo apruebe podrás cargarle saldo; te avisamos." confirmar="Aceptar" ocupado={ocupado === aceptarA.id}
          onConfirmar={async () => { const p = aceptarA; if (await accion('aceptar', p)) { setAceptarA(null); showToast(`${p.nombre} pasó a revisión de Cumplimiento.`, 4000, 'success'); } }} onCancelar={() => setAceptarA(null)} />
      )}

      {/* Foto sosteniendo el documento */}
      {fotoDe && (
        <Modal onCerrar={() => setFotoDe(null)} ancho={560}>
          <div className="flex items-start justify-between" style={{ gap: 12 }}>
            <div>
              <p className="flex items-center" style={{ fontSize: 17, fontWeight: 800, margin: 0, color: C.text, letterSpacing: '-0.3px', gap: 8 }}>{fotoDe.nombre} <TipoChip p={fotoDe} /></p>
              <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0' }}>{doc(fotoDe)} · {fotoDe.email}</p>
              {fotoDe.representante?.nombre && <p style={{ fontSize: 12.5, color: C.sub, margin: '2px 0 0' }}>Representante legal: {fotoDe.representante.nombre} · {fotoDe.representante.docType ?? 'CC'} {fotoDe.representante.docNumber ?? ''}</p>}
            </div>
            <button onClick={() => setFotoDe(null)} aria-label="Cerrar" style={{ background: 'transparent', border: 'none', color: C.sub, cursor: 'pointer', padding: 4 }}><X size={18} /></button>
          </div>
          <div style={{ marginTop: 16, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.borde}`, borderRadius: 12, minHeight: 220, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
            {foto === 'cargando' ? <p style={{ fontSize: 12.5, color: C.tenue }}>Cargando foto…</p>
              : foto ? <img src={foto} alt={`Foto de ${fotoDe.nombre} sosteniendo su documento`} style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block' }} />
              : <p style={{ fontSize: 12.5, color: C.tenue, padding: 20, textAlign: 'center' }}>No hay foto guardada para este cliente.</p>}
          </div>
          <p style={{ fontSize: 11.5, color: C.tenue, margin: '10px 0 0', lineHeight: 1.5 }}>Revisa que sea tu cliente: que el nombre y el documento coincidan y que la cara de la foto sea la del documento. Los demás documentos los revisa el equipo de cumplimiento de Lincoin.</p>
        </Modal>
      )}

      {/* Cargar saldo */}
      {cargaPara && (
        <Modal onCerrar={() => !enviando && setCargaPara(null)}>
          <div className="flex items-start justify-between" style={{ gap: 12 }}>
            <div>
              <p style={{ fontSize: 17, fontWeight: 800, margin: 0, color: C.text, letterSpacing: '-0.3px' }}>Cargar saldo</p>
              <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0' }}>a <b style={{ color: C.text }}>{cargaPara.nombre}</b> · <span style={{ fontFamily: MONO, letterSpacing: '1px' }}>{cargaPara.codigo}</span></p>
            </div>
            <button onClick={() => !enviando && setCargaPara(null)} aria-label="Cerrar" style={{ background: 'transparent', border: 'none', color: C.sub, cursor: 'pointer', padding: 4 }}><X size={18} /></button>
          </div>

          {paso === 'monto' ? (
            <form onSubmit={confirmarMonto} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <Rotulo>MONTO EN PESOS</Rotulo>
                <div style={{ position: 'relative', marginTop: 6 }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.sub, fontWeight: 700 }}>$</span>
                  <input value={fmtEntrada(monto)} onChange={e => setMonto(soloDigitos(e.target.value))} inputMode="numeric" placeholder="0" autoFocus
                    style={{ ...campo, paddingLeft: 26, fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }} />
                </div>
                <p style={{ fontSize: 11.5, color: C.tenue, margin: '6px 0 0' }}>Disponible: {fmtCop(disponibleCop)} COP · sin comisión</p>
              </div>
              <div>
                <Rotulo>NOTA (OPCIONAL)</Rotulo>
                <input value={nota} onChange={e => setNota(e.target.value.slice(0, 140))} placeholder="Ej. Pago semana 39" style={{ ...campo, marginTop: 6 }} />
                <p style={{ fontSize: 11.5, color: C.tenue, margin: '6px 0 0' }}>Tu cliente la ve en su movimiento.</p>
              </div>
              {errorCarga && <p style={{ fontSize: 12.5, color: C.rojo, margin: 0, lineHeight: 1.45 }}>{errorCarga}</p>}
              <button type="submit" disabled={montoNum <= 0} className="lincoin-btn-white" style={{ ...botonPri, fontSize: 14, padding: '12px 16px', borderRadius: 10, justifyContent: 'center', opacity: montoNum <= 0 ? 0.6 : 1 }}>
                Continuar
              </button>
            </form>
          ) : (
            <form onSubmit={ejecutar} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: 'rgba(255,255,255,0.035)', border: `1px solid ${C.borde}`, borderRadius: 11, padding: '12px 14px' }}>
                <div className="flex items-center justify-between"><span style={{ fontSize: 12, color: C.sub }}>Monto</span><b style={{ fontSize: 15, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmtCop(montoNum)} COP</b></div>
                <div className="flex items-center justify-between" style={{ marginTop: 6 }}><span style={{ fontSize: 12, color: C.sub }}>Para</span><span style={{ fontSize: 13, color: C.text }}>{cargaPara.nombre}</span></div>
                {nota && <div className="flex items-center justify-between" style={{ marginTop: 6 }}><span style={{ fontSize: 12, color: C.sub }}>Nota</span><span style={{ fontSize: 12.5, color: C.text }}>{nota}</span></div>}
              </div>
              <div>
                <Rotulo>CÓDIGO DE TU APP DE AUTENTICACIÓN</Rotulo>
                <input value={codigo2fa} onChange={e => setCodigo2fa(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" autoFocus
                  style={{ ...campo, marginTop: 6, fontSize: 22, fontWeight: 800, letterSpacing: '6px', textAlign: 'center', fontFamily: MONO }} />
              </div>
              {errorCarga && <p style={{ fontSize: 12.5, color: C.rojo, margin: 0, lineHeight: 1.45 }}>{errorCarga}</p>}
              <div className="flex items-center" style={{ gap: 8 }}>
                <button type="button" onClick={() => { setPaso('monto'); setErrorCarga(null); }} disabled={enviando} style={{ ...botonSec, flex: 1, justifyContent: 'center', padding: '12px 14px' }}>Atrás</button>
                <button type="submit" disabled={enviando || codigo2fa.length !== 6} className="lincoin-btn-white" style={{ ...botonPri, fontSize: 14, padding: '12px 16px', borderRadius: 10, flex: 2, justifyContent: 'center', opacity: enviando || codigo2fa.length !== 6 ? 0.6 : 1 }}>
                  {enviando ? 'Cargando…' : `Cargar ${fmtCop(montoNum)}`}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
};
