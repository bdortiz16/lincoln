// ══════════════════════════════════════════════════════════════════
//  Configuración de la facturación automática — Lincoin Empresas
//
//  El cliente conecta SU cuenta de Siigo: pone el usuario y la access key de
//  la API, prueba la conexión, y desde ahí configura qué sale por cada
//  operación completada:
//
//    1. Credenciales.
//    2. QUÉ DOCUMENTO sale por cada tipo de operación: factura de venta
//       (plata que entra), documento soporte (plata que sale a alguien que
//       no factura), o nada.
//    3. Qué comprobantes de su Siigo usa cada documento (tipo, vendedor,
//       forma de pago). Se eligen de los catálogos que devolvió Siigo.
//    4. LOS ÍTEMS: las líneas del documento. Producto de Siigo, descripción,
//       cantidad, cómo se calcula el valor (el monto de la operación, un
//       porcentaje, o un fijo) e impuesto.
//    5. La contraparte por defecto, DIAN y correo.
//
//  LA ACCESS KEY NO VUELVE A LA PANTALLA. Se manda una vez, el servidor la
//  cifra, y acá solo se ve "hay una guardada". Para cambiarla se escribe
//  otra. Un campo que muestre el secreto guardado es un secreto que ya no lo
//  es.
//
//  NADA DE IDS INVENTADOS. Los selectores se llenan con lo que Siigo devolvió
//  al probar la conexión. Si no se ha probado, están vacíos y lo dicen.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';

const FONT = 'Archivo, system-ui, sans-serif';
const C = {
  fondo: '#0C0E0D', borde: 'rgba(255,255,255,0.10)', bordeSuave: 'rgba(255,255,255,0.08)',
  text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c', verde: '#4ADE80', rojo: '#F87171', ambar: '#FBBF24',
  campo: '#121413', elevado: '#121413',
};

type Item = { code: string; description: string; quantity: number; valor: 'monto' | 'porcentaje' | 'fijo'; porcentaje: number; fijo: number; tax_id: number | null };
type Cfg = {
  existe: boolean; activo: boolean; username?: string | null; tieneAccessKey: boolean; partner_id?: string | null;
  access_key_pista?: { largo: number; inicio: string; fin: string } | null;
  document_id?: number | null; seller_id?: number | null; payment_id?: number | null;
  ds_document_id?: number | null; ds_payment_id?: number | null;
  product_code?: string | null; product_description?: string | null;
  documentos?: Record<string, 'FV' | 'DS'> | null; items?: Item[] | null;
  cliente_default_nit?: string | null; cliente_default_nombre?: string | null; crear_clientes: boolean;
  disparadores: string[]; stamp: boolean; mail: boolean; observaciones?: string | null;
  ultimo_test_at?: string | null; ultimo_test_ok?: boolean | null; ultimo_error?: string | null;
  catalogos?: any; resumen?: { emitidas: number; errores: number; pendientes: number; omitidas: number; comprobantes: number };
};

const Campo: React.FC<{ rot: string; ayuda?: string; children: React.ReactNode }> = ({ rot, ayuda, children }) => (
  <label style={{ display: 'block' }}>
    <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, marginBottom: 6 }}>{rot}</span>
    {children}
    {ayuda && <span style={{ display: 'block', fontSize: 11, color: C.tenue, marginTop: 4, lineHeight: 1.45 }}>{ayuda}</span>}
  </label>
);
const entrada: React.CSSProperties = { fontFamily: FONT, width: '100%', fontSize: 13.5, color: C.text, background: C.campo, border: `1px solid ${C.borde}`, borderRadius: 9, padding: '10px 12px', outline: 'none' };
const selectEstilo: React.CSSProperties = { ...entrada, appearance: 'auto' };
const Seccion: React.FC<{ n: string; t: string; children: React.ReactNode }> = ({ n, t, children }) => (
  <div style={{ paddingTop: 18, marginTop: 18, borderTop: `1px solid ${C.bordeSuave}` }}>
    <p style={{ fontSize: 13.5, fontWeight: 800, color: C.text, margin: '0 0 12px' }}><span style={{ color: C.sub, marginRight: 8 }}>{n}</span>{t}</p>
    {children}
  </div>
);

