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
import { ContactsSection, MouvContact } from './ContactsSection';
import { EnviarDineroModal, EnviarHandle, prefillDeContacto } from './EnviarDineroModal';

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

// Los beneficiarios son LOS MISMOS que en Empresas: mismo formulario, misma
// inscripción en el riel, misma verificación de antecedentes (AML). Viven en
// raw_data.mouvContacts / walletContacts y los administra ContactsSection.
type Beneficiario = { id: string; name: string; via: string; contacto: MouvContact };
const viaDe = (c: MouvContact): string => c.accountKind === 'wallet' ? `${c.walletCoin ?? 'USDT'} · ${c.walletNetwork ?? ''}`.trim() : c.destKind === 'breb' ? 'Llave Bre-B' : (c.bank || 'Cuenta bancaria');

type Vista = 'inicio' | 'movimientos' | 'beneficiarios' | 'ayuda';
const RUTA_VISTA: Record<Vista, string> = { inicio: '/portal_personas', movimientos: '/personas_movimientos', beneficiarios: '/personas_beneficiarios', ayuda: '/personas_ayuda' };
const VISTA_RUTA: Record<string, Vista> = Object.fromEntries(Object.entries(RUTA_VISTA).map(([v, p]) => [p, v as Vista]));

type Panel = 'recargar' | 'convertir' | 'seguridad' | 'tasas' | 'limites' | 'notificaciones' | 'invita' | 'ayuda' | 'cobrar' | 'autorizacion' | 'perfil' | null;

// ─── Autorización por una empresa ────────────────────────────────────
// La persona solo puede recibir dinero de UNA empresa registrada que la haya
// autorizado. Pide la autorización con el ID de la empresa, su nombre, su
// documento y una foto sosteniéndolo; la empresa aprueba y le fija el tope
// mensual de retiro. Todo lo escribe el servidor (función `autorizaciones`).
type EstadoAuth = {
  autorizada: { id: string; nombre: string; topeMensual: number | null } | null;
  pendiente: { id: string; nombre: string } | null;
  usadoMes: number;
  datos: { estado?: string; empresaNombre?: string; nombre?: string; docType?: string; docNumber?: string; at?: string } | null;
};
const TIPOS_DOC: Array<[string, string]> = [['CC', 'Cédula de ciudadanía'], ['CE', 'Cédula de extranjería'], ['PAS', 'Pasaporte'], ['PPT', 'Permiso por protección temporal']];
// La foto se reduce en el navegador (lado mayor 1280 px, JPEG) para que pese
// poco y suba rápido; el servidor rechaza más de 2,5 MB.
const comprimirFoto = (file: File): Promise<string> => new Promise((res, rej) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    try {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.82));
    } catch (e) { rej(e); }
  };
  img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen')); };
  img.src = url;
});

