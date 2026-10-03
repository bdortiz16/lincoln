// ══════════════════════════════════════════════════════════════════
//  Personas autorizadas — la empresa autoriza a las personas con las que opera
//
//  Una cuenta Persona nace con "identificación pendiente" y solo puede
//  recibir dinero de una empresa que la haya autorizado. La persona escribe
//  el ID Lincoin de la empresa y manda su nombre, su documento y una foto
//  sosteniendo el documento. Aquí la empresa ve esa solicitud con la foto,
//  la aprueba (fijándole un tope mensual de retiro) o la rechaza, y después
//  puede cambiarle el tope, cargarle saldo o revocarla.
//
//  Los vínculos viven en raw_data.personasAutorizadas / personasSolicitudes
//  de la empresa y los escribe solo el servidor (función `autorizaciones`).
//  La carga de saldo la hace la base de una sola vez (lincoin_cargar_cliente):
//  descuenta de la empresa, acredita a la persona y deja un movimiento de
//  cada lado. Mueve plata, así que exige lo mismo que Enviar: 2FA.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from 'react';
import { Trash2, X, Wallet, ArrowUpRight, Copy, Check, Clock, ShieldCheck, Image as ImageIcon, SlidersHorizontal } from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';
import { supabase } from '../lib/supabaseClient';
import { llamarFuncion } from '../lib/edge';
import { ConfirmarModal } from './ConfirmarModal';

const FONT = 'Archivo, system-ui, sans-serif';
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const C = {
  tarjeta: '#0C0E0D', borde: 'rgba(255,255,255,0.08)', text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c',
  verde: '#4ADE80', rojo: '#F87171', naranja: '#FB923C',
};

export type PersonaVinculo = { id: string; email: string; nombre: string; docType: string; docNumber: string; at: string; codigo?: string; topeMensual?: number | null };

