// ─────────────────────────────────────────────────────────────
// Admin → Gowd: cuentas en Brasil por la API Banking del aliado.
//
//   · Cuentas: abrir la cuenta (datos del titular + contrato), subir los
//     documentos que pide, seguir la aprobación, crear llaves PIX y
//     asignarla a un cliente Empresa (lo que el cliente ve es "su cuenta en
//     Brasil", nunca el nombre del aliado).
//   · Desde cada cuenta: cobrar con QR, QR estático, enviar PIX/TED,
//     reclamos de llave, cierre y MED.
//   · Operaciones, extracto, webhooks, casos MED, cierres y el sandbox.
//
// Todo pasa por la función `gowd` (proxy mTLS con IP fija). El navegador no
// habla con el banco ni ve credenciales; el secreto del webhook lo guarda el
// servidor al rotarlo y no vuelve a la pantalla.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from 'react';
import { pedirGowd } from './adminApi';

const C = {
  bg: '#070808', card: '#0C0E0D', elev: '#121413', b1: 'rgba(255,255,255,0.07)', b2: 'rgba(255,255,255,0.12)',
  text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)', green: '#4ADE80', amber: '#FBBF24', red: '#F87171',
};
const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, Menlo, monospace';

const campo: React.CSSProperties = { fontFamily: FONT, width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.045)', border: `1px solid ${C.b1}`, borderRadius: 9, padding: '9px 11px', color: C.text, fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { fontFamily: FONT, background: C.text, border: 'none', color: '#0A0A0A', borderRadius: 9, padding: '9px 15px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
const btnSec: React.CSSProperties = { fontFamily: FONT, background: 'transparent', border: `1px solid ${C.b2}`, color: C.sub, borderRadius: 9, padding: '8px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const btnPeligro: React.CSSProperties = { ...btnSec, color: C.red, border: '1px solid rgba(248,113,113,0.35)' };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 };

const Tarjeta: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: C.card, border: `1px solid ${C.b1}`, borderRadius: 13, padding: '15px 16px', ...style }}>{children}</div>
);
const Etq: React.FC<{ children: React.ReactNode }> = ({ children }) => <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '0 0 5px' }}>{children}</p>;
const Titulo: React.FC<{ children: React.ReactNode; sub?: React.ReactNode }> = ({ children, sub }) => (
  <div style={{ marginBottom: 10 }}>
    <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: C.text }}>{children}</p>
    {sub && <p style={{ fontSize: 12, color: C.sub, margin: '3px 0 0', lineHeight: 1.5 }}>{sub}</p>}
  </div>
);
const Msg: React.FC<{ r: { ok?: boolean; texto: string } | null }> = ({ r }) => r ? <p style={{ fontSize: 12.5, color: r.ok ? C.green : C.red, margin: '8px 0 0', lineHeight: 1.45, wordBreak: 'break-word' }}>{r.texto}</p> : null;
const Pill: React.FC<{ t?: string | null; tono?: 'ok' | 'warn' | 'bad' | 'neutral' }> = ({ t, tono = 'neutral' }) => {
  if (!t) return null;
  const c = tono === 'ok' ? C.green : tono === 'warn' ? C.amber : tono === 'bad' ? C.red : C.sub;
  const b = tono === 'ok' ? 'rgba(74,222,128,0.3)' : tono === 'warn' ? 'rgba(251,191,36,0.35)' : tono === 'bad' ? 'rgba(248,113,113,0.3)' : C.b2;
  return <span style={{ border: `1px solid ${b}`, color: c, borderRadius: 999, padding: '3px 9px', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.6px', whiteSpace: 'nowrap' }}>{t}</span>;
};
const tonoDe = (s?: string | null): 'ok' | 'warn' | 'bad' | 'neutral' => {
  const v = String(s ?? '').toUpperCase();
  if (['ACTIVE', 'APPROVED', 'CONFIRMED', 'PAID', 'COMPLETED', 'CREADA'].includes(v)) return 'ok';
  if (['REPROVED', 'REJECTED', 'ERROR', 'CLOSED', 'CANCELED', 'CANCELLED', 'RECHAZADA', 'EXPIRED'].includes(v)) return 'bad';
  if (['PENDING', 'PENDING_DOCUMENTS', 'ENVIANDO', 'DESCONOCIDO', 'INACTIVE'].includes(v)) return 'warn';
  return 'neutral';
};
const fechaHora = (d?: string | null) => { if (!d) return '—'; try { return new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return String(d); } };
const docFmt = (d?: string | null) => {
  const s = String(d ?? '');
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
  if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
  return s;
};
const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const dinero = (m: any) => {
  if (m == null) return '—';
  if (typeof m === 'object') return m.value != null ? `${m.currency ?? 'BRL'} ${m.value}` : '—';
  return String(m);
};
const copiar = (t: string) => { try { navigator.clipboard.writeText(t); } catch { /* */ } };

// Para respuestas cuya forma Gowd no detalla en la documentación.
const VerJson: React.FC<{ v: any; titulo?: string }> = ({ v, titulo = 'Ver detalle' }) => {
  const [abierto, setAbierto] = useState(false);
  return (
    <div style={{ marginTop: 6 }}>
      <button onClick={() => setAbierto(a => !a)} style={{ ...btnSec, padding: '4px 9px', fontSize: 11 }}>{abierto ? 'Ocultar' : titulo}</button>
      {abierto && <pre style={{ fontFamily: MONO, fontSize: 11, color: C.sub, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 9, padding: 10, marginTop: 6, maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(v, null, 2)}</pre>}
    </div>
  );
};

const DOCS: Record<string, { k: string; l: string }[]> = {
  INDIVIDUAL: [
    { k: 'documentHolder', l: 'Documento de identidad (RG, CNH, RNE, pasaporte)' },
    { k: 'selfieHolder', l: 'Selfie con el documento (solo foto)' },
    { k: 'pepDeclaration', l: 'Declaración PEP' },
  ],
  ORGANIZATION: [
    { k: 'socialContract', l: 'Contrato social' },
    { k: 'cnpjCard', l: 'Tarjeta CNPJ' },
    { k: 'balanceSheet', l: 'Balance' },
    { k: 'incomeStatement', l: 'Estado de resultados' },
    { k: 'ir', l: 'Declaración de renta (IR)' },
    { k: 'proofAddress', l: 'Comprobante de dirección de la empresa' },
    { k: 'proofBankAddress', l: 'Comprobante de cuenta bancaria' },
    { k: 'partnerProofAddress', l: 'Comprobante de dirección del socio' },
    { k: 'documentRepresentative', l: 'Documento del representante' },
    { k: 'selfieRepresentative', l: 'Selfie del representante (solo foto)' },
    { k: 'kyc', l: 'Formulario KYC' },
    { k: 'pepDeclaration', l: 'Declaración PEP' },
    { k: 'accountTerms', l: 'Contrato de la cuenta firmado' },
  ],
};
const PASO: Record<string, string> = {
  PENDING_ANALYSE: 'En análisis', PENDING_PIX_KEY: 'Falta llave PIX', PENDING_FEE: 'Falta pagar tarifa',
  PENDING_CONFIRMATION: 'Por confirmar', COMPLETED: 'Completa',
};

// ══════════════════════════════════════════════════════════════════
export const AdminGowd: React.FC = () => {
  const [datos, setDatos] = useState<any>(null);
  const [tab, setTab] = useState<'cuentas' | 'operaciones' | 'extracto' | 'webhooks' | 'med' | 'cierres' | 'sandbox'>('cuentas');
  const [nueva, setNueva] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const [ping, setPing] = useState<any>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = async (conSaldo = false) => {
    const r = await pedirGowd({ action: 'admin_gowd_resumen', conSaldo });
    setDatos((d: any) => r?.ok && !conSaldo && d?.saldo ? { ...r, saldo: d.saldo } : r);
  };
  useEffect(() => { cargar(true); }, []);

  const cuentas: any[] = datos?.cuentas ?? [];
  const puede = !!datos?.puedeEscribir;

  const probar = async () => { setPing({ cargando: true }); setPing(await pedirGowd({ action: 'admin_ping' })); };
  const importar = async () => {
    setOcupado(true); setMsg(null);
    const r = await pedirGowd({ action: 'admin_gowd_importar' });
    setOcupado(false);
    setMsg(r?.ok ? { ok: true, texto: `Importadas o actualizadas: ${r.importadas}.` } : { texto: r?.error ?? 'No se pudo importar.' });
    cargar();
  };

  const tabs: [typeof tab, string][] = [['cuentas', `Cuentas · ${cuentas.length}`], ['operaciones', 'Operaciones'], ['extracto', 'Extracto'], ['webhooks', 'Webhooks'], ['med', 'MED'], ['cierres', 'Cierres'], ['sandbox', 'Sandbox']];
  const saldo = datos?.saldo;

  return (
    <div style={{ fontFamily: FONT, background: C.bg, color: C.text, borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Tarjeta>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <p style={{ fontSize: 17, fontWeight: 800, margin: 0, letterSpacing: '-0.3px' }}>Gowd · cuentas en Brasil</p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5, maxWidth: 560 }}>
              Se abren aquí por la API Banking, se asignan a un cliente Empresa y desde cada cuenta se cobra, se envía y se consulta. El cliente ve "su cuenta en Brasil" con el banco 677, nunca el nombre del aliado.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={probar} style={btnSec}>{ping?.cargando ? 'Probando…' : 'Probar conexión'}</button>
            <button onClick={() => cargar(true)} style={btnSec}>Actualizar</button>
            {puede && <button onClick={importar} disabled={ocupado} style={btnSec}>{ocupado ? 'Importando…' : 'Importar de Gowd'}</button>}
            {puede && <button onClick={() => setNueva(true)} style={btnPri}>Nueva cuenta</button>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.b1}` }}>
          <div><Etq>SALDO DISPONIBLE (EMPRESA)</Etq><p style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{saldo?.error ? '—' : saldo ? dinero(saldo.balance) : datos?.proxyConfigurado === false ? '—' : '…'}</p></div>
          <div><Etq>PROVISIONADO</Etq><p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.sub }}>{saldo && !saldo.error ? dinero(saldo.provisioned) : '—'}</p></div>
          <div style={{ flex: '1 1 260px' }}>
            <Etq>CONEXIÓN</Etq>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: ping?.estado === 'conectado' ? C.green : datos?.proxyConfigurado === false ? C.amber : C.sub }}>
              {ping && !ping.cargando ? (ping.ok === false ? ping.error : ping.detalle)
                : datos?.proxyConfigurado === false ? 'Falta conectar el proxy: GOWD_PROXY_URL y GOWD_PROXY_SECRET en los secretos de Supabase.'
                : saldo?.error ? saldo.error : 'Proxy configurado.'}
            </p>
          </div>
        </div>
        <Msg r={msg} />
      </Tarjeta>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', background: tab === k ? C.text : 'transparent', color: tab === k ? '#0A0A0A' : C.sub, border: `1px solid ${tab === k ? C.text : C.b2}` }}>{l}</button>
        ))}
      </div>

      {!datos ? <p style={{ fontSize: 12.5, color: C.sub }}>Consultando…</p>
        : datos.ok === false ? <Tarjeta><p style={{ fontSize: 12.5, color: C.red, margin: 0 }}>{datos.error}</p></Tarjeta>
        : tab === 'cuentas' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cuentas.length === 0 && <Tarjeta><p style={{ fontSize: 12.5, color: C.sub, margin: 0 }}>Todavía no hay cuentas. Crea una con "Nueva cuenta" o trae las que ya existan con "Importar de Gowd".</p></Tarjeta>}
            {cuentas.map(c => (
              <CuentaFila key={c.id} c={c} abierta={abierta === c.id} puede={puede}
                onToggle={() => setAbierta(a => a === c.id ? null : c.id)} onCambio={() => cargar()} />
            ))}
          </div>
        )
        : tab === 'operaciones' ? <Operaciones cuentas={cuentas} puede={puede} />
        : tab === 'extracto' ? <Extracto cuentas={cuentas} />
        : tab === 'webhooks' ? <Webhooks puede={puede} />
        : tab === 'med' ? <Med cuentas={cuentas} puede={puede} />
        : tab === 'cierres' ? <Cierres />
        : <Sandbox puede={puede} />}

      {nueva && <NuevaCuenta onCerrar={() => setNueva(false)} onCreada={(id) => { setNueva(false); setAbierta(id); cargar(); }} />}
    </div>
  );
};

// ── Una cuenta ───────────────────────────────────────────────────────────
const CuentaFila: React.FC<{ c: any; abierta: boolean; puede: boolean; onToggle: () => void; onCambio: () => void }> = ({ c, abierta, puede, onToggle, onCambio }) => {
  const [panel, setPanel] = useState<'' | 'docs' | 'llaves' | 'asignar' | 'cobrar' | 'enviar' | 'reclamos' | 'cierre' | 'med'>('');
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const llaves: any[] = Array.isArray(c.llaves) ? c.llaves : [];
  const faltan: string[] = Array.isArray(c.faltan) ? c.faltan : [];
  const abiertaEnGowd = !!c.account_id && !!c.conta;

  const accion = async (body: Record<string, unknown>, ok: string) => {
    setOcupado(true); setMsg(null);
    const r = await pedirGowd({ gowdId: c.id, ...body });
    setOcupado(false);
    if (!r?.ok) { setMsg({ texto: r?.error ?? 'No se pudo.' }); return null; }
    setMsg({ ok: true, texto: ok }); onCambio();
    return r;
  };

  const fila = (k: string, v: React.ReactNode, mono = false) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderTop: `1px solid ${C.b1}` }}>
      <span style={{ fontSize: 12, color: C.sub }}>{k}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, fontFamily: mono ? MONO : FONT, textAlign: 'right', wordBreak: 'break-all' }}>{v || '—'}</span>
    </div>
  );
  const boton = (k: typeof panel, l: string) => (
    <button onClick={() => setPanel(p => p === k ? '' : k)} style={{ ...btnSec, ...(panel === k ? { color: C.text, borderColor: C.text } : {}) }}>{l}</button>
  );

  return (
    <Tarjeta style={{ padding: 0 }}>
      <button onClick={onToggle} style={{ fontFamily: FONT, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: C.text, padding: '13px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{c.titular}{c.alias ? <span style={{ color: C.sub, fontWeight: 500 }}> · {c.alias}</span> : null}</span>
          <span style={{ display: 'block', fontSize: 11.5, color: C.sub, marginTop: 2 }}>
            {c.holder_type === 'ORGANIZATION' ? 'Empresa · CNPJ' : 'Persona · CPF'} {docFmt(c.documento)}
            {c.conta ? ` · Ag ${c.agencia} · Conta ${c.conta}` : ''}
            {c.cliente ? ` · Asignada a ${c.cliente.nombre ?? c.cliente.email}` : ''}
          </span>
        </span>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {c.estado_cuenta ? <Pill t={c.estado_cuenta} tono={tonoDe(c.estado_cuenta)} /> : <Pill t={c.estado_solicitud ?? 'SIN ESTADO'} tono={tonoDe(c.estado_solicitud)} />}
          {c.paso && c.paso !== 'COMPLETED' && <Pill t={PASO[c.paso] ?? c.paso} tono="warn" />}
          {c.user_id && <Pill t="ASIGNADA" tono="ok" />}
        </span>
      </button>

      {abierta && (
        <div style={{ padding: '0 16px 16px' }}>
          {fila('Solicitud', c.solicitud_id, true)}
          {fila('Estado de la solicitud', c.estado_solicitud)}
          {c.paso && fila('Paso', PASO[c.paso] ?? c.paso)}
          {fila('Id de cuenta', c.account_id, true)}
          {c.conta && fila('Banco · ISPB', `${c.banco ?? ''} · ${c.ispb ?? ''}`, true)}
          {c.conta && fila('Agência · Conta', `${c.agencia} · ${c.conta} (${c.conta_tipo ?? ''})`, true)}
          {fila('Llaves PIX', llaves.length ? llaves.map(l => `${l.type}: ${l.key}`).join(' · ') : 'ninguna', true)}
          {fila('Correo · Teléfono', `${c.email ?? '—'} · ${c.telefono ?? '—'}`)}
          {c.motivo && <p style={{ fontSize: 12, color: C.amber, margin: '8px 0 0', lineHeight: 1.45 }}>{c.motivo}</p>}
          {faltan.length > 0 && <p style={{ fontSize: 12, color: C.amber, margin: '8px 0 0' }}>Faltan documentos: {faltan.join(', ')}</p>}

          {puede ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              <button onClick={() => accion({ action: 'admin_gowd_refrescar' }, 'Actualizada con lo que dice Gowd.')} disabled={ocupado} style={btnSec}>{ocupado ? '…' : 'Actualizar'}</button>
              {c.solicitud_id && boton('docs', 'Documentos')}
              {c.account_id && boton('llaves', 'Llaves PIX')}
              {c.account_id && boton('reclamos', 'Reclamos de llave')}
              {abiertaEnGowd && !c.user_id && boton('asignar', 'Asignar a cliente')}
              {c.user_id && <button onClick={() => { if (confirm('¿Quitarle esta cuenta al cliente? Su cuenta en Brasil queda suspendida y se le avisa.')) accion({ action: 'admin_gowd_desasignar' }, 'Cuenta desasignada.'); }} style={btnPeligro}>Desasignar</button>}
              {abiertaEnGowd && boton('cobrar', 'Cobrar / QR')}
              {abiertaEnGowd && boton('enviar', 'Enviar')}
              {c.account_id && boton('med', 'Abrir MED')}
              {c.account_id && boton('cierre', 'Cerrar cuenta')}
            </div>
          ) : <p style={{ fontSize: 11.5, color: C.dim, margin: '12px 0 0' }}>Tu rol puede ver, no modificar.</p>}
          <Msg r={msg} />

          {panel === 'docs' && <Documentos c={c} onListo={onCambio} />}
          {panel === 'llaves' && <Llaves c={c} onListo={onCambio} />}
          {panel === 'reclamos' && <Reclamos c={c} onListo={onCambio} />}
          {panel === 'asignar' && <AsignarCliente c={c} onListo={() => { setPanel(''); onCambio(); }} />}
          {panel === 'cobrar' && <Cobrar c={c} />}
          {panel === 'enviar' && <Enviar c={c} />}
          {panel === 'med' && <AbrirMed c={c} />}
          {panel === 'cierre' && <PedirCierre c={c} onListo={onCambio} />}
        </div>
      )}
    </Tarjeta>
  );
};

const Sub: React.FC<{ titulo: string; sub?: React.ReactNode; children: React.ReactNode }> = ({ titulo, sub, children }) => (
  <div style={{ marginTop: 12, padding: 14, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 11 }}>
    <Titulo sub={sub}>{titulo}</Titulo>
    {children}
  </div>
);

// ── Documentos ──
const Documentos: React.FC<{ c: any; onListo: () => void }> = ({ c, onListo }) => {
  const lista = DOCS[c.holder_type] ?? [];
  const faltan: string[] = Array.isArray(c.faltan) ? c.faltan : [];
  const [tipo, setTipo] = useState(lista.find(d => faltan.includes(d.k))?.k ?? lista[0]?.k ?? '');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [agregar, setAgregar] = useState(true);
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const subir = async () => {
    if (!archivo) return;
    if (archivo.size > 10 * 1024 * 1024) { setMsg({ texto: 'El archivo debe pesar hasta 10 MB.' }); return; }
    setOcupado(true); setMsg(null);
    const b64 = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] ?? ''); fr.onerror = () => rej(fr.error); fr.readAsDataURL(archivo); });
    const mime = archivo.type === 'image/jpg' ? 'image/jpeg' : archivo.type;
    const r = await pedirGowd({ action: 'admin_gowd_documento', gowdId: c.id, documentType: tipo, archivoBase64: b64, mime, nombre: archivo.name, append: agregar });
    setOcupado(false);
    if (!r?.ok) { setMsg({ texto: r?.error ?? 'No se pudo subir.' }); return; }
    setMsg({ ok: true, texto: 'Documento enviado a Gowd.' }); setArchivo(null); onListo();
  };
  return (
    <Sub titulo="Documentos de la solicitud" sub="PDF, PNG o JPG hasta 10 MB. Las selfies, solo foto. En rojo los que Gowd dice que faltan.">
      <div style={grid}>
        <div style={{ gridColumn: '1 / -1' }}><Etq>TIPO</Etq>
          <select value={tipo} onChange={e => setTipo(e.target.value)} style={campo}>
            {lista.map(d => <option key={d.k} value={d.k}>{faltan.includes(d.k) ? '● ' : ''}{d.l}</option>)}
          </select></div>
        <div style={{ gridColumn: '1 / -1' }}><Etq>ARCHIVO</Etq>
          <input type="file" accept={/^selfie/.test(tipo) ? 'image/png,image/jpeg' : 'application/pdf,image/png,image/jpeg'} onChange={e => setArchivo(e.target.files?.[0] ?? null)} style={{ ...campo, padding: 7 }} /></div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: C.sub, marginTop: 10 }}>
        <input type="checkbox" checked={agregar} onChange={e => setAgregar(e.target.checked)} /> Agregar a los que ya hay de este tipo (desmarcado: reemplaza)
      </label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button onClick={subir} disabled={!archivo || ocupado} style={{ ...btnPri, opacity: !archivo || ocupado ? 0.6 : 1 }}>{ocupado ? 'Subiendo…' : 'Subir'}</button>
      </div>
      <Msg r={msg} />
    </Sub>
  );
};

// ── Llaves PIX ──
const Llaves: React.FC<{ c: any; onListo: () => void }> = ({ c, onListo }) => {
  const llaves: any[] = Array.isArray(c.llaves) ? c.llaves : [];
  const [tipo, setTipo] = useState(c.holder_type === 'ORGANIZATION' ? 'CNPJ' : 'RANDOM');
  const [key, setKey] = useState('');
  const [canal, setCanal] = useState('sms');
  const [validacion, setValidacion] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const llamar = async (body: Record<string, unknown>) => {
    setOcupado(true); setMsg(null);
    const r = await pedirGowd({ gowdId: c.id, ...body });
    setOcupado(false);
    if (!r?.ok) setMsg({ texto: r?.error ?? 'No se pudo.' });
    return r?.ok ? r : null;
  };
  const crear = async () => {
    const r = await llamar({ action: 'admin_gowd_llave', tipo, key, canal });
    if (!r) return;
    if (r.pendiente) { setValidacion(r.validationId); setMsg({ ok: true, texto: 'Gowd le mandó un código al titular. Escríbelo abajo.' }); return; }
    setMsg({ ok: true, texto: 'Llave creada.' }); setKey(''); onListo();
  };
  return (
    <Sub titulo="Llaves PIX" sub="CPF, CNPJ y aleatoria se crean al instante. Correo y teléfono piden un código que le llega al titular.">
      {llaves.length === 0 && <p style={{ fontSize: 12, color: C.sub, margin: '0 0 8px' }}>Sin llaves.</p>}
      {llaves.map(l => (
        <div key={l.id ?? l.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: `1px solid ${C.b1}` }}>
          <span style={{ fontFamily: MONO, fontSize: 12, wordBreak: 'break-all' }}>{l.type} · {l.key}</span>
          <button onClick={async () => { if (!confirm(`¿Borrar la llave ${l.key}? Los PIX a esa llave dejan de llegar.`)) return; if (await llamar({ action: 'admin_gowd_llave_borrar', keyId: l.id })) { setMsg({ ok: true, texto: 'Llave borrada.' }); onListo(); } }} disabled={ocupado || !l.id} style={{ ...btnPeligro, padding: '4px 9px', fontSize: 11 }}>Borrar</button>
        </div>
      ))}
      {!validacion ? (
        <div style={{ ...grid, marginTop: 10 }}>
          <div><Etq>TIPO</Etq>
            <select value={tipo} onChange={e => { setTipo(e.target.value); setKey(''); }} style={campo}>
              <option value="RANDOM">Aleatoria</option>
              {c.holder_type === 'ORGANIZATION' ? <option value="CNPJ">CNPJ</option> : <option value="CPF">CPF</option>}
              <option value="EMAIL">Correo</option><option value="PHONE">Teléfono</option>
            </select></div>
          {(tipo === 'EMAIL' || tipo === 'PHONE') && <div><Etq>{tipo === 'EMAIL' ? 'CORREO' : 'TELÉFONO (+55…)'}</Etq><input value={key} onChange={e => setKey(e.target.value)} style={{ ...campo, fontFamily: MONO }} /></div>}
          {(tipo === 'CPF' || tipo === 'CNPJ') && <div><Etq>NÚMERO</Etq><input value={key} onChange={e => setKey(e.target.value)} placeholder={docFmt(c.documento)} style={{ ...campo, fontFamily: MONO }} /></div>}
          {tipo === 'PHONE' && <div><Etq>CANAL DEL CÓDIGO</Etq><select value={canal} onChange={e => setCanal(e.target.value)} style={campo}><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select></div>}
          <div style={{ display: 'flex', alignItems: 'flex-end' }}><button onClick={crear} disabled={ocupado} style={{ ...btnPri, width: '100%' }}>{ocupado ? '…' : 'Crear llave'}</button></div>
        </div>
      ) : (
        <div style={{ ...grid, marginTop: 10 }}>
          <div><Etq>CÓDIGO</Etq><input value={codigo} onChange={e => setCodigo(e.target.value.trim())} style={{ ...campo, fontFamily: MONO }} autoFocus /></div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            <button onClick={async () => { const r = await llamar({ action: 'admin_gowd_llave_confirmar', validationId: validacion, token: codigo }); if (r) { setValidacion(null); setCodigo(''); setMsg({ ok: true, texto: 'Llave confirmada.' }); onListo(); } }} disabled={ocupado || !codigo} style={btnPri}>Confirmar</button>
            <button onClick={async () => { if (await llamar({ action: 'admin_gowd_llave_reenviar', validationId: validacion })) setMsg({ ok: true, texto: 'Código reenviado.' }); }} disabled={ocupado} style={btnSec}>Reenviar</button>
            <button onClick={() => setValidacion(null)} style={btnSec}>Cancelar</button>
          </div>
        </div>
      )}
      <Msg r={msg} />
    </Sub>
  );
};

// ── Reclamos y portabilidad ──
const Reclamos: React.FC<{ c: any; onListo: () => void }> = ({ c, onListo }) => {
  const [lista, setLista] = useState<any[] | null>(null);
  const [f, setF] = useState({ claimType: 'PORTABILITY', tipo: c.holder_type === 'ORGANIZATION' ? 'CNPJ' : 'CPF', key: '' });
  const [validacion, setValidacion] = useState<{ id: string; donante?: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const llamar = async (body: Record<string, unknown>) => {
    setOcupado(true); setMsg(null);
    const r = await pedirGowd({ gowdId: c.id, ...body });
    setOcupado(false);
    if (!r?.ok) setMsg({ texto: r?.error ?? 'No se pudo.' });
    return r?.ok ? r : null;
  };
  const cargar = async () => { const r = await llamar({ action: 'admin_gowd_reclamos' }); setLista(r?.reclamos ?? []); };
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return (
    <Sub titulo="Reclamos de llave" sub="Portabilidad: traer una llave que está en otro banco. Reivindicación: disputar una llave que otro tiene. Si otro banco pide una llave de esta cuenta, aparece aquí para liberarla o quedártela.">
      {lista === null ? <p style={{ fontSize: 12, color: C.sub, margin: 0 }}>Consultando…</p> : lista.length === 0 ? <p style={{ fontSize: 12, color: C.sub, margin: 0 }}>No hay reclamos pendientes.</p> : lista.map((r: any) => {
        const id = r.claimId ?? r.id;
        return (
          <div key={id} style={{ padding: '8px 0', borderTop: `1px solid ${C.b1}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontFamily: MONO }}>{r.claimType ?? ''} · {r.type ?? ''} {r.key ?? ''} · {r.role ?? r.side ?? ''}</span>
              <Pill t={r.status} tono={tonoDe(r.status)} />
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <button onClick={async () => { if (await llamar({ action: 'admin_gowd_reclamo_cancelar', claimId: id })) { setMsg({ ok: true, texto: 'Reclamo cancelado.' }); cargar(); } }} disabled={ocupado} style={{ ...btnSec, padding: '4px 9px', fontSize: 11 }}>Cancelar (si lo pedimos nosotros)</button>
              <button onClick={async () => { const x = await llamar({ action: 'admin_gowd_reclamo_donante_pedir', claimId: id }); if (x?.validationId) { setValidacion({ id: x.validationId, donante: id }); setMsg({ ok: true, texto: 'Código enviado al contacto de la cuenta.' }); } }} disabled={ocupado} style={{ ...btnSec, padding: '4px 9px', fontSize: 11 }}>Responder (nos piden la llave)</button>
            </div>
            <VerJson v={r} />
          </div>
        );
      })}

      {validacion ? (
        <div style={{ ...grid, marginTop: 10 }}>
          <div><Etq>CÓDIGO</Etq><input value={codigo} onChange={e => setCodigo(e.target.value.trim())} style={{ ...campo, fontFamily: MONO }} autoFocus /></div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
            {validacion.donante ? <>
              <button onClick={async () => { if (await llamar({ action: 'admin_gowd_reclamo_donante_confirmar', claimId: validacion.donante, validationId: validacion.id, token: codigo, decision: 'CANCEL' })) { setValidacion(null); setMsg({ ok: true, texto: 'La llave se queda en esta cuenta.' }); cargar(); onListo(); } }} disabled={ocupado || !codigo} style={btnPri}>Quedarme la llave</button>
              <button onClick={async () => { if (!confirm('¿Liberar la llave al otro banco? Los PIX a esa llave dejarán de llegar aquí.')) return; if (await llamar({ action: 'admin_gowd_reclamo_donante_confirmar', claimId: validacion.donante, validationId: validacion.id, token: codigo, decision: 'CONFIRM' })) { setValidacion(null); setMsg({ ok: true, texto: 'Llave liberada.' }); cargar(); onListo(); } }} disabled={ocupado || !codigo} style={btnPeligro}>Liberar llave</button>
              <button onClick={async () => { if (await llamar({ action: 'admin_gowd_reclamo_donante_reenviar', claimId: validacion.donante, validationId: validacion.id })) setMsg({ ok: true, texto: 'Código reenviado.' }); }} disabled={ocupado} style={btnSec}>Reenviar</button>
            </> : <>
              <button onClick={async () => { if (await llamar({ action: 'admin_gowd_reclamo_confirmar', validationId: validacion.id, token: codigo })) { setValidacion(null); setMsg({ ok: true, texto: 'Reclamo enviado.' }); cargar(); } }} disabled={ocupado || !codigo} style={btnPri}>Confirmar</button>
              <button onClick={async () => { if (await llamar({ action: 'admin_gowd_reclamo_reenviar', validationId: validacion.id })) setMsg({ ok: true, texto: 'Código reenviado.' }); }} disabled={ocupado} style={btnSec}>Reenviar</button>
            </>}
            <button onClick={() => setValidacion(null)} style={btnSec}>Cerrar</button>
          </div>
        </div>
      ) : (
        <div style={{ ...grid, marginTop: 12 }}>
          <div><Etq>TIPO DE RECLAMO</Etq><select value={f.claimType} onChange={e => setF({ ...f, claimType: e.target.value })} style={campo}><option value="PORTABILITY">Portabilidad</option><option value="CLAIM_OWNERSHIP">Reivindicación</option></select></div>
          <div><Etq>LLAVE</Etq><select value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })} style={campo}><option value="CPF">CPF</option><option value="CNPJ">CNPJ</option><option value="EMAIL">Correo</option><option value="PHONE">Teléfono</option></select></div>
          <div><Etq>VALOR</Etq><input value={f.key} onChange={e => setF({ ...f, key: e.target.value })} style={{ ...campo, fontFamily: MONO }} /></div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}><button onClick={async () => { const r = await llamar({ action: 'admin_gowd_reclamo_crear', ...f }); if (!r) return; if (r.pendiente) { setValidacion({ id: r.validationId }); setMsg({ ok: true, texto: 'Código enviado al correo/teléfono reclamado.' }); } else { setMsg({ ok: true, texto: 'Reclamo creado.' }); cargar(); } }} disabled={ocupado || !f.key} style={{ ...btnPri, width: '100%' }}>Reclamar</button></div>
        </div>
      )}
      <Msg r={msg} />
    </Sub>
  );
};

