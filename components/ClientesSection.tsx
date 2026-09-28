// ══════════════════════════════════════════════════════════════════
//  Clientes (PSP) — la empresa le carga saldo en pesos a sus personas
//
//  La empresa busca a la persona por su ID Lincoin, la guarda como cliente y
//  le carga saldo en COP. El movimiento lo hace la base de una sola vez
//  (función lincoin_cargar_cliente): descuenta de la empresa, acredita a la
//  persona y deja un movimiento de cada lado con el nombre de la contraparte.
//
//  La lista de clientes vive en raw_data.clientesPsp de la empresa, como los
//  beneficiarios. Es una agenda: quitar a alguien no toca ningún saldo.
//
//  Mueve plata, así que exige lo mismo que Enviar: cuenta verificada y 2FA.
// ══════════════════════════════════════════════════════════════════
import React, { useMemo, useState } from 'react';
import { Search, UserPlus, Trash2, X, Wallet, ArrowUpRight } from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';
import { supabase } from '../lib/supabaseClient';
import { llamarFuncion } from '../lib/edge';
import { ConfirmarModal } from './ConfirmarModal';

const FONT = 'Archivo, system-ui, sans-serif';
const C = {
  tarjeta: '#0C0E0D', borde: 'rgba(255,255,255,0.08)', text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c',
  verde: '#4ADE80', rojo: '#F87171',
};

export type ClientePsp = { id: string; code: string; name: string; addedAt: string };

