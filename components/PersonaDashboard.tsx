// ══════════════════════════════════════════════════════════════════
//  Portal Personas — lincoin.me/portal_personas
//
//  La cuenta en pesos (y otras billeteras) de un cliente de una empresa.
//  Una empresa registrada en Lincoin (modelo PSP) le carga saldo por su ID
//  Lincoin; la persona lo ve, lo envía a otra persona Lincoin o lo convierte
//  entre sus billeteras.
//
//  Una sola tarjeta de saldo con chips de billetera: cambiar el chip cambia
//  el saldo de ESA tarjeta. No hay otra lista de billeteras en la página.
//  Solo tres acciones: Enviar, Recargar, Convertir. Retirar va dentro de
//  Enviar (a banco o Bre-B) y recibir es dar el ID.
//
//  Lo que aún no está (USD/EUR, tarjeta, retiro a banco para personas) se
//  dice tal cual, con "pronto". Nada que parezca que funciona y no.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy, Check, Eye, EyeOff, Bell, ArrowUpRight, Plus, ArrowLeftRight, Clock, ArrowDownLeft, ArrowRight, X,
  Link2, TrendingUp, FileText, BarChart3, Shield, Gift, MessageSquare, Search, ChevronRight, Download, User, Landmark,
} from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';
import { useExchangeRates } from '../context/ExchangeRateContext';
import { llamarFuncion } from '../lib/edge';
import { descargarXlsx } from '../lib/xlsx';
import { ConfirmarModal } from './ConfirmarModal';

// ─── Marca ───────────────────────────────────────────────────────────
const FONT = 'Archivo, system-ui, sans-serif';
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const C = {
  fondo: '#070808', tarjeta: '#0C0E0D', borde: 'rgba(255,255,255,0.08)', bordeFuerte: 'rgba(255,255,255,0.12)',
  text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c', medio: '#b9beba', verde: '#4ADE80',
};
const R = 14, RG = 18;

// ─── Billeteras ──────────────────────────────────────────────────────
type Billetera = { code: string; simbolo: string; locale: string; nombre: string; desc: string; pronto?: boolean };
const BILLETERAS: Billetera[] = [
  { code: 'COP', simbolo: '$', locale: 'es-CO', nombre: 'Pesos colombianos', desc: 'saldo que te cargan las empresas con las que trabajas' },
  { code: 'BRL', simbolo: 'R$', locale: 'pt-BR', nombre: 'Reales', desc: 'recibe y retira por Pix' },
  { code: 'PEN', simbolo: 'S/', locale: 'es-PE', nombre: 'Soles', desc: 'retira a tu banco o Yape' },
  { code: 'CLP', simbolo: '$', locale: 'es-CL', nombre: 'Pesos chilenos', desc: 'retira a tu banco' },
  { code: 'MXN', simbolo: '$', locale: 'es-MX', nombre: 'Pesos mexicanos', desc: 'retira por SPEI' },
  { code: 'ARS', simbolo: '$', locale: 'es-AR', nombre: 'Pesos argentinos', desc: 'retira por CVU/CBU' },
  { code: 'USD', simbolo: 'US$', locale: 'en-US', nombre: 'Dólares', desc: 'cuenta en dólares', pronto: true },
  { code: 'EUR', simbolo: '€', locale: 'de-DE', nombre: 'Euros', desc: 'cuenta en euros', pronto: true },
];
const billetera = (code: string) => BILLETERAS.find(b => b.code === code) ?? BILLETERAS[0];
const decimales = (code: string) => (['COP', 'CLP', 'ARS'].includes(code) ? 0 : 2);
const fmt = (v: number, code: string, conSimbolo = true) => {
  const b = billetera(code);
  const n = (Number(v) || 0).toLocaleString(b.locale, { minimumFractionDigits: 0, maximumFractionDigits: decimales(code) });
  return conSimbolo ? `${b.simbolo}${b.simbolo.length > 1 ? ' ' : ''}${n}` : n;
};
const soloNumero = (s: string) => s.replace(/[^\d.,]/g, '').replace(',', '.');
const numero = (s: string) => Number(soloNumero(s)) || 0;
const fecha = (ts: any) => { const d = new Date(ts ?? 0); return isNaN(d.getTime()) ? '' : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const iniciales = (n: string) => n.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || 'L';
const nombrePropio = (n: string) => n.trim().toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());

const ROTULO: Record<string, string> = {
  pay_received: 'Saldo recibido', pay_sent: 'Envío a persona Lincoin', load: 'Recarga', send: 'Retiro',
  convert: 'Conversión', adjustment: 'Ajuste de saldo', referral_payout: 'Bono de referido', receive: 'Recibido',
};
const ENTRA = new Set(['pay_received', 'load', 'adjustment', 'referral_payout', 'receive']);

type Beneficiario = { id: string; name: string; via: 'lincoin' | 'nequi' | 'breb' | 'banco'; detail: string; bank?: string };
const VIA_TXT: Record<Beneficiario['via'], string> = { lincoin: 'ID Lincoin', nequi: 'Nequi', breb: 'Llave Bre-B', banco: 'Cuenta bancaria' };

type Vista = 'inicio' | 'movimientos' | 'beneficiarios' | 'ayuda';
const RUTA_VISTA: Record<Vista, string> = { inicio: '/portal_personas', movimientos: '/personas_movimientos', beneficiarios: '/personas_beneficiarios', ayuda: '/personas_ayuda' };
const VISTA_RUTA: Record<string, Vista> = Object.fromEntries(Object.entries(RUTA_VISTA).map(([v, p]) => [p, v as Vista]));

type Panel = 'enviar' | 'recargar' | 'convertir' | 'beneficiario' | 'seguridad' | 'tasas' | 'limites' | 'notificaciones' | 'invita' | 'ayuda' | 'cobrar' | null;

// ─── Piezas ──────────────────────────────────────────────────────────
const Tarjeta: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; grande?: boolean }> = ({ children, style, grande }) => (
  <section style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: grande ? RG : R, padding: grande ? 24 : 20, ...style }}>{children}</section>
);
const Rotulo: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '2.5px', color: C.sub, margin: 0, ...style }}>{children}</p>
);
const Pill: React.FC<{ children: React.ReactNode; verde?: boolean }> = ({ children, verde }) => (
  <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.5px', color: verde ? C.verde : C.sub, border: `1px solid ${verde ? 'rgba(74,222,128,0.4)' : C.bordeFuerte}`, borderRadius: 999, padding: '6px 12px', whiteSpace: 'nowrap' }}>{children}</span>
);
const BotonPrimario: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ style, children, ...p }) => (
  <button {...p} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, border: 'none', borderRadius: 11, padding: '13px 18px', cursor: 'pointer', opacity: p.disabled ? 0.55 : 1, ...style }}>{children}</button>
);
const BotonSecundario: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ style, children, ...p }) => (
  <button {...p} className="persona-sec" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.bordeFuerte}`, borderRadius: 11, padding: '13px 18px', cursor: 'pointer', opacity: p.disabled ? 0.55 : 1, ...style }}>{children}</button>
);
const Campo: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ style, ...p }) => (
  <input {...p} style={{ fontFamily: FONT, width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.bordeFuerte}`, color: C.text, borderRadius: 11, padding: '12px 14px', fontSize: 14, outline: 'none', ...style }} />
);
const Etiqueta: React.FC<{ children: React.ReactNode }> = ({ children }) => <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: C.sub, margin: '0 0 8px' }}>{children}</p>;

