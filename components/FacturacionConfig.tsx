// ══════════════════════════════════════════════════════════════════
//  Configuración de la facturación automática — Lincoin Empresas
//
//  El cliente conecta SU cuenta de Siigo y elige su MODELO DE NEGOCIO. Desde
//  ahí, apenas una operación se completa, se emite el documento que ese
//  modelo manda, con los datos de la operación (quién, cuánto, cuándo).
//
//    1. Credenciales. Cuando conectan, se pliegan: queda una línea que dice
//       con qué usuario y cuándo, y un botón para cambiarlas.
//    2. El modelo:
//       · ROTACIÓN DE CAPITAL — recibe plata de terceros, la rota y cobra
//         una comisión. Por cada entrada, una factura de venta con dos ítems
//         que suman exacto lo recibido: servicio para terceros (sin IVA) y
//         comisión (con IVA).
//       · PSP — paga a terceros por cuenta de alguien. Por cada salida, un
//         documento soporte al beneficiario por el monto total, con el ítem
//         de servicio para terceros, sin IVA.
//    3. Los parámetros del modelo: utilidad, qué producto de Siigo es cada
//       ítem, IVA, qué operaciones, y los comprobantes de su Siigo.
//    4. Contraparte, DIAN y correo.
//
//  LOS ÍTEMS LOS CREA EL CLIENTE EN SIIGO. Acá solo se eligen de la lista
//  que Siigo devolvió. Nada de ids inventados.
//
//  LA ACCESS KEY NO VUELVE A LA PANTALLA. Se manda una vez, el servidor la
//  cifra, y acá solo se ve "hay una guardada".
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';
import { MOTIVOS_ENVIO } from '../lib/motivosEnvio';

const FONT = 'Archivo, system-ui, sans-serif';
const C = {
  fondo: '#0C0E0D', borde: 'rgba(255,255,255,0.10)', bordeSuave: 'rgba(255,255,255,0.08)',
  text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c', verde: '#4ADE80', rojo: '#F87171', ambar: '#FBBF24',
  campo: '#121413', elevado: '#121413',
};

