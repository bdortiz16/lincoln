// ══════════════════════════════════════════════════════════════════
//  Portal Personas — lincoin.me/portal_personas
//
//  Una billetera digital en pesos. Una empresa registrada en Lincoin
//  (modelo PSP) autoriza a la persona y le carga saldo por su ID Lincoin;
//  la persona lo ve, deposita por PSE y lo envía.
//
//  Un solo saldo en pesos (COP), sin billeteras ni conversiones. Enviar
//  pregunta primero CÓMO:
//    · a una llave Bre-B — inmediata: se consulta el titular de la llave,
//      la persona lo confirma, queda guardado como beneficiario y se
//      verifican sus antecedentes ANTES de pedir el monto;
//    · a un cliente Lincoin — por su ID, gratis;
//    · a una cuenta de banco — beneficiarios inscritos, hasta 2 días hábiles.
//  El servidor (mouv-proxy) vuelve a aplicar todo: titular de la llave,
//  antecedentes, autorización de la empresa y tope mensual.
//
//  Lo que aún no está (llaves propias para recibir, tarjeta) se dice tal
//  cual, con "pronto". Nada que parezca que funciona y no.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy, Check, Eye, EyeOff, Bell, ArrowUpRight, Plus, ArrowLeftRight, Clock, ArrowDownLeft, X, Link2, FileText, BarChart3,
  Shield, Gift, MessageSquare, Search, ChevronRight, ChevronLeft, Download, User, Landmark, KeyRound, CreditCard, Zap,
  Users, House, CircleHelp, Wallet, Loader2, LogOut,
} from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';
import { llamarFuncion } from '../lib/edge';
import { descargarXlsx } from '../lib/xlsx';
import { completarNit, digitoVerificacionNit } from '../lib/nit';
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
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const ocultarDoc = (d: string) => (d.length > 4 ? `•••• ${d.slice(-4)}` : d);
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

const ROTULO: Record<string, string> = {
  pay_received: 'Saldo recibido', pay_sent: 'Envío a persona Lincoin', load: 'Depósito', send: 'Envío',
  dispersion: 'Envío', convert: 'Conversión', adjustment: 'Ajuste de saldo', referral_payout: 'Bono de referido', receive: 'Recibido',
};
const ENTRA = new Set(['pay_received', 'load', 'adjustment', 'referral_payout', 'receive']);

// ─── Llaves Bre-B ────────────────────────────────────────────────────
// La persona escribe la llave como la tenga; el tipo se deduce. El que
// manda es el del directorio Bre-B (lo devuelve la consulta del titular),
// y el servidor también lo vuelve a preguntar antes de enviar.
type TipoLlave = 'celular' | 'cedula' | 'correo' | 'alfanumerico';
const TIPO_LLAVE_TXT: Record<TipoLlave, string> = { celular: 'Celular', cedula: 'Cédula', correo: 'Correo', alfanumerico: '@llave' };
const tipoLlave = (v: string): TipoLlave => {
  const t = v.trim();
  if (t.startsWith('@')) return 'alfanumerico';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return 'correo';
  if (/^[+\d\s().-]+$/.test(t)) {
    const d10 = dig(t).replace(/^57(?=\d{10}$)/, '');
    if (/^3\d{9}$/.test(d10)) return 'celular';
    if (d10.length >= 5 && d10.length <= 11) return 'cedula';
  }
  return 'alfanumerico';
};
const normalizarLlave = (v: string, tipo: TipoLlave) => {
  const t = v.trim();
  if (tipo === 'celular') return dig(t).replace(/^57(?=\d{10}$)/, '');
  if (tipo === 'cedula') return dig(t);
  if (tipo === 'correo') return t.toLowerCase();
  return t;
};
const tipoDeDirectorio = (k: unknown): TipoLlave | null => {
  const s = String(k ?? '').toLowerCase();
  if (!s) return null;
  if (/cel|phone|movil|mobile|tel/.test(s)) return 'celular';
  if (/mail|correo/.test(s)) return 'correo';
  if (/alfa|alpha|alias|nick/.test(s)) return 'alfanumerico';
  if (/doc|ced|ident|nit|\bid\b|national/.test(s)) return 'cedula';
  return null;
};
// Igual que el servidor: las llaves de celular viajan con y sin +57.
const normLlave = (v: unknown) => {
  const t = String(v ?? '').trim().toLowerCase();
  const d = t.replace(/\D/g, '');
  if (d && d.length >= 10 && /^[+\d\s().-]+$/.test(t)) return d.replace(/^57(?=\d{10}$)/, '');
  return t;
};
// El mismo documento escrito distinto: un NIT con o sin dígito de
// verificación. El dígito extra solo cuenta si es el DV correcto.
const mismoDoc = (x: unknown, y: unknown) => {
  const a = dig(x).replace(/^0+/, ''), b = dig(y).replace(/^0+/, '');
  if (!a || !b) return false;
  if (a === b) return true;
  const [largo, corto] = a.length > b.length ? [a, b] : [b, a];
  return largo.length === corto.length + 1 && corto.length >= 8 && largo.startsWith(corto) && Number(largo[largo.length - 1]) === digitoVerificacionNit(corto);
};
// Los NIT de empresa son 9 dígitos que empiezan por 8 o 9 (sin el DV).
const pareceNit = (d: string) => /^[89]\d{8}$/.test(d);

// El veredicto de antecedentes de un destinatario. Mismo criterio que la
// lista de beneficiarios y que el servidor. null = todavía no hay resultado.
type Veredicto = { estado: 'ok' } | { estado: 'bloqueado'; motivo: string } | { estado: 'espera'; motivo: string };
const juzgar = (k: any): Veredicto | null => {
  if (!k || typeof k !== 'object') return null;
  const est = String(k.estado ?? '');
  // El titular que no autoriza la consulta no frena: es su derecho.
  if (est === 'sin_autorizacion') return { estado: 'ok' };
  if (est !== 'finalizado') return null;
  if (k.aprobadoManual === true) return { estado: 'ok' };
  if (k.nombreCoincide === false) return { estado: 'bloqueado', motivo: 'El documento no corresponde al titular de esta llave. Revisa el número del documento e inténtalo otra vez.' };
  if (k.documentoVigente === false) return { estado: 'bloqueado', motivo: 'El documento del titular no está vigente, así que no podemos enviarle dinero.' };
  if (k.operable === false || String(k.categoria ?? '') === 'alto') return { estado: 'bloqueado', motivo: 'Por seguridad no podemos enviar dinero a esta persona. Si crees que es un error, escríbenos a soporte.' };
  return { estado: 'ok' };
};

