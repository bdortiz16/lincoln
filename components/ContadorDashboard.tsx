// ══════════════════════════════════════════════════════════════════
//  Panel del contador — Empresas → Contabilidad
//
//  Una sola pantalla: la Contabilidad de la empresa que le dio acceso, en
//  modo solo lectura. Los datos no salen de la sesión del contador (su RLS
//  no ve nada de la empresa): los entrega la función `contador` después de
//  verificar el vínculo raw_data.contadorDe.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from 'react';
import { LogOut, RefreshCw, X, Search, Clock, Building2 } from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';
import { llamarFuncion } from '../lib/edge';
import { ContabilidadDashboard } from './ContabilidadDashboard';

const FONT = 'Archivo, system-ui, sans-serif';
const C = { fondo: '#070808', tarjeta: '#0C0E0D', borde: 'rgba(255,255,255,0.08)', text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c', verde: '#4ADE80', rojo: '#F87171' };

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

type Datos = { empresa: { id: string; nombre: string; email: string; nit: string }; transactions: any[]; comprobantes: any[]; comprobantesError: string | null };

type Vinculo = { id: string; nombre: string };

export const ContadorDashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const { currentUser } = useDatabase();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [detalle, setDetalle] = useState<any | null>(null);
  // Vínculos del contador: empresas que lo aprobaron y solicitudes en espera.
  const [aprobadas, setAprobadas] = useState<Vinculo[] | null>(null);
  const [pendientes, setPendientes] = useState<Vinculo[]>([]);
  const [empresaSel, setEmpresaSel] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [pidiendo, setPidiendo] = useState(false);
  const [avisoPedido, setAvisoPedido] = useState<string | null>(null);

  const cargarDatos = async (empresaId: string) => {
    setCargando(true); setError(null);
    const r = await llamarFuncion('contador', { action: 'datos', empresaId }, 60000);
    setCargando(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo cargar la contabilidad.'); return; }
    setDatos({ empresa: r.empresa, transactions: (r.transactions ?? []).map(mapTx), comprobantes: r.comprobantes ?? [], comprobantesError: r.comprobantesError ?? null });
  };
  const cargarEstado = async () => {
    setCargando(true); setError(null);
    const r = await llamarFuncion('contador', { action: 'estado' }, 30000);
    if (!r?.ok) { setCargando(false); setError(r?.error ?? 'No se pudo consultar tu acceso.'); setAprobadas([]); return; }
    const ap: Vinculo[] = r.aprobadas ?? [];
    setAprobadas(ap); setPendientes(r.pendientes ?? []);
    const elegida = empresaSel && ap.some(e => e.id === empresaSel) ? empresaSel : ap[0]?.id ?? null;
    setEmpresaSel(elegida);
    if (elegida) await cargarDatos(elegida); else { setDatos(null); setCargando(false); }
  };
  useEffect(() => { cargarEstado(); }, []);
  const cargar = () => (empresaSel ? cargarDatos(empresaSel) : cargarEstado());

  const pedirAcceso = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = codigo.trim().toUpperCase();
    if (c.length < 4 || pidiendo) return;
    setPidiendo(true); setError(null); setAvisoPedido(null);
    const r = await llamarFuncion('contador', { action: 'solicitar', codigoEmpresa: c }, 30000);
    setPidiendo(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo enviar la solicitud.'); return; }
    setCodigo('');
    setAvisoPedido(r.estado === 'aprobado' ? `Ya tienes acceso a ${r.empresa?.nombre}.` : `Listo. ${r.empresa?.nombre} tiene que aprobarte desde su Contabilidad. Cuando lo haga, entra aquí y verás sus cuentas.`);
    cargarEstado();
  };

  const empresaId = datos?.empresa.id ?? null;
  const transactions = useMemo(() => datos?.transactions ?? [], [datos]);

  const fmt = (v: any, cur: any) => `${Number(v ?? 0).toLocaleString('es-CO', { maximumFractionDigits: String(cur ?? '').startsWith('COP') ? 0 : 2 })} ${String(cur ?? '').split('_')[0]}`;

  return (
    <div style={{ minHeight: '100vh', background: C.fondo, color: C.text, fontFamily: FONT }}>
      <header style={{ borderBottom: `1px solid ${C.borde}`, padding: '16px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div className="flex items-center" style={{ gap: 16 }}>
          <p style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.6px', margin: 0, lineHeight: 1 }}>Lincoin<span style={{ color: C.verde }}>.</span></p>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '2.2px', color: C.sub }}>CONTABILIDAD</span>
        </div>
        <div className="flex items-center" style={{ gap: 10, flexWrap: 'wrap' }}>
          {datos && (
            <div style={{ textAlign: 'right' }}>
              {(aprobadas?.length ?? 0) > 1 ? (
                <select value={empresaSel ?? ''} onChange={e => { setEmpresaSel(e.target.value); cargarDatos(e.target.value); }}
                  style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '7px 10px' }}>
                  {aprobadas!.map(e => <option key={e.id} value={e.id} style={{ color: '#000' }}>{e.nombre}</option>)}
                </select>
              ) : (
                <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0 }}>{datos.empresa.nombre || datos.empresa.email}</p>
              )}
              <p style={{ fontSize: 11.5, color: C.sub, margin: '1px 0 0' }}>Solo lectura · {currentUser?.name || currentUser?.email}</p>
            </div>
          )}
          <button onClick={cargar} disabled={cargando} title="Actualizar" style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.sub, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '9px 12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: cargando ? 0.6 : 1 }}>
            <RefreshCw size={13} /> {cargando ? 'Cargando…' : 'Actualizar'}
          </button>
          <button onClick={onLogout} style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '9px 12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <LogOut size={13} /> Salir
          </button>
        </div>
      </header>

      <main style={{ padding: '22px 22px 40px', maxWidth: 1220, margin: '0 auto' }}>
        {error && (
          <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
            <p style={{ fontSize: 13.5, fontWeight: 700, color: C.rojo, margin: 0 }}>No se pudo abrir la contabilidad</p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>{error}</p>
          </div>
        )}
        {datos?.comprobantesError && (
          <p style={{ fontSize: 12, color: C.tenue, margin: '0 0 12px' }}>Los comprobantes no se pudieron leer: {datos.comprobantesError}</p>
        )}
        {!datos && cargando && <p style={{ fontSize: 13, color: C.sub }}>Cargando…</p>}

        {/* Sin empresa aprobada: se pide acceso con el ID de la empresa. */}
        {!datos && !cargando && aprobadas != null && (
          <div style={{ maxWidth: 560, margin: '30px auto 0' }}>
            <div style={{ background: `linear-gradient(135deg, #161A17 0%, ${C.tarjeta} 70%)`, border: `1px solid ${C.borde}`, borderRadius: 18, padding: '26px 24px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: -70, right: -50, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(74,222,128,0.14), transparent 65%)', pointerEvents: 'none' }} />
              <Building2 size={26} color={C.verde} />
              <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', margin: '12px 0 0' }}>Conéctate a la empresa</h1>
              <p style={{ fontSize: 13.5, color: C.sub, margin: '8px 0 0', lineHeight: 1.55 }}>
                Escribe el <b style={{ color: C.text }}>ID Lincoin</b> de la empresa (se lo pides a ellos: está en su Contabilidad → Contador). Ellos aprueban tu acceso y desde ese momento ves su contabilidad aquí.
              </p>
              <form onSubmit={pedirAcceso} className="flex items-center flex-wrap" style={{ gap: 8, marginTop: 18 }}>
                <div style={{ position: 'relative', flex: '1 1 200px' }}>
                  <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.sub }} />
                  <input value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} placeholder="ID de la empresa" maxLength={8} autoFocus
                    style={{ fontFamily: 'ui-monospace, monospace', width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, color: C.text, borderRadius: 10, padding: '12px 12px 12px 36px', fontSize: 16, fontWeight: 700, letterSpacing: '3px', outline: 'none' }} />
                </div>
                <button type="submit" disabled={pidiendo || codigo.length < 4} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, padding: '12px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', opacity: pidiendo || codigo.length < 4 ? 0.6 : 1 }}>
                  {pidiendo ? 'Enviando…' : 'Pedir acceso'}
                </button>
              </form>
              {avisoPedido && <p style={{ fontSize: 13, color: C.verde, margin: '12px 0 0', lineHeight: 1.5 }}>{avisoPedido}</p>}
            </div>

            {pendientes.length > 0 && (
              <div style={{ marginTop: 14, background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 14, padding: '14px 18px' }}>
                <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>EN ESPERA DE APROBACIÓN</p>
                {pendientes.map(p => (
                  <p key={p.id} className="flex items-center" style={{ fontSize: 13.5, fontWeight: 700, margin: '8px 0 0', gap: 8 }}><Clock size={14} color={C.sub} /> {p.nombre}</p>
                ))}
                <p style={{ fontSize: 12, color: C.tenue, margin: '10px 0 0', lineHeight: 1.5 }}>La empresa te aprueba desde su Contabilidad → Contador. Toca "Actualizar" arriba cuando te avisen.</p>
              </div>
            )}
          </div>
        )}

        {datos && (
          <ContabilidadDashboard
            transactions={transactions}
            userId={empresaId}
            soloLectura
            comprobantesExternos={datos.comprobantes}
            onVerMovimiento={(tx: any) => setDetalle(tx)}
          />
        )}
      </main>

      {/* Detalle mínimo de un movimiento: lo que ya trae el registro. */}
      {detalle && (
        <div onClick={() => setDetalle(null)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 16, padding: 22, maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="flex items-start justify-between" style={{ gap: 12 }}>
              <p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{detalle.title || detalle.type}</p>
              <button onClick={() => setDetalle(null)} aria-label="Cerrar" style={{ background: 'transparent', border: 'none', color: C.sub, cursor: 'pointer', padding: 4 }}><X size={18} /></button>
            </div>
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {([
                ['Fecha', detalle.createdAt ? new Date(detalle.createdAt).toLocaleString('es-CO') : '—'],
                ['Tipo', detalle.type],
                ['Monto', fmt(detalle.amount, detalle.currency)],
                ['Estado', detalle.status],
                ['Contraparte', detalle.beneficiary ?? detalle.beneficiaryName ?? detalle.counterpartyName ?? detalle.senderName ?? detalle.recipientName ?? detalle.pagador ?? '—'],
                ['Referencia', detalle.providerRef ?? detalle.reference ?? detalle.txHash ?? '—'],
                ['Nota', detalle.note ?? detalle.reason ?? '—'],
                ['Id', detalle.id],
              ] as [string, any][]).map(([k, v]) => (
                <div key={k} className="flex items-start justify-between" style={{ gap: 12, borderBottom: `1px solid ${C.borde}`, paddingBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1px', color: C.sub }}>{k.toUpperCase()}</span>
                  <span style={{ fontSize: 13, color: C.text, textAlign: 'right', wordBreak: 'break-all' }}>{String(v ?? '—')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
