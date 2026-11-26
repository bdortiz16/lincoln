import React, { useCallback, useEffect, useState } from 'react';
import { Gauge, RefreshCw, FileText, Check, X, Trash2 } from 'lucide-react';
import { pedirAdmin } from './adminApi';

// ─────────────────────────────────────────────
// Cumplimiento → Cupos por beneficiario.
//
// Normativa: en el mes, a una persona se le puede enviar hasta 80 M y a una
// empresa hasta 800 M (los generales se ajustan acá). Cuando un cliente
// necesita más para un beneficiario, lo pide desde Beneficiarios con el RUT
// (obligatorio) y, si quiere, cámara de comercio y origen de fondos. La
// solicitud llega aquí EN PROCESO y el oficial de cumplimiento decide el cupo
// nuevo, o la rechaza con un motivo que el cliente ve.
// ─────────────────────────────────────────────

const cop = (n: unknown) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const fecha = (iso: unknown) => { const d = new Date(String(iso ?? '')); return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const conPuntos = (v: string) => v ? Number(v).toLocaleString('es-CO') : '';

// ── Ventana de confirmación (tema Lincoin) ──────────────────
// Reemplaza el cuadro del navegador ("lincoin.me dice…"): ahí no se veía
// contra qué se estaba aprobando. Acá queda todo a la vista antes de decidir:
// cupo actual, lo enviado en el mes, cuánto le quedaría y si el número nuevo
// tiene sentido. Mismo patrón que la confirmación de cargues: alto tope,
// contenido que se desplaza y botones siempre visibles abajo.
type Modo = 'aprobar' | 'rechazar' | 'quitar';
const C = { fondo: '#121413', caja: '#0A0C0B', borde: 'rgba(255,255,255,0.10)', texto: '#F4F4F2', sub: '#878E88', tenue: 'rgba(244,244,242,0.45)', verde: '#4ADE80', rojo: '#F87171', ambar: '#FBBF24' };
const MOTIVOS_RECHAZO = ['Falta el RUT actualizado.', 'La cámara de comercio no corresponde al beneficiario.', 'Necesitamos el soporte del origen de los fondos.'];

const Fila: React.FC<{ l: React.ReactNode; v: React.ReactNode; color?: string; fuerte?: boolean }> = ({ l, v, color, fuerte }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
    <span style={{ fontSize: 12, color: C.sub }}>{l}</span>
    <span style={{ fontSize: 12.5, fontWeight: fuerte ? 800 : 700, color: color ?? C.texto, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{v}</span>
  </div>
);

const Ventana: React.FC<{
  modo: Modo; s: any; cupoInicial?: string; general?: number;
  onCerrar: () => void; onConfirmar: (datos: { cupo?: string; nota?: string }) => Promise<void>;
}> = ({ modo, s, cupoInicial = '', general, onCerrar, onConfirmar }) => {
  const [cupo, setCupo] = useState(cupoInicial);
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const actual = Math.round(Number(s.cupo_actual ?? s.cupo_mensual) || 0);
  const enviado = Math.round(Number(s.usadoHoy ?? s.usado_mes) || 0);
  const nuevo = Math.round(Number(cupo) || 0);
  const nombre = s.beneficiario_nombre || 'este beneficiario';
  const sube = nuevo > actual;
  const valido = modo === 'aprobar' ? sube : modo === 'rechazar' ? nota.trim().length >= 5 : true;
  // Sugerencias para no teclear ceros: lo pedido, y múltiplos del actual.
  // Números redondos: 1.200 M, no 1.201.000.000.
  const redondo = (n: number) => {
    const paso = n >= 1e9 ? 1e8 : n >= 1e8 ? 1e7 : 1e6;
    const r = Math.round(n / paso) * paso;
    return r > actual ? r : r + paso;
  };
  const sugeridos = Array.from(new Set([
    Math.round(Number(s.monto_solicitado) || 0),
    redondo(actual * 1.5), redondo(actual * 2), redondo(actual * 3),
  ].filter(n => n > actual))).slice(0, 4);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !ocupado) onCerrar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [ocupado, onCerrar]);

  const confirmar = async () => {
    if (!valido || ocupado) return;
    setOcupado(true);
    try { await onConfirmar({ cupo: modo === 'aprobar' ? String(nuevo) : undefined, nota: nota.trim() || undefined }); }
    finally { setOcupado(false); }
  };

  const titulo = modo === 'aprobar' ? 'Aprobar cupo mensual' : modo === 'rechazar' ? 'Rechazar solicitud de cupo' : 'Quitar cupo aprobado';
  const Icono = modo === 'aprobar' ? Gauge : modo === 'rechazar' ? X : Trash2;
  const tono = modo === 'aprobar' ? C.verde : C.rojo;
  const campo: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: C.caja, border: `1px solid ${C.borde}`, borderRadius: 10, padding: '10px 12px', color: C.texto, fontSize: 14, fontFamily: 'inherit', outline: 'none' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }} onClick={() => !ocupado && onCerrar()}>
      <div role="dialog" aria-modal="true" aria-label={titulo} onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 460, maxHeight: 'calc(100dvh - 24px)', display: 'flex', flexDirection: 'column', background: C.fondo, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, overflow: 'hidden', fontFamily: "'Archivo', system-ui, sans-serif", boxShadow: '0 24px 60px rgba(0,0,0,0.55)' }}>
        <div style={{ padding: '14px 16px 0', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', flexShrink: 0, background: modo === 'aprobar' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)', border: `1px solid ${modo === 'aprobar' ? 'rgba(74,222,128,0.32)' : 'rgba(248,113,113,0.32)'}` }}>
            <Icono size={16} style={{ color: tono }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: C.texto, letterSpacing: '-0.3px', margin: 0 }}>{titulo}</h3>
            <p style={{ fontSize: 12, color: C.sub, margin: '1px 0 0', lineHeight: 1.4 }}>
              <b style={{ color: C.texto }}>{nombre}</b> · {s.cliente}
            </p>
          </div>
        </div>

        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '12px 16px 4px' }}>
          <div style={{ padding: '10px 14px', background: C.caja, border: `1px solid ${C.borde}`, borderRadius: 12 }}>
            <Fila l="Beneficiario" v={`${s.beneficiario_tipo === 'empresa' ? 'Empresa' : 'Persona'}${s.beneficiario_doc ? ` · ${s.beneficiario_doc}` : ''}`} />
            <Fila l={modo === 'quitar' ? 'Cupo aprobado hoy' : 'Cupo actual'} v={cop(actual)} />
            {modo !== 'quitar' && <Fila l="Enviado este mes" v={cop(enviado)} />}
            {modo !== 'quitar' && <Fila l="Pide" v={s.monto_solicitado ? cop(s.monto_solicitado) : 'No dijo'} />}
            {modo !== 'quitar' && <Fila l="Documentos" v={`${(s.documentos ?? []).length}`} />}
            {modo === 'quitar' && general != null && <Fila l="Vuelve al cupo general" v={cop(general)} fuerte />}
          </div>
          {s.motivo && modo !== 'quitar' && (
            <p style={{ fontSize: 12, color: C.sub, lineHeight: 1.5, margin: '10px 2px 0' }}><b style={{ color: C.texto }}>Motivo del cliente:</b> {s.motivo}</p>
          )}

          {modo === 'aprobar' && (
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, marginBottom: 6 }}>CUPO MENSUAL NUEVO (COP)</label>
              <input autoFocus inputMode="numeric" value={conPuntos(cupo)} onChange={e => setCupo(e.target.value.replace(/\D/g, '').slice(0, 13))}
                placeholder={`Más de ${cop(actual)}`} style={{ ...campo, fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px' }} />
              {sugeridos.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {sugeridos.map(n => (
                    <button key={n} type="button" onClick={() => setCupo(String(n))}
                      style={{ fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                        background: nuevo === n ? 'rgba(74,222,128,0.14)' : 'transparent', color: nuevo === n ? C.verde : C.texto, border: `1px solid ${nuevo === n ? 'rgba(74,222,128,0.4)' : C.borde}` }}>
                      {n === Math.round(Number(s.monto_solicitado) || 0) ? `Lo pedido · ${cop(n)}` : cop(n)}
                    </button>
                  ))}
                </div>
              )}
              {nuevo > 0 && (
                <div style={{ marginTop: 10, padding: '8px 14px', background: C.caja, border: `1px solid ${C.borde}`, borderRadius: 12 }}>
                  <Fila l="Aumento" v={`${nuevo >= actual ? '+' : '−'} ${cop(Math.abs(nuevo - actual))}`} color={sube ? C.verde : C.ambar} />
                  <Fila l="Le quedaría este mes" v={cop(Math.max(0, nuevo - enviado))} fuerte color={sube ? C.verde : C.texto} />
                </div>
              )}
              {nuevo > 0 && !sube && (
                <p style={{ fontSize: 12, color: C.ambar, lineHeight: 1.5, margin: '9px 2px 0' }}>
                  El cupo nuevo tiene que ser mayor que el actual ({cop(actual)}); si no, el cliente no podría enviar más. Si no lo vas a subir, mejor rechaza la solicitud con una nota.
                </p>
              )}
              <label style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '12px 0 6px' }}>NOTA PARA EL CLIENTE (OPCIONAL)</label>
              <textarea value={nota} onChange={e => setNota(e.target.value.slice(0, 1000))} rows={2} placeholder="Ej. Aprobado con el RUT y la cámara de comercio enviados." style={{ ...campo, fontSize: 13, resize: 'vertical' }} />
            </div>
          )}

          {modo === 'rechazar' && (
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, marginBottom: 6 }}>MOTIVO DEL RECHAZO (LO VE EL CLIENTE)</label>
              <textarea autoFocus value={nota} onChange={e => setNota(e.target.value.slice(0, 1000))} rows={3} placeholder="Escribe qué falta o por qué no se aprueba." style={{ ...campo, fontSize: 13, resize: 'vertical' }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {MOTIVOS_RECHAZO.map(m => (
                  <button key={m} type="button" onClick={() => setNota(m)}
                    style={{ fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', background: 'transparent', color: C.texto, border: `1px solid ${C.borde}` }}>{m}</button>
                ))}
              </div>
              <p style={{ fontSize: 12, color: C.tenue, lineHeight: 1.5, margin: '9px 2px 0' }}>El beneficiario sigue con el cupo actual ({cop(actual)}). El cliente puede volver a pedir el aumento con los documentos que falten.</p>
            </div>
          )}

          {modo === 'quitar' && (
            <p style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.55, margin: '12px 2px 0' }}>
              El beneficiario vuelve al cupo general{general != null ? ` de ${cop(general)} al mes` : ''}. Si este mes ya se le envió más que eso, no se le podrá enviar nada más hasta el próximo mes.
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '12px 16px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
          <button type="button" onClick={onCerrar} disabled={ocupado}
            style={{ flex: 1, padding: '11px 0', borderRadius: 11, border: `1px solid ${C.borde}`, background: 'transparent', color: C.texto, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: ocupado ? 0.5 : 1 }}>
            Cancelar
          </button>
          <button type="button" onClick={confirmar} disabled={!valido || ocupado}
            style={{ flex: 1.4, padding: '11px 0', borderRadius: 11, border: 'none', fontSize: 13.5, fontWeight: 800, cursor: valido && !ocupado ? 'pointer' : 'default', fontFamily: 'inherit',
              background: modo === 'aprobar' ? C.verde : '#DC2626', color: modo === 'aprobar' ? '#0A0B0A' : '#FFFFFF', opacity: !valido || ocupado ? 0.45 : 1 }}>
            {ocupado ? 'Guardando…' : modo === 'aprobar' ? (nuevo > 0 ? `Aprobar ${cop(nuevo)}` : 'Aprobar cupo') : modo === 'rechazar' ? 'Rechazar solicitud' : 'Quitar cupo'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Detalle de un cupo ─────────────────────────────────────
// Al tocar un cliente/beneficiario de la lista: quién es el cliente, el cupo
// que rige y lo usado en el mes, cada solicitud con sus documentos (también
// las ya resueltas, que antes no se veían en ninguna parte) y las
// transferencias que le ha hecho a ese beneficiario. Lo arma el servidor
// (cupo_detalle) con la misma cuenta que corta el envío.
const ESTADO_ENVIO_C: Record<string, string> = { Completado: C.verde, Procesando: C.ambar, Pendiente: C.ambar, Fallido: C.rojo, Rechazado: C.rojo };
const DetalleCupo: React.FC<{ fila: any; onCerrar: () => void; onAbrirCliente?: (id: string) => void }> = ({ fila, onCerrar, onAbrirCliente }) => {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  useEffect(() => {
    let vivo = true;
    pedirAdmin({ action: 'cupo_detalle', userId: fila.user_id, clave: fila.beneficiario_clave, doc: fila.beneficiario_doc, nombre: fila.beneficiario_nombre, tipo: fila.beneficiario_tipo })
      .then(r => { if (!vivo) return; if (r?.ok) setD(r); else setError(r?.permisoDenegado ? 'Solo Cumplimiento ve el detalle de los cupos.' : (r?.error ?? 'No se pudo leer el detalle.')); })
      .catch(() => { if (vivo) setError('No se pudo leer el detalle.'); });
    return () => { vivo = false; };
  }, [fila]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onCerrar]);

  const caja: React.CSSProperties = { padding: '10px 14px', background: C.caja, border: `1px solid ${C.borde}`, borderRadius: 12 };
  const rot: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: C.sub, margin: '16px 0 8px' };
  const cli = d?.cliente, ben = d?.beneficiario, cupo = d?.cupo, res = d?.resumen;
  const envios: any[] = d?.envios ?? [];
  const visibles = verTodos ? envios : envios.slice(0, 15);
  const meses = Object.entries((res?.porMes ?? {}) as Record<string, number>).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  const pct = cupo?.vigente > 0 ? Math.min(100, (cupo.usadoMes / cupo.vigente) * 100) : 0;
  const KYC: Record<string, string> = { verified: 'Verificado', approved: 'Verificado', pending: 'Pendiente', in_review: 'En revisión', rejected: 'Rechazado' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 85, display: 'flex', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }} onClick={onCerrar}>
      <div role="dialog" aria-modal="true" aria-label="Detalle del cupo" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, height: '100%', display: 'flex', flexDirection: 'column', background: C.fondo, borderLeft: '1px solid rgba(255,255,255,0.12)', fontFamily: "'Archivo', system-ui, sans-serif", color: C.texto }}>
        <div style={{ padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 12, borderBottom: `1px solid ${C.borde}`, flexShrink: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 11, color: C.sub, margin: 0, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' }}>{fila.cliente}</p>
            <h3 style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.3px', margin: '3px 0 0', overflowWrap: 'anywhere' }}>{ben?.nombre || fila.beneficiario_nombre || 'Beneficiario'}</h3>
            <p style={{ fontSize: 12, color: C.sub, margin: '2px 0 0' }}>
              {(ben?.tipo ?? fila.beneficiario_tipo) === 'empresa' ? 'Empresa' : 'Persona'}{(ben?.doc ?? fila.beneficiario_doc) ? ` · ${ben?.doc ?? fila.beneficiario_doc}` : ''}
              {ben && !ben.enLibreta ? ' · ya no está en los beneficiarios del cliente' : ''}
            </p>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 9, color: C.texto, padding: 6, cursor: 'pointer', flexShrink: 0 }}><X size={15} /></button>
        </div>

        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '4px 18px 22px' }}>
          {error && <p style={{ marginTop: 16, fontSize: 13, color: C.rojo }}>{error}</p>}
          {!d && !error && <p style={{ marginTop: 16, fontSize: 13, color: C.sub }}>Cargando…</p>}
          {d && (<>
            {/* Cliente */}
            <p style={rot}>Cliente</p>
            <div style={caja}>
              <Fila l="Nombre" v={<span style={{ whiteSpace: 'normal', textAlign: 'right' }}>{cli.nombre}</span>} />
              <Fila l="Tipo" v={`${cli.tipo}${cli.nit ? ` · NIT ${cli.nit}` : ''}`} />
              <Fila l="Correo" v={<span style={{ fontWeight: 600 }}>{cli.email ?? '—'}</span>} />
              <Fila l="KYC" v={KYC[String(cli.kyc)] ?? cli.kyc ?? '—'} color={['verified', 'approved'].includes(String(cli.kyc)) ? C.verde : undefined} />
              <Fila l="Cliente desde" v={cli.desde ? fecha(cli.desde) : '—'} />
              <Fila l="Saldo COP (todas las cuentas)" v={cop(cli.saldoCop)} />
              {onAbrirCliente && (
                <button onClick={() => onAbrirCliente(String(cli.id))}
                  style={{ marginTop: 8, width: '100%', padding: '9px 0', borderRadius: 10, border: `1px solid ${C.borde}`, background: 'rgba(255,255,255,0.05)', color: C.texto, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Abrir la ficha completa del cliente (movimientos, KYC, documentos)
                </button>
              )}
            </div>

            {/* Cupo */}
            <p style={rot}>Cupo de este beneficiario</p>
            <div style={caja}>
              <Fila l="Cupo mensual que rige" v={cop(cupo.vigente)} fuerte />
              <Fila l={cupo.aprobado != null && cupo.aprobado > cupo.general ? 'Aprobado por Cumplimiento' : 'Cupo general'} v={cop(cupo.aprobado != null && cupo.aprobado > cupo.general ? cupo.aprobado : cupo.general)} />
              <Fila l="Enviado este mes" v={cop(cupo.usadoMes)} />
              <Fila l="Le queda este mes" v={cop(cupo.disponible)} color={cupo.disponible > 0 ? C.verde : C.rojo} />
              <div style={{ height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 5, marginTop: 6 }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 5, background: pct >= 100 ? C.rojo : pct >= 80 ? C.ambar : C.verde }} />
              </div>
            </div>

            {/* Solicitudes y documentos */}
            <p style={rot}>Solicitudes de aumento y documentos {d.solicitudes?.length ? `· ${d.solicitudes.length}` : ''}</p>
            {!d.solicitudes?.length ? <p style={{ fontSize: 12.5, color: C.tenue, margin: 0 }}>No hay solicitudes de aumento para este beneficiario.</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {d.solicitudes.map((s: any) => (
                  <div key={s.id} style={caja}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700 }}>Pedida el {fecha(s.created_at)}</span>
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: s.estado === 'aprobada' ? C.verde : s.estado === 'en_proceso' ? C.ambar : C.rojo }}>
                        {s.estado === 'aprobada' ? `Aprobada · ${cop(s.cupo_aprobado)}` : s.estado === 'en_proceso' ? 'En proceso' : 'Rechazada'}
                      </span>
                    </div>
                    <Fila l="Pidió" v={s.monto_solicitado ? cop(s.monto_solicitado) : 'No dijo'} />
                    {s.motivo && <p style={{ fontSize: 12, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}><b style={{ color: C.texto }}>Motivo del cliente:</b> {s.motivo}</p>}
                    {s.nota_revision && <p style={{ fontSize: 12, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}><b style={{ color: C.texto }}>Nota de Cumplimiento:</b> {s.nota_revision}{s.revisado_at ? ` · ${fecha(s.revisado_at)}` : ''}</p>}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {(s.documentos ?? []).length === 0 && <span style={{ fontSize: 11.5, color: C.tenue }}>Sin documentos adjuntos.</span>}
                      {(s.documentos ?? []).map((doc: any, i: number) => doc.url
                        ? <a key={i} href={doc.url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.borde}`, color: C.texto, textDecoration: 'none' }}><FileText size={12} /> {doc.nombreTipo}</a>
                        : <span key={i} style={{ fontSize: 11.5, color: C.tenue, padding: '5px 4px' }}>{doc.nombreTipo}: no se pudo abrir</span>)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Transferencias */}
            <p style={rot}>Transferencias a este beneficiario · 12 meses</p>
            <div style={{ ...caja, marginBottom: 8 }}>
              <Fila l="Total enviado" v={cop(res.total)} fuerte />
              <Fila l="Transferencias" v={`${res.cantidad}${res.noSalieron ? ` · ${res.noSalieron} no salieron` : ''}`} />
              {meses.map(([m, v]) => <Fila key={m} l={new Date(`${m}-15T12:00:00`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })} v={cop(v)} />)}
              {res.cortado && <p style={{ fontSize: 11, color: C.ambar, margin: '6px 0 0' }}>El cliente tiene muchísimos envíos: se revisaron los {Number(res.leidas).toLocaleString('es-CO')} más recientes.</p>}
            </div>
            {!envios.length ? <p style={{ fontSize: 12.5, color: C.tenue, margin: 0 }}>No le ha hecho transferencias en los últimos 12 meses.</p> : (
              <div style={{ border: `1px solid ${C.borde}`, borderRadius: 12, overflow: 'hidden' }}>
                {visibles.map((e, i) => {
                  const noSalio = e.devuelto || ['Fallido', 'Rechazado'].includes(String(e.estado));
                  return (
                    <div key={e.id} style={{ padding: '9px 12px', borderTop: i ? `1px solid ${C.borde}` : 'none', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 12.5, fontWeight: 700, margin: 0 }}>{e.riel}{e.cuenta ? ` · ${e.cuenta}` : ''}{e.proveedor ? ` · ${e.proveedor}` : ''}</p>
                        <p style={{ fontSize: 11, color: C.sub, margin: '2px 0 0', overflowWrap: 'anywhere' }}>{fecha(e.at)}{e.destino ? ` · ${e.destino}` : ''}{e.ref ? ` · ${e.ref}` : ''}</p>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums', textDecoration: noSalio ? 'line-through' : 'none', color: noSalio ? C.tenue : C.texto }}>{cop(e.monto)}</p>
                        <p style={{ fontSize: 10.5, fontWeight: 700, margin: '2px 0 0', color: e.devuelto ? C.rojo : (ESTADO_ENVIO_C[String(e.estado)] ?? C.sub) }}>{e.devuelto ? 'Devuelto' : e.estado}</p>
                      </div>
                    </div>
                  );
                })}
                {envios.length > 15 && (
                  <button onClick={() => setVerTodos(v => !v)} style={{ width: '100%', padding: '9px 0', background: 'rgba(255,255,255,0.03)', border: 'none', borderTop: `1px solid ${C.borde}`, color: C.texto, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {verTodos ? 'Ver las 15 más recientes' : `Ver las ${envios.length}`}
                  </button>
                )}
              </div>
            )}
          </>)}
        </div>
      </div>
    </div>
  );
};

const Solicitud: React.FC<{ s: any; onHecho: (m: string, ok: boolean) => void; onVer?: () => void }> = ({ s, onHecho, onVer }) => {
  const sugerido = String(Math.round(Number(s.monto_solicitado) || 0) || '');
  const [ventana, setVentana] = useState<Modo | null>(null);
  const resolver = async (aprobar: boolean, d: { cupo?: string; nota?: string }) => {
    const r = await pedirAdmin({ action: 'cupo_resolver', id: s.id, aprobar, cupo: aprobar ? d.cupo : undefined, nota: d.nota });
    if (r?.ok) {
      setVentana(null);
      onHecho(aprobar ? `Cupo de ${cop(d.cupo)} aprobado para ${s.beneficiario_nombre || 'el beneficiario'}.` : 'Solicitud rechazada. El cliente ve el motivo.', true);
    } else onHecho(r?.permisoDenegado ? 'Solo Cumplimiento puede resolver solicitudes de cupo.' : (r?.error ?? 'No se pudo guardar.'), false);
  };
  const usado = s.usadoHoy ?? s.usado_mes;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{s.cliente}</p>
          <p className="font-bold text-slate-800 text-sm">{s.beneficiario_nombre || 'Beneficiario sin nombre'}</p>
          <p className="text-[11px] text-slate-500">{s.beneficiario_tipo === 'empresa' ? 'Empresa' : 'Persona'}{s.beneficiario_doc ? ` · ${s.beneficiario_doc}` : ''} · pedida el {fecha(s.created_at)}</p>
        </div>
        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border border-amber-300 text-amber-700">EN PROCESO</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[10px] text-slate-400 font-bold uppercase">Cupo actual</p><p className="font-bold text-slate-800">{cop(s.cupo_actual)}</p></div>
        <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[10px] text-slate-400 font-bold uppercase">Enviado este mes</p><p className="font-bold text-slate-800">{cop(usado)}</p></div>
        <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[10px] text-slate-400 font-bold uppercase">Pide</p><p className="font-bold text-slate-800">{s.monto_solicitado ? cop(s.monto_solicitado) : 'No dijo'}</p></div>
        <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[10px] text-slate-400 font-bold uppercase">Documentos</p><p className="font-bold text-slate-800">{(s.documentos ?? []).length}</p></div>
      </div>
      {s.motivo && <p className="text-xs text-slate-600 leading-relaxed"><b className="text-slate-700">Motivo:</b> {s.motivo}</p>}
      <div className="flex flex-wrap gap-2">
        {(s.documentos ?? []).map((d: any, i: number) => d.url
          ? <a key={i} href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"><FileText size={13} /> {d.nombreTipo}</a>
          : <span key={i} className="text-xs text-slate-400 px-3 py-1.5">{d.nombreTipo}: no se pudo abrir</span>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setVentana('aprobar')} className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-lg bg-[#16A34A] text-white"><Check size={14} /> Aprobar cupo</button>
        <button onClick={() => setVentana('rechazar')} className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50"><X size={14} /> Rechazar</button>
        {onVer && <button onClick={onVer} className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">Ver cliente y transferencias</button>}
      </div>
      {ventana && (
        <Ventana modo={ventana} s={s} cupoInicial={Number(sugerido) > Number(s.cupo_actual) ? sugerido : ''}
          onCerrar={() => setVentana(null)} onConfirmar={d => resolver(ventana === 'aprobar', d)} />
      )}
    </div>
  );
};

export const AdminCupos: React.FC<{ onAbrirCliente?: (id: string) => void }> = ({ onAbrirCliente }) => {
  const [datos, setDatos] = useState<any | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [persona, setPersona] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const r = await pedirAdmin({ action: 'cupos_admin_get' });
    setCargando(false);
    if (r?.ok) { setDatos(r); setPersona(String(r.general?.persona ?? '')); setEmpresa(String(r.general?.empresa ?? '')); }
    else setAviso({ ok: false, texto: r?.permisoDenegado ? 'Solo Cumplimiento ve los cupos por beneficiario.' : (r?.error ?? 'No se pudieron leer los cupos.') });
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const hecho = (texto: string, ok: boolean) => { setAviso({ ok, texto }); if (ok) cargar(); };

  const guardarGeneral = async () => {
    setGuardando(true);
    const r = await pedirAdmin({ action: 'cupos_config_set', persona, empresa });
    setGuardando(false);
    hecho(r?.ok ? 'Cupos generales guardados.' : (r?.error ?? 'No se pudo guardar.'), !!r?.ok);
  };
  const [quitando, setQuitando] = useState<any | null>(null);
  // Fila cuyo detalle está abierto (cliente, cupo, documentos y transferencias).
  const [detalle, setDetalle] = useState<any | null>(null);
  const quitar = async (a: any) => {
    const r = await pedirAdmin({ action: 'cupo_quitar', userId: a.user_id, clave: a.beneficiario_clave });
    if (r?.ok) setQuitando(null);
    hecho(r?.ok ? 'Cupo quitado: rige el general.' : (r?.error ?? 'No se pudo quitar.'), !!r?.ok);
  };

  const solicitudes: any[] = datos?.solicitudes ?? [];
  const enProceso = solicitudes.filter(s => s.estado === 'en_proceso');
  const resueltas = solicitudes.filter(s => s.estado !== 'en_proceso');
  const aprobados: any[] = datos?.aprobados ?? [];
  const cambiado = !!datos && (Number(persona) !== Number(datos.general?.persona) || Number(empresa) !== Number(datos.general?.empresa));

  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><Gauge size={20} /> Cupos mensuales por beneficiario</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
            Lo máximo que un cliente le puede enviar a UN beneficiario en el mes (Bre-B y ACH suman juntos). Para enviar más, el cliente pide un aumento desde Beneficiarios con el RUT (obligatorio), cámara de comercio y origen de fondos (opcionales). La solicitud queda en proceso hasta que cumplimiento decida el cupo.
          </p>
        </div>
        <button onClick={cargar} disabled={cargando} className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={14} className={cargando ? 'animate-spin' : ''} /></button>
      </div>

      {aviso && <div className={`rounded-lg px-3 py-2 text-xs ${aviso.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{aviso.texto}</div>}
      {datos?.falta && <div className="rounded-lg px-3 py-2 text-xs bg-amber-50 text-amber-800 border border-amber-200">Falta correr la migración 2026_zz10_cupos_beneficiario.sql para recibir solicitudes. Mientras tanto ya rigen los cupos generales.</div>}

      <div className="grid sm:grid-cols-3 gap-3 items-end">
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Persona · al mes (COP)</label>
          <input inputMode="numeric" value={conPuntos(persona)} onChange={e => setPersona(e.target.value.replace(/\D/g, '').slice(0, 13))} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-mono" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Empresa · al mes (COP)</label>
          <input inputMode="numeric" value={conPuntos(empresa)} onChange={e => setEmpresa(e.target.value.replace(/\D/g, '').slice(0, 13))} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-mono" />
        </div>
        <button onClick={guardarGeneral} disabled={!cambiado || guardando} className="py-2.5 rounded-lg text-sm font-bold text-white bg-[#0C0E0D] hover:bg-[#161A17] disabled:opacity-50">{guardando ? 'Guardando…' : 'Guardar cupos generales'}</button>
      </div>

      <div>
        <h4 className="font-bold text-slate-800 text-sm mb-2">Solicitudes en proceso {enProceso.length ? `(${enProceso.length})` : ''}</h4>
        {!enProceso.length ? <p className="text-xs text-slate-400">No hay solicitudes por revisar.</p> : (
          <div className="space-y-3">{enProceso.map(s => <Solicitud key={s.id} s={s} onHecho={hecho} onVer={() => setDetalle(s)} />)}</div>
        )}
      </div>

      <div>
        <h4 className="font-bold text-slate-800 text-sm mb-2">Cupos aprobados vigentes</h4>
        {!aprobados.length ? <p className="text-xs text-slate-400">Todos los beneficiarios están con el cupo general.</p> : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs min-w-[640px]">
              <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                <tr><th className="text-left px-3 py-2">Cliente</th><th className="text-left px-3 py-2">Beneficiario</th><th className="text-right px-3 py-2">Cupo mensual</th><th className="text-left px-3 py-2">Aprobado</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {aprobados.map(a => (
                  <tr key={`${a.user_id}|${a.beneficiario_clave}`} onClick={() => setDetalle(a)} title="Ver cliente, documentos y transferencias" className="cursor-pointer hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-700 underline decoration-dotted underline-offset-2">{a.cliente}</td>
                    <td className="px-3 py-2"><p className="font-semibold text-slate-800">{a.beneficiario_nombre || '—'}</p><p className="text-[10px] text-slate-400">{a.beneficiario_tipo === 'empresa' ? 'Empresa' : 'Persona'}{a.beneficiario_doc ? ` · ${a.beneficiario_doc}` : ''}</p></td>
                    <td className="px-3 py-2 text-right font-bold text-slate-800">{cop(a.cupo_mensual)}</td>
                    <td className="px-3 py-2 text-slate-500">{fecha(a.aprobado_at)}</td>
                    <td className="px-3 py-2 text-right"><button onClick={e => { e.stopPropagation(); setQuitando(a); }} className="text-[11px] font-bold text-slate-400 hover:text-red-600 underline">Quitar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detalle && <DetalleCupo fila={detalle} onCerrar={() => setDetalle(null)} onAbrirCliente={onAbrirCliente ? (id => { setDetalle(null); onAbrirCliente(id); }) : undefined} />}

      {quitando && (
        <Ventana modo="quitar" s={quitando}
          general={Number(quitando.beneficiario_tipo === 'empresa' ? datos?.general?.empresa : datos?.general?.persona) || undefined}
          onCerrar={() => setQuitando(null)} onConfirmar={() => quitar(quitando)} />
      )}

      {resueltas.length > 0 && (
        <div>
          <h4 className="font-bold text-slate-800 text-sm mb-2">Revisadas</h4>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs min-w-[640px]">
              <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                <tr><th className="text-left px-3 py-2">Cliente</th><th className="text-left px-3 py-2">Beneficiario</th><th className="text-left px-3 py-2">Decisión</th><th className="text-left px-3 py-2">Nota</th><th className="text-left px-3 py-2">Fecha</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {resueltas.map(s => (
                  <tr key={s.id} onClick={() => setDetalle(s)} title="Ver cliente, documentos y transferencias" className="cursor-pointer hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-700 underline decoration-dotted underline-offset-2">{s.cliente}</td>
                    <td className="px-3 py-2 text-slate-700">{s.beneficiario_nombre || '—'}</td>
                    <td className="px-3 py-2">{s.estado === 'aprobada' ? <span className="font-bold text-[#16A34A]">Aprobada · {cop(s.cupo_aprobado)}</span> : <span className="font-bold text-red-600">Rechazada</span>}</td>
                    <td className="px-3 py-2 text-slate-500 max-w-[260px] break-words">{s.nota_revision || '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{fecha(s.revisado_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
