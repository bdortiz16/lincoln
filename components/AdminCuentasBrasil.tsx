// ─────────────────────────────────────────────────────────────
// Cuentas en Brasil (PIX · BRL) — lado Admin.
//
//   · CuentaBrasilCliente: la pestaña "Cuenta Brasil" de la ficha del
//     cliente. Ver su cuenta, asignarle una con los datos que entrega el
//     aliado, rechazar la solicitud, suspender o reactivar.
//   · SolicitudesBrasil: todas las cuentas y solicitudes, para ver de un
//     vistazo quién está esperando y saltar a su ficha.
//
// Todo pasa por la función `gowd`. El navegador no escribe la tabla: una
// cuenta bancaria asignada al cliente equivocado es plata que llega a quien
// no es, así que las validaciones (CNPJ/CPF, banco, agencia, conta, que la
// misma cuenta no esté en dos clientes) viven en el servidor.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { pedirGowd } from './adminApi';

const C = {
  card: '#0C0E0D', elev: '#121413', b1: 'rgba(255,255,255,0.07)', b2: 'rgba(255,255,255,0.12)',
  text: '#F4F4F2', sub: '#878E88', dim: 'rgba(244,244,242,0.45)', green: '#4ADE80', amber: '#FBBF24', red: '#F87171',
};
const FONT = 'Archivo, system-ui, sans-serif';
const MONO = 'ui-monospace, Menlo, monospace';

