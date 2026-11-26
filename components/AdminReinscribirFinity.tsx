import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';

// ─────────────────────────────────────────────────────────────
// Beneficiarios ACH que no quedaron inscritos en Finity.
//
// La inscripción la reintentaba solo la página de Beneficiarios de cada
// cliente. Cuando Finity rechaza un rato (23 nov: 403 desde las 10:20 am),
// las cuentas quedan "En validación" sin existir en Finity hasta que cada
// cliente vuelva a entrar. Este botón las inscribe desde el servidor, de a
// una, y se detiene en el primer rechazo de Finity.
// ─────────────────────────────────────────────────────────────

const C = {
  card: '#0C0E0D', border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  text: '#F4F4F2', sub: '#878E88', green: '#4ADE80', amber: '#FBBF24', red: '#F87171',
};
const hora = (ms: number) => new Date(ms).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });

type Estado = { pendientes: number; pausaHasta: number | null; pausaHttp: number | null };

export const AdminReinscribirFinity: React.FC = () => {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const contar = async () => {
    const r: any = await llamarFuncion('finity-proxy', { action: 'reinscribir_pendientes', soloContar: true }).catch(() => null);
    if (r?.ok) setEstado({ pendientes: r.pendientes ?? 0, pausaHasta: r.pausaHasta ?? null, pausaHttp: r.pausaHttp ?? null });
    else setMsg({ ok: false, t: r?.message ?? r?.error ?? 'No se pudo consultar.' });
  };
  useEffect(() => { contar(); }, []);

  const reintentar = async () => {
    if (corriendo) return;
    setCorriendo(true); setMsg(null);
    const r: any = await llamarFuncion('finity-proxy', { action: 'reinscribir_pendientes' }, 120000).catch(() => null);
    setCorriendo(false);
    if (!r?.ok) { setMsg({ ok: false, t: r?.message ?? r?.error ?? 'No se pudo reintentar.' }); return; }
    setEstado({ pendientes: Math.max(0, (r.pendientes ?? 0) - (r.inscritas ?? 0)), pausaHasta: r.pausaHasta ?? null, pausaHttp: r.pausaHttp ?? null });
    if (r.detenido) {
      setMsg({ ok: false, t: `Finity volvió a rechazar (HTTP ${r.detenido.http}). Se inscribieron ${r.inscritas} y se paró para no bloquear la cuenta.${r.pausaHasta ? ` Pausa hasta las ${hora(r.pausaHasta)}.` : ''}` });
    } else if (!r.intentadas && r.pausaHasta) {
      setMsg({ ok: false, t: `Inscripciones en pausa hasta las ${hora(r.pausaHasta)} porque Finity respondió ${r.pausaHttp}. Inténtalo después de esa hora.` });
    } else {
      setMsg({ ok: true, t: `Se inscribieron ${r.inscritas} de ${r.intentadas}.${r.sinBanco ? ` ${r.sinBanco} sin datos completos (banco, cuenta o documento): hay que corregirlos.` : ''}` });
    }
  };

  if (!estado && !msg) return null;
  if (estado && !estado.pendientes && !msg) return null;
  const enPausa = !!estado?.pausaHasta && estado.pausaHasta > Date.now();
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: '1 1 320px' }}>
        <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: C.text }}>Inscripciones pendientes en Finity</p>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
          {estado
            ? estado.pendientes
              ? `${estado.pendientes} cuenta${estado.pendientes === 1 ? '' : 's'} ACH sin inscribir.${enPausa ? ` En pausa hasta las ${hora(estado.pausaHasta!)} (Finity respondió ${estado.pausaHttp}).` : ''}`
              : 'Todas las cuentas ACH están inscritas.'
            : ''}
        </p>
        {msg && <p style={{ margin: '6px 0 0', fontSize: 12, color: msg.ok ? C.green : C.amber }}>{msg.t}</p>}
      </div>
      {!!estado?.pendientes && (
        <button onClick={reintentar} disabled={corriendo || enPausa}
          title={enPausa ? 'Finity rechazó hace poco: espera a que termine la pausa.' : undefined}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 10, border: `1px solid ${C.border2}`, background: 'transparent', color: C.text, fontWeight: 700, fontSize: 12.5, cursor: corriendo || enPausa ? 'default' : 'pointer', opacity: corriendo || enPausa ? 0.5 : 1 }}>
          <RefreshCw size={14} className={corriendo ? 'animate-spin' : undefined} />
          {corriendo ? 'Inscribiendo…' : `Reintentar inscripciones (${estado.pendientes})`}
        </button>
      )}
    </div>
  );
};