// ── Asignar a un cliente ──
const AsignarCliente: React.FC<{ c: any; onListo: () => void }> = ({ c, onListo }) => {
  const [q, setQ] = useState('');
  const [lista, setLista] = useState<any[]>([]);
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => { const r = await pedirGowd({ action: 'admin_gowd_clientes', q }); setLista(r?.clientes ?? []); if (r?.ok === false) setMsg({ texto: r.error }); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const asignar = async (u: any) => {
    if (!confirm(`¿Asignar la cuenta de ${c.titular} (Ag ${c.agencia} · Conta ${c.conta}) a ${u.nombre}? El cliente la verá para recibir PIX.`)) return;
    setOcupado(true); setMsg(null);
    const r = await pedirGowd({ action: 'admin_gowd_asignar', gowdId: c.id, userId: u.id });
    setOcupado(false);
    if (!r?.ok) { setMsg({ texto: r?.error ?? 'No se pudo asignar.' }); return; }
    onListo();
  };
  return (
    <Sub titulo="Asignar a un cliente Empresa" sub="El cliente ve titular, banco 677, agência, conta y la llave PIX. Le llega el aviso.">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por empresa, correo o NIT" style={campo} autoFocus />
      <div style={{ marginTop: 8 }}>
        {lista.map(u => (
          <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${C.b1}` }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{u.nombre || u.email}</span>
              <span style={{ display: 'block', fontSize: 11, color: C.sub }}>{u.email}{u.nit ? ` · ${u.nit}` : ''} · KYC {u.kyc ?? '—'}{u.tieneCuentaBrasil ? ' · ya tiene cuenta en Brasil' : ''}</span>
            </span>
            <button onClick={() => asignar(u)} disabled={ocupado || u.tieneCuentaBrasil} style={{ ...btnPri, padding: '6px 11px', fontSize: 12, opacity: ocupado || u.tieneCuentaBrasil ? 0.5 : 1 }}>Asignar</button>
          </div>
        ))}
      </div>
      <Msg r={msg} />
    </Sub>
  );
};

// ── Cobrar con QR ──
const Cobrar: React.FC<{ c: any }> = ({ c }) => {
  const llaves: any[] = Array.isArray(c.llaves) ? c.llaves : [];
  const [f, setF] = useState({ estatico: false, monto: '', descripcion: '', pixKey: llaves[0]?.key ?? '', horas: '24', pagNombre: '', pagTipo: 'CPF', pagDoc: '' });
  const [idem, setIdem] = useState(uuid());
  const [qr, setQr] = useState<any>(null);
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const generar = async () => {
    setOcupado(true); setMsg(null); setQr(null);
    const r = await pedirGowd({
      action: f.estatico ? 'admin_gowd_qr_estatico' : 'admin_gowd_cobro', gowdId: c.id, idempotencia: idem,
      monto: f.monto, descripcion: f.descripcion, pixKey: f.pixKey, expiracionSeg: Math.round(Number(f.horas || 24) * 3600),
      pagador: f.pagNombre ? { nombre: f.pagNombre, docTipo: f.pagTipo, docNumero: f.pagDoc } : null,
    });
    setOcupado(false);
    if (!r?.ok) { setMsg({ texto: r?.error ?? 'No se pudo generar.' }); return; }
    if (r.repetida) { setMsg({ ok: true, texto: 'Ese cobro ya se había generado. Míralo en Operaciones.' }); return; }
    setQr(r.qr); setIdem(uuid());
  };
  return (
    <Sub titulo="Cobrar con PIX" sub="QR dinámico (con vencimiento) o estático. El pagador escanea o pega el copia-e-cola.">
      <div style={grid}>
        <div><Etq>TIPO</Etq><select value={f.estatico ? 'e' : 'd'} onChange={e => setF({ ...f, estatico: e.target.value === 'e' })} style={campo}><option value="d">QR dinámico</option><option value="e">QR estático</option></select></div>
        <div><Etq>MONTO (BRL)</Etq><input value={f.monto} onChange={e => setF({ ...f, monto: e.target.value })} placeholder="100.00" inputMode="decimal" style={{ ...campo, fontFamily: MONO }} /></div>
        <div><Etq>LLAVE PIX</Etq><select value={f.pixKey} onChange={e => setF({ ...f, pixKey: e.target.value })} style={campo}>{!f.estatico && <option value="">La que elija Gowd</option>}{llaves.map(l => <option key={l.key} value={l.key}>{l.type} · {l.key}</option>)}</select></div>
        {!f.estatico && <div><Etq>VENCE EN (HORAS)</Etq><input value={f.horas} onChange={e => setF({ ...f, horas: e.target.value.replace(/[^\d.]/g, '') })} style={campo} /></div>}
        <div style={{ gridColumn: '1 / -1' }}><Etq>DESCRIPCIÓN</Etq><input value={f.descripcion} onChange={e => setF({ ...f, descripcion: e.target.value })} maxLength={140} style={campo} /></div>
        {!f.estatico && <>
          <div><Etq>PAGADOR (OPCIONAL)</Etq><input value={f.pagNombre} onChange={e => setF({ ...f, pagNombre: e.target.value })} placeholder="Nombre" style={campo} /></div>
          <div><Etq>DOCUMENTO</Etq><select value={f.pagTipo} onChange={e => setF({ ...f, pagTipo: e.target.value })} style={campo}><option value="CPF">CPF</option><option value="CNPJ">CNPJ</option></select></div>
          <div><Etq>NÚMERO</Etq><input value={f.pagDoc} onChange={e => setF({ ...f, pagDoc: e.target.value })} style={{ ...campo, fontFamily: MONO }} /></div>
        </>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button onClick={generar} disabled={ocupado || !f.monto} style={{ ...btnPri, opacity: ocupado || !f.monto ? 0.6 : 1 }}>{ocupado ? 'Generando…' : 'Generar QR'}</button>
      </div>
      <Msg r={msg} />
      {qr && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12, alignItems: 'flex-start' }}>
          {qr.qrcodeImageBase64 && (
            <div style={{ background: '#fff', padding: 10, borderRadius: 10 }}>
              <img src={qr.qrcodeImageBase64.startsWith('data:') ? qr.qrcodeImageBase64 : `data:image/png;base64,${qr.qrcodeImageBase64}`} alt="QR PIX" style={{ width: 220, height: 220, display: 'block', imageRendering: 'pixelated' }} />
            </div>
          )}
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <Etq>COPIA E COLA</Etq>
            <p style={{ fontFamily: MONO, fontSize: 11, wordBreak: 'break-all', margin: 0, color: C.text }}>{qr.qrcodeData}</p>
            <button onClick={() => copiar(qr.qrcodeData)} style={{ ...btnSec, marginTop: 8 }}>Copiar</button>
            <p style={{ fontSize: 11.5, color: C.sub, margin: '8px 0 0' }}>{qr.status ? `Estado: ${qr.status}` : ''}{qr.expireDateTime ? ` · vence ${fechaHora(qr.expireDateTime)}` : ''}{qr.id ? ` · id ${qr.id}` : ''}</p>
          </div>
        </div>
      )}
    </Sub>
  );
};

// ── Enviar PIX/TED ──
const Enviar: React.FC<{ c: any }> = ({ c }) => {
  const [f, setF] = useState({ metodo: 'PIX', modo: 'pixKey', pixKey: '', qrcodeData: '', ispb: '', agencia: '', conta: '', tipo: 'CHECKING_ACCOUNT', recNombre: '', recTipo: 'CPF', recDoc: '', monto: '', descripcion: '' });
  const [confirmado, setConfirmado] = useState(false);
  const [idem, setIdem] = useState(uuid());
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { setF(p => ({ ...p, [k]: e.target.value })); setConfirmado(false); };
  const enviar = async () => {
    setOcupado(true); setMsg(null);
    const r = await pedirGowd({
      action: 'admin_gowd_envio', gowdId: c.id, idempotencia: idem, confirmado,
      metodo: f.metodo, modo: f.modo, pixKey: f.pixKey, qrcodeData: f.qrcodeData,
      cuenta: { ispb: f.ispb, agencia: f.agencia, conta: f.conta, tipo: f.tipo },
      receptor: f.recNombre ? { nombre: f.recNombre, docTipo: f.recTipo, docNumero: f.recDoc } : null,
      monto: f.monto, descripcion: f.descripcion,
    });
    setOcupado(false);
    if (!r?.ok) { setMsg({ texto: r?.error ?? 'No se pudo enviar.' }); return; }
    if (r.repetida) { setMsg({ ok: true, texto: 'Este envío ya se había mandado (misma operación). Míralo en Operaciones.' }); return; }
    setMsg({ ok: true, texto: `Envío creado: ${r.envio?.status ?? ''} · id ${r.envio?.id ?? ''}${r.envio?.endToEndId ? ` · E2E ${r.envio.endToEndId}` : ''}` });
    setIdem(uuid()); setConfirmado(false);
  };
  return (
    <Sub titulo="Enviar desde esta cuenta" sub="Solo el dueño. PIX a llave, a copia-e-cola o a cuenta bancaria; TED solo a cuenta bancaria. Un doble clic no lo manda dos veces.">
      <div style={grid}>
        <div><Etq>MÉTODO</Etq><select value={f.metodo} onChange={e => { set('metodo')(e); if (e.target.value === 'TED') setF(p => ({ ...p, metodo: 'TED', modo: 'bankAccount' })); }} style={campo}><option value="PIX">PIX</option><option value="TED">TED</option></select></div>
        {f.metodo === 'PIX' && <div><Etq>DESTINO</Etq><select value={f.modo} onChange={set('modo')} style={campo}><option value="pixKey">Llave PIX</option><option value="qrcodeData">Copia-e-cola / QR</option><option value="bankAccount">Cuenta bancaria</option></select></div>}
        <div><Etq>MONTO (BRL)</Etq><input value={f.monto} onChange={set('monto')} placeholder="50.00" inputMode="decimal" style={{ ...campo, fontFamily: MONO }} /></div>
        {f.modo === 'pixKey' && f.metodo === 'PIX' && <div style={{ gridColumn: '1 / -1' }}><Etq>LLAVE PIX DE DESTINO</Etq><input value={f.pixKey} onChange={set('pixKey')} style={{ ...campo, fontFamily: MONO }} /></div>}
        {f.modo === 'qrcodeData' && f.metodo === 'PIX' && <div style={{ gridColumn: '1 / -1' }}><Etq>COPIA-E-COLA</Etq><textarea value={f.qrcodeData} onChange={set('qrcodeData')} rows={3} style={{ ...campo, fontFamily: MONO, resize: 'vertical' }} /></div>}
        {(f.modo === 'bankAccount' || f.metodo === 'TED') && <>
          <div><Etq>ISPB</Etq><input value={f.ispb} onChange={set('ispb')} maxLength={8} style={{ ...campo, fontFamily: MONO }} /></div>
          <div><Etq>AGÊNCIA</Etq><input value={f.agencia} onChange={set('agencia')} style={{ ...campo, fontFamily: MONO }} /></div>
          <div><Etq>CONTA</Etq><input value={f.conta} onChange={set('conta')} style={{ ...campo, fontFamily: MONO }} /></div>
          <div><Etq>TIPO</Etq><select value={f.tipo} onChange={set('tipo')} style={campo}><option value="CHECKING_ACCOUNT">Corrente</option><option value="PAYMENT_ACCOUNT">Pagamento</option></select></div>
        </>}
        <div><Etq>QUIEN RECIBE{f.modo === 'bankAccount' || f.metodo === 'TED' ? '' : ' (OPCIONAL)'}</Etq><input value={f.recNombre} onChange={set('recNombre')} placeholder="Nombre" style={campo} /></div>
        <div><Etq>DOCUMENTO</Etq><select value={f.recTipo} onChange={set('recTipo')} style={campo}><option value="CPF">CPF</option><option value="CNPJ">CNPJ</option></select></div>
        <div><Etq>NÚMERO</Etq><input value={f.recDoc} onChange={set('recDoc')} style={{ ...campo, fontFamily: MONO }} /></div>
        <div style={{ gridColumn: '1 / -1' }}><Etq>DESCRIPCIÓN</Etq><input value={f.descripcion} onChange={set('descripcion')} maxLength={140} style={campo} /></div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: C.text, marginTop: 10 }}>
        <input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} /> Revisé destino y monto: enviar BRL {f.monto || '0.00'} desde {c.titular}
      </label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button onClick={enviar} disabled={ocupado || !confirmado} style={{ ...btnPri, opacity: ocupado || !confirmado ? 0.5 : 1 }}>{ocupado ? 'Enviando…' : 'Enviar'}</button>
      </div>
      <Msg r={msg} />
    </Sub>
  );
};

// ── MED y cierre ──
const AbrirMed: React.FC<{ c: any }> = ({ c }) => {
  const [f, setF] = useState({ endToEndId: '', situationType: 'SCAM', details: '' });
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const abrir = async () => {
    if (!confirm('¿Abrir un caso MED ante el DICT por esta transacción?')) return;
    setOcupado(true); setMsg(null);
    const r = await pedirGowd({ action: 'admin_gowd_med_abrir', gowdId: c.id, ...f });
    setOcupado(false);
    setMsg(r?.ok ? { ok: true, texto: `Caso abierto: ${r.caso?.referenceId ?? ''} · ${r.caso?.status ?? ''}` } : { texto: r?.error ?? 'No se pudo.' });
  };
  return (
    <Sub titulo="Abrir MED (recuperación de valores)" sub="Para un PIX que salió de esta cuenta por fraude o estafa. Solo el dueño.">
      <div style={grid}>
        <div style={{ gridColumn: '1 / -1' }}><Etq>END TO END ID</Etq><input value={f.endToEndId} onChange={e => setF({ ...f, endToEndId: e.target.value.trim() })} style={{ ...campo, fontFamily: MONO }} /></div>
        <div><Etq>SITUACIÓN</Etq><select value={f.situationType} onChange={e => setF({ ...f, situationType: e.target.value })} style={campo}>
          <option value="SCAM">Estafa</option><option value="UNAUTHORIZED_TRANSACTION">Transacción no autorizada</option><option value="CRIME_OF_COERCION">Coacción</option><option value="FRAUDULENT_ACCESS_AND_AUTHORIZATION">Acceso fraudulento</option><option value="OTHERS">Otros</option><option value="UNKNOWN">Desconocido</option>
        </select></div>
        <div style={{ gridColumn: '1 / -1' }}><Etq>DETALLE{f.situationType === 'OTHERS' ? '' : ' (OPCIONAL)'}</Etq><textarea value={f.details} onChange={e => setF({ ...f, details: e.target.value.slice(0, 2000) })} rows={3} style={{ ...campo, resize: 'vertical' }} /></div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button onClick={abrir} disabled={ocupado || !f.endToEndId} style={btnPri}>{ocupado ? '…' : 'Abrir caso'}</button></div>
      <Msg r={msg} />
    </Sub>
  );
};

const PedirCierre: React.FC<{ c: any; onListo: () => void }> = ({ c, onListo }) => {
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const pedir = async () => {
    if (!confirm(`¿Pedir el cierre de la cuenta de ${c.titular}? Gowd la analiza y, confirmada, deja de recibir.`)) return;
    setOcupado(true); setMsg(null);
    const r = await pedirGowd({ action: 'admin_gowd_cierre_pedir', gowdId: c.id, motivo });
    setOcupado(false);
    setMsg(r?.ok ? { ok: true, texto: `Cierre pedido: ${r.cierre?.status ?? ''} · ${r.cierre?.closeAccountRequestId ?? ''}` } : { texto: r?.error ?? 'No se pudo.' });
    if (r?.ok) onListo();
  };
  return (
    <Sub titulo="Cerrar la cuenta" sub={c.user_id ? 'Primero desasígnala del cliente.' : 'Solo el dueño. Queda PENDING hasta que Gowd la analice.'}>
      <input value={motivo} onChange={e => setMotivo(e.target.value.slice(0, 300))} placeholder="Motivo del cierre" style={campo} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button onClick={pedir} disabled={ocupado || motivo.trim().length < 5 || !!c.user_id} style={{ ...btnPeligro, opacity: ocupado || motivo.trim().length < 5 || c.user_id ? 0.5 : 1 }}>Pedir cierre</button></div>
      <Msg r={msg} />
    </Sub>
  );
};

// ── Nueva cuenta ─────────────────────────────────────────────────────────
type Rep = { fullName: string; email: string; phone: string; birthdate: string; documentNumber: string };
const NuevaCuenta: React.FC<{ onCerrar: () => void; onCreada: (id: number) => void }> = ({ onCerrar, onCreada }) => {
  const [ht, setHt] = useState<'ORGANIZATION' | 'INDIVIDUAL'>('ORGANIZATION');
  const [f, setF] = useState({ fullName: '', documento: '', email: '', phone: '+55', birthdate: '', alias: '' });
  const [dir, setDir] = useState({ zipCode: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: '' });
  const [reps, setReps] = useState<Rep[]>([{ fullName: '', email: '', phone: '+55', birthdate: '', documentNumber: '' }]);
  const [terminos, setTerminos] = useState<any>(null);
  const [acepta, setAcepta] = useState(false);
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setTerminos(null); setAcepta(false);
    (async () => { const r = await pedirGowd({ action: 'admin_gowd_terminos', holderType: ht }); setTerminos(r?.ok ? r.terminos : { error: r?.error }); })();
  }, [ht]);

  const crear = async () => {
    setOcupado(true); setMsg(null);
    const r = await pedirGowd({ action: 'admin_gowd_crear', holderType: ht, ...f, direccion: dir, representantes: ht === 'ORGANIZATION' ? reps : [], terminosAceptados: acepta });
    setOcupado(false);
    if (!r?.ok) { setMsg({ texto: r?.error ?? 'No se pudo crear.' }); return; }
    alert(`Solicitud creada en Gowd.${r.aviso ? `\n\n${r.aviso}` : ''}\n\nAhora sube los documentos que pide.`);
    onCreada(r.cuenta?.id);
  };
  const setRep = (i: number, k: keyof Rep, v: string) => setReps(p => p.map((x, j) => j === i ? { ...x, [k]: v } : x));

  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ fontFamily: FONT, color: C.text, width: '100%', maxWidth: 720, maxHeight: '90vh', overflowY: 'auto', background: C.card, border: `1px solid ${C.b2}`, borderRadius: 16, padding: 20, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <Titulo sub="La cuenta es en Brasil: el titular tiene CNPJ o CPF brasileño y dirección en Brasil.">Nueva cuenta en Gowd</Titulo>
          <button onClick={onCerrar} style={{ ...btnSec, padding: '6px 10px' }}>Cerrar</button>
        </div>
        <div style={grid}>
          <div><Etq>TITULAR</Etq><select value={ht} onChange={e => setHt(e.target.value as any)} style={campo}><option value="ORGANIZATION">Empresa (CNPJ)</option><option value="INDIVIDUAL">Persona (CPF)</option></select></div>
          <div style={{ gridColumn: 'span 2' }}><Etq>{ht === 'ORGANIZATION' ? 'RAZÃO SOCIAL' : 'NOMBRE COMPLETO'}</Etq><input value={f.fullName} onChange={e => setF({ ...f, fullName: e.target.value })} style={campo} /></div>
          <div><Etq>{ht === 'ORGANIZATION' ? 'CNPJ' : 'CPF'}</Etq><input value={f.documento} onChange={e => setF({ ...f, documento: e.target.value })} style={{ ...campo, fontFamily: MONO }} /></div>
          <div><Etq>CORREO</Etq><input value={f.email} onChange={e => setF({ ...f, email: e.target.value })} style={campo} /></div>
          <div><Etq>TELÉFONO</Etq><input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} style={{ ...campo, fontFamily: MONO }} /></div>
          <div><Etq>{ht === 'ORGANIZATION' ? 'FECHA DE CONSTITUCIÓN' : 'FECHA DE NACIMIENTO'}</Etq><input type="date" value={f.birthdate} onChange={e => setF({ ...f, birthdate: e.target.value })} style={campo} /></div>
          <div><Etq>ALIAS (OPCIONAL)</Etq><input value={f.alias} onChange={e => setF({ ...f, alias: e.target.value })} placeholder="Para varias cuentas del mismo titular" style={campo} /></div>
        </div>

        <p style={{ fontSize: 12, fontWeight: 700, margin: '16px 0 8px', color: C.sub }}>DIRECCIÓN EN BRASIL</p>
        <div style={grid}>
          <div><Etq>CEP</Etq><input value={dir.zipCode} onChange={e => setDir({ ...dir, zipCode: e.target.value })} style={{ ...campo, fontFamily: MONO }} /></div>
          <div style={{ gridColumn: 'span 2' }}><Etq>CALLE</Etq><input value={dir.street} onChange={e => setDir({ ...dir, street: e.target.value })} style={campo} /></div>
          <div><Etq>NÚMERO</Etq><input value={dir.number} onChange={e => setDir({ ...dir, number: e.target.value })} style={campo} /></div>
          <div><Etq>COMPLEMENTO</Etq><input value={dir.complement} onChange={e => setDir({ ...dir, complement: e.target.value })} style={campo} /></div>
          <div><Etq>BARRIO</Etq><input value={dir.neighborhood} onChange={e => setDir({ ...dir, neighborhood: e.target.value })} style={campo} /></div>
          <div><Etq>CIUDAD</Etq><input value={dir.city} onChange={e => setDir({ ...dir, city: e.target.value })} style={campo} /></div>
          <div><Etq>ESTADO (UF)</Etq><input value={dir.state} onChange={e => setDir({ ...dir, state: e.target.value.toUpperCase().slice(0, 2) })} placeholder="SP" style={campo} /></div>
        </div>

        {ht === 'ORGANIZATION' && <>
          <p style={{ fontSize: 12, fontWeight: 700, margin: '16px 0 8px', color: C.sub }}>REPRESENTANTES LEGALES</p>
          {reps.map((r, i) => (
            <div key={i} style={{ ...grid, padding: '10px 0', borderTop: i ? `1px solid ${C.b1}` : 'none' }}>
              <div style={{ gridColumn: 'span 2' }}><Etq>NOMBRE</Etq><input value={r.fullName} onChange={e => setRep(i, 'fullName', e.target.value)} style={campo} /></div>
              <div><Etq>CPF</Etq><input value={r.documentNumber} onChange={e => setRep(i, 'documentNumber', e.target.value)} style={{ ...campo, fontFamily: MONO }} /></div>
              <div><Etq>CORREO</Etq><input value={r.email} onChange={e => setRep(i, 'email', e.target.value)} style={campo} /></div>
              <div><Etq>TELÉFONO</Etq><input value={r.phone} onChange={e => setRep(i, 'phone', e.target.value)} style={{ ...campo, fontFamily: MONO }} /></div>
              <div><Etq>NACIMIENTO</Etq><input type="date" value={r.birthdate} onChange={e => setRep(i, 'birthdate', e.target.value)} style={campo} /></div>
              {reps.length > 1 && <div style={{ display: 'flex', alignItems: 'flex-end' }}><button onClick={() => setReps(p => p.filter((_, j) => j !== i))} style={btnPeligro}>Quitar</button></div>}
            </div>
          ))}
          <button onClick={() => setReps(p => [...p, { fullName: '', email: '', phone: '+55', birthdate: '', documentNumber: '' }])} style={{ ...btnSec, marginTop: 6 }}>Agregar representante</button>
        </>}

        <div style={{ marginTop: 16, padding: 12, background: C.elev, border: `1px solid ${C.b1}`, borderRadius: 10 }}>
          <Etq>CONTRATO DE LA CUENTA</Etq>
          {!terminos ? <p style={{ fontSize: 12, color: C.sub, margin: 0 }}>Trayendo el contrato vigente…</p>
            : terminos.error ? <p style={{ fontSize: 12, color: C.red, margin: 0 }}>{terminos.error}</p>
            : <p style={{ fontSize: 12.5, margin: 0 }}><a href={terminos.url} target="_blank" rel="noreferrer" style={{ color: C.green }}>{terminos.fileName ?? 'Abrir contrato'}</a>{terminos.expiresAt ? <span style={{ color: C.sub }}> · el enlace vence {fechaHora(terminos.expiresAt)}</span> : null}</p>}
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, marginTop: 8, lineHeight: 1.45 }}>
            <input type="checkbox" checked={acepta} onChange={e => setAcepta(e.target.checked)} style={{ marginTop: 2 }} /> El titular leyó y aceptó este contrato.
          </label>
        </div>

        <Msg r={msg} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onCerrar} style={btnSec}>Cancelar</button>
          <button onClick={crear} disabled={ocupado || !acepta} style={{ ...btnPri, opacity: ocupado || !acepta ? 0.6 : 1 }}>{ocupado ? 'Creando…' : 'Crear solicitud'}</button>
        </div>
      </div>
    </div>
  );
};

// ── Operaciones ──────────────────────────────────────────────────────────
const TIPO_OP: Record<string, string> = { cobro: 'Cobro', qr_estatico: 'QR estático', envio: 'Envío', reembolso: 'Reembolso', cierre: 'Cierre', med: 'MED' };
const Operaciones: React.FC<{ cuentas: any[]; puede: boolean }> = ({ cuentas, puede }) => {
  const [ops, setOps] = useState<any[] | null>(null);
  const [filtro, setFiltro] = useState('');
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const [reembolso, setReembolso] = useState<any>(null);
  const titular = useMemo(() => Object.fromEntries(cuentas.map(c => [c.id, c.titular])), [cuentas]);
  const cargar = async () => { const r = await pedirGowd({ action: 'admin_gowd_operaciones', tipo: filtro || undefined }); if (!r?.ok) setMsg({ texto: r?.error }); setOps(r?.operaciones ?? []); };
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filtro]);
  const consultar = async (op: any) => {
    setMsg(null);
    const r = await pedirGowd({ action: 'admin_gowd_consultar', opId: op.id });
    setMsg(r?.ok ? { ok: true, texto: `Gowd dice: ${r.orden?.status ?? '—'}` } : { texto: r?.error ?? 'No se pudo.' });
    cargar();
  };
  return (
    <Tarjeta>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Titulo sub="Lo creado desde este panel. El estado se actualiza con los avisos firmados de Gowd o con Consultar.">Operaciones</Titulo>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={filtro} onChange={e => setFiltro(e.target.value)} style={{ ...campo, width: 'auto' }}><option value="">Todas</option>{Object.entries(TIPO_OP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {puede && <button onClick={() => setReembolso({})} style={btnSec}>Reembolsar un cobro</button>}
        </div>
      </div>
      <Msg r={msg} />
      {reembolso && <Reembolso base={reembolso} onCerrar={() => { setReembolso(null); cargar(); }} />}
      {ops === null ? <p style={{ fontSize: 12, color: C.sub }}>Consultando…</p> : ops.length === 0 ? <p style={{ fontSize: 12, color: C.sub }}>Sin operaciones.</p> : ops.map(op => (
        <div key={op.id} style={{ padding: '9px 0', borderTop: `1px solid ${C.b1}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{TIPO_OP[op.tipo] ?? op.tipo}{op.monto ? ` · ${op.moneda ?? 'BRL'} ${op.monto}` : ''}</span>
              <span style={{ display: 'block', fontSize: 11, color: C.sub }}>{fechaHora(op.creada_at)} · {titular[op.gowd_cuenta_id] ?? '—'}{op.descripcion ? ` · ${op.descripcion}` : ''}{op.end_to_end ? ` · ${op.end_to_end}` : ''}</span>
            </span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Pill t={op.estado} tono={tonoDe(op.estado)} />
              {['cobro', 'envio', 'reembolso'].includes(op.tipo) && op.gowd_id && <button onClick={() => consultar(op)} style={{ ...btnSec, padding: '4px 9px', fontSize: 11 }}>Consultar</button>}
              {puede && op.tipo === 'cobro' && op.estado === 'PAID' && <button onClick={() => setReembolso({ orderId: op.gowd_id, monto: op.monto, gowdId: op.gowd_cuenta_id })} style={{ ...btnSec, padding: '4px 9px', fontSize: 11 }}>Reembolsar</button>}
            </span>
          </div>
          <VerJson v={{ enviado: op.datos_enviados, respuesta: op.respuesta, gowdId: op.gowd_id, externalId: op.external_id }} />
        </div>
      ))}
    </Tarjeta>
  );
};

const Reembolso: React.FC<{ base: any; onCerrar: () => void }> = ({ base, onCerrar }) => {
  const [f, setF] = useState({ orderId: base.orderId ?? '', monto: base.monto ?? '', refundCode: 'RECEIVER_REQUEST', motivo: '', descripcion: '' });
  const [confirmado, setConfirmado] = useState(false);
  const [idem] = useState(uuid());
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const enviar = async () => {
    setOcupado(true); setMsg(null);
    const r = await pedirGowd({ action: 'admin_gowd_reembolso', gowdId: base.gowdId, idempotencia: idem, confirmado, ...f });
    setOcupado(false);
    setMsg(r?.ok ? { ok: true, texto: r.repetida ? 'Ese reembolso ya se había pedido.' : `Reembolso: ${r.reembolso?.status ?? ''} · ${r.reembolso?.id ?? ''}` } : { texto: r?.error ?? 'No se pudo.' });
  };
  return (
    <Sub titulo="Reembolsar un cobro" sub="Devuelve al pagador todo o parte de un cobro pagado. Solo el dueño.">
      <div style={grid}>
        <div style={{ gridColumn: '1 / -1' }}><Etq>ID DEL COBRO EN GOWD</Etq><input value={f.orderId} onChange={e => setF({ ...f, orderId: e.target.value.trim() })} style={{ ...campo, fontFamily: MONO }} /></div>
        <div><Etq>MONTO (BRL)</Etq><input value={f.monto} onChange={e => setF({ ...f, monto: e.target.value })} style={{ ...campo, fontFamily: MONO }} /></div>
        <div><Etq>CÓDIGO</Etq><input value={f.refundCode} onChange={e => setF({ ...f, refundCode: e.target.value.toUpperCase() })} style={{ ...campo, fontFamily: MONO }} /></div>
        <div style={{ gridColumn: '1 / -1' }}><Etq>MOTIVO</Etq><input value={f.motivo} onChange={e => setF({ ...f, motivo: e.target.value })} style={campo} /></div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, marginTop: 10 }}><input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} /> Devolver BRL {f.monto || '0.00'} al pagador</label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <button onClick={onCerrar} style={btnSec}>Cerrar</button>
        <button onClick={enviar} disabled={ocupado || !confirmado} style={{ ...btnPri, opacity: ocupado || !confirmado ? 0.5 : 1 }}>{ocupado ? '…' : 'Reembolsar'}</button>
      </div>
      <Msg r={msg} />
    </Sub>
  );
};