const ESTADO: Record<string, { l: string; c: string; b: string }> = {
  solicitada:  { l: 'SOLICITADA',  c: C.amber, b: 'rgba(251,191,36,0.35)' },
  en_creacion: { l: 'EN CREACIÓN', c: 'rgba(244,244,242,0.7)', b: 'rgba(255,255,255,0.14)' },
  activa:      { l: 'ACTIVA',      c: C.green, b: 'rgba(74,222,128,0.3)' },
  rechazada:   { l: 'RECHAZADA',   c: C.sub,   b: 'rgba(255,255,255,0.14)' },
  suspendida:  { l: 'SUSPENDIDA',  c: C.red,   b: 'rgba(248,113,113,0.3)' },
};
const PillEstado: React.FC<{ e: string }> = ({ e }) => {
  const m = ESTADO[e] ?? { l: e.toUpperCase(), c: C.sub, b: C.b2 };
  return <span style={{ border: `1px solid ${m.b}`, color: m.c, borderRadius: 999, padding: '3px 9px', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.6px', whiteSpace: 'nowrap' }}>{m.l}</span>;
};
const fecha = (d?: string | null) => { if (!d) return '—'; try { return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return '—'; } };
const docFmt = (tipo?: string, d?: string) => {
  const s = String(d ?? '');
  if (tipo === 'CNPJ' && s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
  if (tipo === 'CPF' && s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
  return s;
};

const campo: React.CSSProperties = { fontFamily: FONT, width: '100%', background: 'rgba(255,255,255,0.045)', border: `1px solid ${C.b1}`, borderRadius: 9, padding: '9px 11px', color: C.text, fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { fontFamily: FONT, background: C.text, border: 'none', color: '#0A0A0A', borderRadius: 9, padding: '9px 15px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
const btnSec: React.CSSProperties = { fontFamily: FONT, background: 'transparent', border: `1px solid ${C.b2}`, color: C.sub, borderRadius: 9, padding: '9px 15px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' };
const Tarjeta: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: C.card, border: `1px solid ${C.b1}`, borderRadius: 13, padding: '15px 16px', ...style }}>{children}</div>
);
const Etq: React.FC<{ children: React.ReactNode }> = ({ children }) => <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: C.sub, margin: '0 0 5px' }}>{children}</p>;

// ── Diagnóstico de la conexión con el aliado ─────────────────────────────
const Conexion: React.FC = () => {
  const [r, setR] = useState<any>(null);
  const [ocupado, setOcupado] = useState(false);
  const probar = async () => { setOcupado(true); setR(await pedirGowd({ action: 'admin_ping' })); setOcupado(false); };
  const ok = r?.estado === 'conectado';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.b1}` }}>
      <p style={{ fontSize: 12, color: r ? (ok ? C.green : C.sub) : C.sub, margin: 0, lineHeight: 1.45, flex: '1 1 260px' }}>
        {r ? (r.ok === false ? r.error : r.detalle) : 'Conexión con el aliado en Brasil (proxy mTLS con IP fija).'}
      </p>
      <button onClick={probar} disabled={ocupado} style={{ ...btnSec, padding: '7px 12px', fontSize: 12, opacity: ocupado ? 0.6 : 1 }}>{ocupado ? 'Probando…' : 'Probar conexión'}</button>
    </div>
  );
};

// ── Formulario de asignación ─────────────────────────────────────────────
type Form = { titular: string; documentoTipo: string; documento: string; bancoNombre: string; bancoCodigo: string; ispb: string; agencia: string; conta: string; contaTipo: string; chavePix: string; chavePixTipo: string; gowdAccountId: string; notaInterna: string };

const Asignar: React.FC<{ userId: string; base?: any; cliente?: any; onListo: () => void; onCancelar: () => void; showToast?: (m: string) => void }> = ({ userId, base, cliente, onListo, onCancelar, showToast }) => {
  const [f, setF] = useState<Form>({
    titular: base?.titular ?? cliente?.company_name ?? cliente?.companyName ?? '',
    documentoTipo: base?.documento_tipo ?? 'CNPJ',
    documento: base?.documento ?? '',
    bancoNombre: base?.banco_nombre ?? '', bancoCodigo: base?.banco_codigo ?? '', ispb: base?.ispb ?? '',
    agencia: base?.agencia ?? '', conta: base?.conta ?? '', contaTipo: base?.conta_tipo ?? 'pagamento',
    chavePix: base?.chave_pix ?? '', chavePixTipo: base?.chave_pix_tipo ?? 'cnpj',
    gowdAccountId: base?.gowd_account_id ?? '', notaInterna: base?.nota_interna ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(p => ({ ...p, [k]: e.target.value }));

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true); setError(null);
    const r = await pedirGowd({ action: 'admin_asignar', userId, ...f });
    setOcupado(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo asignar.'); return; }
    showToast?.('Cuenta en Brasil asignada. Al cliente le llegó el aviso.');
    onListo();
  };

  const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 };
  return (
    <form onSubmit={guardar} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
      <p style={{ fontSize: 12, color: C.sub, margin: 0, lineHeight: 1.5 }}>Copia los datos tal cual los entrega el aliado. Al guardar, la cuenta queda activa y el cliente ve estos datos para recibir PIX.</p>
      <div style={grid2}>
        <div style={{ gridColumn: '1 / -1' }}><Etq>TITULAR (RAZÃO SOCIAL)</Etq><input value={f.titular} onChange={set('titular')} style={campo} /></div>
        <div><Etq>DOCUMENTO</Etq>
          <select value={f.documentoTipo} onChange={set('documentoTipo')} style={campo}><option value="CNPJ">CNPJ</option><option value="CPF">CPF</option></select></div>
        <div><Etq>NÚMERO</Etq><input value={f.documento} onChange={set('documento')} placeholder="Solo dígitos" style={{ ...campo, fontFamily: MONO }} /></div>
        <div><Etq>BANCO</Etq><input value={f.bancoNombre} onChange={set('bancoNombre')} placeholder="Nombre del banco" style={campo} /></div>
        <div><Etq>CÓDIGO COMPE</Etq><input value={f.bancoCodigo} onChange={set('bancoCodigo')} placeholder="3 dígitos" maxLength={3} style={{ ...campo, fontFamily: MONO }} /></div>
        <div><Etq>ISPB (OPCIONAL)</Etq><input value={f.ispb} onChange={set('ispb')} placeholder="8 dígitos" maxLength={8} style={{ ...campo, fontFamily: MONO }} /></div>
        <div><Etq>AGÊNCIA</Etq><input value={f.agencia} onChange={set('agencia')} placeholder="0001" style={{ ...campo, fontFamily: MONO }} /></div>
        <div><Etq>CONTA (CON DÍGITO)</Etq><input value={f.conta} onChange={set('conta')} placeholder="123456-7" style={{ ...campo, fontFamily: MONO }} /></div>
        <div><Etq>TIPO DE CONTA</Etq>
          <select value={f.contaTipo} onChange={set('contaTipo')} style={campo}><option value="pagamento">Pagamento</option><option value="corrente">Corrente</option><option value="poupanca">Poupança</option></select></div>
        <div><Etq>CHAVE PIX (OPCIONAL)</Etq><input value={f.chavePix} onChange={set('chavePix')} style={{ ...campo, fontFamily: MONO }} /></div>
        <div><Etq>TIPO DE CHAVE</Etq>
          <select value={f.chavePixTipo} onChange={set('chavePixTipo')} style={campo}><option value="cnpj">CNPJ</option><option value="cpf">CPF</option><option value="email">Correo</option><option value="telefone">Teléfono</option><option value="aleatoria">Aleatoria</option></select></div>
        <div><Etq>ID EN EL ALIADO (OPCIONAL)</Etq><input value={f.gowdAccountId} onChange={set('gowdAccountId')} style={{ ...campo, fontFamily: MONO }} /></div>
        <div style={{ gridColumn: '1 / -1' }}><Etq>NOTA INTERNA (OPCIONAL)</Etq><input value={f.notaInterna} onChange={set('notaInterna')} placeholder="Solo la ve el equipo" style={campo} /></div>
      </div>
      {error && <p style={{ fontSize: 12.5, color: C.red, margin: 0, lineHeight: 1.45 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancelar} disabled={ocupado} style={btnSec}>Cancelar</button>
        <button type="submit" disabled={ocupado} style={{ ...btnPri, opacity: ocupado ? 0.6 : 1 }}>{ocupado ? 'Guardando…' : 'Asignar cuenta'}</button>
      </div>
    </form>
  );
};

// ── Pestaña del cliente ──────────────────────────────────────────────────
export const CuentaBrasilCliente: React.FC<{ sel: any; showToast?: (m: string) => void }> = ({ sel, showToast }) => {
  const [datos, setDatos] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<'ver' | 'asignar' | 'rechazar'>('ver');
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const cargar = async () => {
    setError(null);
    const r = await pedirGowd({ action: 'admin_listar', userId: sel.id });
    if (!r?.ok) { setError(r?.error ?? 'No se pudo consultar.'); setDatos({ cuentas: [] }); return; }
    setDatos(r);
  };
  useEffect(() => { setModo('ver'); setDatos(null); cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sel.id]);

  const cuentas: any[] = datos?.cuentas ?? [];
  const viva = cuentas.find(c => ['solicitada', 'en_creacion', 'activa'].includes(c.estado));
  const actual = viva ?? cuentas[0] ?? null;
  const puede = !!datos?.puedeEscribir;
  const esEmpresa = sel.role === 'business';

  const accion = async (action: string, extra: Record<string, unknown> = {}, ok = 'Listo.') => {
    if (!actual) return;
    setOcupado(true); setError(null);
    const r = await pedirGowd({ action, cuentaId: actual.id, ...extra });
    setOcupado(false);
    if (!r?.ok) { setError(r?.message ?? r?.error ?? 'No se pudo.'); return; }
    showToast?.(ok); setModo('ver'); setMotivo(''); cargar();
  };

  const fila = (k: string, v: React.ReactNode, mono = false) => (
    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: `1px solid ${C.b1}` }}>
      <span style={{ fontSize: 12, color: C.sub }}>{k}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: C.text, fontFamily: mono ? MONO : FONT, textAlign: 'right', wordBreak: 'break-all' }}>{v || '—'}</span>
    </div>
  );

  return (
    <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14, fontFamily: FONT }}>
      <Tarjeta>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: C.text }}>Cuenta en Brasil · PIX · BRL</p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>
              {!datos ? 'Consultando…'
                : !esEmpresa ? 'La cuenta en Brasil se asigna solo a cuentas Empresa.'
                : !actual ? 'Este cliente no tiene cuenta ni solicitud.'
                : actual.estado === 'solicitada' ? `Pidió su cuenta el ${fecha(actual.solicitada_at)}.`
                : actual.estado === 'activa' ? `Activa desde el ${fecha(actual.activada_at)}${actual.origen === 'api' ? ' · creada por API' : ' · asignada a mano'}.`
                : actual.estado === 'rechazada' ? `Rechazada: ${actual.nota_cliente ?? ''}`
                : actual.estado === 'suspendida' ? 'Suspendida: el cliente no ve los datos.' : ''}
            </p>
          </div>
          {actual && <PillEstado e={actual.estado} />}
        </div>

        {error && <p style={{ fontSize: 12.5, color: C.red, margin: '10px 0 0', lineHeight: 1.45 }}>{error}</p>}

        {actual && modo === 'ver' && (
          <div style={{ marginTop: 12 }}>
            {fila('Titular', actual.titular)}
            {fila(actual.documento_tipo ?? 'Documento', docFmt(actual.documento_tipo, actual.documento), true)}
            {actual.conta && <>
              {fila('Banco', `${actual.banco_nombre ?? ''}${actual.banco_codigo ? ` · ${actual.banco_codigo}` : ''}`)}
              {actual.ispb && fila('ISPB', actual.ispb, true)}
              {fila('Agência', actual.agencia, true)}
              {fila('Conta', `${actual.conta} · ${actual.conta_tipo ?? ''}`, true)}
              {actual.chave_pix && fila(`Chave PIX · ${actual.chave_pix_tipo ?? ''}`, actual.chave_pix, true)}
              {actual.gowd_account_id && fila('ID en el aliado', actual.gowd_account_id, true)}
            </>}
            {actual.nota_interna && fila('Nota interna', actual.nota_interna)}
          </div>
        )}

        {esEmpresa && puede && modo === 'ver' && datos && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            {(!actual || ['solicitada', 'rechazada', 'en_creacion'].includes(actual.estado)) && (
              <button onClick={() => setModo('asignar')} style={btnPri}>Asignar cuenta</button>
            )}
            {actual?.estado === 'solicitada' && <>
              <button onClick={() => setModo('rechazar')} style={btnSec}>Rechazar</button>
            </>}
            {actual?.estado === 'activa' && <>
              <button onClick={() => setModo('asignar')} style={btnSec}>Corregir datos</button>
              <button onClick={() => accion('admin_suspender', {}, 'Cuenta suspendida. El cliente recibió el aviso.')} disabled={ocupado} style={btnSec}>Suspender</button>
            </>}
            {actual?.estado === 'suspendida' && (
              <button onClick={() => accion('admin_reactivar', {}, 'Cuenta reactivada.')} disabled={ocupado} style={btnSec}>Reactivar</button>
            )}
          </div>
        )}
        {esEmpresa && puede && modo === 'ver' && actual?.estado === 'solicitada' && <p style={{ fontSize: 11.5, color: C.dim, margin: '10px 0 0', lineHeight: 1.45 }}>Para abrirla por API: Admin → Gowd → Nueva cuenta. Ya abierta, se asigna a este cliente desde ahí.</p>}
        {esEmpresa && datos && !puede && !error && <p style={{ fontSize: 11.5, color: C.dim, margin: '12px 0 0' }}>Tu rol puede ver esta cuenta, no modificarla.</p>}

        {modo === 'asignar' && (
          <Asignar userId={sel.id} base={actual && actual.estado !== 'rechazada' ? actual : undefined} cliente={sel} showToast={showToast}
            onListo={() => { setModo('ver'); cargar(); }} onCancelar={() => setModo('ver')} />
        )}

        {modo === 'rechazar' && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Etq>MOTIVO (LO VE EL CLIENTE)</Etq>
            <input value={motivo} onChange={e => setMotivo(e.target.value.slice(0, 300))} placeholder="Ej. el CNPJ no coincide con la empresa verificada" style={campo} autoFocus />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModo('ver')} style={btnSec}>Cancelar</button>
              <button onClick={() => accion('admin_rechazar', { notaCliente: motivo }, 'Solicitud rechazada.')} disabled={ocupado || motivo.trim().length < 5} style={{ ...btnPri, opacity: ocupado || motivo.trim().length < 5 ? 0.6 : 1 }}>Rechazar solicitud</button>
            </div>
          </div>
        )}

        <Conexion />
      </Tarjeta>

      {cuentas.length > 1 && (
        <Tarjeta>
          <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: C.text }}>Historial</p>
          {cuentas.filter(c => c.id !== actual?.id).map(c => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${C.b1}` }}>
              <span style={{ fontSize: 12.5, color: C.sub }}>{fecha(c.solicitada_at)} · {c.banco_nombre ?? 'sin banco'} {c.conta ? `· ${c.conta}` : ''}</span>
              <PillEstado e={c.estado} />
            </div>
          ))}
        </Tarjeta>
      )}
    </div>
  );
};