// Los beneficiarios son LOS MISMOS que en Empresas: mismo formulario, misma
// inscripción en el riel, misma verificación de antecedentes (AML). Viven en
// raw_data.mouvContacts y los administra ContactsSection.
const viaDe = (c: MouvContact): string => c.destKind === 'breb'
  ? `Llave Bre-B ···${String(c.brebKey ?? c.accountNumber ?? '').slice(-4)}`
  : `${c.bank || 'Cuenta bancaria'} ···${String(c.accountNumber ?? '').slice(-4)}`;

// "movimientos" es la vista de la cuenta (saldo, acciones y movimientos):
// la ruta se conserva para no romper enlaces guardados.
type Vista = 'inicio' | 'movimientos' | 'beneficiarios' | 'ayuda';
const RUTA_VISTA: Record<Vista, string> = { inicio: '/portal_personas', movimientos: '/personas_movimientos', beneficiarios: '/personas_beneficiarios', ayuda: '/personas_ayuda' };
const VISTA_RUTA: Record<string, Vista> = Object.fromEntries(Object.entries(RUTA_VISTA).map(([v, p]) => [p, v as Vista]));

type Panel = 'enviar' | 'llave' | 'recargar' | 'recibir' | 'llaves' | 'tarjetas' | 'seguridad' | 'limites' | 'notificaciones' | 'invita' | 'cobrar' | 'autorizacion' | 'perfil' | null;

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
const FUENTES_FONDOS: Array<[string, string]> = [
  ['salario', 'Salario'], ['honorarios', 'Honorarios o prestación de servicios'], ['negocio', 'Ventas de mi negocio'],
  ['pension', 'Pensión'], ['inversiones', 'Rentas o inversiones'], ['familia', 'Ayuda de familiares o remesas'], ['otro', 'Otro'],
];
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
const Pronto: React.FC = () => <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, border: `1px solid ${C.bordeFuerte}`, borderRadius: 999, padding: '3px 8px', whiteSpace: 'nowrap' }}>PRONTO</span>;
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
const Accion: React.FC<{ icono: React.ElementType; txt: string; onClick: () => void; principal?: boolean; pronto?: boolean }> = ({ icono: I, txt, onClick, principal, pronto }) => (
  <button onClick={onClick} className="persona-acc" style={{ fontFamily: FONT, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minWidth: 64, flex: '1 0 64px', color: C.text, position: 'relative', padding: '4px 0' }}>
    <span className={principal ? 'lincoin-btn-white' : 'persona-acc-c'} style={{ width: 58, height: 58, borderRadius: '50%', background: principal ? undefined : 'rgba(255,255,255,0.06)', border: principal ? 'none' : `1px solid ${C.bordeFuerte}`, display: 'grid', placeItems: 'center', opacity: pronto ? 0.6 : 1 }}><I size={22} strokeWidth={1.9} /></span>
    <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'center', lineHeight: 1.25, color: pronto ? C.sub : C.text }}>{txt}</span>
    {pronto && <span style={{ position: 'absolute', top: -2, left: '50%', transform: 'translateX(4px)', fontSize: 8, fontWeight: 800, letterSpacing: '1px', color: C.sub, background: C.fondo, border: `1px solid ${C.bordeFuerte}`, borderRadius: 999, padding: '2px 6px' }}>PRONTO</span>}
  </button>
);

// Fila de lista (Detalles de mi cuenta, Mis tarjetas…).
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

