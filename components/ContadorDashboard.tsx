// ══════════════════════════════════════════════════════════════════
//  Panel del contador — Empresas → Contabilidad
//
//  Una sola pantalla: la Contabilidad de la empresa que le dio acceso, en
//  modo solo lectura. Los datos no salen de la sesión del contador (su RLS
//  no ve nada de la empresa): los entrega la función `contador` después de
//  verificar el vínculo raw_data.contadorDe.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from 'react';
import { LogOut, RefreshCw, X } from 'lucide-react';
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

export const ContadorDashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const { currentUser } = useDatabase();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [detalle, setDetalle] = useState<any | null>(null);

  const cargar = async () => {
    setCargando(true); setError(null);
    const r = await llamarFuncion('contador', { action: 'datos' }, 60000);
    setCargando(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo cargar la contabilidad.'); return; }
    setDatos({ empresa: r.empresa, transactions: (r.transactions ?? []).map(mapTx), comprobantes: r.comprobantes ?? [], comprobantesError: r.comprobantesError ?? null });
  };
  useEffect(() => { cargar(); }, []);

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
              <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0 }}>{datos.empresa.nombre || datos.empresa.email}</p>
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
        {!datos && cargando && <p style={{ fontSize: 13, color: C.sub }}>Cargando la contabilidad…</p>}
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