type Cfg = {
  existe: boolean; activo: boolean; username?: string | null; tieneAccessKey: boolean; partner_id?: string | null;
  access_key_pista?: { largo: number; inicio: string; fin: string } | null;
  modelo?: 'rotacion' | 'psp' | null; utilidad_pct?: number | null;
  item_terceros?: string | null; item_comision?: string | null; iva_tax_id?: number | null;
  desc_terceros?: string | null; desc_comision?: string | null;
  document_id?: number | null; seller_id?: number | null; payment_id?: number | null;
  ds_document_id?: number | null; ds_payment_id?: number | null;
  documentos?: Record<string, 'FV' | 'DS'> | null;
  motivos?: Record<string, { emite: 'DS' | 'no'; item?: string | null }> | null;
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

// Qué operaciones aplican a cada modelo: la rotación factura lo que ENTRA;
// la pasarela documenta lo que SALE.
const ENTRADAS = ['load', 'pay_received', 'otc_deposit'];
const SALIDAS = ['dispersion', 'send', 'pay_sent'];
const fmtCop = (n: number) => n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;
const EJEMPLO = 15_000_000;

export const FacturacionConfig: React.FC<{ onCerrar: () => void }> = ({ onCerrar }) => {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [disparadores, setDisparadores] = useState<Record<string, string>>({});
  const [form, setForm] = useState<any>({});
  const [accessKey, setAccessKey] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  // Las credenciales se pliegan cuando ya conectaron. "Cambiar" las abre.
  const [credAbiertas, setCredAbiertas] = useState(false);

  const cargar = async () => {
    setCargando(true);
    const r = await llamarFuncion('facturacion', { action: 'config_get' }, 20000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setCargando(false);
    if (!r?.ok) { setAviso({ ok: false, texto: r?.error ?? r?.mensaje ?? 'No se pudo leer la configuración.' }); return; }
    const c: Cfg = r.config;
    setCfg(c); setDisparadores(r.disparadores ?? {});
    setCredAbiertas(!(c.ultimo_test_ok && c.tieneAccessKey));
    const modelo = c.modelo === 'rotacion' || c.modelo === 'psp' ? c.modelo : '';
    const docs = c.documentos && typeof c.documentos === 'object' ? c.documentos : {};
    const operaciones = Object.keys(docs).length
      ? Object.keys(docs)
      : modelo === 'psp' ? ['dispersion'] : ['load', 'pay_received'];
    // El IVA por defecto: el del catálogo que diga 19 %, si hay.
    const iva19 = (c.catalogos?.impuestos ?? []).find((t: any) => Number(t.percentage) === 19);
    // Por motivo del envío. Si nunca se configuró, en PSP arranca con "pago
    // a proveedores → documento soporte con el ítem de terceros".
    const motivos = c.motivos && typeof c.motivos === 'object'
      ? { ...c.motivos }
      : modelo === 'psp' ? { proveedores: { emite: 'DS', item: c.item_terceros ?? '' } } : {};
    setForm({
      username: c.username ?? '', partner_id: c.partner_id ?? '',
      modelo, utilidad_pct: c.utilidad_pct ?? '', item_terceros: c.item_terceros ?? '', item_comision: c.item_comision ?? '',
      iva_tax_id: c.iva_tax_id ?? (iva19 ? iva19.id : ''),
      desc_terceros: c.desc_terceros ?? '', desc_comision: c.desc_comision ?? '',
      operaciones, motivos,
      document_id: c.document_id ?? '', seller_id: c.seller_id ?? '', payment_id: c.payment_id ?? '',
      ds_document_id: c.ds_document_id ?? '', ds_payment_id: c.ds_payment_id ?? '',
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
  const elegirModelo = (m: 'rotacion' | 'psp') => setForm((f: any) => {
    // En PSP el documento soporte lo decide el MOTIVO de cada envío, así
    // que todas las salidas quedan en juego; en rotación, las entradas.
    if (m === 'psp') {
      const motivos = Object.keys(f.motivos ?? {}).length ? f.motivos : { proveedores: { emite: 'DS', item: f.item_terceros ?? '' } };
      return { ...f, modelo: m, operaciones: [...SALIDAS], motivos };
    }
    const actuales = (f.operaciones ?? []).filter((k: string) => ENTRADAS.includes(k));
    return { ...f, modelo: m, operaciones: actuales.length ? actuales : ['load', 'pay_received'] };
  });
  const setMotivo = (k: string, patch: Record<string, any>) => setForm((f: any) => ({
    ...f, motivos: { ...(f.motivos ?? {}), [k]: { emite: 'no', item: '', ...(f.motivos?.[k] ?? {}), ...patch } },
  }));
  const toggleOp = (k: string, on: boolean) => setForm((f: any) => ({ ...f, operaciones: on ? [...new Set([...(f.operaciones ?? []), k])] : (f.operaciones ?? []).filter((x: string) => x !== k) }));

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

  const probar = async (soloCatalogos = false) => {
    // Se guarda primero: probar con credenciales que no están guardadas
    // produciría un "conectó" que no sobrevive a cerrar la ventana.
    // "Actualizar catálogos", con credenciales ya guardadas, NO guarda nada:
    // si el guardado fallara por otra cosa (una migración que falta, un
    // campo del modelo), se quedaba con los catálogos viejos y parecía que
    // Siigo no devolvía el producto nuevo.
    if (!soloCatalogos && !(await guardar())) return;
    setProbando(true); setAviso(null);
    const r = await llamarFuncion('facturacion', { action: 'probar' }, 60000).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    setProbando(false);
    if (r?.config) setCfg(r.config);
    if (!r?.ok) { setAviso({ ok: false, texto: r?.error ?? 'Siigo no respondió.' }); return; }
    // Conectó: las credenciales se pliegan y sigue el modelo.
    setCredAbiertas(false);
    if (!form.iva_tax_id) {
      const iva19 = (r.config?.catalogos?.impuestos ?? []).find((t: any) => Number(t.percentage) === 19);
      if (iva19) set('iva_tax_id', iva19.id);
    }
    setAviso({ ok: true, texto: r.aviso ? `Conectó con Siigo, pero: ${r.aviso}` : 'Conectó con Siigo. Ahora elegí el modelo de negocio y sus parámetros.' });
  };

  const cat = cfg?.catalogos;
  const modelo: string = form.modelo ?? '';
  const ops: string[] = form.operaciones ?? [];
  const credOk = !!form.username && !!(cfg?.tieneAccessKey || accessKey.trim());
  const conectado = !!cfg?.ultimo_test_ok && !!cfg?.tieneAccessKey;
  const utilidad = Number(form.utilidad_pct) || 0;
  const impuestos: any[] = cat?.impuestos ?? [];
  // Lo que cada producto tiene configurado EN SIIGO. Es lo que Siigo va a
  // aplicar, diga lo que diga la etiqueta de acá: si el ítem de terceros
  // tiene IVA, la factura sale con IVA. Por eso se mira y se avisa.
  const productoDe = (code: string) => (cat?.productos ?? []).find((p: any) => String(p.code) === String(code)) ?? null;
  const ivaDelProducto = (code: string): { id: number; name: string; percentage: number } | null => {
    const taxes: any[] = productoDe(code)?.taxes ?? [];
    const conValor = taxes.filter(t => (Number(t.percentage) || 0) > 0);
    const t = conValor.find(x => /iva/i.test(String(x.name ?? '')) || /iva/i.test(String(x.type ?? ''))) ?? conValor[0];
    return t ? { id: Number(t.id), name: String(t.name ?? ''), percentage: Number(t.percentage) || 0 } : null;
  };
  const prodTerceros = productoDe(form.item_terceros);
  const prodComision = productoDe(form.item_comision);
  const ivaTerceros = form.item_terceros ? ivaDelProducto(form.item_terceros) : null;
  const ivaComisionProd = form.item_comision ? ivaDelProducto(form.item_comision) : null;
  const ivaElegido = form.iva_tax_id ? impuestos.find((t: any) => String(t.id) === String(form.iva_tax_id)) : null;
  // El IVA de la comisión: el del ítem en Siigo manda; si el ítem no tiene,
  // el elegido acá (se manda en la línea para que aplique).
  const iva = ivaComisionProd ?? (ivaElegido ? { id: Number(ivaElegido.id), name: String(ivaElegido.name ?? ''), percentage: Number(ivaElegido.percentage) || 0 } : null);
  const tarifa = iva ? iva.percentage / 100 : 0;
  // Por motivo del envío: qué sale y con qué ítem.
  const motivos: Record<string, { emite: string; item?: string | null }> = form.motivos ?? {};
  const motivosDS = MOTIVOS_ENVIO.filter(m => motivos[m.v]?.emite === 'DS');
  const motivosSinItem = motivosDS.filter(m => !motivos[m.v]?.item);
  const motivosConIva = motivosDS.filter(m => motivos[m.v]?.item && ivaDelProducto(String(motivos[m.v].item)));
  // Hay documento soporte si el modelo es PSP o si algún motivo lo emite.
  const usaDS = modelo === 'psp' || motivosDS.length > 0;
  const faltantes = [
    !credOk ? 'credenciales' : '',
    !modelo ? 'el modelo de negocio' : '',
    modelo === 'rotacion' && !ops.length ? 'qué entradas facturan' : '',
    modelo === 'psp' && !motivosDS.length ? 'al menos un motivo de envío con documento soporte' : '',
    modelo === 'rotacion' && !(utilidad > 0) ? 'el porcentaje de utilidad' : '',
    modelo === 'rotacion' && !form.item_terceros ? 'el ítem de servicio para terceros' : '',
    modelo === 'rotacion' && ivaTerceros ? 'un ítem de servicio para terceros SIN IVA (el elegido tiene IVA en Siigo)' : '',
    modelo === 'rotacion' && prodTerceros && prodTerceros.active === false ? 'un ítem de servicio para terceros activo en Siigo' : '',
    modelo === 'rotacion' && !form.item_comision ? 'el ítem de comisión' : '',
    modelo === 'rotacion' && prodComision && prodComision.active === false ? 'un ítem de comisión activo en Siigo' : '',
    modelo === 'rotacion' && !(form.document_id && form.seller_id && form.payment_id) ? 'el comprobante, vendedor y forma de pago de la factura' : '',
    motivosSinItem.length ? `el ítem de: ${motivosSinItem.map(m => m.l).join(', ')}` : '',
    motivosConIva.length ? `un ítem SIN IVA para: ${motivosConIva.map(m => m.l).join(', ')}` : '',
    usaDS && !(form.ds_document_id && form.ds_payment_id) ? 'el comprobante y forma de pago del documento soporte' : '',
  ].filter(Boolean);
  const listo = faltantes.length === 0;
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
  const productos = (cat?.productos ?? []).map((p: any) => ({ v: p.code, t: `${p.code} · ${p.name}` }));
  const nombreProducto = (code: string) => { const p = (cat?.productos ?? []).find((x: any) => x.code === code); return p ? p.name : code; };

  // El ejemplo con 15.000.000, calculado igual que el servidor: la misma
  // fórmula a la vista, no una promesa.
  // Si el ítem de terceros tiene IVA en Siigo, el ejemplo lo muestra: así
  // saldría la factura. Y el total deja de cuadrar, en ámbar.
  const tarifaTerceros = ivaTerceros ? ivaTerceros.percentage / 100 : 0;
  const ejemplo = (() => {
    if (modelo === 'psp') {
      // El ejemplo del PSP: el primer motivo con documento soporte.
      const m0 = motivosDS[0];
      const item0 = m0 ? String(motivos[m0.v]?.item ?? '') : '';
      const iva0 = item0 ? ivaDelProducto(item0) : null;
      const ivaT = r2(EJEMPLO * (iva0 ? iva0.percentage / 100 : 0));
      return { lineas: [{ n: nombreProducto(item0) || 'Servicio para terceros', v: EJEMPLO, iva: ivaT, rotulo: iva0 ? `${iva0.name || 'IVA'} ${iva0.percentage} %` : 'sin IVA' }], total: r2(EJEMPLO + ivaT), motivo: m0?.l };
    }
    if (modelo !== 'rotacion') return null;
    const util = r2(EJEMPLO * utilidad / 100);
    const base = r2(util / (1 + tarifa));
    const ivaV = r2(base * tarifa);
    const terceros = r2(EJEMPLO - base - ivaV);
    const ivaT = r2(terceros * tarifaTerceros);
    return {
      lineas: [
        { n: nombreProducto(form.item_terceros) || 'Servicio para terceros', v: terceros, iva: ivaT, rotulo: ivaTerceros ? `${ivaTerceros.name || 'IVA'} ${ivaTerceros.percentage} %` : 'sin IVA' },
        { n: nombreProducto(form.item_comision) || 'Comisión', v: base, iva: ivaV, rotulo: iva ? `${iva.name || 'IVA'} ${iva.percentage} %` : 'sin IVA' },
      ],
      total: r2(terceros + ivaT + base + ivaV), util,
    };
  })();
  const sinCatalogoDs = !!cat && !Array.isArray(cat.documentos_ds);

  // Por motivo del envío: el que el cliente elige al confirmar cada envío.
  // Cada motivo se liga a un ítem de Siigo (documento soporte) o a nada.
  const tablaMotivos = (
    <div style={{ display: 'grid', gap: 8 }}>
      {MOTIVOS_ENVIO.map(m => {
        const r = motivos[m.v] ?? { emite: 'no', item: '' };
        const esDS = r.emite === 'DS';
        const item = String(r.item ?? '');
        const ivaM = esDS && item ? ivaDelProducto(item) : null;
        const prodM = item ? productoDe(item) : null;
        return (
          <div key={m.v} style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${esDS ? 'rgba(74,222,128,0.28)' : C.bordeSuave}`, background: esDS ? 'rgba(74,222,128,0.04)' : 'transparent' }}>
            <div className="flex items-center justify-between flex-wrap" style={{ gap: 10 }}>
              <span style={{ fontSize: 13, color: C.text }}>{m.l}</span>
              <select value={esDS ? 'DS' : 'no'} onChange={e => setMotivo(m.v, { emite: e.target.value })} style={{ ...selectEstilo, width: 'auto', minWidth: 190, padding: '7px 10px', fontSize: 12.5 }}>
                <option value="no">No emitir nada</option>
                <option value="DS">Documento soporte</option>
              </select>
            </div>
            {esDS && (
              <div style={{ marginTop: 8 }}>
                <select value={item} onChange={e => setMotivo(m.v, { item: e.target.value })} style={selectEstilo} disabled={!productos.length}>
                  <option value="">{productos.length ? 'Elegir el ítem de Siigo…' : 'Conectá Siigo para elegir el ítem'}</option>
                  {productos.map((p: any) => <option key={String(p.v)} value={String(p.v)}>{p.t}</option>)}
                </select>
                {ivaM && <p style={{ fontSize: 11.5, color: C.ambar, margin: '6px 0 0', lineHeight: 1.5 }}>Este ítem tiene {ivaM.name || 'IVA'} {ivaM.percentage} % en Siigo. El documento soporte por el monto total va sin IVA: elegí otro ítem o quitale el impuesto en Siigo.</p>}
                {prodM && prodM.active === false && <p style={{ fontSize: 11.5, color: C.ambar, margin: '6px 0 0', lineHeight: 1.5 }}>Este ítem está inactivo en Siigo.</p>}
                {prodM && !ivaM && prodM.active !== false && <p style={{ fontSize: 11.5, color: C.verde, margin: '6px 0 0', lineHeight: 1.5 }}>Sin IVA en Siigo, activo. Con este ítem sale el documento soporte por el monto total.</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const tarjetaModelo = (m: 'rotacion' | 'psp', titulo: string, texto: string, ejemploTxt: string) => {
    const on = modelo === m;
    return (
      <button onClick={() => elegirModelo(m)} style={{ textAlign: 'left', padding: '13px 14px', borderRadius: 12, cursor: 'pointer', fontFamily: FONT, background: on ? 'rgba(74,222,128,0.06)' : 'transparent', border: `1px solid ${on ? 'rgba(74,222,128,0.4)' : C.borde}` }}>
        <span className="flex items-center" style={{ gap: 8 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${on ? C.verde : 'rgba(255,255,255,0.25)'}`, background: on ? C.verde : 'transparent', flexShrink: 0 }} />
          <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{titulo}</span>
        </span>
        <span style={{ display: 'block', fontSize: 12, color: C.sub, marginTop: 6, lineHeight: 1.55 }}>{texto}</span>
        <span style={{ display: 'block', fontSize: 11, color: C.tenue, marginTop: 6, lineHeight: 1.5 }}>{ejemploTxt}</span>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(4,5,5,0.78)' }} onClick={onCerrar}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 760, maxHeight: '94vh', display: 'flex', flexDirection: 'column', background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 16, overflow: 'hidden', fontFamily: FONT }}>
        <div className="flex items-start justify-between" style={{ gap: 12, padding: '18px 24px 14px', borderBottom: `1px solid ${C.bordeSuave}` }}>
          <div>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: C.sub, margin: 0 }}>CONFIGURACIÓN</p>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: C.text, margin: '3px 0 0', letterSpacing: '-0.3px' }}>Facturación automática con Siigo</h3>
            <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0', lineHeight: 1.5 }}>Apenas una operación se completa, se emite el documento en tu Siigo con los datos de la operación. Lincoin no factura nada por vos: opera tu cuenta.</p>
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
                      {cfg?.modelo === 'rotacion' ? 'Modelo: rotación de capital' : cfg?.modelo === 'psp' ? 'Modelo: PSP / pasarela' : 'Sin modelo elegido'}
                      {cfg?.resumen && cfg.resumen.comprobantes > 0 ? ` · ${cfg.resumen.emitidas} emitidos · ${cfg.resumen.errores} con error` : ''}
                    </p>
                  </div>
                  <button onClick={() => guardar({ activo: !form.activo })} disabled={guardando || (!form.activo && !listo)}
                    title={!form.activo && !listo ? `Falta: ${faltantes.join(', ')}` : undefined}
                    style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: '8px 14px', borderRadius: 9, cursor: 'pointer', border: 'none', opacity: (!form.activo && !listo) ? 0.5 : 1,
                      background: form.activo ? 'rgba(255,255,255,0.06)' : C.text, color: form.activo ? C.text : '#0A0A0A' }}>
                    {guardando ? '…' : form.activo ? 'Pausar' : 'Activar'}
                  </button>
                </div>
                {!form.activo && !listo && (
                  <p style={{ fontSize: 11.5, color: C.tenue, margin: '8px 0 0', lineHeight: 1.5 }}>Para activar falta: {faltantes.join(', ')}.</p>
                )}
                {cfg?.ultimo_error && <p style={{ fontSize: 11.5, color: cfg.ultimo_test_ok ? C.ambar : C.rojo, margin: '8px 0 0', lineHeight: 1.5, wordBreak: 'break-word' }}>{cfg.ultimo_error}</p>}
                {cfg?.ultimo_error && /access_key|username|invalid_value|401/i.test(cfg.ultimo_error) && !cfg.ultimo_test_ok && (
                  <p style={{ fontSize: 11.5, color: C.sub, margin: '6px 0 0', lineHeight: 1.55 }}>
                    Siigo no reconoce esa access key para ese usuario. No es la contraseña de Siigo Nube: es la clave que genera el
                    portal de clientes en «Generar credenciales API», para ese mismo correo. Generala de nuevo, pegala completa y
                    probá otra vez.
                  </p>
                )}
              </div>

              {/* 1. Credenciales: plegadas cuando ya conectaron */}
              <Seccion n="1" t="Cuenta de Siigo">
                {conectado && !credAbiertas ? (
                  <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, padding: '11px 14px', borderRadius: 12, border: `1px solid rgba(74,222,128,0.28)`, background: 'rgba(74,222,128,0.04)' }}>
                    <div>
                      <p className="flex items-center" style={{ gap: 8, fontSize: 13, fontWeight: 700, color: C.text, margin: 0 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.verde }} />
                        Conectada como {cfg?.username}
                      </p>
                      <p style={{ fontSize: 11.5, color: C.sub, margin: '3px 0 0' }}>Última conexión {fecha(cfg?.ultimo_test_at)}{cat?.traido_at ? ` · catálogos del ${fecha(cat.traido_at)}` : ''}</p>
                    </div>
                    <div className="flex items-center" style={{ gap: 6 }}>
                      <button onClick={() => probar(true)} disabled={probando} style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 8, padding: '7px 11px', cursor: 'pointer', opacity: probando ? 0.5 : 1 }}>
                        {probando ? 'Actualizando…' : 'Actualizar catálogos'}
                      </button>
                      <button onClick={() => setCredAbiertas(true)} style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 8, padding: '7px 11px', cursor: 'pointer' }}>
                        Cambiar credenciales
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
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
                      <button onClick={() => probar(false)} disabled={probando || guardando || !credOk}
                        className="lincoin-btn-white" style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: '9px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', opacity: (probando || !credOk) ? 0.5 : 1 }}>
                        {probando ? 'Conectando con Siigo…' : 'Guardar y probar conexión'}
                      </button>
                      {conectado && <button onClick={() => setCredAbiertas(false)} style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: C.sub, background: 'transparent', border: 'none', cursor: 'pointer' }}>Cancelar</button>}
                      <span style={{ fontSize: 11.5, color: C.tenue }}>Trae de tu cuenta los productos, impuestos, comprobantes, vendedores y formas de pago.</span>
                    </div>
                  </>
                )}
              </Seccion>

              {/* 2. Modelo */}
              <Seccion n="2" t="Tu modelo de negocio">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
                  {tarjetaModelo('rotacion', 'Rotación de capital',
                    'Recibís plata de terceros, la rotás y cobrás una comisión. Por cada entrada se emite una factura de venta con dos ítems que suman exacto lo recibido: el servicio para terceros (sin IVA) y tu comisión (con IVA).',
                    'Con 15.000.000 y 1 % de utilidad: terceros 14.850.000 · comisión 126.050,42 + IVA 23.949,58 · total 15.000.000.')}
                  {tarjetaModelo('psp', 'PSP / pasarela',
                    'Pagás a terceros por cuenta de un cliente. Según el motivo de cada envío, se emite un documento soporte al beneficiario por el monto total, con el ítem de Siigo que ligues a ese motivo. La factura de tu comisión al cliente la hacés vos en Siigo.',
                    'Con un envío de 15.000.000: documento soporte al beneficiario por 15.000.000.')}
                </div>
              </Seccion>

              {/* 3. Parámetros del modelo */}
              {modelo && (
                <Seccion n="3" t={modelo === 'rotacion' ? 'Cómo se arma la factura' : 'Cómo se arma el documento soporte'}>
                  {!cat && <p style={{ fontSize: 12.5, color: C.ambar, margin: '0 0 12px' }}>Conectá la cuenta de Siigo primero: los ítems, impuestos y comprobantes se eligen de lo que devuelva tu Siigo.</p>}
                  <p style={{ fontSize: 12, color: C.sub, margin: '0 0 12px', lineHeight: 1.55 }}>
                    Los ítems son productos o servicios que creás en tu Siigo (Inventario → Productos). Acá solo se elige cuál es cuál.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    {modelo === 'rotacion' && (
                      <Campo rot="TU UTILIDAD (%)" ayuda="Lo que ganás sobre lo que entra: 1, 0,5, 0,1…">
                        <input type="number" min={0} max={100} step={0.01} value={form.utilidad_pct ?? ''} onChange={e => set('utilidad_pct', e.target.value)} placeholder="1" inputMode="decimal" style={entrada} />
                      </Campo>
                    )}
                    {modelo === 'rotacion' && <div>
                      <Campo rot="ÍTEM · SERVICIO PARA TERCEROS" ayuda={cat?.fuentes?.productos?.motivo ?? `El producto de Siigo para el dinero de terceros. Tiene que estar SIN IVA en Siigo.${cat ? ` ${productos.length} productos traídos el ${fecha(cat.traido_at)}; si creaste uno nuevo, dale a «Actualizar catálogos».` : ''}`}>
                        {select('item_terceros', productos, 'Siigo no devolvió productos')}
                      </Campo>
                      {ivaTerceros && (
                        <p style={{ fontSize: 11.5, color: C.ambar, margin: '6px 0 0', lineHeight: 1.5 }}>
                          Este ítem tiene {ivaTerceros.name || 'IVA'} {ivaTerceros.percentage} % en Siigo, y el servicio para terceros va sin IVA. Si se usa así, la factura sale con IVA sobre todo el monto. Elegí otro ítem o quitale el impuesto en Siigo.
                        </p>
                      )}
                      {prodTerceros && prodTerceros.active === false && (
                        <p style={{ fontSize: 11.5, color: C.ambar, margin: '6px 0 0', lineHeight: 1.5 }}>Este ítem está inactivo en Siigo. Activalo allá o elegí otro.</p>
                      )}
                      {prodTerceros && !ivaTerceros && prodTerceros.active !== false && (
                        <p style={{ fontSize: 11.5, color: C.verde, margin: '6px 0 0', lineHeight: 1.5 }}>Sin IVA en Siigo, activo. Correcto.</p>
                      )}
                    </div>}
                    {modelo === 'rotacion' && (
                      <>
                        <div>
                          <Campo rot="ÍTEM · COMISIÓN" ayuda="El producto de Siigo para tu comisión. Tiene que tener IVA en Siigo.">
                            {select('item_comision', productos, 'Siigo no devolvió productos')}
                          </Campo>
                          {ivaComisionProd && (
                            <p style={{ fontSize: 11.5, color: C.verde, margin: '6px 0 0', lineHeight: 1.5 }}>
                              Con {ivaComisionProd.name || 'IVA'} {ivaComisionProd.percentage} % en Siigo. Con esa tarifa se calcula la base: base + IVA = utilidad.
                            </p>
                          )}
                          {prodComision && !ivaComisionProd && (
                            <p style={{ fontSize: 11.5, color: C.ambar, margin: '6px 0 0', lineHeight: 1.5 }}>
                              Este ítem no tiene IVA en Siigo. La comisión lleva IVA: ponéselo en Siigo, o elegí abajo el impuesto y se manda en la línea.
                            </p>
                          )}
                          {prodComision && prodComision.active === false && (
                            <p style={{ fontSize: 11.5, color: C.ambar, margin: '6px 0 0', lineHeight: 1.5 }}>Este ítem está inactivo en Siigo. Activalo allá o elegí otro.</p>
                          )}
                        </div>
                        {prodComision && !ivaComisionProd && (
                          <Campo rot="IVA DE LA COMISIÓN" ayuda={cat?.fuentes?.impuestos?.motivo ?? 'Solo porque el ítem no trae IVA desde Siigo. Se manda en la línea de la factura.'}>
                            {select('iva_tax_id', impuestos.map((t: any) => ({ v: t.id, t: `${t.name}${t.percentage ? ` · ${t.percentage} %` : ''}` })), 'Siigo no devolvió impuestos')}
                          </Campo>
                        )}
                      </>
                    )}
                  </div>

                  {/* Lo que Siigo devolvió, tal cual. "No me sale el ítem"
                      se resuelve mirando esta lista, no adivinando. */}
                  {cat && (
                    <details style={{ marginTop: 10 }}>
                      <summary style={{ fontSize: 11.5, color: C.sub, cursor: 'pointer' }}>
                        Ver los {productos.length} productos que devolvió Siigo
                        {cat.fuentes?.productos ? ` (HTTP ${cat.fuentes.productos.status}${cat.fuentes.productos.ok ? '' : ` · ${cat.fuentes.productos.motivo}`})` : ''}
                      </summary>
                      <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto', border: `1px solid ${C.bordeSuave}`, borderRadius: 10 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead>
                            <tr>{['CÓDIGO', 'NOMBRE', 'TIPO', 'IMPUESTOS', 'ESTADO'].map(h => <th key={h} style={{ textAlign: 'left', padding: '7px 10px', fontSize: 10, letterSpacing: '1px', color: C.sub, borderBottom: `1px solid ${C.bordeSuave}` }}>{h}</th>)}</tr>
                          </thead>
                          <tbody>
                            {(cat.productos ?? []).map((p: any) => (
                              <tr key={p.code}>
                                <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace', color: C.text }}>{p.code}</td>
                                <td style={{ padding: '6px 10px', color: C.text }}>{p.name}</td>
                                <td style={{ padding: '6px 10px', color: C.sub }}>{p.type ?? '—'}</td>
                                <td style={{ padding: '6px 10px', color: C.sub }}>{(p.taxes ?? []).length ? (p.taxes ?? []).map((t: any) => `${t.name}${t.percentage ? ` ${t.percentage} %` : ''}`).join(', ') : 'sin impuestos'}</td>
                                <td style={{ padding: '6px 10px', color: p.active === false ? C.ambar : C.sub }}>{p.active === false ? 'inactivo' : 'activo'}</td>
                              </tr>
                            ))}
                            {!(cat.productos ?? []).length && <tr><td colSpan={5} style={{ padding: '8px 10px', color: C.tenue }}>Siigo no devolvió ningún producto.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                      <p style={{ fontSize: 11, color: C.tenue, margin: '6px 0 0', lineHeight: 1.5 }}>
                        Si el que creaste no está acá, Siigo no lo está entregando por su API: revisá en Siigo que esté activo y guardado como producto o servicio, no como borrador.
                      </p>
                    </details>
                  )}

                  {/* Qué entradas facturan (rotación) */}
                  {modelo === 'rotacion' && (
                    <>
                      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '16px 0 8px' }}>QUÉ ENTRADAS FACTURAN</p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
                        {ENTRADAS.filter(k => k in disparadores).map(k => (
                          <label key={k} className="flex items-center" style={{ gap: 9, cursor: 'pointer' }}>
                            <input type="checkbox" checked={ops.includes(k)} onChange={e => toggleOp(k, e.target.checked)} style={{ width: 15, height: 15, accentColor: C.verde }} />
                            <span style={{ fontSize: 13, color: C.text }}>{disparadores[k]}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Envíos, por motivo. En PSP es lo central; en rotación,
                      opcional: un envío puede necesitar documento soporte. */}
                  <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '16px 0 4px' }}>{modelo === 'psp' ? 'ENVÍOS: QUÉ SALE SEGÚN EL MOTIVO' : 'ENVÍOS: DOCUMENTO SOPORTE SEGÚN EL MOTIVO (OPCIONAL)'}</p>
                  <p style={{ fontSize: 12, color: C.sub, margin: '0 0 10px', lineHeight: 1.55 }}>
                    Al confirmar cada envío se pregunta el motivo, y se le manda al banco con la orden. Acá decidís, motivo por motivo, si sale documento soporte al beneficiario por el monto total y con qué ítem de tu Siigo.
                  </p>
                  {tablaMotivos}

                  {/* Comprobantes de Siigo */}
                  {modelo === 'rotacion' && (
                    <>
                      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '16px 0 8px' }}>COMPROBANTE DE LA FACTURA EN TU SIIGO</p>
                      {!cat ? (
                        <p style={{ fontSize: 12.5, color: C.tenue, margin: 0 }}>Se eligen después de conectar.</p>
                      ) : (
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
                      )}
                    </>
                  )}
                  {usaDS && (
                    <>
                      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '16px 0 8px' }}>COMPROBANTE DEL DOCUMENTO SOPORTE EN TU SIIGO</p>
                      {!cat ? (
                        <p style={{ fontSize: 12.5, color: C.tenue, margin: 0 }}>Se eligen después de conectar.</p>
                      ) : sinCatalogoDs ? (
                        <p style={{ fontSize: 12.5, color: C.ambar, margin: 0 }}>Los catálogos guardados son de antes de esta opción. Dale a «Actualizar catálogos» arriba para traer los comprobantes de documento soporte.</p>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                          <Campo rot="TIPO DE COMPROBANTE (DS)" ayuda={cat.fuentes?.documentos_ds?.motivo ?? 'El comprobante que en tu Siigo está configurado como documento soporte. Si no aparece, crealo en Siigo y actualizá los catálogos.'}>
                            {select('ds_document_id', (cat.documentos_ds ?? []).map((d: any) => ({ v: d.id, t: `${d.clase} · ${d.code ? d.code + ' · ' : ''}${d.name}` })), 'Siigo no devolvió comprobantes de documento soporte')}
                          </Campo>
                          <Campo rot="FORMA DE PAGO (DS)" ayuda={cat.fuentes?.pagos_ds?.motivo ?? undefined}>
                            {select('ds_payment_id', (cat.pagos_ds ?? []).map((p: any) => ({ v: p.id, t: p.name })), 'Siigo no devolvió formas de pago de compra')}
                          </Campo>
                        </div>
                      )}
                    </>
                  )}

                  {/* Descripciones (opcional) */}
                  <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '16px 0 8px' }}>DESCRIPCIÓN DE CADA ÍTEM (OPCIONAL)</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    <Campo rot="SERVICIO PARA TERCEROS" ayuda="Podés usar {contraparte}, {numero}, {monto}, {fecha}, {tipo}.">
                      <input value={form.desc_terceros ?? ''} onChange={e => set('desc_terceros', e.target.value)} placeholder="Servicio para terceros · {contraparte} · Comprobante Lincoin {numero}" style={entrada} />
                    </Campo>
                    {modelo === 'rotacion' && (
                      <Campo rot="COMISIÓN" ayuda="También {utilidad}, el porcentaje.">
                        <input value={form.desc_comision ?? ''} onChange={e => set('desc_comision', e.target.value)} placeholder="Comisión {utilidad} % · Comprobante Lincoin {numero}" style={entrada} />
                      </Campo>
                    )}
                  </div>

                  {/* Ejemplo */}
                  {ejemplo && (
                    <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 12, border: `1px solid ${C.bordeSuave}`, background: C.elevado }}>
                      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '0 0 8px' }}>
                        ASÍ QUEDA CON UNA OPERACIÓN DE {fmtCop(EJEMPLO)} COP{modelo === 'rotacion' ? ` Y ${utilidad || 0} % DE UTILIDAD` : (ejemplo as any).motivo ? ` · MOTIVO «${String((ejemplo as any).motivo).toUpperCase()}»` : ''}
                      </p>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                        <tbody>
                          {ejemplo.lineas.map((l, i) => (
                            <tr key={i}>
                              <td style={{ padding: '5px 0', color: C.text }}>{l.n}</td>
                              <td style={{ padding: '5px 0', textAlign: 'right', color: C.text, fontFamily: 'ui-monospace, monospace' }}>{fmtCop(l.v)}</td>
                              <td style={{ padding: '5px 0 5px 12px', textAlign: 'right', color: l.iva && l.n === (nombreProducto(form.item_terceros) || 'Servicio para terceros') ? C.ambar : C.sub, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>{l.iva ? `${l.rotulo} · ${fmtCop(l.iva)}` : l.rotulo}</td>
                            </tr>
                          ))}
                          <tr>
                            <td style={{ padding: '7px 0 0', color: C.text, fontWeight: 800, borderTop: `1px solid ${C.bordeSuave}` }}>Total</td>
                            <td colSpan={2} style={{ padding: '7px 0 0', textAlign: 'right', fontWeight: 800, borderTop: `1px solid ${C.bordeSuave}`, fontFamily: 'ui-monospace, monospace', color: ejemplo.total === EJEMPLO ? C.verde : C.ambar }}>{fmtCop(ejemplo.total)}</td>
                          </tr>
                        </tbody>
                      </table>
                      {modelo === 'rotacion' && !(utilidad > 0) && <p style={{ fontSize: 11.5, color: C.ambar, margin: '8px 0 0' }}>Poné tu utilidad para ver la comisión.</p>}
                      {modelo === 'rotacion' && utilidad > 0 && !iva && <p style={{ fontSize: 11.5, color: C.ambar, margin: '8px 0 0' }}>La comisión va sin impuesto: el ítem no tiene IVA en Siigo y no elegiste uno.</p>}
                      {ivaTerceros && <p style={{ fontSize: 11.5, color: C.ambar, margin: '8px 0 0' }}>El total no cuadra con el monto porque el ítem de terceros tiene IVA en Siigo. Así saldría la factura; por eso no se puede activar con ese ítem.</p>}
                      {ejemplo.total === EJEMPLO && <p style={{ fontSize: 11.5, color: C.tenue, margin: '8px 0 0' }}>Los impuestos son los que cada ítem tiene en tu Siigo, no una etiqueta de acá.</p>}
                    </div>
                  )}
                </Seccion>
              )}

              {/* 4. Contraparte y envío */}
              <Seccion n="4" t="Contraparte, DIAN y correo">
                <p style={{ fontSize: 12, color: C.sub, margin: '0 0 12px', lineHeight: 1.55 }}>
                  El documento sale a nombre de quien aparece en la operación: nombre y documento del que pagó o del beneficiario. Si no existe en tu Siigo, se crea. Cuando la operación no trae documento (un depósito, por ejemplo), va al cliente por defecto.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  <Campo rot="NIT DEL CLIENTE POR DEFECTO" ayuda="222222222222 es consumidor final.">
                    <input value={form.cliente_default_nit ?? ''} onChange={e => set('cliente_default_nit', e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={entrada} />
                  </Campo>
                  <Campo rot="NOMBRE DEL CLIENTE POR DEFECTO">
                    <input value={form.cliente_default_nombre ?? ''} onChange={e => set('cliente_default_nombre', e.target.value)} style={entrada} />
                  </Campo>
                </div>
                <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
                  {chk('crear_clientes', 'Crear la contraparte en Siigo si no existe', 'Con el documento y el nombre de la operación. Apagado, el documento queda en error hasta que la crees vos.')}
                  {modelo !== 'psp' && chk('stamp', 'Enviar la factura a la DIAN (factura electrónica)', 'Apagado, Siigo la guarda sin validarla ante la DIAN.')}
                  {modelo !== 'psp' && chk('mail', 'Que Siigo mande la factura por correo al cliente')}
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