// Opción grande del "¿Cómo quieres enviar?".
const Opcion: React.FC<{ icono: React.ElementType; titulo: string; sub: string; pill?: string; onClick: () => void }> = ({ icono: I, titulo, sub, pill, onClick }) => (
  <button onClick={onClick} className="persona-func" style={{ fontFamily: FONT, width: '100%', textAlign: 'left', background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.borde}`, borderRadius: R, padding: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, color: C.text }}>
    <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><I size={19} strokeWidth={1.9} /></span>
    <span style={{ flex: 1, minWidth: 0 }}>
      <span className="flex items-center flex-wrap" style={{ gap: 8 }}>
        <span style={{ fontSize: 15.5, fontWeight: 700 }}>{titulo}</span>
        {pill && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '1.2px', color: C.verde, border: '1px solid rgba(74,222,128,0.35)', borderRadius: 999, padding: '3px 8px' }}>{pill}</span>}
      </span>
      <span style={{ display: 'block', fontSize: 13, color: C.sub, marginTop: 3, lineHeight: 1.45 }}>{sub}</span>
    </span>
    <ChevronRight size={18} color={C.sub} />
  </button>
);

// Tarjeta Mastercard Lincoin (aún no existe: se muestra como "pronto").
const TarjetaLincoin: React.FC = () => (
  <div style={{ aspectRatio: '1.586', width: '100%', maxWidth: 340, margin: '0 auto', borderRadius: 16, background: NEGRO_LINCOIN, border: `1px solid ${C.bordeFuerte}`, position: 'relative', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 85% 10%, rgba(74,222,128,0.18), transparent 45%)' }} />
    <span style={{ position: 'absolute', top: 18, left: 20, fontSize: 16, fontWeight: 800, letterSpacing: '-0.5px', color: C.text }}>Lincoin<span style={{ color: C.verde }}>.</span></span>
    <span style={{ position: 'absolute', bottom: 20, left: 20, fontFamily: MONO, fontSize: 13, letterSpacing: '2px', color: C.sub }}>•••• •••• •••• ••••</span>
    <span style={{ position: 'absolute', bottom: 18, right: 38, width: 26, height: 26, borderRadius: '50%', background: '#EB001B' }} />
    <span style={{ position: 'absolute', bottom: 18, right: 20, width: 26, height: 26, borderRadius: '50%', background: '#F79E1B', opacity: 0.9 }} />
  </div>
);

// ─── Portal ──────────────────────────────────────────────────────────
export const PersonaDashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const { currentUser, transactions, refreshData, enrollMFA, verifyMFAEnrollment, updateUserRawData, actualizarListaRaw, markNotificationsRead } = useDatabase();
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
  const estadoTxt = autorizada ? `AUTORIZADA · ${autorizada.nombre.toUpperCase()}` : pendiente ? 'AUTORIZACIÓN EN REVISIÓN' : auth?.datos?.estado === 'rechazada' ? 'SOLICITUD RECHAZADA' : auth?.datos?.estado === 'revocada' ? 'AUTORIZACIÓN RETIRADA' : 'IDENTIFICACIÓN PENDIENTE';

  const [solEmpresa, setSolEmpresa] = useState('');
  const [solNombre, setSolNombre] = useState('');
  const [solDocType, setSolDocType] = useState('CC');
  const [solDocNumber, setSolDocNumber] = useState('');
  const [solFoto, setSolFoto] = useState<string | null>(null);
  const [solOcupado, setSolOcupado] = useState(false);
  const [solError, setSolError] = useState<string | null>(null);
  const [solListo, setSolListo] = useState<string | null>(null);
  const [solArchivos, setSolArchivos] = useState<Partial<Record<TipoAdjunto, File>>>({});
  const [solFuente, setSolFuente] = useState('');
  const [solDetalle, setSolDetalle] = useState('');
  const [solLicito, setSolLicito] = useState(false);
  const [solProgreso, setSolProgreso] = useState<string | null>(null);
  const docNombre = NOMBRE_DOC[solDocType] ?? 'Documento';
  const esPasaporte = solDocType === 'PAS';
  const abrirAutorizacion = () => {
    const d = auth?.datos;
    setSolEmpresa(''); setSolNombre(d?.nombre || String(cu.name || cu.fullName || '')); setSolDocType(d?.docType || 'CC'); setSolDocNumber(d?.docNumber || '');
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
    if (solNombre.trim().length < 5 || !solNombre.trim().includes(' ')) { setSolError('Escribe tu nombre completo, como aparece en el documento.'); return; }
    if (solDocNumber.replace(/[^0-9A-Za-z]/g, '').length < 5) { setSolError('Escribe el número de tu documento.'); return; }
    if (!solFoto) { setSolError('Falta la foto sosteniendo tu documento.'); return; }
    // Todos obligatorios: el documento por las dos caras, RUT, cámara de
    // comercio y declaración de renta.
    const pedidos: Array<[TipoAdjunto, string]> = [
      ['doc_frente', `${docNombre}: ${esPasaporte ? 'la página de la foto' : 'el frente'}`],
      ['doc_reverso', `${docNombre}: ${esPasaporte ? 'la página de la firma' : 'el reverso'}`],
      ['rut', 'el RUT'], ['camara_comercio', 'la cámara de comercio'], ['declaracion_renta', 'la declaración de renta'],
    ];
    const faltan = pedidos.filter(([t]) => !solArchivos[t]).map(([, n]) => n);
    if (faltan.length) { setSolError(`Falta adjuntar ${faltan.join(', ')}.`); return; }
    if (!solFuente) { setSolError('Cuéntanos de dónde vienen tus fondos.'); return; }
    if (solFuente === 'otro' && solDetalle.trim().length < 5) { setSolError('Describe de dónde vienen tus fondos.'); return; }
    if (!solLicito) { setSolError('Falta tu declaración de que tus fondos vienen de actividades lícitas.'); return; }
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
        action: 'solicitar', codigoEmpresa: id, nombre: solNombre.trim(), docType: solDocType, docNumber: solDocNumber, foto: solFoto,
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
  const abrirEnviar = () => { if (puedeEnviar()) setPanel('enviar'); };
  // Bre-B sale por la cuenta inmediata que paga con el saldo en pesos; una
  // cuenta de banco, por ACH. En los dos casos, beneficiario ya verificado.
  const abrirModalContacto = (c: MouvContact) => {
    enviarRef.current?.abrir({ ...prefillDeContacto(c), metodo: c.destKind === 'breb' ? 'breb2' : 'ach', rail: 'COP_ACH' });
  };
  const abrirAClienteLincoin = () => {
    setPanel(null);
    enviarRef.current?.abrir({ mode: 'pay', contact: null, rail: 'COP', form: { destinationCountry: 'Colombia', destinationCurrency: 'COP' } });
  };
  const abrirACuentaBanco = () => {
    setPanel(null);
    enviarRef.current?.abrir({ mode: 'bank', contact: null, metodo: 'ach', rail: 'COP_ACH', form: { destinationCountry: 'Colombia', destinationCurrency: 'COP' } });
  };
  const callGasfree = (payload: Record<string, unknown>) => llamarFuncion('gasfree', payload, 90000);

  // ── Enviar a una llave Bre-B ───────────────────────────────────────
  // llave → titular (lo dice el directorio) → la persona confirma → queda
  // guardado como beneficiario → antecedentes → monto (modal).
  type PasoLlave = 'llave' | 'buscando' | 'titular' | 'verificando' | 'bloqueado' | 'espera';
  const [llPaso, setLlPaso] = useState<PasoLlave>('llave');
  const [llValor, setLlValor] = useState('');
  const [llError, setLlError] = useState<string | null>(null);
  const [llTitular, setLlTitular] = useState<{ nombre: string; doc: string; banco: string | null; tipo: TipoLlave; llave: string } | null>(null);
  const [llDocTipo, setLlDocTipo] = useState('CC');
  const [llDocNum, setLlDocNum] = useState('');
  const [llMotivo, setLlMotivo] = useState('');
  const [llContacto, setLlContacto] = useState<MouvContact | null>(null);
  // Cada apertura o cierre del panel cambia la generación: una consulta que
  // vuelve tarde ya no toca la pantalla siguiente.
  const llGen = useRef(0);
  const cerrarPanel = () => { llGen.current += 1; setPanel(null); };
  const abrirLlave = () => {
    llGen.current += 1;
    setLlPaso('llave'); setLlValor(''); setLlError(null); setLlTitular(null); setLlDocTipo('CC'); setLlDocNum(''); setLlMotivo(''); setLlContacto(null);
    setPanel('llave');
  };
  const llTipoEscrito = llValor.trim().length >= 3 ? tipoLlave(llValor) : null;

  const buscarLlave = async (e?: React.FormEvent, valor?: string) => {
    e?.preventDefault();
    if (llPaso === 'buscando' && valor === undefined) return;
    const crudo = (valor ?? llValor).trim();
    if (crudo.length < 3) { setLlError('Escribe la llave: celular, correo, cédula o @llave.'); return; }
    const tipo = tipoLlave(crudo);
    const llave = normalizarLlave(crudo, tipo);
    const gen = llGen.current;
    setLlError(null); setLlPaso('buscando');
    const r = await llamarFuncion('mouv-proxy', { action: 'resolve_breb_key', user_id: cu.id, keyValue: llave, keyType: tipo }, 25000);
    if (gen !== llGen.current) return;
    const nombreT = String(r?.fullName ?? '').trim();
    if (r?.ok && r?.found && nombreT) {
      const doc = dig(r.idValue);
      setLlTitular({ nombre: nombreT, doc, banco: r.bank ? String(r.bank) : null, tipo: tipoDeDirectorio(r.keyType) ?? tipo, llave });
      setLlDocTipo(pareceNit(doc) ? 'NIT' : 'CC'); setLlDocNum('');
      setLlPaso('titular');
      return;
    }
    setLlPaso('llave');
    setLlError(r?.ok && r?.found
      ? 'No pudimos ver el titular de esta llave. Pídele a la persona que la revise o envíale por otro medio.'
      : r?.found === false
        ? 'Esa llave no existe o no está activa. Revísala con quien te la dio.'
        : (r?.message || 'No pudimos consultar la llave ahora. Intenta de nuevo en un momento.'));
  };

  // Antecedentes del destinatario. Si la verificación no corre para esta
  // cuenta, no hay nada que esperar (el servidor tampoco espera).
  const verificarAntecedentes = async (c: MouvContact, gen: number): Promise<Veredicto | null> => {
    const uid = cu.id;
    const doc = dig(c.docNumber);
    if (!doc) return { estado: 'ok' };
    const e0 = await llamarFuncion('tusdatos', { action: 'estado', userId: uid }, 30000);
    if (gen !== llGen.current) return null;
    if (!e0?.ok) return { estado: 'espera', motivo: 'No pudimos revisar la verificación del destinatario en este momento. Intenta de nuevo en un minuto.' };
    const f0 = e0.beneficiarios?.[doc];
    const archivada = String(f0?.estado ?? '') === 'archivado';
    const v0 = archivada ? null : juzgar(f0);
    if (v0) return v0;
    if (!e0.activo || !e0.enLaPrueba) return { estado: 'ok' };
    if (!f0 || archivada) {
      const l = await llamarFuncion('tusdatos', { action: 'verificar_beneficiario', userId: uid, nombre: c.name, documento: doc, tipoDocumento: String(c.docType || 'CC').toUpperCase() }, 60000);
      if (gen !== llGen.current) return null;
      if (l?.error === 'tope_diario') return { estado: 'espera', motivo: String(l.message ?? 'Llegaste al máximo de verificaciones de hoy. Intenta de nuevo mañana.') };
      const v = l?.ok ? juzgar(l.beneficiario) : null;
      if (v) return v;
    }
    // Suele tardar cerca de un minuto. Se recoge cada 5 s hasta 2,5 minutos.
    const hasta = Date.now() + 150_000;
    for (let vuelta = 1; Date.now() < hasta; vuelta++) {
      await esperar(5000);
      if (gen !== llGen.current) return null;
      if (vuelta % 6 === 0) await llamarFuncion('tusdatos', { action: 'verificar_pendientes', userId: uid, limite: 2 }, 60000);
      await llamarFuncion('tusdatos', { action: 'recoger_pendientes', userId: uid }, 30000);
      const e = await llamarFuncion('tusdatos', { action: 'estado', userId: uid }, 30000);
      if (gen !== llGen.current) return null;
      const v = e?.ok ? juzgar(e.beneficiarios?.[doc]) : null;
      if (v) return v;
    }
    return { estado: 'espera', motivo: 'La verificación está tardando más de lo normal. Puedes seguir esperando o cerrar: el destinatario queda guardado y le envías desde «Contactos previos» apenas termine.' };
  };

  // Verifica y, si todo está bien, abre el monto.
  const verificarYEnviar = async (c: MouvContact) => {
    const gen = llGen.current;
    setLlContacto(c); setLlError(null); setLlPaso('verificando');
    const v = await verificarAntecedentes(c, gen);
    if (!v || gen !== llGen.current) return;
    if (v.estado === 'ok') {
      llGen.current += 1;
      setPanel(null);
      refreshData().catch(() => {});
      abrirModalContacto(c);
      return;
    }
    setLlMotivo(v.motivo);
    setLlPaso(v.estado);
  };

  // La persona confirmó el titular: se guarda (o se reusa) el beneficiario.
  const confirmarTitular = async () => {
    if (!llTitular || llPaso !== 'titular') return;
    const docBase = llTitular.doc || dig(llDocNum);
    if (docBase.length < 5) { setLlError('Escribe el número de documento del titular.'); return; }
    const docTipo = llDocTipo;
    const docGuardado = docTipo === 'NIT' ? dig(completarNit(docBase)) : docBase;
    const gen = llGen.current;
    setLlError(null); setLlPaso('verificando');

    const mismaLlave = contactosRaw.filter(c => c?.destKind === 'breb' && normLlave(c.brebKey ?? c.accountNumber) === normLlave(llTitular.llave));
    const otro = mismaLlave.find(c => dig(c.docNumber) && !mismoDoc(c.docNumber, docGuardado));
    if (otro) {
      setLlMotivo(`Ya tienes esta llave guardada como ${nombrePropio(otro.name)} con otro documento. Corrígela o bórrala en Beneficiarios y vuelve a intentar.`);
      setLlPaso('bloqueado');
      return;
    }
    let contacto: MouvContact | null = mismaLlave.find(c => mismoDoc(c.docNumber, docGuardado)) ?? null;
    if (!contacto) {
      const datos = {
        kind: (docTipo === 'NIT' ? 'empresa' : 'persona') as MouvContact['kind'],
        name: llTitular.nombre, docType: docTipo, docNumber: docGuardado,
        bank: llTitular.banco || `Bre-B · ${TIPO_LLAVE_TXT[llTitular.tipo]}`,
        brebKeyType: llTitular.tipo, brebKey: llTitular.llave, accountNumber: llTitular.llave,
      };
      // Guardada antes sin documento: se completa con el del titular.
      const sinDoc = mismaLlave.find(c => !dig(c.docNumber));
      const nuevo: MouvContact = sinDoc ? { ...sinDoc, ...datos } : {
        id: `ct_${Math.random().toString(36).slice(2, 10)}`, mouvId: null,
        country: 'Colombia', accountType: 'savings', status: 'aprobada', createdAt: new Date().toISOString(), lastError: null,
        destKind: 'breb', ...datos,
      };
      const ok = await actualizarListaRaw(cu.id, 'mouvContacts', l => [nuevo, ...l.filter((x: any) => x?.id !== nuevo.id)], contactosRaw);
      if (gen !== llGen.current) return;
      if (!ok) { setLlError('No pudimos guardar el destinatario (tu sesión pudo vencer). Vuelve a entrar e inténtalo otra vez.'); setLlPaso('titular'); return; }
      contacto = nuevo;
    }
    await verificarYEnviar(contacto);
  };

  // Desde "Contactos previos" o Beneficiarios: misma verificación. Una llave
  // guardada sin documento pasa antes por el titular, que es de donde sale.
  const enviarAContacto = (c: MouvContact) => {
    const llave = String(c.brebKey ?? c.accountNumber ?? '').trim();
    if (c.destKind === 'breb' && !dig(c.docNumber) && llave) {
      abrirLlave();
      setLlValor(llave);
      buscarLlave(undefined, llave);
      return;
    }
    llGen.current += 1;
    setLlTitular(null); setLlMotivo(''); setLlError(null);
    setPanel('llave');
    verificarYEnviar(c);
  };
  const volverDeLlave = () => {
    if (llPaso === 'titular') { llGen.current += 1; setLlPaso('llave'); setLlError(null); }
    else setPanel('enviar');
  };

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

  // El tope mensual de retiro lo fija la empresa que autoriza; el consumo
  // del mes lo calcula el servidor (envíos a banco y Bre-B).
  const limiteMensual = autorizada?.topeMensual ?? null;
  const retiradoMes = auth?.usadoMes ?? 0;
  const topeTxt = autorizada ? (limiteMensual ? `${fmt(retiradoMes)} de ${fmt(limiteMensual)} este mes` : `${fmt(retiradoMes)} este mes · sin tope`) : 'Lo fija la empresa que te autorice';

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
      <Accion icono={KeyRound} txt="Tus llaves" onClick={() => setPanel('llaves')} pronto />
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
            <span className="persona-rotulo"><Rotulo>PERSONAS</Rotulo></span>
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
            <span className="persona-nombre" style={{ fontSize: 15, fontWeight: 700 }}>{nombre.split(' ')[0]}</span>
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
              <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.6px', margin: '2px 0 0' }}>{nombre.split(' ')[0]}</h1>
            </div>
            <Pill verde={!!autorizada} naranja={!autorizada && !pendiente} onClick={() => (autorizada || pendiente ? setPanel('perfil') : abrirAutorizacion())}>{auth ? estadoTxt : kycOk ? 'IDENTIDAD VERIFICADA' : 'IDENTIFICACIÓN PENDIENTE'}</Pill>
          </div>

          {/* Sin empresa que la autorice, la cuenta no puede recibir ni enviar. */}
          {auth && !autorizada && (
            <div className="flex items-center justify-between flex-wrap" style={{ gap: 14, background: 'rgba(251,146,60,0.06)', border: '1px solid rgba(251,146,60,0.35)', borderRadius: R, padding: '16px 18px' }}>
              <div style={{ flex: '1 1 260px' }}>
                <p style={{ fontSize: 15.5, fontWeight: 700, margin: 0 }}>{pendiente ? `${pendiente.nombre} está revisando tu solicitud` : 'Pide la autorización de tu empresa'}</p>
                <p style={{ fontSize: 13.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>
                  {pendiente ? 'Cuando la apruebe, tu cuenta queda activa y ves aquí tu tope mensual. Esta pantalla se actualiza sola.'
                    : 'Solo puedes recibir dinero de una empresa registrada en Lincoin. Escribe su ID, adjunta tu documento por las dos caras, tu RUT, tu cámara de comercio y tu declaración de renta, y cuéntanos de dónde vienen tus fondos.'}
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
            <Fila icono={CreditCard} titulo="Mis tarjetas" sub="Tarjeta Mastercard Lincoin" onClick={() => setPanel('tarjetas')} derecha={<Pronto />} />
            <Fila icono={Users} titulo="Beneficiarios" sub={contactos.length ? `${contactos.length} guardado(s)` : 'Llaves Bre-B y cuentas de banco'} onClick={() => setVista('beneficiarios')} />
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
            <Fila icono={KeyRound} titulo="Tus llaves Bre-B" sub="Recibe con tu celular, correo o cédula" onClick={() => setPanel('llaves')} derecha={<Pronto />} />
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
                ['¿Cómo envío a otro banco?', 'Toca Enviar → A una llave Bre-B y escribe la llave de la persona: su celular, correo, cédula o @llave. Te mostramos a nombre de quién está, la confirmas y llega en segundos.'],
                ['¿Por qué me piden esperar al enviar a alguien nuevo?', 'La primera vez que le envías a una persona revisamos que el envío sea seguro. Suele tardar cerca de un minuto y después ya no se repite.'],
                ['¿Cuándo tendré mis propias llaves Bre-B?', 'Pronto. Vas a poder recibir desde cualquier banco con tu celular, tu correo o tu cédula. Mientras tanto, recibe con tu ID Lincoin.'],
                ['¿Quién fija mi tope mensual?', 'La empresa que te autoriza. Si necesitas uno más alto, pídeselo: ella lo cambia desde su panel y aquí se actualiza solo.'],
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
      />

      {panel === 'enviar' && (
        <Drawer titulo="Enviar" sub="¿Cómo quieres hacer el envío?" onCerrar={cerrarPanel}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Opcion icono={Zap} titulo="A una llave Bre-B" pill="INMEDIATA" sub="Con su celular, correo, cédula o @llave. Llega en segundos a cualquier banco." onClick={abrirLlave} />
            <Opcion icono={User} titulo="A un cliente Lincoin" pill="GRATIS" sub="Con su ID Lincoin. Al instante y sin comisión." onClick={abrirAClienteLincoin} />
            <Opcion icono={Landmark} titulo="A una cuenta de banco" sub="Ahorros o corriente, a un beneficiario inscrito. Puede tardar hasta 2 días hábiles." onClick={abrirACuentaBanco} />
          </div>
          <div style={{ marginTop: 26 }}>
            <Rotulo>CONTACTOS PREVIOS</Rotulo>
            {contactos.length === 0 ? (
              <p style={{ fontSize: 13.5, color: C.sub, margin: '12px 0 0', lineHeight: 1.5 }}>Aquí aparecen las personas a las que ya les enviaste. La primera vez, envía a su llave Bre-B.</p>
            ) : (
              <div style={{ marginTop: 6 }}>
                {contactos.slice(0, 12).map((c, i) => (
                  <button key={c.id} onClick={() => enviarAContacto(c)} className="persona-fila" style={{ fontFamily: FONT, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderTop: i ? `1px solid ${C.borde}` : 'none', padding: '12px 2px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, color: C.text }}>
                    <span style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.bordeFuerte}`, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>{iniciales(c.name)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombrePropio(c.name)}</span>
                      <span style={{ display: 'block', fontSize: 12.5, color: C.sub, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{viaDe(c)}</span>
                    </span>
                    <ChevronRight size={17} color={C.sub} />
                  </button>
                ))}
                {contactos.length > 12 && <button onClick={() => { setPanel(null); setVista('beneficiarios'); }} style={{ fontFamily: FONT, fontSize: 13.5, fontWeight: 700, color: C.verde, background: 'transparent', border: 'none', padding: '10px 0 0', cursor: 'pointer' }}>Ver todos →</button>}
              </div>
            )}
          </div>
        </Drawer>
      )}

      {panel === 'llave' && (
        <Drawer
          titulo={llPaso === 'titular' ? '¿Es la persona correcta?' : llPaso === 'verificando' ? 'Verificando' : llPaso === 'bloqueado' ? 'No se puede enviar' : llPaso === 'espera' ? 'Sigue en verificación' : 'Enviar a una llave'}
          sub={llPaso === 'llave' || llPaso === 'buscando' ? 'Bre-B · inmediata a cualquier banco' : undefined}
          onAtras={llPaso === 'llave' || llPaso === 'titular' ? volverDeLlave : undefined}
          onCerrar={cerrarPanel}>
          {(llPaso === 'llave' || llPaso === 'buscando') && (
            <form onSubmit={buscarLlave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <Etiqueta>LLAVE BRE-B</Etiqueta>
                <Campo value={llValor} onChange={e => { setLlValor(e.target.value.slice(0, 80)); setLlError(null); }} placeholder="Correo, celular, cédula o @llave" autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={llPaso === 'buscando'} style={{ fontSize: 17, fontWeight: 700, padding: '14px 16px' }} />
                <p style={{ fontSize: 12.5, color: C.tenue, margin: '8px 0 0', lineHeight: 1.5 }}>
                  {llTipoEscrito ? <>Parece un{llTipoEscrito === 'alfanumerico' ? 'a' : ''} <b style={{ color: C.medio }}>{TIPO_LLAVE_TXT[llTipoEscrito].toLowerCase()}</b>. Antes de enviar te mostramos a nombre de quién está.</> : 'Antes de enviar te mostramos a nombre de quién está la llave.'}
                </p>
              </div>
              {llError && <p style={{ fontSize: 13.5, color: NARANJA, margin: 0, lineHeight: 1.5 }}>{llError}</p>}
              <BotonPrimario type="submit" disabled={llPaso === 'buscando' || llValor.trim().length < 3} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {llPaso === 'buscando' ? <><Loader2 size={16} className="animate-spin" /> Buscando la llave…</> : 'Continuar'}
              </BotonPrimario>
            </form>
          )}

          {llPaso === 'titular' && llTitular && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.borde}`, borderRadius: R, padding: '18px 16px', textAlign: 'center' }}>
                <span style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.bordeFuerte}`, display: 'grid', placeItems: 'center', margin: '0 auto', fontSize: 18, fontWeight: 800 }}>{iniciales(llTitular.nombre)}</span>
                <p style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.3px', margin: '12px 0 0' }}>{nombrePropio(llTitular.nombre)}</p>
                <p style={{ fontSize: 13, color: C.sub, margin: '4px 0 0' }}>{TIPO_LLAVE_TXT[llTitular.tipo]} · <span style={{ fontFamily: MONO, color: C.medio }}>{llTitular.llave}</span></p>
              </div>
              <div style={{ border: `1px solid ${C.borde}`, borderRadius: 12, overflow: 'hidden' }}>
                {llTitular.banco && (
                  <div className="flex items-center justify-between" style={{ gap: 12, padding: '12px 14px', fontSize: 13.5 }}>
                    <span style={{ color: C.sub }}>Banco</span><b style={{ textAlign: 'right' }}>{llTitular.banco}</b>
                  </div>
                )}
                <div style={{ padding: '12px 14px', borderTop: llTitular.banco ? `1px solid ${C.borde}` : 'none' }}>
                  {llTitular.doc ? (
                    <div className="flex items-center justify-between" style={{ gap: 12, fontSize: 13.5 }}>
                      <span style={{ color: C.sub }}>Documento</span>
                      <span className="flex items-center" style={{ gap: 8 }}>
                        <select value={llDocTipo} onChange={e => setLlDocTipo(e.target.value)} aria-label="Tipo de documento" style={{ fontFamily: FONT, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.bordeFuerte}`, color: C.text, borderRadius: 8, padding: '5px 6px', fontSize: 12.5, fontWeight: 700 }}>
                          {TIPOS_DOC_TITULAR.map(([k]) => <option key={k} value={k} style={{ color: '#000' }}>{k}</option>)}
                        </select>
                        <b style={{ fontFamily: MONO }}>{ocultarDoc(llTitular.doc)}</b>
                      </span>
                    </div>
                  ) : (<>
                    <p style={{ fontSize: 13.5, color: C.medio, margin: '0 0 10px', lineHeight: 1.5 }}>Para enviarle necesitamos el documento del titular. Pídeselo a la persona.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 8 }}>
                      <Selector value={llDocTipo} onChange={e => setLlDocTipo(e.target.value)} aria-label="Tipo de documento">
                        {TIPOS_DOC_TITULAR.map(([k, n]) => <option key={k} value={k} style={{ color: '#000' }}>{n}</option>)}
                      </Selector>
                      <Campo value={llDocNum} onChange={e => { setLlDocNum(e.target.value.replace(/\D/g, '').slice(0, 15)); setLlError(null); }} inputMode="numeric" placeholder="Número, sin puntos" />
                    </div>
                  </>)}
                </div>
              </div>
              <p style={{ fontSize: 12.5, color: C.tenue, margin: 0, lineHeight: 1.5 }}>Revisa que sea la persona a la que le quieres enviar. Una transferencia Bre-B no se puede reversar.</p>
              {llError && <p style={{ fontSize: 13.5, color: NARANJA, margin: 0, lineHeight: 1.5 }}>{llError}</p>}
              <div className="flex" style={{ gap: 10 }}>
                <BotonSecundario onClick={() => { llGen.current += 1; setLlPaso('llave'); setLlError(null); }} style={{ flex: 1 }}>Cambiar llave</BotonSecundario>
                <BotonPrimario onClick={confirmarTitular} style={{ flex: 1.4 }}>Sí, continuar</BotonPrimario>
              </div>
            </div>
          )}

          {llPaso === 'verificando' && (
            <div style={{ textAlign: 'center', padding: '34px 4px' }}>
              <Loader2 size={34} color={C.verde} className="animate-spin" style={{ margin: '0 auto' }} />
              <p style={{ fontSize: 18, fontWeight: 800, margin: '20px 0 0' }}>{llContacto ? `Revisando el envío a ${nombrePropio(llContacto.name).split(' ')[0]}` : 'Preparando el envío'}</p>
              <p style={{ fontSize: 14, color: C.sub, margin: '8px auto 0', lineHeight: 1.55, maxWidth: 320 }}>Revisamos que el envío sea seguro. La primera vez suele tardar cerca de un minuto; no cierres esta ventana.</p>
            </div>
          )}

          {(llPaso === 'bloqueado' || llPaso === 'espera') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: llPaso === 'bloqueado' ? 'rgba(251,146,60,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${llPaso === 'bloqueado' ? 'rgba(251,146,60,0.35)' : C.borde}`, borderRadius: 12, padding: '16px' }}>
                {llContacto && <p style={{ fontSize: 15, fontWeight: 800, margin: '0 0 6px' }}>{nombrePropio(llContacto.name)}</p>}
                <p style={{ fontSize: 14, color: C.medio, margin: 0, lineHeight: 1.55 }}>{llMotivo}</p>
              </div>
              <div className="flex" style={{ gap: 10 }}>
                {llPaso === 'espera' && llContacto
                  ? <><BotonSecundario onClick={cerrarPanel} style={{ flex: 1 }}>Cerrar</BotonSecundario><BotonPrimario onClick={() => { llGen.current += 1; verificarYEnviar(llContacto); }} style={{ flex: 1.4 }}>Seguir esperando</BotonPrimario></>
                  : llMotivo.includes('Beneficiarios')
                    ? <><BotonSecundario onClick={cerrarPanel} style={{ flex: 1 }}>Cerrar</BotonSecundario><BotonPrimario onClick={() => { cerrarPanel(); setVista('beneficiarios'); }} style={{ flex: 1.4 }}>Ir a Beneficiarios</BotonPrimario></>
                    : <BotonPrimario onClick={cerrarPanel} style={{ flex: 1 }}>Entendido</BotonPrimario>}
              </div>
            </div>
          )}
        </Drawer>
      )}

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
            <Fila icono={KeyRound} titulo="Tus llaves Bre-B" sub="Recibe desde cualquier banco" onClick={() => setPanel('llaves')} derecha={<Pronto />} />
          </div>
        </Drawer>
      )}

      {panel === 'llaves' && (
        <Drawer titulo="Tus llaves Bre-B" sub="Recibe desde cualquier banco, al instante." onCerrar={cerrarPanel}>
          <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.borde}`, borderRadius: R, padding: '18px 16px' }}>
            <div className="flex items-center justify-between" style={{ gap: 10 }}><p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Muy pronto</p><Pronto /></div>
            <p style={{ fontSize: 14, color: C.sub, margin: '8px 0 0', lineHeight: 1.55 }}>Vas a poder registrar tus propias llaves para que te envíen desde cualquier banco con solo tu celular, tu correo o tu cédula.</p>
          </div>
          <div style={{ marginTop: 14 }}>
            {(['celular', 'correo', 'cedula', 'alfanumerico'] as TipoLlave[]).map((t, i) => (
              <div key={t} className="flex items-center justify-between" style={{ gap: 12, padding: '13px 2px', borderTop: i ? `1px solid ${C.borde}` : 'none', color: C.sub }}>
                <span className="flex items-center" style={{ gap: 12 }}><KeyRound size={16} /> <span style={{ fontSize: 14.5, fontWeight: 600 }}>{TIPO_LLAVE_TXT[t]}</span></span>
                <span style={{ fontSize: 12.5 }}>Sin registrar</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 13.5, color: C.sub, margin: '16px 0 0', lineHeight: 1.55 }}>Mientras tanto, recibe con tu ID Lincoin o con un link de PSE.</p>
          <BotonPrimario onClick={() => setPanel('recibir')} style={{ marginTop: 14, width: '100%' }}>Recibir con mi ID</BotonPrimario>
        </Drawer>
      )}

      {panel === 'tarjetas' && (
        <Drawer titulo="Mis tarjetas" sub="Paga en comercios y en internet con tu saldo." onCerrar={cerrarPanel}>
          <TarjetaLincoin />
          <div className="flex items-center justify-between" style={{ gap: 10, marginTop: 20 }}>
            <div><p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Tarjeta Lincoin</p><p style={{ fontSize: 13.5, color: C.sub, margin: '2px 0 0' }}>Mastercard con tu saldo en pesos</p></div>
            <Pronto />
          </div>
          <p style={{ fontSize: 13.5, color: C.sub, margin: '14px 0 0', lineHeight: 1.55 }}>Todavía no está disponible. Te avisamos por correo cuando puedas pedirla.</p>
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
            {autorizada ? `El tope lo fija ${autorizada.nombre}, la empresa que te autoriza. Si necesitas uno más alto, pídeselo directamente: ella lo cambia desde su panel y aquí se actualiza solo.`
              : 'El tope lo fija la empresa que te autorice. Mientras no tengas una empresa, no puedes recibir ni enviar dinero.'}
          </p>
          <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.55, margin: '10px 0 0' }}>Cuentan los envíos a llaves Bre-B y a cuentas de banco del mes calendario. Enviar a otra persona Lincoin no lo consume.</p>
          {!autorizada && !pendiente && <BotonPrimario onClick={abrirAutorizacion} style={{ marginTop: 16, width: '100%' }}>Pedir autorización</BotonPrimario>}
        </Drawer>
      )}

      {panel === 'perfil' && (
        <Drawer titulo="Detalles de mi cuenta" sub="Tus datos, tu ID Lincoin y la empresa que te autoriza." onCerrar={cerrarPanel}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {([['Nombre', auth?.datos?.nombre || nombre], ['Correo', String(cu.email ?? '')], ['ID Lincoin', codigo], ['Cuenta', 'Lincoin · pesos colombianos (COP)'], ['Documento', auth?.datos?.docType ? `${TIPOS_DOC.find(t => t[0] === auth?.datos?.docType)?.[1] ?? auth?.datos?.docType} ${auth?.datos?.docNumber ?? ''}` : 'Sin registrar']] as const).map(([k, v]) => (
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
            <Etiqueta>EMPRESA QUE TE AUTORIZA</Etiqueta>
            <div style={{ background: autorizada ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${autorizada ? 'rgba(74,222,128,0.3)' : C.borde}`, borderRadius: 12, padding: '14px 16px' }}>
              {autorizada ? (<>
                <div className="flex items-center justify-between" style={{ gap: 10 }}><p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{autorizada.nombre}</p><Pill verde>AUTORIZADA</Pill></div>
                <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0' }}>Tope mensual: <b style={{ color: C.text }}>{limiteMensual ? `${fmt(limiteMensual)} COP` : 'sin tope'}</b> · usado {fmt(retiradoMes)}</p>
                {auth?.datos?.at && <p style={{ fontSize: 12.5, color: C.tenue, margin: '4px 0 0' }}>Desde {fecha(auth.datos.at)}</p>}
              </>) : pendiente ? (<>
                <div className="flex items-center justify-between" style={{ gap: 10 }}><p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{pendiente.nombre}</p><Pill>EN REVISIÓN</Pill></div>
                <p style={{ fontSize: 13.5, color: C.sub, margin: '6px 0 0', lineHeight: 1.5 }}>La empresa está revisando tus datos y tus documentos. Cuando apruebe, aquí aparece tu tope.</p>
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

          <BotonSecundario onClick={() => setConfirmarSalir(true)} style={{ width: '100%', marginTop: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><LogOut size={15} /> Cerrar sesión</BotonSecundario>
        </Drawer>
      )}

      {panel === 'autorizacion' && (
        <Drawer titulo={autorizada ? 'Cambiar de empresa' : 'Pedir autorización'} sub={autorizada ? `Hoy te autoriza ${autorizada.nombre}. La nueva empresa la reemplaza cuando apruebe.` : 'La empresa revisa tus datos y tus documentos, y te aprueba con un tope mensual.'} onCerrar={cerrarPanel}>
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
                  <Selector value={solDocType} onChange={e => setSolDocType(e.target.value)}>
                    {TIPOS_DOC.map(([k, n]) => <option key={k} value={k} style={{ color: '#000' }}>{k} · {n}</option>)}
                  </Selector>
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Etiqueta>{`TU ${docNombre.toUpperCase()} POR LAS DOS CARAS`}</Etiqueta>
                <Adjunto titulo={esPasaporte ? 'Página de la foto' : 'Frente'} ayuda="Foto nítida, sin reflejos, o PDF" archivo={solArchivos.doc_frente} onElegir={f => elegirAdjunto('doc_frente', f)} apagado={solOcupado} />
                <Adjunto titulo={esPasaporte ? 'Página de la firma' : 'Reverso'} ayuda="Foto nítida, sin reflejos, o PDF" archivo={solArchivos.doc_reverso} onElegir={f => elegirAdjunto('doc_reverso', f)} apagado={solOcupado} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Etiqueta>DOCUMENTOS TRIBUTARIOS</Etiqueta>
                <Adjunto titulo="RUT" ayuda="PDF de la DIAN o foto, actualizado" archivo={solArchivos.rut} onElegir={f => elegirAdjunto('rut', f)} apagado={solOcupado} />
                <Adjunto titulo="Cámara de comercio" ayuda="Certificado de matrícula mercantil, de menos de 30 días" archivo={solArchivos.camara_comercio} onElegir={f => elegirAdjunto('camara_comercio', f)} apagado={solOcupado} />
                <Adjunto titulo="Declaración de renta" ayuda="La del último año gravable" archivo={solArchivos.declaracion_renta} onElegir={f => elegirAdjunto('declaracion_renta', f)} apagado={solOcupado} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Etiqueta>ORIGEN DE TUS FONDOS</Etiqueta>
                <p style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: '-2px 0 0' }}>¿De dónde viene el dinero que vas a manejar en Lincoin?</p>
                <Selector value={solFuente} onChange={e => { setSolFuente(e.target.value); setSolError(null); }} style={{ color: solFuente ? C.text : C.sub }}>
                  <option value="" style={{ color: '#000' }}>Elige una opción…</option>
                  {FUENTES_FONDOS.map(([k, n]) => <option key={k} value={k} style={{ color: '#000' }}>{n}</option>)}
                </Selector>
                <Campo value={solDetalle} onChange={e => setSolDetalle(e.target.value.slice(0, 300))} placeholder={solFuente === 'otro' ? 'Cuéntanos de dónde viene' : 'Detalle (opcional): empresa, actividad o negocio'} />
                <Casilla marcada={solLicito} onCambiar={v => { setSolLicito(v); setSolError(null); }}>Declaro que mis recursos provienen de actividades lícitas y que la información y los documentos que entrego son verdaderos.</Casilla>
              </div>

              {solError && <p style={{ fontSize: 13.5, color: NARANJA, margin: 0, lineHeight: 1.5 }}>{solError}</p>}
              <BotonPrimario type="submit" disabled={solOcupado}>{solOcupado ? (solProgreso ?? 'Enviando…') : 'Enviar solicitud'}</BotonPrimario>
              <p style={{ fontSize: 12, color: C.tenue, margin: 0, lineHeight: 1.5 }}>Tus documentos solo los ven la empresa a la que le pides autorización y el equipo de cumplimiento de Lincoin.</p>
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
