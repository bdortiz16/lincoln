import React, { useCallback, useEffect, useRef, useState } from 'react';
import { llamarFuncion } from '../lib/edge';

// ─────────────────────────────────────────────
// Cupo mensual de UN beneficiario, dentro de su ficha.
//
// Normativa de Cumplimiento: en el mes se le puede enviar a una persona hasta
// 80 M y a una empresa hasta 800 M (o el cupo que Cumplimiento haya aprobado
// para ese beneficiario). Para enviar más se pide un aumento aquí, con el RUT
// (obligatorio) y, si se quiere, cámara de comercio y origen de fondos. La
// solicitud queda EN PROCESO hasta que el oficial de cumplimiento la revise.
// El servidor hace la cuenta (admin-data cupos_estado) y es el mismo que corta
// el envío: lo que se ve acá es lo que se aplica.
// ─────────────────────────────────────────────

const LBL: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#878E88', display: 'block', marginBottom: 5 };
const INP: React.CSSProperties = { width: '100%', height: 40, background: '#121413', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 9, padding: '0 12px', color: '#F4F4F2', fontSize: 13, outline: 'none', fontFamily: 'inherit' };
const cop = (n: unknown) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const DOCS: { tipo: 'rut' | 'camara' | 'fondos'; nombre: string; obligatorio: boolean }[] = [
  { tipo: 'rut', nombre: 'RUT', obligatorio: true },
  { tipo: 'camara', nombre: 'Cámara de comercio', obligatorio: false },
  { tipo: 'fondos', nombre: 'Origen de fondos', obligatorio: false },
];
const MIME_OK = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];

const leerBase64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result ?? ''));
  r.onerror = () => rej(new Error('No se pudo leer el archivo.'));
  r.readAsDataURL(f);
});