// Las entradas de plata emiten factura de venta por defecto. Las salidas no
// emiten nada hasta que el cliente lo decida: un envío puede ser una compra a
// alguien que factura (y entonces no va documento soporte) o a alguien que no.
const ENTRADAS = new Set(['load', 'pay_received', 'otc_deposit']);
const itemVacio = (code = '', description = ''): Item => ({ code, description, quantity: 1, valor: 'monto', porcentaje: 100, fijo: 0, tax_id: null });
const fmtCop = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 0 });

export const FacturacionConfig: React.FC<{ onCerrar: () => void }> = ({ onCerrar }) => {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [disparadores, setDisparadores] = useState<Record<string, string>>({});
  const [form, setForm] = useState<any>({});
  const [accessKey, setAccessKey] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const cargar = async () => {
    setCargando(true);
    const r = await llamarFuncion('facturacion', { action: 'config_get' }, 20000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setCargando(false);
    if (!r?.ok) { setAviso({ ok: false, texto: r?.error ?? r?.mensaje ?? 'No se pudo leer la configuración.' }); return; }
    const c: Cfg = r.config;
    setCfg(c); setDisparadores(r.disparadores ?? {});
    // Lo nuevo si está; si no, lo viejo traducido: disparadores marcados →
    // factura de venta; producto elegido → un ítem por el monto.
    const documentos: Record<string, string> = c.documentos && typeof c.documentos === 'object'
      ? { ...c.documentos }
      : Object.fromEntries((c.disparadores ?? ['load', 'pay_received']).map(k => [k, 'FV']));
    const items: Item[] = Array.isArray(c.items) && c.items.length
      ? c.items.map(i => ({ ...itemVacio(), ...i }))
      : c.product_code ? [itemVacio(c.product_code, c.product_description ?? '')] : [];
    setForm({
      username: c.username ?? '', partner_id: c.partner_id ?? '',
      document_id: c.document_id ?? '', seller_id: c.seller_id ?? '', payment_id: c.payment_id ?? '',
      ds_document_id: c.ds_document_id ?? '', ds_payment_id: c.ds_payment_id ?? '',
      documentos, items,
      cliente_default_nit: c.cliente_default_nit ?? '222222222222', cliente_default_nombre: c.cliente_default_nombre ?? 'Consumidor final',
      crear_clientes: c.crear_clientes ?? true,
      stamp: c.stamp ?? true, mail: c.mail ?? true, observaciones: c.observaciones ?? '', activo: c.activo ?? false,
    });
  };
  useEffect(() => { cargar(); }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onCerrar]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const setDoc = (tipo: string, v: string) => setForm((f: any) => {
    const d = { ...(f.documentos ?? {}) };
    if (v === 'FV' || v === 'DS') d[tipo] = v; else delete d[tipo];
    return { ...f, documentos: d };
  });
  const setItem = (i: number, patch: Partial<Item>) => setForm((f: any) => ({ ...f, items: (f.items ?? []).map((it: Item, j: number) => j === i ? { ...it, ...patch } : it) }));
  const quitarItem = (i: number) => setForm((f: any) => ({ ...f, items: (f.items ?? []).filter((_: Item, j: number) => j !== i) }));
  const agregarItem = () => setForm((f: any) => ({ ...f, items: [...(f.items ?? []), itemVacio()] }));

  const guardar = async (extra: Record<string, any> = {}) => {
    setGuardando(true); setAviso(null);
    const llave = accessKey.replace(/\s+/g, '');
    const config = { ...form, ...extra, ...(llave ? { access_key: llave } : {}) };
    const r = await llamarFuncion('facturacion', { action: 'config_set', config }, 30000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setGuardando(false);
    if (!r?.ok) { setAviso({ ok: false, texto: r?.error ?? 'No se pudo guardar.' }); return false; }
    setCfg(r.config); setAccessKey('');
    if ('activo' in extra) set('activo', extra.activo);
    setAviso({ ok: true, texto: 'activo' in extra ? (extra.activo ? 'Facturación automática activada.' : 'Facturación automática pausada.') : 'Guardado.' });
    return true;
  };

  const probar = async () => {
    // Se guarda primero: probar con credenciales que no están guardadas
    // produciría un "conectó" que no sobrevive a cerrar la ventana.
    if (!(await guardar())) return;
    setProbando(true); setAviso(null);
    const r = await llamarFuncion('facturacion', { action: 'probar' }, 60000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setProbando(false);
    if (r?.config) setCfg(r.config);
    if (!r?.ok) { setAviso({ ok: false, texto: r?.error ?? 'Siigo no respondió.' }); return; }
    setAviso({ ok: true, texto: r.aviso ? `Conectó con Siigo, pero: ${r.aviso}` : 'Conectó con Siigo. Ahora elegí qué sale por cada operación, los comprobantes y los ítems.' });
  };

  const cat = cfg?.catalogos;
  const docs: Record<string, string> = form.documentos ?? {};
  const usaFV = Object.values(docs).includes('FV');
  const usaDS = Object.values(docs).includes('DS');
  const items: Item[] = form.items ?? [];
  const itemsOk = items.length > 0 && items.every(i => !!i.code);
  const credOk = !!form.username && !!(cfg?.tieneAccessKey || accessKey.trim());
  const listo = credOk
    && Object.keys(docs).length > 0
    && (!usaFV || (!!form.document_id && !!form.seller_id && !!form.payment_id))
    && (!usaDS || (!!form.ds_document_id && !!form.ds_payment_id))
    && itemsOk;
  const queFalta = [
    !credOk ? 'credenciales' : '',
    !Object.keys(docs).length ? 'qué documento sale por cada operación' : '',
    usaFV && !(form.document_id && form.seller_id && form.payment_id) ? 'comprobantes de la factura de venta' : '',
    usaDS && !(form.ds_document_id && form.ds_payment_id) ? 'comprobantes del documento soporte' : '',
    !itemsOk ? 'los ítems' : '',
  ].filter(Boolean).join(', ');
  const fecha = (s?: string | null) => s ? new Date(s).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const chk = (k: string, rot: string, ayuda?: string) => (
    <label className="flex items-start" style={{ gap: 9, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)} style={{ width: 15, height: 15, accentColor: C.verde, marginTop: 2 }} />
      <span><span style={{ fontSize: 13, color: C.text }}>{rot}</span>{ayuda && <span style={{ display: 'block', fontSize: 11, color: C.tenue, marginTop: 2 }}>{ayuda}</span>}</span>
    </label>
  );
  const select = (k: string, opciones: { v: string | number; t: string }[], vacio: string) => (
    <select value={String(form[k] ?? '')} onChange={e => set(k, e.target.value)} style={selectEstilo} disabled={!opciones.length}>
      <option value="">{opciones.length ? 'Elegir…' : vacio}</option>
      {opciones.map(o => <option key={String(o.v)} value={String(o.v)}>{o.t}</option>)}
    </select>
  );
  // Ejemplo con una operación de un millón, para que se vea qué produce
  // cada regla sin tener que esperar una operación real.
  const EJEMPLO = 1_000_000;
  const valorEjemplo = (i: Item) => {
    const base = i.valor === 'porcentaje' ? EJEMPLO * (Number(i.porcentaje) || 0) / 100 : i.valor === 'fijo' ? (Number(i.fijo) || 0) : EJEMPLO;
    const tax = i.tax_id ? (cat?.impuestos ?? []).find((t: any) => Number(t.id) === Number(i.tax_id)) : null;
    const pct = tax ? Number(tax.percentage) || 0 : 0;
    return base * (Number(i.quantity) || 1) * (1 + pct / 100);
  };
  const totalEjemplo = items.reduce((s, i) => s + valorEjemplo(i), 0);
  const sinCatalogoDs = !!cat && !Array.isArray(cat.documentos_ds);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(4,5,5,0.78)' }} onClick={onCerrar}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 760, maxHeight: '94vh', display: 'flex', flexDirection: 'column', background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 16, overflow: 'hidden', fontFamily: FONT }}>
        <div className="flex items-start justify-between" style={{ gap: 12, padding: '18px 24px 14px', borderBottom: `1px solid ${C.bordeSuave}` }}>
          <div>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: C.sub, margin: 0 }}>CONFIGURACIÓN</p>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: C.text, margin: '3px 0 0', letterSpacing: '-0.3px' }}>Facturación automática con Siigo</h3>
            <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0', lineHeight: 1.5 }}>Apenas una operación se completa, se emite el documento en tu Siigo, con tus credenciales. Lincoin no factura nada por vos: opera tu cuenta.</p>
          </div>
          <button onClick={onCerrar} style={{ color: C.sub, flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer' }} className="hover:text-[#F4F4F2] transition-colors"><X size={18} /></button>
        </div>

        <div style={{ overflowY: 'auto', padding: '6px 24px 22px' }}>
          {cargando ? <p style={{ fontSize: 13, color: C.sub, padding: '20px 0' }}>Leyendo la configuración…</p> : (
            <>
              {/* Estado */}
              <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, border: `1px solid ${cfg?.activo ? 'rgba(74,222,128,0.35)' : C.borde}`, background: cfg?.activo ? 'rgba(74,222,128,0.06)' : 'transparent' }}>
                <div className="flex items-center justify-between flex-wrap" style={{ gap: 10 }}>
                  <div>
                    <p className="flex items-center" style={{ gap: 8, fontSize: 13.5, fontWeight: 700, color: C.text, margin: 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: cfg?.activo ? C.verde : 'rgba(255,255,255,0.18)' }} />
                      {cfg?.activo ? 'Activa: cada operación completada emite su documento' : 'Pausada: no se emite ningún documento'}
                    </p>
                    <p style={{ fontSize: 11.5, color: C.sub, margin: '4px 0 0' }}>
                      {cfg?.ultimo_test_at ? `Última prueba ${fecha(cfg.ultimo_test_at)} · ${cfg.ultimo_test_ok ? 'conectó' : 'falló'}` : 'Todavía no se probó la conexión'}
                      {cfg?.resumen && cfg.resumen.comprobantes > 0 ? ` · ${cfg.resumen.emitidas} emitidos · ${cfg.resumen.errores} con error` : ''}
                    </p>
                  </div>
                  <button onClick={() => guardar({ activo: !form.activo })} disabled={guardando || (!form.activo && !listo)}
                    title={!form.activo && !listo ? `Falta: ${queFalta}` : undefined}
                    style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: '8px 14px', borderRadius: 9, cursor: 'pointer', border: 'none', opacity: (!form.activo && !listo) ? 0.5 : 1,
                      background: form.activo ? 'rgba(255,255,255,0.06)' : C.text, color: form.activo ? C.text : '#0A0A0A' }}>
                    {guardando ? '…' : form.activo ? 'Pausar' : 'Activar'}
                  </button>
                </div>
                {!form.activo && !listo && queFalta && (
                  <p style={{ fontSize: 11.5, color: C.tenue, margin: '8px 0 0', lineHeight: 1.5 }}>Para activar falta: {queFalta}.</p>
                )}
                {cfg?.ultimo_error && <p style={{ fontSize: 11.5, color: cfg.ultimo_test_ok ? C.ambar : C.rojo, margin: '8px 0 0', lineHeight: 1.5, wordBreak: 'break-word' }}>{cfg.ultimo_error}</p>}
                {/* Siigo dice "invalid_value: access_key" cuando la clave no es
                    la de ese usuario. Casi siempre es una de tres cosas, y se
                    dicen acá para no adivinar. */}
                {cfg?.ultimo_error && /access_key|username|invalid_value|401/i.test(cfg.ultimo_error) && !cfg.ultimo_test_ok && (
                  <p style={{ fontSize: 11.5, color: C.sub, margin: '6px 0 0', lineHeight: 1.55 }}>
                    Siigo no reconoce esa access key para ese usuario. No es la contraseña de Siigo Nube: es la clave que genera el
                    portal de clientes en «Generar credenciales API», para ese mismo correo. Generala de nuevo, pegala completa y
                    probá otra vez. Abajo se ve cuántos caracteres tiene la guardada, para compararla con la del portal.
                  </p>
                )}
              </div>

              {/* 1. Credenciales */}
              <Seccion n="1" t="Credenciales de la API de Siigo">
                <p style={{ fontSize: 12, color: C.sub, margin: '0 0 12px', lineHeight: 1.55 }}>
                  Se generan en el portal de clientes de Siigo, en «Generar credenciales API». El usuario es el correo de la cuenta; la access key es la clave que Siigo genera para la API (no la contraseña de entrar).
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  <Campo rot="USUARIO (CORREO)"><input value={form.username ?? ''} onChange={e => set('username', e.target.value)} placeholder="cuenta@empresa.com" autoComplete="off" style={entrada} /></Campo>
                  <Campo rot="ACCESS KEY" ayuda={cfg?.tieneAccessKey
                    ? `Hay una guardada${cfg.access_key_pista ? `: ${cfg.access_key_pista.largo} caracteres, empieza «${cfg.access_key_pista.inicio}…» y termina «…${cfg.access_key_pista.fin}»` : ''}. Dejá esto vacío para conservarla; escribí otra para reemplazarla.`
                    : 'No se muestra después de guardarla.'}>
                    <input type="password" value={accessKey} onChange={e => setAccessKey(e.target.value)} placeholder={cfg?.tieneAccessKey ? '••••••••••••' : 'Pegá la access key'} autoComplete="new-password" style={entrada} />
                  </Campo>
                  <Campo rot="PARTNER ID" ayuda="El nombre con que Siigo identifica la integración. Si no te dieron uno, dejá Lincoin.">
                    <input value={form.partner_id ?? ''} onChange={e => set('partner_id', e.target.value)} placeholder="Lincoin" style={entrada} />
                  </Campo>
                </div>
                <div className="flex items-center flex-wrap" style={{ gap: 8, marginTop: 12 }}>
                  <button onClick={probar} disabled={probando || guardando || !credOk}
                    className="lincoin-btn-white" style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: '9px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', opacity: (probando || !credOk) ? 0.5 : 1 }}>
                    {probando ? 'Conectando con Siigo…' : 'Guardar y probar conexión'}
                  </button>
                  <span style={{ fontSize: 11.5, color: C.tenue }}>Trae de tu cuenta los comprobantes, vendedores, formas de pago, productos e impuestos.</span>
                </div>
              </Seccion>

              {/* 2. Qué documento sale */}
              <Seccion n="2" t="Qué documento sale por cada operación">
                <p style={{ fontSize: 12, color: C.sub, margin: '0 0 12px', lineHeight: 1.55 }}>
                  <b style={{ color: C.text }}>Factura de venta</b> cuando te <b style={{ color: C.text }}>entra</b> plata: le facturás a quien te pagó.{' '}
                  <b style={{ color: C.text }}>Documento soporte</b> cuando te <b style={{ color: C.text }}>sale</b> plata hacia alguien que no está obligado a facturar: es el documento que la DIAN exige por esa compra. Si el que recibe sí te factura, no emitas nada.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 8 }}>
                  {Object.entries(disparadores).map(([k, rot]) => {
                    const v = docs[k] ?? '';
                    return (
                      <div key={k} className="flex items-center justify-between" style={{ gap: 10, padding: '9px 12px', borderRadius: 10, border: `1px solid ${v ? 'rgba(74,222,128,0.28)' : C.bordeSuave}`, background: v ? 'rgba(74,222,128,0.04)' : 'transparent' }}>
                        <span style={{ fontSize: 13, color: C.text }}>
                          {rot}
                          <span style={{ display: 'block', fontSize: 10.5, color: C.tenue, marginTop: 1 }}>{ENTRADAS.has(k) ? 'plata que entra' : k === 'convert' ? 'cambio de moneda' : 'plata que sale'}</span>
                        </span>
                        <select value={v} onChange={e => setDoc(k, e.target.value)} style={{ ...selectEstilo, width: 'auto', minWidth: 170, padding: '7px 10px', fontSize: 12.5 }}>
                          <option value="">No emitir nada</option>
                          <option value="FV">Factura de venta</option>
                          <option value="DS">Documento soporte</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              </Seccion>

              {/* 3. Comprobantes de Siigo */}
              <Seccion n="3" t="Comprobantes de tu Siigo">
                {!cat ? (
                  <p style={{ fontSize: 12.5, color: C.tenue, margin: 0 }}>Probá la conexión para traer los catálogos de tu Siigo. Sin eso no hay nada que elegir: los ids son de tu cuenta, no se pueden adivinar.</p>
                ) : !usaFV && !usaDS ? (
                  <p style={{ fontSize: 12.5, color: C.tenue, margin: 0 }}>Elegí arriba qué documento sale por cada operación; acá se configura cada uno.</p>
                ) : (
                  <>
                    {usaFV && (
                      <div style={{ marginBottom: usaDS ? 16 : 0 }}>
                        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', color: C.verde, margin: '0 0 10px' }}>FACTURA DE VENTA</p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                          <Campo rot="TIPO DE COMPROBANTE (FV)" ayuda={cat.fuentes?.documentos?.motivo ?? undefined}>
                            {select('document_id', (cat.documentos ?? []).map((d: any) => ({ v: d.id, t: `${d.code ? d.code + ' · ' : ''}${d.name}` })), 'Siigo no devolvió tipos de factura')}
                          </Campo>
                          <Campo rot="VENDEDOR" ayuda={cat.fuentes?.vendedores?.motivo ?? undefined}>
                            {select('seller_id', (cat.vendedores ?? []).map((u: any) => ({ v: u.id, t: u.nombre })), 'Siigo no devolvió vendedores')}
                          </Campo>
                          <Campo rot="FORMA DE PAGO" ayuda={cat.fuentes?.pagos?.motivo ?? undefined}>
                            {select('payment_id', (cat.pagos ?? []).map((p: any) => ({ v: p.id, t: p.name })), 'Siigo no devolvió formas de pago')}
                          </Campo>
                        </div>
                      </div>
                    )}
                    {usaDS && (
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', color: C.verde, margin: '0 0 10px' }}>DOCUMENTO SOPORTE</p>
                        {sinCatalogoDs ? (
                          <p style={{ fontSize: 12.5, color: C.ambar, margin: 0 }}>Los catálogos guardados son de antes de esta opción. Volvé a «Guardar y probar conexión» para traer los comprobantes de documento soporte.</p>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                            <Campo rot="TIPO DE COMPROBANTE (DS)" ayuda={cat.fuentes?.documentos_ds?.motivo ?? 'El comprobante que en tu Siigo está configurado como documento soporte. Si no aparece, crealo en Siigo (Configuración → Comprobantes) y volvé a probar la conexión.'}>
                              {select('ds_document_id', (cat.documentos_ds ?? []).map((d: any) => ({ v: d.id, t: `${d.clase} · ${d.code ? d.code + ' · ' : ''}${d.name}` })), 'Siigo no devolvió comprobantes de documento soporte')}
                            </Campo>
                            <Campo rot="FORMA DE PAGO (DS)" ayuda={cat.fuentes?.pagos_ds?.motivo ?? undefined}>
                              {select('ds_payment_id', (cat.pagos_ds ?? []).map((p: any) => ({ v: p.id, t: p.name })), 'Siigo no devolvió formas de pago de compra')}
                            </Campo>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
                {cat?.traido_at && <p style={{ fontSize: 11, color: C.tenue, margin: '10px 0 0' }}>Catálogos traídos el {fecha(cat.traido_at)}. Si cambiaste algo en Siigo, volvé a probar la conexión.</p>}
              </Seccion>

              {/* 4. Ítems */}
              <Seccion n="4" t="Ítems del documento">
                <p style={{ fontSize: 12, color: C.sub, margin: '0 0 12px', lineHeight: 1.55 }}>
                  Las líneas que lleva cada factura o documento soporte. El valor de cada una se calcula a partir del monto de la operación: todo el monto, un porcentaje, o un valor fijo. En la descripción podés usar {'{tipo}'}, {'{numero}'}, {'{contraparte}'}, {'{monto}'} y {'{fecha}'}.
                </p>
                {!cat && <p style={{ fontSize: 12, color: C.ambar, margin: '0 0 10px' }}>Sin probar la conexión no hay productos que elegir: se puede escribir el código a mano, pero tiene que existir en tu Siigo.</p>}
                <div style={{ display: 'grid', gap: 10 }}>
                  {items.map((it, i) => (
                    <div key={i} style={{ padding: '12px 12px 10px', borderRadius: 12, border: `1px solid ${it.code ? C.borde : 'rgba(251,191,36,0.4)'}`, background: C.elevado }}>
                      <div className="flex items-center justify-between" style={{ gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub }}>ÍTEM {i + 1}</span>
                        <button onClick={() => quitarItem(i)} title="Quitar ítem" style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer', padding: 2 }} className="hover:text-[#F87171] transition-colors"><Trash2 size={14} /></button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                        <Campo rot="PRODUCTO O SERVICIO DE SIIGO" ayuda={!it.code ? 'Obligatorio.' : undefined}>
                          {cat?.productos?.length ? (
                            <select value={it.code} onChange={e => setItem(i, { code: e.target.value })} style={selectEstilo}>
                              <option value="">Elegir…</option>
                              {(cat.productos ?? []).map((p: any) => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>)}
                            </select>
                          ) : (
                            <input value={it.code} onChange={e => setItem(i, { code: e.target.value })} placeholder="Código del producto en Siigo" style={entrada} />
                          )}
                        </Campo>
                        <Campo rot="CANTIDAD">
                          <input type="number" min={1} step={1} value={it.quantity} onChange={e => setItem(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} style={entrada} />
                        </Campo>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <Campo rot="DESCRIPCIÓN">
                            <input value={it.description} onChange={e => setItem(i, { description: e.target.value })} placeholder="{tipo} · Comprobante Lincoin {numero}" style={entrada} />
                          </Campo>
                        </div>
                        <Campo rot="VALOR">
                          <select value={it.valor} onChange={e => setItem(i, { valor: e.target.value as Item['valor'] })} style={selectEstilo}>
                            <option value="monto">El monto de la operación</option>
                            <option value="porcentaje">Un porcentaje del monto</option>
                            <option value="fijo">Un valor fijo</option>
                          </select>
                        </Campo>
                        {it.valor === 'porcentaje' && (
                          <Campo rot="PORCENTAJE (%)">
                            <input type="number" min={0} max={100} step={0.01} value={it.porcentaje} onChange={e => setItem(i, { porcentaje: Number(e.target.value) || 0 })} style={entrada} />
                          </Campo>
                        )}
                        {it.valor === 'fijo' && (
                          <Campo rot="VALOR FIJO (COP)">
                            <input type="number" min={0} step={1} value={it.fijo} onChange={e => setItem(i, { fijo: Number(e.target.value) || 0 })} style={entrada} />
                          </Campo>
                        )}
                        <Campo rot="IMPUESTO" ayuda={cat?.fuentes?.impuestos?.motivo ?? undefined}>
                          <select value={it.tax_id ?? ''} onChange={e => setItem(i, { tax_id: e.target.value ? Number(e.target.value) : null })} style={selectEstilo} disabled={!cat?.impuestos?.length}>
                            <option value="">{cat?.impuestos?.length ? 'Sin impuesto (el del producto)' : 'Sin impuestos en el catálogo'}</option>
                            {(cat?.impuestos ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}{t.percentage ? ` · ${t.percentage} %` : ''}</option>)}
                          </select>
                        </Campo>
                      </div>
                      <p style={{ fontSize: 11, color: C.tenue, margin: '10px 0 0' }}>
                        Con una operación de {fmtCop(EJEMPLO)} COP, este ítem va por <b style={{ color: C.text }}>{fmtCop(valorEjemplo(it))}</b>{it.tax_id ? ' con impuesto' : ''}.
                      </p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, marginTop: 10 }}>
                  <button onClick={agregarItem} className="flex items-center hover:bg-white/[0.06] transition-colors" style={{ gap: 6, fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '8px 12px', cursor: 'pointer' }}>
                    <Plus size={14} /> Agregar ítem
                  </button>
                  {items.length > 0 && (
                    <span style={{ fontSize: 11.5, color: C.sub }}>Total de ejemplo: <b style={{ color: C.text }}>{fmtCop(totalEjemplo)} COP</b> por una operación de {fmtCop(EJEMPLO)}.</span>
                  )}
                </div>
                {!items.length && <p style={{ fontSize: 12, color: C.ambar, margin: '10px 0 0' }}>Sin ítems no se puede emitir nada. Agregá al menos uno.</p>}
              </Seccion>

              {/* 5. Contraparte y envío */}
              <Seccion n="5" t="Contraparte, DIAN y correo">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  <Campo rot="NIT DEL CLIENTE POR DEFECTO" ayuda="Cuando la operación no trae documento de la contraparte (un depósito, por ejemplo). 222222222222 es consumidor final.">
                    <input value={form.cliente_default_nit ?? ''} onChange={e => set('cliente_default_nit', e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={entrada} />
                  </Campo>
                  <Campo rot="NOMBRE DEL CLIENTE POR DEFECTO">
                    <input value={form.cliente_default_nombre ?? ''} onChange={e => set('cliente_default_nombre', e.target.value)} style={entrada} />
                  </Campo>
                </div>
                <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
                  {chk('crear_clientes', 'Crear la contraparte en Siigo si no existe', 'Con el documento y el nombre de la operación. Apagado, el documento queda en error hasta que la crees vos.')}
                  {chk('stamp', 'Enviar la factura de venta a la DIAN (factura electrónica)', 'Apagado, Siigo la guarda sin validarla ante la DIAN. El documento soporte se envía según cómo esté configurado el comprobante en tu Siigo.')}
                  {chk('mail', 'Que Siigo mande la factura por correo al cliente')}
                </div>
                <div style={{ marginTop: 14 }}>
                  <Campo rot="OBSERVACIONES EN EL DOCUMENTO (OPCIONAL)">
                    <input value={form.observaciones ?? ''} onChange={e => set('observaciones', e.target.value)} placeholder="Se agrega el número del comprobante Lincoin automáticamente" style={entrada} />
                  </Campo>
                </div>
              </Seccion>

              {aviso && (
                <p style={{ fontSize: 12.5, color: aviso.ok ? C.verde : C.rojo, margin: '16px 0 0', lineHeight: 1.5, wordBreak: 'break-word' }}>{aviso.texto}</p>
              )}
              <div className="flex items-center justify-end flex-wrap" style={{ gap: 8, marginTop: 16 }}>
                <button onClick={onCerrar} style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '10px 16px', cursor: 'pointer' }}>Cerrar</button>
                <button onClick={() => guardar()} disabled={guardando} className="lincoin-btn-white" style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, padding: '10px 18px', borderRadius: 9, border: 'none', cursor: 'pointer', opacity: guardando ? 0.5 : 1 }}>
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
              <p style={{ fontSize: 11, color: C.tenue, margin: '14px 0 0', lineHeight: 1.55 }}>
                Cada documento queda ligado a su comprobante en la lista de movimientos, con el número que dio Siigo o el error textual si lo rechazó, y un botón para reintentar. Nada se emite dos veces: una operación, un documento.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
