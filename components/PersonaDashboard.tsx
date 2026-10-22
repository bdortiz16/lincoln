// ══════════════════════════════════════════════════════════════════
//  Portal Operadores — lincoin.me/portal_personas
//
//  Un operador es el cliente de una empresa registrada en Lincoin (modelo
//  PSP), persona natural o empresa. Su empresa lo acepta, el equipo de
//  cumplimiento de Lincoin lo aprueba con un tope mensual, y la empresa le
//  carga saldo por su ID Lincoin. Es una billetera digital en pesos: el
//  operador ve su saldo, deposita por PSE y envía.
//
//  Un solo saldo en pesos (COP), sin billeteras ni conversiones. Enviar es
//  el MISMO flujo de Empresas (EnviarDineroModal): monto, método, beneficiario
//  inscrito y confirmación. Lo único propio es que los tres saldos en pesos
//  se leen como uno, porque el servidor (mouv-proxy) cubre el riel del envío
//  desde el saldo en pesos. El servidor también aplica la autorización de la
//  empresa y el tope mensual.
//
//  Las llaves propias para recibir y la tarjeta todavía no se muestran:
//  nada que parezca que funciona y no.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy, Check, Eye, EyeOff, Bell, ArrowUpRight, Plus, ArrowLeftRight, Clock, ArrowDownLeft, X, Link2, FileText, BarChart3,
  Shield, Gift, MessageSquare, Search, ChevronRight, ChevronLeft, Download, User,
  Users, House, CircleHelp, Wallet, Loader2, LogOut,
} from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';
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
const NARANJA = '#FB923C';
const NEGRO_LINCOIN = 'linear-gradient(135deg, #121413 0%, #0C0E0D 60%, #0A0B0A 100%)';

// ─── Formato ─────────────────────────────────────────────────────────
const fmt = (v: number) => `$ ${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;
const montoMov = (v: number, cur: string) => cur === 'COP' ? fmt(v) : `${(Number(v) || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${cur}`;
const numero = (s: string) => Number(String(s).replace(/\D/g, '')) || 0;
const fecha = (ts: any) => { const d = new Date(ts ?? 0); return isNaN(d.getTime()) ? '' : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const hora = (ts: any) => { const d = new Date(ts ?? 0); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }); };
const diaDe = (ts: any) => {
  const d = new Date(ts ?? 0);
  if (isNaN(d.getTime())) return '';
  const hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) return 'Hoy';
  if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', ...(d.getFullYear() !== hoy.getFullYear() ? { year: 'numeric' as const } : {}) });
};
const iniciales = (n: string) => n.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || 'L';
const nombrePropio = (n: string) => n.trim().toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());

const ROTULO: Record<string, string> = {
  pay_received: 'Saldo recibido', pay_sent: 'Envío a persona Lincoin', load: 'Depósito', send: 'Envío',
  dispersion: 'Envío', convert: 'Conversión', adjustment: 'Ajuste de saldo', referral_payout: 'Bono de referido', receive: 'Recibido',
};
const ENTRA = new Set(['pay_received', 'load', 'adjustment', 'referral_payout', 'receive']);

// "movimientos" es la vista de la cuenta (saldo, acciones y movimientos):
// la ruta se conserva para no romper enlaces guardados.
type Vista = 'inicio' | 'movimientos' | 'beneficiarios' | 'ayuda';
const RUTA_VISTA: Record<Vista, string> = { inicio: '/portal_personas', movimientos: '/personas_movimientos', beneficiarios: '/personas_beneficiarios', ayuda: '/personas_ayuda' };
const VISTA_RUTA: Record<string, Vista> = Object.fromEntries(Object.entries(RUTA_VISTA).map(([v, p]) => [p, v as Vista]));

type Panel = 'recargar' | 'recibir' | 'seguridad' | 'limites' | 'notificaciones' | 'invita' | 'cobrar' | 'autorizacion' | 'perfil' | null;

// ─── Autorización: la empresa acepta, Cumplimiento aprueba ───────────
// El operador (cliente de una empresa registrada en Lincoin, persona o
// empresa) solo puede recibir dinero cuando su empresa lo ACEPTÓ y el equipo
// de cumplimiento de Lincoin revisó sus documentos, le fijó el tope mensual
// y lo APROBÓ. Todo lo escribe el servidor (función `autorizaciones`).
type TipoOperador = 'persona' | 'empresa';
type EstadoAuth = {
  autorizada: { id: string; nombre: string; topeMensual: number | null } | null;
  // etapa: 'empresa' = la empresa aún no lo acepta; 'cumplimiento' = ya lo
  // aceptó y falta la revisión de Cumplimiento.
  pendiente: { id: string; nombre: string; etapa?: 'empresa' | 'cumplimiento' } | null;
  usadoMes: number;
  datos: { estado?: string; empresaNombre?: string; nombre?: string; docType?: string; docNumber?: string; tipoOperador?: TipoOperador; representante?: { nombre?: string; docType?: string; docNumber?: string }; motivo?: string | null; por?: string; at?: string } | null;
};
const TIPOS_DOC: Array<[string, string]> = [['CC', 'Cédula de ciudadanía'], ['CE', 'Cédula de extranjería'], ['PAS', 'Pasaporte'], ['PPT', 'Permiso por protección temporal']];
// El titular de una llave puede ser una empresa.
const TIPOS_DOC_TITULAR: Array<[string, string]> = [['CC', 'Cédula'], ['CE', 'Cédula de extranjería'], ['NIT', 'NIT (empresa)'], ['PAS', 'Pasaporte'], ['PPT', 'PPT']];
// La foto se reduce en el navegador (JPEG) para que pese poco y suba rápido;
// el servidor rechaza más de 2,5 MB la foto y 5 MB cada documento. Un
// documento con letra pequeña (RUT, declaración) se deja más grande.
const comprimirFoto = (file: File, lado = 1280): Promise<string> => new Promise((res, rej) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    try {
      const k = Math.min(1, lado / Math.max(img.width, img.height));
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
const leerBase64 = (file: File): Promise<string> => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result ?? ''));
  r.onerror = () => rej(new Error('No se pudo leer el archivo'));
  r.readAsDataURL(file);
});

// ─── Expediente para la autorización ─────────────────────────────────
// Lo mismo que valida el servidor (función `autorizaciones`).
type TipoAdjunto = 'doc_frente' | 'doc_reverso' | 'rut' | 'camara_comercio' | 'declaracion_renta';
const MIME_ADJUNTO = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const NOMBRE_DOC: Record<string, string> = { CC: 'Cédula', CE: 'Cédula de extranjería', PAS: 'Pasaporte', PPT: 'PPT' };
const FUENTES_FONDOS: Record<TipoOperador, Array<[string, string]>> = {
  persona: [
    ['salario', 'Salario'], ['honorarios', 'Honorarios o prestación de servicios'], ['negocio', 'Ventas de mi negocio'],
    ['pension', 'Pensión'], ['inversiones', 'Rentas o inversiones'], ['familia', 'Ayuda de familiares o remesas'], ['otro', 'Otro'],
  ],
  empresa: [
    ['negocio', 'Ventas o servicios de la empresa'], ['aportes', 'Aportes de socios'], ['financiacion', 'Préstamos o financiación'],
    ['inversiones', 'Rentas o inversiones'], ['otro', 'Otro'],
  ],
};
const tipoGuardado = (): TipoOperador | null => { try { const v = localStorage.getItem('lincoin_tipo_operador'); return v === 'empresa' || v === 'persona' ? v : null; } catch { return null; } };
// Prepara un adjunto para subirlo: las fotos se reducen (JPEG) y los PDF
// van tal cual. Una foto que el navegador no sabe abrir (HEIC) va tal cual.
const prepararAdjunto = async (f: File): Promise<{ base64: string; mime: string; nombre: string }> => {
  if (f.type.startsWith('image/')) {
    try { return { base64: await comprimirFoto(f, 2000), mime: 'image/jpeg', nombre: f.name.replace(/\.\w+$/, '') + '.jpg' }; } catch { /* va tal cual */ }
  }
  return { base64: await leerBase64(f), mime: f.type, nombre: f.name };
};

// Un documento para adjuntar: foto o PDF, con vista previa y "cambiar".
const Adjunto: React.FC<{ titulo: string; ayuda?: string; archivo?: File; onElegir: (f: File | null) => void; apagado?: boolean }> = ({ titulo, ayuda, archivo, onElegir, apagado }) => {
  const vista = useMemo(() => (archivo && archivo.type.startsWith('image/') ? URL.createObjectURL(archivo) : null), [archivo]);
  useEffect(() => () => { if (vista) URL.revokeObjectURL(vista); }, [vista]);
  const kb = archivo ? archivo.size / 1024 : 0;
  return (
    <label className="persona-sec" style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px ${archivo ? 'solid' : 'dashed'} ${archivo ? 'rgba(74,222,128,0.35)' : C.bordeFuerte}`, borderRadius: 12, padding: '11px 12px', cursor: apagado ? 'default' : 'pointer', background: 'rgba(255,255,255,0.03)', opacity: apagado ? 0.45 : 1, minWidth: 0 }}>
      <input type="file" accept="image/*,application/pdf" disabled={apagado} onChange={e => { onElegir(e.target.files?.[0] ?? null); e.target.value = ''; }} style={{ display: 'none' }} />
      <span style={{ width: 40, height: 40, borderRadius: 9, background: 'rgba(255,255,255,0.06)', display: 'grid', placeItems: 'center', flexShrink: 0, overflow: 'hidden' }}>
        {vista ? <img src={vista} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : archivo ? <FileText size={18} color={C.verde} /> : <Plus size={18} color={C.sub} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: C.text }}>{titulo}</span>
        <span style={{ display: 'block', fontSize: 12, color: archivo ? C.verde : C.sub, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {archivo ? `${archivo.name} · ${kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`}` : (ayuda ?? 'Foto o PDF')}
        </span>
      </span>
      {archivo && !apagado && <span style={{ fontSize: 12, fontWeight: 700, color: C.sub, flexShrink: 0 }}>Cambiar</span>}
    </label>
  );
};
const Casilla: React.FC<{ marcada: boolean; onCambiar: (v: boolean) => void; children: React.ReactNode }> = ({ marcada, onCambiar, children }) => (
  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13, color: C.medio, lineHeight: 1.45 }}>
    <input type="checkbox" checked={marcada} onChange={e => onCambiar(e.target.checked)} style={{ width: 17, height: 17, marginTop: 1, accentColor: C.verde, flexShrink: 0 }} />
    <span>{children}</span>
  </label>
);

// ─── Piezas ──────────────────────────────────────────────────────────
const Tarjeta: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <section style={{ background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: R, padding: 20, ...style }}>{children}</section>
);
const Rotulo: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '2.5px', color: C.sub, margin: 0, ...style }}>{children}</p>
);
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
const Selector: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ style, children, ...p }) => (
  <select {...p} style={{ fontFamily: FONT, width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.bordeFuerte}`, color: C.text, borderRadius: 11, padding: '12px 12px', fontSize: 14, fontWeight: 700, ...style }}>{children}</select>
);

