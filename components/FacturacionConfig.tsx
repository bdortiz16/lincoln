// ══════════════════════════════════════════════════════════════════
//  Configuración de la facturación automática — Lincoin Empresas
//
//  El cliente conecta SU cuenta de Siigo: pone el usuario y la access key de
//  la API, prueba la conexión, elige de los catálogos de su cuenta (tipo de
//  documento, vendedor, forma de pago, producto) y decide qué operaciones se
//  facturan. Desde ahí, cada operación completada emite su factura sola.
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
import { X } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';

const FONT = 'Archivo, system-ui, sans-serif';
const C = {
  fondo: '#0C0E0D', borde: 'rgba(255,255,255,0.10)', bordeSuave: 'rgba(255,255,255,0.08)',
  text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c', verde: '#4ADE80', rojo: '#F87171', ambar: '#FBBF24',
  campo: '#121413',
};

type Cfg = {
  existe: boolean; activo: boolean; username?: string | null; tieneAccessKey: boolean; partner_id?: string | null;
  document_id?: number | null; seller_id?: number | null; payment_id?: number | null;
  product_code?: string | null; product_description?: string | null;
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
const Seccion: React.FC<{ n: string; t: string; children: React.ReactNode }> = ({ n, t, children }) => (
  <div style={{ paddingTop: 18, marginTop: 18, borderTop: `1px solid ${C.bordeSuave}` }}>
    <p style={{ fontSize: 13.5, fontWeight: 800, color: C.text, margin: '0 0 12px' }}><span style={{ color: C.sub, marginRight: 8 }}>{n}</span>{t}</p>
    {children}
  </div>
);

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
    setCfg(r.config); setDisparadores(r.disparadores ?? {});
    setForm({
      username: r.config.username ?? '', partner_id: r.config.partner_id ?? '',
      document_id: r.config.document_id ?? '', seller_id: r.config.seller_id ?? '', payment_id: r.config.payment_id ?? '',
      product_code: r.config.product_code ?? '', product_description: r.config.product_description ?? '',
      cliente_default_nit: r.config.cliente_default_nit ?? '222222222222', cliente_default_nombre: r.config.cliente_default_nombre ?? 'Consumidor final',
      crear_clientes: r.config.crear_clientes ?? true, disparadores: r.config.disparadores ?? ['load', 'pay_received'],
      stamp: r.config.stamp ?? true, mail: r.config.mail ?? true, observaciones: r.config.observaciones ?? '', activo: r.config.activo ?? false,
    });
  };
  useEffect(() => { cargar(); }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onCerrar]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const guardar = async (extra: Record<string, any> = {}) => {
    setGuardando(true); setAviso(null);
    const config = { ...form, ...extra, ...(accessKey.trim() ? { access_key: accessKey.trim() } : {}) };
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
    setAviso({ ok: true, texto: r.aviso ? `Conectó con Siigo, pero: ${r.aviso}` : 'Conectó con Siigo. Elegí abajo el tipo de documento, el vendedor, la forma de pago y el producto.' });
  };

  const cat = cfg?.catalogos;
  const listo = !!form.username && !!(cfg?.tieneAccessKey || accessKey.trim()) && !!form.document_id && !!form.seller_id && !!form.payment_id && !!form.product_code;
  const fecha = (s?: string | null) => s ? new Date(s).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const chk = (k: string, rot: string, ayuda?: string) => (
    <label className="flex items-start" style={{ gap: 9, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)} style={{ width: 15, height: 15, accentColor: C.verde, marginTop: 2 }} />
      <span><span style={{ fontSize: 13, color: C.text }}>{rot}</span>{ayuda && <span style={{ display: 'block', fontSize: 11, color: C.tenue, marginTop: 2 }}>{ayuda}</span>}</span>
    </label>
  );
  const select = (k: string, opciones: { v: string | number; t: string }[], vacio: string) => (
    <select value={String(form[k] ?? '')} onChange={e => set(k, e.target.value)} style={{ ...entrada, appearance: 'auto' }} disabled={!opciones.length}>
      <option value="">{opciones.length ? 'Elegir…' : vacio}</option>
      {opciones.map(o => <option key={String(o.v)} value={String(o.v)}>{o.t}</option>)}
    </select>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(4,5,5,0.78)' }} onClick={onCerrar}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 720, maxHeight: '94vh', display: 'flex', flexDirection: 'column', background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 16, overflow: 'hidden', fontFamily: FONT }}>
        <div className="flex items-start justify-between" style={{ gap: 12, padding: '18px 24px 14px', borderBottom: `1px solid ${C.bordeSuave}` }}>
          <div>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: C.sub, margin: 0 }}>CONFIGURACIÓN</p>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: C.text, margin: '3px 0 0', letterSpacing: '-0.3px' }}>Facturación automática con Siigo</h3>
            <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0', lineHeight: 1.5 }}>Cada operación completada emite su factura en tu Siigo, con tus credenciales. Lincoin no factura nada por vos: opera tu cuenta.</p>
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
                      {cfg?.activo ? 'Activa: cada operación completada se factura sola' : 'Pausada: no se emite ninguna factura'}
                    </p>
                    <p style={{ fontSize: 11.5, color: C.sub, margin: '4px 0 0' }}>
                      {cfg?.ultimo_test_at ? `Última prueba ${fecha(cfg.ultimo_test_at)} · ${cfg.ultimo_test_ok ? 'conectó' : 'falló'}` : 'Todavía no se probó la conexión'}
                      {cfg?.resumen && cfg.resumen.comprobantes > 0 ? ` · ${cfg.resumen.emitidas} emitidas · ${cfg.resumen.errores} con error` : ''}
                    </p>
                  </div>
                  <button onClick={() => guardar({ activo: !form.activo })} disabled={guardando || (!form.activo && !listo)}
                    title={!form.activo && !listo ? 'Falta completar credenciales y catálogos' : undefined}
                    style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: '8px 14px', borderRadius: 9, cursor: 'pointer', border: 'none', opacity: (!form.activo && !listo) ? 0.5 : 1,
                      background: form.activo ? 'rgba(255,255,255,0.06)' : C.text, color: form.activo ? C.text : '#0A0A0A' }}>
                    {guardando ? '…' : form.activo ? 'Pausar' : 'Activar'}
                  </button>
                </div>
                {cfg?.ultimo_error && <p style={{ fontSize: 11.5, color: cfg.ultimo_test_ok ? C.ambar : C.rojo, margin: '8px 0 0', lineHeight: 1.5, wordBreak: 'break-word' }}>{cfg.ultimo_error}</p>}
              </div>

              {/* 1. Credenciales */}
              <Seccion n="1" t="Credenciales de la API de Siigo">
                <p style={{ fontSize: 12, color: C.sub, margin: '0 0 12px', lineHeight: 1.55 }}>
                  Se piden en Siigo: Configuración → Integraciones → API. El usuario es el correo de la cuenta; la access key es la clave que Siigo genera para la API (no la contraseña de entrar).
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  <Campo rot="USUARIO (CORREO)"><input value={form.username ?? ''} onChange={e => set('username', e.target.value)} placeholder="cuenta@empresa.com" autoComplete="off" style={entrada} /></Campo>
                  <Campo rot="ACCESS KEY" ayuda={cfg?.tieneAccessKey ? 'Hay una guardada. Dejá esto vacío para conservarla; escribí otra para reemplazarla.' : 'No se muestra después de guardarla.'}>
                    <input type="password" value={accessKey} onChange={e => setAccessKey(e.target.value)} placeholder={cfg?.tieneAccessKey ? '••••••••••••' : 'Pegá la access key'} autoComplete="new-password" style={entrada} />
                  </Campo>
                  <Campo rot="PARTNER ID" ayuda="El nombre con que Siigo identifica la integración. Si no te dieron uno, dejá Lincoin.">
                    <input value={form.partner_id ?? ''} onChange={e => set('partner_id', e.target.value)} placeholder="Lincoin" style={entrada} />
                  </Campo>
                </div>
                <div className="flex items-center flex-wrap" style={{ gap: 8, marginTop: 12 }}>
                  <button onClick={probar} disabled={probando || guardando || !form.username || !(cfg?.tieneAccessKey || accessKey.trim())}
                    className="lincoin-btn-white" style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: '9px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', opacity: (probando || !form.username || !(cfg?.tieneAccessKey || accessKey.trim())) ? 0.5 : 1 }}>
                    {probando ? 'Conectando con Siigo…' : 'Guardar y probar conexión'}
                  </button>
                  <span style={{ fontSize: 11.5, color: C.tenue }}>Trae de tu cuenta los tipos de documento, vendedores, formas de pago y productos.</span>
                </div>
              </Seccion>

              {/* 2. Catálogos */}
              <Seccion n="2" t="Qué usa cada factura">
                {!cat ? (
                  <p style={{ fontSize: 12.5, color: C.tenue, margin: 0 }}>Probá la conexión para traer los catálogos de tu Siigo. Sin eso no hay nada que elegir: los ids son de tu cuenta, no se pueden adivinar.</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    <Campo rot="TIPO DE DOCUMENTO (FV)" ayuda={cat.fuentes?.documentos?.motivo ?? undefined}>
                      {select('document_id', (cat.documentos ?? []).map((d: any) => ({ v: d.id, t: `${d.code ? d.code + ' · ' : ''}${d.name}` })), 'Siigo no devolvió tipos de documento')}
                    </Campo>
                    <Campo rot="VENDEDOR" ayuda={cat.fuentes?.vendedores?.motivo ?? undefined}>
                      {select('seller_id', (cat.vendedores ?? []).map((u: any) => ({ v: u.id, t: u.nombre })), 'Siigo no devolvió vendedores')}
                    </Campo>
                    <Campo rot="FORMA DE PAGO" ayuda={cat.fuentes?.pagos?.motivo ?? undefined}>
                      {select('payment_id', (cat.pagos ?? []).map((p: any) => ({ v: p.id, t: p.name })), 'Siigo no devolvió formas de pago')}
                    </Campo>
                    <Campo rot="PRODUCTO O SERVICIO" ayuda={cat.fuentes?.productos?.motivo ?? 'El ítem con que se factura. Creá uno en Siigo si no tenés (por ejemplo "Servicio").'}>
                      {select('product_code', (cat.productos ?? []).map((p: any) => ({ v: p.code, t: `${p.code} · ${p.name}` })), 'Siigo no devolvió productos')}
                    </Campo>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <Campo rot="DESCRIPCIÓN DEL ÍTEM" ayuda="Podés usar {tipo}, {numero} y {contraparte}. Vacío = «Depósitos · Lincoin», etc.">
                        <input value={form.product_description ?? ''} onChange={e => set('product_description', e.target.value)} placeholder="{tipo} · Comprobante Lincoin {numero}" style={entrada} />
                      </Campo>
                    </div>
                  </div>
                )}
                {cat?.traido_at && <p style={{ fontSize: 11, color: C.tenue, margin: '10px 0 0' }}>Catálogos traídos el {fecha(cat.traido_at)}. Si cambiaste algo en Siigo, volvé a probar la conexión.</p>}
              </Seccion>

              {/* 3. Reglas */}
              <Seccion n="3" t="Qué se factura">
                <p style={{ fontSize: 12, color: C.sub, margin: '0 0 10px', lineHeight: 1.55 }}>
                  Una empresa factura lo que le pagan. Por eso vienen marcadas las entradas. Un envío a un proveedor es una compra, no una venta: se puede marcar, pero pensalo dos veces.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  {Object.entries(disparadores).map(([k, rot]) => (
                    <label key={k} className="flex items-center" style={{ gap: 9, cursor: 'pointer' }}>
                      <input type="checkbox" checked={(form.disparadores ?? []).includes(k)}
                        onChange={e => set('disparadores', e.target.checked ? [...(form.disparadores ?? []), k] : (form.disparadores ?? []).filter((x: string) => x !== k))}
                        style={{ width: 15, height: 15, accentColor: C.verde }} />
                      <span style={{ fontSize: 13, color: C.text }}>{rot}</span>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 14 }}>
                  <Campo rot="NIT DEL CLIENTE POR DEFECTO" ayuda="Cuando la operación no trae documento de la contraparte (un depósito, por ejemplo). 222222222222 es consumidor final.">
                    <input value={form.cliente_default_nit ?? ''} onChange={e => set('cliente_default_nit', e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={entrada} />
                  </Campo>
                  <Campo rot="NOMBRE DEL CLIENTE POR DEFECTO">
                    <input value={form.cliente_default_nombre ?? ''} onChange={e => set('cliente_default_nombre', e.target.value)} style={entrada} />
                  </Campo>
                </div>
                <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
                  {chk('crear_clientes', 'Crear la contraparte en Siigo si no existe', 'Con el documento y el nombre de la operación. Apagado, la factura queda en error hasta que la crees vos.')}
                  {chk('stamp', 'Enviar a la DIAN (factura electrónica)', 'Apagado, Siigo la guarda sin validarla ante la DIAN.')}
                  {chk('mail', 'Que Siigo la mande por correo al cliente')}
                </div>
                <div style={{ marginTop: 14 }}>
                  <Campo rot="OBSERVACIONES EN LA FACTURA (OPCIONAL)">
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
                Cada factura queda ligada a su comprobante en la lista de movimientos, con el número que dio Siigo o el error textual si lo rechazó, y un botón para reintentar. Nada se emite dos veces: una operación, una factura.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