// ─── Piezas ──────────────────────────────────────────────────────────
const Tarjeta: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; grande?: boolean }> = ({ children, style, grande }) => (
  <section style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: grande ? RG : R, padding: grande ? 24 : 20, ...style }}>{children}</section>
);
const Rotulo: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '2.5px', color: C.sub, margin: 0, ...style }}>{children}</p>
);
const NARANJA = '#FB923C';
const Pill: React.FC<{ children: React.ReactNode; verde?: boolean; naranja?: boolean; onClick?: () => void }> = ({ children, verde, naranja, onClick }) => (
  <span onClick={onClick} role={onClick ? 'button' : undefined} style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.5px', color: verde ? C.verde : naranja ? NARANJA : C.sub, border: `1px solid ${verde ? 'rgba(74,222,128,0.4)' : naranja ? 'rgba(251,146,60,0.5)' : C.bordeFuerte}`, background: naranja ? 'rgba(251,146,60,0.08)' : 'transparent', borderRadius: 999, padding: '6px 12px', whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default' }}>{children}</span>
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

  // Beneficiarios: la misma lista que administra ContactsSection.
  const beneficiarios: Beneficiario[] = useMemo(() => {
    const raw = cu.raw_data ?? cu;
    const lista: MouvContact[] = [...(Array.isArray(raw?.walletContacts) ? raw.walletContacts : []), ...(Array.isArray(raw?.mouvContacts) ? raw.mouvContacts : [])];
    return lista.filter(c => c && c.id && c.status !== 'rechazada').map(c => ({ id: String(c.id), name: c.name, via: viaDe(c), contacto: c }));
  }, [cu]);

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

  // ── Autorización ───────────────────────────────────────────────────
  const [auth, setAuth] = useState<EstadoAuth | null>(null);
  const cargarEstado = async () => {
    const r = await llamarFuncion('autorizaciones', { action: 'estado' }, 30000);
    if (r?.ok) setAuth({ autorizada: r.autorizada ?? null, pendiente: r.pendiente ?? null, usadoMes: Number(r.usadoMes) || 0, datos: r.datos ?? null });
  };
  useEffect(() => { if (cu.id) cargarEstado(); }, [cu.id]);
  // Mientras la empresa revisa, el estado se refresca solo (sin recargar).
  useEffect(() => {
    if (!auth?.pendiente) return;
    const t = setInterval(cargarEstado, 20000);
    return () => clearInterval(t);
  }, [auth?.pendiente?.id]);
  const autorizada = auth?.autorizada ?? null;
  const pendiente = auth?.pendiente ?? null;
  const estadoTxt = autorizada ? `AUTORIZADA · ${autorizada.nombre.toUpperCase()}` : pendiente ? 'AUTORIZACIÓN EN REVISIÓN' : auth?.datos?.estado === 'rechazada' ? 'SOLICITUD RECHAZADA' : auth?.datos?.estado === 'revocada' ? 'AUTORIZACIÓN RETIRADA' : 'IDENTIFICACIÓN PENDIENTE';

  const [solEmpresa, setSolEmpresa] = useState('');
  const [solNombre, setSolNombre] = useState('');
  const [solDocType, setSolDocType] = useState('CC');
  const [solDocNumber, setSolDocNumber] = useState('');
  const [solFoto, setSolFoto] = useState<string | null>(null);
  const [solOcupado, setSolOcupado] = useState(false);
  const [solError, setSolError] = useState<string | null>(null);
  const [solListo, setSolListo] = useState<string | null>(null);
  const abrirAutorizacion = () => {
    const d = auth?.datos;
    setSolEmpresa(''); setSolNombre(d?.nombre || String(cu.name || cu.fullName || '')); setSolDocType(d?.docType || 'CC'); setSolDocNumber(d?.docNumber || '');
    setSolFoto(null); setSolError(null); setSolListo(null); setPanel('autorizacion');
  };
  const elegirFoto = async (f?: File | null) => {
    if (!f) return;
    setSolError(null);
    try { setSolFoto(await comprimirFoto(f)); } catch { setSolError('No se pudo leer la foto. Intenta con otra.'); }
  };
  const enviarSolicitud = async (e: React.FormEvent) => {
    e.preventDefault();
    if (solOcupado) return;
    setSolError(null);
    const id = solEmpresa.trim().toUpperCase();
    if (id.length < 4) { setSolError('Escribe el ID Lincoin de la empresa.'); return; }
    if (solNombre.trim().length < 5 || !solNombre.trim().includes(' ')) { setSolError('Escribe tu nombre completo, como aparece en el documento.'); return; }
    if (solDocNumber.replace(/[^0-9A-Za-z]/g, '').length < 5) { setSolError('Escribe el número de tu documento.'); return; }
    if (!solFoto) { setSolError('Falta la foto sosteniendo tu documento.'); return; }
    setSolOcupado(true);
    const r = await llamarFuncion('autorizaciones', { action: 'solicitar', codigoEmpresa: id, nombre: solNombre.trim(), docType: solDocType, docNumber: solDocNumber, foto: solFoto }, 90000);
    setSolOcupado(false);
    if (!r?.ok) { setSolError(r?.error ?? 'No se pudo enviar la solicitud. Intenta de nuevo.'); return; }
    setSolListo(String(r.empresa?.nombre ?? id));
    await cargarEstado();
    refreshData().catch(() => {});
  };

  // ── Enviar: el MISMO modal que Empresas (EnviarDineroModal) ─────────
  const enviarRef = useRef<EnviarHandle>(null);
  const totalCop = ['COP', 'COP_BREB', 'COP_ACH'].reduce((t, k) => t + saldo(k), 0);
  const abrirEnviar = (b?: Beneficiario) => {
    if (auth && !autorizada) { avisar(pendiente ? 'Tu empresa todavía no aprueba tu autorización. Cuando lo haga, puedes enviar.' : 'Para enviar dinero primero necesitas la autorización de una empresa registrada en Lincoin.', true); if (!pendiente) abrirAutorizacion(); return; }
    if (!mfaActivo) { avisar('Para enviar dinero activa primero la verificación en dos pasos, en Seguridad.', true); abrirSeguridad(); return; }
    enviarRef.current?.abrir(b ? prefillDeContacto(b.contacto) : undefined);
  };
  const callGasfree = (payload: Record<string, unknown>) => llamarFuncion('gasfree', payload, 90000);

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

  // El tope mensual de retiro lo fija la empresa que autoriza; el consumo
  // del mes lo calcula el servidor (retiros a banco/Bre-B).
  const limiteMensual = autorizada?.topeMensual ?? null;
  const retiradoMes = auth?.usadoMes ?? 0;

  const avatarRef = useRef<HTMLDivElement>(null);
  const funciones: Array<{ icono: React.ElementType; titulo: string; desc: string; abrir: () => void }> = [
    { icono: Link2, titulo: 'Cobrar con link', desc: 'Comparte un link y te pagan en tu billetera', abrir: () => setPanel('cobrar') },
    { icono: TrendingUp, titulo: 'Tasas de cambio', desc: 'COP, BRL, PEN, CLP, MXN en vivo', abrir: () => setPanel('tasas') },
    { icono: FileText, titulo: 'Extractos y certificados', desc: 'PDF mensual y certificado de cuenta', abrir: extracto },
    { icono: BarChart3, titulo: 'Límites', desc: autorizada ? (limiteMensual ? `${fmt(limiteMensual, 'COP')} COP al mes` : 'Sin tope fijado por tu empresa') : 'Los fija la empresa que te autoriza', abrir: () => setPanel('limites') },
    { icono: User, titulo: 'Mi perfil', desc: autorizada ? `Autorizada por ${autorizada.nombre}` : 'Nombre, documento y empresa', abrir: () => setPanel('perfil') },
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
          <div ref={avatarRef} onClick={() => setPanel('perfil')} title="Mi perfil" className="flex items-center persona-sec" style={{ gap: 12, border: `1px solid ${C.bordeFuerte}`, borderRadius: 14, padding: '8px 18px 8px 8px', cursor: 'pointer' }}>
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
            <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
              <Pill verde={!!autorizada} naranja={!autorizada && !pendiente} onClick={() => (autorizada || pendiente ? setPanel('perfil') : abrirAutorizacion())}>{auth ? estadoTxt : kycOk ? 'IDENTIDAD VERIFICADA' : 'IDENTIFICACIÓN PENDIENTE'}</Pill>
            </div>
          </div>

          {/* Aviso: sin empresa que la autorice, la cuenta no puede recibir ni enviar. */}
          {auth && !autorizada && (
            <div className="flex items-center justify-between flex-wrap" style={{ gap: 14, background: 'rgba(251,146,60,0.06)', border: '1px solid rgba(251,146,60,0.35)', borderRadius: R, padding: '16px 20px' }}>
              <div style={{ flex: '1 1 320px' }}>
                <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{pendiente ? `${pendiente.nombre} está revisando tu solicitud` : 'Pide la autorización de tu empresa'}</p>
                <p style={{ fontSize: 14, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>
                  {pendiente ? 'Cuando la apruebe, tu cuenta queda activa y ves aquí tu tope mensual. Esta pantalla se actualiza sola.'
                    : 'Solo puedes recibir dinero de una empresa registrada en Lincoin. Escribe su ID, tu nombre y tu documento, y toma una foto sosteniéndolo.'}
                </p>
              </div>
              {pendiente ? <Pill onClick={() => setPanel('perfil')}>VER DATOS</Pill> : <BotonPrimario onClick={abrirAutorizacion} style={{ padding: '13px 22px' }}>Pedir autorización</BotonPrimario>}
            </div>
          )}

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
                <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Tope de retiro mensual</p>
                <p style={{ fontSize: 15, color: C.sub, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{autorizada ? (limiteMensual ? `${fmt(retiradoMes, 'COP')} / ${fmt(limiteMensual, 'COP')}` : `${fmt(retiradoMes, 'COP')} · sin tope`) : '—'}</p>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', marginTop: 20, overflow: 'hidden' }}>
                <div style={{ width: `${autorizada && limiteMensual ? Math.min(100, Math.max(1.5, (retiradoMes / limiteMensual) * 100)) : 0}%`, height: '100%', background: retiradoMes >= (limiteMensual ?? Infinity) ? NARANJA : C.verde, borderRadius: 999 }} />
              </div>
              <p style={{ fontSize: 14, color: C.sub, margin: '18px 0 0', lineHeight: 1.5 }}>{autorizada ? `Lo fija ${autorizada.nombre}.` : 'Lo fija la empresa que te autorice.'}</p>
            </Tarjeta>
            <Tarjeta>
              <div className="flex items-center justify-between" style={{ gap: 14 }}>
                <div>
                  <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Cuenta para retiros</p>
                  <p style={{ fontSize: 14, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>{beneficiarios.length ? `${beneficiarios.length} beneficiario(s) inscrito(s)` : 'Aún no agregas una cuenta bancaria o llave Bre-B'}</p>
                </div>
                <BotonSecundario onClick={() => setVista('beneficiarios')} style={{ padding: '13px 22px' }}>Agregar</BotonSecundario>
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
              <button onClick={() => setVista('beneficiarios')} className="persona-ben" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: FONT, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minWidth: 90 }}>
                <span className="persona-ben-av" style={{ width: 50, height: 50, borderRadius: '50%', border: `1px dashed ${C.medio}`, display: 'grid', placeItems: 'center', color: C.text }}><Plus size={18} /></span>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Nuevo</span>
              </button>
              {beneficiarios.slice(0, 8).map(b => (
                <button key={b.id} onClick={() => abrirEnviar(b)} className="persona-ben" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: FONT, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minWidth: 90 }}>
                  <span className="persona-ben-av" style={{ width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.bordeFuerte}`, display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 800, color: C.text }}>{iniciales(b.name)}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.text, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                  <span style={{ fontSize: 12, color: C.sub, marginTop: -6, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.via}</span>
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

        {/* Beneficiarios: la MISMA sección que Empresas — inscripción, AML y
            verificación idénticas. Enviar desde ahí abre el panel con el
            beneficiario cargado. */}
        {vista === 'beneficiarios' && (
          <ContactsSection
            vista="beneficiarios"
            onBack={() => setVista('inicio')}
            onSendTo={(c: MouvContact) => abrirEnviar({ id: String(c.id), name: c.name, via: viaDe(c), contacto: c })}
          />
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
                ['¿Puedo retirar a mi banco?', 'Sí: inscribe tu cuenta o tu llave Bre-B en Beneficiarios, espera la validación, y envíale desde Enviar → A banco o Bre-B.'],
                ['¿Quién fija mi tope de retiro?', 'La empresa que te autoriza. Si necesitas uno más alto, pídeselo: ella lo cambia desde su panel y aquí se actualiza solo.'],
                ['¿Puedo cambiar de empresa?', 'Sí. En Mi perfil escribes el ID de la nueva empresa y mandas tus datos; cuando ella apruebe, reemplaza a la anterior. Nunca te quedas sin empresa por el camino.'],
              ].map(([q, a]) => (
                <div key={q} style={{ padding: '14px 0', borderTop: `1px solid ${C.borde}` }}><p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{q}</p><p style={{ fontSize: 14, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>{a}</p></div>
              ))}
            </div>
          </Tarjeta>
        )}
      </main>

      {/* ── Paneles laterales ── */}
      <EnviarDineroModal
        ref={enviarRef}
        showToast={(msg, _ms, tipo) => avisar(msg, tipo === 'error')}
        mfaEnrolled={mfaActivo}
        displayBalance={(code) => (code === 'COP' || code === 'COP_BREB' || code === 'COP_ACH') ? totalCop : saldo(code)}
        callGasfree={callGasfree}
        refreshGasfreeBal={() => refreshData()}
        movements={movs}
        onIrA={(v) => { if (v === 'settings') abrirSeguridad(); }}
        saldoUnificado
      />

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
        <Drawer titulo="Límites" sub="Lo que puedes retirar al mes a banco o Bre-B." onCerrar={() => setPanel(null)}>
          <div style={{ background: autorizada ? 'rgba(74,222,128,0.06)' : 'rgba(251,146,60,0.06)', border: `1px solid ${autorizada ? 'rgba(74,222,128,0.3)' : 'rgba(251,146,60,0.35)'}`, borderRadius: 12, padding: '16px' }}>
            <div className="flex items-center justify-between" style={{ gap: 10 }}><p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Tope mensual</p>{autorizada ? <Pill verde>ACTIVO</Pill> : <Pill naranja>PENDIENTE</Pill>}</div>
            <p style={{ fontSize: 22, fontWeight: 800, margin: '10px 0 0', fontVariantNumeric: 'tabular-nums' }}>{autorizada ? (limiteMensual ? `${fmt(limiteMensual, 'COP')} COP` : 'Sin tope') : '—'}</p>
            {autorizada && <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0' }}>Usado este mes: <b style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmt(retiradoMes, 'COP')} COP</b>{limiteMensual ? ` · te quedan ${fmt(Math.max(0, limiteMensual - retiradoMes), 'COP')}` : ''}</p>}
          </div>
          <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.55, margin: '16px 0 0' }}>
            {autorizada ? `El tope lo fija ${autorizada.nombre}, la empresa que te autoriza. Si necesitas uno más alto, pídeselo directamente: ella lo cambia desde su panel y aquí se actualiza solo.`
              : 'El tope lo fija la empresa que te autorice. Mientras no tengas una empresa, no puedes recibir ni retirar dinero.'}
          </p>
          <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.55, margin: '10px 0 0' }}>El tope cuenta los retiros a banco y Bre-B del mes calendario. Enviar a otra persona Lincoin y convertir entre billeteras no lo consumen.</p>
          {!autorizada && !pendiente && <BotonPrimario onClick={abrirAutorizacion} style={{ marginTop: 16, width: '100%' }}>Pedir autorización</BotonPrimario>}
        </Drawer>
      )}

      {panel === 'perfil' && (
        <Drawer titulo="Mi perfil" sub="Tus datos y la empresa que te autoriza." onCerrar={() => setPanel(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {([['Nombre', auth?.datos?.nombre || nombre], ['Correo', String(cu.email ?? '')], ['ID Lincoin', codigo], ['Documento', auth?.datos?.docType ? `${TIPOS_DOC.find(t => t[0] === auth?.datos?.docType)?.[1] ?? auth?.datos?.docType} ${auth?.datos?.docNumber ?? ''}` : 'Sin registrar']] as const).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between" style={{ gap: 12, padding: '13px 0', borderBottom: `1px solid ${C.borde}` }}>
                <span style={{ fontSize: 13.5, color: C.sub }}>{k}</span>
                <span style={{ fontSize: 14, fontWeight: 700, textAlign: 'right', fontFamily: k === 'ID Lincoin' ? MONO : FONT, letterSpacing: k === 'ID Lincoin' ? '2px' : 0 }}>{v}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 22 }}>
            <Etiqueta>EMPRESA QUE TE AUTORIZA</Etiqueta>
            <div style={{ background: autorizada ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${autorizada ? 'rgba(74,222,128,0.3)' : C.borde}`, borderRadius: 12, padding: '14px 16px' }}>
              {autorizada ? (<>
                <div className="flex items-center justify-between" style={{ gap: 10 }}><p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{autorizada.nombre}</p><Pill verde>AUTORIZADA</Pill></div>
                <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0' }}>Tope mensual: <b style={{ color: C.text }}>{limiteMensual ? `${fmt(limiteMensual, 'COP')} COP` : 'sin tope'}</b> · usado {fmt(retiradoMes, 'COP')}</p>
                {auth?.datos?.at && <p style={{ fontSize: 12.5, color: C.tenue, margin: '4px 0 0' }}>Desde {fecha(auth.datos.at)}</p>}
              </>) : pendiente ? (<>
                <div className="flex items-center justify-between" style={{ gap: 10 }}><p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{pendiente.nombre}</p><Pill>EN REVISIÓN</Pill></div>
                <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>La empresa está revisando tu nombre, tu documento y tu foto. Cuando apruebe, aquí aparece tu tope.</p>
              </>) : (<>
                <div className="flex items-center justify-between" style={{ gap: 10 }}><p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Ninguna todavía</p><Pill naranja>PENDIENTE</Pill></div>
                <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>{auth?.datos?.estado === 'rechazada' ? `${auth.datos.empresaNombre ?? 'La empresa'} rechazó tu solicitud. Revisa tus datos y vuelve a pedirla.` : auth?.datos?.estado === 'revocada' ? `${auth.datos.empresaNombre ?? 'La empresa'} retiró tu autorización. Puedes pedirla a otra empresa.` : 'Solo puedes recibir dinero de una empresa registrada que te haya autorizado.'}</p>
              </>)}
            </div>
            {pendiente && autorizada && <p style={{ fontSize: 12.5, color: C.sub, margin: '10px 0 0', lineHeight: 1.5 }}>También pediste autorización a <b style={{ color: C.text }}>{pendiente.nombre}</b>. Cuando apruebe, reemplaza a {autorizada.nombre}.</p>}
          </div>

          <div style={{ marginTop: 22 }}>
            {autorizada ? (<>
              <BotonSecundario onClick={abrirAutorizacion} style={{ width: '100%' }}>Cambiar de empresa</BotonSecundario>
              <p style={{ fontSize: 12.5, color: C.tenue, margin: '10px 0 0', lineHeight: 1.55 }}>Para operar con otra empresa escribes su ID y la nueva empresa te aprueba; en ese momento reemplaza a {autorizada.nombre}. No puedes quitar tu empresa actual sin haber puesto la nueva: nunca te quedas sin empresa por el camino.</p>
            </>) : (
              <BotonPrimario onClick={abrirAutorizacion} style={{ width: '100%' }}>{pendiente ? 'Pedir a otra empresa' : 'Pedir autorización'}</BotonPrimario>
            )}
          </div>

          <div className="flex items-center justify-between" style={{ gap: 12, marginTop: 22, paddingTop: 16, borderTop: `1px solid ${C.borde}` }}>
            <div><p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Verificación en dos pasos</p><p style={{ fontSize: 12.5, color: C.sub, margin: '2px 0 0' }}>{mfaActivo ? 'Activa' : 'Sin activar'}</p></div>
            {mfaActivo ? <Pill verde>ACTIVA</Pill> : <BotonSecundario onClick={abrirSeguridad} style={{ padding: '10px 16px', fontSize: 13 }}>Activar</BotonSecundario>}
          </div>
        </Drawer>
      )}

      {panel === 'autorizacion' && (
        <Drawer titulo={autorizada ? 'Cambiar de empresa' : 'Pedir autorización'} sub={autorizada ? `Hoy te autoriza ${autorizada.nombre}. La nueva empresa la reemplaza cuando apruebe.` : 'La empresa revisa tus datos y tu foto, y te aprueba con un tope mensual.'} onCerrar={() => setPanel(null)}>
          {solListo ? (
            <div style={{ textAlign: 'center', padding: '30px 0' }}>
              <span style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(74,222,128,0.12)', display: 'grid', placeItems: 'center', margin: '0 auto' }}><Check size={28} color={C.verde} /></span>
              <p style={{ fontSize: 20, fontWeight: 800, margin: '18px 0 0' }}>Solicitud enviada</p>
              <p style={{ fontSize: 14, color: C.sub, margin: '8px 0 0', lineHeight: 1.5 }}>{solListo} ya la tiene. Cuando la apruebe, tu cuenta se actualiza sola; no hace falta recargar.</p>
              <BotonPrimario onClick={() => setPanel(null)} style={{ marginTop: 24 }}>Listo</BotonPrimario>
            </div>
          ) : (
            <form onSubmit={enviarSolicitud} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <Etiqueta>ID LINCOIN DE LA EMPRESA</Etiqueta>
                <Campo value={solEmpresa} onChange={e => setSolEmpresa(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} placeholder="Ej. A1B2C3" autoFocus style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, letterSpacing: '3px' }} />
                <p style={{ fontSize: 12.5, color: C.tenue, margin: '6px 0 0' }}>La empresa lo copia desde su panel, en "Personas autorizadas".</p>
              </div>
              <div>
                <Etiqueta>TU NOMBRE COMPLETO</Etiqueta>
                <Campo value={solNombre} onChange={e => setSolNombre(e.target.value.slice(0, 120))} placeholder="Como aparece en tu documento" autoComplete="name" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10 }}>
                <div>
                  <Etiqueta>DOCUMENTO</Etiqueta>
                  <select value={solDocType} onChange={e => setSolDocType(e.target.value)} style={{ fontFamily: FONT, width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.bordeFuerte}`, color: C.text, borderRadius: 11, padding: '12px 12px', fontSize: 14, fontWeight: 700 }}>
                    {TIPOS_DOC.map(([k, n]) => <option key={k} value={k} style={{ color: '#000' }}>{k} · {n}</option>)}
                  </select>
                </div>
                <div>
                  <Etiqueta>NÚMERO</Etiqueta>
                  <Campo value={solDocNumber} onChange={e => setSolDocNumber(e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 30))} inputMode="numeric" placeholder="Sin puntos" />
                </div>
              </div>
              <div>
                <Etiqueta>FOTO SOSTENIENDO TU DOCUMENTO</Etiqueta>
                <label className="persona-sec" style={{ display: 'block', border: `1px dashed ${C.bordeFuerte}`, borderRadius: 12, padding: solFoto ? 8 : '22px 16px', textAlign: 'center', cursor: 'pointer', background: 'rgba(255,255,255,0.03)' }}>
                  <input type="file" accept="image/*" capture="user" onChange={e => elegirFoto(e.target.files?.[0])} style={{ display: 'none' }} />
                  {solFoto ? <img src={solFoto} alt="Tu foto sosteniendo el documento" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, display: 'block', margin: '0 auto' }} /> : (<>
                    <User size={26} color={C.sub} strokeWidth={1.6} style={{ margin: '0 auto' }} />
                    <p style={{ fontSize: 14, fontWeight: 700, margin: '10px 0 0' }}>Tomar o subir la foto</p>
                    <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>Tu cara y el documento al frente, con buena luz. Que se lea el nombre y el número.</p>
                  </>)}
                </label>
                {solFoto && <button type="button" onClick={() => setSolFoto(null)} style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: C.sub, background: 'transparent', border: 'none', padding: 0, marginTop: 8, cursor: 'pointer' }}>Tomar otra</button>}
              </div>
              {solError && <p style={{ fontSize: 13.5, color: NARANJA, margin: 0, lineHeight: 1.5 }}>{solError}</p>}
              <BotonPrimario type="submit" disabled={solOcupado}>{solOcupado ? 'Enviando…' : 'Enviar solicitud'}</BotonPrimario>
              <p style={{ fontSize: 12, color: C.tenue, margin: 0, lineHeight: 1.5 }}>Tu foto solo la ve la empresa a la que le pides autorización.</p>
            </form>
          )}
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