const Drawer: React.FC<{ titulo: string; sub?: string; onCerrar: () => void; onAtras?: () => void; children: React.ReactNode }> = ({ titulo, sub, onCerrar, onAtras, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCerrar]);
  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'flex-end' }}>
      <aside onClick={e => e.stopPropagation()} className="persona-drawer" style={{ width: 440, maxWidth: '100%', height: '100%', background: C.tarjeta, borderLeft: `1px solid ${C.borde}`, padding: '24px 24px 32px', overflowY: 'auto', fontFamily: FONT }}>
        <div className="flex items-start justify-between" style={{ gap: 12 }}>
          <div className="flex items-start" style={{ gap: 10, minWidth: 0 }}>
            {onAtras && <button onClick={onAtras} aria-label="Atrás" style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${C.bordeFuerte}`, background: 'transparent', color: C.sub, cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}><ChevronLeft size={16} /></button>}
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: C.text, margin: 0 }}>{titulo}</h2>
              {sub && <p style={{ fontSize: 13, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>{sub}</p>}
            </div>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${C.bordeFuerte}`, background: 'transparent', color: C.sub, cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}><X size={16} /></button>
        </div>
        <div style={{ marginTop: 22 }}>{children}</div>
      </aside>
    </div>
  );
};

// Botón redondo de acción (Depositar, Enviar…).
const Accion: React.FC<{ icono: React.ElementType; txt: string; onClick: () => void; principal?: boolean }> = ({ icono: I, txt, onClick, principal }) => (
  <button onClick={onClick} className="persona-acc" style={{ fontFamily: FONT, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minWidth: 64, flex: '1 0 64px', color: C.text, position: 'relative', padding: '4px 0' }}>
    <span className={principal ? 'lincoin-btn-white' : 'persona-acc-c'} style={{ width: 58, height: 58, borderRadius: '50%', background: principal ? undefined : 'rgba(255,255,255,0.06)', border: principal ? 'none' : `1px solid ${C.bordeFuerte}`, display: 'grid', placeItems: 'center' }}><I size={22} strokeWidth={1.9} /></span>
    <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'center', lineHeight: 1.25, color: C.text }}>{txt}</span>
  </button>
);