// ── Extracto ─────────────────────────────────────────────────────────────
const Extracto: React.FC<{ cuentas: any[] }> = ({ cuentas }) => {
  const abiertas = cuentas.filter(c => c.account_id);
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [f, setF] = useState({ gowdId: abiertas[0]?.id ?? '', desde: hace30, hasta: hoy, operacion: '', endToEndId: '', agruparLotes: false });
  const [res, setRes] = useState<any>(null);
  const [ocupado, setOcupado] = useState(false);
  const consultar = async (cursor?: string) => {
    setOcupado(true);
    const r = await pedirGowd({ action: 'admin_gowd_extracto', ...f, cursor });
    setOcupado(false);
    setRes((prev: any) => cursor && prev?.ok && r?.ok ? { ...r, movimientos: [...prev.movimientos, ...r.movimientos] } : r);
  };
  const m = (x: any) => ({
    fecha: x.createdAt ?? x.date ?? x.transactionDate ?? x.updatedAt,
    dir: x.operation ?? x.direction ?? x.type,
    monto: x.amount?.value != null ? `${x.amount.currency ?? 'BRL'} ${x.amount.value}` : x.amount ?? x.value,
    desc: x.description ?? x.message ?? x.counterparty?.name ?? x.payer?.name ?? x.receiver?.name ?? '',
    e2e: x.endToEndId,
  });
  return (
    <Tarjeta>
      <Titulo sub="Movimientos de una cuenta en BRL, directo de Gowd.">Extracto</Titulo>
      <div style={grid}>
        <div style={{ gridColumn: 'span 2' }}><Etq>CUENTA</Etq><select value={f.gowdId} onChange={e => setF({ ...f, gowdId: e.target.value })} style={campo}>{abiertas.map(c => <option key={c.id} value={c.id}>{c.titular}{c.alias ? ` · ${c.alias}` : ''}</option>)}</select></div>
        <div><Etq>DESDE</Etq><input type="date" value={f.desde} onChange={e => setF({ ...f, desde: e.target.value })} style={campo} /></div>
        <div><Etq>HASTA</Etq><input type="date" value={f.hasta} onChange={e => setF({ ...f, hasta: e.target.value })} style={campo} /></div>
        <div><Etq>DIRECCIÓN</Etq><select value={f.operacion} onChange={e => setF({ ...f, operacion: e.target.value })} style={campo}><option value="">Entradas y salidas</option><option value="in">Entradas</option><option value="out">Salidas</option></select></div>
        <div><Etq>END TO END (OPCIONAL)</Etq><input value={f.endToEndId} onChange={e => setF({ ...f, endToEndId: e.target.value.trim() })} style={{ ...campo, fontFamily: MONO }} /></div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: C.sub, marginTop: 10 }}><input type="checkbox" checked={f.agruparLotes} onChange={e => setF({ ...f, agruparLotes: e.target.checked })} /> Agrupar los lotes en una sola línea</label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button onClick={() => consultar()} disabled={ocupado || !f.gowdId} style={btnPri}>{ocupado ? 'Consultando…' : 'Consultar'}</button></div>
      {abiertas.length === 0 && <p style={{ fontSize: 12, color: C.sub }}>No hay cuentas abiertas todavía.</p>}
      {res?.ok === false && <Msg r={{ texto: res.error }} />}
      {res?.ok && (
        <div style={{ marginTop: 12 }}>
          {res.movimientos.length === 0 && <p style={{ fontSize: 12, color: C.sub }}>Sin movimientos en el periodo.</p>}
          {res.movimientos.map((x: any, i: number) => { const v = m(x); return (
            <div key={x.id ?? i} style={{ padding: '8px 0', borderTop: `1px solid ${C.b1}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5 }}>{fechaHora(v.fecha)} · {String(v.desc || '—')}</span>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: MONO, color: String(v.dir).toLowerCase() === 'in' ? C.green : C.text }}>{String(v.dir).toLowerCase() === 'out' ? '−' : String(v.dir).toLowerCase() === 'in' ? '+' : ''}{String(v.monto ?? '—')}</span>
              </div>
              {v.e2e && <p style={{ fontSize: 10.5, color: C.dim, fontFamily: MONO, margin: '2px 0 0' }}>{v.e2e}</p>}
              <VerJson v={x} />
            </div>
          ); })}
          {res.hasNext && res.nextCursor && <button onClick={() => consultar(res.nextCursor)} disabled={ocupado} style={{ ...btnSec, marginTop: 8 }}>Cargar más</button>}
        </div>
      )}
    </Tarjeta>
  );
};

// ── Webhooks ─────────────────────────────────────────────────────────────
const Webhooks: React.FC<{ puede: boolean }> = ({ puede }) => {
  const [cfg, setCfg] = useState<any>(null);
  const [editor, setEditor] = useState('');
  const [pend, setPend] = useState<any>(null);
  const [recibidos, setRecibidos] = useState<any>(null);
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const cargar = async () => {
    const [a, b, c] = await Promise.all([pedirGowd({ action: 'admin_gowd_webhook_ver' }), pedirGowd({ action: 'admin_gowd_webhook_eventos' }), pedirGowd({ action: 'admin_gowd_recibidos' })]);
    setCfg(a); setPend(b); setRecibidos(c);
    setEditor(JSON.stringify(a?.config?.events ?? [], null, 2));
  };
  useEffect(() => { cargar(); }, []);
  const llamar = async (body: Record<string, unknown>, ok: string) => {
    setOcupado(true); setMsg(null);
    const r = await pedirGowd(body);
    setOcupado(false);
    setMsg(r?.ok ? { ok: true, texto: ok } : { texto: r?.error ?? 'No se pudo.' });
    if (r?.ok) cargar();
  };
  const guardarEditor = () => {
    let events: any;
    try { events = JSON.parse(editor); } catch { setMsg({ texto: 'El JSON no es válido.' }); return; }
    if (!Array.isArray(events)) { setMsg({ texto: 'Tiene que ser una lista [ … ].' }); return; }
    llamar({ action: 'admin_gowd_webhook_guardar', events }, 'Webhook actualizado en Gowd.');
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Tarjeta>
        <Titulo sub="Gowd avisa a esta URL cada cobro, envío, reembolso, cambio de cuenta y caso MED. Cada aviso viene firmado y se verifica antes de creerle.">Webhook hacia Lincoin</Titulo>
        <p style={{ fontFamily: MONO, fontSize: 12.5, margin: 0 }}>{cfg?.urlNuestra ?? 'https://lincoin.me/webhooks/gowd'} <button onClick={() => copiar(cfg?.urlNuestra ?? 'https://lincoin.me/webhooks/gowd')} style={{ ...btnSec, padding: '3px 8px', fontSize: 11, marginLeft: 6 }}>Copiar</button></p>
        <p style={{ fontSize: 12, margin: '10px 0 0', color: cfg?.secretoGuardadoAt || cfg?.secretoEnSupabase ? C.green : C.amber }}>
          {cfg?.secretoGuardadoAt ? `Secreto de firma guardado el ${fechaHora(cfg.secretoGuardadoAt)}: los avisos se verifican.`
            : cfg?.secretoEnSupabase ? 'Secreto de firma en los secretos de Supabase: los avisos se verifican.'
            : 'Sin secreto de firma: los avisos se guardan como no verificados. Rota el secreto para activarlo.'}
        </p>
        {puede && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            <button onClick={() => llamar({ action: 'admin_gowd_webhook_apuntar' }, 'Todos los eventos apuntan a lincoin.me.')} disabled={ocupado} style={btnPri}>Apuntar eventos a lincoin.me</button>
            <button onClick={() => { if (confirm('¿Rotar el secreto? Gowd invalida el anterior en ese instante; el nuevo se guarda solo en el servidor.')) llamar({ action: 'admin_gowd_webhook_rotar' }, 'Secreto nuevo guardado. Los avisos se verifican con él.'); }} disabled={ocupado} style={btnSec}>Rotar secreto</button>
          </div>
        )}
        <Msg r={msg} />
      </Tarjeta>

      <Tarjeta>
        <Titulo sub="La lista completa de eventos en Gowd. Guardar la reemplaza entera.">Configuración en Gowd</Titulo>
        {cfg?.errorConfig && <p style={{ fontSize: 12, color: C.amber, margin: '0 0 8px' }}>{cfg.errorConfig}</p>}
        {cfg?.config && <p style={{ fontSize: 12, color: C.sub, margin: '0 0 8px' }}>Estado: {cfg.config.status ?? '—'} · actualizado {fechaHora(cfg.config.updatedAt)}</p>}
        <textarea value={editor} onChange={e => setEditor(e.target.value)} rows={10} disabled={!puede} style={{ ...campo, fontFamily: MONO, fontSize: 11.5, resize: 'vertical' }} />
        {puede && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button onClick={guardarEditor} disabled={ocupado} style={btnSec}>Guardar lista</button></div>}
      </Tarjeta>

      <Tarjeta>
        <Titulo sub="Avisos que Gowd no pudo entregar.">No entregados</Titulo>
        {pend?.ok === false ? <Msg r={{ texto: pend.error }} /> : !pend ? <p style={{ fontSize: 12, color: C.sub, margin: 0 }}>Consultando…</p> : pend.eventos.length === 0 ? <p style={{ fontSize: 12, color: C.sub, margin: 0 }}>Ninguno.</p> : pend.eventos.map((e: any) => (
          <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '7px 0', borderTop: `1px solid ${C.b1}`, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontFamily: MONO }}>{e.event ?? e.type ?? ''} · {fechaHora(e.createdAt)}</span>
            {puede && <button onClick={() => llamar({ action: 'admin_gowd_webhook_reenviar', eventoId: e.id }, 'Reenviado.')} disabled={ocupado} style={{ ...btnSec, padding: '4px 9px', fontSize: 11 }}>Reenviar</button>}
          </div>
        ))}
      </Tarjeta>

      <Tarjeta>
        <Titulo sub="Los últimos 100 que llegaron a lincoin.me.">Recibidos</Titulo>
        {recibidos?.ok === false ? <Msg r={{ texto: recibidos.error }} /> : !recibidos ? <p style={{ fontSize: 12, color: C.sub, margin: 0 }}>Consultando…</p> : recibidos.recibidos.length === 0 ? <p style={{ fontSize: 12, color: C.sub, margin: 0 }}>Ninguno todavía.</p> : recibidos.recibidos.map((e: any) => (
          <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '7px 0', borderTop: `1px solid ${C.b1}`, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12 }}>{fechaHora(e.recibido_at)} · <span style={{ fontFamily: MONO }}>{e.evento ?? '—'}</span>{e.monto_valor ? ` · ${e.monto_moneda ?? ''} ${e.monto_valor}` : ''}</span>
            <Pill t={e.verificado ? 'FIRMA OK' : e.metodo_auth === 'rechazado' ? 'RECHAZADO' : 'SIN VERIFICAR'} tono={e.verificado ? 'ok' : e.metodo_auth === 'rechazado' ? 'bad' : 'warn'} />
          </div>
        ))}
      </Tarjeta>
    </div>
  );
};

// ── MED ──────────────────────────────────────────────────────────────────
const Med: React.FC<{ cuentas: any[]; puede: boolean }> = ({ cuentas, puede }) => {
  const [f, setF] = useState({ gowdId: '', soloPendientes: true, rol: '' });
  const [res, setRes] = useState<any>(null);
  const [caso, setCaso] = useState<any>(null);
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const cargar = async () => setRes(await pedirGowd({ action: 'admin_gowd_med_listar', ...f, gowdId: f.gowdId || undefined }));
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [f.gowdId, f.soloPendientes, f.rol]);
  const ref = (x: any) => x.referenceId ?? x.id;
  return (
    <Tarjeta>
      <Titulo sub="Casos MED (recuperación de valores), notificaciones de infracción y pedidos de devolución, a favor o en contra de las cuentas.">MED</Titulo>
      <div style={grid}>
        <div><Etq>CUENTA</Etq><select value={f.gowdId} onChange={e => setF({ ...f, gowdId: e.target.value })} style={campo}><option value="">Todas</option>{cuentas.filter(c => c.account_id).map(c => <option key={c.id} value={c.id}>{c.titular}</option>)}</select></div>
        <div><Etq>LADO</Etq><select value={f.rol} onChange={e => setF({ ...f, rol: e.target.value })} style={campo}><option value="">Ambos</option><option value="PAYER">Pagador</option><option value="RECEIVER">Receptor</option></select></div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-end', fontSize: 12, color: C.sub }}><input type="checkbox" checked={f.soloPendientes} onChange={e => setF({ ...f, soloPendientes: e.target.checked })} /> Solo abiertos</label>
      </div>
      <Msg r={msg} />
      {res?.ok === false ? <Msg r={{ texto: res.error }} /> : !res ? <p style={{ fontSize: 12, color: C.sub }}>Consultando…</p> : res.casos.length === 0 ? <p style={{ fontSize: 12, color: C.sub, marginTop: 10 }}>Sin casos.</p> : res.casos.map((x: any, i: number) => (
        <div key={ref(x) ?? i} style={{ padding: '8px 0', borderTop: `1px solid ${C.b1}`, marginTop: i ? 0 : 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontFamily: MONO }}>{x.objectType ?? ''} · {ref(x)} · {fechaHora(x.createdAt ?? x.openedAt)}</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Pill t={x.status} tono={tonoDe(x.status)} />
              <button onClick={async () => setCaso(await pedirGowd({ action: 'admin_gowd_med_ver', referenceId: ref(x) }))} style={{ ...btnSec, padding: '4px 9px', fontSize: 11 }}>Ver caso</button>
              {puede && x.objectType === 'RECOVERY_VALUE' && <button onClick={async () => { if (!confirm('¿Cancelar este caso MED?')) return; const r = await pedirGowd({ action: 'admin_gowd_med_cancelar', referenceId: ref(x) }); setMsg(r?.ok ? { ok: true, texto: 'Caso cancelado.' } : { texto: r?.error }); cargar(); }} style={{ ...btnPeligro, padding: '4px 9px', fontSize: 11 }}>Cancelar</button>}
            </span>
          </div>
          <VerJson v={x} />
        </div>
      ))}
      {caso && <div style={{ marginTop: 10 }}>{caso.ok === false ? <Msg r={{ texto: caso.error }} /> : <VerJson v={caso.caso} titulo="Ver caso completo" />}</div>}
    </Tarjeta>
  );
};

// ── Cierres ──────────────────────────────────────────────────────────────
const Cierres: React.FC = () => {
  const [res, setRes] = useState<any>(null);
  useEffect(() => { (async () => setRes(await pedirGowd({ action: 'admin_gowd_cierres' })))(); }, []);
  return (
    <Tarjeta>
      <Titulo sub="Solicitudes de cierre de cuentas: PENDING mientras Gowd las analiza, luego CONFIRMED o CANCELLED.">Cierres</Titulo>
      {res?.ok === false ? <Msg r={{ texto: res.error }} /> : !res ? <p style={{ fontSize: 12, color: C.sub }}>Consultando…</p> : res.cierres.length === 0 ? <p style={{ fontSize: 12, color: C.sub }}>Ninguna.</p> : res.cierres.map((x: any, i: number) => (
        <div key={x.closeAccountRequestId ?? x.id ?? i} style={{ padding: '8px 0', borderTop: `1px solid ${C.b1}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontFamily: MONO }}>{x.accountId ?? ''} · {fechaHora(x.createdAt)}</span>
            <Pill t={x.status} tono={tonoDe(x.status)} />
          </div>
          <VerJson v={x} />
        </div>
      ))}
    </Tarjeta>
  );
};

// ── Sandbox ──────────────────────────────────────────────────────────────
const Sandbox: React.FC<{ puede: boolean }> = ({ puede }) => {
  const [f, setF] = useState({ ordenId: '', status: 'PAID' });
  const [msg, setMsg] = useState<{ ok?: boolean; texto: string } | null>(null);
  const forzar = async () => {
    setMsg(null);
    const r = await pedirGowd({ action: 'admin_gowd_sandbox_estado', ...f });
    setMsg(r?.ok ? { ok: true, texto: `Listo: ${r.resultado?.description ?? f.status}. Gowd manda el aviso al webhook.` } : { texto: r?.error ?? 'No se pudo.' });
  };
  return (
    <Tarjeta>
      <Titulo sub="Solo en el ambiente de pruebas de Gowd: simula que un cobro se pagó, venció o falló, o que un envío salió. En producción no existe.">Sandbox</Titulo>
      <div style={grid}>
        <div style={{ gridColumn: 'span 2' }}><Etq>ID DE LA ORDEN</Etq><input value={f.ordenId} onChange={e => setF({ ...f, ordenId: e.target.value.trim() })} style={{ ...campo, fontFamily: MONO }} /></div>
        <div><Etq>ESTADO</Etq><select value={f.status} onChange={e => setF({ ...f, status: e.target.value })} style={campo}>{['PAID', 'CANCELED', 'EXPIRED', 'ERROR', 'REFUNDED', 'REJECTED'].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}><button onClick={forzar} disabled={!puede || !f.ordenId} style={{ ...btnPri, width: '100%', opacity: !puede || !f.ordenId ? 0.5 : 1 }}>Forzar estado</button></div>
      </div>
      <Msg r={msg} />
    </Tarjeta>
  );
};

export default AdminGowd;