export const CupoBeneficiario: React.FC<{ userId: string; contactoId: string; nombre: string; abrirSolicitud?: boolean }> = ({ userId, contactoId, nombre, abrirSolicitud }) => {
  const [estado, setEstado] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [archivos, setArchivos] = useState<Record<string, File | null>>({});
  const [enviando, setEnviando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const enCurso = useRef(false);

  const cargar = useCallback(async () => {
    setError(null);
    const r = await llamarFuncion('admin-data', { action: 'cupos_estado', userId });
    if (r?.ok) setEstado(r.porContacto?.[contactoId] ?? null);
    else setError(r?.error ?? 'No se pudo leer el cupo.');
  }, [userId, contactoId]);
  useEffect(() => { cargar(); }, [cargar]);

  // Viene de "Solicitar aumento de cupo" en el menú de la fila: el formulario
  // se abre solo y la ficha baja hasta acá. Una vez, no cada vez que recarga.
  const raiz = useRef<HTMLDivElement>(null);
  const yaAbrio = useRef(false);
  const listo = !!estado;
  useEffect(() => {
    if (!abrirSolicitud || !listo || yaAbrio.current) return;
    yaAbrio.current = true;
    if (estado?.solicitud?.estado !== 'en_proceso') setAbierto(true);
    setTimeout(() => raiz.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, [abrirSolicitud, listo]);

  const enviar = async () => {
    if (enCurso.current) return;
    if (!archivos.rut) { setAviso({ ok: false, texto: 'Adjunta el RUT: es obligatorio.' }); return; }
    for (const d of DOCS) {
      const f = archivos[d.tipo];
      if (f && !MIME_OK.includes(f.type)) { setAviso({ ok: false, texto: `${d.nombre}: tiene que ser un PDF o una imagen (JPG, PNG, WEBP).` }); return; }
      if (f && f.size > 5 * 1024 * 1024) { setAviso({ ok: false, texto: `${d.nombre}: puede pesar hasta 5 MB.` }); return; }
    }
    enCurso.current = true;
    setAviso(null);
    try {
      const subidos: { tipo: string; path: string; nombre: string }[] = [];
      for (const d of DOCS) {
        const f = archivos[d.tipo];
        if (!f) continue;
        setEnviando(`Subiendo ${d.nombre}…`);
        const base64 = await leerBase64(f);
        const r = await llamarFuncion('admin-data', { action: 'cupo_subir_doc', userId, tipo: d.tipo, nombre: f.name, mime: f.type, base64 }, 90000);
        if (!r?.ok) { setAviso({ ok: false, texto: r?.error ?? `No se pudo subir ${d.nombre}.` }); return; }
        subidos.push({ tipo: d.tipo, path: r.path, nombre: r.nombre ?? f.name });
      }
      setEnviando('Enviando la solicitud…');
      const r = await llamarFuncion('admin-data', {
        action: 'cupo_solicitar', userId, contactoId, documentos: subidos,
        montoSolicitado: monto.replace(/\D/g, '') || undefined, motivo: motivo.trim() || undefined,
      });
      if (!r?.ok) { setAviso({ ok: false, texto: r?.error ?? 'No se pudo enviar la solicitud.' }); return; }
      setAviso({ ok: true, texto: 'Solicitud enviada. Queda en proceso de aumento: el equipo de cumplimiento la revisa y te avisamos.' });
      setAbierto(false); setArchivos({}); setMonto(''); setMotivo('');
      await cargar();
    } finally {
      enCurso.current = false;
      setEnviando(null);
    }
  };

  if (error) return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: '#878E88', marginBottom: 7 }}>CUPO MENSUAL</span>
      <p style={{ fontSize: 12, color: '#878E88' }}>{error}</p>
    </div>
  );
  if (!estado) return null;

  const pct = estado.cupo > 0 ? Math.min(100, Math.round(estado.usado / estado.cupo * 100)) : 0;
  const sol = estado.solicitud;
  const enProceso = sol?.estado === 'en_proceso';
  return (
    <div ref={raiz} style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center justify-between" style={{ gap: 8, marginBottom: 7 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: '#878E88' }}>CUPO MENSUAL</span>
        {enProceso && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.6px', color: '#FBBF24', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 999, padding: '3px 9px' }}>EN PROCESO DE AUMENTO</span>}
      </div>
      <div className="flex items-baseline justify-between" style={{ gap: 10 }}>
        <p style={{ fontSize: 13, color: '#F4F4F2', fontWeight: 700 }}>{cop(estado.usado)} <span style={{ color: '#878E88', fontWeight: 500 }}>de {cop(estado.cupo)}</span></p>
        <p style={{ fontSize: 12, color: estado.disponible > 0 ? '#878E88' : '#F87171' }}>Te quedan {cop(estado.disponible)}</p>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', marginTop: 8, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#F87171' : pct >= 80 ? '#FBBF24' : '#4ADE80', borderRadius: 3 }} />
      </div>
      <p style={{ fontSize: 11.5, color: '#878E88', marginTop: 7, lineHeight: 1.5 }}>
        {estado.origen === 'aprobado'
          ? `Cupo aprobado por cumplimiento para ${nombre || 'este beneficiario'}.`
          : `Cupo general para ${estado.tipo === 'empresa' ? 'empresas' : 'personas'}. Se reinicia el primer día de cada mes.`}
      </p>
      {sol?.estado === 'rechazada' && <p style={{ fontSize: 11.5, color: '#F87171', marginTop: 6, lineHeight: 1.5 }}>Tu última solicitud de aumento no fue aprobada{sol.nota ? `: ${sol.nota}` : '.'}</p>}
      {sol?.estado === 'aprobada' && estado.origen === 'aprobado' && <p style={{ fontSize: 11.5, color: '#4ADE80', marginTop: 6 }}>Aumento aprobado: {cop(sol.cupoAprobado)} al mes.</p>}
      {aviso && <p style={{ fontSize: 11.5, color: aviso.ok ? '#4ADE80' : '#F87171', marginTop: 8, lineHeight: 1.5 }}>{aviso.texto}</p>}

      {!enProceso && !abierto && (
        <button onClick={() => { setAbierto(true); setAviso(null); }}
          style={{ marginTop: 10, width: '100%', padding: '10px 0', borderRadius: 9, fontSize: 12.5, fontWeight: 700, color: '#F4F4F2', background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)' }}>
          Solicitar aumento de cupo
        </button>
      )}
      {enProceso && <p style={{ fontSize: 11.5, color: '#878E88', marginTop: 8, lineHeight: 1.5 }}>Enviaste la solicitud el {new Date(sol.at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}. El equipo de cumplimiento la está revisando y define el nuevo cupo.</p>}

      {abierto && (
        <div style={{ marginTop: 12, background: '#121413', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14 }}>
          <p style={{ fontSize: 12.5, color: '#F4F4F2', fontWeight: 700 }}>Solicitar aumento de cupo</p>
          <p style={{ fontSize: 11.5, color: '#878E88', marginTop: 4, lineHeight: 1.5 }}>Adjunta el RUT (obligatorio). La cámara de comercio y el origen de fondos ayudan a que la revisión sea más rápida. PDF o imagen, hasta 5 MB cada uno.</p>
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            {DOCS.map(d => (
              <div key={d.tipo}>
                <label style={LBL}>{d.nombre}{d.obligatorio ? ' · obligatorio' : ' · opcional'}</label>
                {/* El selector del navegador sale en inglés ("Choose File"):
                    se esconde y se usa un botón propio. */}
                <label style={{ ...INP, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" style={{ display: 'none' }}
                    onChange={e => setArchivos(a => ({ ...a, [d.tipo]: e.target.files?.[0] ?? null }))} />
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#0A0A0A', background: '#F4F4F2', borderRadius: 6, padding: '4px 10px', flexShrink: 0 }}>{archivos[d.tipo] ? 'Cambiar' : 'Elegir archivo'}</span>
                  <span style={{ fontSize: 12, color: archivos[d.tipo] ? '#F4F4F2' : '#878E88', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{archivos[d.tipo]?.name ?? 'Ningún archivo'}</span>
                </label>
              </div>
            ))}
            <div>
              <label style={LBL}>Cupo mensual que necesitas (opcional)</label>
              <input inputMode="numeric" value={monto ? Number(monto).toLocaleString('es-CO') : ''} onChange={e => setMonto(e.target.value.replace(/\D/g, '').slice(0, 13))} placeholder="Ej. 200.000.000" style={INP} />
            </div>
            <div>
              <label style={LBL}>Motivo (opcional)</label>
              <textarea value={motivo} onChange={e => setMotivo(e.target.value.slice(0, 1000))} rows={3} placeholder="Para qué son los envíos a este beneficiario"
                style={{ ...INP, height: 'auto', padding: '9px 12px', resize: 'vertical' }} />
            </div>
          </div>
          <div className="flex" style={{ gap: 8, marginTop: 12 }}>
            <button onClick={enviar} disabled={!!enviando} className="lincoin-btn-white"
              style={{ flex: 1, padding: '10px 0', borderRadius: 9, fontSize: 12.5, fontWeight: 700, border: 'none', opacity: enviando ? 0.6 : 1 }}>
              {enviando ?? 'Enviar solicitud'}
            </button>
            <button onClick={() => setAbierto(false)} disabled={!!enviando}
              style={{ flex: 1, padding: '10px 0', borderRadius: 9, fontSize: 12.5, fontWeight: 600, color: '#F4F4F2', background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