// Fila de lista (Detalles de mi cuenta, Beneficiarios…).
const Fila: React.FC<{ icono: React.ElementType; titulo: string; sub?: string; derecha?: React.ReactNode; onClick?: () => void; primera?: boolean }> = ({ icono: I, titulo, sub, derecha, onClick, primera }) => (
  <button onClick={onClick} className="persona-fila" style={{ fontFamily: FONT, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderTop: primera ? 'none' : `1px solid ${C.borde}`, padding: '15px 4px', cursor: onClick ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 14, color: C.text }}>
    <span style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,0.05)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><I size={18} strokeWidth={1.8} /></span>
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{titulo}</span>
      {sub && <span style={{ display: 'block', fontSize: 13, color: C.sub, marginTop: 2, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
    </span>
    {derecha ?? (onClick ? <ChevronRight size={18} color={C.sub} /> : null)}
  </button>
);

// ─── Portal ──────────────────────────────────────────────────────────
export const PersonaDashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const { currentUser, transactions, refreshData, enrollMFA, verifyMFAEnrollment, updateUserRawData, markNotificationsRead } = useDatabase();
  const cu: any = currentUser ?? {};

  const codigo: string = String(cu.ownReferralCode || String(cu.id ?? '').slice(-6)).toUpperCase();
  const nombre = nombrePropio(String(cu.name || cu.fullName || cu.email?.split('@')[0] || 'Tu cuenta'));
  const kycOk = String(cu.kycStatus ?? '') === 'approved';
  const mfaActivo = !!cu.mfaEnabled;
  const saldo = (code: string) => Number(cu.balances?.[code] ?? 0) || 0;
  // Un solo saldo en pesos: el riel de cada envío lo cubre el servidor.
  const totalCop = ['COP', 'COP_BREB', 'COP_ACH'].reduce((t, k) => t + saldo(k), 0);
  const [oculto, setOculto] = useState(() => { try { return localStorage.getItem('lincoin.personas.oculto') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('lincoin.personas.oculto', oculto ? '1' : '0'); } catch { /* */ } }, [oculto]);
  const enmascarar = (s: string) => (oculto ? '$ ••••' : s);

  // Vista y dirección
  const [vista, setVista] = useState<Vista>(() => { try { return VISTA_RUTA[window.location.pathname] ?? 'inicio'; } catch { return 'inicio'; } });
  useEffect(() => {
    try { const p = RUTA_VISTA[vista]; if (window.location.pathname !== p) window.history.pushState({ vista }, '', p); } catch { /* */ }
    try { window.scrollTo(0, 0); } catch { /* */ }
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

  // Beneficiarios (destinos en pesos): la misma lista que administra ContactsSection.
  const contactosRaw: MouvContact[] = useMemo(() => (
    Array.isArray(cu?.raw_data?.mouvContacts) ? cu.raw_data.mouvContacts : Array.isArray(cu?.mouvContacts) ? cu.mouvContacts : []
  ), [cu]);
  const contactos: MouvContact[] = useMemo(() => contactosRaw
    .filter(c => c && c.id && c.status !== 'rechazada' && c.accountKind !== 'wallet' && (c.country ?? 'Colombia') === 'Colombia')
    .sort((a, b) => (Date.parse(String(b.createdAt ?? '')) || 0) - (Date.parse(String(a.createdAt ?? '')) || 0)), [contactosRaw]);

  // Movimientos
  const movs = useMemo(() => (transactions ?? [])
    .filter((t: any) => t.userId === cu.id)
    .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()), [transactions, cu.id]);
  const contraparte = (t: any) => t.counterpartyName ?? t.senderName ?? t.recipientName ?? t.beneficiaryName ?? '';
  const [busca, setBusca] = useState('');
  const movsFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return movs;
    const qd = q.replace(/\D/g, '');
    return movs.filter((t: any) => `${t.title ?? ''} ${ROTULO[t.type] ?? ''} ${contraparte(t)} ${t.note ?? ''} ${t.status ?? ''}`.toLowerCase().includes(q)
      || (qd.length >= 3 && String(Math.round(Number(t.amount) || 0)).includes(qd)));
  }, [movs, busca]);
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
  const enCumplimiento = pendiente?.etapa === 'cumplimiento';
  const estadoTxt = autorizada ? `AUTORIZADA · ${autorizada.nombre.toUpperCase()}` : enCumplimiento ? 'EN REVISIÓN DE CUMPLIMIENTO' : pendiente ? 'ESPERANDO A TU EMPRESA' : auth?.datos?.estado === 'rechazada' ? 'SOLICITUD RECHAZADA' : auth?.datos?.estado === 'revocada' ? 'AUTORIZACIÓN RETIRADA' : 'IDENTIFICACIÓN PENDIENTE';
  // Persona natural o empresa: lo eligió al registrarse (o al pedir la
  // autorización, si entró con Google).
  const tipoCuenta: TipoOperador = (auth?.datos?.tipoOperador ?? cu.raw_data?.tipoOperador ?? cu.tipoOperador ?? tipoGuardado() ?? 'persona') === 'empresa' ? 'empresa' : 'persona';
  const nombreCorto = tipoCuenta === 'empresa' ? nombre : nombre.split(' ')[0];

  const [solTipo, setSolTipo] = useState<TipoOperador>('persona');
  const esEmpresa = solTipo === 'empresa';
  const [solEmpresa, setSolEmpresa] = useState('');
  const [solNombre, setSolNombre] = useState('');
  const [solDocType, setSolDocType] = useState('CC');
  const [solDocNumber, setSolDocNumber] = useState('');
  // Empresa: el representante legal (su documento y su foto).
  const [solRepNombre, setSolRepNombre] = useState('');
  const [solRepDocType, setSolRepDocType] = useState('CC');
  const [solRepDocNumber, setSolRepDocNumber] = useState('');
  const [solFoto, setSolFoto] = useState<string | null>(null);
  const [solOcupado, setSolOcupado] = useState(false);
  const [solError, setSolError] = useState<string | null>(null);
  const [solListo, setSolListo] = useState<string | null>(null);
  const [solArchivos, setSolArchivos] = useState<Partial<Record<TipoAdjunto, File>>>({});
  const [solFuente, setSolFuente] = useState('');
  const [solDetalle, setSolDetalle] = useState('');
  const [solLicito, setSolLicito] = useState(false);
  const [solProgreso, setSolProgreso] = useState<string | null>(null);
  // El documento que va por las dos caras: el del operador o, si es una
  // empresa, el de su representante legal.
  const docVisible = esEmpresa ? solRepDocType : solDocType;
  const docNombre = NOMBRE_DOC[docVisible] ?? 'Documento';
  const esPasaporte = docVisible === 'PAS';
  const abrirAutorizacion = () => {
    const d = auth?.datos;
    const t: TipoOperador = d?.tipoOperador ?? tipoCuenta;
    setSolTipo(t);
    setSolEmpresa(''); setSolNombre(d?.nombre || (t === 'empresa' ? String(cu.companyName || cu.name || '') : String(cu.name || cu.fullName || '').replace(/^Usuario Nuevo$/, '')));
    setSolDocType(t === 'empresa' ? 'CC' : (d?.docType && d.docType !== 'NIT' ? d.docType : 'CC')); setSolDocNumber(d?.docNumber || '');
    setSolRepNombre(d?.representante?.nombre || ''); setSolRepDocType(d?.representante?.docType || 'CC'); setSolRepDocNumber(d?.representante?.docNumber || '');
    setSolFoto(null); setSolError(null); setSolListo(null);
    setSolArchivos({}); setSolFuente(''); setSolDetalle(''); setSolLicito(false); setSolProgreso(null);
    setPanel('autorizacion');
  };
  const elegirAdjunto = (t: TipoAdjunto, f: File | null) => {
    setSolError(null);
    if (f && !MIME_ADJUNTO.includes(f.type) && !f.type.startsWith('image/')) { setSolError('Adjunta una foto o un PDF.'); return; }
    if (f && f.type === 'application/pdf' && f.size > 5 * 1024 * 1024) { setSolError('Cada PDF puede pesar hasta 5 MB.'); return; }
    setSolArchivos(a => { const n = { ...a }; if (f) n[t] = f; else delete n[t]; return n; });
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
    if (esEmpresa) {
      if (solNombre.trim().length < 3) { setSolError('Escribe la razón social, como aparece en la cámara de comercio.'); return; }
      if (solDocNumber.replace(/\D/g, '').length < 9) { setSolError('Escribe el NIT completo, con el dígito de verificación.'); return; }
      if (solRepNombre.trim().length < 5 || !solRepNombre.trim().includes(' ')) { setSolError('Escribe el nombre completo del representante legal.'); return; }
      if (solRepDocNumber.replace(/[^0-9A-Za-z]/g, '').length < 5) { setSolError('Escribe el documento del representante legal.'); return; }
    } else {
      if (solNombre.trim().length < 5 || !solNombre.trim().includes(' ')) { setSolError('Escribe tu nombre completo, como aparece en el documento.'); return; }
      if (solDocNumber.replace(/[^0-9A-Za-z]/g, '').length < 5) { setSolError('Escribe el número de tu documento.'); return; }
    }
    if (!solFoto) { setSolError(esEmpresa ? 'Falta la foto del representante legal sosteniendo su documento.' : 'Falta la foto sosteniendo tu documento.'); return; }
    // Todos obligatorios: el documento por las dos caras (el del representante
    // legal, si es empresa), RUT, cámara de comercio y declaración de renta.
    const pedidos: Array<[TipoAdjunto, string]> = [
      ['doc_frente', `${docNombre}: ${esPasaporte ? 'la página de la foto' : 'el frente'}`],
      ['doc_reverso', `${docNombre}: ${esPasaporte ? 'la página de la firma' : 'el reverso'}`],
      ['rut', 'el RUT'], ['camara_comercio', 'la cámara de comercio'], ['declaracion_renta', 'la declaración de renta'],
    ];
    const faltan = pedidos.filter(([t]) => !solArchivos[t]).map(([, n]) => n);
    if (faltan.length) { setSolError(`Falta adjuntar ${faltan.join(', ')}.`); return; }
    if (!solFuente) { setSolError('Cuéntanos de dónde vienen los fondos.'); return; }
    if (solFuente === 'otro' && solDetalle.trim().length < 5) { setSolError('Describe de dónde vienen los fondos.'); return; }
    if (!solLicito) { setSolError('Falta la declaración de que los fondos vienen de actividades lícitas.'); return; }
    setSolOcupado(true);
    try {
      // Uno por uno: cada documento puede pesar hasta 5 MB.
      const documentos: { tipo: TipoAdjunto; path: string; nombre: string }[] = [];
      const enviar = pedidos.map(([t]) => t);
      for (const [i, t] of enviar.entries()) {
        const f = solArchivos[t]!;
        setSolProgreso(`Subiendo documentos (${i + 1} de ${enviar.length})…`);
        const a = await prepararAdjunto(f);
        if (a.base64.length > 7_000_000) { setSolError(`${f.name} pesa más de 5 MB. Adjunta uno más liviano.`); return; }
        const u = await llamarFuncion('autorizaciones', { action: 'subir_doc', tipo: t, nombre: a.nombre, mime: a.mime, base64: a.base64 }, 90000);
        if (!u?.ok) { setSolError(u?.error ?? `No se pudo subir ${f.name}. Intenta de nuevo.`); return; }
        documentos.push({ tipo: t, path: String(u.path), nombre: String(u.nombre ?? f.name) });
      }
      setSolProgreso('Enviando la solicitud…');
      const r = await llamarFuncion('autorizaciones', {
        action: 'solicitar', codigoEmpresa: id, tipoOperador: solTipo, nombre: solNombre.trim(),
        docType: esEmpresa ? 'NIT' : solDocType, docNumber: solDocNumber, foto: solFoto,
        ...(esEmpresa ? { representante: { nombre: solRepNombre.trim(), docType: solRepDocType, docNumber: solRepDocNumber } } : {}),
        documentos, origenFondos: { fuente: solFuente, detalle: solDetalle.trim(), declaraLicitud: solLicito },
      }, 90000);
      if (!r?.ok) { setSolError(r?.error ?? 'No se pudo enviar la solicitud. Intenta de nuevo.'); return; }
      setSolListo(String(r.empresa?.nombre ?? id));
      await cargarEstado();
      refreshData().catch(() => {});
    } catch {
      setSolError('No se pudo leer uno de los archivos. Intenta con otro.');
    } finally {
      setSolOcupado(false); setSolProgreso(null);
    }
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

  // ── Enviar: el MISMO modal que Empresas (EnviarDineroModal) ─────────
  const enviarRef = useRef<EnviarHandle>(null);
  const puedeEnviar = (): boolean => {
    if (auth && !autorizada) { avisar(pendiente ? 'Tu empresa todavía no aprueba tu autorización. Cuando lo haga, puedes enviar.' : 'Para enviar dinero primero necesitas la autorización de una empresa registrada en Lincoin.', true); if (!pendiente) abrirAutorizacion(); return false; }
    if (!mfaActivo) { avisar('Para enviar dinero activa primero la verificación en dos pasos, en Seguridad.', true); abrirSeguridad(); return false; }
    return true;
  };
  const abrirEnviar = () => { if (puedeEnviar()) enviarRef.current?.abrir(); };
  // Operadores envían solo por Bre-B (Cuenta 2) o a otro usuario Lincoin.
  const METODOS_OPERADOR = ['breb2', 'pay'] as const;
  // Desde Beneficiarios: abre Enviar con el beneficiario cargado, igual que
  // en Empresas, ya por Bre-B. Solo falta el monto. A una cuenta de banco
  // no se envía desde aquí.
  const enviarAContacto = (c: MouvContact) => {
    if (c.destKind !== 'breb') { avisar('Desde tu cuenta los envíos salen por Bre-B. Inscribe la llave Bre-B de esta persona para enviarle.', true); return; }
    setVista('inicio');
    enviarRef.current?.abrir({ ...prefillDeContacto(c), metodo: 'breb2', rail: 'COP_ACH' });
  };
  const callGasfree = (payload: Record<string, unknown>) => llamarFuncion('gasfree', payload, 90000);
  const cerrarPanel = () => setPanel(null);

  // ── Depositar (PSE) ────────────────────────────────────────────────
  const [recMonto, setRecMonto] = useState('');
  const [recOcupado, setRecOcupado] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [recLink, setRecLink] = useState<string | null>(null);
  const abrirDeposito = (p: 'recargar' | 'cobrar') => { setRecMonto(''); setRecError(null); setRecLink(null); setPanel(p); };
  const irAPse = async (e: React.FormEvent) => {
    e.preventDefault(); setRecError(null); setRecLink(null);
    const m = numero(recMonto);
    if (m < 20000) { setRecError('El mínimo es $ 20.000 COP.'); return; }
    setRecOcupado(true);
    const r = await llamarFuncion('finity-proxy', { action: 'create_payment_link', user_id: cu.id, copAmount: m }, 60000);
    setRecOcupado(false);
    if (r?.ok && r?.link) { setRecLink(String(r.link)); if (panel === 'recargar') { try { window.open(String(r.link), '_blank', 'noopener'); } catch { /* */ } } refreshData().catch(() => {}); }
    else setRecError(r?.message || r?.error || 'No se pudo abrir PSE. Intenta de nuevo.');
  };

  // ── Notificaciones (preferencias) ──────────────────────────────────
  const prefs = { correo: true, whatsapp: false, alertas: true, ...(cu.raw_data?.prefsNotificaciones ?? cu.prefsNotificaciones ?? {}) };
  const togglePref = (k: keyof typeof prefs) => updateUserRawData(cu.id, { prefsNotificaciones: { ...prefs, [k]: !prefs[k] } });

  // El tope mensual lo fija el equipo de cumplimiento al aprobar; el consumo
  // del mes lo calcula el servidor (envíos a banco y Bre-B).
  const limiteMensual = autorizada?.topeMensual ?? null;
  const retiradoMes = auth?.usadoMes ?? 0;
  const topeTxt = autorizada ? (limiteMensual ? `${fmt(retiradoMes)} de ${fmt(limiteMensual)} este mes` : `${fmt(retiradoMes)} este mes · sin tope`) : 'Lo fija Cumplimiento al aprobar tu cuenta';

  const tab = (v: Vista, txt: string) => (
    <button key={v} onClick={() => setVista(v)} style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, color: vista === v ? C.text : C.medio, background: vista === v ? 'rgba(255,255,255,0.07)' : 'transparent', border: 'none', borderRadius: 10, padding: '9px 16px', cursor: 'pointer' }}>{txt}</button>
  );
  const iconoBtn: React.CSSProperties = { width: 44, height: 44, borderRadius: 12, border: `1px solid ${C.bordeFuerte}`, background: 'transparent', color: C.text, cursor: 'pointer', display: 'grid', placeItems: 'center', position: 'relative', flexShrink: 0 };

  // Saldo + acciones: la tarjeta de la cuenta, en Inicio y en Cuenta.
  const acciones = (
    <div className="flex persona-acciones" style={{ gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
      <Accion icono={Plus} txt="Depositar" onClick={() => abrirDeposito('recargar')} />
      <Accion icono={ArrowUpRight} txt="Enviar" onClick={abrirEnviar} principal />
      <Accion icono={ArrowDownLeft} txt="Recibir" onClick={() => setPanel('recibir')} />
      <Accion icono={FileText} txt="Extracto" onClick={extracto} />
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.fondo, color: C.text, fontFamily: FONT }}>
      <style>{`
        .persona-sec:hover, .persona-func:hover { border-color: rgba(74,222,128,0.5) !important; }
        .persona-acc:hover .persona-acc-c { border-color: rgba(74,222,128,0.5) !important; }
        .persona-fila:hover { background: rgba(255,255,255,0.02) !important; }
        .persona-acciones::-webkit-scrollbar { display: none; }
        @media (max-width: 860px) {
          .persona-tabs { display: none !important; }
          .persona-bottom { display: flex !important; }
          .persona-main { padding-bottom: 104px !important; }
        }
        @media (max-width: 560px) {
          .persona-drawer { width: 100% !important; }
          .persona-main { padding: 18px 16px 104px !important; }
          .persona-head { padding: 0 16px !important; }
          .persona-rotulo, .persona-nombre, .persona-salir { display: none !important; }
        }
      `}</style>

      {/* Barra superior */}
      <header className="persona-head" style={{ position: 'sticky', top: 0, zIndex: 40, background: 'rgba(7,8,8,0.92)', backdropFilter: 'blur(8px)', borderBottom: `1px solid ${C.borde}`, padding: '0 28px', height: 72, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div className="flex items-center" style={{ gap: 24, minWidth: 0 }}>
          <button onClick={() => setVista('inicio')} className="flex items-center" style={{ gap: 14, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: C.text, fontFamily: FONT }}>
            <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.7px', lineHeight: 1 }}>Lincoin<span style={{ color: C.verde }}>.</span></span>
            <span className="persona-rotulo"><Rotulo>OPERADORES</Rotulo></span>
          </button>
          <nav className="persona-tabs flex items-center" style={{ gap: 2 }}>
            {tab('inicio', 'Inicio')}{tab('movimientos', 'Cuenta')}{tab('beneficiarios', 'Beneficiarios')}{tab('ayuda', 'Ayuda')}
          </nav>
        </div>
        <div className="flex items-center" style={{ gap: 8 }}>
          <button onClick={() => setOculto(v => !v)} aria-label={oculto ? 'Mostrar saldo' : 'Ocultar saldo'} title={oculto ? 'Mostrar saldo' : 'Ocultar saldo'} style={iconoBtn}>{oculto ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => { setNotifAbierto(v => !v); if (hayNuevas) markNotificationsRead(); }} aria-label="Notificaciones" style={iconoBtn}>
              <Bell size={18} />
              {hayNuevas && <span style={{ position: 'absolute', top: 11, right: 12, width: 8, height: 8, borderRadius: '50%', background: C.verde }} />}
            </button>
            {notifAbierto && (
              <div onMouseLeave={() => setNotifAbierto(false)} style={{ position: 'absolute', right: 0, top: 52, width: 'min(320px, calc(100vw - 32px))', background: C.tarjeta, border: `1px solid ${C.bordeFuerte}`, borderRadius: R, padding: 14, zIndex: 50 }}>
                <div className="flex items-center justify-between"><Rotulo>NOTIFICACIONES</Rotulo><button onClick={() => setNotifAbierto(false)} aria-label="Cerrar" style={{ background: 'transparent', border: 'none', color: C.sub, cursor: 'pointer' }}><X size={14} /></button></div>
                {notifs.length === 0 ? <p style={{ fontSize: 13, color: C.tenue, margin: '10px 0 0' }}>Nada nuevo por ahora.</p> : notifs.slice(0, 8).map((n: any, i: number) => (
                  <div key={i} style={{ padding: '10px 0', borderTop: i ? `1px solid ${C.borde}` : 'none' }}>
                    <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{n.title ?? n.titulo ?? 'Aviso'}</p>
                    <p style={{ fontSize: 12, color: C.sub, margin: '2px 0 0' }}>{n.message ?? n.body ?? n.mensaje ?? ''}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setPanel('perfil')} title="Detalles de mi cuenta" className="flex items-center persona-sec" style={{ gap: 10, border: `1px solid ${C.bordeFuerte}`, borderRadius: 12, padding: '5px 14px 5px 5px', cursor: 'pointer', background: 'transparent', color: C.text, fontFamily: FONT, height: 44 }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,0.08)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800 }}>{iniciales(nombre)}</span>
            <span className="persona-nombre" style={{ fontSize: 15, fontWeight: 700, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombreCorto}</span>
          </button>
          <button className="persona-salir" onClick={() => setConfirmarSalir(true)} style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.text, background: 'transparent', border: `1px solid ${C.bordeFuerte}`, borderRadius: 12, padding: '0 18px', height: 44, cursor: 'pointer' }}>Salir</button>
        </div>
      </header>

      <main className="persona-main" style={{ maxWidth: vista === 'beneficiarios' ? 1080 : 680, margin: '0 auto', padding: '28px 24px 48px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {aviso && <div style={{ fontSize: 13.5, fontWeight: 600, color: aviso.mal ? C.text : C.verde, background: 'rgba(255,255,255,0.04)', border: `1px solid ${aviso.mal ? C.bordeFuerte : 'rgba(74,222,128,0.35)'}`, borderRadius: 12, padding: '12px 16px' }}>{aviso.txt}</div>}

        {vista === 'inicio' && (<>
          {/* Saludo */}
          <div className="flex items-end justify-between flex-wrap" style={{ gap: 12 }}>
            <div>
              <p style={{ fontSize: 15, color: C.sub, margin: 0 }}>Hola,</p>
              <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.6px', margin: '2px 0 0' }}>{nombreCorto}</h1>
            </div>
            <Pill verde={!!autorizada} naranja={!autorizada && !pendiente} onClick={() => (autorizada || pendiente ? setPanel('perfil') : abrirAutorizacion())}>{auth ? estadoTxt : kycOk ? 'IDENTIDAD VERIFICADA' : 'IDENTIFICACIÓN PENDIENTE'}</Pill>
          </div>

          {/* Sin empresa que la autorice, la cuenta no puede recibir ni enviar. */}
          {auth && !autorizada && (
            <div className="flex items-center justify-between flex-wrap" style={{ gap: 14, background: 'rgba(251,146,60,0.06)', border: '1px solid rgba(251,146,60,0.35)', borderRadius: R, padding: '16px 18px' }}>
              <div style={{ flex: '1 1 260px' }}>
                <p style={{ fontSize: 15.5, fontWeight: 700, margin: 0 }}>{enCumplimiento ? `${pendiente!.nombre} te aceptó: falta Cumplimiento` : pendiente ? `${pendiente.nombre} está revisando tu solicitud` : auth?.datos?.estado === 'rechazada' ? 'Tu solicitud no fue aprobada' : 'Pide la autorización de tu empresa'}</p>
                <p style={{ fontSize: 13.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>
                  {enCumplimiento ? 'El equipo de cumplimiento de Lincoin está revisando tus documentos. Cuando te apruebe, tu cuenta queda activa y ves aquí tu tope mensual. Esta pantalla se actualiza sola.'
                    : pendiente ? 'Cuando te acepte como su cliente, el equipo de cumplimiento de Lincoin revisa tus documentos. Esta pantalla se actualiza sola.'
                    : auth?.datos?.estado === 'rechazada' && auth.datos.motivo ? `Motivo: ${auth.datos.motivo} Corrige lo que haga falta y vuelve a pedirla.`
                    : 'Solo puedes recibir dinero de una empresa registrada en Lincoin de la que seas cliente. Escribe su ID, adjunta tus documentos y cuéntanos de dónde vienen tus fondos.'}
                </p>
              </div>
              {pendiente ? <Pill onClick={() => setPanel('perfil')}>VER DATOS</Pill> : <BotonPrimario onClick={abrirAutorizacion} style={{ padding: '12px 20px' }}>Pedir autorización</BotonPrimario>}
            </div>
          )}

          {/* Cuenta Lincoin */}
          <button onClick={() => setVista('movimientos')} style={{ fontFamily: FONT, textAlign: 'left', width: '100%', cursor: 'pointer', color: C.text, background: NEGRO_LINCOIN, border: `1px solid ${C.borde}`, borderRadius: RG, padding: '22px 22px 24px', position: 'relative', overflow: 'hidden' }}>
            <span style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 88% 8%, rgba(74,222,128,0.14), transparent 45%)', pointerEvents: 'none' }} />
            <span className="flex items-center justify-between" style={{ position: 'relative' }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>Cuenta Lincoin</span>
              <ChevronRight size={20} color={C.sub} />
            </span>
            <span style={{ display: 'block', fontSize: 13.5, color: C.sub, marginTop: 16, position: 'relative' }}>Saldo disponible</span>
            <span style={{ display: 'block', fontSize: 40, fontWeight: 800, letterSpacing: '-1.4px', marginTop: 6, fontVariantNumeric: 'tabular-nums', lineHeight: 1.05, position: 'relative' }}>
              {enmascarar(fmt(totalCop))} <span style={{ fontSize: 18, color: C.sub, fontWeight: 700, letterSpacing: 0 }}>COP</span>
            </span>
          </button>

          {acciones}

          {/* Tu cuenta */}
          <Tarjeta style={{ padding: '6px 16px' }}>
            <Fila primera icono={User} titulo="Detalles de mi cuenta" sub={`ID Lincoin ${codigo}${autorizada ? ` · ${autorizada.nombre}` : ''}`} onClick={() => setPanel('perfil')} />
            <Fila icono={Users} titulo="Beneficiarios" sub={contactos.length ? `${contactos.length} guardado(s)` : 'Llaves Bre-B de a quién le envías'} onClick={() => setVista('beneficiarios')} />
            <Fila icono={BarChart3} titulo="Tope mensual" sub={topeTxt} onClick={() => setPanel('limites')} />
            <Fila icono={Shield} titulo="Seguridad" sub={mfaActivo ? 'Verificación en dos pasos activa' : 'Activa la verificación en dos pasos'} onClick={abrirSeguridad} derecha={mfaActivo ? <Pill verde>ACTIVA</Pill> : undefined} />
          </Tarjeta>

          {/* Movimientos recientes */}
          <Tarjeta>
            <div className="flex items-center justify-between" style={{ gap: 10 }}>
              <Rotulo>MOVIMIENTOS</Rotulo>
              {movs.length > 0 && <button onClick={() => setVista('movimientos')} style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: C.verde, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>Ver todos →</button>}
            </div>
            <ListaMovimientos movs={movs.slice(0, 5)} contraparte={contraparte} oculto={oculto} />
          </Tarjeta>

          {/* Más */}
          <Tarjeta style={{ padding: '6px 16px' }}>
            <Fila primera icono={Link2} titulo="Cobrar con link" sub="Un enlace de pago por PSE para que te paguen" onClick={() => abrirDeposito('cobrar')} />
            <Fila icono={Gift} titulo="Invita y gana" sub="Tu ID es también tu código de invitación" onClick={() => setPanel('invita')} />
            <Fila icono={Bell} titulo="Notificaciones" sub="Correo, WhatsApp y alertas" onClick={() => setPanel('notificaciones')} />
            <Fila icono={MessageSquare} titulo="Ayuda y soporte" sub="Escríbenos y una persona te responde" onClick={() => setVista('ayuda')} />
          </Tarjeta>
        </>)}

        {/* Cuenta: saldo, acciones y todos los movimientos con buscador. */}
        {vista === 'movimientos' && (<>
          <div className="flex items-center" style={{ gap: 12 }}>
            <button onClick={() => setVista('inicio')} aria-label="Volver" style={{ ...iconoBtn, width: 40, height: 40 }}><ChevronLeft size={18} /></button>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', margin: 0 }}>Cuenta Lincoin</h1>
          </div>
          <div>
            <p style={{ fontSize: 13.5, color: C.sub, margin: 0 }}>Saldo disponible</p>
            <p style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-1.4px', margin: '6px 0 0', fontVariantNumeric: 'tabular-nums', lineHeight: 1.05 }}>{enmascarar(fmt(totalCop))} <span style={{ fontSize: 18, color: C.sub, fontWeight: 700, letterSpacing: 0 }}>COP</span></p>
          </div>
          {acciones}
          <Tarjeta style={{ padding: '6px 16px' }}>
            <Fila primera icono={Wallet} titulo="Datos de la cuenta" sub={`ID Lincoin ${codigo} · pesos colombianos`} onClick={() => setPanel('perfil')} />
          </Tarjeta>
          <Tarjeta>
            <div className="flex items-center justify-between" style={{ gap: 10 }}>
              <Rotulo>MOVIMIENTOS</Rotulo>
              <button onClick={extracto} className="persona-sec" style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: C.text, background: 'transparent', border: `1px solid ${C.bordeFuerte}`, borderRadius: 10, padding: '8px 12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Download size={14} /> Extracto</button>
            </div>
            {movs.length > 0 && (
              <div style={{ position: 'relative', marginTop: 14 }}>
                <Search size={15} color={C.sub} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
                <Campo value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nombre, tipo o monto" style={{ paddingLeft: 36 }} />
              </div>
            )}
            {busca && movsFiltrados.length === 0
              ? <p style={{ fontSize: 14, color: C.sub, margin: '18px 0 4px', textAlign: 'center' }}>Sin movimientos para «{busca}».</p>
              : <ListaMovimientos movs={movsFiltrados} contraparte={contraparte} oculto={oculto} agrupar />}
          </Tarjeta>
        </>)}

        {/* Beneficiarios: la MISMA sección que Empresas — inscripción, AML y
            verificación idénticas. Enviar desde ahí pasa por la verificación
            y abre el monto con el beneficiario cargado. */}
        {vista === 'beneficiarios' && (
          <ContactsSection
            vista="beneficiarios"
            onBack={() => setVista('inicio')}
            onSendTo={(c: MouvContact) => { if (puedeEnviar()) enviarAContacto(c); }}
          />
        )}

        {vista === 'ayuda' && (
          <Tarjeta>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', margin: 0 }}>Ayuda y soporte</h1>
            <p style={{ fontSize: 14, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>Escríbenos y una persona del equipo te responde.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 20 }}>
              <button onClick={() => { try { (window as any).$crisp?.push(['do', 'chat:open']); } catch { /* */ } if (!(window as any).$crisp) window.open('mailto:soporte@lincoin.me', '_blank'); }} className="persona-func" style={{ fontFamily: FONT, textAlign: 'left', background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.borde}`, borderRadius: R, padding: '16px 18px', cursor: 'pointer', color: C.text }}>
                <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Chat con nuestro equipo</p><p style={{ fontSize: 13.5, color: C.sub, margin: '4px 0 0' }}>Abre el chat de soporte</p>
              </button>
              <a href="mailto:soporte@lincoin.me" className="persona-func" style={{ fontFamily: FONT, textDecoration: 'none', background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.borde}`, borderRadius: R, padding: '16px 18px', color: C.text, display: 'block' }}>
                <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Correo</p><p style={{ fontSize: 13.5, color: C.sub, margin: '4px 0 0' }}>soporte@lincoin.me</p>
              </a>
            </div>
            <div style={{ marginTop: 24 }}>
              <Rotulo>PREGUNTAS FRECUENTES</Rotulo>
              {[
                ['¿Cómo recibo dinero?', 'Copia tu ID Lincoin (en Recibir) y dáselo a la empresa o a la persona Lincoin que te va a enviar. Te llega al instante y sin comisión. También puedes depositar desde tu banco por PSE.'],
                ['¿Cómo envío a otro banco?', 'Primero inscribe a la persona en Beneficiarios con su llave Bre-B. Después toca Enviar, escribe el monto y elige Bre-B: llega en segundos a cualquier banco.'],
                ['¿Por qué no puedo enviarle a alguien que acabo de inscribir?', 'Cuando inscribes a alguien revisamos que el envío sea seguro. Suele tardar cerca de un minuto; cuando termina ya le puedes enviar.'],
                ['¿Quién aprueba mi cuenta y fija mi tope?', 'Tu empresa te acepta como su cliente, y el equipo de cumplimiento de Lincoin revisa tus documentos, aprueba tu cuenta y fija tu tope mensual. Si necesitas uno más alto, escríbenos a soporte.'],
                ['¿Puedo cambiar de empresa?', 'Sí. En Detalles de mi cuenta escribes el ID de la nueva empresa y mandas tus datos; cuando ella apruebe, reemplaza a la anterior. Nunca te quedas sin empresa por el camino.'],
              ].map(([q, a]) => (
                <div key={q} style={{ padding: '14px 0', borderTop: `1px solid ${C.borde}` }}><p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{q}</p><p style={{ fontSize: 14, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>{a}</p></div>
              ))}
            </div>
          </Tarjeta>
        )}
      </main>

      {/* Navegación inferior en celular */}
      <nav className="persona-bottom" style={{ display: 'none', position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 45, background: 'rgba(12,14,13,0.97)', borderTop: `1px solid ${C.borde}`, padding: '8px 6px calc(8px + env(safe-area-inset-bottom))', justifyContent: 'space-around', alignItems: 'center' }}>
        {([['inicio', 'Inicio', House], ['movimientos', 'Cuenta', Wallet], [null, 'Enviar', ArrowUpRight], ['beneficiarios', 'Beneficiarios', Users], ['ayuda', 'Ayuda', CircleHelp]] as const).map(([v, txt, I]) => {
          const activo = v !== null && vista === v;
          return (
            <button key={txt} onClick={() => (v === null ? abrirEnviar() : setVista(v))} style={{ fontFamily: FONT, flex: 1, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: activo ? C.text : C.sub, padding: '4px 0' }}>
              {v === null
                ? <span className="lincoin-btn-white" style={{ width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center' }}><I size={18} /></span>
                : <I size={20} strokeWidth={activo ? 2.2 : 1.8} />}
              <span style={{ fontSize: 11, fontWeight: activo ? 700 : 600 }}>{txt}</span>
            </button>
          );
        })}
      </nav>

      {/* ── Paneles laterales ── */}
      <EnviarDineroModal
        ref={enviarRef}
        showToast={(msg, _ms, tipo) => avisar(msg, tipo === 'error')}
        mfaEnrolled={mfaActivo}
        displayBalance={(code) => (code === 'COP' || code === 'COP_BREB' || code === 'COP_ACH') ? totalCop : saldo(code)}
        callGasfree={callGasfree}
        refreshGasfreeBal={() => refreshData()}
        movements={movs}
        onIrA={(v) => {
          if (v === 'settings') abrirSeguridad();
          else if (v === 'contactos' || v === 'beneficiarios') setVista('beneficiarios');
          else if (v === 'movimientos' || v === 'history') setVista('movimientos');
        }}
        onVerMovimiento={() => setVista('movimientos')}
        saldoUnificado
        metodos={METODOS_OPERADOR}
      />

      {panel === 'recibir' && (
        <Drawer titulo="Recibir" sub="Comparte tu ID Lincoin para que te envíen." onCerrar={cerrarPanel}>
          <div style={{ background: NEGRO_LINCOIN, border: `1px solid ${C.borde}`, borderRadius: R, padding: '22px 18px', textAlign: 'center' }}>
            <Rotulo>MI ID LINCOIN</Rotulo>
            <p style={{ fontFamily: MONO, fontSize: 34, fontWeight: 700, letterSpacing: '5px', margin: '12px 0 0', lineHeight: 1 }}>{codigo}</p>
            <BotonPrimario onClick={copiar} style={{ marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 8 }}>{copiado ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar ID</>}</BotonPrimario>
          </div>
          <p style={{ fontSize: 14, color: C.medio, margin: '16px 0 0', lineHeight: 1.55 }}>Dáselo a la empresa que te carga saldo o a otra persona Lincoin. Te llega al instante y sin comisión.</p>
          <div style={{ marginTop: 18, borderTop: `1px solid ${C.borde}` }}>
            <Fila primera icono={Link2} titulo="Cobrar con un link de PSE" sub="Para que te pague alguien desde su banco" onClick={() => abrirDeposito('cobrar')} />
          </div>
        </Drawer>
      )}

      {panel === 'recargar' && (
        <Drawer titulo="Depositar" sub="Desde tu banco, por PSE. Mínimo $ 20.000." onCerrar={cerrarPanel}>
          <form onSubmit={irAPse} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <Etiqueta>MONTO EN PESOS</Etiqueta>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: C.sub, fontWeight: 700 }}>$</span>
                <Campo value={recMonto ? numero(recMonto).toLocaleString('es-CO') : ''} onChange={e => setRecMonto(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="0" autoFocus style={{ paddingLeft: 30, fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }} />
              </div>
              <p style={{ fontSize: 13, color: C.tenue, margin: '8px 0 0' }}>Pagas desde tu banco en PSE y el saldo te queda al confirmarse.</p>
            </div>
            {recError && <p style={{ fontSize: 13.5, color: C.medio, margin: 0, lineHeight: 1.5 }}>{recError}</p>}
            {recLink && <p style={{ fontSize: 13.5, color: C.verde, margin: 0, lineHeight: 1.5 }}>Se abrió PSE en otra pestaña. Si no la ves, <a href={recLink} target="_blank" rel="noreferrer" style={{ color: C.verde, textDecoration: 'underline' }}>ábrela aquí</a>.</p>}
            <BotonPrimario type="submit" disabled={recOcupado}>{recOcupado ? 'Preparando…' : 'Ir a PSE'}</BotonPrimario>
          </form>
        </Drawer>
      )}

      {panel === 'cobrar' && (
        <Drawer titulo="Cobrar con link" sub="Un enlace de pago por PSE que te acredita en tu cuenta." onCerrar={cerrarPanel}>
          <form onSubmit={irAPse} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <Etiqueta>MONTO A COBRAR EN PESOS</Etiqueta>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: C.sub, fontWeight: 700 }}>$</span>
                <Campo value={recMonto ? numero(recMonto).toLocaleString('es-CO') : ''} onChange={e => setRecMonto(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="0" autoFocus style={{ paddingLeft: 30, fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }} />
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

      {panel === 'seguridad' && (
        <Drawer titulo="Seguridad" sub="Verificación en dos pasos con tu app de autenticación." onCerrar={cerrarPanel}>
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

      {panel === 'limites' && (
        <Drawer titulo="Tope mensual" sub="Lo que puedes enviar al mes a otros bancos." onCerrar={cerrarPanel}>
          <div style={{ background: autorizada ? 'rgba(74,222,128,0.06)' : 'rgba(251,146,60,0.06)', border: `1px solid ${autorizada ? 'rgba(74,222,128,0.3)' : 'rgba(251,146,60,0.35)'}`, borderRadius: 12, padding: '16px' }}>
            <div className="flex items-center justify-between" style={{ gap: 10 }}><p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Tope mensual</p>{autorizada ? <Pill verde>ACTIVO</Pill> : <Pill naranja>PENDIENTE</Pill>}</div>
            <p style={{ fontSize: 22, fontWeight: 800, margin: '10px 0 0', fontVariantNumeric: 'tabular-nums' }}>{autorizada ? (limiteMensual ? `${fmt(limiteMensual)} COP` : 'Sin tope') : '—'}</p>
            {autorizada && (<>
              <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0' }}>Usado este mes: <b style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmt(retiradoMes)} COP</b>{limiteMensual ? ` · te quedan ${fmt(Math.max(0, limiteMensual - retiradoMes))}` : ''}</p>
              {limiteMensual ? (
                <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', marginTop: 14, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, Math.max(1.5, (retiradoMes / limiteMensual) * 100))}%`, height: '100%', background: retiradoMes >= limiteMensual ? NARANJA : C.verde, borderRadius: 999 }} />
                </div>
              ) : null}
            </>)}
          </div>
          <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.55, margin: '16px 0 0' }}>
            {autorizada ? 'El tope lo fija el equipo de cumplimiento de Lincoin al aprobar tu cuenta. Si necesitas uno más alto, escríbenos a soporte y lo revisamos.'
              : 'El tope lo fija el equipo de cumplimiento de Lincoin cuando aprueba tu cuenta. Mientras no estés aprobado, no puedes recibir ni enviar dinero.'}
          </p>
          <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.55, margin: '10px 0 0' }}>Cuentan los envíos a llaves Bre-B y a cuentas de banco del mes calendario. Enviar a otra persona Lincoin no lo consume.</p>
          {!autorizada && !pendiente && <BotonPrimario onClick={abrirAutorizacion} style={{ marginTop: 16, width: '100%' }}>Pedir autorización</BotonPrimario>}
        </Drawer>
      )}

      {panel === 'perfil' && (
        <Drawer titulo="Detalles de mi cuenta" sub="Tus datos, tu ID Lincoin y la empresa de la que eres cliente." onCerrar={cerrarPanel}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {([
              [tipoCuenta === 'empresa' ? 'Razón social' : 'Nombre', auth?.datos?.nombre || nombre],
              ['Tipo de operador', tipoCuenta === 'empresa' ? 'Empresa' : 'Persona natural'],
              ['Correo', String(cu.email ?? '')], ['ID Lincoin', codigo], ['Cuenta', 'Lincoin · pesos colombianos (COP)'],
              ['Documento', auth?.datos?.docType ? `${TIPOS_DOC.find(t => t[0] === auth?.datos?.docType)?.[1] ?? auth?.datos?.docType} ${auth?.datos?.docNumber ?? ''}` : 'Sin registrar'],
              ...(auth?.datos?.representante?.nombre ? [['Representante legal', auth.datos.representante.nombre]] : []),
            ] as Array<[string, string]>).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between" style={{ gap: 12, padding: '13px 0', borderBottom: `1px solid ${C.borde}` }}>
                <span style={{ fontSize: 13.5, color: C.sub }}>{k}</span>
                <span className="flex items-center" style={{ gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, textAlign: 'right', fontFamily: k === 'ID Lincoin' ? MONO : FONT, letterSpacing: k === 'ID Lincoin' ? '2px' : 0 }}>{v}</span>
                  {k === 'ID Lincoin' && <button onClick={copiar} aria-label="Copiar ID" style={{ background: 'transparent', border: 'none', color: copiado ? C.verde : C.sub, cursor: 'pointer', padding: 2 }}>{copiado ? <Check size={15} /> : <Copy size={15} />}</button>}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 22 }}>
            <Etiqueta>EMPRESA DE LA QUE ERES CLIENTE</Etiqueta>
            <div style={{ background: autorizada ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${autorizada ? 'rgba(74,222,128,0.3)' : C.borde}`, borderRadius: 12, padding: '14px 16px' }}>
              {autorizada ? (<>
                <div className="flex items-center justify-between" style={{ gap: 10 }}><p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{autorizada.nombre}</p><Pill verde>AUTORIZADA</Pill></div>
                <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0' }}>Tope mensual: <b style={{ color: C.text }}>{limiteMensual ? `${fmt(limiteMensual)} COP` : 'sin tope'}</b> · usado {fmt(retiradoMes)}</p>
                {auth?.datos?.at && <p style={{ fontSize: 12.5, color: C.tenue, margin: '4px 0 0' }}>Desde {fecha(auth.datos.at)}</p>}
              </>) : pendiente ? (<>
                <div className="flex items-center justify-between" style={{ gap: 10 }}><p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{pendiente.nombre}</p><Pill>{enCumplimiento ? 'EN CUMPLIMIENTO' : 'EN REVISIÓN'}</Pill></div>
                <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>{enCumplimiento ? 'Te aceptó como su cliente. El equipo de cumplimiento de Lincoin revisa tus documentos; cuando te apruebe, aquí aparece tu tope.' : 'La empresa está revisando tu solicitud. Después la revisa el equipo de cumplimiento de Lincoin.'}</p>
              </>) : (<>
                <div className="flex items-center justify-between" style={{ gap: 10 }}><p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Ninguna todavía</p><Pill naranja>PENDIENTE</Pill></div>
                <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>{auth?.datos?.estado === 'rechazada' ? (auth.datos.por === 'cumplimiento' ? `El equipo de cumplimiento de Lincoin no aprobó tu cuenta${auth.datos.motivo ? `: ${auth.datos.motivo}` : '.'} Corrige lo que haga falta y vuelve a pedirla.` : `${auth.datos.empresaNombre ?? 'La empresa'} no te aceptó como cliente. Revisa tus datos y vuelve a pedirla.`) : auth?.datos?.estado === 'revocada' ? (auth.datos.por === 'cumplimiento' ? `El equipo de cumplimiento de Lincoin retiró tu autorización${auth.datos.motivo ? `: ${auth.datos.motivo}` : '.'}` : `${auth.datos.empresaNombre ?? 'La empresa'} dejó de operar contigo. Puedes pedir autorización a otra empresa.`) : 'Solo puedes recibir dinero de una empresa registrada de la que seas cliente, cuando Cumplimiento te apruebe.'}</p>
              </>)}
            </div>
            {pendiente && autorizada && <p style={{ fontSize: 12.5, color: C.sub, margin: '10px 0 0', lineHeight: 1.5 }}>También pediste autorización a <b style={{ color: C.text }}>{pendiente.nombre}</b>. Cuando Cumplimiento te apruebe con ella, reemplaza a {autorizada.nombre}.</p>}
          </div>

          <div style={{ marginTop: 22 }}>
            {autorizada ? (<>
              <BotonSecundario onClick={abrirAutorizacion} style={{ width: '100%' }}>Cambiar de empresa</BotonSecundario>
              <p style={{ fontSize: 12.5, color: C.tenue, margin: '10px 0 0', lineHeight: 1.55 }}>Para operar con otra empresa escribes su ID; ella te acepta, Cumplimiento te aprueba y en ese momento reemplaza a {autorizada.nombre}. No puedes quitar tu empresa actual sin haber puesto la nueva: nunca te quedas sin empresa por el camino.</p>
            </>) : (
              <BotonPrimario onClick={abrirAutorizacion} style={{ width: '100%' }}>{pendiente ? 'Pedir a otra empresa' : 'Pedir autorización'}</BotonPrimario>
            )}
          </div>

          <div className="flex items-center justify-between" style={{ gap: 12, marginTop: 22, paddingTop: 16, borderTop: `1px solid ${C.borde}` }}>
            <div><p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Verificación en dos pasos</p><p style={{ fontSize: 12.5, color: C.sub, margin: '2px 0 0' }}>{mfaActivo ? 'Activa' : 'Sin activar'}</p></div>
            {mfaActivo ? <Pill verde>ACTIVA</Pill> : <BotonSecundario onClick={abrirSeguridad} style={{ padding: '10px 16px', fontSize: 13 }}>Activar</BotonSecundario>}
          </div>

          <BotonSecundario onClick={() => setConfirmarSalir(true)} style={{ width: '100%', marginTop: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><LogOut size={15} /> Cerrar sesión</BotonSecundario>
        </Drawer>
      )}

      {panel === 'autorizacion' && (
        <Drawer titulo={autorizada ? 'Cambiar de empresa' : 'Pedir autorización'} sub={autorizada ? `Hoy operas con ${autorizada.nombre}. La nueva empresa la reemplaza cuando Cumplimiento te apruebe.` : 'Tu empresa te acepta como su cliente y el equipo de cumplimiento de Lincoin revisa tus documentos y fija tu tope mensual.'} onCerrar={cerrarPanel}>
          {solListo ? (
            <div style={{ textAlign: 'center', padding: '30px 0' }}>
              <span style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(74,222,128,0.12)', display: 'grid', placeItems: 'center', margin: '0 auto' }}><Check size={28} color={C.verde} /></span>
              <p style={{ fontSize: 20, fontWeight: 800, margin: '18px 0 0' }}>Solicitud enviada</p>
              <p style={{ fontSize: 14, color: C.sub, margin: '8px 0 0', lineHeight: 1.5 }}>{solListo} ya la tiene. Cuando te acepte, el equipo de cumplimiento de Lincoin revisa tus documentos. Tu cuenta se actualiza sola; no hace falta recargar.</p>
              <BotonPrimario onClick={() => setPanel(null)} style={{ marginTop: 24 }}>Listo</BotonPrimario>
            </div>
          ) : (
            <form onSubmit={enviarSolicitud} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <Etiqueta>TE REGISTRAS COMO</Etiqueta>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {([['persona', 'Persona natural'], ['empresa', 'Empresa']] as const).map(([v, t]) => (
                    <button key={v} type="button" onClick={() => { setSolTipo(v); setSolFuente(''); setSolError(null); }} disabled={solOcupado}
                      style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: solTipo === v ? '#0A0B0A' : C.text, background: solTipo === v ? C.text : 'rgba(255,255,255,0.05)', border: `1px solid ${solTipo === v ? C.text : C.bordeFuerte}`, borderRadius: 11, padding: '11px 12px', cursor: 'pointer' }}>{t}</button>
                  ))}
                </div>
              </div>
              <div>
                <Etiqueta>ID LINCOIN DE LA EMPRESA</Etiqueta>
                <Campo value={solEmpresa} onChange={e => setSolEmpresa(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} placeholder="Ej. A1B2C3" autoFocus style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, letterSpacing: '3px' }} />
                <p style={{ fontSize: 12.5, color: C.tenue, margin: '6px 0 0' }}>La empresa de la que eres cliente lo copia desde su panel, en "Clientes".</p>
              </div>
              {esEmpresa ? (<>
                <div>
                  <Etiqueta>RAZÓN SOCIAL</Etiqueta>
                  <Campo value={solNombre} onChange={e => setSolNombre(e.target.value.slice(0, 120))} placeholder="Como aparece en la cámara de comercio" autoComplete="organization" />
                </div>
                <div>
                  <Etiqueta>NIT</Etiqueta>
                  <Campo value={solDocNumber} onChange={e => setSolDocNumber(e.target.value.replace(/\D/g, '').slice(0, 15))} inputMode="numeric" placeholder="Con el dígito de verificación, sin puntos" />
                </div>
                <div>
                  <Etiqueta>REPRESENTANTE LEGAL</Etiqueta>
                  <Campo value={solRepNombre} onChange={e => setSolRepNombre(e.target.value.slice(0, 120))} placeholder="Nombre completo, como aparece en su documento" />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10, marginTop: 10 }}>
                    <Selector value={solRepDocType} onChange={e => setSolRepDocType(e.target.value)} aria-label="Tipo de documento del representante">
                      {TIPOS_DOC.map(([k, n]) => <option key={k} value={k} style={{ color: '#000' }}>{k} · {n}</option>)}
                    </Selector>
                    <Campo value={solRepDocNumber} onChange={e => setSolRepDocNumber(e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 30))} inputMode="numeric" placeholder="Número, sin puntos" aria-label="Número de documento del representante" />
                  </div>
                </div>
              </>) : (<>
                <div>
                  <Etiqueta>TU NOMBRE COMPLETO</Etiqueta>
                  <Campo value={solNombre} onChange={e => setSolNombre(e.target.value.slice(0, 120))} placeholder="Como aparece en tu documento" autoComplete="name" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10 }}>
                  <div>
                    <Etiqueta>DOCUMENTO</Etiqueta>
                    <Selector value={solDocType} onChange={e => setSolDocType(e.target.value)}>
                      {TIPOS_DOC.map(([k, n]) => <option key={k} value={k} style={{ color: '#000' }}>{k} · {n}</option>)}
                    </Selector>
                  </div>
                  <div>
                    <Etiqueta>NÚMERO</Etiqueta>
                    <Campo value={solDocNumber} onChange={e => setSolDocNumber(e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 30))} inputMode="numeric" placeholder="Sin puntos" />
                  </div>
                </div>
              </>)}
              <div>
                <Etiqueta>{esEmpresa ? 'FOTO DEL REPRESENTANTE LEGAL SOSTENIENDO SU DOCUMENTO' : 'FOTO SOSTENIENDO TU DOCUMENTO'}</Etiqueta>
                <label className="persona-sec" style={{ display: 'block', border: `1px dashed ${C.bordeFuerte}`, borderRadius: 12, padding: solFoto ? 8 : '22px 16px', textAlign: 'center', cursor: 'pointer', background: 'rgba(255,255,255,0.03)' }}>
                  <input type="file" accept="image/*" capture="user" onChange={e => elegirFoto(e.target.files?.[0])} style={{ display: 'none' }} />
                  {solFoto ? <img src={solFoto} alt="Foto sosteniendo el documento" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, display: 'block', margin: '0 auto' }} /> : (<>
                    <User size={26} color={C.sub} strokeWidth={1.6} style={{ margin: '0 auto' }} />
                    <p style={{ fontSize: 14, fontWeight: 700, margin: '10px 0 0' }}>Tomar o subir la foto</p>
                    <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>{esEmpresa ? 'La cara del representante y su documento al frente' : 'Tu cara y el documento al frente'}, con buena luz. Que se lea el nombre y el número.</p>
                  </>)}
                </label>
                {solFoto && <button type="button" onClick={() => setSolFoto(null)} style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: C.sub, background: 'transparent', border: 'none', padding: 0, marginTop: 8, cursor: 'pointer' }}>Tomar otra</button>}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Etiqueta>{esEmpresa ? `${docNombre.toUpperCase()} DEL REPRESENTANTE POR LAS DOS CARAS` : `TU ${docNombre.toUpperCase()} POR LAS DOS CARAS`}</Etiqueta>
                <Adjunto titulo={esPasaporte ? 'Página de la foto' : 'Frente'} ayuda="Foto nítida, sin reflejos, o PDF" archivo={solArchivos.doc_frente} onElegir={f => elegirAdjunto('doc_frente', f)} apagado={solOcupado} />
                <Adjunto titulo={esPasaporte ? 'Página de la firma' : 'Reverso'} ayuda="Foto nítida, sin reflejos, o PDF" archivo={solArchivos.doc_reverso} onElegir={f => elegirAdjunto('doc_reverso', f)} apagado={solOcupado} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Etiqueta>{esEmpresa ? 'DOCUMENTOS DE LA EMPRESA' : 'DOCUMENTOS TRIBUTARIOS'}</Etiqueta>
                <Adjunto titulo={esEmpresa ? 'RUT de la empresa' : 'RUT'} ayuda="PDF de la DIAN o foto, actualizado" archivo={solArchivos.rut} onElegir={f => elegirAdjunto('rut', f)} apagado={solOcupado} />
                <Adjunto titulo="Cámara de comercio" ayuda={esEmpresa ? 'Certificado de existencia y representación legal, de menos de 30 días' : 'Certificado de matrícula mercantil, de menos de 30 días'} archivo={solArchivos.camara_comercio} onElegir={f => elegirAdjunto('camara_comercio', f)} apagado={solOcupado} />
                <Adjunto titulo="Declaración de renta" ayuda="La del último año gravable" archivo={solArchivos.declaracion_renta} onElegir={f => elegirAdjunto('declaracion_renta', f)} apagado={solOcupado} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Etiqueta>{esEmpresa ? 'ORIGEN DE LOS FONDOS' : 'ORIGEN DE TUS FONDOS'}</Etiqueta>
                <p style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: '-2px 0 0' }}>{esEmpresa ? '¿De dónde viene el dinero que la empresa va a manejar en Lincoin?' : '¿De dónde viene el dinero que vas a manejar en Lincoin?'}</p>
                <Selector value={solFuente} onChange={e => { setSolFuente(e.target.value); setSolError(null); }} style={{ color: solFuente ? C.text : C.sub }}>
                  <option value="" style={{ color: '#000' }}>Elige una opción…</option>
                  {FUENTES_FONDOS[solTipo].map(([k, n]) => <option key={k} value={k} style={{ color: '#000' }}>{n}</option>)}
                </Selector>
                <Campo value={solDetalle} onChange={e => setSolDetalle(e.target.value.slice(0, 300))} placeholder={solFuente === 'otro' ? 'Cuéntanos de dónde viene' : esEmpresa ? 'Detalle (opcional): actividad, clientes o socios' : 'Detalle (opcional): empresa, actividad o negocio'} />
                <Casilla marcada={solLicito} onCambiar={v => { setSolLicito(v); setSolError(null); }}>{esEmpresa ? 'Declaro que los recursos de la empresa provienen de actividades lícitas y que la información y los documentos que entrego son verdaderos.' : 'Declaro que mis recursos provienen de actividades lícitas y que la información y los documentos que entrego son verdaderos.'}</Casilla>
              </div>

              {solError && <p style={{ fontSize: 13.5, color: NARANJA, margin: 0, lineHeight: 1.5 }}>{solError}</p>}
              <BotonPrimario type="submit" disabled={solOcupado}>{solOcupado ? (solProgreso ?? 'Enviando…') : 'Enviar solicitud'}</BotonPrimario>
              <p style={{ fontSize: 12, color: C.tenue, margin: 0, lineHeight: 1.5 }}>Los documentos los revisa el equipo de cumplimiento de Lincoin. Tu empresa ve tus datos y tu foto.</p>
            </form>
          )}
        </Drawer>
      )}

      {panel === 'notificaciones' && (
        <Drawer titulo="Notificaciones" sub="Por dónde te avisamos de cada movimiento." onCerrar={cerrarPanel}>
          {([['correo', 'Correo', 'Cada depósito y envío'], ['whatsapp', 'WhatsApp', 'Avisos de saldo recibido'], ['alertas', 'Alertas de seguridad', 'Ingresos nuevos y cambios en la cuenta']] as const).map(([k, t, d]) => (
            <button key={k} onClick={() => togglePref(k)} style={{ fontFamily: FONT, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: `1px solid ${C.borde}`, padding: '14px 0', cursor: 'pointer', color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span><span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{t}</span><span style={{ display: 'block', fontSize: 12.5, color: C.sub, marginTop: 2 }}>{d}</span></span>
              <span style={{ width: 40, height: 22, borderRadius: 999, background: prefs[k] ? C.verde : 'rgba(255,255,255,0.15)', position: 'relative', flexShrink: 0 }}><span style={{ position: 'absolute', top: 3, left: prefs[k] ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#0C0E0D', transition: 'left .15s' }} /></span>
            </button>
          ))}
        </Drawer>
      )}

      {panel === 'invita' && (
        <Drawer titulo="Invita y gana" sub="Comparte tu ID: es también tu código de invitación." onCerrar={cerrarPanel}>
          <div style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borde}`, borderRadius: 12, padding: '18px', textAlign: 'center' }}>
            <p style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700, letterSpacing: '4px', margin: 0 }}>{codigo}</p>
            <BotonPrimario onClick={copiar} style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}>{copiado ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar código</>}</BotonPrimario>
          </div>
          <p style={{ fontSize: 13.5, color: C.sub, margin: '16px 0 0', lineHeight: 1.55 }}>Cuando alguien se registra con tu código y hace su primer movimiento, el bono te llega como "Bono de referido" en tus movimientos.</p>
        </Drawer>
      )}

      {confirmarSalir && <ConfirmarModal titulo="¿Cerrar sesión?" texto="Para volver a entrar necesitarás tu correo y tu contraseña." confirmar="Cerrar sesión" onConfirmar={() => { setConfirmarSalir(false); onLogout(); }} onCancelar={() => setConfirmarSalir(false)} />}
    </div>
  );
};

// Lista de movimientos, compartida por Inicio y Cuenta. En Cuenta va
// agrupada por día, como un extracto.
const ListaMovimientos: React.FC<{ movs: any[]; contraparte: (t: any) => string; oculto: boolean; agrupar?: boolean }> = ({ movs, contraparte, oculto, agrupar }) => {
  if (movs.length === 0) return (
    <div style={{ textAlign: 'center', padding: '40px 8px 28px' }}>
      <Clock size={34} color={C.sub} strokeWidth={1.5} style={{ margin: '0 auto 18px' }} />
      <p style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: '-0.3px' }}>Todavía no tienes movimientos</p>
      <p style={{ fontSize: 14, color: C.sub, margin: '8px auto 0', lineHeight: 1.5, maxWidth: 440 }}>Cuando una empresa te cargue saldo con tu ID, deposites o envíes plata, aparece aquí con el nombre y la fecha.</p>
    </div>
  );
  let diaPrevio = '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
      {movs.map((t: any) => {
        const entra = ENTRA.has(String(t.type));
        const conv = t.type === 'convert';
        const rech = t.status === 'Rechazado' || t.status === 'Fallido';
        const cur = String(t.currency ?? 'COP').split('_')[0];
        const cp = contraparte(t);
        const dia = agrupar ? diaDe(t.createdAt) : '';
        const cabecera = agrupar && dia !== diaPrevio;
        diaPrevio = dia;
        return (
          <React.Fragment key={t.id}>
            {cabecera && <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '1px', color: C.sub, margin: '16px 0 2px', textTransform: 'uppercase' }}>{dia}</p>}
            <div className="flex items-center" style={{ gap: 14, padding: '13px 0', borderTop: cabecera ? 'none' : `1px solid ${C.borde}` }}>
              <span style={{ width: 40, height: 40, borderRadius: '50%', background: entra ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.06)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                {conv ? <ArrowLeftRight size={16} color={C.text} /> : entra ? <ArrowDownLeft size={16} color={C.verde} /> : <ArrowUpRight size={16} color={C.text} />}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontSize: 15, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || ROTULO[t.type] || t.type}{cp && !String(t.title ?? '').includes(cp) ? ` · ${cp}` : ''}</p>
                <p style={{ fontSize: 13, color: C.sub, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agrupar ? hora(t.createdAt) : fecha(t.createdAt)}{t.note ? ` · ${t.note}` : ''}{t.status && t.status !== 'Completado' ? ` · ${t.status}` : ''}</p>
              </div>
              <p style={{ fontSize: 15, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: rech ? C.tenue : entra ? C.verde : C.text, textDecoration: rech ? 'line-through' : 'none' }}>
                {oculto ? '••••' : `${conv ? '' : entra ? '+' : '−'}${montoMov(Number(t.amount) || 0, cur)}`}
              </p>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};
