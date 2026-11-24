import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Copy, Check, RefreshCw, FileSpreadsheet, Send, ShieldAlert } from 'lucide-react';
import { pedirAdmin } from './adminApi';
import { descargarXlsx } from '../lib/xlsx';

// ─────────────────────────────────────────────
// Ficha para un ROS (Cumplimiento).
//
// 24 nov, el dueño eligió: "Ficha para el ROS — desde un caso de la Bandeja,
// Lincoin junta lo que pide el formulario de SIREL para copiarlo allá". El
// ROS no es un archivo plano: se diligencia en SIREL (Anexo 1 de la
// Resolución 314: «Reportes de Operación Sospechosa» → ROS → +Crear →
// Reporte positivo), con la información de la operación, la descripción,
// las personas implicadas y los soportes.
//
// Aquí se arman esas partes con lo que Lincoin tiene guardado (admin-data
// sirel_ros_ficha). La descripción es un BORRADOR con los hechos; lo que
// solo sabe el oficial —por qué es sospechosa, cómo se detectó— queda entre
// corchetes para que lo escriba él. Nada se califica solo.
// ─────────────────────────────────────────────

const C = { fondo: '#0C0E0D', caja: '#121413', borde: 'rgba(255,255,255,0.09)', texto: '#F4F4F2', sub: '#878E88', tenue: 'rgba(244,244,242,0.45)', verde: '#4ADE80', rojo: '#F87171', ambar: '#FBBF24' };
const TARJ: React.CSSProperties = { background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 14 };
const BTN: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 13px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: 'none', background: '#F4F4F2', color: '#15181A' };
const BTN2: React.CSSProperties = { ...BTN, background: 'rgba(255,255,255,0.05)', color: C.texto, border: '1px solid rgba(255,255,255,0.12)' };
const INP: React.CSSProperties = { height: 34, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', padding: '0 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none', background: C.fondo, color: C.texto };

const cop = (n: unknown) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const usd = (n: unknown) => `US$${(Number(n) || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dia = (iso: unknown) => { const t = Date.parse(String(iso ?? '')); return isNaN(t) ? '—' : new Date(t - 5 * 3600_000).toISOString().slice(0, 10); };
const fechaLarga = (iso: unknown) => { const d = new Date(String(iso ?? '')); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric' }); };
const hoyBogota = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
const restarDias = (ymd: string, d: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) - d * 86400_000).toISOString().slice(0, 10);
const sinSep = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const sinPunto = (v: unknown) => String(v ?? '').trim().replace(/[.\s]+$/, '');
// "Bogotá D.C., Bogotá D.C." → una sola vez cuando el municipio y el departamento se llaman igual.
const lugar = (m: unknown, d: unknown) => { const a = String(m ?? '').trim(), b = String(d ?? '').trim(); return !b || a.toLowerCase() === b.toLowerCase() ? a : `${a}, ${b}`; };

const TIPO: Record<string, string> = {
  cobro: 'Cobro recibido', pago: 'Pago enviado', recarga: 'Recarga de saldo',
  av_deposito: 'Depósito de activo virtual', av_retiro: 'Retiro de activo virtual', av_venta: 'Venta de activo virtual', av_compra: 'Compra de activo virtual',
};
const PLURAL: Record<string, string> = {
  cobro: 'cobros recibidos', pago: 'pagos enviados', recarga: 'recargas de saldo',
  av_deposito: 'depósitos de activos virtuales', av_retiro: 'retiros de activos virtuales', av_venta: 'ventas de activos virtuales', av_compra: 'compras de activos virtuales',
};

export type PersonaCaso = { nombre: string | null; tipoDocumento: string | null; documento: string | null; motivo?: string | null; hallazgos?: { nivel?: string; texto?: string }[] };

async function copiar(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; } catch { /* sin permiso */ }
  try {
    const t = document.createElement('textarea'); t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok;
  } catch { return false; }
}

const BotonCopiar: React.FC<{ texto: string; etiqueta?: string }> = ({ texto, etiqueta = 'Copiar' }) => {
  const [hecho, setHecho] = useState<null | boolean>(null);
  return (
    <button onClick={async () => { setHecho(await copiar(texto)); setTimeout(() => setHecho(null), 1800); }} style={{ ...BTN2, height: 30, fontSize: 12 }}>
      {hecho ? <Check size={13} style={{ color: C.verde }} /> : <Copy size={13} />} {hecho === null ? etiqueta : hecho ? 'Copiado' : 'No se pudo'}
    </button>
  );
};

const Seccion: React.FC<{ n: number; titulo: string; ayuda?: string; copiar?: string; children: React.ReactNode }> = ({ n, titulo, ayuda, copiar: txt, children }) => (
  <section style={{ ...TARJ, padding: '14px 16px', marginTop: 12 }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: C.texto }}><span style={{ color: C.sub, fontWeight: 700 }}>{n}.</span> {titulo}</p>
        {ayuda && <p style={{ margin: '3px 0 0', fontSize: 11.5, color: C.sub, lineHeight: 1.45 }}>{ayuda}</p>}
      </div>
      {txt && <BotonCopiar texto={txt} />}
    </div>
    <div style={{ marginTop: 10 }}>{children}</div>
  </section>
);

const Filas: React.FC<{ filas: [string, React.ReactNode][] }> = ({ filas }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 190px) 1fr', gap: '6px 14px', fontSize: 12.5 }}>
    {filas.map(([k, v]) => (
      <React.Fragment key={k}>
        <span style={{ color: C.sub }}>{k}</span>
        <span style={{ color: C.texto, fontWeight: 600, overflowWrap: 'anywhere' }}>{v ?? '—'}</span>
      </React.Fragment>
    ))}
  </div>
);

export const AdminRosFicha: React.FC<{
  userId: string; nombre?: string | null; persona?: PersonaCaso | null;
  desde?: string; hasta?: string; onCerrar: () => void; onAnotar?: () => void;
}> = ({ userId, nombre, persona, desde: desde0, hasta: hasta0, onCerrar, onAnotar }) => {
  const [hasta, setHasta] = useState(hasta0 ?? hoyBogota());
  const [desde, setDesde] = useState(desde0 ?? restarDias(hasta0 ?? hoyBogota(), 89));
  const [datos, setDatos] = useState<any>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [borrador, setBorrador] = useState('');
  const [editado, setEditado] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    const r = await pedirAdmin({ action: 'sirel_ros_ficha', userId, desde, hasta, documento: persona?.documento ?? undefined });
    setCargando(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo armar la ficha.'); return; }
    setDatos(r);
  }, [userId, desde, hasta, persona?.documento]);
  useEffect(() => { cargar(); }, [cargar]);

  const c = datos?.cliente;
  const movs: any[] = datos?.movimientos ?? [];
  const t = datos?.totales;
  const docCliente = c ? `${c.tipoDocumento ?? ''} ${c.documento ?? 'sin documento'}${c.dv != null && c.tipoDocumento === 'NIT' ? `-${c.dv}` : ''}`.trim() : '';

  // Las contrapartes con más plata, para la sección de personas.
  const contrapartes = useMemo(() => {
    const m = new Map<string, { nombre: string | null; tipoDoc: string | null; doc: string | null; banco: string | null; cuenta: string | null; n: number; cop: number; tipos: Set<string> }>();
    for (const x of movs) {
      const k = sinSep(x.contraparteDoc) || sinSep(x.contraparteCuenta) || String(x.contraparteNombre ?? '').toUpperCase();
      if (!k || x.contraparteNombre === 'Lincoin') continue;
      const a = m.get(k) ?? { nombre: x.contraparteNombre, tipoDoc: x.contraparteTipoDoc, doc: x.contraparteDoc, banco: x.contraparteBanco, cuenta: x.contraparteCuenta, n: 0, cop: 0, tipos: new Set<string>() };
      a.n++; a.cop += Number(x.montoCop) || 0; a.tipos.add(x.tipo);
      m.set(k, a);
    }
    return Array.from(m.values()).sort((a, b) => b.cop - a.cop).slice(0, 12);
  }, [movs]);

  const textoOperacion = t ? [
    `Valor de la operación: ${cop(t.cop)} COP`,
    t.usd ? `Equivalente en activos virtuales: ${usd(t.usd)} (${(t.activos ?? []).join(', ')})` : null,
    `Activos virtuales: ${(t.activos ?? []).length ? t.activos.join(', ') : 'Ninguno (operaciones en pesos)'}`,
    `Fecha inicial: ${dia(t.primera ?? datos.desde)}`,
    `Fecha final: ${dia(t.ultima ?? datos.hasta)}`,
    `Número de operaciones: ${t.movimientos}`,
  ].filter(Boolean).join('\n') : '';

  const textoPersonas = c ? [
    `CLIENTE`,
    `${c.nombre ?? 'Sin nombre'} · ${c.tipoPersona === 'juridica' ? 'Persona jurídica' : 'Persona natural'}`,
    `Identificación: ${c.tipoDocumento ?? ''} ${sinSep(c.documento)}${c.dv != null && c.tipoDocumento === 'NIT' ? ` (DV ${c.dv})` : ''}`,
    c.repNombre ? `Representante legal: ${c.repNombre}${c.repDocumento ? ` · ${c.repTipoDoc ?? ''} ${sinSep(c.repDocumento)}` : ''}` : null,
    `Dirección: ${c.direccion ?? 'sin dato'} · ${c.municipio ? lugar(c.municipio, c.departamento) : 'sin municipio'}${c.pais ? ` · ${c.pais}` : ''}`,
    `Teléfono: ${c.telefono ?? 'sin dato'} · Correo: ${c.correo ?? 'sin dato'}`,
    `Cliente desde: ${dia(c.vinculadoAt)}`,
    persona ? `\nPERSONA DEL CASO\n${persona.nombre ?? 'Sin nombre'} · ${persona.tipoDocumento ?? ''} ${sinSep(persona.documento)}` : null,
    contrapartes.length ? `\nCONTRAPARTES PRINCIPALES` : null,
    ...contrapartes.map(p => `${p.nombre ?? 'Sin nombre'}${p.doc ? ` · ${p.tipoDoc ?? ''} ${sinSep(p.doc)}` : ''}${p.banco ? ` · ${p.banco}` : ''}${p.cuenta ? ` · ${p.cuenta}` : ''} · ${p.n} operación(es) por ${cop(p.cop)}`),
  ].filter(x => x != null).join('\n') : '';

  // Borrador de la descripción, con la técnica que pide el Anexo 1 (primer
  // párrafo: quién, qué, cuándo, dónde; después el cuerpo). Lo que no está
  // en los datos va entre corchetes para que lo escriba el oficial.
  const borradorAuto = useMemo(() => {
    if (!c || !t) return '';
    const porTipo = Object.entries(t.porTipo ?? {}) as [string, { n: number; cop: number }][];
    const conPersona = persona ? ` con ${persona.nombre ?? 'la persona del caso'} (${persona.tipoDocumento ?? ''} ${sinSep(persona.documento)})` : '';
    const p1 = `${c.nombre ?? 'El cliente'} (${docCliente}), ${c.tipoPersona === 'juridica' ? 'persona jurídica' : 'persona natural'} con domicilio en ${c.municipio ? lugar(c.municipio, c.departamento) : '[municipio]'}, cliente desde el ${fechaLarga(c.vinculadoAt)}, realizó ${t.movimientos} operación(es)${conPersona} entre el ${fechaLarga(t.primera ?? `${datos.desde}T12:00:00Z`)} y el ${fechaLarga(t.ultima ?? `${datos.hasta}T12:00:00Z`)}, por un valor total de ${cop(t.cop)} COP${t.usd ? ` (${usd(t.usd)} en ${(t.activos ?? []).join(', ')})` : ''}. [Escribe aquí, en una o dos frases, qué hace que la operación sea sospechosa.]`;
    const p2 = porTipo.length ? `Las operaciones fueron: ${porTipo.map(([k, v]) => `${v.n} ${PLURAL[k] ?? k} por ${cop(v.cop)}`).join('; ')}.` : 'No hubo operaciones en el período.';
    const p3 = contrapartes.length ? `Las principales contrapartes fueron: ${contrapartes.slice(0, 6).map(p => `${p.nombre ?? 'sin nombre'}${p.doc ? ` (${p.tipoDoc ?? ''} ${sinSep(p.doc)})` : ''}, ${p.n} operación(es) por ${cop(p.cop)}`).join('; ')}.` : '';
    const halla = (persona?.hallazgos ?? []).filter(h => h?.texto).slice(0, 8);
    const p4 = persona ? `Sobre ${persona.nombre ?? 'la persona del caso'}: ${persona.motivo ? sinPunto(persona.motivo) : '[resultado de la verificación]'}${halla.length ? `. En la consulta de listas y antecedentes aparece: ${halla.map(h => `${String(h.nivel ?? '').toUpperCase()} · ${h.texto}`).join('; ')}` : ''}.` : '';
    const ws: any[] = datos?.wallets ?? [];
    const p5 = ws.length ? `Wallets asociadas al cliente: ${ws.slice(0, 6).map(w => `${w.address} (${w.coin}${w.nivel_actual ? `, riesgo ${String(w.nivel_actual).toLowerCase()}` : ''})`).join('; ')}.` : '';
    const p6 = `Datos del cliente: ${c.nombre ?? ''}, ${docCliente}${c.repNombre ? `, representante legal ${c.repNombre}${c.repDocumento ? ` (${c.repTipoDoc ?? ''} ${sinSep(c.repDocumento)})` : ''}` : ''}, dirección ${c.direccion ?? '[sin dato]'}, ${c.municipio ?? '[municipio]'}, teléfono ${c.telefono ?? '[sin dato]'}, correo ${c.correo ?? '[sin dato]'}.`;
    const p7 = '[Describe cómo se detectó: la señal de alerta o el procedimiento que la marcó como inusual, y por qué se determinó que es sospechosa. Compara con el perfil del cliente y su actividad económica.]';
    const p8 = '[Indica si se relaciona con un reporte anterior de la entidad, y si el cliente dio alguna explicación o soporte y cómo.]';
    const p9 = 'Se adjunta el detalle de las operaciones del período. [Agrega los demás soportes: RUT, certificado de cámara de comercio, extractos, comprobantes.]';
    return [p1, p2, p3, p4, p5, p6, p7, p8, p9].filter(Boolean).join('\n\n');
  }, [c, t, persona, contrapartes, datos, docCliente]);
  useEffect(() => { if (!editado) setBorrador(borradorAuto); }, [borradorAuto, editado]);

  const excel = () => {
    const cols = ['Fecha (Bogotá)', 'Tipo', 'Medio', 'Moneda', 'Monto', 'Monto COP', 'Contraparte', 'Tipo doc.', 'Documento', 'Banco', 'Cuenta / wallet', 'Referencia', 'Activo', 'Red', 'Hash', 'Id Lincoin'];
    const filas = movs.map(m => [dia(m.fecha), TIPO[m.tipo] ?? m.tipo, m.medio ?? '', m.moneda ?? '', m.monto ?? '', m.montoCop ?? '', m.contraparteNombre ?? '', m.contraparteTipoDoc ?? '', m.contraparteDoc ?? '', m.contraparteBanco ?? '', m.contraparteCuenta ?? '', m.referencia ?? '', m.activo ?? '', m.red ?? '', m.hash ?? '', m.id]);
    const base = sinSep(c?.nombre ?? 'cliente').slice(0, 24) || 'cliente';
    descargarXlsx(`ROS_soporte_${base}_${datos.desde}_${datos.hasta}.xlsx`, [{ nombre: 'Operaciones', filas: [cols, ...filas] }]);
  };

  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(4,5,4,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '24px 12px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Ficha para el ROS" style={{ width: 'min(920px, 100%)', background: C.caja, border: `1px solid ${C.borde}`, borderRadius: 18, padding: '18px 18px 22px', color: C.texto, fontFamily: "'Archivo', system-ui, sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px', minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: '-0.3px' }}>Ficha para el ROS</p>
            <p style={{ margin: '3px 0 0', fontSize: 12.5, color: C.sub }}>{c?.nombre ?? nombre ?? 'Cliente'}{persona ? ` · caso de ${persona.nombre ?? sinSep(persona.documento)}` : ''}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input type="date" value={desde} max={hasta} onChange={e => e.target.value && setDesde(e.target.value)} aria-label="Desde" style={INP} />
            <span style={{ color: C.sub, fontSize: 12 }}>a</span>
            <input type="date" value={hasta} max={hoyBogota()} onChange={e => e.target.value && setHasta(e.target.value)} aria-label="Hasta" style={INP} />
            <button onClick={cargar} disabled={cargando} style={BTN2}><RefreshCw size={13} className={cargando ? 'animate-spin' : ''} /> Actualizar</button>
            <button onClick={onCerrar} aria-label="Cerrar" style={{ ...BTN2, width: 34, padding: 0, justifyContent: 'center' }}><X size={15} /></button>
          </div>
        </div>

        <div style={{ ...TARJ, marginTop: 14, padding: '11px 14px', display: 'flex', gap: 10, alignItems: 'flex-start', borderColor: 'rgba(251,191,36,0.3)' }}>
          <ShieldAlert size={16} style={{ color: C.ambar, flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 12, color: '#FCD34D', lineHeight: 1.55 }}>
            El ROS se diligencia en SIREL: <b>Reportes de Operación Sospechosa → ROS → +Crear → Reporte positivo</b>, apenas se determina que la operación es sospechosa. Copia cada parte de esta ficha en su campo y adjunta los soportes en «¿Tiene anexos?» (máximo 20 MB por archivo). Nadie de la entidad puede contarle al cliente que se le reportó (art. 11, Ley 526 de 1999).
          </p>
        </div>

        {error && <p style={{ margin: '12px 0 0', fontSize: 13, color: C.rojo }}>{error}</p>}
        {!datos && !error && <p style={{ margin: '14px 0 0', fontSize: 13, color: C.sub }}>Juntando la información…</p>}

        {datos && c && t && (
          <>
            {datos.truncado && <p style={{ margin: '12px 0 0', fontSize: 12.5, color: C.ambar }}>El período tiene demasiados movimientos y se cortó la lectura: acórtalo.</p>}
            {persona && movs.length === 0 && <p style={{ margin: '12px 0 0', fontSize: 12.5, color: C.ambar }}>No hay operaciones de {c.nombre ?? 'este cliente'} con {persona.nombre ?? 'esta persona'} en el período. Amplía las fechas o repórtalo como operación intentada (valor 0).</p>}

            <Seccion n={1} titulo="Información de la operación" ayuda="Valor, activos virtuales y período (fecha inicial y final). Si es una operación intentada sin valor, la UIAF pide estimarlo o poner 0." copiar={textoOperacion}>
              <Filas filas={[
                ['Valor', `${cop(t.cop)} COP`],
                ['Equivalente en AV', t.usd ? `${usd(t.usd)} · ${(t.activos ?? []).join(', ')}` : 'Sin activos virtuales'],
                ['Fecha inicial', dia(t.primera ?? datos.desde)],
                ['Fecha final', dia(t.ultima ?? datos.hasta)],
                ['Operaciones', String(t.movimientos)],
              ]} />
            </Seccion>

            <Seccion n={2} titulo="Personas implicadas" ayuda="En SIREL van en los campos estructurados: números sin puntos, guiones ni ceros a la izquierda." copiar={textoPersonas}>
              <Filas filas={[
                ['Cliente', `${c.nombre ?? '—'} · ${c.tipoPersona === 'juridica' ? 'Jurídica' : 'Natural'}`],
                ['Identificación', `${c.tipoDocumento ?? ''} ${sinSep(c.documento) || 'sin documento'}${c.dv != null && c.tipoDocumento === 'NIT' ? ` · DV ${c.dv}` : ''}`],
                ['Representante legal', c.repNombre ? `${c.repNombre}${c.repDocumento ? ` · ${c.repTipoDoc ?? ''} ${sinSep(c.repDocumento)}` : ''}` : (c.tipoPersona === 'juridica' ? 'Sin dato' : 'No aplica')],
                ['Dirección', `${c.direccion ?? 'Sin dato'} · ${c.municipio ? lugar(c.municipio, c.departamento) : 'sin municipio'}`],
                ['Contacto', `${c.telefono ?? 'sin teléfono'} · ${c.correo ?? 'sin correo'}`],
                ...(persona ? [['Persona del caso', `${persona.nombre ?? '—'} · ${persona.tipoDocumento ?? ''} ${sinSep(persona.documento)}`] as [string, string]] : []),
              ]} />
              {contrapartes.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.sub, letterSpacing: '0.6px' }}>CONTRAPARTES PRINCIPALES</p>
                  {contrapartes.map((p, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderTop: i ? `1px solid ${C.borde}` : 'none', fontSize: 12.5, flexWrap: 'wrap' }}>
                      <span style={{ minWidth: 0, flex: '1 1 240px' }}>
                        <b>{p.nombre ?? 'Sin nombre'}</b>
                        <span style={{ display: 'block', color: C.sub, fontSize: 11.5, overflowWrap: 'anywhere' }}>{p.doc ? `${p.tipoDoc ?? ''} ${sinSep(p.doc)}` : 'Sin documento'}{p.banco ? ` · ${p.banco}` : ''}{p.cuenta ? ` · ${p.cuenta}` : ''}</span>
                      </span>
                      <span style={{ whiteSpace: 'nowrap', color: C.sub }}>{p.n} op. · <b style={{ color: C.texto }}>{cop(p.cop)}</b></span>
                    </div>
                  ))}
                </div>
              )}
            </Seccion>

            <Seccion n={3} titulo="Descripción de la operación (borrador)" ayuda="Primer párrafo: quién, qué, cuándo y dónde. Completa lo que está entre corchetes; solo tú sabes por qué es sospechosa. Puedes editar el texto aquí." copiar={borrador}>
              <textarea value={borrador} onChange={e => { setBorrador(e.target.value); setEditado(true); }} rows={14}
                style={{ width: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: C.fondo, color: C.texto, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.55, fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
              {editado && <button onClick={() => { setEditado(false); setBorrador(borradorAuto); }} style={{ background: 'none', border: 'none', padding: '6px 0 0', color: C.sub, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>Volver al borrador original</button>}
            </Seccion>

            <Seccion n={4} titulo={`Operaciones del período · ${movs.length}`} ayuda="Descarga el Excel y adjúntalo en SIREL como soporte.">
              <button onClick={excel} disabled={!movs.length} style={{ ...BTN2, opacity: movs.length ? 1 : 0.4 }}><FileSpreadsheet size={14} /> Excel de las operaciones</button>
              {movs.length > 0 && (
                <div style={{ overflowX: 'auto', marginTop: 10 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
                    <thead><tr style={{ color: C.tenue, fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase', textAlign: 'left' }}>
                      {['Fecha', 'Tipo', 'Monto', 'Contraparte'].map(h => <th key={h} style={{ padding: '7px 8px', fontWeight: 700, borderBottom: `1px solid ${C.borde}` }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {movs.slice(0, 60).map(m => (
                        <tr key={m.id} style={{ borderTop: `1px solid ${C.borde}` }}>
                          <td style={{ padding: '7px 8px', color: C.sub, whiteSpace: 'nowrap' }}>{dia(m.fecha)}</td>
                          <td style={{ padding: '7px 8px' }}>{TIPO[m.tipo] ?? m.tipo}<span style={{ display: 'block', color: C.sub, fontSize: 11 }}>{m.medio}</span></td>
                          <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>{m.activo ? `${Number(m.monto).toLocaleString('es-CO', { maximumFractionDigits: 6 })} ${m.activo}` : cop(m.monto)}{m.activo && m.montoCop ? <span style={{ display: 'block', color: C.sub, fontSize: 11 }}>{cop(m.montoCop)}</span> : null}</td>
                          <td style={{ padding: '7px 8px', overflowWrap: 'anywhere' }}>{m.contraparteNombre ?? m.contraparteCuenta ?? '—'}{m.contraparteDoc ? <span style={{ display: 'block', color: C.sub, fontSize: 11 }}>{m.contraparteTipoDoc ?? ''} {m.contraparteDoc}</span> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {movs.length > 60 && <p style={{ margin: '8px 0 0', fontSize: 11.5, color: C.sub }}>Se muestran 60 de {movs.length}. El Excel las trae todas.</p>}
                </div>
              )}
            </Seccion>

            {(datos.wallets ?? []).length > 0 && (
              <Seccion n={5} titulo="Wallets del cliente y su riesgo" ayuda="Las que verificó en la KYT, con el último nivel.">
                {(datos.wallets as any[]).map((w, i) => (
                  <div key={w.address + i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderTop: i ? `1px solid ${C.borde}` : 'none', fontSize: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace', overflowWrap: 'anywhere', minWidth: 0, flex: '1 1 300px' }}>{w.address}</span>
                    <span style={{ color: C.sub, whiteSpace: 'nowrap' }}>{w.coin}{w.nivel_actual ? ` · ${w.nivel_actual}` : ''}{w.score_actual != null ? ` · ${w.score_actual}/100` : ''}</span>
                  </div>
                ))}
              </Seccion>
            )}

            <Seccion n={(datos.wallets ?? []).length > 0 ? 6 : 5} titulo="ROS anteriores de la entidad" ayuda="Si esta operación se relaciona con uno de ellos, menciónalo en la descripción.">
              {(datos.rosPrevios ?? []).length === 0
                ? <p style={{ margin: 0, fontSize: 12.5, color: C.sub }}>No hay ROS anotados en Lincoin.</p>
                : (datos.rosPrevios as any[]).map((e, i) => (
                  <p key={e.id ?? i} style={{ margin: i ? '6px 0 0' : 0, fontSize: 12.5 }}>Radicado <b>{e.radicado}</b> · {dia(e.at)}{e.nota ? <span style={{ color: C.sub }}> · {e.nota}</span> : null}</p>
                ))}
            </Seccion>

            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              {!onAnotar && <span style={{ fontSize: 11.5, color: C.sub, marginRight: 'auto' }}>Cuando lo envíes, anota el radicado en Cumplimiento → SIREL → «Anotar ROS».</span>}
              <button onClick={onCerrar} style={BTN2}>Cerrar</button>
              {onAnotar && <button onClick={onAnotar} style={BTN}><Send size={14} /> Ya lo envié: anotar radicado</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