const fmtCop = (v: number) => `$ ${Math.round(v).toLocaleString('es-CO')}`;
const soloDigitos = (s: string) => s.replace(/[^\d]/g, '');
const fmtEntrada = (s: string) => { const d = soloDigitos(s); return d ? Number(d).toLocaleString('es-CO') : ''; };
const fecha = (ts: any) => { const d = new Date(ts ?? 0); return isNaN(d.getTime()) ? '' : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

type Props = {
  showToast: (msg: string, ms?: number, tipo?: 'success' | 'error') => void;
  handleActionRestricted: () => boolean;
  mfaEnrolled: boolean;
  irAjustes: () => void;
  onVerMovimiento?: (tx: any) => void;
};

export const ClientesSection: React.FC<Props> = ({ showToast, handleActionRestricted, mfaEnrolled, irAjustes, onVerMovimiento }) => {
  const { currentUser, transactions, updateUserRawData, refreshData, verifyMfaCode } = useDatabase();
  const cu: any = currentUser ?? {};
  const clientes: ClientePsp[] = useMemo(() => Array.isArray(cu.raw_data?.clientesPsp) ? cu.raw_data.clientesPsp : Array.isArray(cu.clientesPsp) ? cu.clientesPsp : [], [cu]);

  const disponibleCop = ['COP', 'COP_BREB', 'COP_ACH'].reduce((s, k) => s + (Number(cu.balances?.[k]) || 0), 0);

  // Búsqueda por ID
  const [codigo, setCodigo] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [hallado, setHallado] = useState<{ id: string; name: string; code: string } | null>(null);
  const [noHallado, setNoHallado] = useState(false);

  const buscar = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const c = codigo.trim().toUpperCase();
    if (c.length < 4) return;
    setBuscando(true); setHallado(null); setNoHallado(false);
    const r = await llamarFuncion('admin-data', { action: 'lookup_recipient', code: c }, 20000);
    setBuscando(false);
    if (r?.found && r.id && r.id !== cu.id) setHallado({ id: String(r.id), name: String(r.name ?? 'Usuario Lincoin'), code: c });
    else setNoHallado(true);
  };

  const guardarLista = async (lista: ClientePsp[]) => {
    if (!cu.id) return false;
    const ok = await updateUserRawData(cu.id, { clientesPsp: lista });
    if (!ok) showToast('No se pudo guardar la lista de clientes.', 4000, 'error');
    return ok;
  };
  const agregar = async (c: { id: string; name: string; code: string }) => {
    if (clientes.some(x => x.id === c.id)) return true;
    return guardarLista([{ id: c.id, code: c.code, name: c.name, addedAt: new Date().toISOString() }, ...clientes]);
  };
  const [quitarA, setQuitarA] = useState<ClientePsp | null>(null);
  const quitar = async (c: ClientePsp) => {
    setQuitarA(null);
    await guardarLista(clientes.filter(x => x.id !== c.id));
  };

  // Cargas hechas (movimientos pay_sent marcados psp)
  const cargas = useMemo(() => (transactions ?? [])
    .filter((t: any) => t.userId === cu.id && t.type === 'pay_sent' && (t.psp || t.raw_data?.psp))
    .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()), [transactions, cu.id]);
  const resumenPor = (id: string) => {
    const mias = cargas.filter((t: any) => (t.counterpartyId ?? t.raw_data?.counterpartyId) === id && t.status === 'Completado');
    return { n: mias.length, total: mias.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0), ultima: mias[0]?.createdAt ?? null };
  };

  // Carga de saldo
  const [cargaPara, setCargaPara] = useState<{ id: string; name: string; code: string } | null>(null);
  const [monto, setMonto] = useState('');
  const [nota, setNota] = useState('');
  const [paso, setPaso] = useState<'monto' | 'codigo'>('monto');
  const [codigo2fa, setCodigo2fa] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const abrirCarga = (c: { id: string; name: string; code: string }) => {
    if (handleActionRestricted()) return;
    if (!mfaEnrolled) { showToast('Para cargar saldo primero activa la verificación en dos pasos (2FA) en Ajustes → Seguridad.', 8000, 'error'); irAjustes(); return; }
    setCargaPara(c); setMonto(''); setNota(''); setPaso('monto'); setCodigo2fa(''); setErrorCarga(null);
  };
  const montoNum = Number(soloDigitos(monto)) || 0;

  const confirmarMonto = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorCarga(null);
    if (montoNum < 1000) { setErrorCarga('El mínimo es $ 1.000 COP.'); return; }
    if (montoNum > disponibleCop) { setErrorCarga(`Tienes ${fmtCop(disponibleCop)} COP disponibles.`); return; }
    setPaso('codigo');
  };

  const ejecutar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cargaPara || enviando || codigo2fa.length !== 6) return;
    setEnviando(true); setErrorCarga(null);
    try {
      const ok = await verifyMfaCode(codigo2fa);
      if (!ok) { setErrorCarga('Código incorrecto. Intenta de nuevo.'); setCodigo2fa(''); return; }
      const { data, error } = await supabase.rpc('lincoin_cargar_cliente', { p_codigo: cargaPara.code, p_monto: montoNum, p_nota: nota.trim() || null });
      if (error) {
        const m = String(error.message ?? '');
        setErrorCarga(/could not find|does not exist|schema cache|404/i.test(m)
          ? 'La función de carga todavía no está en la base. Falta correr la migración 2026_psp_clientes.sql en Supabase.'
          : m);
        return;
      }
      if (data?.error) { setErrorCarga(String(data.error) + (data.disponible != null ? ` (disponible: ${fmtCop(Number(data.disponible))})` : '')); return; }
      await agregar(cargaPara);
      showToast(`Listo: ${fmtCop(montoNum)} COP cargados a ${data?.cliente_nombre ?? cargaPara.name}.`, 5000, 'success');
      setCargaPara(null);
      setHallado(null); setCodigo('');
      refreshData().catch(() => {});
    } finally { setEnviando(false); }
  };

  const campo: React.CSSProperties = { fontFamily: FONT, width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, color: C.text, borderRadius: 9, padding: '10px 12px', fontSize: 13.5, outline: 'none' };
  const botonSec: React.CSSProperties = { fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, borderRadius: 9, padding: '8px 12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };
  const Rotulo: React.FC<{ children: React.ReactNode }> = ({ children }) => <p style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: 0 }}>{children}</p>;

  return (
    <div style={{ fontFamily: FONT, maxWidth: 1180, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="flex items-start justify-between flex-wrap" style={{ gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: C.text, margin: 0 }}>Clientes</h2>
          <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5, maxWidth: 640 }}>
            Tus clientes abren una cuenta <b style={{ color: C.text }}>Persona</b> en Lincoin y te dan su ID. Desde aquí les cargas saldo en pesos: sale de tu saldo COP y les entra al instante, sin comisión.
          </p>
        </div>
        <div style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 12, padding: '10px 14px', minWidth: 200 }}>
          <Rotulo>DISPONIBLE PARA CARGAR</Rotulo>
          <p style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 0', fontVariantNumeric: 'tabular-nums', color: C.text }}>{fmtCop(disponibleCop)} <span style={{ fontSize: 12, color: C.sub }}>COP</span></p>
        </div>
      </div>

      {/* Buscar por ID */}
      <section style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 14, padding: '16px 18px' }}>
        <Rotulo>BUSCAR POR ID LINCOIN</Rotulo>
        <form onSubmit={buscar} className="flex items-center flex-wrap" style={{ gap: 8, marginTop: 8 }}>
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
            <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: C.sub }} />
            <input value={codigo} onChange={e => { setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)); setHallado(null); setNoHallado(false); }}
              placeholder="Ej. A1B2C3" maxLength={8} style={{ ...campo, paddingLeft: 34, letterSpacing: '2px', fontFamily: 'ui-monospace, monospace', fontWeight: 700 }} />
          </div>
          <button type="submit" disabled={buscando || codigo.length < 4} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, padding: '10px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', opacity: buscando || codigo.length < 4 ? 0.6 : 1 }}>
            {buscando ? 'Buscando…' : 'Buscar'}
          </button>
        </form>
        {noHallado && <p style={{ fontSize: 12.5, color: C.rojo, margin: '10px 0 0' }}>No hay ninguna cuenta con ese ID. Pídele a tu cliente que lo copie desde su panel, en "Mi ID Lincoin".</p>}
        {hallado && (
          <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, marginTop: 12, background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 11, padding: '10px 14px' }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 800, margin: 0, color: C.text }}>{hallado.name}</p>
              <p style={{ fontSize: 12, color: C.sub, margin: '2px 0 0', fontFamily: 'ui-monospace, monospace', letterSpacing: '1px' }}>{hallado.code}</p>
            </div>
            <div className="flex items-center" style={{ gap: 8 }}>
              {!clientes.some(x => x.id === hallado.id) && (
                <button onClick={() => agregar(hallado).then(ok => ok && showToast(`${hallado.name} quedó en tus clientes.`, 3000))} style={botonSec}><UserPlus size={13} /> Guardar cliente</button>
              )}
              <button onClick={() => abrirCarga(hallado)} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, padding: '9px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Wallet size={13} /> Cargar saldo</button>
            </div>
          </div>
        )}
      </section>

      {/* Lista */}
      <section style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 14, overflow: 'hidden' }}>
        <div className="flex items-center justify-between" style={{ padding: '14px 18px', borderBottom: `1px solid ${C.borde}` }}>
          <Rotulo>MIS CLIENTES</Rotulo>
          <span style={{ fontSize: 11.5, color: C.tenue }}>{clientes.length ? `${clientes.length}` : ''}</span>
        </div>
        {clientes.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0, lineHeight: 1.5 }}>Todavía no tienes clientes guardados. Busca uno por su ID Lincoin arriba y guárdalo.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  {['CLIENTE', 'ID', 'CARGAS', 'TOTAL CARGADO', 'ÚLTIMA', ''].map((h, i) => (
                    <th key={i} style={{ textAlign: i === 3 ? 'right' : 'left', padding: '9px 18px', fontSize: 10, fontWeight: 800, letterSpacing: '1px', color: C.sub, borderBottom: `1px solid ${C.borde}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clientes.map(c => {
                  const r = resumenPor(c.id);
                  return (
                    <tr key={c.id} className="lincoin-fila-mov">
                      <td style={{ padding: '11px 18px', borderBottom: `1px solid ${C.borde}` }}>
                        <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: C.text }}>{c.name}</p>
                        <p style={{ fontSize: 11, color: C.tenue, margin: '1px 0 0' }}>desde {fecha(c.addedAt).split(',')[0]}</p>
                      </td>
                      <td style={{ padding: '11px 18px', borderBottom: `1px solid ${C.borde}`, fontFamily: 'ui-monospace, monospace', letterSpacing: '1px', fontSize: 12.5, color: C.text }}>{c.code}</td>
                      <td style={{ padding: '11px 18px', borderBottom: `1px solid ${C.borde}`, fontSize: 12.5, color: C.sub }}>{r.n}</td>
                      <td style={{ padding: '11px 18px', borderBottom: `1px solid ${C.borde}`, fontSize: 13, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.text, whiteSpace: 'nowrap' }}>{r.total ? fmtCop(r.total) : '—'}</td>
                      <td style={{ padding: '11px 18px', borderBottom: `1px solid ${C.borde}`, fontSize: 12, color: C.sub, whiteSpace: 'nowrap' }}>{r.ultima ? fecha(r.ultima) : '—'}</td>
                      <td style={{ padding: '11px 18px', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <div className="flex items-center justify-end" style={{ gap: 6 }}>
                          <button onClick={() => abrirCarga(c)} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 12, padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Wallet size={12} /> Cargar saldo</button>
                          <button onClick={() => setQuitarA(c)} title="Quitar de la lista" style={{ ...botonSec, padding: '7px 9px', color: C.sub }}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cargas recientes */}
      <section style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.borde}` }}><Rotulo>CARGAS RECIENTES</Rotulo></div>
        {cargas.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.tenue, padding: '22px 18px', margin: 0 }}>Aún no has cargado saldo a nadie.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {cargas.slice(0, 30).map((t: any) => (
              <div key={t.id} onClick={() => onVerMovimiento?.(t)} className="flex items-center lincoin-fila-mov" style={{ gap: 12, padding: '11px 18px', borderBottom: `1px solid ${C.borde}`, cursor: onVerMovimiento ? 'pointer' : 'default' }}>
                <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><ArrowUpRight size={15} color={C.text} /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.counterpartyName ?? t.beneficiaryName ?? 'Cliente'} <span style={{ color: C.tenue, fontWeight: 500, fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>{t.counterpartyCode ?? ''}</span></p>
                  <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fecha(t.createdAt)}{t.note ? ` · ${t.note}` : ''}{t.status !== 'Completado' ? ` · ${t.status}` : ''}</p>
                </div>
                <p style={{ fontSize: 13.5, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: C.text }}>−{fmtCop(Number(t.amount) || 0)}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {quitarA && (
        <ConfirmarModal titulo={`¿Quitar a ${quitarA.name} de tus clientes?`} texto="Solo sale de tu lista. Su saldo y sus movimientos no cambian." confirmar="Quitar" peligro
          onConfirmar={() => quitar(quitarA)} onCancelar={() => setQuitarA(null)} />
      )}

      {/* Modal de carga */}
      {cargaPara && (
        <div onClick={() => !enviando && setCargaPara(null)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 16, padding: 22 }}>
            <div className="flex items-start justify-between" style={{ gap: 12 }}>
              <div>
                <p style={{ fontSize: 17, fontWeight: 800, margin: 0, color: C.text, letterSpacing: '-0.3px' }}>Cargar saldo</p>
                <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0' }}>a <b style={{ color: C.text }}>{cargaPara.name}</b> · <span style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '1px' }}>{cargaPara.code}</span></p>
              </div>
              <button onClick={() => !enviando && setCargaPara(null)} aria-label="Cerrar" style={{ background: 'transparent', border: 'none', color: C.sub, cursor: 'pointer', padding: 4 }}><X size={18} /></button>
            </div>

            {paso === 'monto' ? (
              <form onSubmit={confirmarMonto} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <Rotulo>MONTO EN PESOS</Rotulo>
                  <div style={{ position: 'relative', marginTop: 6 }}>
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.sub, fontWeight: 700 }}>$</span>
                    <input value={fmtEntrada(monto)} onChange={e => setMonto(soloDigitos(e.target.value))} inputMode="numeric" placeholder="0" autoFocus
                      style={{ ...campo, paddingLeft: 26, fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }} />
                  </div>
                  <p style={{ fontSize: 11.5, color: C.tenue, margin: '6px 0 0' }}>Disponible: {fmtCop(disponibleCop)} COP · sin comisión</p>
                </div>
                <div>
                  <Rotulo>NOTA (OPCIONAL)</Rotulo>
                  <input value={nota} onChange={e => setNota(e.target.value.slice(0, 140))} placeholder="Ej. Pago semana 39" style={{ ...campo, marginTop: 6 }} />
                  <p style={{ fontSize: 11.5, color: C.tenue, margin: '6px 0 0' }}>Tu cliente la ve en su movimiento.</p>
                </div>
                {errorCarga && <p style={{ fontSize: 12.5, color: C.rojo, margin: 0, lineHeight: 1.45 }}>{errorCarga}</p>}
                <button type="submit" disabled={montoNum <= 0} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, padding: '12px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', opacity: montoNum <= 0 ? 0.6 : 1 }}>
                  Continuar
                </button>
              </form>
            ) : (
              <form onSubmit={ejecutar} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ background: 'rgba(255,255,255,0.035)', border: `1px solid ${C.borde}`, borderRadius: 11, padding: '12px 14px' }}>
                  <div className="flex items-center justify-between"><span style={{ fontSize: 12, color: C.sub }}>Monto</span><b style={{ fontSize: 15, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmtCop(montoNum)} COP</b></div>
                  <div className="flex items-center justify-between" style={{ marginTop: 6 }}><span style={{ fontSize: 12, color: C.sub }}>Para</span><span style={{ fontSize: 13, color: C.text }}>{cargaPara.name}</span></div>
                  {nota && <div className="flex items-center justify-between" style={{ marginTop: 6 }}><span style={{ fontSize: 12, color: C.sub }}>Nota</span><span style={{ fontSize: 12.5, color: C.text }}>{nota}</span></div>}
                </div>
                <div>
                  <Rotulo>CÓDIGO DE TU APP DE AUTENTICACIÓN</Rotulo>
                  <input value={codigo2fa} onChange={e => setCodigo2fa(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" autoFocus
                    style={{ ...campo, marginTop: 6, fontSize: 22, fontWeight: 800, letterSpacing: '6px', textAlign: 'center', fontFamily: 'ui-monospace, monospace' }} />
                </div>
                {errorCarga && <p style={{ fontSize: 12.5, color: C.rojo, margin: 0, lineHeight: 1.45 }}>{errorCarga}</p>}
                <div className="flex items-center" style={{ gap: 8 }}>
                  <button type="button" onClick={() => { setPaso('monto'); setErrorCarga(null); }} disabled={enviando} style={{ ...botonSec, flex: 1, justifyContent: 'center', padding: '12px 14px' }}>Atrás</button>
                  <button type="submit" disabled={enviando || codigo2fa.length !== 6} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, padding: '12px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', flex: 2, opacity: enviando || codigo2fa.length !== 6 ? 0.6 : 1 }}>
                    {enviando ? 'Cargando…' : `Cargar ${fmtCop(montoNum)}`}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