// ── Todas las solicitudes y cuentas ──────────────────────────────────────
export const SolicitudesBrasil: React.FC<{ onAbrir: (userId: string) => void; onCerrar: () => void }> = ({ onAbrir, onCerrar }) => {
  const [datos, setDatos] = useState<any>(null);
  const [filtro, setFiltro] = useState<'solicitada' | 'activa' | 'todas'>('solicitada');
  useEffect(() => { (async () => setDatos(await pedirGowd({ action: 'admin_listar' })))(); }, []);
  const cuentas: any[] = datos?.cuentas ?? [];
  const lista = filtro === 'todas' ? cuentas : cuentas.filter(c => c.estado === filtro);
  const n = (e: string) => cuentas.filter(c => c.estado === e).length;
  const chip = (k: typeof filtro, l: string) => (
    <button onClick={() => setFiltro(k)} style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, padding: '6px 11px', borderRadius: 999, cursor: 'pointer', background: filtro === k ? C.text : 'transparent', color: filtro === k ? '#0A0A0A' : C.sub, border: `1px solid ${filtro === k ? C.text : C.b2}` }}>{l}</button>
  );
  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ fontFamily: FONT, width: '100%', maxWidth: 640, maxHeight: '88vh', overflowY: 'auto', background: C.card, border: `1px solid ${C.b2}`, borderRadius: 16, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <p style={{ fontSize: 17, fontWeight: 800, margin: 0, color: C.text, letterSpacing: '-0.3px' }}>Cuentas en Brasil</p>
            <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0' }}>Solicitudes de los clientes y cuentas asignadas.</p>
          </div>
          <button onClick={onCerrar} style={{ ...btnSec, padding: '6px 10px' }}>Cerrar</button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
          {chip('solicitada', `Por atender · ${n('solicitada')}`)}{chip('activa', `Activas · ${n('activa')}`)}{chip('todas', `Todas · ${cuentas.length}`)}
        </div>
        {!datos ? <p style={{ fontSize: 12.5, color: C.sub, marginTop: 16 }}>Consultando…</p>
          : datos.ok === false ? <p style={{ fontSize: 12.5, color: C.red, marginTop: 16, lineHeight: 1.45 }}>{datos.error}</p>
          : lista.length === 0 ? <p style={{ fontSize: 12.5, color: C.sub, marginTop: 16 }}>Nada en esta lista.</p>
          : (
          <div style={{ marginTop: 12 }}>
            {lista.map(c => (
              <button key={c.id} onClick={() => onAbrir(String(c.user_id))} style={{ fontFamily: FONT, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderTop: `1px solid ${C.b1}`, padding: '11px 2px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: C.text }}>{c.cliente?.nombre ?? c.titular ?? 'Cliente'}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: C.sub, marginTop: 2 }}>{c.cliente?.email ?? ''} · {c.documento_tipo} {docFmt(c.documento_tipo, c.documento)} · {fecha(c.solicitada_at)}</span>
                </span>
                <PillEstado e={c.estado} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