const Drawer: React.FC<{ titulo: string; sub?: string; onCerrar: () => void; children: React.ReactNode }> = ({ titulo, sub, onCerrar, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCerrar]);
  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'flex-end' }}>
      <aside onClick={e => e.stopPropagation()} className="persona-drawer" style={{ width: 420, maxWidth: '100%', height: '100%', background: C.tarjeta, borderLeft: `1px solid ${C.borde}`, padding: '24px 24px 32px', overflowY: 'auto', fontFamily: FONT }}>
        <div className="flex items-start justify-between" style={{ gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: C.text, margin: 0 }}>{titulo}</h2>
            {sub && <p style={{ fontSize: 13, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>{sub}</p>}
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${C.bordeFuerte}`, background: 'transparent', color: C.sub, cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}><X size={16} /></button>
        </div>
        <div style={{ marginTop: 22 }}>{children}</div>
      </aside>
    </div>
  );
};

// Mini tarjeta Mastercard 52×34: negro, "L." y los círculos.
const MiniTarjeta: React.FC = () => (
  <div style={{ width: 52, height: 34, borderRadius: 6, background: 'linear-gradient(135deg, #121413 0%, #0C0E0D 60%, #0A0B0A 100%)', border: `1px solid ${C.bordeFuerte}`, position: 'relative', flexShrink: 0 }}>
    <span style={{ position: 'absolute', top: 4, left: 6, fontSize: 9, fontWeight: 800, color: C.text, letterSpacing: '-0.3px' }}>L<span style={{ color: C.verde }}>.</span></span>
    <span style={{ position: 'absolute', bottom: 4, right: 12, width: 10, height: 10, borderRadius: '50%', background: '#EB001B' }} />
    <span style={{ position: 'absolute', bottom: 4, right: 6, width: 10, height: 10, borderRadius: '50%', background: '#F79E1B', opacity: 0.9 }} />
  </div>
);

// ─── Portal ──────────────────────────────────────────────────────────
export const PersonaDashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const { currentUser, transactions, refreshData, sendCuypayPayment, performConversion, enrollMFA, verifyMFAEnrollment, verifyMfaCode, updateUserRawData, markNotificationsRead } = useDatabase();
  const { getRate } = useExchangeRates();
  const cu: any = currentUser ?? {};

  const codigo: string = String(cu.ownReferralCode || String(cu.id ?? '').slice(-6)).toUpperCase();
  const nombre = nombrePropio(String(cu.name || cu.fullName || cu.email?.split('@')[0] || 'Tu cuenta'));
  const kycOk = String(cu.kycStatus ?? '') === 'approved';
  const mfaActivo = !!cu.mfaEnabled;
  const saldo = (code: string) => Number(cu.balances?.[code] ?? 0) || 0;

  // Billeteras activas: las que trae el backend, en el orden de BILLETERAS;
  // las demás quedan detrás de "+N más" (USD y EUR siempre como pronto).
  const activas = useMemo(() => BILLETERAS.filter(b => !b.pronto && cu.balances && Object.prototype.hasOwnProperty.call(cu.balances, b.code)), [cu.balances]);
  const visibles = activas.length ? activas : [BILLETERAS[0]];
  const primeras = visibles.slice(0, 4);
  const restantes = BILLETERAS.filter(b => !primeras.includes(b));
  const [walletActiva, setWalletActiva] = useState('COP');
  const [masAbierto, setMasAbierto] = useState(false);
  const [oculto, setOculto] = useState(false);
  const wa = billetera(walletActiva);
  const totalEnCop = useMemo(() => BILLETERAS.reduce((s, b) => { const v = saldo(b.code); if (!v) return s; const r = b.code === 'COP' ? 1 : (getRate(b.code, 'COP') || 0); return s + v * r; }, 0), [cu.balances, getRate]);
  const enmascarar = (s: string) => (oculto ? '••••' : s);

  // Vista y dirección
  const [vista, setVista] = useState<Vista>(() => { try { return VISTA_RUTA[window.location.pathname] ?? 'inicio'; } catch { return 'inicio'; } });
  useEffect(() => {
    try { const p = RUTA_VISTA[vista]; if (window.location.pathname !== p) window.history.pushState({ vista }, '', p); } catch { /* */ }
  }, [vista]);
  useEffect(() => {
    const onPop = () => { const v = VISTA_RUTA[window.location.pathname]; if (v) setVista(v); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Paneles
  const [panel, setPanel] = useState<Panel>(null);
  const [aviso, setAviso] = useState<{ txt: string; mal?: boolean } | null>(null);
  const avisar = (txt: string, mal = false) => { setAviso({ txt, mal }); setTimeout(() => setAviso(null), 4500); };
  const [confirmarSalir, setConfirmarSalir] = useState(false);

  const [copiado, setCopiado] = useState(false);
  const copiar = async () => { try { await navigator.clipboard.writeText(codigo); setCopiado(true); setTimeout(() => setCopiado(false), 1600); } catch { /* */ } };

  // Notificaciones
  const notifs: any[] = Array.isArray(cu.notifications) ? cu.notifications : [];
  const hayNuevas = notifs.some(n => !n?.read);
  const [notifAbierto, setNotifAbierto] = useState(false);

  // Beneficiarios (agenda propia de la persona)
  const beneficiarios: Beneficiario[] = useMemo(() => Array.isArray(cu.raw_data?.beneficiariosPersona) ? cu.raw_data.beneficiariosPersona : Array.isArray(cu.beneficiariosPersona) ? cu.beneficiariosPersona : [], [cu]);
  const guardarBeneficiarios = async (lista: Beneficiario[]) => { const ok = await updateUserRawData(cu.id, { beneficiariosPersona: lista }); if (!ok) avisar('No se pudo guardar.', true); return ok; };
  const [benForm, setBenForm] = useState<{ name: string; via: Beneficiario['via']; detail: string; bank: string }>({ name: '', via: 'lincoin', detail: '', bank: '' });
  const [benQuitar, setBenQuitar] = useState<Beneficiario | null>(null);

  // Movimientos
  const movs = useMemo(() => (transactions ?? [])
    .filter((t: any) => t.userId === cu.id)
    .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()), [transactions, cu.id]);
  const contraparte = (t: any) => t.counterpartyName ?? t.senderName ?? t.recipientName ?? t.beneficiaryName ?? '';
  const extracto = () => {
    const filas: (string | number | Date)[][] = [['Fecha', 'Tipo', 'Detalle', 'Monto', 'Moneda', 'Estado', 'Nota', 'Id']];
    for (const t of movs) filas.push([new Date(t.createdAt ?? 0), t.title || ROTULO[t.type] || t.type, contraparte(t), (ENTRA.has(t.type) ? 1 : -1) * (Number(t.amount) || 0), String(t.currency ?? '').split('_')[0], t.status ?? '', t.note ?? '', String(t.id)]);
    descargarXlsx(`lincoin-extracto-${new Date().toISOString().slice(0, 10)}.xlsx`, [{ nombre: 'Movimientos', filas, anchos: [18, 24, 30, 16, 8, 12, 30, 38] }]);
  };

  // ── Enviar ─────────────────────────────────────────────────────────
  const [envModo, setEnvModo] = useState<'lincoin' | 'banco'>('lincoin');
  const [envId, setEnvId] = useState('');
  const [envDest, setEnvDest] = useState<{ id: string; name: string } | null>(null);
  const [envBuscando, setEnvBuscando] = useState(false);
  const [envMonto, setEnvMonto] = useState('');
  const [envCodigo, setEnvCodigo] = useState('');
  const [envPaso, setEnvPaso] = useState<'datos' | 'codigo' | 'listo'>('datos');
  const [envError, setEnvError] = useState<string | null>(null);
  const [envOcupado, setEnvOcupado] = useState(false);
  const [envBanco, setEnvBanco] = useState({ tipo: 'breb', valor: '', nombre: '' });
  const abrirEnviar = (b?: Beneficiario) => {
    setEnvPaso('datos'); setEnvError(null); setEnvMonto(''); setEnvCodigo(''); setEnvDest(null);
    if (b?.via === 'lincoin') { setEnvModo('lincoin'); setEnvId(b.detail.toUpperCase()); buscarDestino(b.detail); }
    else if (b) { setEnvModo('banco'); setEnvBanco({ tipo: b.via === 'nequi' ? 'celular' : b.via === 'breb' ? 'breb' : 'cuenta', valor: b.detail, nombre: b.name }); }
    else { setEnvModo('lincoin'); setEnvId(''); }
    setPanel('enviar');
  };
  const buscarDestino = async (id: string) => {
    const c = id.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setEnvDest(null);
    if (c.length < 4) return;
    setEnvBuscando(true);
    const r = await llamarFuncion('admin-data', { action: 'lookup_recipient', code: c }, 20000);
    setEnvBuscando(false);
    if (r?.found && r.id && r.id !== cu.id) setEnvDest({ id: String(r.id), name: String(r.name ?? 'Usuario Lincoin') });
  };
  const envMontoNum = numero(envMonto);
  const continuarEnvio = (e: React.FormEvent) => {
    e.preventDefault(); setEnvError(null);
    if (envModo === 'banco') { setEnvError('El retiro a banco o Bre-B para cuentas Persona se habilita pronto. Por ahora puedes enviar a otra persona Lincoin con su ID.'); return; }
    if (wa.pronto) { setEnvError(`La billetera ${wa.code} todavía no está disponible.`); return; }
    if (!envDest) { setEnvError('Escribe un ID Lincoin válido.'); return; }
    if (envMontoNum <= 0) { setEnvError('Escribe el monto.'); return; }
    if (envMontoNum > saldo(wa.code)) { setEnvError(`Tienes ${fmt(saldo(wa.code), wa.code)} ${wa.code} disponibles.`); return; }
    if (mfaActivo) setEnvPaso('codigo'); else ejecutarEnvio();
  };
  const ejecutarEnvio = async () => {
    if (!envDest || envOcupado) return;
    setEnvOcupado(true); setEnvError(null);
    try {
      if (mfaActivo) { const ok = await verifyMfaCode(envCodigo); if (!ok) { setEnvError('Código incorrecto.'); setEnvCodigo(''); return; } }
      const r = await sendCuypayPayment(envId.toUpperCase(), envMontoNum, wa.code);
      if (r?.error) { setEnvError(r.error); setEnvPaso('datos'); return; }
      setEnvPaso('listo');
      refreshData().catch(() => {});
    } finally { setEnvOcupado(false); }
  };

  // ── Recargar (PSE) ─────────────────────────────────────────────────
  const [recMonto, setRecMonto] = useState('');
  const [recOcupado, setRecOcupado] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [recLink, setRecLink] = useState<string | null>(null);
  const irAPse = async (e: React.FormEvent) => {
    e.preventDefault(); setRecError(null); setRecLink(null);
    const m = numero(recMonto);
    if (m < 20000) { setRecError('El mínimo es $ 20.000 COP.'); return; }
    setRecOcupado(true);
    const r = await llamarFuncion('finity-proxy', { action: 'create_payment_link', user_id: cu.id, copAmount: m }, 60000);
    setRecOcupado(false);
    if (r?.ok && r?.link) { setRecLink(String(r.link)); try { window.open(String(r.link), '_blank', 'noopener'); } catch { /* */ } refreshData().catch(() => {}); }
    else setRecError(r?.message || r?.error || 'No se pudo abrir PSE. Intenta de nuevo.');
  };

  // ── Convertir ──────────────────────────────────────────────────────
  const [convA, setConvA] = useState('PEN');
  const [convMonto, setConvMonto] = useState('');
  const [convSeg, setConvSeg] = useState(30);
  const [convOcupado, setConvOcupado] = useState(false);
  const [convError, setConvError] = useState<string | null>(null);
  const [convPaso, setConvPaso] = useState<'datos' | 'revisar' | 'listo'>('datos');
  const convDestinos = BILLETERAS.filter(b => !b.pronto && b.code !== wa.code);
  const tasa = getRate(wa.code, convA) || 0;
  const convMontoNum = numero(convMonto);
  const convRecibe = convMontoNum * tasa;
  useEffect(() => {
    if (panel !== 'convertir') return;
    setConvSeg(30);
    const t = setInterval(() => setConvSeg(s => (s <= 1 ? 30 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [panel, wa.code, convA]);
  const revisarConversion = (e: React.FormEvent) => {
    e.preventDefault(); setConvError(null);
    if (!tasa) { setConvError('No hay tasa disponible para este par en este momento.'); return; }
    if (convMontoNum <= 0) { setConvError('Escribe el monto.'); return; }
    if (convMontoNum > saldo(wa.code)) { setConvError(`Tienes ${fmt(saldo(wa.code), wa.code)} ${wa.code} disponibles.`); return; }
    setConvPaso('revisar');
  };
  const ejecutarConversion = async () => {
    if (convOcupado) return;
    setConvOcupado(true); setConvError(null);
    const r = await performConversion(wa.code, convA, convMontoNum, Number(convRecibe.toFixed(decimales(convA))), 0);
    setConvOcupado(false);
    if (r?.error) { setConvError(r.error); setConvPaso('datos'); return; }
    setConvPaso('listo');
    refreshData().catch(() => {});
  };

  // ── Seguridad (2FA) ────────────────────────────────────────────────
  const [mfaQr, setMfaQr] = useState<{ qrCode: string; secret: string; factorId: string } | null>(null);
  const [mfaCodigo, setMfaCodigo] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaRespaldo, setMfaRespaldo] = useState<string[] | null>(null);
  const [mfaOcupado, setMfaOcupado] = useState(false);
  const abrirSeguridad = async () => {
    setPanel('seguridad'); setMfaError(null); setMfaRespaldo(null); setMfaCodigo('');
    if (!mfaActivo && !mfaQr) { setMfaOcupado(true); const r = await enrollMFA(); setMfaOcupado(false); if (r) setMfaQr(r); else setMfaError('No se pudo preparar el 2FA. Intenta de nuevo.'); }
  };
  const activarMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaQr || mfaCodigo.length !== 6 || mfaOcupado) return;
    setMfaOcupado(true); setMfaError(null);
    const r = await verifyMFAEnrollment(mfaQr.factorId, mfaCodigo, mfaQr.secret);
    setMfaOcupado(false);
    if (!r.ok) { setMfaError(r.error ?? 'Código incorrecto.'); setMfaCodigo(''); return; }
    setMfaRespaldo(r.backupCodes ?? []); setMfaQr(null);
    refreshData().catch(() => {});
  };

  // ── Notificaciones (preferencias) ──────────────────────────────────
  const prefs = { correo: true, whatsapp: false, alertas: true, ...(cu.raw_data?.prefsNotificaciones ?? cu.prefsNotificaciones ?? {}) };
  const togglePref = (k: keyof typeof prefs) => updateUserRawData(cu.id, { prefsNotificaciones: { ...prefs, [k]: !prefs[k] } });

  const limiteMensual = 10_000_000;
  const retiradoMes = useMemo(() => { const d = new Date(); const ini = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); return movs.filter((t: any) => t.type === 'send' && t.status === 'Completado' && new Date(t.createdAt ?? 0).getTime() >= ini).reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0); }, [movs]);

  const avatarRef = useRef<HTMLDivElement>(null);
  const funciones: Array<{ icono: React.ElementType; titulo: string; desc: string; abrir: () => void }> = [
    { icono: Link2, titulo: 'Cobrar con link', desc: 'Comparte un link y te pagan en tu billetera', abrir: () => setPanel('cobrar') },
    { icono: TrendingUp, titulo: 'Tasas de cambio', desc: 'COP, BRL, PEN, CLP, MXN en vivo', abrir: () => setPanel('tasas') },
    { icono: FileText, titulo: 'Extractos y certificados', desc: 'PDF mensual y certificado de cuenta', abrir: extracto },
    { icono: BarChart3, titulo: 'Límites y nivel', desc: 'Nivel 1 · sube a Nivel 2', abrir: () => setPanel('limites') },
    { icono: Shield, titulo: 'Seguridad', desc: 'Contraseña, 2 pasos y dispositivos', abrir: abrirSeguridad },
    { icono: Gift, titulo: 'Invita y gana', desc: 'Gana por cada amigo que se registre', abrir: () => setPanel('invita') },
    { icono: Bell, titulo: 'Notificaciones', desc: 'Correo, WhatsApp y alertas', abrir: () => setPanel('notificaciones') },
    { icono: MessageSquare, titulo: 'Ayuda y soporte', desc: 'Chat con nuestro equipo', abrir: () => setVista('ayuda') },
  ];

  const chip = (b: Billetera, activo: boolean, punteado = false): React.CSSProperties => ({
    fontFamily: FONT, fontSize: 13, fontWeight: 700, letterSpacing: '0.5px', padding: '9px 18px', borderRadius: 999, cursor: b.pronto ? 'default' : 'pointer',
    background: activo ? C.text : 'transparent', color: activo ? '#0A0A0A' : b.pronto ? C.tenue : C.text,
    border: `1px ${punteado ? 'dashed' : 'solid'} ${activo ? C.text : C.bordeFuerte}`, whiteSpace: 'nowrap',
  });
  const tab = (v: Vista, txt: string) => (
    <button key={v} onClick={() => setVista(v)} style={{ fontFamily: FONT, fontSize: 16, fontWeight: 600, color: vista === v ? C.text : C.medio, background: vista === v ? 'rgba(255,255,255,0.07)' : 'transparent', border: 'none', borderRadius: 10, padding: '10px 18px', cursor: 'pointer' }}>{txt}</button>
  );

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.fondo, color: C.text, fontFamily: FONT }}>
      <style>{`
        .persona-sec:hover, .persona-func:hover, .persona-chip:hover { border-color: rgba(74,222,128,0.5) !important; }
        .persona-ben:hover .persona-ben-av { border-color: rgba(74,222,128,0.5) !important; }
        @media (max-width: 860px) { .persona-grid-principal { grid-template-columns: 1fr !important; } .persona-tabs { display: none !important; } }
        @media (max-width: 520px) { .persona-drawer { width: 100% !important; } .persona-main { padding: 20px 16px 40px !important; } }
      `}</style>

      {/* Barra superior */}
      <header style={{ borderBottom: `1px solid ${C.borde}`, padding: '0 32px', height: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div className="flex items-center" style={{ gap: 28 }}>
          <div className="flex items-center" style={{ gap: 16 }}>
            <p style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.8px', margin: 0, lineHeight: 1 }}>Lincoin<span style={{ color: C.verde }}>.</span></p>
            <Rotulo>PERSONAS</Rotulo>
          </div>
          <nav className="persona-tabs flex items-center" style={{ gap: 4 }}>
            {tab('inicio', 'Inicio')}{tab('movimientos', 'Movimientos')}{tab('beneficiarios', 'Beneficiarios')}{tab('ayuda', 'Ayuda')}
          </nav>
        </div>
        <div className="flex items-center" style={{ gap: 12 }}>
          <div style={{ position: 'relative' }}>
            <button onClick={() => { setNotifAbierto(v => !v); if (hayNuevas) markNotificationsRead(); }} aria-label="Notificaciones" style={{ width: 54, height: 54, borderRadius: 14, border: `1px solid ${C.bordeFuerte}`, background: 'transparent', color: C.text, cursor: 'pointer', display: 'grid', placeItems: 'center', position: 'relative' }}>
              <Bell size={18} />
              {hayNuevas && <span style={{ position: 'absolute', top: 14, right: 16, width: 8, height: 8, borderRadius: '50%', background: C.verde }} />}
            </button>
            {notifAbierto && (
              <div onMouseLeave={() => setNotifAbierto(false)} style={{ position: 'absolute', right: 0, top: 62, width: 320, background: C.tarjeta, border: `1px solid ${C.bordeFuerte}`, borderRadius: R, padding: 14, zIndex: 50 }}>
                <Rotulo>NOTIFICACIONES</Rotulo>
                {notifs.length === 0 ? <p style={{ fontSize: 13, color: C.tenue, margin: '10px 0 0' }}>Nada nuevo por ahora.</p> : notifs.slice(0, 8).map((n: any, i: number) => (
                  <div key={i} style={{ padding: '10px 0', borderTop: i ? `1px solid ${C.borde}` : 'none' }}>
                    <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{n.title ?? n.titulo ?? 'Aviso'}</p>
                    <p style={{ fontSize: 12, color: C.sub, margin: '2px 0 0' }}>{n.message ?? n.body ?? n.mensaje ?? ''}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div ref={avatarRef} className="flex items-center" style={{ gap: 12, border: `1px solid ${C.bordeFuerte}`, borderRadius: 14, padding: '8px 18px 8px 8px' }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(255,255,255,0.08)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800 }}>{iniciales(nombre)}</span>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{nombre.split(' ')[0]}</span>
          </div>
          <button onClick={() => setConfirmarSalir(true)} style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: C.text, background: 'transparent', border: `1px solid ${C.bordeFuerte}`, borderRadius: 14, padding: '14px 22px', cursor: 'pointer' }}>Salir</button>
        </div>
      </header>

      <main className="persona-main" style={{ maxWidth: 1080, margin: '0 auto', padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {aviso && <div style={{ fontSize: 13.5, fontWeight: 600, color: aviso.mal ? C.text : C.verde, background: 'rgba(255,255,255,0.04)', border: `1px solid ${aviso.mal ? C.bordeFuerte : 'rgba(74,222,128,0.35)'}`, borderRadius: 12, padding: '12px 16px' }}>{aviso.txt}</div>}

        {vista === 'inicio' && (<>
          {/* 1. Saludo */}
          <div className="flex items-end justify-between flex-wrap" style={{ gap: 14 }}>
            <div>
              <p style={{ fontSize: 15, color: C.sub, margin: 0 }}>Hola,</p>
              <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.6px', margin: '4px 0 0' }}>{nombre}</h1>
            </div>
            <div className="flex items-center" style={{ gap: 10 }}>
              <Pill verde={kycOk}>{kycOk ? 'IDENTIDAD VERIFICADA' : 'IDENTIDAD PENDIENTE'}</Pill>
              <Pill>NIVEL 1</Pill>
            </div>
          </div>

          {/* 2. Fila principal */}
          <div className="persona-grid-principal" style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 24 }}>
            <section style={{ background: 'linear-gradient(135deg, #121413, #0C0E0D 60%, #0A0B0A)', border: `1px solid ${C.borde}`, borderRadius: RG, padding: 28, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 88% 8%, rgba(74,222,128,0.14), transparent 45%)', pointerEvents: 'none' }} />
              <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, position: 'relative' }}>
                <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
                  {primeras.map(b => <button key={b.code} className="persona-chip" onClick={() => setWalletActiva(b.code)} style={chip(b, walletActiva === b.code)}>{b.code}</button>)}
                  {restantes.length > 0 && (
                    <div style={{ position: 'relative' }}>
                      <button className="persona-chip" onClick={() => setMasAbierto(v => !v)} style={chip({ ...wa, pronto: false }, false, true)}>{restantes.some(b => b.code === walletActiva) ? walletActiva : `+${restantes.length} más`}</button>
                      {masAbierto && (
                        <div onMouseLeave={() => setMasAbierto(false)} style={{ position: 'absolute', top: 44, left: 0, background: C.tarjeta, border: `1px solid ${C.bordeFuerte}`, borderRadius: 12, padding: 6, zIndex: 20, minWidth: 200 }}>
                          {restantes.map(b => (
                            <button key={b.code} onClick={() => { if (!b.pronto) { setWalletActiva(b.code); setMasAbierto(false); } }}
                              style={{ fontFamily: FONT, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%', background: 'transparent', border: 'none', color: b.pronto ? C.tenue : C.text, fontSize: 13.5, fontWeight: 700, padding: '9px 10px', borderRadius: 8, cursor: b.pronto ? 'default' : 'pointer', textAlign: 'left' }}>
                              <span>{b.code} <span style={{ color: C.tenue, fontWeight: 500 }}>· {b.nombre}</span></span>
                              {b.pronto && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '1px', color: C.tenue }}>PRONTO</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <button onClick={() => setOculto(v => !v)} style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, color: C.medio, background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {oculto ? <Eye size={16} /> : <EyeOff size={16} />} {oculto ? 'Mostrar' : 'Ocultar'}
                </button>
              </div>

              <p style={{ fontSize: 46, fontWeight: 800, letterSpacing: '-1.5px', margin: '26px 0 0', fontVariantNumeric: 'tabular-nums', position: 'relative', lineHeight: 1 }}>
                {enmascarar(fmt(saldo(wa.code), wa.code))} <span style={{ fontSize: 22, color: C.sub, fontWeight: 700, letterSpacing: 0 }}>{wa.code}</span>
              </p>
              <p style={{ fontSize: 15, color: C.medio, margin: '14px 0 0', position: 'relative' }}>{wa.nombre} · {wa.desc}</p>
              <p style={{ fontSize: 14, color: C.sub, margin: '6px 0 0', position: 'relative' }}>Total en todas tus billeteras: <b style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>{enmascarar(fmt(totalEnCop, 'COP'))} COP</b></p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: 14, marginTop: 28, position: 'relative' }}>
                <button onClick={() => abrirEnviar()} className="lincoin-btn-white" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, border: 'none', borderRadius: 14, padding: '22px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}><ArrowUpRight size={22} /> Enviar</button>
                <button onClick={() => { setRecMonto(''); setRecError(null); setRecLink(null); setPanel('recargar'); }} className="persona-sec" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.bordeFuerte}`, borderRadius: 14, padding: '22px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}><Plus size={22} /> Recargar</button>
                <button onClick={() => { setConvMonto(''); setConvError(null); setConvPaso('datos'); setConvA(convDestinos[0]?.code ?? 'PEN'); setPanel('convertir'); }} className="persona-sec" style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.bordeFuerte}`, borderRadius: 14, padding: '22px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}><ArrowLeftRight size={22} /> Convertir</button>
              </div>
            </section>

            <Tarjeta grande>
              <Rotulo>MI ID LINCOIN</Rotulo>
              <div className="flex items-center justify-between" style={{ gap: 12, marginTop: 14 }}>
                <p style={{ fontFamily: MONO, fontSize: 34, fontWeight: 700, letterSpacing: '4px', margin: 0, lineHeight: 1 }}>{codigo}</p>
                <BotonPrimario onClick={copiar} style={{ padding: '12px 22px', display: 'inline-flex', alignItems: 'center', gap: 8 }}>{copiado ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar</>}</BotonPrimario>
              </div>
              <p style={{ fontSize: 15, color: C.medio, margin: '20px 0 0', lineHeight: 1.55 }}>Dáselo a la empresa que te va a cargar saldo, o a otra persona Lincoin para recibir un envío. Sin comisión.</p>
              <div className="flex items-center" style={{ gap: 14, marginTop: 34, background: 'rgba(255,255,255,0.03)', border: `1px solid rgba(255,255,255,0.1)`, borderRadius: 12, padding: '16px 18px' }}>
                <MiniTarjeta />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Tarjeta Lincoin</p>
                  <p style={{ fontSize: 13, color: C.sub, margin: '2px 0 0' }}>Mastercard para pagar con tu saldo</p>
                </div>
                <Pill>PRONTO</Pill>
              </div>
            </Tarjeta>
          </div>

          {/* 3. Estado */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24 }}>
            <Tarjeta>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Límite de retiro mensual</p>
                <p style={{ fontSize: 15, color: C.sub, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{fmt(retiradoMes, 'COP')} / {fmt(limiteMensual, 'COP')}</p>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', marginTop: 20, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, Math.max(1.5, (retiradoMes / limiteMensual) * 100))}%`, height: '100%', background: C.verde, borderRadius: 999 }} />
              </div>
              <button onClick={() => setPanel('limites')} style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.verde, background: 'transparent', border: 'none', padding: 0, marginTop: 18, cursor: 'pointer' }}>Subir a Nivel 2 →</button>
            </Tarjeta>
            <Tarjeta>
              <div className="flex items-center justify-between" style={{ gap: 14 }}>
                <div>
                  <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Cuenta para retiros</p>
                  <p style={{ fontSize: 14, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>{beneficiarios.some(b => b.via !== 'lincoin') ? `${beneficiarios.filter(b => b.via !== 'lincoin').length} cuenta(s) guardada(s)` : 'Aún no agregas una cuenta bancaria o llave Bre-B'}</p>
                </div>
                <BotonSecundario onClick={() => { setBenForm({ name: nombre, via: 'breb', detail: '', bank: '' }); setPanel('beneficiario'); }} style={{ padding: '13px 22px' }}>Agregar</BotonSecundario>
              </div>
            </Tarjeta>
            <Tarjeta>
              <div className="flex items-center justify-between" style={{ gap: 14 }}>
                <div>
                  <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Seguridad</p>
                  <p style={{ fontSize: 14, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>{mfaActivo ? 'Verificación en dos pasos activa' : 'Activa la verificación en dos pasos'}</p>
                </div>
                {mfaActivo ? <Pill verde>ACTIVA</Pill> : <BotonSecundario onClick={abrirSeguridad} style={{ padding: '13px 22px' }}>Activar</BotonSecundario>}
              </div>
            </Tarjeta>
          </div>

          {/* 4. Beneficiarios frecuentes */}
          <Tarjeta>
            <div className="flex items-center justify-between">
              <Rotulo>BENEFICIARIOS FRECUENTES</Rotulo>
              <button onClick={() => setVista('beneficiarios')} style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.verde, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>Ver todos →</button>
            </div>
            <div className="flex items-start" style={{ gap: 28, marginTop: 24, overflowX: 'auto', paddingBottom: 4 }}>
              <button onClick={() => { setBenForm({ name: '', via: 'lincoin', detail: '', bank: '' }); setPanel('beneficiario'); }} className="persona-ben" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: FONT, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minWidth: 90 }}>
                <span className="persona-ben-av" style={{ width: 50, height: 50, borderRadius: '50%', border: `1px dashed ${C.medio}`, display: 'grid', placeItems: 'center', color: C.text }}><Plus size={18} /></span>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Nuevo</span>
              </button>
              {beneficiarios.slice(0, 8).map(b => (
                <button key={b.id} onClick={() => abrirEnviar(b)} className="persona-ben" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: FONT, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minWidth: 90 }}>
                  <span className="persona-ben-av" style={{ width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.bordeFuerte}`, display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 800, color: C.text }}>{iniciales(b.name)}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.text, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                  <span style={{ fontSize: 12, color: C.sub, marginTop: -6 }}>{b.via === 'banco' && b.bank ? b.bank : VIA_TXT[b.via]}</span>
                </button>
              ))}
            </div>
          </Tarjeta>

          {/* 5. Movimientos */}
          <Tarjeta>
            <div className="flex items-center justify-between" style={{ gap: 10 }}>
              <Rotulo>MOVIMIENTOS</Rotulo>
              <BotonSecundario onClick={extracto} style={{ padding: '11px 20px', fontSize: 15 }}>Descargar extracto</BotonSecundario>
            </div>
            <ListaMovimientos movs={movs.slice(0, 8)} contraparte={contraparte} oculto={oculto} vacioAncho />
            {movs.length > 8 && <button onClick={() => setVista('movimientos')} style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: C.verde, background: 'transparent', border: 'none', padding: 0, marginTop: 14, cursor: 'pointer' }}>Ver todos →</button>}
          </Tarjeta>

          {/* 6. Más funciones */}
          <Tarjeta>
            <Rotulo>MÁS FUNCIONES</Rotulo>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginTop: 24 }}>
              {funciones.map(f => (
                <button key={f.titulo} onClick={f.abrir} className="persona-func" style={{ fontFamily: FONT, textAlign: 'left', background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.borde}`, borderRadius: R, padding: '18px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16, color: C.text }}>
                  <span style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(255,255,255,0.05)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><f.icono size={22} strokeWidth={1.8} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 17, fontWeight: 700 }}>{f.titulo}</span>
                    <span style={{ display: 'block', fontSize: 14, color: C.sub, marginTop: 2, lineHeight: 1.4 }}>{f.desc}</span>
                  </span>
                  <ArrowRight size={18} color={C.sub} />
                </button>
              ))}
            </div>
          </Tarjeta>

          {/* 7. Próximamente */}
          <div className="flex items-center flex-wrap" style={{ gap: 14, border: `1px dashed ${C.bordeFuerte}`, borderRadius: R, padding: '22px 28px' }}>
            <Rotulo style={{ marginRight: 14 }}>PRÓXIMAMENTE</Rotulo>
            {[['USD', 'cuenta en dólares'], ['EUR', 'cuenta en euros'], ['USDC', 'dólar de Circle'], ['EURC', 'euro de Circle'], ['Tarjeta', 'Mastercard Lincoin']].map(([t, d]) => (
              <span key={t} style={{ fontSize: 16, color: C.medio, border: `1px solid ${C.bordeFuerte}`, borderRadius: 999, padding: '12px 22px', whiteSpace: 'nowrap' }}><b style={{ color: C.text }}>{t}</b> · {d}</span>
            ))}
          </div>
        </>)}

        {vista === 'movimientos' && (
          <Tarjeta>
            <div className="flex items-center justify-between" style={{ gap: 10 }}>
              <div><h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', margin: 0 }}>Movimientos</h1><p style={{ fontSize: 14, color: C.sub, margin: '4px 0 0' }}>{movs.length ? `${movs.length} en total` : 'Todo lo que entra y sale de tus billeteras.'}</p></div>
              <BotonSecundario onClick={extracto} style={{ padding: '11px 20px', fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Download size={15} /> Descargar extracto</BotonSecundario>
            </div>
            <ListaMovimientos movs={movs} contraparte={contraparte} oculto={oculto} vacioAncho />
          </Tarjeta>
        )}

        {vista === 'beneficiarios' && (
          <Tarjeta>
            <div className="flex items-center justify-between" style={{ gap: 10 }}>
              <div><h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', margin: 0 }}>Beneficiarios</h1><p style={{ fontSize: 14, color: C.sub, margin: '4px 0 0' }}>Personas Lincoin, cuentas y llaves a las que envías seguido.</p></div>
              <BotonPrimario onClick={() => { setBenForm({ name: '', via: 'lincoin', detail: '', bank: '' }); setPanel('beneficiario'); }} style={{ padding: '11px 20px', display: 'inline-flex', alignItems: 'center', gap: 8 }}><Plus size={15} /> Nuevo</BotonPrimario>
            </div>
            {beneficiarios.length === 0 ? (
              <p style={{ fontSize: 14, color: C.tenue, margin: '24px 0 8px', lineHeight: 1.5 }}>Todavía no tienes beneficiarios. Agrega el ID Lincoin de una persona, un Nequi, una llave Bre-B o una cuenta bancaria.</p>
            ) : (
              <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column' }}>
                {beneficiarios.map(b => (
                  <div key={b.id} className="flex items-center" style={{ gap: 14, padding: '14px 0', borderTop: `1px solid ${C.borde}` }}>
                    <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.bordeFuerte}`, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800 }}>{iniciales(b.name)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{b.name}</p>
                      <p style={{ fontSize: 13, color: C.sub, margin: '2px 0 0' }}>{b.via === 'banco' && b.bank ? `${b.bank} · ` : `${VIA_TXT[b.via]} · `}<span style={{ fontFamily: b.via === 'lincoin' ? MONO : FONT }}>{b.detail}</span></p>
                    </div>
                    <BotonSecundario onClick={() => abrirEnviar(b)} style={{ padding: '9px 14px', fontSize: 13 }}>Enviar</BotonSecundario>
                    <button onClick={() => setBenQuitar(b)} title="Quitar" style={{ background: 'transparent', border: `1px solid ${C.bordeFuerte}`, color: C.sub, borderRadius: 10, padding: '9px 10px', cursor: 'pointer' }}><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </Tarjeta>
        )}

        {vista === 'ayuda' && (
          <Tarjeta>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', margin: 0 }}>Ayuda y soporte</h1>
            <p style={{ fontSize: 14, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>Escríbenos y una persona del equipo te responde.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginTop: 22 }}>
              <button onClick={() => { try { (window as any).$crisp?.push(['do', 'chat:open']); } catch { /* */ } if (!(window as any).$crisp) window.open('mailto:soporte@lincoin.me', '_blank'); }} className="persona-func" style={{ fontFamily: FONT, textAlign: 'left', background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.borde}`, borderRadius: R, padding: '18px 20px', cursor: 'pointer', color: C.text }}>
                <p style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Chat con nuestro equipo</p><p style={{ fontSize: 14, color: C.sub, margin: '4px 0 0' }}>Abre el chat de soporte</p>
              </button>
              <a href="mailto:soporte@lincoin.me" className="persona-func" style={{ fontFamily: FONT, textDecoration: 'none', background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.borde}`, borderRadius: R, padding: '18px 20px', color: C.text, display: 'block' }}>
                <p style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Correo</p><p style={{ fontSize: 14, color: C.sub, margin: '4px 0 0' }}>soporte@lincoin.me</p>
              </a>
            </div>
            <div style={{ marginTop: 24 }}>
              <Rotulo>PREGUNTAS FRECUENTES</Rotulo>
              {[
                ['¿Cómo recibo saldo?', 'Copia tu ID Lincoin y dáselo a la empresa o a la persona que te va a enviar. Te llega al instante y sin comisión.'],
                ['¿Puedo retirar a mi banco?', 'Pronto. Por ahora puedes enviar tu saldo a otra persona Lincoin y convertir entre billeteras.'],
                ['¿Qué es el Nivel 2?', 'Un tope de retiro mensual más alto. Se sube verificando tu identidad y tu dirección.'],
              ].map(([q, a]) => (
                <div key={q} style={{ padding: '14px 0', borderTop: `1px solid ${C.borde}` }}><p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{q}</p><p style={{ fontSize: 14, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>{a}</p></div>
              ))}
            </div>
          </Tarjeta>
        )}
      </main>

      {/* ── Paneles laterales ── */}
      {panel === 'enviar' && (
        <Drawer titulo="Enviar" sub={`Desde tu billetera ${wa.code} · disponible ${fmt(saldo(wa.code), wa.code)}`} onCerrar={() => setPanel(null)}>
          {envPaso === 'listo' ? (
            <div style={{ textAlign: 'center', padding: '30px 0' }}>
              <span style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(74,222,128,0.12)', display: 'grid', placeItems: 'center', margin: '0 auto' }}><Check size={28} color={C.verde} /></span>
              <p style={{ fontSize: 20, fontWeight: 800, margin: '18px 0 0' }}>Enviado</p>
              <p style={{ fontSize: 14, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>{fmt(envMontoNum, wa.code)} {wa.code} a {envDest?.name}. Ya está en su cuenta.</p>
              <BotonPrimario onClick={() => setPanel(null)} style={{ marginTop: 24 }}>Listo</BotonPrimario>
            </div>
          ) : envPaso === 'codigo' ? (
            <form onSubmit={e => { e.preventDefault(); ejecutarEnvio(); }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 12, padding: '14px 16px' }}>
                <div className="flex justify-between"><span style={{ fontSize: 13, color: C.sub }}>Para</span><b style={{ fontSize: 14 }}>{envDest?.name}</b></div>
                <div className="flex justify-between" style={{ marginTop: 6 }}><span style={{ fontSize: 13, color: C.sub }}>Monto</span><b style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{fmt(envMontoNum, wa.code)} {wa.code}</b></div>
              </div>
              <div><Etiqueta>CÓDIGO DE TU APP DE AUTENTICACIÓN</Etiqueta><Campo value={envCodigo} onChange={e => setEnvCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" autoFocus style={{ fontFamily: MONO, fontSize: 22, letterSpacing: '6px', textAlign: 'center' }} /></div>
              {envError && <p style={{ fontSize: 13, color: C.medio, margin: 0 }}>{envError}</p>}
              <BotonPrimario type="submit" disabled={envOcupado || envCodigo.length !== 6}>{envOcupado ? 'Enviando…' : 'Confirmar envío'}</BotonPrimario>
            </form>
          ) : (
            <form onSubmit={continuarEnvio} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {([['lincoin', 'A persona Lincoin', 'Gratis y al instante', User], ['banco', 'A banco o Bre-B', 'Llega en minutos', Landmark]] as const).map(([k, t, d, Ic]) => (
                  <button key={k} type="button" onClick={() => setEnvModo(k)} style={{ fontFamily: FONT, textAlign: 'left', background: envModo === k ? 'rgba(255,255,255,0.07)' : 'transparent', border: `1px solid ${envModo === k ? C.text : C.bordeFuerte}`, borderRadius: 12, padding: '14px', cursor: 'pointer', color: C.text }}>
                    <Ic size={18} /><p style={{ fontSize: 14, fontWeight: 700, margin: '10px 0 0' }}>{t}</p><p style={{ fontSize: 12, color: C.sub, margin: '2px 0 0' }}>{d}</p>
                  </button>
                ))}
              </div>
              {envModo === 'lincoin' ? (
                <div>
                  <Etiqueta>ID LINCOIN DEL DESTINATARIO</Etiqueta>
                  <div style={{ position: 'relative' }}>
                    <Search size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: C.sub }} />
                    <Campo value={envId} onChange={e => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); setEnvId(v); buscarDestino(v); }} placeholder="Ej. C10ED1" style={{ paddingLeft: 38, fontFamily: MONO, letterSpacing: '3px', fontWeight: 700 }} autoFocus />
                  </div>
                  <p style={{ fontSize: 13, margin: '8px 0 0', color: envDest ? C.verde : C.tenue }}>{envBuscando ? 'Buscando…' : envDest ? `${envDest.name}` : envId.length >= 4 ? 'No encontramos ese ID' : 'Pídele su ID: está en su portal, en "Mi ID Lincoin".'}</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div><Etiqueta>DESTINO</Etiqueta>
                    <select value={envBanco.tipo} onChange={e => setEnvBanco({ ...envBanco, tipo: e.target.value })} style={{ fontFamily: FONT, width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.bordeFuerte}`, color: C.text, borderRadius: 11, padding: '12px 14px', fontSize: 14 }}>
                      <option value="breb" style={{ color: '#000' }}>Llave Bre-B</option><option value="celular" style={{ color: '#000' }}>Celular (Nequi / Daviplata)</option><option value="cedula" style={{ color: '#000' }}>Cédula</option><option value="cuenta" style={{ color: '#000' }}>Número de cuenta</option>
                    </select></div>
                  <div><Etiqueta>{envBanco.tipo === 'breb' ? 'LLAVE' : envBanco.tipo === 'celular' ? 'CELULAR' : envBanco.tipo === 'cedula' ? 'CÉDULA' : 'NÚMERO DE CUENTA'}</Etiqueta><Campo value={envBanco.valor} onChange={e => setEnvBanco({ ...envBanco, valor: e.target.value })} placeholder="Escríbelo tal cual" /></div>
                  <div><Etiqueta>NOMBRE DEL TITULAR</Etiqueta><Campo value={envBanco.nombre} onChange={e => setEnvBanco({ ...envBanco, nombre: e.target.value })} placeholder="Como aparece en su cuenta" /></div>
                </div>
              )}
              <div>
                <Etiqueta>MONTO EN {wa.code}</Etiqueta>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: C.sub, fontWeight: 700 }}>{wa.simbolo}</span>
                  <Campo value={envMonto} onChange={e => setEnvMonto(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" placeholder="0" style={{ paddingLeft: 14 + 10 * wa.simbolo.length + 8, fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }} />
                </div>
                <p style={{ fontSize: 13, color: C.tenue, margin: '8px 0 0' }}>Disponible: {fmt(saldo(wa.code), wa.code)} {wa.code}</p>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 12, padding: '12px 16px', fontSize: 13.5 }}>
                <div className="flex justify-between"><span style={{ color: C.sub }}>Comisión</span><b>{envModo === 'lincoin' ? 'Sin comisión' : 'Según el destino'}</b></div>
                <div className="flex justify-between" style={{ marginTop: 6 }}><span style={{ color: C.sub }}>Tiempo</span><b>{envModo === 'lincoin' ? 'Al instante' : 'Minutos'}</b></div>
                {envMontoNum > 0 && <div className="flex justify-between" style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.borde}` }}><span style={{ color: C.sub }}>Recibe</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(envMontoNum, wa.code)} {wa.code}</b></div>}
              </div>
              {envError && <p style={{ fontSize: 13.5, color: C.medio, margin: 0, lineHeight: 1.5 }}>{envError}</p>}
              <BotonPrimario type="submit" disabled={envOcupado}>{envOcupado ? 'Enviando…' : 'Continuar'}</BotonPrimario>
            </form>
          )}
        </Drawer>
      )}

      {panel === 'recargar' && (
        <Drawer titulo="Recargar" sub={wa.code === 'COP' ? 'Por PSE, desde tu banco. Mínimo $ 20.000.' : `La recarga está disponible en la billetera COP.`} onCerrar={() => setPanel(null)}>
          {wa.code !== 'COP' ? (
            <BotonSecundario onClick={() => setWalletActiva('COP')}>Cambiar a COP</BotonSecundario>
          ) : (
            <form onSubmit={irAPse} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <Etiqueta>MONTO EN COP</Etiqueta>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: C.sub, fontWeight: 700 }}>$</span>
                  <Campo value={recMonto ? Number(numero(recMonto)).toLocaleString('es-CO') : ''} onChange={e => setRecMonto(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="0" autoFocus style={{ paddingLeft: 30, fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }} />
                </div>
                <p style={{ fontSize: 13, color: C.tenue, margin: '8px 0 0' }}>Mínimo $ 20.000 COP. Pagas desde tu banco en PSE y el saldo te queda al confirmarse.</p>
              </div>
              {recError && <p style={{ fontSize: 13.5, color: C.medio, margin: 0, lineHeight: 1.5 }}>{recError}</p>}
              {recLink && <p style={{ fontSize: 13.5, color: C.verde, margin: 0, lineHeight: 1.5 }}>Se abrió PSE en otra pestaña. Si no la ves, <a href={recLink} target="_blank" rel="noreferrer" style={{ color: C.verde, textDecoration: 'underline' }}>ábrela aquí</a>.</p>}
              <BotonPrimario type="submit" disabled={recOcupado}>{recOcupado ? 'Preparando…' : 'Ir a PSE'}</BotonPrimario>
            </form>
          )}
        </Drawer>
      )}

      {panel === 'convertir' && (
        <Drawer titulo="Convertir" sub="Entre tus billeteras. La tasa se refresca sola." onCerrar={() => setPanel(null)}>
          {convPaso === 'listo' ? (
            <div style={{ textAlign: 'center', padding: '30px 0' }}>
              <span style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(74,222,128,0.12)', display: 'grid', placeItems: 'center', margin: '0 auto' }}><Check size={28} color={C.verde} /></span>
              <p style={{ fontSize: 20, fontWeight: 800, margin: '18px 0 0' }}>Convertido</p>
              <p style={{ fontSize: 14, color: C.sub, margin: '6px 0 0' }}>{fmt(convMontoNum, wa.code)} {wa.code} → {fmt(convRecibe, convA)} {convA}</p>
              <BotonPrimario onClick={() => setPanel(null)} style={{ marginTop: 24 }}>Listo</BotonPrimario>
            </div>
          ) : (
            <form onSubmit={convPaso === 'datos' ? revisarConversion : e => { e.preventDefault(); ejecutarConversion(); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 12, padding: '14px 16px' }}>
                <Etiqueta>DE</Etiqueta>
                <div className="flex items-center" style={{ gap: 10 }}>
                  <Campo value={convMonto} onChange={e => { setConvMonto(e.target.value.replace(/[^\d.,]/g, '')); setConvPaso('datos'); }} inputMode="decimal" placeholder="0" disabled={convPaso === 'revisar'} style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', background: 'transparent', border: 'none', padding: 0 }} />
                  <span style={{ fontSize: 16, fontWeight: 800, whiteSpace: 'nowrap' }}>{wa.code}</span>
                </div>
                <p style={{ fontSize: 12.5, color: C.tenue, margin: '6px 0 0' }}>Disponible {fmt(saldo(wa.code), wa.code)}</p>
              </div>
              <div style={{ textAlign: 'center', color: C.sub }}><ArrowLeftRight size={18} style={{ transform: 'rotate(90deg)' }} /></div>
              <div style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 12, padding: '14px 16px' }}>
                <Etiqueta>A</Etiqueta>
                <div className="flex items-center justify-between" style={{ gap: 10 }}>
                  <p style={{ fontSize: 22, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{tasa ? fmt(convRecibe, convA) : '—'}</p>
                  <select value={convA} onChange={e => { setConvA(e.target.value); setConvPaso('datos'); }} style={{ fontFamily: FONT, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.bordeFuerte}`, color: C.text, borderRadius: 10, padding: '8px 12px', fontSize: 14, fontWeight: 800 }}>
                    {convDestinos.map(b => <option key={b.code} value={b.code} style={{ color: '#000' }}>{b.code}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 12, padding: '12px 16px', fontSize: 13.5 }}>
                <div className="flex justify-between"><span style={{ color: C.sub }}>Tasa</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{tasa ? `1 ${wa.code} = ${tasa.toLocaleString('es-CO', { maximumFractionDigits: 4 })} ${convA}` : 'sin tasa'}</b></div>
                <div className="flex justify-between" style={{ marginTop: 6 }}><span style={{ color: C.sub }}>Válida por</span><b style={{ color: C.verde, fontVariantNumeric: 'tabular-nums' }}>{convSeg} s</b></div>
                <div className="flex justify-between" style={{ marginTop: 6 }}><span style={{ color: C.sub }}>Comisión</span><b>Incluida en la tasa</b></div>
              </div>
              {convError && <p style={{ fontSize: 13.5, color: C.medio, margin: 0, lineHeight: 1.5 }}>{convError}</p>}
              <BotonPrimario type="submit" disabled={convOcupado}>{convOcupado ? 'Convirtiendo…' : convPaso === 'revisar' ? `Confirmar: ${fmt(convMontoNum, wa.code)} → ${fmt(convRecibe, convA)}` : 'Revisar conversión'}</BotonPrimario>
            </form>
          )}
        </Drawer>
      )}

      {panel === 'beneficiario' && (
        <Drawer titulo="Nuevo beneficiario" sub="Queda guardado para enviarle en dos toques." onCerrar={() => setPanel(null)}>
          <form onSubmit={async e => { e.preventDefault(); if (!benForm.name.trim() || !benForm.detail.trim()) return; const ok = await guardarBeneficiarios([{ id: crypto.randomUUID(), name: benForm.name.trim(), via: benForm.via, detail: benForm.detail.trim(), bank: benForm.bank.trim() || undefined }, ...beneficiarios]); if (ok) { setPanel(null); avisar('Beneficiario guardado.'); } }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div><Etiqueta>NOMBRE</Etiqueta><Campo value={benForm.name} onChange={e => setBenForm({ ...benForm, name: e.target.value })} placeholder="Ej. Mamá" autoFocus /></div>
            <div><Etiqueta>VÍA</Etiqueta>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(Object.keys(VIA_TXT) as Beneficiario['via'][]).map(v => (
                  <button key={v} type="button" onClick={() => setBenForm({ ...benForm, via: v })} style={{ fontFamily: FONT, fontSize: 13.5, fontWeight: 700, color: C.text, background: benForm.via === v ? 'rgba(255,255,255,0.07)' : 'transparent', border: `1px solid ${benForm.via === v ? C.text : C.bordeFuerte}`, borderRadius: 10, padding: '11px', cursor: 'pointer' }}>{VIA_TXT[v]}</button>
                ))}
              </div>
            </div>
            <div><Etiqueta>{benForm.via === 'lincoin' ? 'ID LINCOIN' : benForm.via === 'nequi' ? 'CELULAR' : benForm.via === 'breb' ? 'LLAVE BRE-B' : 'NÚMERO DE CUENTA'}</Etiqueta><Campo value={benForm.detail} onChange={e => setBenForm({ ...benForm, detail: benForm.via === 'lincoin' ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) : e.target.value })} placeholder={benForm.via === 'lincoin' ? 'Ej. C10ED1' : ''} style={benForm.via === 'lincoin' ? { fontFamily: MONO, letterSpacing: '3px', fontWeight: 700 } : undefined} /></div>
            {benForm.via === 'banco' && <div><Etiqueta>BANCO</Etiqueta><Campo value={benForm.bank} onChange={e => setBenForm({ ...benForm, bank: e.target.value })} placeholder="Ej. Bancolombia" /></div>}
            <BotonPrimario type="submit" disabled={!benForm.name.trim() || !benForm.detail.trim()}>Guardar</BotonPrimario>
          </form>
        </Drawer>
      )}

      {panel === 'seguridad' && (
        <Drawer titulo="Seguridad" sub="Verificación en dos pasos con tu app de autenticación." onCerrar={() => setPanel(null)}>
          {mfaRespaldo ? (
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, margin: 0, color: C.verde }}>Dos pasos activados</p>
              <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>Guarda estos códigos de respaldo en un lugar seguro. Cada uno sirve una sola vez si pierdes tu celular.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>{mfaRespaldo.map(c => <span key={c} style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, letterSpacing: '1px', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, borderRadius: 8, padding: '10px', textAlign: 'center' }}>{c}</span>)}</div>
              <BotonPrimario onClick={() => setPanel(null)} style={{ marginTop: 20, width: '100%' }}>Ya los guardé</BotonPrimario>
            </div>
          ) : mfaActivo ? (
            <p style={{ fontSize: 14, color: C.sub, lineHeight: 1.5 }}>Tu cuenta ya tiene la verificación en dos pasos activa. Cada envío pide el código de tu app.</p>
          ) : (
            <form onSubmit={activarMfa} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {mfaOcupado && !mfaQr ? <p style={{ fontSize: 13.5, color: C.sub }}>Preparando…</p> : mfaQr ? (<>
                <p style={{ fontSize: 13.5, color: C.sub, margin: 0, lineHeight: 1.5 }}>1. Abre Google Authenticator, 1Password o similar y escanea este código.</p>
                <div style={{ background: '#fff', borderRadius: 12, padding: 12, width: 'fit-content', margin: '0 auto' }}><img src={mfaQr.qrCode} alt="Código QR del 2FA" width={180} height={180} /></div>
                <p style={{ fontSize: 12.5, color: C.tenue, margin: 0, wordBreak: 'break-all' }}>O escribe la clave: <span style={{ fontFamily: MONO, color: C.medio }}>{mfaQr.secret}</span></p>
                <div><Etiqueta>2. ESCRIBE EL CÓDIGO DE 6 DÍGITOS</Etiqueta><Campo value={mfaCodigo} onChange={e => setMfaCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" style={{ fontFamily: MONO, fontSize: 22, letterSpacing: '6px', textAlign: 'center' }} /></div>
                <BotonPrimario type="submit" disabled={mfaOcupado || mfaCodigo.length !== 6}>{mfaOcupado ? 'Activando…' : 'Activar'}</BotonPrimario>
              </>) : null}
              {mfaError && <p style={{ fontSize: 13.5, color: C.medio, margin: 0 }}>{mfaError}</p>}
            </form>
          )}
        </Drawer>
      )}

      {panel === 'tasas' && (
        <Drawer titulo="Tasas de cambio" sub="Lo que recibes por cada unidad de tu billetera activa." onCerrar={() => setPanel(null)}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {BILLETERAS.filter(b => !b.pronto && b.code !== wa.code).map(b => { const r = getRate(wa.code, b.code) || 0; return (
              <div key={b.code} className="flex items-center justify-between" style={{ padding: '14px 0', borderBottom: `1px solid ${C.borde}` }}>
                <div><p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{wa.code} → {b.code}</p><p style={{ fontSize: 12.5, color: C.sub, margin: '2px 0 0' }}>{b.nombre}</p></div>
                <p style={{ fontSize: 15, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{r ? `${r.toLocaleString('es-CO', { maximumFractionDigits: 4 })}` : '—'}</p>
              </div>); })}
          </div>
          <p style={{ fontSize: 12.5, color: C.tenue, margin: '14px 0 0', lineHeight: 1.5 }}>Tasa en vivo con la comisión incluida. Al convertir se fija por 30 segundos.</p>
        </Drawer>
      )}

      {panel === 'limites' && (
        <Drawer titulo="Límites y nivel" sub="Lo que puedes mover al mes según tu nivel." onCerrar={() => setPanel(null)}>
          {[['Nivel 1', 'Identidad verificada', `${fmt(limiteMensual, 'COP')} COP de retiro al mes`, true], ['Nivel 2', 'Identidad + dirección + origen de fondos', 'Retiro mensual ampliado y cuenta en dólares cuando esté', false]].map(([n, req, top, act]) => (
            <div key={String(n)} style={{ background: act ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${act ? 'rgba(74,222,128,0.3)' : C.borde}`, borderRadius: 12, padding: '16px', marginBottom: 12 }}>
              <div className="flex items-center justify-between"><p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{n}</p>{act && <Pill verde>TU NIVEL</Pill>}</div>
              <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0' }}>{req}</p>
              <p style={{ fontSize: 13.5, color: C.medio, margin: '4px 0 0' }}>{top}</p>
            </div>
          ))}
          <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.5, margin: '8px 0 0' }}>Para subir a Nivel 2 escríbenos por el chat de soporte: te pedimos un comprobante de dirección y una breve declaración del origen de tus fondos.</p>
          <BotonPrimario onClick={() => { setPanel(null); setVista('ayuda'); }} style={{ marginTop: 16, width: '100%' }}>Pedir Nivel 2</BotonPrimario>
        </Drawer>
      )}

      {panel === 'notificaciones' && (
        <Drawer titulo="Notificaciones" sub="Por dónde te avisamos de cada movimiento." onCerrar={() => setPanel(null)}>
          {([['correo', 'Correo', 'Cada carga, envío y conversión'], ['whatsapp', 'WhatsApp', 'Avisos de saldo recibido'], ['alertas', 'Alertas de seguridad', 'Ingresos nuevos y cambios en la cuenta']] as const).map(([k, t, d]) => (
            <button key={k} onClick={() => togglePref(k)} style={{ fontFamily: FONT, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: `1px solid ${C.borde}`, padding: '14px 0', cursor: 'pointer', color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span><span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{t}</span><span style={{ display: 'block', fontSize: 12.5, color: C.sub, marginTop: 2 }}>{d}</span></span>
              <span style={{ width: 40, height: 22, borderRadius: 999, background: prefs[k] ? C.verde : 'rgba(255,255,255,0.15)', position: 'relative', flexShrink: 0 }}><span style={{ position: 'absolute', top: 3, left: prefs[k] ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#0C0E0D', transition: 'left .15s' }} /></span>
            </button>
          ))}
        </Drawer>
      )}

      {panel === 'invita' && (
        <Drawer titulo="Invita y gana" sub="Comparte tu ID: es también tu código de invitación." onCerrar={() => setPanel(null)}>
          <div style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 12, padding: '18px', textAlign: 'center' }}>
            <p style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700, letterSpacing: '4px', margin: 0 }}>{codigo}</p>
            <BotonPrimario onClick={copiar} style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}>{copiado ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar código</>}</BotonPrimario>
          </div>
          <p style={{ fontSize: 13.5, color: C.sub, margin: '16px 0 0', lineHeight: 1.55 }}>Cuando alguien se registra con tu código y hace su primer movimiento, el bono te llega como "Bono de referido" en tus movimientos.</p>
        </Drawer>
      )}

      {panel === 'cobrar' && (
        <Drawer titulo="Cobrar con link" sub="Un enlace de pago por PSE que te acredita en tu billetera COP." onCerrar={() => setPanel(null)}>
          <form onSubmit={irAPse} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <Etiqueta>MONTO A COBRAR EN COP</Etiqueta>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: C.sub, fontWeight: 700 }}>$</span>
                <Campo value={recMonto ? Number(numero(recMonto)).toLocaleString('es-CO') : ''} onChange={e => setRecMonto(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="0" autoFocus style={{ paddingLeft: 30, fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }} />
              </div>
              <p style={{ fontSize: 13, color: C.tenue, margin: '8px 0 0' }}>Mínimo $ 20.000. Compartes el enlace y quien te paga entra por PSE.</p>
            </div>
            {recError && <p style={{ fontSize: 13.5, color: C.medio, margin: 0 }}>{recError}</p>}
            {recLink && (
              <div style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 12, padding: '12px 14px' }}>
                <p style={{ fontSize: 12.5, color: C.sub, margin: 0 }}>Tu enlace</p>
                <p style={{ fontSize: 13, margin: '4px 0 0', wordBreak: 'break-all' }}>{recLink}</p>
                <BotonSecundario type="button" onClick={async () => { try { await navigator.clipboard.writeText(recLink); avisar('Enlace copiado.'); } catch { /* */ } }} style={{ marginTop: 10, padding: '9px 14px', fontSize: 13 }}>Copiar enlace</BotonSecundario>
              </div>
            )}
            <BotonPrimario type="submit" disabled={recOcupado}>{recOcupado ? 'Generando…' : 'Generar enlace'}</BotonPrimario>
          </form>
        </Drawer>
      )}

      {benQuitar && <ConfirmarModal titulo={`¿Quitar a ${benQuitar.name}?`} texto="Solo sale de tu lista de beneficiarios." confirmar="Quitar" peligro onConfirmar={async () => { await guardarBeneficiarios(beneficiarios.filter(x => x.id !== benQuitar.id)); setBenQuitar(null); }} onCancelar={() => setBenQuitar(null)} />}
      {confirmarSalir && <ConfirmarModal titulo="¿Cerrar sesión?" texto="Para volver a entrar necesitarás tu correo y tu contraseña." confirmar="Cerrar sesión" onConfirmar={() => { setConfirmarSalir(false); onLogout(); }} onCancelar={() => setConfirmarSalir(false)} />}
    </div>
  );
};

// Lista de movimientos, compartida por Inicio y la pestaña Movimientos.
const ListaMovimientos: React.FC<{ movs: any[]; contraparte: (t: any) => string; oculto: boolean; vacioAncho?: boolean }> = ({ movs, contraparte, oculto }) => {
  if (movs.length === 0) return (
    <div style={{ textAlign: 'center', padding: '54px 8px 40px' }}>
      <Clock size={40} color={C.sub} strokeWidth={1.5} style={{ margin: '0 auto 22px' }} />
      <p style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.3px' }}>Todavía no tienes movimientos</p>
      <p style={{ fontSize: 16, color: C.sub, margin: '10px auto 0', lineHeight: 1.5, maxWidth: 560 }}>Cuando una empresa te cargue saldo con tu ID, o envíes o retires plata, aparece aquí con el nombre y la fecha.</p>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginTop: 14 }}>
      {movs.map((t: any) => {
        const entra = ENTRA.has(String(t.type));
        const conv = t.type === 'convert';
        const rech = t.status === 'Rechazado' || t.status === 'Fallido';
        const cur = String(t.currency ?? 'COP').split('_')[0];
        const cp = contraparte(t);
        return (
          <div key={t.id} className="flex items-center" style={{ gap: 14, padding: '14px 0', borderTop: `1px solid ${C.borde}` }}>
            <span style={{ width: 40, height: 40, borderRadius: '50%', background: entra ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.06)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              {conv ? <ArrowLeftRight size={16} color={C.text} /> : entra ? <ArrowDownLeft size={16} color={C.verde} /> : <ArrowUpRight size={16} color={C.text} />}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontSize: 15, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || ROTULO[t.type] || t.type}{cp && !String(t.title ?? '').includes(cp) ? ` · ${cp}` : ''}</p>
              <p style={{ fontSize: 13, color: C.sub, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fecha(t.createdAt)}{t.note ? ` · ${t.note}` : ''}{t.status && t.status !== 'Completado' ? ` · ${t.status}` : ''}</p>
            </div>
            <p style={{ fontSize: 15, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: rech ? C.tenue : entra ? C.verde : C.text, textDecoration: rech ? 'line-through' : 'none' }}>
              {oculto ? '••••' : `${conv ? '' : entra ? '+' : '−'}${fmt(Number(t.amount) || 0, cur)} ${cur}`}
            </p>
          </div>
        );
      })}
    </div>
  );
};