const fmtCop = (v: number) => `$ ${Math.round(v).toLocaleString('es-CO')}`;
const soloDigitos = (s: string) => s.replace(/[^\d]/g, '');
const fmtEntrada = (s: string) => { const d = soloDigitos(s); return d ? Number(d).toLocaleString('es-CO') : ''; };
const fecha = (ts: any) => { const d = new Date(ts ?? 0); return isNaN(d.getTime()) || !ts ? '' : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const fechaCorta = (ts: any) => fecha(ts).split(',')[0];
const DOCS: Record<string, string> = { CC: 'Cédula', CE: 'Cédula de extranjería', PAS: 'Pasaporte', PPT: 'PPT', NIT: 'NIT' };
const doc = (p: PersonaVinculo) => `${DOCS[p.docType] ?? p.docType} ${p.docNumber}`.trim();

type Props = {
  showToast: (msg: string, ms?: number, tipo?: 'success' | 'error') => void;
  handleActionRestricted: () => boolean;
  mfaEnrolled: boolean;
  irAjustes: () => void;
  onVerMovimiento?: (tx: any) => void;
};

export const ClientesSection: React.FC<Props> = ({ showToast, handleActionRestricted, mfaEnrolled, irAjustes, onVerMovimiento }) => {
  const { currentUser, transactions, refreshData, verifyMfaCode } = useDatabase();
  const cu: any = currentUser ?? {};
  const disponibleCop = ['COP', 'COP_BREB', 'COP_ACH'].reduce((s, k) => s + (Number(cu.balances?.[k]) || 0), 0);

  // ── Vínculos (los trae el servidor) ────────────────────────────────
  const [miId, setMiId] = useState('');
  const [autorizadas, setAutorizadas] = useState<PersonaVinculo[] | null>(null);
  const [solicitudes, setSolicitudes] = useState<PersonaVinculo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const aplicar = (r: any) => {
    // aprobar/rechazar/revocar/tope devuelven las listas sin `codigo`:
    // conservamos el que ya teníamos para no perder el ID de la tabla.
    setAutorizadas(prev => (r.autorizadas ?? []).map((a: PersonaVinculo) => ({ ...a, codigo: a.codigo || prev?.find(p => p.id === a.id)?.codigo || solicitudes.find(s => s.id === a.id)?.codigo || '' })));
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

  const accion = async (action: 'rechazar' | 'revocar' | 'aprobar' | 'tope', p: PersonaVinculo, extra: Record<string, unknown> = {}) => {
    setOcupado(p.id); setError(null);
    const r = await llamarFuncion('autorizaciones', { action, personaId: p.id, ...extra }, 30000);
    setOcupado(null);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo.'); return false; }
    aplicar(r);
    return true;
  };

  // ── Ver foto ───────────────────────────────────────────────────────
  const [fotoDe, setFotoDe] = useState<PersonaVinculo | null>(null);
  const [foto, setFoto] = useState<string | null | 'cargando'>(null);
  const verFoto = async (p: PersonaVinculo) => {
    setFotoDe(p); setFoto('cargando');
    const r = await llamarFuncion('autorizaciones', { action: 'ver_foto', personaId: p.id }, 30000);
    setFoto(r?.ok && r.foto ? String(r.foto) : null);
  };

  // ── Aprobar (con tope) / cambiar tope ──────────────────────────────
  const [topePara, setTopePara] = useState<{ p: PersonaVinculo; modo: 'aprobar' | 'tope' } | null>(null);
  const [tope, setTope] = useState('');
  const abrirTope = (p: PersonaVinculo, modo: 'aprobar' | 'tope') => { setTopePara({ p, modo }); setTope(p.topeMensual ? String(p.topeMensual) : ''); setError(null); };
  const confirmarTope = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topePara) return;
    const t = soloDigitos(tope);
    const ok = await accion(topePara.modo, topePara.p, { topeMensual: t ? Number(t) : null });
    if (ok) {
      showToast(topePara.modo === 'aprobar' ? `${topePara.p.nombre} quedó autorizada.` : `Tope actualizado para ${topePara.p.nombre}.`, 4000, 'success');
      setTopePara(null);
    }
  };

  const [rechazarA, setRechazarA] = useState<PersonaVinculo | null>(null);
  const [revocarA, setRevocarA] = useState<PersonaVinculo | null>(null);

  // ── Cargas hechas (movimientos pay_sent marcados psp) ──────────────
  const cargas = useMemo(() => (transactions ?? [])
    .filter((t: any) => t.userId === cu.id && t.type === 'pay_sent' && (t.psp || t.raw_data?.psp))
    .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()), [transactions, cu.id]);
  const resumenPor = (id: string) => {
    const mias = cargas.filter((t: any) => (t.counterpartyId ?? t.raw_data?.counterpartyId) === id && t.status === 'Completado');
    return { n: mias.length, total: mias.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0), ultima: mias[0]?.createdAt ?? null };
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
    if (!p.codigo) { showToast('No se encontró el ID Lincoin de esta persona. Recarga la sección e intenta de nuevo.', 5000, 'error'); return; }
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

  const ejecutar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cargaPara || enviando || codigo2fa.length !== 6) return;
    setEnviando(true); setErrorCarga(null);
    try {
      const ok = await verifyMfaCode(codigo2fa);
      if (!ok) { setErrorCarga('Código incorrecto. Intenta de nuevo.'); setCodigo2fa(''); return; }
      const { data, error } = await supabase.rpc('lincoin_cargar_cliente', { p_codigo: cargaPara.codigo, p_monto: montoNum, p_nota: nota.trim() || null });
      if (error) {
        const m = String(error.message ?? '');
        setErrorCarga(/could not find|does not exist|schema cache|404/i.test(m)
          ? 'La función de carga todavía no está en la base. Falta correr la migración 2026_personas_autorizadas.sql en Supabase.'
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
  const botonSec: React.CSSProperties = { fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '8px 12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };
  const botonPri: React.CSSProperties = { fontFamily: FONT, fontWeight: 700, fontSize: 12.5, padding: '8px 12px', borderRadius: 9, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };
  const celda: React.CSSProperties = { padding: '11px 18px', borderBottom: `1px solid ${C.borde}` };
  const Rotulo: React.FC<{ children: React.ReactNode }> = ({ children }) => <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>{children}</p>;
  const Modal: React.FC<{ onCerrar: () => void; ancho?: number; children: React.ReactNode }> = ({ onCerrar, ancho = 440, children }) => (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ fontFamily: FONT, width: '100%', maxWidth: ancho, background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 16, padding: 22, maxHeight: '92vh', overflowY: 'auto' }}>{children}</div>
    </div>
  );

  return (
    <div style={{ fontFamily: FONT, maxWidth: 1180, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="flex items-start justify-between flex-wrap" style={{ gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: C.text, margin: 0 }}>Personas autorizadas</h2>
          <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5, maxWidth: 680 }}>
            Las personas que operan con tu empresa abren una cuenta <b style={{ color: C.text }}>Persona</b> en Lincoin, escriben tu ID y te mandan su nombre, su documento y una foto sosteniéndolo. Tú revisas, apruebas con un tope mensual de retiro, y desde aquí les cargas saldo en pesos. Solo una persona autorizada puede recibir dinero tuyo.
          </p>
        </div>
        <div style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 12, padding: '10px 14px', minWidth: 200 }}>
          <Rotulo>DISPONIBLE PARA CARGAR</Rotulo>
          <p style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 0', fontVariantNumeric: 'tabular-nums', color: C.text }}>{fmtCop(disponibleCop)} <span style={{ fontSize: 12, color: C.sub }}>COP</span></p>
        </div>
      </div>

      {/* El ID que la empresa le da a sus personas. */}
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 12, padding: '12px 16px' }}>
        <div>
          <Rotulo>TU ID LINCOIN · DÁSELO A LAS PERSONAS QUE VAS A AUTORIZAR</Rotulo>
          <p style={{ fontSize: 26, fontWeight: 700, letterSpacing: '4px', margin: '4px 0 0', color: C.text, fontFamily: MONO }}>{miId || '······'}</p>
        </div>
        <button onClick={copiar} disabled={!miId} className="lincoin-btn-white" style={{ ...botonPri, fontSize: 13, padding: '9px 14px' }}>
          {copiado ? <Check size={14} /> : <Copy size={14} />} {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>

      {error && <p style={{ fontSize: 12.5, color: C.rojo, margin: 0, lineHeight: 1.45 }}>{error}</p>}

      {/* Solicitudes */}
      <section style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 14, overflow: 'hidden' }}>
        <div className="flex items-center justify-between" style={{ padding: '14px 18px', borderBottom: `1px solid ${C.borde}` }}>
          <Rotulo>SOLICITUDES PENDIENTES</Rotulo>
          {solicitudes.length > 0 && <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1px', color: C.naranja, border: '1px solid rgba(251,146,60,0.4)', borderRadius: 999, padding: '3px 9px' }}>{solicitudes.length}</span>}
        </div>
        {autorizadas == null ? (
          <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0 }}>Consultando…</p>
        ) : solicitudes.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0, lineHeight: 1.5 }}>Ninguna. Cuando una persona escriba tu ID desde su portal, aparece aquí con su documento y su foto para que la apruebes.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {solicitudes.map(p => (
              <div key={p.id} className="flex items-center justify-between flex-wrap" style={{ gap: 10, padding: '12px 18px', borderBottom: `1px solid ${C.borde}` }}>
                <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                  <p className="flex items-center" style={{ fontSize: 14, fontWeight: 800, color: C.text, margin: 0, gap: 6 }}><Clock size={13} color={C.naranja} /> {p.nombre}</p>
                  <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0' }}>{doc(p)} · {p.email}</p>
                  <p style={{ fontSize: 11.5, color: C.tenue, margin: '2px 0 0' }}>ID <span style={{ fontFamily: MONO, letterSpacing: '1px', color: C.sub }}>{p.codigo || '—'}</span>{p.at ? ` · pidió el ${fecha(p.at)}` : ''}</p>
                </div>
                <div className="flex items-center flex-wrap" style={{ gap: 6 }}>
                  <button onClick={() => verFoto(p)} style={botonSec}><ImageIcon size={13} /> Ver foto</button>
                  <button onClick={() => setRechazarA(p)} disabled={ocupado === p.id} style={{ ...botonSec, color: C.sub }}>Rechazar</button>
                  <button onClick={() => abrirTope(p, 'aprobar')} disabled={ocupado === p.id} className="lincoin-btn-white" style={{ ...botonPri, opacity: ocupado === p.id ? 0.6 : 1 }}><Check size={13} /> {ocupado === p.id ? '…' : 'Aprobar'}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Autorizadas */}
      <section style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 14, overflow: 'hidden' }}>
        <div className="flex items-center justify-between" style={{ padding: '14px 18px', borderBottom: `1px solid ${C.borde}` }}>
          <Rotulo>AUTORIZADAS</Rotulo>
          <span style={{ fontSize: 11.5, color: C.tenue }}>{autorizadas?.length ? `${autorizadas.length}` : ''}</span>
        </div>
        {autorizadas == null ? null : autorizadas.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0, lineHeight: 1.5 }}>Todavía no has autorizado a nadie. Comparte tu ID con las personas que operan contigo.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
              <thead>
                <tr>
                  {['PERSONA', 'ID', 'DOCUMENTO', 'TOPE MENSUAL', 'CARGADO', 'ÚLTIMA CARGA', ''].map((h, i) => (
                    <th key={i} style={{ textAlign: i === 3 || i === 4 ? 'right' : 'left', padding: '9px 18px', fontSize: 10, fontWeight: 800, letterSpacing: '1px', color: C.sub, borderBottom: `1px solid ${C.borde}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {autorizadas.map(p => {
                  const r = resumenPor(p.id);
                  return (
                    <tr key={p.id} className="lincoin-fila-mov">
                      <td style={celda}>
                        <p className="flex items-center" style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: C.text, gap: 6 }}><ShieldCheck size={13} color={C.verde} /> {p.nombre}</p>
                        <p style={{ fontSize: 11, color: C.tenue, margin: '1px 0 0' }}>{p.email}{p.at ? ` · desde ${fechaCorta(p.at)}` : ''}</p>
                      </td>
                      <td style={{ ...celda, fontFamily: MONO, letterSpacing: '1px', fontSize: 12.5, color: C.text }}>{p.codigo || '—'}</td>
                      <td style={{ ...celda, fontSize: 12.5, color: C.sub, whiteSpace: 'nowrap' }}>{doc(p)}</td>
                      <td style={{ ...celda, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => abrirTope(p, 'tope')} title="Cambiar tope" style={{ ...botonSec, padding: '5px 9px', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                          {p.topeMensual ? fmtCop(p.topeMensual) : 'Sin tope'} <SlidersHorizontal size={12} color={C.sub} />
                        </button>
                      </td>
                      <td style={{ ...celda, fontSize: 13, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.text, whiteSpace: 'nowrap' }}>{r.total ? fmtCop(r.total) : '—'}<span style={{ fontSize: 11, color: C.tenue, fontWeight: 500 }}>{r.n ? ` · ${r.n}` : ''}</span></td>
                      <td style={{ ...celda, fontSize: 12, color: C.sub, whiteSpace: 'nowrap' }}>{r.ultima ? fecha(r.ultima) : '—'}</td>
                      <td style={{ ...celda, whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <div className="flex items-center justify-end" style={{ gap: 6 }}>
                          <button onClick={() => verFoto(p)} title="Ver foto" style={{ ...botonSec, padding: '7px 9px', color: C.sub }}><ImageIcon size={13} /></button>
                          <button onClick={() => abrirCarga(p)} className="lincoin-btn-white" style={{ ...botonPri, fontSize: 12, padding: '7px 12px' }}><Wallet size={12} /> Cargar saldo</button>
                          <button onClick={() => setRevocarA(p)} disabled={ocupado === p.id} title="Quitar autorización" style={{ ...botonSec, padding: '7px 9px', color: C.sub }}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cargas recientes */}
      <section style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.borde}` }}><Rotulo>CARGAS RECIENTES</Rotulo></div>
        {cargas.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0 }}>Aún no has cargado saldo a nadie.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {cargas.slice(0, 30).map((t: any) => (
              <div key={t.id} onClick={() => onVerMovimiento?.(t)} className="flex items-center lincoin-fila-mov" style={{ gap: 12, padding: '11px 18px', borderBottom: `1px solid ${C.borde}`, cursor: onVerMovimiento ? 'pointer' : 'default' }}>
                <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><ArrowUpRight size={15} color={C.text} /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.counterpartyName ?? t.beneficiaryName ?? 'Persona'} <span style={{ color: C.tenue, fontWeight: 500, fontFamily: MONO, fontSize: 11.5 }}>{t.counterpartyCode ?? ''}</span></p>
                  <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fecha(t.createdAt)}{t.note ? ` · ${t.note}` : ''}{t.status !== 'Completado' ? ` · ${t.status}` : ''}</p>
                </div>
                <p style={{ fontSize: 13.5, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: C.text }}>−{fmtCop(Number(t.amount) || 0)}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {rechazarA && (
        <ConfirmarModal titulo={`¿Rechazar la solicitud de ${rechazarA.nombre}?`} texto="Su cuenta sigue con identificación pendiente. Puede volver a pedirte autorización con tu ID." confirmar="Rechazar" peligro ocupado={ocupado === rechazarA.id}
          onConfirmar={async () => { const p = rechazarA; if (await accion('rechazar', p)) { setRechazarA(null); showToast(`Solicitud de ${p.nombre} rechazada.`, 3500); } }} onCancelar={() => setRechazarA(null)} />
      )}
      {revocarA && (
        <ConfirmarModal titulo={`¿Quitar la autorización de ${revocarA.nombre}?`} texto="Deja de poder recibir dinero tuyo y de retirar. Su saldo y sus movimientos no cambian. Puede volver a pedirte autorización." confirmar="Quitar autorización" peligro ocupado={ocupado === revocarA.id}
          onConfirmar={async () => { const p = revocarA; if (await accion('revocar', p)) { setRevocarA(null); showToast(`${p.nombre} ya no está autorizada.`, 3500); } }} onCancelar={() => setRevocarA(null)} />
      )}

      {/* Foto sosteniendo el documento */}
      {fotoDe && (
        <Modal onCerrar={() => setFotoDe(null)} ancho={560}>
          <div className="flex items-start justify-between" style={{ gap: 12 }}>
            <div>
              <p style={{ fontSize: 17, fontWeight: 800, margin: 0, color: C.text, letterSpacing: '-0.3px' }}>{fotoDe.nombre}</p>
              <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0' }}>{doc(fotoDe)} · {fotoDe.email}</p>
            </div>
            <button onClick={() => setFotoDe(null)} aria-label="Cerrar" style={{ background: 'transparent', border: 'none', color: C.sub, cursor: 'pointer', padding: 4 }}><X size={18} /></button>
          </div>
          <div style={{ marginTop: 16, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.borde}`, borderRadius: 12, minHeight: 220, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
            {foto === 'cargando' ? <p style={{ fontSize: 12.5, color: C.tenue }}>Cargando foto…</p>
              : foto ? <img src={foto} alt={`Foto de ${fotoDe.nombre} sosteniendo su documento`} style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block' }} />
              : <p style={{ fontSize: 12.5, color: C.tenue, padding: 20, textAlign: 'center' }}>No hay foto guardada para esta persona.</p>}
          </div>
          <p style={{ fontSize: 11.5, color: C.tenue, margin: '10px 0 0', lineHeight: 1.5 }}>Revisa que el nombre y el número del documento coincidan con los que escribió, y que la cara de la foto sea la del documento.</p>
        </Modal>
      )}

      {/* Aprobar / tope */}
      {topePara && (
        <Modal onCerrar={() => setTopePara(null)}>
          <div className="flex items-start justify-between" style={{ gap: 12 }}>
            <div>
              <p style={{ fontSize: 17, fontWeight: 800, margin: 0, color: C.text, letterSpacing: '-0.3px' }}>{topePara.modo === 'aprobar' ? 'Aprobar y fijar tope' : 'Tope mensual'}</p>
              <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0' }}>{topePara.p.nombre} · {doc(topePara.p)}</p>
            </div>
            <button onClick={() => setTopePara(null)} aria-label="Cerrar" style={{ background: 'transparent', border: 'none', color: C.sub, cursor: 'pointer', padding: 4 }}><X size={18} /></button>
          </div>
          <form onSubmit={confirmarTope} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <Rotulo>TOPE DE RETIRO AL MES (COP)</Rotulo>
              <div style={{ position: 'relative', marginTop: 6 }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.sub, fontWeight: 700 }}>$</span>
                <input value={fmtEntrada(tope)} onChange={e => setTope(soloDigitos(e.target.value))} inputMode="numeric" placeholder="Sin tope" autoFocus style={{ ...campo, paddingLeft: 26, fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }} />
              </div>
              <p style={{ fontSize: 11.5, color: C.tenue, margin: '6px 0 0', lineHeight: 1.5 }}>Lo máximo que esta persona puede retirar a banco o Bre-B cada mes. Vacío = sin tope. Lo puedes cambiar cuando quieras.</p>
            </div>
            {error && <p style={{ fontSize: 12.5, color: C.rojo, margin: 0, lineHeight: 1.45 }}>{error}</p>}
            <button type="submit" disabled={ocupado === topePara.p.id} className="lincoin-btn-white" style={{ ...botonPri, fontSize: 14, padding: '12px 16px', borderRadius: 10, justifyContent: 'center', opacity: ocupado === topePara.p.id ? 0.6 : 1 }}>
              {ocupado === topePara.p.id ? 'Guardando…' : topePara.modo === 'aprobar' ? 'Aprobar' : 'Guardar tope'}
            </button>
          </form>
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
                <p style={{ fontSize: 11.5, color: C.tenue, margin: '6px 0 0' }}>La persona la ve en su movimiento.</p>
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
