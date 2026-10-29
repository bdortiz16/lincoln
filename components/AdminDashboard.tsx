import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CodeInput } from './CodeInput';
import { 
  Users, 
  FileText, 
  Search, 
  Check, 
  X, 
  AlertCircle, 
  Download, 
  Eye, 
  LogOut, 
  UserCheck, 
  Building2, 
  CreditCard, 
  Landmark, 
  Settings, 
  BarChart3, 
  Save, 
  Trash2, 
  ToggleLeft, 
  ToggleRight, 
  RefreshCw, 
  CheckCircle, 
  FileIcon, 
  ChevronRight, 
  Copy, 
  TrendingUp, 
  Globe, 
  ArrowRight, 
  Plus, 
  PieChart, 
  UserPlus, 
  Menu, 
  Activity, 
  AlertTriangle, 
  Wifi, 
  WifiOff, 
  Edit2, 
  UploadCloud, 
  QrCode, 
  Palette, 
  Power, 
  Ban, 
  Unlock, 
  ShieldAlert, 
  Megaphone, 
  Tag, 
  DollarSign, 
  ChevronDown, 
  ChevronUp, 
  Link as LinkIcon, 
  Bitcoin, 
  Filter, 
  ArrowUpDown, 
  Calendar, 
  MoreVertical, 
  Database, 
  FileSpreadsheet, 
  TrendingDown, 
  Printer, 
  Upload, 
  Shield, 
  Key, 
  EyeOff, 
  Lock, 
  Smartphone, 
  MapPin, 
  Target, 
  Briefcase, 
  Layout, 
  Image as ImageIcon, 
  Gift, 
  Cloud, 
  FileSearch, 
  HardDrive,
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  Vault
} from 'lucide-react';
import { Logo } from './Logo';
import { RatesPanel } from './AdminPersonas/sections/RatesPanel';
import { AdminGasFreeSection } from './AdminGasFreeSection';
import { AdminMonitor } from './AdminMonitor';
import { AdminTreasuryPanel } from './AdminTreasuryPanel';
import { AdminSecurityCenter } from './AdminSecurityCenter';
import { AdminCommandCenter } from './AdminCommandCenter';
import { AdminAccessPolicy } from './AdminAccessPolicy';
import { AdminPasskeys } from './AdminPasskeys';
import { AdminStepUp } from './AdminStepUp';
import { AdminLoginAlerts } from './AdminLoginAlerts';
import { AdminKumplo } from './AdminKumplo';
import { AdminTusdatos } from './AdminTusdatos';
import { AdminCompliance } from './AdminCompliance';
import { AdminLincoinRisk } from './AdminLincoinRisk';
import { AdminSarblock } from './risk/AdminSarblock';
import { AdminClientes } from './AdminClientes';
import { AdminReconcile } from './AdminReconcile';
import { AdminContabilidad } from './AdminContabilidad';
import { AdminLimitesEnvio } from './AdminLimitesEnvio';
import { AdminCupos } from './AdminCupos';
import { AdminOperadores } from './AdminOperadores';
import { AdminOtcCierres } from './AdminOtcCierres';
import { AdminGowd } from './AdminGowd';
import { sonarCampana, campanaActiva } from './campanaOtc';
import { Zap, ArrowLeftRight, ArrowLeft, Info, Link2, MessageSquare, Clock, Paperclip } from 'lucide-react';
import { pedirAdmin, pedirAutorizaciones } from './adminApi';
import { useMovimientosCliente } from './useMovimientosCliente';
import { descargarMovimientosCliente, reversosDe } from './excelMovimientosCliente';
import { AdminEquipo } from './AdminEquipo';
import { CollectionWalletCard } from './CollectionWalletCard';
import type { AdminProfile } from './AdminPersonas/lib/adminAuth';
import { FlagImg, flagUrl } from './FlagImg';
import { PaletteChooser } from './PaletteChooser';
import { useExchangeRates } from '../context/ExchangeRateContext'; 
import { useSystemConfig, Coupon } from '../context/SystemConfigContext'; 
import { useDatabase, AdminUser, BankDetail, Transaction, User, TreasuryAccount } from '../context/DatabaseContext';
import { useBusquedaClientes, conLocales } from './useBusquedaClientes';

const SURL_ADMIN = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SKEY_ADMIN = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

interface AdminDashboardProps {
  onLogout: () => void;
  // Rol del miembro en el equipo (mi_acceso). Solo decide qué se MUESTRA: lo
  // que cada rol puede pedir lo exige el servidor.
  rol?: string;
  // Países del miembro (mi_acceso): qué billeteras se le ofrecen.
  paises?: string[];
}

// El rol Tesorería ve solo Clientes y Tesorería (con sus Billeteras COP).
const TABS_TESORERIA = ['clients', 'treasury', 'cargues', 'lincoin'];

interface SystemAlert {
    id: string;
    type: 'warning' | 'error' | 'info';
    title: string;
    description: string;
    action?: string;
}

const CurrencyFlag = ({ code }: { code: string }) => (
    <FlagImg code={code} className="w-5 h-3.5 object-cover rounded-sm inline-block" />
);

const BANK_COUNTRIES = ['Colombia', 'Perú', 'Chile', 'México', 'Brasil', 'Venezuela', 'Estados Unidos'];

const NumericInput = ({ value, onChange, className, suffix, prefix }: { value: number, onChange: (val: number) => void, className?: string, suffix?: string, prefix?: string }) => {
  const [localVal, setLocalVal] = useState(value.toString());

  useEffect(() => {
      if (parseFloat(localVal) !== value) {
          setLocalVal(value.toString());
      }
  }, [value]);

  const handleBlur = () => {
      const num = parseFloat(localVal);
      if (!isNaN(num)) onChange(num);
      else setLocalVal(value.toString());
  };

  return (
      <div className="flex items-center gap-2 w-full">
          {prefix && <span className="text-slate-500 font-bold">{prefix}</span>}
          <input 
            type="number" 
            value={localVal} 
            onChange={(e) => setLocalVal(e.target.value)} 
            onBlur={handleBlur}
            className={className} 
            step="any" 
          />
          {suffix && <span className="text-slate-500 font-bold">{suffix}</span>}
      </div>
  );
};

const StatCard: React.FC<{ title: string; value: string | number; icon: React.ElementType; color: string; onClick?: () => void; subValue?: string; subColor?: string; loading?: boolean }> = ({ title, value, icon: Icon, color, onClick, subValue, subColor, loading }) => (
  <div onClick={onClick} className="bg-white p-4 md:p-6 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between cursor-pointer hover:shadow-md transition-shadow">
      <div>
          <p className="text-xs md:text-sm text-slate-500 font-medium mb-1">{title}</p>
          {loading ? (
              <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
          ) : (
              <p className="text-xl md:text-2xl font-bold text-slate-800">{value}</p>
          )}
          {subValue && <p className={`text-[10px] font-bold mt-1 ${subColor || 'text-slate-400'}`}>{loading ? 'Cargando…' : subValue}</p>}
      </div>
      <div className={`w-10 h-10 md:w-12 md:h-12 rounded-lg ${color} text-white flex items-center justify-center`}>
          <Icon size={20} />
      </div>
  </div>
);

// Simple CSS Bar Chart Component
const SimpleBarChart: React.FC<{ data: { label: string; value: number; percentage: number }[] }> = ({ data }) => (
  <div className="h-64 flex items-end justify-between gap-2 w-full mt-4">
    {data.map((item, i) => (
      <div key={i} className="flex flex-col items-center gap-2 flex-1 group h-full justify-end">
        <div className="w-full bg-slate-50 rounded-t-lg relative h-full flex items-end overflow-hidden hover:bg-slate-100 transition-colors">
           <div 
             style={{ height: `${item.percentage}%` }} 
             className="w-full bg-[#0C0E0D] opacity-90 group-hover:opacity-100 group-hover:bg-[#4ADE80] transition-all duration-500 rounded-t-sm relative"
           >
             <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] px-2 py-1 rounded pointer-events-none whitespace-nowrap shadow-lg transition-opacity z-10 font-bold">
               ${item.value.toLocaleString()}
             </div>
           </div>
        </div>
        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{item.label}</span>
      </div>
    ))}
  </div>
);

const AdminSidebarItem: React.FC<{ icon: React.ElementType; label: string; active?: boolean; badge?: number; onClick: () => void }> = ({ icon: Icon, label, active, badge, onClick }) => (
  <button onClick={onClick} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all duration-200 group ${active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
      <div className="flex items-center gap-3">
          <Icon size={20} className={active ? 'text-[#4ADE80]' : 'text-slate-500 group-hover:text-slate-300'} />
          <span className="text-sm font-medium">{label}</span>
      </div>
      {badge ? (<span className="bg-[#4ADE80] text-[#0C0E0D] text-[10px] font-bold px-2 py-0.5 rounded-full">{badge}</span>) : null}
  </button>
);

// Acordeón del menú: un renglón que abre sus subsecciones. Se abre solo
// cuando la pantalla activa es una de las suyas, y se puede plegar a mano.
const AdminSidebarGrupo: React.FC<{
  icon: React.ElementType; label: string; active: boolean; badge?: number;
  items: { key: string; icon: React.ElementType; label: string; active: boolean; badge?: number; onClick: () => void }[];
}> = ({ icon: Icon, label, active, badge, items }) => {
  const [abierto, setAbierto] = useState(true);
  useEffect(() => { if (active) setAbierto(true); }, [active]);
  return (
    <div>
      <button onClick={() => setAbierto(a => !a)} aria-expanded={abierto}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all duration-200 group ${active ? 'text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
        <div className="flex items-center gap-3">
          <Icon size={20} className={active ? 'text-[#4ADE80]' : 'text-slate-500 group-hover:text-slate-300'} />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {!abierto && badge ? (<span className="bg-[#4ADE80] text-[#0C0E0D] text-[10px] font-bold px-2 py-0.5 rounded-full">{badge}</span>) : null}
          <ChevronDown size={15} className={`text-slate-500 transition-transform duration-200 ${abierto ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {abierto && (
        <div className="mt-1 ml-[22px] pl-3 border-l border-white/10 space-y-1">
          {items.map(it => (
            <button key={it.key} onClick={it.onClick}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-all duration-200 group ${it.active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
              <div className="flex items-center gap-2.5">
                <it.icon size={16} className={it.active ? 'text-[#4ADE80]' : 'text-slate-500 group-hover:text-slate-300'} />
                <span className="text-[13px] font-medium">{it.label}</span>
              </div>
              {it.badge ? (<span className="bg-[#4ADE80] text-[#0C0E0D] text-[10px] font-bold px-2 py-0.5 rounded-full">{it.badge}</span>) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// File helper
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
};

// Nombre que se MUESTRA para cada pestaña. Sin esto la cabecera pintaba la
// clave interna en inglés ("Clients", "Treasury"…).
// Las dos secciones que agrupan varias pantallas. El orden es el de las
// pestañas: primero la pantalla que da el panorama, después el detalle.
const GRUPO_SEG = ['security', 'comando', 'monitoreo', 'auditoria', 'team'];
const GRUPO_CUMP = ['compliance', 'operadores', 'cupos', 'risk', 'sarblock', 'tusdatos', 'kumplo'];

const TAB_TITLES: Record<string, string> = {
  overview: 'Dashboard', clients: 'Clientes', treasury: 'Tesorería', cargues: 'Billetera', lincoin: 'Lincoin',
  team: 'Equipo Admin', reports: 'Reportes', marketing: 'Marketing', config: 'Configuración',
  banks: 'Bancos', rates: 'Tasas de Cambio', security: 'Seguridad', design: 'Diseño y Apariencia',
  gasfree: 'Custodia USDT', otcConfig: 'Contabilidad', fallos: 'Fallos',
  auditoria: 'Auditoría', monitoreo: 'Monitoreo', kumplo: 'Kumplo', comando: 'Centro de Comando',
  tusdatos: 'TusDatos', compliance: 'Cumplimiento', risk: 'Lincoin Risk', sarblock: 'Sarblock', cupos: 'Cupos por beneficiario', operadores: 'Operadores',
  otcCierres: 'Cierres OTC', gowd: 'Gowd · Brasil',
};

// Cómo se llama cada pestaña DENTRO de su sección. La primera no puede
// repetir el nombre de la sección ("Seguridad › Seguridad" no dice nada):
// se nombra por lo que realmente muestra.
const SUBTAB_TITLES: Record<string, string> = {
  security: 'Cuentas y accesos',
  compliance: 'Bandeja de casos',
};


// ─── Resultado de la conciliación Bre-B ─────────────────────────────
// Esto vivía en un window.alert del navegador: texto plano, blanco sobre gris,
// en una pantalla negra, y truncado justo donde estaba el dato que servía. Un
// resultado que se lee tres veces seguidas mientras se persigue una falla tiene
// que poder leerse.
//
// El detalle técnico va PLEGADO. Lo que importa arriba es cuánta plata se
// devolvió y cuántos envíos quedaron sin confirmar; el crudo del proveedor
// importa sólo cuando algo no cuadra, y entonces se abre.
// ── Aviso: correos que NO están llegando ──────────────────────────────
//
// Cuando una dirección rebota en duro o alguien marca un correo como spam,
// Resend la suprime y deja de mandarle -- pero a nosotros nos sigue
// contestando que aceptó el envío. La app le dice a esa persona "revisá tu
// correo" para un correo que nunca va a salir, y ella no puede avisarnos:
// el correo es justo el canal que se rompió.
//
// Por eso esto va ARRIBA Y EN ROJO, no escondido en una pestaña. Nos pasó
// con la cuenta de admin y tardamos horas en darnos cuenta; a un cliente le
// pasa igual y no tiene cómo contarlo.
const AvisoCorreos: React.FC = () => {
    const [lista, setLista] = useState<any[]>([]);
    const [abierto, setAbierto] = useState(false);

    const cargar = useCallback(async () => {
        try {
            const r = await pedirAdmin({ action: 'email_incidencias' });
            if (r?.ok && Array.isArray(r.incidencias)) setLista(r.incidencias);
        } catch { /* que no se caiga el panel por esto */ }
    }, []);

    useEffect(() => {
        cargar();
        // Cada 5 min. No hace falta más: una dirección rota lo sigue estando.
        const t = setInterval(cargar, 5 * 60 * 1000);
        return () => clearInterval(t);
    }, [cargar]);

    const resolver = async (email: string) => {
        // Optimista a propósito: el admin acaba de hacer el paso manual en
        // Resend y quiere ver que la fila se va. Si falla, vuelve en la
        // próxima carga.
        setLista((l) => l.filter((x) => String(x.email).toLowerCase() !== email.toLowerCase()));
        try { await pedirAdmin({ action: 'email_incidencia_resuelta', email }); } catch { cargar(); }
    };

    if (!lista.length) return null;
    const duros = lista.filter((x) => x.dureza === 'hard').length;

    return (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 overflow-hidden">
            <button onClick={() => setAbierto((v) => !v)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                <AlertTriangle size={18} className="text-red-600 shrink-0" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-red-900">
                        {lista.length === 1
                            ? 'Hay 1 dirección que no está recibiendo correos'
                            : `Hay ${lista.length} direcciones que no están recibiendo correos`}
                    </p>
                    <p className="text-xs text-red-700 mt-0.5">
                        {duros > 0
                            ? `${duros} con rebote definitivo. Esas personas no pueden recibir su código de acceso.`
                            : 'No pueden recibir su código de acceso.'}
                    </p>
                </div>
                <ChevronRight size={16} className={`text-red-500 shrink-0 transition-transform ${abierto ? 'rotate-90' : ''}`} />
            </button>

            {abierto && (
                <div className="border-t border-red-200 bg-white/60 px-4 py-3">
                    <p className="text-xs text-slate-600 mb-3">
                        Para reactivar una dirección hay que sacarla de la lista de supresión en
                        Resend (<span className="font-mono text-[11px]">Emails → Suppressions</span>) y después
                        marcarla acá. Este panel no lo hace solo: ese paso es manual en Resend.
                    </p>
                    <div className="space-y-1.5">
                        {lista.map((x) => (
                            <div key={x.email} className="flex items-center gap-3 py-1.5 border-b border-slate-100 last:border-0">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-900 truncate">{x.email}</p>
                                    <p className="text-[11px] text-slate-500 truncate">
                                        {x.dureza === 'hard' ? 'Rebote definitivo' : x.tipo === 'complained' ? 'Marcado como spam' : x.dureza === 'soft' ? 'Rebote pasajero' : x.tipo}
                                        {x.veces > 1 ? ` · ${x.veces} veces` : ''}
                                        {x.motivo ? ` · ${x.motivo}` : ''}
                                    </p>
                                </div>
                                <button
                                    onClick={() => resolver(x.email)}
                                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-300 rounded-lg px-2.5 py-1 shrink-0"
                                >
                                    Ya la reactivé
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const PanelConciliacion: React.FC<{ datos: any; onCerrar: () => void }> = ({ datos, onCerrar }) => {
    // Si el listado vino vacío, el crudo del proveedor es EL dato que hace
    // falta — no puede estar plegado esperando que a alguien se le ocurra
    // abrirlo.
    const [tecnico, setTecnico] = useState(!!datos?.listado && datos.listado.salidasBreb === 0);
    useEffect(() => {
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [onCerrar]);

    const TXT = '#F4F4F2', TXT2 = '#878E88', TXT3 = 'rgba(244,244,242,0.45)';
    const BORDE = 'rgba(255,255,255,0.09)', BORDE2 = 'rgba(255,255,255,0.14)';
    const VERDE = '#4ADE80', AMBAR = '#FBBF24', ROJO = '#F87171';
    const nf = (n: any) => Number(n ?? 0).toLocaleString('es-CO');

    const Cifra: React.FC<{ n: any; rotulo: string; color?: string }> = ({ n, rotulo, color }) => (
        <div style={{ flex: '1 1 110px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDE}`, borderRadius: 11, padding: '12px 13px' }}>
            <div style={{ fontSize: 21, fontWeight: 800, color: color ?? TXT, letterSpacing: '-0.5px' }}>{n}</div>
            <div style={{ fontSize: 10.5, color: TXT2, marginTop: 3, lineHeight: 1.35 }}>{rotulo}</div>
        </div>
    );

    return (
        <div onClick={onCerrar}
            style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={e => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: 560, maxHeight: '86vh', overflowY: 'auto',
                    background: '#0C0E0D', border: `1px solid ${BORDE2}`, borderRadius: 16,
                    boxShadow: '0 24px 70px rgba(0,0,0,0.7)', fontFamily: "'Archivo', system-ui, sans-serif",
                }}>
                <div style={{ padding: '18px 20px', borderBottom: `1px solid ${BORDE}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                        <h3 style={{ fontSize: 15.5, fontWeight: 800, color: TXT, margin: 0, letterSpacing: '-0.3px' }}>
                            {datos.error ? 'No se pudo conciliar'
                                : datos.automatica ? 'Se devolvió un envío' : 'Conciliación Bre-B'}
                        </h3>
                        {!datos.error && (
                            <p style={{ fontSize: 12, color: TXT2, margin: '5px 0 0' }}>
                                {nf(datos.revisados)} envíos revisados contra el proveedor.
                            </p>
                        )}
                    </div>
                    <button onClick={onCerrar} aria-label="Cerrar"
                        style={{ width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TXT2, background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDE}`, borderRadius: 9, cursor: 'pointer' }}>
                        <X size={15} />
                    </button>
                </div>

                {datos.error ? (
                    <p style={{ padding: '18px 20px', fontSize: 13, color: ROJO, lineHeight: 1.6, margin: 0 }}>{datos.error}</p>
                ) : (
                    <div style={{ padding: '16px 20px 20px' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <Cifra n={nf(datos.completados)} rotulo="confirmados como pagados" color={datos.completados ? VERDE : TXT} />
                            <Cifra n={nf(datos.devueltos)} rotulo="devueltos y reembolsados" color={datos.devueltos ? ROJO : TXT} />
                            <Cifra n={nf(datos.enCurso)} rotulo="siguen sin confirmar" color={datos.enCurso ? AMBAR : TXT} />
                        </div>

                        {datos.esperaFirma > 0 && (
                            <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 11, border: `1px solid ${AMBAR}44`, background: `${AMBAR}10` }}>
                                <div style={{ fontSize: 13.5, fontWeight: 700, color: TXT }}>
                                    {datos.esperaFirma} esperando firma
                                </div>
                                <div style={{ fontSize: 11.5, color: TXT2, marginTop: 3, lineHeight: 1.5 }}>
                                    Tu cuenta tiene firma múltiple activa: estos envíos no salen hasta que alguien
                                    los firme en el panel del proveedor. A las 24 h expiran y se revierten solos.
                                </div>
                            </div>
                        )}

                        {datos.devueltos > 0 && (
                            <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 11, border: `1px solid ${ROJO}33`, background: `${ROJO}10` }}>
                                <div style={{ fontSize: 13.5, fontWeight: 700, color: TXT }}>
                                    {nf(datos.plata)} COP reintegrados
                                </div>
                                <div style={{ fontSize: 11.5, color: TXT2, marginTop: 3, lineHeight: 1.5 }}>
                                    Monto y comisión volvieron al riel de cada cliente. Ya les llegó el aviso.
                                </div>
                            </div>
                        )}

                        {datos.vias.length > 0 && (
                            <div style={{ marginTop: 14 }}>
                                <p style={{ fontSize: 9.5, fontWeight: 700, color: TXT3, letterSpacing: '0.6px', textTransform: 'uppercase', margin: '0 0 7px' }}>
                                    Cómo se encontró cada envío
                                </p>
                                {datos.vias.map(([via, n]: [string, number]) => (
                                    <div key={via} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5, color: TXT2, padding: '3px 0' }}>
                                        <span style={{ color: TXT, fontWeight: 700, minWidth: 26 }}>{n}</span>
                                        <span>{via}</span>
                                    </div>
                                ))}
                                <p style={{ fontSize: 11, color: TXT3, margin: '7px 0 0', lineHeight: 1.5 }}>
                                    Los que dicen “solo por monto” se emparejaron porque había un único movimiento
                                    con ese importe exacto. Vale la pena mirarlos.
                                </p>
                            </div>
                        )}

                        {datos.motivos.length > 0 && (
                            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${BORDE}` }}>
                                <p style={{ fontSize: 9.5, fontWeight: 700, color: TXT3, letterSpacing: '0.6px', textTransform: 'uppercase', margin: '0 0 7px' }}>
                                    Por qué no se pudo confirmar el resto
                                </p>
                                {datos.motivos.map(([m, n]: [string, number]) => (
                                    <div key={m} style={{ display: 'flex', gap: 8, fontSize: 12, color: TXT2, padding: '4px 0', lineHeight: 1.5 }}>
                                        <span style={{ color: AMBAR, fontWeight: 700, minWidth: 26, flexShrink: 0 }}>{n}</span>
                                        <span style={{ wordBreak: 'break-word' }}>{m}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {(datos.listado || datos.muestra) && (
                            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BORDE}` }}>
                                <button onClick={() => setTecnico(v => !v)}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: TXT2, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                                    {tecnico ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                    Respuesta cruda del proveedor
                                </button>
                                {tecnico && (
                                    <pre style={{
                                        marginTop: 9, padding: '11px 12px', borderRadius: 9,
                                        background: '#070808', border: `1px solid ${BORDE}`, color: TXT2,
                                        fontSize: 10.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                        fontFamily: 'ui-monospace, Menlo, monospace', maxHeight: 240, overflowY: 'auto',
                                    }}>
{datos.listado ? `GET /wallets/transactions → ${datos.listado.ok ? 'OK' : 'FALLÓ'}\nsalidas Bre-B encontradas: ${datos.listado.salidasBreb}\n\n${datos.listado.crudo ?? '(sin cuerpo)'}` : ''}
{datos.muestra?.cuerpo ? `\n\nUna fila sin emparejar:\n${datos.muestra.cuerpo}` : ''}
                                    </pre>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onLogout, rol, paises }) => {
  const soloTesoreria = rol === 'tesoreria';
  // Sin rol (equipo sin configurar) se es dueño, igual que en el servidor.
  const esDueno = !rol || rol === 'dueno';
  const [activeTab, setActiveTab] = useState<'overview' | 'clients' | 'treasury' | 'cargues' | 'lincoin' | 'team' | 'reports' | 'marketing' | 'config' | 'banks' | 'rates' | 'security' | 'design' | 'gasfree' | 'otcConfig' | 'fallos' | 'auditoria' | 'monitoreo' | 'kumplo' | 'tusdatos' | 'compliance' | 'cupos' | 'operadores' | 'comando' | 'otcCierres' | 'gowd'>(soloTesoreria ? 'cargues' : 'overview');
  const [auditRows, setAuditRows] = useState<any[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [adminLogins, setAdminLogins] = useState<{ admins: any[]; activity: any[] } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [ratesSaved, setRatesSaved] = useState(false);
  const [showPaletteChooser, setShowPaletteChooser] = useState(false);
  
  // Clients Logic
  // Este admin gestiona SOLO empresas — las personas se administran en
  // /admin-personas. El filtro queda fijo en 'business'.
  const [clientTypeFilter, setClientTypeFilter] = useState<'personal' | 'business'>('business');
  const [clientKycFilter, setClientKycFilter] = useState<'all' | 'pending'>('all');
  const [clientSearch, setClientSearch] = useState('');
  const [clientRefreshing, setClientRefreshing] = useState(false);
  // Herramienta: liberar un correo "huérfano" — cuando un delete anterior
  // borró el perfil pero falló al borrar la cuenta de Supabase Auth (queda
  // sin poder iniciar sesión pero el correo sigue "tomado", así que un
  // registro nuevo con ese mismo correo — ej. para pasar de Personal a
  // Empresa — nunca se crea, sin ningún error visible al usuario).
  const [showOrphanTool, setShowOrphanTool] = useState(false);
  const [orphanEmail, setOrphanEmail] = useState('');
  const [orphanBusy, setOrphanBusy] = useState(false);
  const [orphanMsg, setOrphanMsg] = useState<string | null>(null);
  const freeOrphanEmail = async () => {
    const email = orphanEmail.trim().toLowerCase();
    if (!email) return;
    if (!window.confirm(`¿Liberar el correo ${email}? Esto borra cualquier perfil o cuenta de acceso que quede con ese correo, permanentemente.`)) return;
    setOrphanBusy(true); setOrphanMsg(null);
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      let jwt: string | null = null;
      try {
        const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; }
      } catch { /* sin sesión supabase */ }
      const authHeader = jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}`;
      const r = await fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: authHeader },
        body: JSON.stringify({ action: 'force_delete_by_email', email }),
      });
      const d = await r.json();
      if (d?.error) setOrphanMsg(`❌ ${d.error}`);
      else if (d?.note) setOrphanMsg(`ℹ️ ${d.note}`);
      else setOrphanMsg(`✅ Correo liberado — ya se puede registrar de nuevo.`);
      refreshData();
    } catch (e: any) {
      setOrphanMsg(`❌ ${e?.message ?? 'Error'}`);
    }
    setOrphanBusy(false);
  };
  const [selectedClient, setSelectedClient] = useState<User | null>(null);
  const [showBlockInput, setShowBlockInput] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Editar datos del cliente (nombre + tipo persona/empresa)
  const [editClientOpen, setEditClientOpen] = useState(false);
  const [editClientName, setEditClientName] = useState('');
  const [editClientRole, setEditClientRole] = useState<'personal' | 'business'>('personal');
  const [editClientSaving, setEditClientSaving] = useState(false);
  const openEditClient = () => {
    if (!selectedClient) return;
    setEditClientName(selectedClient.name ?? '');
    setEditClientRole(selectedClient.role === 'business' ? 'business' : 'personal');
    setEditClientOpen(true); setShowBlockInput(false); setShowDeleteConfirm(false);
  };
  const saveEditClient = async () => {
    if (!selectedClient || editClientSaving) return;
    const name = editClientName.trim();
    if (!name) { showToast('El nombre no puede quedar vacío.'); return; }
    setEditClientSaving(true);
    try {
      await updateUserProfile(selectedClient.id, { name, role: editClientRole });
      setSelectedClient({ ...selectedClient, name, role: editClientRole } as any);
      showToast('Cliente actualizado.');
      setEditClientOpen(false);
    } catch { showToast('No se pudo actualizar. Intenta de nuevo.'); }
    setEditClientSaving(false);
  };
  const [deletingUser, setDeletingUser] = useState(false);
  
  // Cargues Logic — acreditar saldo COP manualmente (temporal, mientras
  // Mouv apifica el conversor: el pago llega por el grupo cerrado y aquí se
  // refleja en el riel que corresponda: Saldo Lincoin / Bre-B / ACH).
  const [carguesSearch, setCarguesSearch] = useState('');
  // Se guarda el ID, no una copia del cliente: si se guardaba el objeto, la
  // tarjeta seguía mostrando el saldo del momento en que se seleccionó y no se
  // actualizaba tras un cargue (había que recargar la página). El objeto vivo
  // se deriva de allUsers más abajo.
  const [carguesClientId, setCarguesClientId] = useState<string | null>(null);
  const [carguesRail, setCarguesRail] = useState<'COP' | 'COP_BREB' | 'COP_ACH'>('COP');
  const [carguesAmount, setCarguesAmount] = useState('');
  const [carguesNote, setCarguesNote] = useState('');
  const [carguesDir, setCarguesDir] = useState<'credit' | 'debit'>('credit');
  // Un descuento que corrige un cargue hecho por error: a qué cargue revierte.
  // Así Contabilidad lo resta de ese cargue y de su utilidad, sin descuadre.
  const [carguesReversaDe, setCarguesReversaDe] = useState('');
  const [carguesRecordOnly, setCarguesRecordOnly] = useState(false);
  const [carguesBusy, setCarguesBusy] = useState(false);
  const [carguesMsg, setCarguesMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [carguesConfirm, setCarguesConfirm] = useState<{ raw: number } | null>(null);
  // "Cargar de todos modos" cuando el cargue excede lo disponible en la bolsa
  // (protección contra sobre-acreditar más de lo que respalda el proveedor).
  const [carguesOverride, setCarguesOverride] = useState(false);
  // Contabilidad del cargue: el COP se DERIVA de la operación real en vez de
  // escribirse a mano, y la utilidad queda como dato del movimiento.
  const [acctOn, setAcctOn] = useState(true);
  const [acctUsdtGross, setAcctUsdtGross] = useState('');
  const [acctUsdtNet, setAcctUsdtNet] = useState('');
  const [acctSellRate, setAcctSellRate] = useState('');
  const [acctClientRate, setAcctClientRate] = useState('');
  const [acctFeeBearer, setAcctFeeBearer] = useState<'lincoin' | 'cliente'>('lincoin');
  const [cargueOtp, setCargueOtp] = useState('');
  // Saldo REAL de la wallet compartida de Mouv (lo que hay disponible para
  // cargar a los clientes). Se lee del endpoint confirmado /wallets/balance.
  const [mouvPool, setMouvPool] = useState<{ loading: boolean; total?: number | null; breb?: number | null; ach?: number | null; error?: string } | null>(null);
  // Saldo COP de la tesorería Finity (respalda el riel ACH), análogo a Mouv.
  const [finityPool, setFinityPool] = useState<{ loading: boolean; cop?: number | null; usdt?: number | null; error?: string } | null>(null);
  // Resolver conversión trabada: el USDT llegó al proveedor pero el COP no se
  // acreditó → se acredita a mano y se cierra el movimiento.
  const [stuckRef, setStuckRef] = useState('');
  const [stuckRail, setStuckRail] = useState<'COP' | 'COP_ACH' | 'COP_BREB'>('COP');
  const [stuckPreview, setStuckPreview] = useState<any>(null);
  const [stuckList, setStuckList] = useState<any[] | null>(null);
  const [stuckBusy, setStuckBusy] = useState(false);
  const [stuckMsg, setStuckMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const callGasfreeAdmin = async (bodyObj: Record<string, unknown>) => {
    const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
    const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
    let jwt: string | null = null;
    try {
      const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
      if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; }
    } catch { /* sin sesión */ }
    const authHeader = jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}`;
    const r = await fetch(`${SURL}/functions/v1/gasfree`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: authHeader },
      body: JSON.stringify(bodyObj),
    });
    return r.json();
  };
  const previewStuck = async () => {
    if (!stuckRef.trim()) return;
    setStuckBusy(true); setStuckMsg(null); setStuckPreview(null);
    try {
      const r = await callGasfreeAdmin({ action: 'admin_settle_convert', txId: stuckRef.trim(), preview: true });
      if (r?.error) setStuckMsg({ ok: false, text: r.error });
      else { setStuckPreview(r); setStuckRail((r.currency && ['COP','COP_ACH','COP_BREB'].includes(r.currency)) ? r.currency : 'COP'); }
    } catch (e: any) { setStuckMsg({ ok: false, text: e?.message ?? 'Error' }); }
    setStuckBusy(false);
  };
  const listStuck = async (userId: string) => {
    setStuckBusy(true); setStuckMsg(null); setStuckPreview(null); setStuckList(null);
    try {
      const r = await callGasfreeAdmin({ action: 'admin_settle_convert', list: true, userId });
      if (r?.error) setStuckMsg({ ok: false, text: r.error });
      else setStuckList(Array.isArray(r?.items) ? r.items : []);
    } catch (e: any) { setStuckMsg({ ok: false, text: e?.message ?? 'Error' }); }
    setStuckBusy(false);
  };
  const settleStuck = async () => {
    if (!stuckPreview?.txId) return;
    if (!window.confirm(`¿Acreditar ${Number(stuckPreview.owedCop).toLocaleString('es-CO')} COP a ${stuckPreview.email ?? stuckPreview.userId} en ${stuckRail} y cerrar el movimiento?`)) return;
    setStuckBusy(true); setStuckMsg(null);
    try {
      const r = await callGasfreeAdmin({ action: 'admin_settle_convert', txId: stuckPreview.txId, rail: stuckRail });
      if (r?.error) setStuckMsg({ ok: false, text: r.error });
      else if (r?.already) setStuckMsg({ ok: true, text: r.message ?? 'Ya estaba acreditada.' });
      else setStuckMsg({ ok: true, text: `✅ Acreditados ${Number(r.credited).toLocaleString('es-CO')} COP en ${r.rail}. Movimiento cerrado.` });
      setStuckPreview(null); setStuckRef('');
    } catch (e: any) { setStuckMsg({ ok: false, text: e?.message ?? 'Error' }); }
    setStuckBusy(false);
  };
  const loadMouvPool = async () => {
    setMouvPool({ loading: true });
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      let jwt: string | null = null;
      try {
        const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; }
      } catch { /* sin sesión */ }
      const authHeader = jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}`;
      const r = await fetch(`${SURL}/functions/v1/mouv-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: authHeader },
        body: JSON.stringify({ action: 'treasury_balances' }),
      });
      const d = await r.json();
      if (d?.error) setMouvPool({ loading: false, error: d.error });
      else setMouvPool({ loading: false, total: d.total ?? d.cop ?? null, breb: d.breb ?? null, ach: d.ach ?? null });
    } catch (e: any) {
      setMouvPool({ loading: false, error: e?.message ?? 'Error de red' });
    }
  };

  // ── Resolver una dispersión sin confirmar ────────────────────────────────
  // Mientras la consulta de estado del proveedor no funcione, la única fuente
  // de verdad es su consola, y quien la mira es una persona. Estos dos botones
  // son lo que convierte eso en algo de un clic en vez de una llamada a la API
  // armada a mano — que es lo que hizo que un reembolso quedara sin hacer.
  const [resolviendo, setResolviendo] = useState<string | null>(null);

  const llamarMouv = async (cuerpo: Record<string, unknown>) => {
    const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
    const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
    let jwt: string | null = null;
    try {
      const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
      if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; }
    } catch { /* sin sesión */ }
    // CON try/catch Y TIMEOUT. Sin esto, un corte de red dejaba la promesa
    // rechazada sin atrapar: `resolviendo`/`conciliando` nunca volvían a false y
    // los botones de esa fila -- Sí se pagó, Vincular ID, Reembolsar, Ya la
    // devolví -- quedaban en gris y deshabilitados hasta recargar la página,
    // sin un solo mensaje que dijera qué pasó.
    try {
      const r = await fetch(`${SURL}/functions/v1/mouv-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}` },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(90000),
      });
      const t = await r.text();
      if (!t) return { ok: false, message: 'El servicio no respondió. Probá de nuevo.' };
      try { return JSON.parse(t); } catch { return { ok: false, message: `Respuesta no válida del servicio (HTTP ${r.status}).` }; }
    } catch (e: any) {
      return {
        ok: false,
        message: e?.name === 'TimeoutError'
          ? 'El proveedor tardó demasiado. No se cambió nada; volvé a intentarlo.'
          : `No se pudo conectar: ${String(e?.message ?? e)}`,
      };
    }
  };

  const devolverDispersion = async (t: any) => {
    const ref = t.providerRef ?? t.raw_data?.providerRef ?? '';
    const motivo = window.prompt(
      `Reembolsar ${Number(t.amount).toLocaleString('es-CO')} al cliente y marcar la dispersión como rechazada.\n\n` +
      `Hacelo SOLO si la viste devuelta en la consola del proveedor. Si en realidad se pagó, ` +
      `estarías devolviendo plata por una transferencia que sí salió: el cliente cobraría dos veces.\n\n` +
      `Motivo (queda auditado):`,
      ref ? `Devuelta por el proveedor · ref ${ref}` : 'Devuelta por el proveedor');
    if (!motivo) return;
    setResolviendo(t.id);
    const r = await llamarMouv({ action: 'force_return', txId: t.id, reason: motivo });
    setResolviendo(null);
    if (r?.ok) { alert(r.already ? 'Ya estaba reembolsada.' : `Reembolsados ${Number(r.refundCop ?? 0).toLocaleString('es-CO')} al riel del cliente.`); refreshData?.(); }
    else alert(r?.error ? `No se pudo: ${r.error}` : 'No se pudo completar la devolución.');
  };

  // Conciliar TODOS los envíos Bre-B contra Mouv, sin esperar a que cada
  // cliente abra su app. Consulta GET /wallets/transactions/:id por cada uno y
  // aplica el veredicto real: completa los exitosos y REEMBOLSA los devueltos.
  const [conciliando, setConciliando] = useState(false);
  const [resConciliar, setResConciliar] = useState<any>(null);
  const conciliarBreb = async () => {
    setConciliando(true);
    const r = await llamarMouv({ action: 'reconcile_breb', todos: true });
    setConciliando(false);
    if (!r?.ok) { setResConciliar({ error: r?.message || r?.error || 'No se pudo conciliar.' }); return; }

    const res = (r.results ?? []) as any[];
    const dev = res.filter(x => x.result === 'refunded');
    const comp = res.filter(x => x.result === 'completed');
    const quedan = res.filter(x => x.result === 'still_processing' || x.result === 'sin_confirmar_revisar');
    // Esperando firma es un caso aparte y accionable: hay que ir a firmar al
    // panel del proveedor, y si nadie firma en 24 h el envío expira solo.
    const firma = res.filter(x => x.result === 'espera_firma').length;

    // CÓMO se emparejó cada uno. No es lo mismo la referencia exacta que
    // "único con ese monto": lo segundo hay que poder mirarlo antes de confiar.
    const vias = new Map<string, number>();
    for (const x of res) if (x?.campoRef && x.campoRef !== 'providerRef') vias.set(x.campoRef, (vias.get(x.campoRef) ?? 0) + 1);

    // POR QUÉ no hubo veredicto. "Sin respuesta del proveedor" a secas tapa por
    // igual una ruta caída, una llave sin permiso, un id que Mouv no reconoce y
    // una fila nuestra incompleta — cuatro problemas con cuatro arreglos.
    const motivos = new Map<string, number>();
    let muestra: any = null;
    for (const x of res) {
      if (!x?.diag?.motivo) continue;
      motivos.set(x.diag.motivo, (motivos.get(x.diag.motivo) ?? 0) + 1);
      if (!muestra) muestra = x;
    }

    setResConciliar({
      revisados: r.checked ?? res.length,
      esperaFirma: firma,
      completados: comp.length,
      devueltos: dev.length,
      plata: dev.reduce((n, x) => n + Number(x.refund ?? 0), 0),
      enCurso: quedan.length,
      vias: [...vias.entries()],
      motivos: [...motivos.entries()],
      listado: r.listado ?? null,
      muestra: muestra?.diag ?? null,
    });
    refreshData?.();
  };

  // Pegar el ID que muestra la consola del proveedor (TX-PG-483AC9). No cambia
  // el estado ni mueve plata: solo vincula, y de paso consulta el estado real.
  const vincularRef = async (t: any) => {
    const ref = window.prompt(
      'Pegá el ID de este envío tal como aparece en la consola del proveedor.\n\n' +
      'Ejemplo: TX-PG-483AC9\n\n' +
      'Esto NO confirma ni devuelve nada: solo deja el envío enlazado para poder ' +
      'consultar su estado y bajar su comprobante.', '');
    if (!ref || !ref.trim()) return;
    setResolviendo(t.id);
    const r = await llamarMouv({ action: 'vincular_referencia', txId: t.id, providerRef: ref.trim() });
    setResolviendo(null);
    if (!r?.ok) { alert(r?.message || r?.error || 'No se pudo vincular.'); return; }
    const est = r.estadoProveedor
      ? `El proveedor lo reporta como: ${r.estadoProveedor}.`
      : 'Vinculado, pero el proveedor todavía no devuelve su estado.';
    alert(`ID guardado.\n\n${est}`);
    refreshData?.();
  };

  // Para las que ya se devolvieron A MANO. Cierra el caso SIN acreditar nada:
  // la plata ya la movió una persona, y acreditar acá sería el doble reembolso
  // que esto viene a evitar.
  const marcarReembolsada = async (t: any) => {
    const motivo = window.prompt(
      `Dar por cerrada esta dispersión de ${Number(t.amount).toLocaleString('es-CO')} porque ya le devolviste el saldo al cliente por fuera del sistema.\n\n` +
      `NO se acredita nada acá — se asume que ya lo hiciste vos. Sirve para que la conciliación ` +
      `no vuelva a reembolsarlo cuando el proveedor confirme que fue devuelta.\n\n` +
      `Motivo (queda auditado):`,
      'Devuelta por el proveedor · saldo ya reintegrado a mano');
    if (!motivo) return;
    setResolviendo(t.id);
    const r = await llamarMouv({ action: 'marcar_reembolso_externo', txId: t.id, reason: motivo });
    setResolviendo(null);
    if (r?.ok) { alert(r.already ? 'Ya estaba marcada.' : 'Marcada. La conciliación ya no la va a tocar.'); refreshData?.(); }
    else alert(r?.message || r?.error || 'No se pudo marcar.');
  };

  // ── Conciliación automática de Bre-B ──────────────────────────────
  // NADIE estaba corriendo esto. La conciliación por cliente depende de que
  // ESE cliente abra su app, y el botón depende de que alguien se acuerde de
  // apretarlo. Con el listado de Mouv llegando con retraso, un clic único casi
  // siempre cae temprano y no encuentra nada — que es exactamente lo que pasó.
  //
  // Corre sola cada 3 minutos con el panel abierto, en silencio. Solo
  // interrumpe si movió plata: un reembolso automático es algo que el operador
  // tiene que enterarse el mismo momento, lo demás es ruido.
  const autoConcAt = useRef(0);
  useEffect(() => {
    let vivo = true;
    const correr = async () => {
      if (document.hidden) return;
      if (Date.now() - autoConcAt.current < 170000) return;
      autoConcAt.current = Date.now();
      const r = await llamarMouv({ action: 'reconcile_breb', todos: true });
      if (!vivo || !r?.ok) return;
      const res = (r.results ?? []) as any[];
      const dev = res.filter((x: any) => x.result === 'refunded');
      const comp = res.filter((x: any) => x.result === 'completed');
      if (dev.length || comp.length) refreshData?.();
      // Solo la plata devuelta justifica cortarle la pantalla a alguien.
      if (dev.length) {
        setResConciliar({
          revisados: r.checked ?? res.length,
          completados: comp.length,
          devueltos: dev.length,
          plata: dev.reduce((n: number, x: any) => n + Number(x.refund ?? 0), 0),
          enCurso: res.filter((x: any) => x.result === 'still_processing' || x.result === 'sin_confirmar_revisar').length,
          esperaFirma: res.filter((x: any) => x.result === 'espera_firma').length,
          vias: [], motivos: [], listado: r.listado ?? null, muestra: null,
          automatica: true,
        });
      }
    };
    const t = setInterval(correr, 180000);
    const alVolver = () => { correr(); };
    document.addEventListener('visibilitychange', alVolver);
    correr();
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', alVolver); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmarDispersion = async (t: any) => {
    const ref = t.providerRef ?? t.raw_data?.providerRef ?? '';
    if (!window.confirm(
      `Marcar esta dispersión como pagada.\n\n` +
      `Hacelo solo si la viste exitosa en la consola del proveedor${ref ? ` (ref ${ref})` : ''}.\n\n` +
      `Queda registrada como confirmación manual, con tu usuario: un pagado puesto por una persona ` +
      `no es lo mismo que uno confirmado por el proveedor.`)) return;
    setResolviendo(t.id);
    const r = await llamarMouv({ action: 'confirmar_dispersion', txId: t.id });
    setResolviendo(null);
    if (r?.ok) { alert(r.already ? `Ya estaba en ${r.already}.` : 'Marcada como completada.'); refreshData?.(); }
    else alert(r?.error ? `No se pudo: ${r.error}` : 'No se pudo confirmar.');
  };

  const loadFinityPool = async () => {
    setFinityPool({ loading: true });
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      let jwt: string | null = null;
      try {
        const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; }
      } catch { /* sin sesión */ }
      const authHeader = jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}`;
      const r = await fetch(`${SURL}/functions/v1/finity-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: authHeader },
        body: JSON.stringify({ action: 'treasury_balances' }),
      });
      const d = await r.json();
      if (d?.error) setFinityPool({ loading: false, error: d.error });
      else setFinityPool({ loading: false, cop: d.cop ?? null, usdt: d.usdt ?? null, error: d.ok === false ? (d.error ?? 'Finity no respondió') : undefined });
    } catch (e: any) {
      setFinityPool({ loading: false, error: e?.message ?? 'Error de red' });
    }
  };

  const loadAudit = async () => {
    setAuditLoading(true);
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      let jwt: string | null = null;
      try { const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token')); if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; } } catch { /* */ }
      const r = await fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}` },
        body: JSON.stringify({ action: 'list_audit', limit: 300 }),
      });
      const d = await r.json();
      setAuditRows(Array.isArray(d?.audit) ? d.audit : []);
    } catch { setAuditRows([]); }
    setAuditLoading(false);
  };

  const loadAdminLogins = async () => {
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      let jwt: string | null = null;
      try { const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token')); if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; } } catch { /* */ }
      const r = await fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}` },
        body: JSON.stringify({ action: 'admin_logins' }),
      });
      const d = await r.json();
      setAdminLogins({ admins: Array.isArray(d?.admins) ? d.admins : [], activity: Array.isArray(d?.activity) ? d.activity : [] });
    } catch { setAdminLogins({ admins: [], activity: [] }); }
  };

  useEffect(() => {
    if ((activeTab === 'cargues' || activeTab === 'treasury' || activeTab === 'lincoin') && !mouvPool) loadMouvPool();
    if ((activeTab === 'cargues' || activeTab === 'treasury' || activeTab === 'lincoin') && !finityPool) loadFinityPool();
    if (activeTab === 'auditoria') { loadAudit(); loadAdminLogins(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // En pantalla va el proveedor: el saldo COP_BREB es la cuenta en Mouv y COP_ACH la de Finity.
  const railLabelOf = (r: string) => (r === 'COP' ? 'Saldo Lincoin' : r === 'COP_BREB' ? 'Mouv' : 'Finity');

  // Paso 1: validar y abrir la ventana de confirmación propia.
  // Cuenta de la operación. Se calcula igual que en el servidor solo para
  // MOSTRARLA; la cifra que se acredita la vuelve a calcular el servidor.
  const acctCalc = (() => {
    const n = (v: string) => { const x = parseFloat(String(v).replace(/[^\d.]/g, '')); return Number.isFinite(x) ? x : 0; };
    const usdtGross = n(acctUsdtGross), usdtNet = n(acctUsdtNet);
    const sellRate = n(acctSellRate), clientRate = n(acctClientRate);
    const listo = usdtGross > 0 && usdtNet > 0 && sellRate > 0 && clientRate > 0 && usdtNet <= usdtGross;
    const feeUsdt = Math.max(0, Number((usdtGross - usdtNet).toFixed(6)));
    const base = acctFeeBearer === 'lincoin' ? usdtGross : usdtNet;
    const revenueCop = Math.round(usdtNet * sellRate);
    const copToClient = Math.round(base * clientRate);
    const feeCostCop = Math.round(feeUsdt * sellRate);
    // La comisión Bre-B (0,10%) se descuenta de lo que recibe el cliente.
    const feeBreb = carguesRail === 'COP_BREB' && carguesDir === 'credit' && !carguesRecordOnly
      ? Math.round(copToClient * 0.10 / 100) : 0;
    const creditedCop = copToClient - feeBreb;
    return { listo, usdtGross, usdtNet, feeUsdt, sellRate, clientRate, revenueCop, copToClient, feeCostCop, feeBreb, creditedCop, utilityCop: revenueCop - creditedCop };
  })();
  const usandoAcct = acctOn && carguesDir === 'credit' && !carguesRecordOnly;

  const requestCargue = () => {
    if (!carguesClient) return;
    if (usandoAcct && !acctCalc.listo) { setCarguesMsg({ ok: false, text: 'Completa los cuatro datos de la operación (USDT enviados, USDT recibidos y las dos tasas).' }); return; }
    const raw = usandoAcct ? acctCalc.copToClient : parseFloat((carguesAmount || '').replace(/[^\d.]/g, ''));
    if (!isFinite(raw) || raw <= 0) { setCarguesMsg({ ok: false, text: 'Ingresa un monto válido.' }); return; }
    setCarguesMsg(null);
    setCarguesOverride(false);
    setCarguesConfirm({ raw });
  };

  // Paso 2: aplicar el cargue (lo llama el botón del modal).
  // Candado síncrono contra el doble toque: se marca antes de cualquier await
  // (el estado de React tarda un render y dos toques seguidos pasaban los dos).
  const submitCargueEnCursoRef = useRef(false);
  // Id de ESTE cargue: se repite si se reintenta (respuesta perdida, error de
  // red) para que el servidor no lo aplique dos veces. Se renueva al aplicarse.
  const cargueIdRef = useRef<string | null>(null);
  const submitCargue = async () => {
    if (submitCargueEnCursoRef.current) return;
    submitCargueEnCursoRef.current = true;
    try { return await submitCargueUnaVez(); } finally { submitCargueEnCursoRef.current = false; }
  };
  const submitCargueUnaVez = async () => {
    if (!carguesClient || !carguesConfirm) return;
    const raw = carguesConfirm.raw;
    const delta = carguesDir === 'credit' ? raw : -raw;
    const railLabel = railLabelOf(carguesRail);
    setCarguesBusy(true); setCarguesMsg(null);
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      let jwt: string | null = null;
      try {
        const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; }
      } catch { /* sin sesión supabase */ }
      const authHeader = jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}`;
      const r = await fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: authHeader },
        body: JSON.stringify({
          action: 'admin_credit_balance', userId: carguesClient.id, currency: carguesRail,
          amount: delta, note: carguesNote.trim() || undefined,
          ...(carguesDir === 'debit' && carguesReversaDe ? { reversaDe: carguesReversaDe } : {}),
          cargueId: (cargueIdRef.current ??= (crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`),
          ...(carguesRecordOnly ? { recordOnly: true } : { otp: cargueOtp.trim() }),
          ...(usandoAcct ? { acct: {
            usdtGross: acctCalc.usdtGross, usdtNet: acctCalc.usdtNet,
            sellRate: acctCalc.sellRate, clientRate: acctCalc.clientRate,
            feeBearer: acctFeeBearer,
          } } : {}),
        }),
      });
      // Si la respuesta no es JSON (la plataforma cortó), se dice con
      // palabras y no con "Unexpected token…".
      const t = await r.text();
      let d: any = null;
      try { d = t ? JSON.parse(t) : null; } catch { d = null; }
      if (!d) d = { success: false, error: `El servidor no respondió bien (HTTP ${r.status}). Revisa el saldo del cliente antes de repetir.` };
      if (d?.success) {
        cargueIdRef.current = null;
        setCarguesMsg({ ok: true, text: d.recordOnly
          ? `✅ Movimiento registrado en el historial. El saldo NO cambió (${formatMoney(d.newBalance ?? 0, '')} COP).`
          : d.feeCop > 0
          ? `✅ ${railLabel} actualizado. Cargue ${formatMoney(d.grossCop ?? raw, '')} − comisión ${formatMoney(d.feeCop, '')} (${d.feePct}%) = ${formatMoney(d.netCop ?? 0, '')} acreditados. Nuevo saldo: ${formatMoney(d.newBalance ?? 0, '')} COP`
          : `✅ ${railLabel} actualizado. Nuevo saldo: ${formatMoney(d.newBalance ?? 0, '')} COP` });
        if (d.reverso?.auto) showToast('El descuento se vinculó solo al cargue que revierte.', 6000);
        if (d.reverso && !d.reverso.ok) setCarguesMsg({ ok: false, text: `⚠️ El descuento se aplicó, pero no se pudo vincular al cargue: ${d.reverso.error}. Vincúlalo desde Contabilidad → Clientes.` });
        else if (d.reverso?.aviso) showToast(d.reverso.aviso, 9000);
        setCarguesAmount(''); setCarguesNote(''); setCargueOtp(''); setCarguesReversaDe('');
        setAcctUsdtGross(''); setAcctUsdtNet(''); setAcctSellRate(''); setAcctClientRate('');
        showToast(`Cargue aplicado a ${carguesClient.name}`);
        refreshData();
      } else {
        setCarguesMsg({ ok: false, text: `❌ ${d?.error || 'No se pudo aplicar el cargue.'}` });
      }
    } catch (e: any) {
      setCarguesMsg({ ok: false, text: `❌ ${e?.message ?? 'Error de red'}` });
    }
    setCarguesBusy(false);
    setCarguesConfirm(null);
  };

  // ── Solicitudes de movimiento a ACH (aprobación manual de Tesorería) ──
  const [railMoveBusy, setRailMoveBusy] = useState<string | number | null>(null);
  // Candado síncrono contra el doble toque: se marca antes de cualquier await
  // (el estado de React tarda un render y dos toques seguidos pasaban los dos).
  const railMoveActionEnCursoRef = useRef(false);
  const railMoveAction = async (txId: string | number, action: 'approve' | 'reject') => {
    if (railMoveActionEnCursoRef.current) return;
    railMoveActionEnCursoRef.current = true;
    try { return await railMoveActionUnaVez(txId, action); } finally { railMoveActionEnCursoRef.current = false; }
  };
  const railMoveActionUnaVez = async (txId: string | number, action: 'approve' | 'reject') => {
    if (railMoveBusy) return;
    if (action === 'approve' && !window.confirm('¿Ya moviste el respaldo al proveedor? Aprobar acredita el saldo ACH del cliente.')) return;
    if (action === 'reject' && !window.confirm('¿Rechazar la solicitud? El COP se reembolsa al Saldo Lincoin del cliente.')) return;
    setRailMoveBusy(txId);
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      let jwt: string | null = null;
      try {
        const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; }
      } catch { /* sin sesión supabase */ }
      const authHeader = jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}`;
      const pedir = async (extra: Record<string, unknown> = {}) => {
        const r = await fetch(`${SURL}/functions/v1/admin-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: authHeader },
          body: JSON.stringify({ action: action === 'approve' ? 'approve_rail_move' : 'reject_rail_move', txId, ...extra }),
        });
        const t = await r.text();
        try { return t ? JSON.parse(t) : { error: `Sin respuesta (HTTP ${r.status}).` }; } catch { return { error: `Respuesta no válida (HTTP ${r.status}).` }; }
      };
      let d = await pedir();
      // Solicitud creada por una versión anterior: el servidor no sabe si el
      // COP se descontó. Se pide confirmarlo antes de mover nada.
      if (d?.sinDebitoVerificado && window.confirm(`${d.error}\n\n¿Confirmas que el Saldo Lincoin del cliente SÍ se descontó por esta solicitud?`)) {
        d = await pedir({ confirmoDebito: true });
      }
      if (d?.success) { showToast(action === 'approve' ? '✅ Aprobado — saldo ACH acreditado al cliente.' : 'Solicitud rechazada — COP reembolsado.'); refreshData(); }
      else showToast(`❌ ${d?.error || 'No se pudo aplicar.'}`, 5000, 'error');
    } catch (e: any) { showToast(`❌ ${e?.message ?? 'Error de red'}`, 5000, 'error'); }
    setRailMoveBusy(null);
  };

  // Treasury Logic
  const [treasuryTab, setTreasuryTab] = useState<'deposits' | 'withdrawals' | 'history' | 'crypto'>('deposits');
  const [treasurySegment, setTreasurySegment] = useState<'all' | 'personal' | 'business'>('all');
  const [treasurySearch, setTreasurySearch] = useState('');
  const [selectedTreasuryTx, setSelectedTreasuryTx] = useState<Transaction | null>(null);
  // Billetera: país de la billetera (cambio rápido) y tipo de cliente del
  // buscador (por defecto empresas: son las que más se cargan).
  const billeterasDisponibles = (['CO', 'US'] as const).filter(c => esDueno || !paises || paises.includes(c));
  const [billeteraPais, setBilleteraPais] = useState<'CO' | 'US'>('CO');
  const [menuBilletera, setMenuBilletera] = useState(false);
  const [carguesTipo, setCarguesTipo] = useState<'business' | 'personal' | 'todos'>('business');
  // Tesorería: periodo del flujo (por defecto el mes en curso), filtros de la
  // tabla y lo que devuelve tesoreria_resumen.
  const hoyBog = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
  const [tesRango, setTesRango] = useState<{ desde: string; hasta: string; etiqueta: string }>(() => ({ desde: `${hoyBog().slice(0, 7)}-01`, hasta: hoyBog(), etiqueta: 'Este mes' }));
  const [tesMenu, setTesMenu] = useState(false);
  const [tesDia, setTesDia] = useState(hoyBog);
  const [tesMes, setTesMes] = useState(() => hoyBog().slice(0, 7));
  const [tesDesde, setTesDesde] = useState(() => `${hoyBog().slice(0, 7)}-01`);
  const [tesHasta, setTesHasta] = useState(hoyBog);
  const [tesFiltro, setTesFiltro] = useState<'todos' | 'cargue' | 'dispersion' | 'problemas'>('todos');
  const [tesQ, setTesQ] = useState('');
  const [tesMiembro, setTesMiembro] = useState('');
  const [tesMios, setTesMios] = useState(false);
  const [tesPagina, setTesPagina] = useState(0);
  const [tesData, setTesData] = useState<any>(null);
  const [tesCargando, setTesCargando] = useState(false);
  const [tesError, setTesError] = useState<string | null>(null);
  const [tesVer, setTesVer] = useState(0);
  const [tesVerOcultos, setTesVerOcultos] = useState(false);
  // Caja de Lincoin (caja_estado): apertura, Lincoin esperado, sospechosas.
  const [caja, setCaja] = useState<any>(null);
  const [cajaVer, setCajaVer] = useState(0);
  const [cajaAbierta, setCajaAbierta] = useState(false);       // detalle del cierre desplegado
  const [cajaOcultar, setCajaOcultar] = useState<any>(null);    // cargue a revisar/ocultar
  const [cajaMotivo, setCajaMotivo] = useState('');
  const [cajaEditar, setCajaEditar] = useState<{ proveedor: string; monto: string; nota: string } | null>(null);
  const [cajaOcupada, setCajaOcupada] = useState(false);
  // Tablero de Lincoin (lincoin_resumen): mes elegido, datos y formularios.
  const [linMes, setLinMes] = useState(() => hoyBog().slice(0, 7));
  const [linData, setLinData] = useState<any>(null);
  const [linCargando, setLinCargando] = useState(false);
  const [linVer, setLinVer] = useState(0);
  const [linForm, setLinForm] = useState<null | { tipo: 'retiro' | 'egreso' | 'ingreso' | 'aporte'; proveedor: 'Mouv' | 'Finity'; monto: string; fecha: string; descripcion: string; soporte: string | null; soporteNombre: string | null }>(null);
  const [linAnular, setLinAnular] = useState<{ id: string; motivo: string } | null>(null);
  // Comprobante bajo demanda: el listado llega sin las imágenes base64
  // (admin-data las reemplaza por '__stored__' para no pesar megas) y aquí
  // se pide la real solo al abrir el detalle.
  const [resolvedProof, setResolvedProof] = useState<string | null>(null);
  useEffect(() => {
    setResolvedProof(null);
    const tx: any = selectedTreasuryTx;
    if (!tx || tx.proofUrl !== '__stored__') return;
    const SURL = (import.meta as any).env?.VITE_SUPABASE_URL as string || '';
    const SKEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string || '';
    let jwt: string | null = null;
    try {
      const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
      if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; }
    } catch { /* sin sesión supabase */ }
    const authHeader = jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}`;
    fetch(`${SURL}/functions/v1/admin-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': authHeader },
      body: JSON.stringify({ action: 'get_tx_proof', txId: tx.id }),
    }).then(r => r.json()).then(d => {
      const p = d?.raw_data?.proofUrl;
      if (typeof p === 'string' && p.startsWith('data:')) setResolvedProof(p);
    }).catch(() => {});
  }, [selectedTreasuryTx?.id]);
  const [rejectReason, setRejectReason] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  
  // Reports Logic
  const [reportSubTab, setReportSubTab] = useState<'financial' | 'audit' | 'users' | 'backup'>('financial');
  const [reportUserSearch, setReportUserSearch] = useState('');
  const [selectedReportUser, setSelectedReportUser] = useState<User | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null); 

  // Security Logic
  const [securitySearch, setSecuritySearch] = useState('');
  const [selectedSecurityUser, setSelectedSecurityUser] = useState<User | null>(null);
  const [revealPassword, setRevealPassword] = useState(false);

  // Internal Movement Modal State
  const [showInternalMovementModal, setShowInternalMovementModal] = useState(false);
  const [internalMoveType, setInternalMoveType] = useState<'debit' | 'credit'>('debit');
  const [internalAmount, setInternalAmount] = useState('');
  const [internalCurrency, setInternalCurrency] = useState('COP');
  const [internalAccountId, setInternalAccountId] = useState(''); 
  const [internalReason, setInternalReason] = useState('');
  const [internalReferenceId, setInternalReferenceId] = useState('');
  const [internalProofFile, setInternalProofFile] = useState<File | null>(null);

  // Banks Logic
  const [selectedBankCountry, setSelectedBankCountry] = useState('Colombia');
  const [showBankModal, setShowBankModal] = useState(false);
  const [editingBank, setEditingBank] = useState<BankDetail | null>(null);
  const [bankForm, setBankForm] = useState<BankDetail>({
      id: '', name: '', type: 'bank', accountNumber: '', accountType: '', beneficiary: '', taxId: '', taxIdType: '', logoColor: 'bg-slate-100 text-slate-500', logoText: '', qrImageUrl: ''
  });

  // Team Logic
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [newUserForm, setNewUserForm] = useState<{
      name: string;
      email: string;
      role: AdminUser['role'];
      status: AdminUser['status'];
  }>({ name: '', email: '', role: 'Soporte L1', status: 'Activo' });

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<SystemAlert[]>([]);
  
  // Marketing / Coupons State
  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponDiscount, setNewCouponDiscount] = useState('');

  const { exchangeRates, updateRate, updateFee, toggleMode, apiStatus, forceRefresh, getRate } = useExchangeRates();
  const { config: systemConfig, updateConfig: updateSystemConfig, configError, addCoupon, removeCoupon, toggleCoupon, setThemePreset } = useSystemConfig();
  const { 
      getAllPendingDeposits, 
      getAllPendingWithdrawals, 
      getTransactionHistory,
      getAdminTeam,
      addAdminUser,
      updateAdminUser,
      deleteAdminUser,
      getAllUsers,
      getAllTransactions,
      updateTxStatus,
      verifyUser,
      toggleUserBlock,
      deleteUser,
      updateUserProfile,
      bankingOptions,
      updateBankList,
      approveDeposit,
      rejectDeposit,
      completeWithdrawal,
      rejectWithdrawal,
      registerInternalMovement,
      treasuryAccounts,
      restoreDatabase,
      isOnline,
      dataReady,
      refreshData,
      currentUser,
      enrollMFA,
      verifyMFAEnrollment,
    syncError,
      buscarUsuarios,
      obligaciones,
      resumenUsuarios,
  } = useDatabase();

  // ── 2FA del propio admin (protege el cambio de proveedor de tesorería) ──
  const [mfaEnroll, setMfaEnroll] = useState<{ qrCode: string; secret: string; factorId: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaMsg, setMfaMsg] = useState<string | null>(null);
  const [mfaBackupCodes, setMfaBackupCodes] = useState<string[] | null>(null);
  const [mfaHealth, setMfaHealth] = useState<any>(null);
  const [mfaHealthBusy, setMfaHealthBusy] = useState(false);

  // Revisa TODAS las cuentas con 2FA y reporta cuáles tienen el secreto
  // ilegible (llave distinta) o se quedaron sin códigos de respaldo. Sirve
  // para enterarse ANTES de que alguien no pueda entrar.
  const runMfaHealth = async () => {
    setMfaHealthBusy(true);
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      let jwt: string | null = null;
      try { const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token')); if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; } } catch { /* */ }
      const r = await fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}` },
        body: JSON.stringify({ action: 'mfa_health' }),
      });
      setMfaHealth(await r.json());
    } catch { setMfaHealth({ error: 'No se pudo revisar. Reintenta.' }); }
    setMfaHealthBusy(false);
  };
  const adminMfaOn = !!((currentUser as any)?.mfaEnabled || (currentUser as any)?.raw_data?.mfaEnabled);

  // Tesorería no se abre solo con la sesión: exige volver a probar el correo y
  // el código de la app (y la llave, si la cuenta tiene alguna). Se vuelve a
  // pedir cada vez que se entra a la sección — salir y volver a entrar no es
  // un rodeo válido.
  const [tesoreriaOk, setTesoreriaOk] = useState(false);
  useEffect(() => { if (activeTab !== 'treasury') setTesoreriaOk(false); }, [activeTab]);

  // Tablero de Tesorería: las cifras las calcula el servidor sobre toda la
  // base (tesoreria_resumen). Se piden al abrir y cuando cambia un filtro;
  // lo que se escribe en el buscador espera un momento antes de preguntar.
  useEffect(() => {
    if (activeTab !== 'treasury' || !tesoreriaOk) return;
    let vigente = true;
    const t = setTimeout(async () => {
      setTesCargando(true); setTesError(null);
      const d = await pedirAdmin({ action: 'tesoreria_resumen', desde: tesRango.desde, hasta: tesRango.hasta, filtro: tesFiltro, q: tesQ, miembro: tesMiembro || undefined, mios: tesMios, pagina: tesPagina, verOcultos: tesVerOcultos }).catch(() => null);
      if (!vigente) return;
      setTesCargando(false);
      if (d?.ok) setTesData(d); else setTesError(d?.error ?? 'No se pudo cargar el tablero.');
    }, tesQ ? 350 : 0);
    return () => { vigente = false; clearTimeout(t); };
  }, [activeTab, tesoreriaOk, tesRango, tesFiltro, tesQ, tesMiembro, tesMios, tesPagina, tesVer, tesVerOcultos]);

  // La caja se lee al abrir la Billetera o la Tesorería.
  useEffect(() => {
    if (activeTab !== 'cargues' && activeTab !== 'treasury') return;
    let vigente = true;
    pedirAdmin({ action: 'caja_estado' }).then(d => { if (vigente && d?.ok) setCaja(d); }).catch(() => {});
    return () => { vigente = false; };
  }, [activeTab, cajaVer]);
  useEffect(() => {
    if (activeTab !== 'lincoin') return;
    let vigente = true;
    const hoy = hoyBog();
    const [a, m] = linMes.split('-').map(Number);
    const finMes = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
    setLinCargando(true);
    pedirAdmin({ action: 'lincoin_resumen', desde: `${linMes}-01`, hasta: finMes > hoy ? hoy : finMes })
      .then(d => { if (vigente) { setLinCargando(false); if (d?.ok) setLinData(d); else showToast(d?.error ?? 'No se pudo cargar el tablero de Lincoin.'); } })
      .catch(() => { if (vigente) setLinCargando(false); });
    return () => { vigente = false; };
  }, [activeTab, linMes, linVer]);
  const cajaAccion = async (body: Record<string, unknown>, ok: string) => {
    setCajaOcupada(true);
    const d = await pedirAdmin(body).catch(() => null);
    setCajaOcupada(false);
    if (!d?.ok) { showToast(d?.error ?? 'No se pudo completar.'); return false; }
    showToast(ok); setCajaVer(v => v + 1); setTesVer(v => v + 1); setLinVer(v => v + 1);
    return true;
  };
  const startMfaEnroll = async () => {
    setMfaBusy(true); setMfaMsg(null);
    try {
      const d = await enrollMFA();
      if (!d) setMfaMsg('No se pudo iniciar la activación de 2FA. Reintenta.');
      else { setMfaEnroll(d); setMfaCode(''); }
    } catch (e: any) { setMfaMsg(e?.message ?? 'Error'); }
    setMfaBusy(false);
  };
  const confirmMfaEnroll = async () => {
    if (!mfaEnroll || mfaCode.length !== 6) return;
    setMfaBusy(true); setMfaMsg(null);
    try {
      const { ok, error, backupCodes } = await verifyMFAEnrollment(mfaEnroll.factorId, mfaCode, mfaEnroll.secret);
      if (ok) {
        setMfaMsg('✅ 2FA activado. Ahora el cambio de proveedor exige tu código.');
        setMfaEnroll(null); setMfaCode('');
        // Se muestran una ÚNICA vez: en la base solo queda su hash.
        if (backupCodes?.length) setMfaBackupCodes(backupCodes);
      }
      else setMfaMsg(error ?? 'Código incorrecto. Intenta de nuevo.');
    } catch (e: any) { setMfaMsg(e?.message ?? 'Error'); }
    setMfaBusy(false);
  };

  // ── Este admin es SOLO de EMPRESAS ──
  // El producto PERSONAS vive en OTRA base de datos (proyecto Supabase
  // distinto — supabasePersonas, gestionado en /admin-personas). Por eso
  // esta base de Empresas solo contiene clientes que se registraron en la
  // web de Empresas: una cuenta con rol 'personal' aquí NO es un usuario
  // móvil legítimo, es un cliente empresa que quedó mal etiquetado al
  // registrarse. Antes se ocultaban esas cuentas y sus movimientos, y por
  // eso "no salía el cliente nuevo que se registró". Ya NO se filtran por
  // rol: se muestran todos los clientes (los admins/equipo van aparte).
  const rawUsers = getAllUsers();
  const isBusinessTx = (_tx: any) => true;

  const pendingDeposits = getAllPendingDeposits().filter(isBusinessTx);
  const pendingWithdrawals = getAllPendingWithdrawals().filter(isBusinessTx);
  const historyTransactions = getTransactionHistory().filter(isBusinessTx);
  const allUsers = rawUsers.filter((u: any) => u.role !== 'admin');
  // Cliente seleccionado en Cargues, SIEMPRE leído de la lista viva: cualquier
  // refreshData() se refleja al instante en los saldos que se muestran.
  const carguesClient: User | null = carguesClientId
    ? (allUsers.find((u: any) => u.id === carguesClientId) ?? null)
    : null;
  // Historial COMPLETO del cliente elegido (la carga general trae solo los
  // 200 movimientos más recientes de toda la plataforma).
  const histCargues = useMovimientosCliente(carguesClient?.id ?? null, getTransactionHistory() as any[]);
  // El buscador de Cargues pregunta al servidor: el panel no tiene a todos
  // los clientes cargados (con miles no puede). Lo encontrado queda en la
  // lista del panel, así el cliente elegido se lee igual que siempre.
  const [carguesRemotos, setCarguesRemotos] = useState<{ q: string; ids: string[] } | null>(null);
  useEffect(() => {
    const q = carguesSearch.trim();
    if (q.length < 2) { setCarguesRemotos(null); return; }
    let vigente = true;
    const t = setTimeout(async () => {
      const r = await buscarUsuarios({ q, porPagina: 40 });
      if (vigente && r.ok) setCarguesRemotos({ q, ids: r.usuarios.map(u => u.id) });
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carguesSearch]);
  // Y para el de Seguridad.
  const idsSeguridad = useBusquedaClientes(securitySearch, 50);
  // Lo mismo para el buscador de Reportes → Usuarios.
  const [reportRemotos, setReportRemotos] = useState<{ q: string; ids: string[] } | null>(null);
  useEffect(() => {
    const q = reportUserSearch.trim();
    if (q.length < 2) { setReportRemotos(null); return; }
    let vigente = true;
    const t = setTimeout(async () => {
      const r = await buscarUsuarios({ q, porPagina: 100 });
      if (vigente && r.ok) setReportRemotos({ q, ids: r.usuarios.map(u => u.id) });
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportUserSearch]);
  const [carguesVer, setCarguesVer] = useState(60);
  useEffect(() => { setCarguesVer(60); }, [carguesClientId]);
  const adminTeam = getAdminTeam();

  // ── Panel de Fallos ──────────────────────────────────────────────────────
  // Operaciones de dinero que FALLARON o fueron RECHAZADAS, con el error
  // técnico real (para el admin). Al cliente solo se le muestra el mensaje
  // amable ("la llave no es válida…"); el detalle vive aquí.
  const failuresList = (getTransactionHistory() as any[])
    .filter(t => ['Fallido', 'Rechazado'].includes(String(t.status)))
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());

  // Dispersiones ACEPTADAS por el proveedor pero NUNCA confirmadas.
  //
  // Antes no hacía falta mirarlas porque el servidor las marcaba Completado a
  // ciegas — y así fue como un cliente pagó por un envío que el proveedor
  // había rechazado. Ahora se quedan en Procesando, que es la verdad, pero una
  // verdad que nadie ve es igual de inútil: si nadie las revisa, el cliente
  // espera y no se entera nadie. Por eso salen acá y cuentan en el badge.
  //
  // Bre-B liquida en segundos; pasados 15 minutos sin confirmación ya no es
  // "en curso", es algo que alguien tiene que cotejar contra la consola del
  // proveedor.
  const sinConfirmarList = (getTransactionHistory() as any[])
    .filter(t => {
      if (String(t.type) !== 'dispersion' || String(t.status) !== 'Procesando') return false;
      const ts = new Date(t.createdAt ?? 0).getTime();
      return Number.isFinite(ts) && Date.now() - ts >= 15 * 60 * 1000;
    })
    .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());

  const failuresCount = failuresList.length + sinConfirmarList.length;

  // Cierres OTC que esperan a la mesa. El conteo lo hace el servidor (accion
  // `resumen`) y no esta pantalla: contar aca obligaria a traerse la bandeja
  // entera solo para pintar un numero en el sidebar.
  const [otcPend, setOtcPend] = useState(0);
  // Cuantos habia la vez anterior. La campana suena desde ACA y no solo desde
  // la bandeja: el aviso existe justamente para cuando el operador NO esta
  // mirando esa pantalla.
  const otcPrev = useRef<number | null>(null);
  useEffect(() => {
    // La mesa OTC no es del rol Tesorería: el servidor se la niega.
    if (soloTesoreria) return;
    let vivo = true;
    const leer = async () => {
      try {
        let token = SKEY_ADMIN;
        const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) token = d.access_token; }
        const r = await fetch(`${SURL_ADMIN}/functions/v1/otc-mesa`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SKEY_ADMIN, Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'resumen' }),
        });
        const d = await r.json().catch(() => null);
        if (vivo && d?.ok) {
          const n = Number(d.abiertas ?? 0);
          setOtcPend(n);
          // La PRIMERA lectura solo toma nota: sonar ahi repicaria al entrar al
          // panel por cierres que ya estaban esperando.
          if (otcPrev.current != null && n > otcPrev.current && campanaActiva()) sonarCampana();
          otcPrev.current = n;
        }
      } catch { /* el badge no puede tumbar el panel */ }
    };
    leer();
    // Cada 10 s: este es el que hace sonar la campana cuando el operador NO
    // esta en la bandeja, asi que enterarse medio minuto tarde de que alguien
    // esta esperando es justo lo que se queria evitar.
    //
    // Pausado con la pestana oculta y releido al volver: preguntar cada 10 s
    // por una pantalla que nadie mira es gasto, y al volver lo que importa es
    // el estado de AHORA.
    let t: any = setInterval(() => { if (!document.hidden) leer(); }, 10000);
    const alVolver = () => { if (!document.hidden) leer(); };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);
    return () => {
      vivo = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', alVolver);
    };
  }, []);

  // Solicitudes de aumento de cupo que esperan a Cumplimiento. Sin este
  // número en el menú nadie se entera de que el cliente pidió algo.
  const [cuposPend, setCuposPend] = useState(0);
  // Se relee también al entrar o salir de la pestaña: después de resolver una
  // solicitud el número tiene que bajar ya, no al minuto.
  const enCupos = activeTab === 'cupos';
  useEffect(() => {
    // Cupos es de Cumplimiento: preguntar cada minuto solo llenaría la
    // auditoría de "permiso denegado".
    if (soloTesoreria) return;
    let vivo = true;
    const leer = async () => {
      try {
        const d = await pedirAdmin({ action: 'cupos_pendientes' });
        if (vivo && d?.ok) setCuposPend(Number(d.pendientes) || 0);
      } catch { /* el badge no puede tumbar el panel */ }
    };
    leer();
    const t = setInterval(() => { if (!document.hidden) leer(); }, 60000);
    return () => { vivo = false; clearInterval(t); };
  }, [enCupos]);

  // Operadores (clientes de nuestros clientes) que su empresa ya aceptó y
  // esperan a Cumplimiento: revisar documentos, fijar tope y aprobar.
  const [operadoresPend, setOperadoresPend] = useState(0);
  const [operadoresVer, setOperadoresVer] = useState(0);
  const enOperadores = activeTab === 'operadores';
  useEffect(() => {
    if (soloTesoreria) return;
    let vivo = true;
    const leer = async () => {
      try {
        const d = await pedirAutorizaciones({ action: 'admin_operadores' });
        if (vivo && d?.ok) setOperadoresPend(Array.isArray(d.pendientes) ? d.pendientes.length : 0);
      } catch { /* el badge no puede tumbar el panel */ }
    };
    leer();
    const t = setInterval(() => { if (!document.hidden) leer(); }, 60000);
    return () => { vivo = false; clearInterval(t); };
  }, [enOperadores, operadoresVer]);

  // Una cuenta BLOQUEADA o en LISTA NEGRA no cuenta como pendiente: no hay nada
  // que aprobarle (ya le negaste el acceso), y aparecer ahí solo ensucia la
  // operación y el badge de "por aprobar".
  const isBlacklisted = (u: any) => u?.blacklisted === true || u?.raw_data?.blacklisted === true;
  const isBlockedUser = (u: any) => u?.isBlocked === true || u?.raw_data?.isBlocked === true || u?.is_blocked === true;
  const outOfOperation = (u: any) => isBlacklisted(u) || isBlockedUser(u);
  const pendingClientsCount = allUsers.filter(u => !outOfOperation(u) && (u.kycStatus === 'pending' || u.kycStatus === 'in_review')).length;

  const getUserVolume = (userId: string) => {
      const userTx = historyTransactions.filter(tx => tx.userId === userId && tx.status === 'Completado');
      
      const totalUSD = userTx.reduce((acc, curr) => {
          const rateToUSD = getRate(curr.currency, 'USD');
          const usdAmount = curr.amount * (rateToUSD || 0);
          return acc + usdAmount;
      }, 0);
      
      return { count: userTx.length, totalUSD };
  };

  const stats = {
      pendingClients: pendingClientsCount,
      pendingDeposits: pendingDeposits.length,
      pendingWithdrawals: pendingWithdrawals.length,
      totalVolume: `$ ${Math.round(historyTransactions.reduce((acc, tx) => {
          if (tx.status === 'Completado') {
             const rate = getRate((tx.currency||'').split('_')[0], 'USD'); 
             return acc + (tx.amount * (rate || 0));
          }
          return acc;
      }, 0)).toLocaleString()}`
  };

  // Auto-select account when currency changes in modal
  useEffect(() => {
      if (showInternalMovementModal) {
          const availableAccounts = treasuryAccounts.filter(acc => acc.currency === internalCurrency);
          if (availableAccounts.length > 0) {
              setInternalAccountId(availableAccounts[0].id);
          } else {
              setInternalAccountId('');
          }
      }
  }, [internalCurrency, showInternalMovementModal, treasuryAccounts]);

  // System Alerts Logic
  useEffect(() => {
      const generateAlerts = () => {
          const newAlerts: SystemAlert[] = [];
          if (apiStatus === 'error') newAlerts.push({ id: 'api-error', type: 'error', title: 'Error de Conexión API', description: 'No se pueden obtener tasas de cambio en tiempo real.' });
          
          if (!isOnline) newAlerts.push({ id: 'db-offline', type: 'error', title: 'Base de Datos Desconectada', description: 'La app está en modo local. Revisa la conexión del servidor.' });

          const totalPendingTx = pendingDeposits.length + pendingWithdrawals.length;
          if (pendingClientsCount > 0) newAlerts.push({ id: 'kyc-pending', type: 'info', title: 'Verificación de Clientes', description: `Hay ${pendingClientsCount} usuarios esperando validación KYC.`, action: 'clients' });
          if (totalPendingTx > 5) newAlerts.push({ id: 'high-load', type: 'info', title: 'Alto Volumen de Solicitudes', description: `Hay ${totalPendingTx} transacciones pendientes de revisión.` });
          
          if (systemConfig.maintenanceMode) newAlerts.push({ id: 'maintenance', type: 'error', title: 'Sistema en Mantenimiento', description: 'El acceso a usuarios finales está restringido.' });
          
          const limit = systemConfig.volumeLimit || 10000;
          let usersOverLimit = 0;
          allUsers.forEach(u => { const { totalUSD } = getUserVolume(u.id); if (totalUSD > limit) usersOverLimit++; });
          if (usersOverLimit > 0) newAlerts.push({ id: 'volume-risk', type: 'warning', title: 'Límite de Volumen Excedido', description: `${usersOverLimit} clientes superaron el límite de $${limit.toLocaleString()}. Revisar Cumplimiento.`, action: 'clients' });

          setActiveAlerts(newAlerts);
      };
      generateAlerts();
      const interval = setInterval(generateAlerts, 30000);
      return () => clearInterval(interval);
  }, [apiStatus, pendingDeposits, pendingWithdrawals, systemConfig, allUsers, historyTransactions, pendingClientsCount, getRate, isOnline]); 

  const showToast = (msg: string, ms = 3000, _tipo?: 'error') => { setToastMessage(msg); setTimeout(() => setToastMessage(null), ms); };
  
  // -- Handlers -- (Omitted for brevity, same as previous)
  // ... [Handlers remain the same: handleApproveKYC, handleRejectKYC, etc.]
  const setKycViaEdgeFn = async (userId: string, kycStatus: string) => {
    const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
    const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
    // Read JWT from Supabase localStorage key (same pattern as DatabaseContext)
    let token = SKEY;
    try {
      const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
      if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) token = d.access_token; }
    } catch {}
    // Devuelve el motivo si el servidor dijo que no (rol sin permiso de
    // cumplimiento, 2FA de la sesión). Antes se descartaba la respuesta y la
    // pantalla escribía el KYC por su cuenta: un rol sin permiso "aprobaba".
    try {
      const r = await fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'set_kyc_status', userId, kycStatus }),
      });
      const t = await r.text();
      let d: any = null;
      try { d = t ? JSON.parse(t) : null; } catch { d = null; }
      if (r.ok && d && !d.error) return null;
      return String(d?.error || d?.message || `El servidor no aplicó el cambio (HTTP ${r.status}).`);
    } catch {
      return 'No se pudo contactar el servidor. No se cambió el KYC.';
    }
  };

  const handleSyncCrypto = async (userId: string, userName: string) => {
    const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
    const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
    const walletKeys = ['USDT_BSC', 'USDT_TRON', 'USDC_BSC', 'USDC_BASE'];
    let credited = 0;
    for (const wk of walletKeys) {
      try {
        const r = await fetch(`${SURL}/functions/v1/gasfree`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
          body: JSON.stringify({ action: 'verify_and_credit', userId, walletKey: wk }),
        });
        const d = await r.json();
        if (d.credited && d.credited > 0) credited += d.credited;
      } catch {}
    }
    showToast(credited > 0 ? `✅ Sincronizado: +${credited.toFixed(2)} acreditados a ${userName}` : `Sincronizado — sin diferencias pendientes para ${userName}`);
  };

  const handleApproveKYC = async () => {
    if (!selectedClient) return;
    const existing: any[] = selectedClient.notifications ?? [];
    const notif = { id: Date.now(), type: 'kyc', title: 'KYC Aprobado', message: 'Tu cuenta ha sido verificada exitosamente. Ya puedes operar con todos los servicios Lincoin.', read: false, date: new Date().toLocaleDateString() };
    // Use edge function (service role) so RLS doesn't block the update
    const err = await setKycViaEdgeFn(selectedClient.id, 'verified');
    if (err) { showToast(`❌ ${err}`, 7000, 'error'); return; }
    // El KYC ya lo escribió el servidor; acá solo se agrega la notificación.
    updateUserProfile(selectedClient.id, { notifications: [...existing, notif] });
    setSelectedClient(null);
    showToast('Cliente verificado.');
  };
  const handleRejectKYC = async () => {
    if (!selectedClient) return;
    const existing: any[] = selectedClient.notifications ?? [];
    const notif = { id: Date.now(), type: 'kyc', title: 'KYC Rechazado', message: 'Tu solicitud de verificación fue rechazada. Por favor contacta a soporte para más información.', read: false, date: new Date().toLocaleDateString() };
    const err = await setKycViaEdgeFn(selectedClient.id, 'rejected');
    if (err) { showToast(`❌ ${err}`, 7000, 'error'); return; }
    updateUserProfile(selectedClient.id, { notifications: [...existing, notif] });
    setSelectedClient(null);
    showToast('Cliente rechazado.');
  };
  const handleBlockUser = () => { if (!selectedClient) return; toggleUserBlock(selectedClient.id, !selectedClient.isBlocked, blockReason); showToast("Estado de bloqueo actualizado"); setSelectedClient(null); setShowBlockInput(false); setBlockReason(''); };
  // LISTA NEGRA: bloqueo reforzado para cuentas maliciosas (hackeo/fraude).
  // Además de bloquear, marca blacklisted → el SERVIDOR rechaza toda operación
  // de dinero y la cuenta desaparece de las listas operativas (Cargues,
  // GasFree, pendientes). Es reversible desde aquí mismo.
  const handleBlacklistUser = async () => {
    if (!selectedClient) return;
    const isBl = !!(selectedClient as any).blacklisted;
    if (!isBl && !window.confirm(`¿Enviar a LISTA NEGRA a ${selectedClient.email}?\n\nQuedará bloqueada, el servidor rechazará TODAS sus operaciones de dinero y desaparecerá de Cargues, GasFree y pendientes.`)) return;
    await updateUserProfile(selectedClient.id, {
      blacklisted: !isBl,
      isBlocked: !isBl ? true : (selectedClient as any).isBlocked,
      blockReason: !isBl ? (blockReason || 'Lista negra — actividad maliciosa') : (selectedClient as any).blockReason,
      blacklistedAt: !isBl ? new Date().toISOString() : null,
    });
    showToast(!isBl ? '🚫 Cuenta enviada a lista negra' : 'Cuenta retirada de la lista negra');
    setSelectedClient(null); setShowBlockInput(false); setBlockReason('');
  };
  const handleDeleteUser = async () => {
    if (!selectedClient) return;
    setDeletingUser(true);
    const { error } = await deleteUser(selectedClient.id);
    setDeletingUser(false);
    setShowDeleteConfirm(false);
    if (error) { showToast(`Error al eliminar: ${error}`); return; }
    showToast('Cuenta eliminada correctamente.');
    setSelectedClient(null);
  };
  const handleSecurityBlockUser = () => { if (!selectedSecurityUser) return; toggleUserBlock(selectedSecurityUser.id, !selectedSecurityUser.isBlocked, "Bloqueo preventivo de seguridad"); showToast("Estado de seguridad actualizado"); };

  const handleAddCoupon = () => {
      if (!newCouponCode || !newCouponDiscount) return;
      addCoupon({ code: newCouponCode.toUpperCase(), discount: Number(newCouponDiscount), active: true });
      setNewCouponCode('');
      setNewCouponDiscount('');
      showToast("Cupón creado");
  };

  const handleBankSave = () => {
      const currentList = bankingOptions[selectedBankCountry] || [];
      if (editingBank) {
          const updatedList = currentList.map(b => b.id === editingBank.id ? bankForm : b);
          updateBankList(selectedBankCountry, updatedList);
      } else {
          updateBankList(selectedBankCountry, [...currentList, { ...bankForm, id: Date.now().toString() }]);
      }
      setShowBankModal(false);
      setEditingBank(null);
      showToast("Cuenta guardada correctamente");
  };

  const handleQrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          try {
              const base64 = await fileToBase64(file);
              setBankForm(prev => ({ ...prev, qrImageUrl: base64 }));
              showToast("Imagen QR cargada");
          } catch (error) {
              console.error(error);
              showToast("Error al cargar imagen");
          }
      }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          try {
              const base64 = await fileToBase64(file);
              updateSystemConfig({ logoUrl: base64 });
              showToast("Logo actualizado");
          } catch (error) { console.error(error); }
      }
  };

  const handlePromoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          try {
              const base64 = await fileToBase64(file);
              updateSystemConfig({ marketingModal: { ...systemConfig.marketingModal, imageUrl: base64 } });
              showToast("Imagen promocional actualizada");
          } catch (error) { console.error(error); }
      }
  };

  const handleTeamSave = () => {
      if (editingUserId) {
          updateAdminUser(editingUserId, newUserForm);
      } else {
          addAdminUser(newUserForm);
      }
      setShowAddUserModal(false);
      showToast("Usuario guardado");
  };

  // Candado: el comprobante se convierte (await) antes de registrar, y un
  // segundo clic en esa espera registraba el movimiento dos veces.
  const registrandoRef = useRef(false);
  const handleRegisterInternalMovement = async () => {
      if (registrandoRef.current) return;
      if (!internalAmount || isNaN(parseFloat(internalAmount))) {
          alert("Monto inválido");
          return;
      }
      if (!internalReason) {
          alert("Debes ingresar un motivo.");
          return;
      }
      if (!internalAccountId) {
          alert("Selecciona una cuenta de tesorería válida.");
          return;
      }

      registrandoRef.current = true;
      setTimeout(() => { registrandoRef.current = false; }, 4000);
      let proofUrl = undefined;
      if (internalProofFile) {
          try {
              proofUrl = await fileToBase64(internalProofFile);
          } catch (e) {
              console.error(e);
          }
      }

      // El aviso dice lo que pasó: antes decía "registrado" siempre, aunque el
      // guardado (que era solo del dueño) hubiera fallado.
      const r = await registerInternalMovement(
          parseFloat(internalAmount), 
          internalCurrency, 
          internalMoveType, 
          internalReason,
          internalAccountId,
          internalReferenceId,
          proofUrl
      );
      if (!r.ok) { showToast(r.error || 'No se pudo registrar el movimiento.'); return; }

      setShowInternalMovementModal(false);
      setInternalAmount('');
      setInternalReason('');
      setInternalReferenceId('');
      setInternalProofFile(null);
      showToast("Movimiento interno registrado y saldo actualizado.");
  };

  // Aprobar / Rechazar en Tesorería: un solo pedido por movimiento. Antes no
  // había candado ni se esperaba la respuesta: dos clics aprobaban dos veces.
  const txAccionRef = useRef(false);
  const [txAccionando, setTxAccionando] = useState(false);
  const handleTxAction = async (action: 'approve' | 'reject') => {
      if (!selectedTreasuryTx || txAccionRef.current) return;
      txAccionRef.current = true;
      setTxAccionando(true);
      const tx = selectedTreasuryTx;
      try {
          if (action === 'approve' && tx.type === 'send' && (tx as any).insertadoPorCliente === true && !(tx as any).debitado) {
              showToast('Esta solicitud no tiene el saldo descontado por el servidor: no se puede pagar. Recházala.', 8000, 'error');
              return;
          }
          // El aviso dice lo que PASÓ, no lo que se pidió: antes era fijo y
          // decía "aprobado" aunque la base no hubiera hecho nada.
          const r = action === 'approve'
              ? (tx.type === 'load' ? await approveDeposit(tx.id) : tx.type === 'send' ? await completeWithdrawal(tx.id) : null)
              : (tx.type === 'load' ? await rejectDeposit(tx.id) : tx.type === 'send' ? await rejectWithdrawal(tx.id, rejectReason || 'Rechazado por administración') : null);
          if (!r) {
              showToast("Este tipo de movimiento no se resuelve desde aquí.", 5000, 'error');
          } else if (!r.ok) {
              showToast(r.error || 'No se pudo completar. No se cambió nada.', 8000, 'error');
          } else {
              showToast(action === 'approve'
                  ? (tx.type === 'load' ? "Depósito aprobado y saldo acreditado." : "Retiro completado.")
                  : (tx.type === 'load' ? "Depósito rechazado." : "Retiro rechazado y fondos devueltos."));
          }
      } finally {
          txAccionRef.current = false;
          setTxAccionando(false);
          setSelectedTreasuryTx(null);
          setRejectReason('');
      }
  };


  const formatMoney = (amount: number, currency: string) => {
      return new Intl.NumberFormat('es-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  };

  // --- REPORT GENERATION HELPERS ---
  const downloadDatabase = () => {
      const data = {
          generatedAt: new Date().toISOString(),
          aviso: 'Contiene solo lo cargado en el panel al descargar, no la base completa.',
          totalClientesEnLaBase: resumenUsuarios?.clientes ?? null,
          users: allUsers,
          transactions: historyTransactions,
          pending: [...pendingDeposits, ...pendingWithdrawals],
          treasury: treasuryAccounts,
          config: systemConfig,
          bankingOptions,
          adminTeam
      };
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `LINCOIN_BACKUP_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Descargado lo que el panel tiene cargado.");
  };

  const handleRestoreDatabase = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
          try {
              const json = JSON.parse(event.target?.result as string);
              if (confirm("ADVERTENCIA: Esta acción sobrescribirá TODA la base de datos actual (Usuarios, Transacciones, Configuración). ¿Estás seguro de que deseas restaurar el sistema?")) {
                  const success = restoreDatabase(json);
                  if (success) {
                      showToast("Sistema restaurado correctamente.");
                      if (fileInputRef.current) fileInputRef.current.value = '';
                  } else {
                      alert("Error: El archivo de backup es inválido o está corrupto.");
                  }
              }
          } catch (error) {
              console.error(error);
              alert("Error al leer el archivo. Asegúrate de que sea un JSON válido.");
          }
      };
      reader.readAsText(file);
  };

  const calculateFinancials = () => {
      const validTx = historyTransactions.filter(tx => tx.status === 'Completado');
      const volumeUSD = validTx.reduce((acc, tx) => {
          const rate = getRate((tx.currency||'').split('_')[0], 'USD');
          return acc + (tx.amount * (rate || 0));
      }, 0);
      const grossRevenueUSD = volumeUSD * (systemConfig.globalFee / 100);
      const referralTx = validTx.filter(tx => tx.type === 'referral_payout' || tx.type === 'referral_commission');
      const referralCostUSD = referralTx.reduce((acc, tx) => {
          const rate = getRate((tx.currency||'').split('_')[0], 'USD');
          return acc + (tx.amount * rate);
      }, 0);
      const netProfit = grossRevenueUSD - referralCostUSD;
      const activeUsers = new Set(validTx.map(tx => tx.userId)).size;
      const avgTicket = validTx.length > 0 ? volumeUSD / validTx.length : 0;
      return { volumeUSD, grossRevenueUSD, referralCostUSD, netProfit, activeUsers, avgTicket };
  };

  const financials = calculateFinancials();
  const chartData = [
      { label: 'ENE', value: financials.volumeUSD * 0.4, percentage: 40 },
      { label: 'FEB', value: financials.volumeUSD * 0.5, percentage: 50 },
      { label: 'MAR', value: financials.volumeUSD * 0.3, percentage: 30 },
      { label: 'ABR', value: financials.volumeUSD * 0.6, percentage: 60 },
      { label: 'MAY', value: financials.volumeUSD * 0.8, percentage: 80 },
      { label: 'JUN', value: financials.volumeUSD, percentage: 100 },
  ];

  // --- RENDERERS ---

  // Resumen general — diseño de marca (dark, KPIs con contexto, cola
  // unificada de pendientes, estado del sistema y equipo admin).
  const renderOverview = () => {
      const now = new Date();
      const ageStr = (d?: string) => {
          if (!d) return '';
          const ms = Date.now() - new Date(d).getTime();
          if (!Number.isFinite(ms)) return '';   // fecha ilegible → sin "hace NaN d"
          const m = Math.floor(ms / 60000);
          if (m < 1) return 'recién';
          if (m < 60) return `hace ${m} min`;
          const h = Math.floor(m / 60);
          if (h < 24) return `hace ${h} h`;
          return `hace ${Math.floor(h / 24)} d`;
      };
      const usdEq = (tx: any) => { const r = getRate((tx.currency || '').split('_')[0], 'USD') || 0; return Number(tx.amount || 0) * r; };
      const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
      // Volumen del mes (completadas este mes, en USD eq.)
      const monthVol = historyTransactions.filter(tx => {
          const d = tx.createdAt ? new Date(tx.createdAt) : null;
          return tx.status === 'Completado' && d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).reduce((s, tx) => s + usdEq(tx), 0);
      const depSum = pendingDeposits.reduce((s, tx) => s + usdEq(tx), 0);
      const witSum = pendingWithdrawals.reduce((s, tx) => s + usdEq(tx), 0);
      const pendingClients = allUsers.filter(u => !outOfOperation(u) && (u.kycStatus === 'pending' || u.kycStatus === 'in_review'));
      // Cola unificada, ordenada por antigüedad (más viejo primero).
      const queue = [
          ...pendingClients.map(u => ({ id: `kyc-${u.id}`, sig: (u.name || 'C').charAt(0).toUpperCase(), title: `KYC · ${u.name || 'Cliente'}`, meta: 'Verificación en revisión · falta aprobación manual', at: (u as any).createdAt, tab: 'clients' as const })),
          ...pendingDeposits.map(tx => ({ id: `dep-${tx.id}`, sig: '↓', title: `Carga · ${fmtUsd(usdEq(tx))} USD eq.`, meta: `${tx.userName || tx.beneficiary || 'Cliente'} · falta acreditar`, at: tx.createdAt, tab: 'treasury' as const })),
          ...pendingWithdrawals.map(tx => ({ id: `wit-${tx.id}`, sig: '↑', title: `Retiro · ${fmtUsd(usdEq(tx))} USD eq.`, meta: `${tx.bank || tx.beneficiary || 'Destino'} · falta aprobar`, at: tx.createdAt, tab: 'treasury' as const })),
      ].sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime());

      const card: React.CSSProperties = { background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14 };
      const secBtn: React.CSSProperties = { border: '1px solid rgba(255,255,255,0.11)', background: 'rgba(255,255,255,0.045)', borderRadius: 8, padding: '7px 13px', fontSize: 12, fontWeight: 600, color: '#F4F4F2' };
      const oldest = queue[0]?.at ? ageStr(queue[0].at) : '';
      const kpis: { label: string; value: string | number; sub: React.ReactNode; tab: string }[] = [
          { label: 'Clientes por aprobar', value: pendingClients.length, sub: pendingClients.length ? `KYC en revisión · el más antiguo ${ageStr((pendingClients[0] as any)?.createdAt) || 'hoy'}` : 'Sin KYC en cola', tab: 'clients' },
          { label: 'Cargas por acreditar', value: pendingDeposits.length, sub: pendingDeposits.length ? `${fmtUsd(depSum)} USD eq. esperando confirmación` : 'Nada por acreditar', tab: 'treasury' },
          { label: 'Retiros por aprobar', value: pendingWithdrawals.length, sub: pendingWithdrawals.length ? `${fmtUsd(witSum)} USD eq. · requieren aprobación` : 'Nada por aprobar', tab: 'treasury' },
          { label: 'Volumen del mes', value: fmtUsd(monthVol), sub: <span>{historyTransactions.filter(t => t.status === 'Completado').length} operaciones completadas</span>, tab: 'reports' },
      ];
      const services: { name: string; state: string; ok: boolean }[] = [
          { name: 'Riel de conversión y retiros', state: apiStatus === 'error' ? 'Lento' : 'En línea', ok: apiStatus !== 'error' },
          { name: 'Custodia GasFree (TRON)', state: 'En línea', ok: true },
          { name: 'Bre-B · ACH Colombia', state: 'En línea', ok: true },
          { name: 'Base de datos', state: isOnline ? 'En línea' : 'Desconectada', ok: isOnline },
      ];
      return (
      <div className="animate-in fade-in duration-300" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* KPIs */}
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
              {kpis.map(k => (
                  <button key={k.label} onClick={() => setActiveTab(k.tab as any)} className="text-left transition-colors" style={{ ...card, padding: '18px 20px', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)')} onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)')}>
                      <p style={{ fontSize: 12, color: '#878E88' }}>{k.label}</p>
                      <p style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.8px', color: '#F4F4F2', marginTop: 8 }}>{dataReady ? k.value : '—'}</p>
                      <p style={{ fontSize: 11.5, color: '#878E88', marginTop: 6, lineHeight: 1.4 }}>{k.sub}</p>
                  </button>
              ))}
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
              <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
                  {/* Pendientes de acción */}
                  <div style={card}>
                      <div className="flex items-center justify-between" style={{ padding: '16px 22px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: '#F4F4F2' }}>Pendientes de acción</span>
                          {queue.length > 0 && <button onClick={() => setActiveTab('treasury')} style={{ fontSize: 12.5, fontWeight: 600, color: '#878E88' }} className="hover:text-[#F4F4F2] transition-colors">Ver todo →</button>}
                      </div>
                      {queue.length === 0 ? (
                          <div className="text-center" style={{ padding: '48px 20px', color: '#878E88' }}>
                              <p style={{ fontSize: 13 }}>Nada pendiente.</p>
                              <p style={{ fontSize: 12, marginTop: 4 }}>Las nuevas solicitudes aparecen aquí.</p>
                          </div>
                      ) : queue.slice(0, 8).map(item => (
                          <div key={item.id} className="flex items-center hover:bg-white/[0.02] transition-colors" style={{ gap: 12, padding: '13px 22px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                              <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.055)', fontSize: 12, fontWeight: 800, color: '#878E88' }}>{item.sig}</span>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                  <p style={{ fontSize: 13.5, fontWeight: 600, color: '#F4F4F2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</p>
                                  <p style={{ fontSize: 11.5, color: '#878E88', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.meta}</p>
                              </div>
                              <span style={{ fontSize: 11, color: '#878E88', flexShrink: 0, whiteSpace: 'nowrap' }}>{ageStr(item.at)}</span>
                              <button onClick={() => setActiveTab(item.tab as any)} style={secBtn} className="hover:bg-white/[0.09] transition-colors" >Revisar</button>
                          </div>
                      ))}
                  </div>

                  {/* Columna derecha */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {/* Estado del sistema */}
                      <div style={{ ...card, padding: '18px 20px' }}>
                          <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
                              <span style={{ fontSize: 15, fontWeight: 700, color: '#F4F4F2' }}>Estado del sistema</span>
                              <span style={{ border: '1px solid rgba(74,222,128,0.3)', color: '#4ADE80', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>● OPERATIVO</span>
                          </div>
                          {services.map((s, i) => (
                              <div key={s.name} className="flex items-center justify-between" style={{ gap: 12, padding: '10px 0', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                                  <span style={{ fontSize: 12.5, color: '#F4F4F2' }}>{s.name}</span>
                                  <span style={{ fontSize: 12.5, fontWeight: 600, color: s.ok ? '#4ADE80' : 'rgba(244,244,242,0.7)' }}>{s.state}</span>
                              </div>
                          ))}
                      </div>

                      {/* Equipo admin */}
                      <div style={{ ...card, padding: '18px 20px' }}>
                          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                              <span style={{ fontSize: 15, fontWeight: 700, color: '#F4F4F2' }}>Equipo admin</span>
                              <button onClick={() => setActiveTab('team' as any)} style={{ fontSize: 12, fontWeight: 600, color: '#878E88' }} className="hover:text-[#F4F4F2] transition-colors">Gestionar</button>
                          </div>
                          {adminTeam.length === 0 ? (
                              <p style={{ fontSize: 12.5, color: '#878E88', padding: '8px 0' }}>Sin miembros del equipo todavía.</p>
                          ) : adminTeam.map(admin => (
                              <div key={admin.id} className="flex items-center justify-between" style={{ gap: 12, padding: '9px 0' }}>
                                  <div className="flex items-center" style={{ gap: 11, minWidth: 0 }}>
                                      <span style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: 'linear-gradient(140deg, #2E3330, #1A1D1B)', fontSize: 12, fontWeight: 800, color: '#878E88' }}>{(admin?.name ?? '?').charAt(0).toUpperCase()}</span>
                                      <div style={{ minWidth: 0 }}>
                                          <p style={{ fontSize: 13, fontWeight: 600, color: '#F4F4F2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{admin.name}</p>
                                          <p style={{ fontSize: 11, color: '#878E88' }}>{admin.role || 'Administrador'}</p>
                                      </div>
                                  </div>
                                  <span className="flex items-center" style={{ gap: 5, flexShrink: 0 }}>
                                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4ADE80' }} />
                                      <span style={{ fontSize: 11, color: '#4ADE80' }}>En línea</span>
                                  </span>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>
          </div>
      </div>
      );
  };

  // ... (keep the rest of renderClients, renderMarketing, renderTreasury, renderReports, renderConfig, renderBanks, renderRates, renderTeam, renderDesign, renderSecurity exactly as they were in previous file)
  // Re-including them for XML validity context if necessary, but skipping for brevity as they don't change logic, just structure. 
  // Assuming full file replacement, I'll include one renderer to ensure valid structure and instruct to keep rest.
  
  // NOTE: For the sake of the XML response, I will output the *entire* file content including the unchanged renderers to ensure the user can just copy-paste without errors.
  
  // La vista de clientes vive ahora en components/AdminClientes.tsx
  // (maestro-detalle). Acá quedaba una segunda lista con sus propios
  // botones; dos pantallas para lo mismo se separan en cuanto una cambia.

  const renderMarketing = () => (
      <div className="space-y-6 animate-in fade-in duration-300">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2"><Tag size={20} className="text-[#0C0E0D]"/> Gestión de Cupones</h3>
              
              <div className="flex gap-4 mb-6 items-end">
                  <div className="flex-1">
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Código Cupón</label>
                      <input 
                          type="text" 
                          value={newCouponCode}
                          onChange={(e) => setNewCouponCode(e.target.value.toUpperCase())}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm uppercase focus:border-[#0C0E0D] outline-none"
                          placeholder="EJ: VERANO2025"
                      />
                  </div>
                  <div className="w-32">
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Descuento (%)</label>
                      <input 
                          type="number" 
                          value={newCouponDiscount}
                          onChange={(e) => setNewCouponDiscount(e.target.value)}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-[#0C0E0D] outline-none"
                          placeholder="20"
                      />
                  </div>
                  <button onClick={handleAddCoupon} className="bg-[#0C0E0D] px-6 py-2 rounded-lg font-bold text-sm hover:bg-[#161A17] h-[38px] flex items-center gap-2">
                      <Plus size={16}/> Crear
                  </button>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs">
                          <tr>
                              <th className="px-6 py-3">Código</th>
                              <th className="px-6 py-3">Descuento</th>
                              <th className="px-6 py-3">Estado</th>
                              <th className="px-6 py-3 text-right">Acciones</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                          {systemConfig.coupons.map((coupon, idx) => (
                              <tr key={idx} className="hover:bg-slate-50">
                                  <td className="px-6 py-3 font-bold text-slate-700">{coupon.code}</td>
                                  <td className="px-6 py-3 text-green-600 font-bold">-{coupon.discount}%</td>
                                  <td className="px-6 py-3">
                                      <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${coupon.active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}>
                                          {coupon.active ? 'Activo' : 'Inactivo'}
                                      </span>
                                  </td>
                                  <td className="px-6 py-3 text-right flex justify-end gap-2">
                                      <button onClick={() => toggleCoupon(coupon.code)} className="text-slate-400 hover:text-[#0C0E0D] p-1"><RefreshCw size={14}/></button>
                                      <button onClick={() => removeCoupon(coupon.code)} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={14}/></button>
                                  </td>
                              </tr>
                          ))}
                          {systemConfig.coupons.length === 0 && (
                              <tr><td colSpan={4} className="p-4 text-center text-slate-400">No hay cupones activos.</td></tr>
                          )}
                      </tbody>
                  </table>
              </div>
          </div>
      </div>
  );

  const renderCargues = () => {
      const q = carguesSearch.trim().toLowerCase();
      // Primero lo que encontró el servidor (toda la base); después, lo que
      // ya estaba cargado y coincide. Sin texto, los cargados.
      const remotos = carguesRemotos && carguesRemotos.q.toLowerCase() === q
        ? carguesRemotos.ids.map(id => allUsers.find(u => u.id === id)).filter(Boolean) as User[]
        : [];
      const locales = allUsers.filter(u => !q || (u.name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q));
      const vistos = new Set<string>();
      const list = [...remotos, ...locales]
        .filter(u => { if (vistos.has(u.id)) return false; vistos.add(u.id); return true; })
        .filter(u => !outOfOperation(u))   // bloqueadas / lista negra no se cargan
        // Empresas por defecto: son las que más se cargan.
        .filter(u => carguesTipo === 'todos' || u.role === carguesTipo)
        .slice(0, 40);
      const bal = (u: User | null, code: string) => Number((u?.balances as any)?.[code] ?? 0);
      // En pantalla va el PROVEEDOR y debajo sus servicios: Mouv y Finity
      // tienen los dos Bre-B y ACH. Por dentro el saldo COP_BREB del cliente es
      // su cuenta en Mouv y COP_ACH su cuenta en Finity (los nombres de las
      // columnas vienen de antes, cuando cada proveedor tenía un solo servicio).
      const railMeta: Record<string, { label: string; sub: string; corto: string; icon: React.ElementType }> = {
        COP:      { label: 'Saldo Lincoin', sub: 'Cuenta principal · COP', corto: 'Saldo Lincoin', icon: Wallet },
        COP_BREB: { label: 'Mouv',          sub: 'Bre-B y ACH',            corto: 'Mouv',          icon: Zap },
        COP_ACH:  { label: 'Finity',        sub: 'Bre-B y ACH',            corto: 'Finity',        icon: Landmark },
      };

      // ── Respaldo y utilidad por riel ──────────────────────────────
      // Lo que Lincoin YA le debe a los clientes en cada riel (suma de sus
      // saldos). La bolsa del proveedor (Mouv=Bre-B, Finity=ACH) debe cubrir
      // eso; lo que sobra es la UTILIDAD que va quedando en pesos.
      //
      // La suma es de TODA la base y la hace el servidor: sumada aquí con la
      // lista del panel (que ya no trae a todos los clientes) daba de menos,
      // y el "disponible para cargar" salía de más. Sin el dato del servidor
      // se suma lo cargado y se avisa abajo.
      const obligServidor = !!obligaciones && !obligaciones.parcial;
      const obligOf = (code: string) => obligaciones && typeof obligaciones.valor?.[code] === 'number'
        ? obligaciones.valor[code]
        : allUsers.reduce((s, u) => s + Number((u.balances as any)?.[code] ?? 0), 0);
      const obligBreb = obligOf('COP_BREB');
      const obligAch  = obligOf('COP_ACH');
      const brebPool  = Number(mouvPool?.breb ?? mouvPool?.total ?? 0);
      const achPool   = Number(finityPool?.cop ?? 0);
      const freeBreb  = brebPool - obligBreb;   // disponible para cargar Bre-B (= utilidad Mouv)
      const freeAch   = achPool - obligAch;     // disponible para cargar ACH   (= utilidad Finity)
      // Disponible/utilidad del riel actualmente elegido (para el guard del cargue).
      const poolReady = carguesRail === 'COP_BREB' ? (mouvPool && !mouvPool.loading && !mouvPool.error)
                      : carguesRail === 'COP_ACH'  ? (finityPool && !finityPool.loading && !finityPool.error)
                      : false;
      const freeForRail = carguesRail === 'COP_BREB' ? freeBreb : carguesRail === 'COP_ACH' ? freeAch : Infinity;

      // Guard anti sobre-acreditación: un cargue en Bre-B/ACH NO puede
      // comprometer más de lo que la bolsa del proveedor tiene libre (si no,
      // le prometes a un cliente COP que no está respaldado). El neto que se
      // acredita (bruto − comisión) es lo que aumenta la deuda con clientes.
      const cRaw = carguesConfirm?.raw ?? 0;
      const cFee = (carguesRail === 'COP_BREB' && carguesDir === 'credit' && !carguesRecordOnly) ? Math.round(cRaw * 0.10 / 100) : 0;
      const cNet = cRaw - cFee;
      const guardActive = carguesDir === 'credit' && !carguesRecordOnly && (carguesRail === 'COP_BREB' || carguesRail === 'COP_ACH') && !!poolReady;
      const cargueExceeds = guardActive && cNet > freeForRail + 0.5;
      const cargueShortfall = cargueExceeds ? Math.round(cNet - freeForRail) : 0;

      // ── Vista previa (solo pantalla) ──────────────────────────────
      // Lo mismo que va a mostrar la confirmación, pero mientras se escribe:
      // cuánto entra, en qué cuenta y si excede lo disponible en la bolsa.
      const montoVista = usandoAcct ? (acctCalc.listo ? acctCalc.copToClient : 0) : (Number(carguesAmount) || 0);
      const netoVista = montoVista - ((carguesRail === 'COP_BREB' && carguesDir === 'credit' && !carguesRecordOnly) ? Math.round(montoVista * 0.10 / 100) : 0);
      const excedeVista = carguesDir === 'credit' && !carguesRecordOnly && (carguesRail === 'COP_BREB' || carguesRail === 'COP_ACH') && !!poolReady && montoVista > 0 && netoVista > freeForRail + 0.5;
      const elegirCliente = (u: User) => {
        setCarguesClientId(u.id); setCarguesMsg(null); setCarguesSearch('');
        // El cursor sigue al primer dato que falta: la operación o el monto.
        setTimeout(() => (document.getElementById(usandoAcct ? 'cargue-usdt-enviado' : 'cargue-monto') as HTMLInputElement | null)?.focus(), 0);
      };
      // Últimos cargues manuales del cliente elegido, para la columna derecha.
      const fechaCargue = (t: any): number => {
        const v = String(t?.creditedAt ?? t?.createdAt ?? t?.created_at ?? t?.date ?? '').trim();
        const dmy = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        const d = dmy ? new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])) : new Date(v);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      };
      const ultimosCargues = carguesClient ? (histCargues.movimientos as any[])
        .filter(t => t.userId === carguesClient.id && (t.source === 'admin_cargue' || t.source === 'admin_backfill' || t.type === 'adjustment' || (t.type === 'load' && t.rail)))
        .sort((a, b) => fechaCargue(b) - fechaCargue(a))
        .slice(0, 6) : [];
      // Quién hizo un movimiento manual. El servidor manda nombre y correo solo
      // al dueño; a los demás miembros, si fue él (esYo).
      const quienTx = (t: any): string => {
        const a = t?.por ?? t?.resueltoPor;
        if (!a) return esDueno ? 'admin (antes del registro)' : 'el equipo';
        if ('esYo' in a) return a.esYo ? 'ti' : 'el equipo';
        return String(a.nombre || a.email || 'admin');
      };
      const CAMPO: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#070808', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, color: '#F4F4F2', padding: '11px 13px', fontSize: 14, outline: 'none' };
      const ROTULO: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: '#878E88', marginBottom: 7 };
      const bolsas = [
        { rail: 'COP_BREB' as const, label: 'Mouv', icon: Zap, pool: brebPool, oblig: obligBreb, free: freeBreb, loading: mouvPool?.loading, error: mouvPool?.error, reload: loadMouvPool,
          detalle: mouvPool && !mouvPool.loading && !mouvPool.error ? `Bre-B ${mouvPool.breb != null ? Math.round(mouvPool.breb).toLocaleString('es-CO') : '—'} · ACH ${mouvPool.ach != null ? Math.round(mouvPool.ach).toLocaleString('es-CO') : '—'}` : null },
        { rail: 'COP_ACH' as const, label: 'Finity', icon: Landmark, pool: achPool, oblig: obligAch, free: freeAch, loading: finityPool?.loading, error: finityPool?.error, reload: loadFinityPool, detalle: null },
      ];

      return (
        <div className="animate-in fade-in duration-300" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ── Encabezado: título, aviso temporal plegado y las dos bolsas ── */}
          <div className="flex items-start justify-between flex-wrap" style={{ gap: 14 }}>
            <div>
              {/* Cambio rápido de billetera: solo los países del miembro. */}
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <button onClick={() => setMenuBilletera(v => !v)} title="Cambiar de billetera" disabled={billeterasDisponibles.length < 2}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, color: '#F4F4F2', cursor: billeterasDisponibles.length < 2 ? 'default' : 'pointer' }}>
                  <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px' }}>Billetera</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '3px 9px 3px 8px' }}>
                    {billeteraPais === 'CO' ? '🇨🇴 COP' : '🇺🇸 USD'}
                    {billeterasDisponibles.length > 1 && <ChevronDown size={13} style={{ color: '#878E88', transform: menuBilletera ? 'rotate(180deg)' : 'none' }} />}
                  </span>
                </button>
                {menuBilletera && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 20, width: 260, background: '#121413', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12, padding: 6, boxShadow: '0 18px 40px rgba(0,0,0,0.5)' }}>
                    {([['CO', '🇨🇴', 'Colombia · COP', 'Mouv y Finity · Bre-B y ACH'], ['US', '🇺🇸', 'Estados Unidos · USD', 'Dólares digitales (USDC)']] as const)
                      .filter(([k]) => (billeterasDisponibles as readonly string[]).includes(k))
                      .map(([k, flag, t, sub]) => (
                        <button key={k} onClick={() => { setBilleteraPais(k); setMenuBilletera(false); }}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left', background: billeteraPais === k ? 'rgba(74,222,128,0.10)' : 'transparent', color: '#F4F4F2' }}>
                          <span style={{ fontSize: 18 }}>{flag}</span>
                          <span style={{ flex: 1 }}>
                            <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{t}</span>
                            <span style={{ display: 'block', fontSize: 11, color: '#878E88' }}>{sub}</span>
                          </span>
                          {billeteraPais === k && <CheckCircle size={14} style={{ color: '#4ADE80' }} />}
                        </button>
                      ))}
                  </div>
                )}
              </div>
              {/* El aviso de proceso temporal sigue ahí, plegado: se lee una
                  vez y después solo ocupaba media pantalla. */}
              <br />
              {billeteraPais === 'CO' && <details style={{ marginTop: 4 }}>
                <summary style={{ listStyle: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, color: '#FBBF24', fontSize: 12, fontWeight: 600 }}>
                  <Info size={13} /> Cargue manual de saldo (temporal) · ¿qué es?
                </summary>
                <p style={{ margin: '8px 0 0', maxWidth: 560, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 12, padding: '10px 14px', fontSize: 12.5, color: '#FCD34D', lineHeight: 1.55 }}>
                  Mientras Mouv apifica el conversor, el pago llega por el grupo cerrado y aquí reflejas el saldo del cliente
                  en la cuenta correspondiente (Saldo Lincoin, Mouv o Finity). Cada cargue queda registrado en el historial del cliente.
                </p>
              </details>}
            </div>
            {billeteraPais === 'CO' && <div className="flex flex-wrap" style={{ gap: 10 }}>
              {bolsas.map(b => {
                const activa = carguesRail === b.rail;
                return (
                  <div key={b.rail} style={{ background: '#0C0E0D', border: `1px solid ${activa ? 'rgba(74,222,128,0.45)' : 'rgba(255,255,255,0.10)'}`, borderRadius: 12, padding: '9px 14px', minWidth: 210 }}>
                    <div className="flex items-center justify-between" style={{ gap: 10 }}>
                      <span className="flex items-center" style={{ gap: 6, fontSize: 12.5, fontWeight: 700, color: '#F4F4F2' }}>
                        <b.icon size={13} style={{ color: '#4ADE80' }} /> {b.label} <span style={{ color: '#878E88', fontWeight: 600, fontSize: 11 }}>· Bre-B y ACH</span>
                      </span>
                      <button onClick={b.reload} disabled={b.loading} title={`Actualizar ${b.label}`} style={{ background: 'none', border: 'none', color: '#878E88', cursor: 'pointer', padding: 2 }}>
                        <RefreshCw size={12} className={b.loading ? 'animate-spin' : ''} />
                      </button>
                    </div>
                    {b.error ? (
                      <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#F87171', fontWeight: 600, maxWidth: 260 }}>{b.error}</p>
                    ) : b.loading ? (
                      <p style={{ margin: '4px 0 0', fontSize: 13, color: '#878E88' }}>Cargando…</p>
                    ) : (
                      <>
                        <p style={{ margin: '3px 0 0', fontSize: 16, fontWeight: 800, letterSpacing: '-0.4px', color: b.free < 0 ? '#F87171' : '#4ADE80' }}>
                          {Math.round(b.free).toLocaleString('es-CO')} <span style={{ fontSize: 11, color: '#878E88', fontWeight: 600 }}>{b.free < 0 ? 'faltante (sobre-cargado)' : 'disponible'}</span>
                        </p>
                        <p style={{ margin: '1px 0 0', fontSize: 10.5, color: 'rgba(244,244,242,0.45)' }}>Bolsa {Math.round(b.pool).toLocaleString('es-CO')} − comprometido {Math.round(b.oblig).toLocaleString('es-CO')}</p>
                        {b.detalle && <p style={{ margin: '1px 0 0', fontSize: 10.5, color: 'rgba(244,244,242,0.45)' }}>{b.detalle}</p>}
                      </>
                    )}
                  </div>
                );
              })}
              {/* Lo que es de Lincoin en las bolsas: apertura + utilidad desde
                  entonces (caja_estado). Antes de abrir la caja, se avisa. */}
              {(() => {
                const ps: any[] = caja?.proveedores ?? [];
                const abiertas = ps.filter(p => p.lincoinEsperado != null);
                const total = abiertas.reduce((a, p) => a + Number(p.lincoinEsperado), 0);
                return (
                  <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: '9px 14px', minWidth: 200 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: '#F4F4F2' }}>Lincoin<span style={{ color: '#4ADE80' }}>.</span> <span style={{ color: '#878E88', fontWeight: 600, fontSize: 11 }}>· utilidades</span></span>
                    {!caja ? <p style={{ margin: '4px 0 0', fontSize: 13, color: '#878E88' }}>Cargando…</p>
                      : abiertas.length === 0 ? <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#878E88', maxWidth: 210, lineHeight: 1.4 }}>La caja se abre hoy a las 23:59 (o desde Tesorería).</p>
                      : <>
                          <p style={{ margin: '3px 0 0', fontSize: 16, fontWeight: 800, letterSpacing: '-0.4px', color: '#F4F4F2' }}>{Math.round(total).toLocaleString('es-CO')}</p>
                          <p style={{ margin: '1px 0 0', fontSize: 10.5, color: 'rgba(244,244,242,0.45)' }}>{ps.map(p => `${p.proveedor} ${p.lincoinEsperado == null ? '—' : Math.round(p.lincoinEsperado).toLocaleString('es-CO')}`).join(' · ')}</p>
                        </>}
                  </div>
                );
              })()}
            </div>}
          </div>
          {billeteraPais === 'US' ? (
            <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16, padding: '40px 24px', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 28 }}>🇺🇸</p>
              <p style={{ margin: '8px 0 0', fontSize: 16, fontWeight: 800, color: '#F4F4F2' }}>Billetera USD · Estados Unidos</p>
              <p style={{ margin: '6px auto 0', maxWidth: 440, fontSize: 13, color: '#878E88', lineHeight: 1.55 }}>
                Aquí va el mismo formulario de cargue, con los destinos y bolsas de USD, cuando ese riel quede conectado.
              </p>
              <button onClick={() => setBilleteraPais('CO')} style={{ marginTop: 16, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: '#F4F4F2', borderRadius: 10, padding: '9px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Volver a 🇨🇴 COP</button>
            </div>
          ) : <>
          {!obligServidor && (
            <p style={{ margin: 0, fontSize: 11.5, color: '#FB923C', lineHeight: 1.45 }}>
              {obligaciones?.parcial
                ? 'Comprometido con clientes: suma parcial. Falta correr la migración 2026_zz12_escala_100k.sql para sumar todos los saldos en la base.'
                : resumenUsuarios?.parcial
                  ? 'Comprometido con clientes: suma solo de los clientes cargados en el panel, puede faltar. No cargues contra este disponible hasta que se actualice.'
                  : 'Comprometido con clientes: suma de los clientes cargados en el panel.'}
            </p>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] items-start" style={{ gap: 16 }}>
            {/* ── Formulario: se ve apenas se abre la pantalla ── */}
            <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="flex items-center justify-between flex-wrap" style={{ gap: 10 }}>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#F4F4F2' }}>Registrar cargue</p>
                <div style={{ display: 'flex', background: '#070808', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: 3 }}>
                  {(['credit', 'debit'] as const).map(d => (
                    <button key={d} onClick={() => setCarguesDir(d)} style={{ border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 13px', fontSize: 12, fontWeight: 700, background: carguesDir === d ? (d === 'credit' ? '#4ADE80' : '#F87171') : 'transparent', color: carguesDir === d ? '#0C0E0D' : '#878E88' }}>
                      {d === 'credit' ? 'Acreditar +' : 'Descontar −'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 1 · Cliente: un solo buscador; al elegir queda como ficha */}
              <div>
                <div className="flex items-center justify-between" style={{ gap: 10, marginBottom: 7 }}>
                  <label style={{ ...ROTULO, marginBottom: 0 }}>Cliente</label>
                  {!carguesClient && (
                    <div style={{ display: 'flex', background: '#070808', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: 2 }}>
                      {([['business', 'Empresas'], ['personal', 'Personas'], ['todos', 'Todos']] as const).map(([k, l]) => (
                        <button key={k} onClick={() => setCarguesTipo(k)}
                          style={{ border: 'none', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: carguesTipo === k ? '#F4F4F2' : 'transparent', color: carguesTipo === k ? '#0C0E0D' : '#878E88' }}>{l}</button>
                      ))}
                    </div>
                  )}
                </div>
                {carguesClient ? (
                  <div className="flex items-center justify-between" style={{ ...CAMPO, gap: 10, borderColor: 'rgba(74,222,128,0.45)' }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{carguesClient.name} <span style={{ color: '#878E88', fontWeight: 600, fontSize: 11.5 }}>· {carguesClient.email}</span></p>
                      <p style={{ margin: '3px 0 0', fontSize: 11.5, color: '#878E88' }}>
                        {(['COP', 'COP_BREB', 'COP_ACH'] as const).map((code, i) => (
                          <React.Fragment key={code}>{i ? ' · ' : ''}{railMeta[code].corto} <b style={{ color: '#F4F4F2' }}>{formatMoney(bal(carguesClient, code), '')}</b></React.Fragment>
                        ))}
                      </p>
                    </div>
                    <button onClick={() => { setCarguesClientId(null); setCarguesMsg(null); }} title="Cambiar cliente" style={{ background: 'none', border: 'none', color: '#878E88', cursor: 'pointer' }}><X size={16} /></button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search size={15} style={{ position: 'absolute', left: 13, top: 13, color: '#878E88' }} />
                      <input autoFocus type="text" placeholder="Nombre o correo del cliente…" value={carguesSearch}
                        onChange={(e) => setCarguesSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) elegirCliente(list[0]); }}
                        style={{ ...CAMPO, paddingLeft: 36 }} />
                    </div>
                    <div style={{ marginTop: 6, background: '#121413', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, maxHeight: 280, overflowY: 'auto' }}>
                      {list.length === 0 && <p style={{ margin: 0, padding: 14, fontSize: 12.5, color: '#878E88' }}>Sin clientes que coincidan.</p>}
                      {list.map((u, i) => (
                        <button key={u.id} onClick={() => elegirCliente(u)} className="hover:bg-white/5 transition-colors"
                          style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 14px', border: 'none', borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none', background: 'transparent', cursor: 'pointer', color: '#F4F4F2' }}>
                          <span style={{ width: 30, height: 30, borderRadius: 999, background: 'rgba(255,255,255,0.08)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{(u.name ?? 'U').slice(0, 2).toUpperCase()}</span>
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{u.name ?? 'Sin nombre'}</span>
                            <span style={{ display: 'block', fontSize: 11.5, color: '#878E88', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
                          </span>
                          {i === 0 && carguesSearch.trim() && <span style={{ fontSize: 10, color: '#878E88', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, padding: '2px 6px' }}>Enter</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* 2 · Destino: dónde queda el saldo del cliente */}
              <div>
                <label style={ROTULO}>Destino</label>
                <div className="grid grid-cols-3" style={{ gap: 8 }}>
                  {(['COP', 'COP_BREB', 'COP_ACH'] as const).map(code => {
                    const M = railMeta[code];
                    const active = carguesRail === code;
                    const libre = code === 'COP_BREB' ? freeBreb : code === 'COP_ACH' ? freeAch : null;
                    return (
                      <button key={code} onClick={() => setCarguesRail(code)}
                        style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 12, padding: '11px 12px', color: '#F4F4F2', background: active ? 'rgba(74,222,128,0.10)' : 'transparent', border: active ? '1.5px solid #4ADE80' : '1px solid rgba(255,255,255,0.14)' }}>
                        <span className="flex items-center justify-between">
                          <M.icon size={16} style={{ color: active ? '#4ADE80' : '#878E88' }} />
                          {active && <CheckCircle size={14} style={{ color: '#4ADE80' }} />}
                        </span>
                        <span style={{ display: 'block', marginTop: 7, fontSize: 13.5, fontWeight: 800 }}>{M.label}</span>
                        <span style={{ display: 'block', fontSize: 11, color: '#878E88' }}>{M.sub}</span>
                        {libre != null && <span style={{ display: 'block', marginTop: 5, fontSize: 10.5, color: 'rgba(244,244,242,0.45)' }}>disp. {Math.round(libre).toLocaleString('es-CO')}</span>}
                        {carguesClient && <span style={{ display: 'block', marginTop: 4, fontSize: 10.5, color: '#878E88' }}>cliente: {formatMoney(bal(carguesClient, code), '')}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3 · Monto: desde la operación (por defecto) o a mano */}
              <div>
                <label style={ROTULO}>Monto</label>
                  {/* ── Contabilidad de la operación ──────────────────────
                      El COP no se escribe a mano: sale de la operación real.
                      Así la utilidad es un dato del cargue y no "lo que
                      sobró" al final del día. */}
                  {carguesDir === 'credit' && !carguesRecordOnly && (
                    <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#121413', border: '1px solid rgba(74,222,128,0.22)' }}>
                      <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
                        <input type="checkbox" checked={acctOn} onChange={e => setAcctOn(e.target.checked)} style={{ width: 15, height: 15, accentColor: '#4ADE80' }} />
                        <span className="text-xs font-bold" style={{ color: '#F4F4F2' }}>Calcular desde la operación (USDT y tasas)</span>
                      </label>

                      {acctOn ? (<>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: '#878E88' }}>USDT que envió</label>
                            <input id="cargue-usdt-enviado" inputMode="decimal" placeholder="50000" value={acctUsdtGross}
                              onChange={e => setAcctUsdtGross(e.target.value.replace(/[^\d.]/g, ''))}
                              className="w-full px-2.5 py-2 rounded-lg text-sm font-bold outline-none"
                              style={{ backgroundColor: '#0C0E0D', color: '#F4F4F2', border: '1px solid rgba(255,255,255,0.12)' }} />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: '#878E88' }}>USDT que llegaron</label>
                            <input inputMode="decimal" placeholder="49995" value={acctUsdtNet}
                              onChange={e => setAcctUsdtNet(e.target.value.replace(/[^\d.]/g, ''))}
                              className="w-full px-2.5 py-2 rounded-lg text-sm font-bold outline-none"
                              style={{ backgroundColor: '#0C0E0D', color: '#F4F4F2', border: '1px solid rgba(255,255,255,0.12)' }} />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: '#878E88' }}>A cómo vendí (COP/USDT)</label>
                            <input inputMode="decimal" placeholder="3900" value={acctSellRate}
                              onChange={e => setAcctSellRate(e.target.value.replace(/[^\d.]/g, ''))}
                              className="w-full px-2.5 py-2 rounded-lg text-sm font-bold outline-none"
                              style={{ backgroundColor: '#0C0E0D', color: '#F4F4F2', border: '1px solid rgba(255,255,255,0.12)' }} />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: '#878E88' }}>A cómo le pago (COP/USDT)</label>
                            <input inputMode="decimal" placeholder="3850" value={acctClientRate}
                              onChange={e => setAcctClientRate(e.target.value.replace(/[^\d.]/g, ''))}
                              className="w-full px-2.5 py-2 rounded-lg text-sm font-bold outline-none"
                              style={{ backgroundColor: '#0C0E0D', color: '#F4F4F2', border: '1px solid rgba(255,255,255,0.12)' }} />
                          </div>
                        </div>

                        <div className="flex gap-1 p-1 rounded-lg mt-2" style={{ backgroundColor: '#0C0E0D' }}>
                          {([['lincoin', 'El fee lo asumo yo'], ['cliente', 'El fee lo asume el cliente']] as const).map(([k, lbl]) => (
                            <button key={k} onClick={() => setAcctFeeBearer(k)}
                              className="flex-1 py-1.5 text-[11px] font-bold rounded transition-colors"
                              style={acctFeeBearer === k ? { backgroundColor: '#4ADE80', color: '#0C0E0D' } : { color: '#878E88' }}>{lbl}</button>
                          ))}
                        </div>

                        {acctCalc.listo ? (
                          <div className="mt-2.5 rounded-lg p-2.5 space-y-1" style={{ backgroundColor: '#0C0E0D', border: '1px solid rgba(255,255,255,0.08)' }}>
                            {[
                              ['Entró por la venta', `${acctCalc.revenueCop.toLocaleString('es-CO')} COP`, '#F4F4F2', `${acctCalc.usdtNet.toLocaleString('es-CO')} USDT × ${acctCalc.sellRate.toLocaleString('es-CO')}`],
                              ['Fee de red perdido', `${acctCalc.feeUsdt.toLocaleString('es-CO')} USDT`, '#FBBF24', `≈ ${acctCalc.feeCostCop.toLocaleString('es-CO')} COP a tu tasa de venta`],
                              ['Se le acredita al cliente', `${acctCalc.creditedCop.toLocaleString('es-CO')} COP`, '#F4F4F2', acctCalc.feeBreb > 0 ? `${acctCalc.copToClient.toLocaleString('es-CO')} − ${acctCalc.feeBreb.toLocaleString('es-CO')} de comisión Bre-B` : `${(acctFeeBearer === 'lincoin' ? acctCalc.usdtGross : acctCalc.usdtNet).toLocaleString('es-CO')} USDT × ${acctCalc.clientRate.toLocaleString('es-CO')}`],
                            ].map(([l, v, c, sub]: any) => (
                              <div key={l} className="flex items-start justify-between gap-3">
                                <div><p className="text-[11px] m-0" style={{ color: '#878E88' }}>{l}</p><p className="text-[10px] m-0" style={{ color: 'rgba(244,244,242,0.45)' }}>{sub}</p></div>
                                <span className="text-xs font-bold whitespace-nowrap" style={{ color: c, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                              </div>
                            ))}
                            <div className="flex items-center justify-between pt-1.5 mt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.10)' }}>
                              <span className="text-xs font-bold" style={{ color: '#F4F4F2' }}>Tu utilidad</span>
                              <span className="text-base font-bold" style={{ color: acctCalc.utilityCop >= 0 ? '#4ADE80' : '#F87171', fontVariantNumeric: 'tabular-nums' }}>
                                {acctCalc.utilityCop.toLocaleString('es-CO')} COP
                              </span>
                            </div>
                            {acctCalc.utilityCop < 0 && (
                              <p className="text-[10px] m-0 pt-1" style={{ color: '#F87171' }}>Estás pagando más de lo que recibiste: revisa las tasas antes de aplicar.</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-[11px] mt-2 mb-0" style={{ color: 'rgba(244,244,242,0.45)' }}>Completa los cuatro datos para ver el cálculo.</p>
                        )}
                      </>) : (
                        <p className="text-[11px] m-0" style={{ color: '#878E88' }}>Desactivado: se acredita el monto que escribas abajo y el cargue queda sin contabilidad.</p>
                      )}
                    </div>
                  )}
                <div className="relative">
                  <span style={{ position: 'absolute', left: 15, top: 13, fontSize: 22, fontWeight: 800, color: '#878E88' }}>$</span>
                  <input
                    id="cargue-monto"
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    readOnly={usandoAcct}
                    value={usandoAcct
                      ? (acctCalc.listo ? acctCalc.copToClient.toLocaleString('es-CO') : '')
                      : (carguesAmount ? Number(carguesAmount).toLocaleString('es-CO') : '')}
                    onChange={(e) => setCarguesAmount(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && carguesClient && !carguesBusy && carguesAmount) requestCargue(); }}
                    style={{ ...CAMPO, padding: '12px 60px 12px 34px', fontSize: 24, fontWeight: 800, letterSpacing: '-0.6px', ...(usandoAcct ? { opacity: 0.75, cursor: 'not-allowed' } : {}) }}
                  />
                  <span style={{ position: 'absolute', right: 15, top: 18, fontSize: 12, fontWeight: 700, color: '#878E88' }}>{usandoAcct ? 'COP · calculado' : 'COP'}</span>
                </div>
                <input type="text" placeholder="Nota (opcional) · Ref. Mouv, motivo del ajuste…" value={carguesNote}
                  onChange={(e) => setCarguesNote(e.target.value)} style={{ ...CAMPO, marginTop: 8, fontSize: 13 }} />
                {/* "Solo registrar movimiento histórico" se quitó de la pantalla: el
                    servidor lo sigue aceptando (recordOnly), pero ya no se ofrece. */}
              </div>

                  {carguesDir === 'debit' && !carguesRecordOnly && (() => {
                    // Los cargues de este cliente en este saldo, con lo que les
                    // queda por revertir. Un descuento que corrige un cargue se
                    // vincula a él; uno que no (otro motivo) se deja en "No".
                    const opciones = (histCargues.movimientos as any[])
                      .filter(t => t.type === 'load' && t.status === 'Completado' && (t.source === 'admin_cargue' || t.source === 'admin_backfill') && t.currency === carguesRail)
                      .map(t => { const credit = Number(t.acct?.creditedCop ?? t.amount) || 0; return { id: String(t.id), at: t.createdAt ?? t.created_at, credit, resta: Math.max(0, credit - (Number(t.reverso?.montoCop ?? 0) || 0)) }; })
                      .filter(o => o.resta > 0)
                      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
                      .slice(0, 25);
                    return (
                      <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#121413', border: '1px solid rgba(248,113,113,0.22)' }}>
                        <label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: '#878E88' }}>¿Este descuento corrige un cargue?</label>
                        <select value={carguesReversaDe} onChange={e => setCarguesReversaDe(e.target.value)}
                          className="w-full px-2.5 py-2 rounded-lg text-sm outline-none"
                          style={{ backgroundColor: '#0C0E0D', color: '#F4F4F2', border: '1px solid rgba(255,255,255,0.12)' }}>
                          <option value="">Automático: si cuadra exacto con un cargue, se vincula</option>
                          <option value="no">No, es otro ajuste</option>
                          {opciones.map(o => (
                            <option key={o.id} value={o.id}>
                              Cargue del {new Date(o.at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })} · {formatMoney(o.credit, '')} COP{o.resta < o.credit ? ` (quedan ${formatMoney(o.resta, '')})` : ''}
                            </option>
                          ))}
                        </select>
                        {(() => {
                          // Qué va a pasar en automático con el monto escrito.
                          const m = Number(String(carguesAmount).replace(/[^\d.]/g, '')) || 0;
                          const exacto = !carguesReversaDe && m > 0 ? opciones.find(o => Math.abs(o.resta - m) <= 1) : null;
                          return exacto
                            ? <p className="text-[11px] mt-1.5 font-bold" style={{ color: '#4ADE80' }}>Se va a vincular al cargue del {new Date(exacto.at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })} por {formatMoney(exacto.credit, '')} COP: ese cargue queda anulado.</p>
                            : null;
                        })()}
                        <p className="text-[10px] mt-1.5" style={{ color: '#878E88' }}>
                          Si descuentas todo lo acreditado, el cargue queda anulado: no suma, no deja utilidad y no se factura. Si es una parte (se le acreditó de más), el cargue queda con lo acreditado correcto y la utilidad se recalcula.
                        </p>
                      </div>
                    );
                  })()}

                  {carguesMsg && (
                    <div className={`text-xs font-medium rounded-lg p-3 mb-3 ${carguesMsg.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                      {carguesMsg.text}
                    </div>
                  )}

              {/* Resumen en vivo + botón. El 2FA NO se pide acá: se pide en la
                  ventana de confirmación, DESPUÉS de ver el desglose — un código
                  que se escribe antes de revisar la cifra autoriza a ciegas. */}
              <div className="flex items-center justify-between flex-wrap" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 16, gap: 14 }}>
                <div style={{ fontSize: 12.5, color: '#878E88', lineHeight: 1.6 }}>
                  {!carguesClient ? 'Elige un cliente para empezar.'
                    : montoVista <= 0 ? <>{usandoAcct ? 'Completa los datos de la operación' : 'Escribe el monto'} para <b style={{ color: '#F4F4F2' }}>{carguesClient.name}</b>.</>
                    : <>
                        <span style={{ color: '#F4F4F2' }}>{carguesDir === 'credit' ? 'Se acreditan' : 'Se descuentan'} <b>{Math.round(carguesDir === 'credit' ? netoVista : montoVista).toLocaleString('es-CO')} COP</b> a {carguesClient.name} en <b>{railMeta[carguesRail].label}</b></span><br />
                        {excedeVista
                          ? <span style={{ color: '#F87171', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}><AlertTriangle size={13} /> Excede lo disponible en {railMeta[carguesRail].label} ({Math.round(freeForRail).toLocaleString('es-CO')} COP)</span>
                          : carguesRecordOnly ? 'Solo histórico: el saldo no cambia.'
                          : carguesDir === 'credit' && freeForRail !== Infinity && poolReady ? <>Quedan {Math.round(freeForRail - netoVista).toLocaleString('es-CO')} disponibles en {railMeta[carguesRail].label}</>
                          : null}
                      </>}
                </div>
                <button
                  onClick={requestCargue}
                  disabled={!carguesClient || carguesBusy || (usandoAcct ? !acctCalc.listo : !carguesAmount)}
                  style={{ border: 'none', borderRadius: 12, padding: '12px 22px', fontSize: 14, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
                    ...((!carguesClient || carguesBusy || (usandoAcct ? !acctCalc.listo : !carguesAmount)) ? { background: 'rgba(255,255,255,0.08)', color: 'rgba(244,244,242,0.45)', cursor: 'not-allowed' } : { background: '#4ADE80', color: '#0C0E0D' }) }}
                >
                  {carguesBusy ? <><RefreshCw size={15} className="animate-spin" /> Aplicando…</> : <>Revisar y {carguesDir === 'credit' ? 'acreditar' : 'descontar'}</>}
                </button>
              </div>
            </div>

            {/* ── Columna derecha: últimos cargues del cliente elegido ── */}
            <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16, padding: 18 }}>
              <p style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 800, color: '#F4F4F2' }}>
                Últimos cargues {carguesClient && <span style={{ color: '#878E88', fontWeight: 600, fontSize: 12 }}>· {carguesClient.name}</span>}
              </p>
              {!carguesClient ? (
                <p style={{ margin: 0, fontSize: 12.5, color: '#878E88' }}>Elige un cliente para ver sus cargues manuales.</p>
              ) : histCargues.cargando && ultimosCargues.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12.5, color: '#878E88' }}>Trayendo el historial…</p>
              ) : ultimosCargues.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12.5, color: '#878E88' }}>Todavía no se le ha hecho ningún cargue manual.</p>
              ) : (
                <>
                  {ultimosCargues.map((t: any, i: number) => {
                    const esCredito = (t.direction ?? (t.type === 'load' ? 'credit' : 'debit')) === 'credit';
                    const f = fechaCargue(t);
                    return (
                      <div key={t.id} className="flex items-center justify-between" style={{ gap: 10, padding: '10px 0', borderTop: i ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}>{railLabelOf(t.rail ?? t.currency ?? 'COP')}</p>
                          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#878E88', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {f ? new Date(f).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '—'} · <span style={{ color: (t.por as any)?.esYo ? '#4ADE80' : '#878E88' }}>por {quienTx(t)}</span>{t.note ? ` · ${t.note}` : ''}
                          </p>
                        </div>
                        <span style={{ fontSize: 13.5, fontWeight: 800, color: esCredito ? '#4ADE80' : '#F87171', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                          {esCredito ? '+' : '−'}{Math.round(Number(t.amount) || 0).toLocaleString('es-CO')}
                        </span>
                      </div>
                    );
                  })}
                  <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'rgba(244,244,242,0.45)' }}>El detalle completo, con contabilidad y Revertir, está abajo.</p>
                </>
              )}
            </div>
          </div>

          {/* ── Cargues hechos a este cliente ──
              Antes no había dónde mirarlos: para saber si un cargue se
              aplicó bien había que ir a Movimientos y buscar. Acá está la
              lista de lo que se le acreditó y descontó a mano, con el
              desglose contable que se guardó, y un botón para revertir que
              deja el descuento listo —igual pide revisar y 2FA—. */}
          {carguesClient && (() => {
            const fechaDe = (t: any): Date | null => {
              const v = t?.creditedAt ?? t?.createdAt ?? t?.created_at ?? t?.date;
              const s = String(v ?? '').trim(); if (!s) return null;
              const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
              const d = dmy ? new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])) : new Date(s);
              return isNaN(d.getTime()) ? null : d;
            };
            const cargues = (histCargues.movimientos as any[])
              .filter(t => t.userId === carguesClient.id && (t.source === 'admin_cargue' || t.source === 'admin_backfill' || t.type === 'adjustment' || (t.type === 'load' && t.rail)))
              .map(t => ({ t, d: fechaDe(t) }))
              .sort((a, b) => (b.d?.getTime() ?? 0) - (a.d?.getTime() ?? 0));
            const fmt = (v: any) => Math.round(Number(v) || 0).toLocaleString('es-CO');
            // Qué débito revierte qué cargue (lo vincula Contabilidad). El
            // cargue anulado y su reversa se muestran como tales: antes el
            // débito salía como un "DESCONTADO" más, como si fuera un descuento
            // adicional al cargue que justamente estaba anulando.
            const rev = reversosDe(histCargues.movimientos as any[]);
            const fechaCorta = (id: string) => { const x = cargues.find(c => String(c.t.id) === id); return x?.d ? x.d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : null; };
            const revertir = (t: any) => {
              const esCredito = (t.direction ?? (t.type === 'load' ? 'credit' : 'debit')) === 'credit';
              const monto = Math.round(Number(t.grossCop ?? t.amount) || 0);
              setCarguesRail((t.rail ?? t.currency ?? 'COP') as any);
              setCarguesDir(esCredito ? 'debit' : 'credit');
              setCarguesRecordOnly(false);
              setAcctOn(false);
              setCarguesAmount(String(monto));
              setCarguesNote(`Reversa del ${esCredito ? 'cargue' : 'descuento'} del ${fechaDe(t)?.toLocaleDateString('es-CO') ?? '—'} · ${fmt(t.amount)} COP${t.note ? ` · ${String(t.note).slice(0, 60)}` : ''}`);
              setCarguesMsg({ ok: true, text: `Reversa preparada: ${esCredito ? 'descontar' : 'acreditar'} ${fmt(monto)} COP en ${railLabelOf(t.rail ?? t.currency ?? 'COP')}. Revisá y autorizá arriba.` });
              window.scrollTo({ top: 0, behavior: 'smooth' });
            };
            return (
              <div className="mt-6 rounded-xl" style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)' }}>
                <div className="flex items-center justify-between flex-wrap gap-2" style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#F4F4F2', margin: 0 }}>Cargues a {carguesClient.name}</p>
                    <p style={{ fontSize: 12, color: '#878E88', margin: '2px 0 0' }}>
                      {cargues.length} {cargues.length === 1 ? 'movimiento manual' : 'movimientos manuales'} · lo más reciente primero
                      {histCargues.cargando ? ' · trayendo el historial completo…' : histCargues.completo ? ' · historial completo' : ''}
                    </p>
                    {histCargues.completo && (
                      <p style={{ fontSize: 11.5, color: 'rgba(244,244,242,0.45)', margin: '2px 0 0' }}>
                        El cliente tiene {histCargues.movimientos.length} movimientos en total{histCargues.ids.length > 1 ? ` (en ${histCargues.ids.length} cuentas con su mismo correo)` : ''}. Aquí van solo los cargues y ajustes manuales; todos sus movimientos están en Clientes → {carguesClient.name} → Movimientos.
                      </p>
                    )}
                    {histCargues.error && <p style={{ fontSize: 11.5, color: '#F87171', margin: '2px 0 0' }}>No se pudo traer el historial completo: {histCargues.error}. Se muestran solo los movimientos recientes.</p>}
                  </div>
                  <button onClick={() => descargarMovimientosCliente(String(carguesClient.name ?? 'cliente'), histCargues.movimientos as any[])}
                    disabled={histCargues.cargando || histCargues.movimientos.length === 0}
                    title={histCargues.cargando ? 'Esperá a que termine de traer el historial completo' : 'Excel con todos los movimientos del cliente, sus cargues manuales y un resumen'}
                    className="lincoin-btn-white"
                    style={{ fontWeight: 700, fontSize: 12.5, padding: '9px 16px', borderRadius: 9, border: 'none', cursor: histCargues.cargando ? 'wait' : 'pointer', opacity: histCargues.cargando || histCargues.movimientos.length === 0 ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                    {histCargues.cargando ? 'Cargando historial…' : 'Descargar Excel'}
                  </button>
                </div>
                {cargues.length === 0 ? (
                  <p style={{ fontSize: 12.5, color: '#878E88', padding: '16px 18px', margin: 0 }}>Todavía no se le ha hecho ningún cargue manual.</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
                      <thead><tr>{['FECHA', 'RIEL', 'MOVIMIENTO', 'NETO', 'CONTABILIDAD', 'HECHO POR', 'NOTA', ''].map((h, i) => (
                        <th key={h || 'acc'} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: 'rgba(244,244,242,0.45)', textAlign: i === 3 ? 'right' : 'left', padding: '9px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}</tr></thead>
                      <tbody>
                        {cargues.slice(0, carguesVer).map(({ t, d }) => {
                          const esCredito = (t.direction ?? (t.type === 'load' ? 'credit' : 'debit')) === 'credit';
                          const backfill = t.source === 'admin_backfill' || t.recordOnly === true;
                          const a = t.acct;
                          const r = esCredito ? rev.cargueRevertido.get(String(t.id)) : undefined;
                          const cargueRevertido = !esCredito ? rev.reversaDe.get(String(t.id)) : undefined;
                          const fRev = cargueRevertido ? fechaCorta(cargueRevertido) : null;
                          const etiqueta = backfill ? 'SOLO REGISTRO' : r ? (r.anulado ? 'ANULADO' : 'CORREGIDO') : cargueRevertido ? 'REVERSA' : esCredito ? 'ACREDITADO' : 'DESCONTADO';
                          const colorEt = backfill || (r && !r.anulado) ? '#FBBF24' : r?.anulado || cargueRevertido ? '#878E88' : esCredito ? '#4ADE80' : '#F87171';
                          return (
                            <tr key={t.id}>
                              <td style={{ padding: '10px 18px', fontSize: 12, color: '#b9beba', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{d ? d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                              <td style={{ padding: '10px 18px', fontSize: 12.5, color: '#F4F4F2', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{railLabelOf(t.rail ?? t.currency ?? 'COP')}</td>
                              <td style={{ padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.5px', padding: '3px 8px', borderRadius: 999, border: `1px solid ${colorEt}59`, color: colorEt }}>
                                  {etiqueta}
                                </span>
                                {r && <p style={{ fontSize: 10.5, color: '#878E88', margin: '3px 0 0' }}>{r.anulado ? 'Revertido completo: no suma' : `Se revirtieron ${fmt(r.montoCop)} COP`}</p>}
                                {cargueRevertido && <p style={{ fontSize: 10.5, color: '#878E88', margin: '3px 0 0' }}>Reversa del cargue{fRev ? ` del ${fRev}` : ''}: no es un descuento adicional</p>}
                              </td>
                              <td style={{ padding: '10px 18px', fontSize: 13, fontWeight: 700, textAlign: 'right', color: r?.anulado || cargueRevertido ? '#878E88' : esCredito ? '#4ADE80' : '#F87171', textDecoration: r?.anulado ? 'line-through' : undefined, borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                                {esCredito ? '+' : '−'}{fmt(t.amount)} COP
                                {t.feeCop > 0 && <p style={{ fontSize: 10.5, color: '#878E88', margin: '2px 0 0', fontWeight: 500 }}>bruto {fmt(t.grossCop)} − fee {fmt(t.feeCop)}</p>}
                              </td>
                              <td style={{ padding: '10px 18px', fontSize: 11.5, color: '#b9beba', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                                {a ? (
                                  <>
                                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(a.usdtGross).toLocaleString('es-CO')} USDT · venta {Number(a.sellRate).toLocaleString('es-CO')} · cliente {Number(a.clientRate).toLocaleString('es-CO')}</span>
                                    <p style={{ margin: '2px 0 0', fontWeight: 700, color: Number(a.utilityCop) >= 0 ? '#4ADE80' : '#F87171' }}>utilidad {fmt(a.utilityCop)} COP</p>
                                  </>
                                ) : <span style={{ color: 'rgba(244,244,242,0.45)' }}>sin contabilidad</span>}
                              </td>
                              <td style={{ padding: '10px 18px', fontSize: 12, fontWeight: 700, color: (t.por as any)?.esYo ? '#4ADE80' : '#F4F4F2', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                                {(() => { const q = quienTx(t); return q === 'ti' ? 'Tú' : q === 'el equipo' ? 'Equipo' : q; })()}
                              </td>
                              <td style={{ padding: '10px 18px', fontSize: 11.5, color: '#878E88', borderBottom: '1px solid rgba(255,255,255,0.06)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.note ?? ''}>{t.note ?? '—'}</td>
                              <td style={{ padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                {/* Un cargue ya anulado, o un débito que ya es la reversa de
                                    un cargue, no se vuelve a "revertir" desde acá: sería un
                                    segundo descuento (o un re-cargue) por la misma operación. */}
                                {!backfill && !r?.anulado && !cargueRevertido && (
                                  <button onClick={() => revertir(t)} title="Prepara el movimiento contrario por el mismo monto. Igual pide revisar y 2FA."
                                    style={{ fontSize: 11.5, fontWeight: 700, color: '#878E88', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '5px 10px', cursor: 'pointer' }}
                                    className="hover:text-[#F4F4F2] hover:border-[rgba(255,255,255,0.25)] transition-colors">Revertir</button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {cargues.length > carguesVer && (
                      <div style={{ padding: '12px 18px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: '#878E88' }}>Mostrando {carguesVer} de {cargues.length}</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => setCarguesVer(v => v + 60)} style={{ fontSize: 12, fontWeight: 700, color: '#F4F4F2', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 7, padding: '6px 12px', cursor: 'pointer' }}>Ver 60 más</button>
                          <button onClick={() => setCarguesVer(cargues.length)} style={{ fontSize: 12, fontWeight: 700, color: '#878E88', background: 'transparent', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 7, padding: '6px 12px', cursor: 'pointer' }}>Ver todos</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Resolver conversión trabada: el USDT llegó al proveedor pero el
              COP no se acreditó (p. ej. llegó 4.990,50 y el sistema esperaba
              4.992). Acredita el COP adeudado y cierra el movimiento. */}
          <details style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16 }}>
            <summary style={{ padding: '14px 18px', cursor: 'pointer', color: '#F4F4F2', fontSize: 13.5, fontWeight: 700, listStyle: 'none' }}>
              🛟 Resolver conversión trabada (acreditar COP y cerrar)
            </summary>
            <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 12, color: '#878E88', lineHeight: 1.5 }}>
                Úsalo cuando el USDT ya llegó al proveedor pero el COP no se acreditó (el cliente quedó debitado sin su COP). Pega el <b style={{ color: '#F4F4F2' }}>ID del movimiento de Lincoin</b> — el que ve el cliente en sus Movimientos (ej. <span style={{ fontFamily: 'monospace' }}>TX-B385BF</span>). <b style={{ color: '#F5B44A' }}>NO</b> es el ID de Finity. O elige un cliente abajo y dale <b style={{ color: '#F4F4F2' }}>“Ver conversiones trabadas”</b>.
              </p>
              {carguesClient && (
                <button onClick={() => listStuck(carguesClient.id)} disabled={stuckBusy}
                  style={{ alignSelf: 'flex-start', background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ADE80', borderRadius: 9, padding: '7px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  🔎 Ver conversiones trabadas de {carguesClient.name?.split(' ')[0] ?? 'este cliente'}
                </button>
              )}
              {Array.isArray(stuckList) && stuckList.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {stuckList.map((s: any) => (
                    <button key={s.txId} onClick={() => { setStuckPreview(s); setStuckRail((s.currency && ['COP','COP_ACH','COP_BREB'].includes(s.currency)) ? s.currency : 'COP'); setStuckList(null); }}
                      className="flex items-center justify-between" style={{ textAlign: 'left', background: '#0A0C0B', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 13px', cursor: 'pointer' }}>
                      <span style={{ fontSize: 12, color: '#878E88', fontFamily: 'monospace' }}>{String(s.txId).slice(0, 8)}… · {s.status}</span>
                      <span style={{ fontSize: 13, color: '#4ADE80', fontWeight: 800 }}>+ {Number(s.owedCop).toLocaleString('es-CO')} COP</span>
                    </button>
                  ))}
                </div>
              )}
              {Array.isArray(stuckList) && stuckList.length === 0 && (
                <p style={{ fontSize: 12, color: '#878E88' }}>Este cliente no tiene conversiones trabadas.</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input value={stuckRef} onChange={e => setStuckRef(e.target.value)} placeholder="ID de Lincoin (ej. TX-B385BF)"
                  style={{ flex: 1, minWidth: 200, background: '#0A0C0B', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 12px', color: '#F4F4F2', fontSize: 13 }} />
                <button onClick={previewStuck} disabled={stuckBusy || !stuckRef.trim()}
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', color: '#F4F4F2', borderRadius: 10, padding: '10px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  {stuckBusy ? 'Buscando…' : 'Buscar'}
                </button>
              </div>
              {stuckPreview && (
                <div style={{ background: '#0A0C0B', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="flex justify-between" style={{ fontSize: 12.5 }}><span style={{ color: '#878E88' }}>Cliente</span><span style={{ color: '#F4F4F2', fontWeight: 700 }}>{stuckPreview.name ?? stuckPreview.email ?? stuckPreview.userId}</span></div>
                  <div className="flex justify-between" style={{ fontSize: 12.5 }}><span style={{ color: '#878E88' }}>Estado actual</span><span style={{ color: stuckPreview.status === 'Completado' ? '#4ADE80' : '#F5B44A', fontWeight: 700 }}>{stuckPreview.status}</span></div>
                  <div className="flex justify-between" style={{ fontSize: 12.5 }}><span style={{ color: '#878E88' }}>COP a acreditar</span><span style={{ color: '#4ADE80', fontWeight: 800 }}>+ {Number(stuckPreview.owedCop).toLocaleString('es-CO')} COP</span></div>
                  <div className="flex items-center justify-between" style={{ fontSize: 12.5, marginTop: 4 }}>
                    <span style={{ color: '#878E88' }}>Acreditar en</span>
                    <select value={stuckRail} onChange={e => setStuckRail(e.target.value as any)}
                      style={{ background: '#121413', border: '1px solid rgba(255,255,255,0.14)', color: '#F4F4F2', borderRadius: 8, padding: '6px 10px', fontSize: 12.5 }}>
                      <option value="COP">Saldo Lincoin (COP)</option>
                      <option value="COP_ACH">ACH</option>
                      <option value="COP_BREB">Bre-B</option>
                    </select>
                  </div>
                  {stuckPreview.status === 'Completado' ? (
                    <p style={{ fontSize: 12, color: '#4ADE80', fontWeight: 600 }}>Este movimiento ya está Completado — no se vuelve a acreditar.</p>
                  ) : (
                    <button onClick={settleStuck} disabled={stuckBusy}
                      style={{ marginTop: 4, background: '#4ADE80', color: '#0A0C0B', border: 'none', borderRadius: 10, padding: '11px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer' }}>
                      {stuckBusy ? 'Acreditando…' : 'Acreditar y cerrar'}
                    </button>
                  )}
                </div>
              )}
              {stuckMsg && (
                <p style={{ fontSize: 12.5, fontWeight: 600, color: stuckMsg.ok ? '#4ADE80' : '#F87171' }}>{stuckMsg.text}</p>
              )}
            </div>
          </details>
          </>}

          {/* Ventana de confirmación del cargue (tema Lincoin).
              En el celular se salía de la pantalla: era una sola columna sin
              tope de alto y los botones quedaban abajo, fuera de la vista. Ahora
              tiene tope (el alto visible), el contenido se desplaza adentro y
              los botones quedan siempre a la vista, abajo. */}
          {carguesConfirm && carguesClient && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{ padding: 12, background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }} onClick={() => !carguesBusy && setCarguesConfirm(null)}>
              <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, maxHeight: 'calc(100dvh - 24px)', display: 'flex', flexDirection: 'column', background: '#121413', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, overflow: 'hidden', fontFamily: "'Archivo', system-ui, sans-serif", boxShadow: '0 24px 60px rgba(0,0,0,0.55)' }}>
                <div style={{ padding: '14px 16px 0', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', flexShrink: 0,
                    background: carguesDir === 'credit' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                    border: `1px solid ${carguesDir === 'credit' ? 'rgba(74,222,128,0.32)' : 'rgba(248,113,113,0.32)'}` }}>
                    <Wallet size={16} style={{ color: carguesDir === 'credit' ? '#4ADE80' : '#F87171' }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 800, color: '#F4F4F2', letterSpacing: '-0.3px', margin: 0 }}>
                      Confirmar {carguesDir === 'credit' ? 'cargue' : 'descuento'}
                    </h3>
                    <p style={{ fontSize: 12, color: '#878E88', margin: '1px 0 0', lineHeight: 1.4 }}>
                      {carguesDir === 'credit' ? 'Acreditar' : 'Descontar'} en <b style={{ color: '#F4F4F2' }}>{railLabelOf(carguesRail)}</b> · <b style={{ color: '#F4F4F2' }}>{carguesClient.name}</b>
                    </p>
                  </div>
                </div>
                <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '12px 16px 4px', WebkitOverflowScrolling: 'touch' as any }}>
                {(() => {
                  // Bre-B: al cliente se le cobra 0,10% POR RECIBIR el cargue —
                  // el neto es lo que de verdad entra a su billetera Bre-B.
                  const isBrebCredit = carguesRail === 'COP_BREB' && carguesDir === 'credit' && !carguesRecordOnly;
                  const fee = isBrebCredit ? Math.round(carguesConfirm.raw * 0.10 / 100) : 0;
                  const net = carguesConfirm.raw - fee;
                  const deltaNet = carguesDir === 'credit' ? net : -carguesConfirm.raw;
                  const fila = (l: React.ReactNode, v: React.ReactNode, vStyle: React.CSSProperties = {}) => (
                    <div className="flex items-center justify-between" style={{ gap: 12, padding: '3px 0' }}>
                      <span style={{ fontSize: 12, color: '#878E88' }}>{l}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#F4F4F2', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', ...vStyle }}>{v}</span>
                    </div>
                  );
                  const n = (x: number) => x.toLocaleString('es-CO');
                  return (
                <div style={{ padding: '12px 14px', background: '#0A0C0B', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}>
                  <div className="flex items-center justify-between" style={{ gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: '#878E88' }}>Monto{isBrebCredit ? ' del cargue' : ''}</span>
                    <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px', color: carguesDir === 'credit' ? '#4ADE80' : '#F87171', whiteSpace: 'nowrap' }}>
                      {carguesDir === 'credit' ? '+' : '−'} {n(carguesConfirm.raw)} <span style={{ fontSize: 11, color: '#878E88', fontWeight: 600 }}>COP</span>
                    </span>
                  </div>
                  {isBrebCredit && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 5 }}>
                      {fila('Comisión recepción Bre-B (0,10%)', `− ${n(fee)} COP`, { color: '#F87171' })}
                      {fila('Neto que se acredita', `${n(net)} COP`, { fontWeight: 800 })}
                    </div>
                  )}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 5, marginTop: 5 }}>
                    {fila(`Saldo ${railLabelOf(carguesRail)} actual`, `${n(Number((carguesClient.balances as any)?.[carguesRail] ?? 0))} COP`)}
                    {fila('Quedará en', `${n(Math.max(0, Number((carguesClient.balances as any)?.[carguesRail] ?? 0) + deltaNet))} COP`, { fontWeight: 800, color: '#4ADE80' })}
                  </div>
                  {/* ── El desglose de la operación ──
                      Todo lo que el servidor va a usar, a la vista antes de
                      autorizar. Lo que repite el mismo dato va en una fila. */}
                  {usandoAcct && acctCalc.listo && (
                    <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid rgba(255,255,255,0.10)' }}>
                      <p style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '1.2px', color: '#878E88', margin: '0 0 3px' }}>CÓMO SE CALCULÓ</p>
                      {acctCalc.usdtGross === acctCalc.usdtNet
                        ? fila('USDT recibidos', `${n(acctCalc.usdtGross)} USDT`)
                        : <>
                            {fila('USDT que envió el cliente', `${n(acctCalc.usdtGross)} USDT`)}
                            {fila('USDT que llegaron', `${n(acctCalc.usdtNet)} USDT`)}
                          </>}
                      {acctCalc.feeUsdt > 0 && fila('Fee de red', `${n(acctCalc.feeUsdt)} USDT · ${acctFeeBearer === 'lincoin' ? 'Lincoin' : 'cliente'}`)}
                      {acctCalc.sellRate === acctCalc.clientRate
                        ? fila('Tasa (venta y cliente)', `${n(acctCalc.sellRate)} COP/USDT`)
                        : <>
                            {fila('Tasa de venta', `${n(acctCalc.sellRate)} COP/USDT`)}
                            {fila('Tasa al cliente', `${n(acctCalc.clientRate)} COP/USDT`)}
                          </>}
                      {acctCalc.revenueCop === acctCalc.copToClient
                        ? fila('Venta y al cliente', `${n(acctCalc.revenueCop)} COP`)
                        : <>
                            {fila('Entró por la venta', `${n(acctCalc.revenueCop)} COP`)}
                            {fila('Al cliente, antes de comisión', `${n(acctCalc.copToClient)} COP`)}
                          </>}
                      <div className="flex items-center justify-between" style={{ gap: 12, paddingTop: 6, marginTop: 3, borderTop: '1px solid rgba(255,255,255,0.10)' }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#F4F4F2' }}>Tu utilidad</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: acctCalc.utilityCop >= 0 ? '#4ADE80' : '#F87171', fontVariantNumeric: 'tabular-nums' }}>{n(acctCalc.utilityCop)} COP</span>
                      </div>
                      {acctCalc.utilityCop < 0 && <p style={{ fontSize: 11, color: '#F87171', margin: '4px 0 0' }}>Estás pagando más de lo que recibiste. Revisá las tasas antes de autorizar.</p>}
                    </div>
                  )}
                  {!usandoAcct && !carguesRecordOnly && carguesDir === 'credit' && (
                    <p style={{ fontSize: 11, color: 'rgba(244,244,242,0.45)', marginTop: 8, lineHeight: 1.45 }}>
                      Sin contabilidad: este cargue no registra USDT ni tasas, así que no tendrá utilidad calculada.
                    </p>
                  )}
                  {carguesRecordOnly && (
                    <p style={{ fontSize: 11.5, color: '#FBBF24', marginTop: 8, lineHeight: 1.45, fontWeight: 600 }}>
                      Solo registro histórico: el saldo NO cambia y no se cobra comisión.
                    </p>
                  )}
                  {carguesNote.trim() && <p style={{ fontSize: 11.5, color: '#878E88', marginTop: 8, fontStyle: 'italic' }}>“{carguesNote.trim()}”</p>}
                </div>
                  );
                })()}
                {cargueExceeds && (
                  <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.38)', borderRadius: 12 }}>
                    <p style={{ fontSize: 12, color: '#F87171', fontWeight: 800, margin: 0 }}>⚠ Excede lo disponible en {carguesRail === 'COP_BREB' ? 'Mouv' : 'Finity'}</p>
                    <p style={{ fontSize: 11.5, color: 'rgba(248,113,113,0.9)', lineHeight: 1.45, margin: '4px 0 0' }}>
                      Libre para cargar: <b>{Math.round(freeForRail).toLocaleString('es-CO')} COP</b>. Con este cargue quedarías corto en <b>{cargueShortfall.toLocaleString('es-CO')} COP</b> frente a lo que ya les debes a los clientes — estarías acreditando saldo que la bolsa no respalda.
                    </p>
                    <label className="flex items-center gap-2" style={{ marginTop: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={carguesOverride} onChange={e => setCarguesOverride(e.target.checked)} />
                      <span style={{ fontSize: 12, color: '#F4F4F2', fontWeight: 600 }}>Entiendo el faltante — cargar de todos modos</span>
                    </label>
                  </div>
                )}
                {/* El 2FA, al final: después de leer el desglose y justo
                    antes del botón. Cada código sirve una sola vez. */}
                {!carguesRecordOnly && (
                  <div style={{ marginTop: 10, marginBottom: 6 }}>
                    <label className="block text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: '#878E88' }}>Tu código 2FA para autorizar</label>
                    <CodeInput value={cargueOtp} onChange={setCargueOtp} tone="dark" compacto aria="Tu código 2FA para autorizar el cargue" />
                    <p className="text-[10px] mt-1 mb-0" style={{ color: 'rgba(244,244,242,0.45)' }}>Se pide en cada cargue, no solo al entrar.</p>
                  </div>
                )}
                </div>
                {(() => {
                  const bloqueado = carguesBusy || (cargueExceeds && !carguesOverride) || (!carguesRecordOnly && cargueOtp.length !== 6);
                  return (
                <div style={{ display: 'flex', gap: 10, flexShrink: 0, padding: '10px 16px calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid rgba(255,255,255,0.08)', background: '#121413' }}>
                  <button onClick={() => { setCarguesConfirm(null); setCarguesOverride(false); }} disabled={carguesBusy}
                    style={{ flex: 1, padding: '11px', borderRadius: 11, fontSize: 14, fontWeight: 700, color: '#F4F4F2', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', cursor: carguesBusy ? 'default' : 'pointer' }}>
                    Cancelar
                  </button>
                  <button onClick={submitCargue} disabled={bloqueado}
                    title={!carguesRecordOnly && cargueOtp.length !== 6 ? 'Escribí tu código 2FA para autorizar' : undefined}
                    style={{ flex: 1.4, padding: '11px', borderRadius: 11, fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      color: '#0A0C0B', background: bloqueado ? 'rgba(74,222,128,0.4)' : '#4ADE80', border: 'none', cursor: bloqueado ? 'not-allowed' : 'pointer' }}>
                    {carguesBusy ? <><RefreshCw size={15} className="animate-spin" /> Aplicando…</> : <>Autorizar {carguesDir === 'credit' ? 'cargue' : 'descuento'}</>}
                  </button>
                </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      );
  };

  // ── Tesorería ──────────────────────────────────────────────────────
  // Panel del dinero en COP: liquidez, lo que pide acción, flujo del periodo,
  // utilidad, clientes con más movimiento y los movimientos. Las cifras salen
  // de tesoreria_resumen (toda la base, hora de Colombia), no de la muestra
  // que el panel tiene en memoria.
  //
  // Se quitó: "Registrar movimiento" y las cuentas de tesorería (no había
  // ninguna registrada), la aprobación de retiros (el tipo `send` ya no se
  // usa: las salidas son dispersiones), la pestaña cripto y los textos fijos.
  const renderTreasury = () => {
      const d = tesData;
      const fmtCop = (n: number) => Math.round(Number(n) || 0).toLocaleString('es-CO');
      const millones = (n: number) => {
        const a = Math.abs(Number(n) || 0), signo = n < 0 ? '−' : '';
        return signo + (a >= 1e9 ? `${(a / 1e9).toLocaleString('es-CO', { maximumFractionDigits: 2 })} mil M` : a >= 1e6 ? `${(a / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M` : fmtCop(a));
      };
      const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      const corta = (ymd: string) => { const [, m, dd] = ymd.split('-').map(Number); return `${dd} ${MESES[(m || 1) - 1].slice(0, 3)}`; };
      const sumarDias = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
      const hoy = hoyBog();
      const elegir = (r: { desde: string; hasta: string; etiqueta: string }) => { setTesRango(r); setTesMenu(false); };
      const PRESETS = [
        { l: 'Hoy', r: { desde: hoy, hasta: hoy, etiqueta: 'Hoy' } },
        { l: 'Ayer', r: { desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1), etiqueta: 'Ayer' } },
        { l: 'Últimos 7 días', r: { desde: sumarDias(hoy, -6), hasta: hoy, etiqueta: 'Últimos 7 días' } },
        { l: 'Este mes', r: { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy, etiqueta: 'Este mes' } },
        { l: 'Mes anterior', r: (() => { const ini = new Date(Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 2, 1)); const fin = new Date(Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 1, 0)); return { desde: ini.toISOString().slice(0, 10), hasta: fin.toISOString().slice(0, 10), etiqueta: 'Mes anterior' }; })() },
      ];
      const CARD: React.CSSProperties = { background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16, padding: 18 };
      const ROT: React.CSSProperties = { margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#878E88' };
      const FECHA: React.CSSProperties = { flex: 1, minWidth: 0, background: '#070808', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, color: '#F4F4F2', padding: '6px 8px', fontSize: 12, colorScheme: 'dark' as any };
      const BTN_IR: React.CSSProperties = { background: '#F4F4F2', color: '#0C0E0D', border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' };
      const CHIP = (activo: boolean): React.CSSProperties => ({ borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: activo ? '#F4F4F2' : 'transparent', color: activo ? '#0C0E0D' : '#F4F4F2', border: '1px solid rgba(255,255,255,0.14)' });

      // Liquidez: la misma cuenta que la Billetera (bolsa − comprometido).
      const obligOf = (code: string) => obligaciones && typeof obligaciones.valor?.[code] === 'number'
        ? obligaciones.valor[code] : allUsers.reduce((acc, u) => acc + Number((u.balances as any)?.[code] ?? 0), 0);
      const bolsas = [
        { n: 'Mouv', icon: Zap, pool: Number(mouvPool?.breb ?? mouvPool?.total ?? 0), oblig: obligOf('COP_BREB'), loading: mouvPool?.loading, error: mouvPool?.error, reload: loadMouvPool },
        { n: 'Finity', icon: Landmark, pool: Number(finityPool?.cop ?? 0), oblig: obligOf('COP_ACH'), loading: finityPool?.loading, error: finityPool?.error, reload: loadFinityPool },
      ];
      const comprometido = obligOf('COP_BREB') + obligOf('COP_ACH');
      const pendingRailMoves = (getAllTransactions() as any[]).filter(t => t.type === 'rail_move' && t.status === 'Pendiente');

      const pr = d?.porResolver;
      const f = d?.flujo;
      const neto = f ? f.entradas - f.salidas : 0;
      const barras: { ent: number; sal: number }[] = f?.barras ?? [];
      const maxB = Math.max(1, ...barras.flatMap(b => [b.ent, b.sal]));
      const etiquetaBarra = (i: number) => d?.granularidad === 'hora' ? `${i}:00` : d?.granularidad === 'semana' ? `semana del ${corta(sumarDias(d.desde, i * 7))}` : corta(sumarDias(d?.desde ?? hoy, i));
      const movs = d?.movimientos;
      const totalPaginas = movs ? Math.max(1, Math.ceil(movs.total / movs.porPagina)) : 1;
      const abrirCargue = (id: string) => {
        const tx = pendingDeposits.find(t => String(t.id) === String(id));
        if (tx) setSelectedTreasuryTx(tx);
        else showToast('Ese cargue ya no está pendiente. Actualiza el tablero.');
      };

      return (
      <div className="animate-in fade-in duration-300" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="flex items-end justify-between flex-wrap" style={{ gap: 12 }}>
              <div>
                  <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: '#F4F4F2' }}>Tesorería <span style={{ color: '#878E88', fontWeight: 600, fontSize: 15 }}>· COP</span></h2>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#878E88' }}>
                      {tesCargando ? 'Actualizando…' : d ? 'Cifras de toda la base, hora de Colombia' : ''}
                      {d?.parcial && <span style={{ color: '#FB923C' }}> · el periodo es muy grande: las cifras pueden estar incompletas</span>}
                  </p>
              </div>
              <div className="flex items-center" style={{ gap: 8 }}>
                  <button onClick={() => setTesVer(v => v + 1)} title="Actualizar" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#F4F4F2', borderRadius: 10, padding: '9px 11px', cursor: 'pointer' }}>
                      <RefreshCw size={14} className={tesCargando ? 'animate-spin' : ''} />
                  </button>
                  <button onClick={() => navTo('cargues')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#4ADE80', color: '#0C0E0D', border: 'none', borderRadius: 10, padding: '9px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                      Registrar cargue <ChevronRight size={15} />
                  </button>
              </div>
          </div>
          {tesError && <p style={{ margin: 0, fontSize: 12.5, color: '#F87171' }}>{tesError}</p>}

          {/* ── Cierre de caja: franja compacta; el detalle se abre a pedido ──
              bolsa = clientes + Lincoin (+ movimientos externos) ± diferencia.
              La diferencia de "ahora" usa la bolsa en vivo; la de cada noche
              queda guardada en caja_cierres (23:59). */}
          {(() => {
              const ps: any[] = caja?.proveedores ?? [];
              const vivo = (n: string) => bolsas.find(b => b.n === n);
              const filasCaja = ps.map(p => {
                  const b = vivo(p.proveedor);
                  const listo = b && !b.loading && !b.error;
                  const dif = p.lincoinEsperado != null && listo ? Math.round(b!.pool - b!.oblig - p.lincoinEsperado) : null;
                  const per = f?.porProveedor?.[p.proveedor] ?? { ent: 0, sal: 0, ajustes: 0, costo: 0, utilidad: 0 };
                  return { ...p, bolsaVivo: listo ? b!.pool : null, clientesVivo: b?.oblig ?? 0, dif, per };
              });
              const abiertas = filasCaja.filter(x => x.apertura);
              const lincoinHoy = abiertas.reduce((a, x) => a + Number(x.lincoinEsperado ?? 0), 0);
              const difTotal = abiertas.every(x => x.dif != null) && abiertas.length ? abiertas.reduce((a, x) => a + x.dif, 0) : null;
              const signo = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtCop(Math.abs(n))}`;
              const dato = (l: string, v: string, color?: string) => (
                  <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 11, color: '#878E88' }}>{l}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 800, letterSpacing: '-0.3px', color: color ?? '#F4F4F2', whiteSpace: 'nowrap' }}>{v}</p>
                  </div>
              );
              const franja = (
                  <div className="flex items-center flex-wrap" style={{ gap: 22 }}>
                      <div className="flex items-center" style={{ gap: 8, minWidth: 150 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#878E88' }}>Cierre de caja</span>
                          {abiertas.length === 0 && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#93C5FD', border: '1px solid rgba(96,165,250,0.35)', borderRadius: 999, padding: '2px 8px' }}>abre hoy 23:59</span>}
                      </div>
                      {abiertas.length > 0 ? <>
                          {dato('Lincoin hoy', fmtCop(lincoinHoy), '#4ADE80')}
                          {filasCaja.map(x => <React.Fragment key={x.proveedor}>{dato(`Utilidad ${x.proveedor} · ${tesRango.etiqueta.toLowerCase()}`, signo(Math.round(x.per.utilidad)), x.per.utilidad < 0 ? '#F87171' : undefined)}</React.Fragment>)}
                          {dato('Diferencia ahora', difTotal == null ? '—' : signo(difTotal), difTotal == null ? 'rgba(244,244,242,0.45)' : difTotal === 0 ? '#4ADE80' : '#FBBF24')}
                      </> : <span style={{ fontSize: 12.5, color: '#878E88' }}>La caja empieza hoy: a las 23:59 se toma la apertura de cada bolsa.</span>}
                      <button onClick={() => setCajaAbierta(v => !v)} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: '#F4F4F2', borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                          {cajaAbierta ? 'Ocultar detalle' : 'Ver detalle'} <ChevronDown size={14} style={{ transform: cajaAbierta ? 'rotate(180deg)' : 'none' }} />
                      </button>
                  </div>
              );
              const linea = (l: React.ReactNode, v: number | null, o: { signo?: string; color?: string; tenue?: boolean; fuerte?: boolean } = {}) => (
                  <div className="flex justify-between" style={{ gap: 10, padding: '5px 0', fontSize: 12.5, color: o.tenue ? 'rgba(244,244,242,0.45)' : '#878E88' }}>
                      <span>{l}</span>
                      <span style={{ fontWeight: o.fuerte ? 800 : 700, color: o.color ?? (o.tenue ? 'rgba(244,244,242,0.45)' : '#F4F4F2'), fontVariantNumeric: 'tabular-nums' }}>{v == null ? '—' : `${o.signo ?? ''}${fmtCop(Math.abs(v))}`}</span>
                  </div>
              );
              return (
                  <div style={{ ...CARD, padding: cajaAbierta ? 18 : '12px 16px' }}>
                      {franja}
                      {cajaAbierta && (
                          <div style={{ marginTop: 14 }}>
                              {abiertas.length < filasCaja.length && (
                                  <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.3)', borderRadius: 10, padding: '9px 12px', fontSize: 12, color: '#93C5FD', marginBottom: 12 }}>
                                      <span>La caja se abre sola hoy a las 23:59 con las bolsas de ese momento: lo que sobre después de los saldos de los clientes queda como de Lincoin.</span>
                                      {esDueno && <button disabled={cajaOcupada} onClick={() => cajaAccion({ action: 'caja_abrir' }, 'Caja abierta.')} style={{ background: '#F4F4F2', color: '#0C0E0D', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>Abrir caja ahora</button>}
                                  </div>
                              )}
                              <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 14 }}>
                                  {filasCaja.map(x => (
                                      <div key={x.proveedor} style={{ background: '#070808', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14 }}>
                                          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                                              <span className="flex items-center" style={{ gap: 7, fontWeight: 800, fontSize: 14, color: '#F4F4F2' }}>{x.proveedor === 'Mouv' ? <Zap size={14} style={{ color: '#4ADE80' }} /> : <Landmark size={14} style={{ color: '#4ADE80' }} />} {x.proveedor}</span>
                                              {x.dif == null ? null : x.dif === 0
                                                ? <span className="inline-flex items-center" style={{ gap: 4, fontSize: 11, fontWeight: 700, color: '#4ADE80' }}><CheckCircle size={12} /> Cuadra</span>
                                                : <span className="inline-flex items-center" style={{ gap: 4, fontSize: 11, fontWeight: 700, color: '#FBBF24' }}><AlertTriangle size={12} /> No cuadra</span>}
                                          </div>
                                          {x.apertura ? <>
                                              <p style={{ margin: '0 0 2px', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, color: 'rgba(244,244,242,0.45)' }}>APERTURA · {new Date(x.apertura.at).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).toUpperCase()}</p>
                                              {linea('Bolsa', x.apertura.bolsa)}
                                              {linea('− Saldos de los clientes', x.apertura.clientes, { signo: '−' })}
                                              {linea(<>= Lincoin<span style={{ color: '#4ADE80' }}>.</span> de apertura{x.apertura.editadoAt && x.apertura.nota ? <span style={{ color: 'rgba(244,244,242,0.45)' }}> · corregida</span> : null}</>, x.apertura.lincoin, { color: '#4ADE80', fuerte: true })}
                                              <p style={{ margin: '10px 0 2px', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, color: 'rgba(244,244,242,0.45)' }}>AHORA</p>
                                              {linea('Bolsa en el proveedor', x.bolsaVivo)}
                                              {linea('− Saldos de los clientes', x.clientesVivo, { signo: '−' })}
                                              {linea(<>− Lincoin esperado <span style={{ color: 'rgba(244,244,242,0.45)' }}>(apertura + {fmtCop(x.utilidadDesdeApertura)} de utilidad{x.retirosDesdeApertura ? ` − ${fmtCop(x.retirosDesdeApertura)} de retiros` : ''}{x.externosDesdeApertura ? ` ${x.externosDesdeApertura < 0 ? '−' : '+'} ${fmtCop(Math.abs(x.externosDesdeApertura))} externos` : ''})</span></>, x.lincoinEsperado, { signo: '−' })}
                                              <button onClick={() => navTo('lincoin')} style={{ background: 'none', border: 'none', padding: '2px 0', color: '#878E88', fontSize: 11.5, textDecoration: 'underline', cursor: 'pointer' }}>Retiros y movimientos externos: ver y registrar en Lincoin</button>
                                              <div className="flex justify-between" style={{ marginTop: 6, padding: '8px 10px', borderRadius: 9, fontSize: 12.5, fontWeight: 800,
                                                  background: x.dif === 0 ? 'rgba(74,222,128,0.08)' : 'rgba(251,191,36,0.10)', border: `1px solid ${x.dif === 0 ? 'rgba(74,222,128,0.25)' : 'rgba(251,191,36,0.35)'}`, color: x.dif === 0 ? '#4ADE80' : '#FBBF24' }}>
                                                  <span>Diferencia sin explicar</span><span>{x.dif == null ? '—' : signo(x.dif)}</span>
                                              </div>
                                              {x.ultimaFoto && <p style={{ margin: '5px 0 0', fontSize: 11, color: 'rgba(244,244,242,0.45)' }}>Último cierre ({x.ultimaFoto.fecha}): diferencia {x.ultimaFoto.diferencia == null ? '—' : signo(x.ultimaFoto.diferencia)}</p>}
                                          </> : <p style={{ margin: '4px 0 8px', fontSize: 12.5, color: '#878E88' }}>Sin apertura todavía.</p>}
                                          <p style={{ margin: '10px 0 2px', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, color: 'rgba(244,244,242,0.45)' }}>{tesRango.etiqueta.toUpperCase()}</p>
                                          {linea('+ Cargues', x.per.ent, { signo: '+' })}
                                          {x.per.costo > 0 && linea(<span style={{ color: 'rgba(244,244,242,0.45)' }}>&nbsp;&nbsp;costo Mouv 0,10 % (no es de Lincoin)</span>, x.per.costo, { signo: '−', tenue: true })}
                                          {linea('− Dispersiones', x.per.sal, { signo: '−' })}
                                          {linea('− Descuentos / reversas', x.per.ajustes, { signo: '−' })}
                                          {linea('Utilidad Lincoin', Math.round(x.per.utilidad), { signo: x.per.utilidad < 0 ? '−' : '+', color: x.per.utilidad < 0 ? '#F87171' : '#4ADE80' })}
                                          {esDueno && x.apertura && (
                                              <button onClick={() => setCajaEditar({ proveedor: x.proveedor, monto: String(Math.round(x.apertura.lincoin)), nota: x.apertura.nota ?? '' })}
                                                  style={{ marginTop: 8, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: '#F4F4F2', borderRadius: 8, padding: '6px 11px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Editar saldo de apertura</button>
                                          )}
                                      </div>
                                  ))}
                              </div>
                              <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'rgba(244,244,242,0.45)', lineHeight: 1.55 }}>
                                  La bolsa debería ser clientes + Lincoin. Lo que no cuadra queda "sin explicar" hasta que se registren los retiros de Lincoin o los movimientos hechos fuera de Lincoin.
                                  La utilidad no cuenta los cargues ocultos{caja?.ocultos ? ` (${caja.ocultos})` : ''} ni el 0,10 % de Bre-B, que es un costo de Mouv.
                              </p>
                          </div>
                      )}
                  </div>
              );
          })()}

          {/* 1 · Liquidez */}
          <div className="grid grid-cols-1 lg:grid-cols-3" style={{ gap: 12 }}>
              {bolsas.map(b => {
                  const libre = b.pool - b.oblig;
                  return (
                  <div key={b.n} style={{ ...CARD, padding: 16 }}>
                      <div className="flex items-center justify-between">
                          <span className="flex items-center" style={{ gap: 7, fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}><b.icon size={14} style={{ color: '#4ADE80' }} /> {b.n} <span style={{ color: '#878E88', fontWeight: 600, fontSize: 11 }}>· Bre-B y ACH</span></span>
                          <button onClick={b.reload} disabled={b.loading} title={`Actualizar ${b.n}`} style={{ background: 'none', border: 'none', color: '#878E88', cursor: 'pointer' }}><RefreshCw size={12} className={b.loading ? 'animate-spin' : ''} /></button>
                      </div>
                      {b.error ? <p style={{ margin: '8px 0 0', fontSize: 12, color: '#F87171', fontWeight: 600 }}>{b.error}</p>
                        : b.loading ? <p style={{ margin: '8px 0 0', fontSize: 13, color: '#878E88' }}>Cargando…</p>
                        : <>
                            <p style={{ margin: '8px 0 0', fontSize: 22, fontWeight: 800, letterSpacing: '-0.6px', color: libre < 0 ? '#F87171' : '#4ADE80' }}>{fmtCop(libre)} <span style={{ fontSize: 11, color: '#878E88', fontWeight: 600 }}>{libre < 0 ? 'faltante' : 'disponible'}</span></p>
                            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'rgba(244,244,242,0.45)' }}>Bolsa {fmtCop(b.pool)} − comprometido {fmtCop(b.oblig)}</p>
                          </>}
                  </div>
                  );
              })}
              <div style={{ ...CARD, padding: 16 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}>Comprometido con clientes</span>
                  <p style={{ margin: '8px 0 0', fontSize: 22, fontWeight: 800, letterSpacing: '-0.6px', color: '#F4F4F2' }}>{fmtCop(comprometido)} <span style={{ fontSize: 11, color: '#878E88', fontWeight: 600 }}>COP</span></p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: 'rgba(244,244,242,0.45)' }}>Lo que suman los saldos de los clientes en Mouv y Finity</p>
              </div>
          </div>

          {/* ── Solicitudes "Saldo Lincoin → ACH" (aprobación manual) ──
              El cliente ya quedó debitado; antes de aprobar, mueve el
              respaldo al proveedor y luego dale Aprobar (acredita su ACH). */}
          {pendingRailMoves.length > 0 && (
              <div className="bg-white rounded-xl border-2 border-amber-200 overflow-hidden">
                  <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-sm font-bold text-amber-800">🏛 Movimientos a ACH pendientes de aprobación · {pendingRailMoves.length}</p>
                      <p className="text-[11px] text-amber-700">Antes de aprobar: envía el respaldo al proveedor. Aprobar acredita el saldo ACH del cliente; Rechazar le reembolsa su Saldo Lincoin.</p>
                  </div>
                  {pendingRailMoves.map((t: any) => (
                      <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 flex-wrap">
                          <div>
                              <p className="font-bold text-slate-800 text-sm">{t.userName || t.raw_data?.userName || '—'}</p>
                              <p className="text-xs text-slate-400">{t.createdAt ? new Date(t.createdAt).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''} · Saldo Lincoin → ACH</p>
                          </div>
                          <p className="font-black text-slate-800 tabular-nums">${Math.round(Number(t.amount ?? 0)).toLocaleString('es-CO')} COP</p>
                          <div className="flex items-center gap-2">
                              <button onClick={() => railMoveAction(t.id, 'reject')} disabled={railMoveBusy === t.id}
                                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Rechazar</button>
                              <button onClick={() => railMoveAction(t.id, 'approve')} disabled={railMoveBusy === t.id}
                                  className="px-3 py-1.5 rounded-lg bg-[#16A34A] text-white text-xs font-bold hover:bg-[#0f766e] disabled:opacity-50">
                                  {railMoveBusy === t.id ? 'Aplicando…' : 'Aprobar → ACH'}
                              </button>
                          </div>
                      </div>
                  ))}
              </div>
          )}

          {/* 2 · Por resolver: solo lo que pide que alguien haga algo */}
          <div style={CARD}>
              <div className="flex items-center justify-between" style={{ marginBottom: 6 }}><p style={ROT}>Por resolver</p></div>
              {!pr ? <p style={{ margin: 0, fontSize: 12.5, color: '#878E88' }}>{tesCargando ? 'Cargando…' : '—'}</p> : (() => {
                  const filas: { k: string; icon: React.ElementType; tono: string; titulo: string; det: string; accion: string; onClick: () => void }[] = [];
                  if (pr.cargues.n > 0) filas.push({ k: 'c', icon: ArrowDownCircle, tono: '#FBBF24',
                      titulo: `${pr.cargues.n} ${pr.cargues.n === 1 ? 'cargue pendiente' : 'cargues pendientes'} de acreditar · ${fmtCop(pr.cargues.total)} COP`,
                      det: pr.cargues.primero ? `El más antiguo: ${pr.cargues.primero.cliente} · ${fmtCop(pr.cargues.primero.monto)} COP · ${pr.cargues.primero.proveedor} · ${new Date(pr.cargues.primero.at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}` : '',
                      accion: 'Revisar', onClick: () => pr.cargues.primero && abrirCargue(pr.cargues.primero.id) });
                  if (pr.procesando.n > 0) filas.push({ k: 'p', icon: Clock, tono: '#FBBF24', titulo: `${pr.procesando.n} ${pr.procesando.n === 1 ? 'dispersión' : 'dispersiones'} en "Procesando" hace más de 30 min`, det: `${fmtCop(pr.procesando.total)} COP`, accion: 'Ver en Fallos', onClick: () => navTo('fallos') });
                  if (pr.fallidasMes + pr.rechazadasMes > 0) filas.push({ k: 'f', icon: AlertTriangle, tono: '#F87171', titulo: `${pr.fallidasMes} fallidas · ${pr.rechazadasMes} rechazadas este mes`, det: 'Revisa que cada una haya vuelto al saldo del cliente', accion: 'Ver en Fallos', onClick: () => navTo('fallos') });
                  // Contabilidad sospechosa (tasa de venta absurda o utilidad muy
                  // negativa): solo el dueño, para revisarla u ocultarla.
                  if (esDueno) for (const sx of (caja?.sospechosas ?? []) as any[]) filas.push({ k: `s-${sx.id}`, icon: AlertTriangle, tono: '#F87171',
                      titulo: 'Cargue con contabilidad sospechosa',
                      det: `${sx.cliente} · ${new Date(sx.at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })} · ${sx.proveedor} · utilidad ${fmtCop(Number(sx.acct?.utilityCop) || 0)} (tasa de venta ${Number(sx.acct?.sellRate) || '—'})`,
                      accion: 'Revisar', onClick: () => { setCajaOcultar(sx); setCajaMotivo(''); } });
                  // Monitoreo del equipo: solo llega para el dueño.
                  if (esDueno && Array.isArray(pr.fueraDeHorario) && pr.fueraDeHorario.length) {
                      const quien = Array.from(new Set(pr.fueraDeHorario.map((x: any) => x.quien))).join(', ');
                      filas.push({ k: 'h', icon: Users, tono: '#60A5FA', titulo: `${pr.fueraDeHorario.length} ${pr.fueraDeHorario.length === 1 ? 'cargue' : 'cargues'} fuera de horario (20:00–06:00) en 7 días`, det: `${quien} · ${fmtCop(pr.fueraDeHorario.reduce((a: number, x: any) => a + x.monto, 0))} COP`, accion: 'Ver cargues',
                          onClick: () => { const id = pr.fueraDeHorario[0]?.quienId; if (id) setTesMiembro(String(id)); setTesFiltro('cargue'); setTesPagina(0); } });
                  }
                  return (<>
                      {filas.length === 0 && <p style={{ margin: '6px 0 0', fontSize: 12.5, color: '#878E88' }}>Nada pendiente.</p>}
                      {filas.map((r, i) => (
                          <div key={r.k} className="flex items-center justify-between" style={{ gap: 12, padding: '11px 0', borderTop: i ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                              <div className="flex items-center" style={{ gap: 11, minWidth: 0 }}>
                                  <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: `${r.tono}1F`, flexShrink: 0 }}><r.icon size={15} style={{ color: r.tono }} /></span>
                                  <div style={{ minWidth: 0 }}>
                                      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>{r.titulo}</p>
                                      {r.det && <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#878E88' }}>{r.det}</p>}
                                  </div>
                              </div>
                              <button onClick={r.onClick} style={{ flexShrink: 0, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: '#F4F4F2', borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{r.accion}</button>
                          </div>
                      ))}
                      <div className="flex items-center" style={{ gap: 8, padding: '11px 0 0', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 12, color: '#878E88' }}>
                          {pr.trasladosAch > 0
                            ? <><AlertTriangle size={14} style={{ color: '#FBBF24' }} /> {pr.trasladosAch} {pr.trasladosAch === 1 ? 'traslado' : 'traslados'} a ACH por aprobar (arriba)</>
                            : <><CheckCircle size={14} style={{ color: '#4ADE80' }} /> Sin traslados a ACH pendientes</>}
                      </div>
                  </>);
              })()}
          </div>

          {/* 3 · Flujo + 4 · Utilidad y clientes */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] items-start" style={{ gap: 16 }}>
              <div style={CARD}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 12, gap: 10 }}>
                      <p style={ROT}>Flujo</p>
                      <div style={{ position: 'relative' }}>
                          <button onClick={() => setTesMenu(v => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#070808', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '5px 11px', color: '#F4F4F2', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                              <Calendar size={13} style={{ color: '#878E88' }} /> {tesRango.etiqueta} <ChevronDown size={13} style={{ color: '#878E88', transform: tesMenu ? 'rotate(180deg)' : 'none' }} />
                          </button>
                          {tesMenu && (
                              <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 20, width: 280, background: '#121413', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12, padding: 8, boxShadow: '0 18px 40px rgba(0,0,0,0.5)' }}>
                                  {PRESETS.map(p => (
                                      <button key={p.l} onClick={() => elegir(p.r)} className="flex items-center justify-between" style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#F4F4F2', background: tesRango.etiqueta === p.l ? 'rgba(74,222,128,0.10)' : 'transparent' }}>
                                          {p.l} {tesRango.etiqueta === p.l && <CheckCircle size={13} style={{ color: '#4ADE80' }} />}
                                      </button>
                                  ))}
                                  <div className="flex items-center" style={{ gap: 6, padding: '8px 10px 0', borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 6 }}>
                                      <span style={{ fontSize: 11.5, color: '#878E88', width: 52 }}>Un día</span>
                                      <input type="date" max={hoy} value={tesDia} onChange={e => setTesDia(e.target.value)} style={FECHA} />
                                      <button style={BTN_IR} onClick={() => { const [, m, dd] = tesDia.split('-').map(Number); elegir({ desde: tesDia, hasta: tesDia, etiqueta: `${dd} de ${MESES[(m || 1) - 1]}` }); }}>Ver</button>
                                  </div>
                                  <div className="flex items-center" style={{ gap: 6, padding: '8px 10px 0', borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 6 }}>
                                      <span style={{ fontSize: 11.5, color: '#878E88', width: 52 }}>Un mes</span>
                                      <input type="month" max={hoy.slice(0, 7)} value={tesMes} onChange={e => setTesMes(e.target.value)} style={FECHA} />
                                      <button style={BTN_IR} onClick={() => {
                                          const [a, m] = tesMes.split('-').map(Number);
                                          const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
                                          const nombre = MESES[(m || 1) - 1];
                                          elegir({ desde: `${tesMes}-01`, hasta: fin > hoy ? hoy : fin, etiqueta: `${nombre[0].toUpperCase()}${nombre.slice(1)} ${a}` });
                                      }}>Ver</button>
                                  </div>
                                  <div style={{ padding: '8px 10px 2px', borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 8 }}>
                                      <span style={{ fontSize: 11.5, color: '#878E88' }}>Rango</span>
                                      <div className="flex items-center" style={{ gap: 6, marginTop: 5 }}>
                                          <input type="date" max={hoy} value={tesDesde} onChange={e => setTesDesde(e.target.value)} style={FECHA} />
                                          <span style={{ color: 'rgba(244,244,242,0.45)' }}>–</span>
                                          <input type="date" max={hoy} value={tesHasta} onChange={e => setTesHasta(e.target.value)} style={FECHA} />
                                          <button disabled={tesDesde > tesHasta} style={{ ...BTN_IR, opacity: tesDesde > tesHasta ? 0.4 : 1 }} onClick={() => elegir({ desde: tesDesde, hasta: tesHasta, etiqueta: `${corta(tesDesde)} – ${corta(tesHasta)}` })}>Ver</button>
                                      </div>
                                  </div>
                              </div>
                          )}
                      </div>
                  </div>
                  {!f ? <p style={{ margin: 0, fontSize: 12.5, color: '#878E88' }}>{tesCargando ? 'Cargando…' : '—'}</p> : <>
                      <div className="grid grid-cols-3" style={{ gap: 12 }}>
                          {[
                              { l: 'Entradas · cargues', v: f.entradas, n: f.nEnt, c: '#4ADE80', i: ArrowDownCircle, neto: false },
                              { l: 'Salidas · dispersiones', v: f.salidas, n: f.nSal, c: '#F87171', i: ArrowUpCircle, neto: false },
                              { l: 'Neto', v: neto, n: null, c: neto >= 0 ? '#4ADE80' : '#F87171', i: null, neto: true },
                          ].map(x => (
                              <div key={x.l}>
                                  <p className="flex items-center" style={{ margin: 0, fontSize: 11.5, color: '#878E88', gap: 5 }}>{x.i && <x.i size={12} style={{ color: x.c }} />}{x.l}</p>
                                  <p style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px', color: x.neto ? x.c : '#F4F4F2' }}>{x.neto && neto > 0 ? '+' : ''}{millones(x.v)}</p>
                                  {x.n != null && <p style={{ margin: '1px 0 0', fontSize: 11, color: 'rgba(244,244,242,0.45)' }}>{fmtCop(x.n)} operaciones</p>}
                              </div>
                          ))}
                      </div>
                      <div className="flex items-end" style={{ gap: barras.length > 14 ? 4 : 10, height: 110, marginTop: 18 }}>
                          {barras.map((b, i) => (
                              <div key={i} className="flex items-end" style={{ flex: 1, gap: 2, height: '100%' }} title={`${etiquetaBarra(i)} · entradas ${fmtCop(b.ent)} · salidas ${fmtCop(b.sal)}`}>
                                  <div style={{ flex: 1, height: `${(b.ent / maxB) * 100}%`, background: '#4ADE80', borderRadius: '3px 3px 0 0', opacity: 0.85 }} />
                                  <div style={{ flex: 1, height: `${(b.sal / maxB) * 100}%`, background: 'rgba(248,113,113,0.55)', borderRadius: '3px 3px 0 0' }} />
                              </div>
                          ))}
                      </div>
                      <div className="flex justify-between" style={{ fontSize: 10.5, color: 'rgba(244,244,242,0.45)', marginTop: 5 }}>
                          <span>{barras.length ? etiquetaBarra(0) : ''}</span><span>{barras.length ? etiquetaBarra(barras.length - 1) : ''}</span>
                      </div>
                      <div className="grid grid-cols-2" style={{ gap: 10, marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          {['Mouv', 'Finity'].map(n => (
                              <div key={n} style={{ fontSize: 12, color: '#878E88' }}>
                                  <b style={{ color: '#F4F4F2' }}>{n}</b> · entra {millones(f.porProveedor?.[n]?.ent ?? 0)} · sale {millones(f.porProveedor?.[n]?.sal ?? 0)}
                              </div>
                          ))}
                      </div>
                  </>}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={CARD}>
                      <p style={{ ...ROT, marginBottom: 12 }}>Utilidad del mes</p>
                      {!d ? <p style={{ margin: 0, fontSize: 12.5, color: '#878E88' }}>—</p> : <>
                          <p style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.8px', color: d.utilidadMes.total >= 0 ? '#4ADE80' : '#F87171' }}>{millones(d.utilidadMes.total)} <span style={{ fontSize: 12, color: '#878E88', fontWeight: 600 }}>COP</span></p>
                          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#878E88' }}>De la contabilidad de {d.utilidadMes.conContabilidad} cargues{d.utilidadMes.sinContabilidad ? ` · ${d.utilidadMes.sinContabilidad} sin contabilidad` : ''}</p>
                          <div className="flex" style={{ gap: 14, marginTop: 10, fontSize: 12, color: '#878E88' }}>
                              {['Mouv', 'Finity'].map(n => <span key={n}>{n} <b style={{ color: '#F4F4F2' }}>{millones(d.utilidadMes.porProveedor?.[n] ?? 0)}</b></span>)}
                          </div>
                      </>}
                  </div>
                  <div style={CARD}>
                      <p style={{ ...ROT, marginBottom: 12 }}>Clientes con más movimiento · mes</p>
                      {!d ? <p style={{ margin: 0, fontSize: 12.5, color: '#878E88' }}>—</p> : d.topClientes.length === 0 ? <p style={{ margin: 0, fontSize: 12.5, color: '#878E88' }}>Sin movimientos este mes.</p> : d.topClientes.map((t: any, i: number) => (
                          <div key={t.id} style={{ padding: '8px 0', borderTop: i ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                              <div className="flex justify-between" style={{ gap: 8, fontSize: 12.5 }}>
                                  <span style={{ fontWeight: 700, color: '#F4F4F2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.nombre}</span>
                                  <span style={{ fontWeight: 800, color: '#F4F4F2', whiteSpace: 'nowrap' }}>{millones(t.vol)}</span>
                              </div>
                              <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 4, marginTop: 5 }}>
                                  <div style={{ width: `${(t.vol / d.topClientes[0].vol) * 100}%`, height: '100%', background: '#4ADE80', borderRadius: 4, opacity: 0.8 }} />
                              </div>
                              <p style={{ margin: '3px 0 0', fontSize: 10.5, color: 'rgba(244,244,242,0.45)' }}>{t.ops} operaciones</p>
                          </div>
                      ))}
                  </div>
              </div>
          </div>

          {/* 5 · Movimientos (paginados en el servidor) */}
          <div style={{ ...CARD, padding: 0 }}>
              <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="flex flex-wrap" style={{ gap: 6 }}>
                      {([['todos', 'Todos'], ['cargue', 'Cargues'], ['dispersion', 'Dispersiones'], ['problemas', 'Con problemas']] as const).map(([k, l]) => (
                          <button key={k} onClick={() => { setTesFiltro(k); setTesPagina(0); }} style={CHIP(tesFiltro === k)}>{l}</button>
                      ))}
                  </div>
                  <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
                      {esDueno && (caja?.ocultos ?? 0) > 0 && (
                          <label className="flex items-center" style={{ gap: 6, fontSize: 12, color: '#878E88', cursor: 'pointer' }}>
                              <input type="checkbox" checked={tesVerOcultos} onChange={e => { setTesVerOcultos(e.target.checked); setTesPagina(0); }} style={{ accentColor: '#4ADE80' }} /> Ver ocultos ({caja.ocultos})
                          </label>
                      )}
                      {/* Quién lo hizo: el dueño filtra por miembro; los demás, "Mis cargues". */}
                      {esDueno ? (
                          <select value={tesMiembro} onChange={e => { setTesMiembro(e.target.value); setTesPagina(0); }}
                              style={{ background: '#070808', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, color: '#F4F4F2', padding: '8px 10px', fontSize: 12.5 }}>
                              <option value="">Hecho por: todos</option>
                              {(d?.equipo ?? []).map((m: any) => <option key={m.id} value={m.id}>Hecho por: {m.nombre || m.email}</option>)}
                          </select>
                      ) : (
                          <button onClick={() => { setTesMios(v => !v); setTesPagina(0); }} style={{ ...CHIP(false), ...(tesMios ? { background: '#4ADE80', color: '#0C0E0D', borderColor: '#4ADE80' } : {}) }}>Mis cargues</button>
                      )}
                      <div className="relative" style={{ width: 260, maxWidth: '100%' }}>
                          <Search size={14} style={{ position: 'absolute', left: 11, top: 10, color: '#878E88' }} />
                          <input value={tesQ} onChange={e => { setTesQ(e.target.value); setTesPagina(0); }} placeholder="Cliente, ID o monto…"
                              style={{ width: '100%', boxSizing: 'border-box', background: '#070808', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, color: '#F4F4F2', padding: '8px 10px 8px 31px', fontSize: 12.5, outline: 'none' }} />
                      </div>
                  </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
                      <thead><tr>{['FECHA', 'CLIENTE', 'TIPO', 'PROVEEDOR', 'HECHO POR', 'MONTO', 'ESTADO'].map((h, i) => (
                          <th key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color: 'rgba(244,244,242,0.45)', textAlign: i === 5 ? 'right' : 'left', padding: '9px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}</tr></thead>
                      <tbody>
                          {(movs?.filas ?? []).map((m: any) => {
                              const colorEstado = m.estado === 'Completado' ? '#4ADE80' : (m.estado === 'Fallido' || m.estado === 'Rechazado') ? '#F87171' : '#FBBF24';
                              return (
                              <tr key={m.id} onClick={() => m.tipo === 'Cargue' && m.estado === 'Pendiente' && abrirCargue(m.id)} style={{ cursor: m.tipo === 'Cargue' && m.estado === 'Pendiente' ? 'pointer' : 'default' }}>
                                  <td style={{ padding: '10px 18px', fontSize: 12, color: '#b9beba', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                                      {new Date(m.at).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                      <br /><span style={{ fontSize: 10.5, color: 'rgba(244,244,242,0.45)', fontFamily: 'monospace' }}>{String(m.id).slice(0, 8)}</span>
                                  </td>
                                  <td style={{ padding: '10px 18px', fontSize: 12.5, fontWeight: 700, color: '#F4F4F2', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                      {m.cliente}
                                      {m.oculto && <><br /><span style={{ fontSize: 10.5, color: 'rgba(244,244,242,0.45)', fontWeight: 500 }}>Oculto por {m.oculto.por} · {m.oculto.motivo}</span></>}
                                  </td>
                                  <td style={{ padding: '10px 18px', fontSize: 12.5, color: '#F4F4F2', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{m.tipo}</td>
                                  <td style={{ padding: '10px 18px', fontSize: 12.5, color: '#878E88', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{m.proveedor}</td>
                                  <td style={{ padding: '10px 18px', fontSize: 12.5, borderBottom: '1px solid rgba(255,255,255,0.06)', fontWeight: m.hechoPor === 'Cliente' ? 500 : 700, color: m.hechoPor === 'Tú' ? '#4ADE80' : m.hechoPor === 'Cliente' ? 'rgba(244,244,242,0.45)' : '#F4F4F2' }}>{m.hechoPor}</td>
                                  <td style={{ padding: '10px 18px', fontSize: 13, fontWeight: 800, textAlign: 'right', color: m.entrada ? '#4ADE80' : '#F4F4F2', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{m.entrada ? '+' : '−'}{fmtCop(m.monto)}</td>
                                  <td style={{ padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: '3px 8px', borderRadius: 999, border: `1px solid ${colorEstado}59`, color: colorEstado }}>{String(m.estado).toUpperCase()}</span>
                                      {m.oculto && esDueno && <> <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.14)', color: '#878E88' }}>OCULTO</span>{' '}
                                          <button onClick={(e) => { e.stopPropagation(); cajaAccion({ action: 'mov_ocultar', txId: m.id, ocultar: false }, 'Movimiento visible otra vez.'); }} style={{ background: 'none', border: 'none', color: '#F4F4F2', textDecoration: 'underline', cursor: 'pointer', fontSize: 11.5 }}>Mostrar</button></>}
                                  </td>
                              </tr>
                              );
                          })}
                          {movs && movs.filas.length === 0 && <tr><td colSpan={7} style={{ padding: 18, fontSize: 12.5, color: '#878E88' }}>Sin movimientos con ese filtro.</td></tr>}
                      </tbody>
                  </table>
              </div>
              <div className="flex items-center justify-between" style={{ padding: '12px 18px', fontSize: 12, color: '#878E88' }}>
                  <span>{movs ? `${movs.total ? movs.pagina * movs.porPagina + 1 : 0}–${Math.min(movs.total, (movs.pagina + 1) * movs.porPagina)} de ${fmtCop(movs.total)}` : ''}</span>
                  <div className="flex" style={{ gap: 8 }}>
                      <button disabled={tesPagina === 0} onClick={() => setTesPagina(p => Math.max(0, p - 1))} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: tesPagina === 0 ? 'rgba(244,244,242,0.45)' : '#F4F4F2', borderRadius: 8, padding: '5px 11px', fontWeight: 700, cursor: 'pointer' }}>Anterior</button>
                      <button disabled={tesPagina + 1 >= totalPaginas} onClick={() => setTesPagina(p => p + 1)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: tesPagina + 1 >= totalPaginas ? 'rgba(244,244,242,0.45)' : '#F4F4F2', borderRadius: 8, padding: '5px 11px', fontWeight: 700, cursor: 'pointer' }}>Siguiente</button>
                  </div>
              </div>
          </div>
          {/* Revisar un cargue sospechoso y ocultarlo SIN borrarlo (solo el dueño) */}
          {cajaOcultar && (
              <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{ padding: 12, background: 'rgba(0,0,0,0.6)' }} onClick={() => !cajaOcupada && setCajaOcultar(null)}>
                  <div onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', background: '#121413', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: 18 }}>
                      <div className="flex items-center justify-between">
                          <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: '#F4F4F2' }}>Cargue · {cajaOcultar.cliente} · {new Date(cajaOcultar.at).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                          <button onClick={() => setCajaOcultar(null)} style={{ background: 'none', border: 'none', color: '#878E88', cursor: 'pointer' }}><X size={16} /></button>
                      </div>
                      {([['USDT que envió', cajaOcultar.acct?.usdtGross], ['USDT que llegaron', cajaOcultar.acct?.usdtNet], ['A cómo vendí', cajaOcultar.acct?.sellRate], ['A cómo le pago', cajaOcultar.acct?.clientRate], ['Se le acreditó', `${fmtCop(cajaOcultar.monto)} COP`], ['Utilidad calculada', `${fmtCop(Number(cajaOcultar.acct?.utilityCop) || 0)} COP`]] as [string, any][]).map(([l, v]) => (
                          <div key={l} className="flex justify-between" style={{ fontSize: 13, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                              <span style={{ color: '#878E88' }}>{l}</span><b style={{ color: '#F4F4F2' }}>{v == null || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('es-CO') : String(v)}</b>
                          </div>
                      ))}
                      <p style={{ margin: '10px 0 6px', fontSize: 12, color: '#878E88', lineHeight: 1.5 }}>
                          Ocultar <b style={{ color: '#F4F4F2' }}>no borra</b> el cargue ni cambia el saldo del cliente: deja de listarse y su utilidad deja de sumar. Queda quién, cuándo y por qué, y se puede volver a mostrar.
                      </p>
                      <textarea value={cajaMotivo} onChange={e => setCajaMotivo(e.target.value)} placeholder="Motivo (obligatorio). Ej.: tasa de venta mal escrita, pendiente de corregir."
                          style={{ width: '100%', boxSizing: 'border-box', minHeight: 64, background: '#070808', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, color: '#F4F4F2', padding: 10, fontSize: 12.5, resize: 'vertical' }} />
                      <div className="flex" style={{ gap: 8, marginTop: 10 }}>
                          <button onClick={() => setCajaOcultar(null)} style={{ flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: '#F4F4F2', borderRadius: 10, padding: 10, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
                          <button disabled={cajaMotivo.trim().length < 5 || cajaOcupada}
                              onClick={async () => { if (await cajaAccion({ action: 'mov_ocultar', txId: cajaOcultar.id, ocultar: true, motivo: cajaMotivo.trim() }, 'Cargue oculto: su utilidad ya no suma.')) setCajaOcultar(null); }}
                              style={{ flex: 1, border: 'none', borderRadius: 10, padding: 10, fontWeight: 800, cursor: cajaMotivo.trim().length < 5 ? 'not-allowed' : 'pointer', background: cajaMotivo.trim().length < 5 ? 'rgba(255,255,255,0.08)' : '#F4F4F2', color: cajaMotivo.trim().length < 5 ? 'rgba(244,244,242,0.45)' : '#0C0E0D' }}>{cajaOcupada ? 'Ocultando…' : 'Ocultar'}</button>
                      </div>
                  </div>
              </div>
          )}

          {/* Corregir el saldo de apertura de Lincoin (solo el dueño) */}
          {cajaEditar && (
              <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{ padding: 12, background: 'rgba(0,0,0,0.6)' }} onClick={() => !cajaOcupada && setCajaEditar(null)}>
                  <div onClick={e => e.stopPropagation()} style={{ width: 400, maxWidth: '100%', background: '#121413', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: 18 }}>
                      <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: '#F4F4F2' }}>Saldo de apertura · {cajaEditar.proveedor}</p>
                      <p style={{ margin: '6px 0 10px', fontSize: 12, color: '#878E88', lineHeight: 1.5 }}>Lo que era de Lincoin en la bolsa el día de la apertura. Queda en la auditoría quién lo cambió y el valor anterior.</p>
                      <input inputMode="numeric" value={cajaEditar.monto ? Number(cajaEditar.monto.replace(/[^\d-]/g, '') || 0).toLocaleString('es-CO') : ''} onChange={e => setCajaEditar(c => c && ({ ...c, monto: e.target.value.replace(/[^\d-]/g, '') }))}
                          style={{ width: '100%', boxSizing: 'border-box', background: '#070808', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, color: '#F4F4F2', padding: '11px 13px', fontSize: 18, fontWeight: 800 }} />
                      <input value={cajaEditar.nota} onChange={e => setCajaEditar(c => c && ({ ...c, nota: e.target.value }))} placeholder="Nota (de dónde sale la cifra)"
                          style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, background: '#070808', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, color: '#F4F4F2', padding: '10px 12px', fontSize: 13 }} />
                      <div className="flex" style={{ gap: 8, marginTop: 12 }}>
                          <button onClick={() => setCajaEditar(null)} style={{ flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: '#F4F4F2', borderRadius: 10, padding: 10, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
                          <button disabled={cajaOcupada || cajaEditar.monto === ''}
                              onClick={async () => { if (await cajaAccion({ action: 'caja_apertura_set', proveedor: cajaEditar.proveedor, lincoin: Number(cajaEditar.monto), nota: cajaEditar.nota }, 'Saldo de apertura actualizado.')) setCajaEditar(null); }}
                              style={{ flex: 1, background: '#4ADE80', border: 'none', color: '#0C0E0D', borderRadius: 10, padding: 10, fontWeight: 800, cursor: 'pointer' }}>{cajaOcupada ? 'Guardando…' : 'Guardar'}</button>
                      </div>
                  </div>
              </div>
          )}
      </div>
      );
  };

  // ── Lincoin: la caja propia ───────────────────────────────────────
  // Lo que es de Lincoin dentro de las bolsas, de dónde salen sus utilidades
  // (por fuente y por día) y los movimientos que hace por fuera de los
  // cargues: retiros de utilidad, egresos/ingresos externos y aportes. Cada
  // movimiento ajusta el Lincoin esperado de su bolsa y el cierre de caja.
  const renderLincoin = () => {
      const d = linData;
      const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString('es-CO');
      const signo = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
      const CARD: React.CSSProperties = { background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16, padding: 18 };
      const ROT: React.CSSProperties = { margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#878E88' };
      const COLORES: Record<string, string> = { Finity: '#4ADE80', Mouv: '#22A35C', 'Saldo Lincoin': '#86EFAC' };
      const TIPOS: Record<string, { l: string; signo: 1 | -1; desc: string }> = {
          retiro: { l: 'Retiro de utilidad', signo: -1, desc: 'Lincoin saca su plata de la bolsa' },
          egreso: { l: 'Egreso externo', signo: -1, desc: 'Salió plata de la bolsa por fuera de Lincoin' },
          ingreso: { l: 'Ingreso externo', signo: 1, desc: 'Entró plata a la bolsa por fuera de Lincoin' },
          aporte: { l: 'Aporte de Lincoin', signo: 1, desc: 'Lincoin pone plata en la bolsa' },
      };
      const fuentes: any[] = d?.fuentes ?? [];
      const utilidad = fuentes.reduce((a, f) => a + f.total, 0);
      const cargues = fuentes.reduce((a, f) => a + f.cargues, 0);
      const movs: any[] = d?.movimientos ?? [];
      const vivos = movs.filter(m => !m.anulado);
      const retiros = vivos.filter(m => m.tipo === 'retiro').reduce((a, m) => a + m.monto, 0);
      // Saldo por bolsa desde la apertura, con la bolsa y los saldos en vivo.
      const oblig = (code: string) => obligaciones && typeof obligaciones.valor?.[code] === 'number' ? obligaciones.valor[code] : allUsers.reduce((a, u) => a + Number((u.balances as any)?.[code] ?? 0), 0);
      const vivo: Record<string, { pool: number | null; clientes: number }> = {
          Mouv: { pool: mouvPool && !mouvPool.loading && !mouvPool.error ? Number(mouvPool.breb ?? mouvPool.total ?? 0) : null, clientes: oblig('COP_BREB') },
          Finity: { pool: finityPool && !finityPool.loading && !finityPool.error ? Number(finityPool.cop ?? 0) : null, clientes: oblig('COP_ACH') },
      };
      const cajaP: any[] = (d?.caja ?? []).map((c: any) => ({ ...c, dif: c.lincoinEsperado != null && vivo[c.proveedor]?.pool != null ? Math.round((vivo[c.proveedor].pool as number) - vivo[c.proveedor].clientes - c.lincoinEsperado) : null }));
      const saldoLincoin = cajaP.reduce((a, c) => a + Number(c.lincoinEsperado ?? 0), 0);
      const difs = cajaP.filter(c => c.apertura);
      const difTotal = difs.length && difs.every(c => c.dif != null) ? difs.reduce((a, c) => a + c.dif, 0) : null;
      const dias: string[] = (() => { const [a, m] = linMes.split('-').map(Number); const n = new Date(Date.UTC(a, m, 0)).getUTCDate(); const hoy = hoyBog(); return Array.from({ length: n }, (_, i) => `${linMes}-${String(i + 1).padStart(2, '0')}`).filter(x => x <= hoy); })();
      const maxDia = Math.max(1, ...dias.map(x => (Object.values(d?.porDia?.[x] ?? {}) as any[]).reduce((a: number, v: any) => a + Math.max(0, Number(v)), 0)));
      const verSoporte = async (id: string) => {
          const r = await pedirAdmin({ action: 'caja_movimiento_soporte', id }).catch(() => null);
          if (!r?.soporte) { showToast('No se pudo abrir el comprobante.'); return; }
          const w = window.open(); if (w) w.document.write(`<iframe src="${r.soporte}" style="border:0;width:100%;height:100%"></iframe>`);
      };
      const nuevo = () => setLinForm({ tipo: 'egreso', proveedor: 'Finity', monto: '', fecha: hoyBog(), descripcion: '', soporte: null, soporteNombre: null });
      const kpi = (l: string, v: string, sub: string, color = '#F4F4F2') => (
          <div style={{ ...CARD, padding: 16 }}>
              <p style={{ margin: 0, fontSize: 12, color: '#878E88' }}>{l}</p>
              <p style={{ margin: '6px 0 0', fontSize: 21, fontWeight: 800, letterSpacing: '-0.5px', color }}>{v}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'rgba(244,244,242,0.45)' }}>{sub}</p>
          </div>
      );
      const CAMPO: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#070808', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, color: '#F4F4F2', padding: '10px 12px', fontSize: 13, outline: 'none', colorScheme: 'dark' as any };
      const RF: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: '#878E88', margin: '10px 0 6px' };

      return (
      <div className="animate-in fade-in duration-300" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="flex items-end justify-between flex-wrap" style={{ gap: 12 }}>
              <div>
                  <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: '#F4F4F2' }}>Lincoin<span style={{ color: '#4ADE80' }}>.</span> <span style={{ color: '#878E88', fontWeight: 600, fontSize: 15 }}>· caja propia</span></h2>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#878E88' }}>{linCargando ? 'Actualizando…' : 'Lo que es de Lincoin dentro de las bolsas, de dónde salen sus utilidades y lo que se mueve por fuera'}</p>
              </div>
              <div className="flex items-center" style={{ gap: 8 }}>
                  <input type="month" value={linMes} max={hoyBog().slice(0, 7)} onChange={e => e.target.value && setLinMes(e.target.value)}
                      style={{ background: '#070808', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, color: '#F4F4F2', padding: '6px 12px', fontSize: 12.5, fontWeight: 700, colorScheme: 'dark' as any }} />
                  <button onClick={nuevo} className="inline-flex items-center" style={{ gap: 6, background: '#4ADE80', color: '#0C0E0D', border: 'none', borderRadius: 10, padding: '9px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                      <Plus size={15} /> Registrar movimiento
                  </button>
              </div>
          </div>

          <div className="grid grid-cols-2 xl:grid-cols-4" style={{ gap: 12 }}>
              {kpi('Saldo de Lincoin en bolsas', difs.length ? fmt(saldoLincoin) : '—', difs.length ? 'apertura + utilidad − retiros ± externos' : 'la caja abre hoy a las 23:59', '#4ADE80')}
              {kpi('Utilidad del periodo', fmt(utilidad), `de ${cargues} cargues`)}
              {kpi('Retiros de utilidad', fmt(retiros), `${vivos.filter(m => m.tipo === 'retiro').length} en el periodo`)}
              {kpi('Diferencia sin explicar', difTotal == null ? '—' : signo(difTotal), difTotal == null ? 'cuando abra la caja' : difTotal === 0 ? 'todo cuadra' : 'falta registrar algo', difTotal == null ? 'rgba(244,244,242,0.45)' : difTotal === 0 ? '#4ADE80' : '#FBBF24')}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] items-start" style={{ gap: 16 }}>
              <div style={CARD}>
                  <p style={{ ...ROT, marginBottom: 12 }}>Utilidades por fuente</p>
                  {fuentes.map((f, i) => (
                      <div key={f.n} style={{ padding: '9px 0', borderTop: i ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                          <div className="flex items-center justify-between" style={{ gap: 10 }}>
                              <span className="flex items-center" style={{ gap: 8 }}>
                                  <span style={{ width: 9, height: 9, borderRadius: 3, background: COLORES[f.n] }} />
                                  <span><span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}>{f.n}</span><span style={{ display: 'block', fontSize: 11, color: 'rgba(244,244,242,0.45)' }}>{f.cargues} cargues · {f.conContabilidad} con contabilidad</span></span>
                              </span>
                              <span style={{ textAlign: 'right' }}><span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: f.total < 0 ? '#F87171' : '#F4F4F2' }}>{fmt(f.total)}</span><span style={{ display: 'block', fontSize: 11, color: 'rgba(244,244,242,0.45)' }}>{utilidad > 0 ? Math.round((Math.max(0, f.total) / utilidad) * 100) : 0} %</span></span>
                          </div>
                          <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 4, marginTop: 7 }}>
                              <div style={{ width: `${utilidad > 0 ? (Math.max(0, f.total) / utilidad) * 100 : 0}%`, height: '100%', background: COLORES[f.n], borderRadius: 4 }} />
                          </div>
                      </div>
                  ))}
                  <p style={{ margin: '14px 0 6px', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, color: 'rgba(244,244,242,0.45)' }}>PRÓXIMAS FUENTES</p>
                  {[['Lincoin Risk', 'Venta de consultas a empresas'], ['Mesa OTC', 'Cierres de cambio'], ['Brasil · PIX', 'Gowd'], ['Estados Unidos · USD', 'Dólares digitales (USDC)']].map(([n, sub]) => (
                      <div key={n} className="flex items-center justify-between" style={{ padding: '7px 0', borderTop: '1px dashed rgba(255,255,255,0.08)' }}>
                          <span><span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#878E88' }}>{n}</span><span style={{ display: 'block', fontSize: 11, color: 'rgba(244,244,242,0.45)' }}>{sub}</span></span>
                          <span className="inline-flex items-center" style={{ gap: 5, fontSize: 11, color: 'rgba(244,244,242,0.45)' }}><Lock size={11} /> próximamente</span>
                      </div>
                  ))}
              </div>

              <div style={CARD}>
                  <p style={{ ...ROT, marginBottom: 12 }}>Utilidad por día</p>
                  {!d?.porDia ? <p style={{ margin: 0, fontSize: 12.5, color: '#878E88' }}>{linCargando ? 'Cargando…' : '—'}</p> : <>
                      <div className="flex items-end" style={{ gap: 4, height: 170 }}>
                          {dias.map(x => {
                              const v = d.porDia[x] ?? {};
                              const neg = Object.values(v).some((y: any) => Number(y) < 0);
                              return (
                                  <div key={x} title={`${Number(x.slice(8))} · ${fuentes.map(f => `${f.n} ${fmt(v[f.n] ?? 0)}`).join(' · ')}`} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column-reverse' }}>
                                      {fuentes.map(f => { const y = Math.max(0, Number(v[f.n] ?? 0)); return y ? <div key={f.n} style={{ height: `${(y / maxDia) * 100}%`, background: COLORES[f.n], borderRadius: 2, marginTop: 1 }} /> : null; })}
                                      {neg && <div style={{ height: 3, background: '#F87171', borderRadius: 2 }} />}
                                  </div>
                              );
                          })}
                      </div>
                      <div className="flex justify-between" style={{ fontSize: 10.5, color: 'rgba(244,244,242,0.45)', marginTop: 5 }}><span>{dias[0]?.slice(8)}</span><span>{dias[dias.length - 1]?.slice(8)}</span></div>
                      <div className="flex flex-wrap" style={{ gap: 14, marginTop: 10 }}>
                          {fuentes.map(f => <span key={f.n} className="inline-flex items-center" style={{ gap: 6, fontSize: 11.5, color: '#878E88' }}><span style={{ width: 9, height: 9, borderRadius: 3, background: COLORES[f.n] }} />{f.n}</span>)}
                          <span className="inline-flex items-center" style={{ gap: 6, fontSize: 11.5, color: '#878E88' }}><span style={{ width: 9, height: 3, background: '#F87171' }} />día con utilidad negativa</span>
                      </div>
                  </>}
              </div>
          </div>

          <div style={CARD}>
              <p style={{ ...ROT, marginBottom: 12 }}>Saldo de Lincoin por bolsa · desde la apertura</p>
              <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 14 }}>
                  {cajaP.map(c => {
                      const fila = (l: React.ReactNode, v: number | null, o: { signo?: string; color?: string; fuerte?: boolean } = {}) => (
                          <div className="flex justify-between" style={{ padding: '5px 0', fontSize: 12.5, color: '#878E88' }}>
                              <span>{l}</span><span style={{ fontWeight: o.fuerte ? 800 : 700, color: o.color ?? '#F4F4F2' }}>{v == null ? '—' : `${v === 0 ? '' : (o.signo ?? '')}${fmt(Math.abs(v))}`}</span>
                          </div>
                      );
                      const v = vivo[c.proveedor];
                      return (
                          <div key={c.proveedor} style={{ background: '#070808', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14 }}>
                              <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                                  <span className="flex items-center" style={{ gap: 7, fontWeight: 800, color: '#F4F4F2' }}>{c.proveedor === 'Mouv' ? <Zap size={14} style={{ color: '#4ADE80' }} /> : <Landmark size={14} style={{ color: '#4ADE80' }} />} {c.proveedor}</span>
                                  {c.dif == null ? null : c.dif === 0
                                    ? <span className="inline-flex items-center" style={{ gap: 4, fontSize: 11, fontWeight: 700, color: '#4ADE80' }}><CheckCircle size={12} /> Cuadra</span>
                                    : <span className="inline-flex items-center" style={{ gap: 4, fontSize: 11, fontWeight: 700, color: '#FBBF24' }}><AlertTriangle size={12} /> No cuadra</span>}
                              </div>
                              {!c.apertura ? <p style={{ margin: '4px 0', fontSize: 12.5, color: '#878E88' }}>La caja abre hoy a las 23:59 (o desde Tesorería › Cierre de caja).</p> : <>
                                  {fila(`Saldo de apertura · ${new Date(c.apertura.at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}`, c.apertura.lincoin)}
                                  {fila('+ Utilidad de los cargues', c.utilidadDesdeApertura, { signo: c.utilidadDesdeApertura < 0 ? '−' : '+', color: '#4ADE80' })}
                                  {fila('− Retiros de utilidad', c.retirosDesdeApertura, { signo: '−' })}
                                  {fila('± Movimientos externos y aportes', c.externosDesdeApertura, { signo: c.externosDesdeApertura < 0 ? '−' : '+' })}
                                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.14)', marginTop: 4, paddingTop: 4 }}>
                                      {fila('= Lincoin esperado', c.lincoinEsperado, { fuerte: true, color: '#4ADE80' })}
                                      {fila(<span style={{ color: 'rgba(244,244,242,0.45)' }}>Bolsa en vivo − saldos de clientes</span>, v?.pool == null ? null : Math.round((v.pool as number) - v.clientes), { signo: (v?.pool ?? 0) - (v?.clientes ?? 0) < 0 ? '−' : '' })}
                                  </div>
                                  <div className="flex justify-between" style={{ marginTop: 6, padding: '8px 10px', borderRadius: 9, fontSize: 12.5, fontWeight: 800,
                                      background: c.dif === 0 ? 'rgba(74,222,128,0.08)' : 'rgba(251,191,36,0.10)', border: `1px solid ${c.dif === 0 ? 'rgba(74,222,128,0.25)' : 'rgba(251,191,36,0.35)'}`, color: c.dif === 0 ? '#4ADE80' : '#FBBF24' }}>
                                      <span>Diferencia sin explicar</span><span>{c.dif == null ? '—' : signo(c.dif)}</span>
                                  </div>
                                  {c.dif != null && c.dif !== 0 && <p style={{ margin: '5px 0 0', fontSize: 11, color: '#FBBF24' }}>Registra el movimiento que la explica (por ejemplo, un {c.dif < 0 ? 'egreso' : 'ingreso'} externo de {fmt(Math.abs(c.dif))}).</p>}
                              </>}
                          </div>
                      );
                  })}
              </div>
          </div>

          <div style={{ ...CARD, padding: 0 }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}><p style={ROT}>Movimientos de Lincoin · {linMes}</p></div>
              <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
                      <thead><tr>{['FECHA', 'TIPO', 'BOLSA', 'DESCRIPCIÓN', 'SOPORTE', 'HECHO POR', 'MONTO', ''].map((h, i) => (
                          <th key={h || 'acc'} style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color: 'rgba(244,244,242,0.45)', textAlign: i === 6 ? 'right' : 'left', padding: '9px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{h}</th>
                      ))}</tr></thead>
                      <tbody>
                          {movs.length === 0 && <tr><td colSpan={8} style={{ padding: 18, fontSize: 12.5, color: '#878E88' }}>No hay movimientos registrados en este mes.</td></tr>}
                          {movs.map(m => {
                              const t = TIPOS[m.tipo] ?? { l: m.tipo, signo: 1 };
                              return (
                                  <tr key={m.id} style={{ opacity: m.anulado ? 0.5 : 1 }}>
                                      <td style={{ padding: '10px 18px', fontSize: 12, color: '#b9beba', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{new Date(`${m.fecha}T12:00:00`).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}</td>
                                      <td style={{ padding: '10px 18px', fontSize: 12.5, fontWeight: 700, color: '#F4F4F2', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                                          <span className="inline-flex items-center" style={{ gap: 6 }}>{t.signo > 0 ? <ArrowDownCircle size={13} style={{ color: '#4ADE80' }} /> : <ArrowUpCircle size={13} style={{ color: '#F87171' }} />}{t.l}</span>
                                          {m.anulado && <><br /><span style={{ fontSize: 10.5, color: '#878E88', fontWeight: 500 }}>Anulado por {m.anulado.por} · {m.anulado.motivo}</span></>}
                                      </td>
                                      <td style={{ padding: '10px 18px', fontSize: 12.5, color: '#878E88', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{m.proveedor}</td>
                                      <td style={{ padding: '10px 18px', fontSize: 12.5, color: '#F4F4F2', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{m.descripcion}</td>
                                      <td style={{ padding: '10px 18px', fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                          {m.soporte ? <button onClick={() => verSoporte(m.id)} className="inline-flex items-center" style={{ gap: 5, background: 'none', border: 'none', color: '#878E88', cursor: 'pointer', textDecoration: 'underline', fontSize: 12 }}><Paperclip size={12} />{m.soporte}</button> : <span style={{ color: 'rgba(244,244,242,0.45)' }}>sin soporte</span>}
                                      </td>
                                      <td style={{ padding: '10px 18px', fontSize: 12.5, fontWeight: 700, color: m.por === 'Tú' ? '#4ADE80' : '#F4F4F2', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{m.por}</td>
                                      <td style={{ padding: '10px 18px', fontSize: 13, fontWeight: 800, textAlign: 'right', color: t.signo > 0 ? '#4ADE80' : '#F4F4F2', borderBottom: '1px solid rgba(255,255,255,0.06)', textDecoration: m.anulado ? 'line-through' : undefined, whiteSpace: 'nowrap' }}>{t.signo > 0 ? '+' : '−'}{fmt(m.monto)}</td>
                                      <td style={{ padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'right' }}>
                                          {esDueno && !m.anulado && <button onClick={() => setLinAnular({ id: m.id, motivo: '' })} style={{ fontSize: 11.5, fontWeight: 700, color: '#878E88', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '5px 10px', cursor: 'pointer' }}>Anular</button>}
                                      </td>
                                  </tr>
                              );
                          })}
                      </tbody>
                  </table>
              </div>
              <p style={{ margin: 0, padding: '12px 18px', fontSize: 11.5, color: 'rgba(244,244,242,0.45)' }}>Cada movimiento ajusta el Lincoin esperado de su bolsa y la diferencia del cierre de caja. No se borran: el dueño los puede anular con motivo.</p>
          </div>

          {/* Registrar movimiento */}
          {linForm && (
              <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{ padding: 12, background: 'rgba(0,0,0,0.6)' }} onClick={() => !cajaOcupada && setLinForm(null)}>
                  <div onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: '100%', maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto', background: '#121413', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: 18 }}>
                      <div className="flex items-center justify-between">
                          <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: '#F4F4F2' }}>Registrar movimiento de Lincoin</p>
                          <button onClick={() => setLinForm(null)} style={{ background: 'none', border: 'none', color: '#878E88', cursor: 'pointer' }}><X size={16} /></button>
                      </div>
                      <label style={RF}>Tipo</label>
                      <div className="grid grid-cols-2" style={{ gap: 6 }}>
                          {(Object.keys(TIPOS) as ('retiro' | 'egreso' | 'ingreso' | 'aporte')[]).map(k => (
                              <button key={k} onClick={() => setLinForm(f => f && ({ ...f, tipo: k }))} style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', color: '#F4F4F2', background: linForm.tipo === k ? 'rgba(74,222,128,0.10)' : 'transparent', border: linForm.tipo === k ? '1.5px solid #4ADE80' : '1px solid rgba(255,255,255,0.14)' }}>
                                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>{TIPOS[k].l}</span>
                                  <span style={{ display: 'block', fontSize: 10.5, color: 'rgba(244,244,242,0.45)' }}>{TIPOS[k].desc}</span>
                              </button>
                          ))}
                      </div>
                      <div className="grid grid-cols-2" style={{ gap: 8 }}>
                          <div><label style={RF}>Bolsa</label>
                              <select value={linForm.proveedor} onChange={e => setLinForm(f => f && ({ ...f, proveedor: e.target.value as any }))} style={CAMPO}><option>Finity</option><option>Mouv</option></select></div>
                          <div><label style={RF}>Fecha</label>
                              <input type="date" max={hoyBog()} value={linForm.fecha} onChange={e => setLinForm(f => f && ({ ...f, fecha: e.target.value }))} style={CAMPO} /></div>
                      </div>
                      <label style={RF}>Monto (COP)</label>
                      <input inputMode="numeric" value={linForm.monto ? Number(linForm.monto).toLocaleString('es-CO') : ''} placeholder="0" onChange={e => setLinForm(f => f && ({ ...f, monto: e.target.value.replace(/\D/g, '') }))} style={{ ...CAMPO, fontSize: 18, fontWeight: 800 }} />
                      <label style={RF}>Descripción</label>
                      <input value={linForm.descripcion} onChange={e => setLinForm(f => f && ({ ...f, descripcion: e.target.value }))} placeholder="Ej.: pago directo a proveedor desde Finity" style={CAMPO} />
                      <label className="inline-flex items-center" style={{ marginTop: 10, gap: 6, border: '1px dashed rgba(255,255,255,0.14)', borderRadius: 10, padding: '8px 12px', color: '#878E88', fontSize: 12, cursor: 'pointer' }}>
                          <Paperclip size={13} /> {linForm.soporteNombre ? `Adjunto: ${linForm.soporteNombre}` : 'Adjuntar comprobante (opcional)'}
                          <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={async e => {
                              const file = e.target.files?.[0]; if (!file) return;
                              if (file.size > 3 * 1024 * 1024) { showToast('El comprobante pesa demasiado (máx. 3 MB).'); return; }
                              const url = await fileToBase64(file);
                              setLinForm(f => f && ({ ...f, soporte: url, soporteNombre: file.name }));
                          }} />
                      </label>
                      <div className="flex" style={{ gap: 8, marginTop: 14 }}>
                          <button onClick={() => setLinForm(null)} style={{ flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: '#F4F4F2', borderRadius: 10, padding: 10, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
                          <button disabled={cajaOcupada || !linForm.monto || linForm.descripcion.trim().length < 3}
                              onClick={async () => { if (await cajaAccion({ action: 'caja_movimiento_crear', ...linForm, monto: Number(linForm.monto) }, 'Movimiento registrado.')) setLinForm(null); }}
                              style={{ flex: 1, border: 'none', borderRadius: 10, padding: 10, fontWeight: 800, cursor: 'pointer', background: !linForm.monto || linForm.descripcion.trim().length < 3 ? 'rgba(255,255,255,0.08)' : '#4ADE80', color: !linForm.monto || linForm.descripcion.trim().length < 3 ? 'rgba(244,244,242,0.45)' : '#0C0E0D' }}>{cajaOcupada ? 'Registrando…' : 'Registrar'}</button>
                      </div>
                  </div>
              </div>
          )}

          {/* Anular movimiento (solo el dueño) */}
          {linAnular && (
              <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{ padding: 12, background: 'rgba(0,0,0,0.6)' }} onClick={() => !cajaOcupada && setLinAnular(null)}>
                  <div onClick={e => e.stopPropagation()} style={{ width: 400, maxWidth: '100%', background: '#121413', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: 18 }}>
                      <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: '#F4F4F2' }}>Anular movimiento</p>
                      <p style={{ margin: '6px 0 10px', fontSize: 12, color: '#878E88' }}>No se borra: queda tachado, deja de contar y se guarda quién, cuándo y por qué.</p>
                      <textarea value={linAnular.motivo} onChange={e => setLinAnular(a => a && ({ ...a, motivo: e.target.value }))} placeholder="Motivo (obligatorio)"
                          style={{ width: '100%', boxSizing: 'border-box', minHeight: 64, background: '#070808', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, color: '#F4F4F2', padding: 10, fontSize: 12.5 }} />
                      <div className="flex" style={{ gap: 8, marginTop: 10 }}>
                          <button onClick={() => setLinAnular(null)} style={{ flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: '#F4F4F2', borderRadius: 10, padding: 10, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
                          <button disabled={cajaOcupada || linAnular.motivo.trim().length < 5}
                              onClick={async () => { if (await cajaAccion({ action: 'caja_movimiento_anular', id: linAnular.id, motivo: linAnular.motivo.trim() }, 'Movimiento anulado.')) setLinAnular(null); }}
                              style={{ flex: 1, border: 'none', borderRadius: 10, padding: 10, fontWeight: 800, cursor: 'pointer', background: '#F4F4F2', color: '#0C0E0D', opacity: linAnular.motivo.trim().length < 5 ? 0.4 : 1 }}>{cajaOcupada ? 'Anulando…' : 'Anular'}</button>
                      </div>
                  </div>
              </div>
          )}
      </div>
      );
  };

  const renderReports = () => {
      // Filter logic for User Reports
      // Lo que encontró el servidor en toda la base, más lo cargado que
      // coincide. Se dibujan hasta 200: el resto se encuentra buscando.
      const qRep = reportUserSearch.trim().toLowerCase();
      const remotosRep = reportRemotos && reportRemotos.q.toLowerCase() === qRep
        ? reportRemotos.ids.map(id => allUsers.find(u => u.id === id)).filter(Boolean) as User[]
        : [];
      const vistosRep = new Set<string>();
      const filteredReportUsers = [...remotosRep, ...allUsers.filter(u =>
          (u.name ?? '').toLowerCase().includes(qRep) ||
          (u.email ?? '').toLowerCase().includes(qRep) ||
          u.id.includes(reportUserSearch)
      )].filter(u => { if (vistosRep.has(u.id)) return false; vistosRep.add(u.id); return true; }).slice(0, 200);

      // Logic for Audit Tab (Transaction Log)
      const auditTransactions = historyTransactions.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return (
          <div className="space-y-6 animate-in fade-in duration-300">
              
              {/* Tab Navigation */}
              <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 mb-4">
                  <button onClick={() => setReportSubTab('financial')} className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${reportSubTab === 'financial' ? 'bg-[#0C0E0D] shadow-lg' : 'text-slate-500 hover:bg-slate-100'}`}>
                      <TrendingUp size={16}/> Resumen Financiero
                  </button>
                  <button onClick={() => setReportSubTab('audit')} className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${reportSubTab === 'audit' ? 'bg-[#0C0E0D] shadow-lg' : 'text-slate-500 hover:bg-slate-100'}`}>
                      <FileSearch size={16}/> Auditoría
                  </button>
                  <button onClick={() => setReportSubTab('users')} className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${reportSubTab === 'users' ? 'bg-[#0C0E0D] shadow-lg' : 'text-slate-500 hover:bg-slate-100'}`}>
                      <Users size={16}/> Reporte Usuarios
                  </button>
                  <button onClick={() => setReportSubTab('backup')} className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${reportSubTab === 'backup' ? 'bg-[#0C0E0D] shadow-lg' : 'text-slate-500 hover:bg-slate-100'}`}>
                      <HardDrive size={16}/> Sistema & Backup
                  </button>
              </div>

              {/* FINANCIAL TAB */}
              {reportSubTab === 'financial' && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                          <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                              <DollarSign size={20} className="text-[#0C0E0D]"/> Métricas de Rentabilidad
                          </h3>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                  <p className="text-xs text-slate-500 font-bold uppercase mb-1">Volumen Bruto</p>
                                  <p className="text-2xl font-bold text-slate-800 tracking-tight">${Math.round(financials.volumeUSD).toLocaleString()}</p>
                                  <span className="text-[10px] text-green-600 bg-green-100 px-2 py-0.5 rounded-full">+12.5% vs mes anterior</span>
                              </div>
                              <div className="p-4 bg-green-50 rounded-xl border border-green-100">
                                  <p className="text-xs text-green-700 font-bold uppercase mb-1">Ingresos (Fees)</p>
                                  <p className="text-2xl font-bold text-green-700 tracking-tight">${Math.round(financials.grossRevenueUSD).toLocaleString()}</p>
                                  <span className="text-[10px] text-green-600">Margen bruto: {systemConfig.globalFee}%</span>
                              </div>
                              <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                                  <p className="text-xs text-red-700 font-bold uppercase mb-1">Gastos Referidos</p>
                                  <p className="text-2xl font-bold text-red-700 tracking-tight">-${Math.round(financials.referralCostUSD).toLocaleString()}</p>
                                  <span className="text-[10px] text-red-600">Comisiones + Bonos</span>
                              </div>
                              <div className="p-4 bg-[#0C0E0D] rounded-xl border border-slate-900 text-white relative overflow-hidden">
                                  <div className="absolute top-0 right-0 w-16 h-16 bg-white/10 rounded-full blur-xl -translate-y-1/2 translate-x-1/2"></div>
                                  <p className="text-xs text-green-200 font-bold uppercase mb-1 relative z-10">Utilidad Neta</p>
                                  <p className="text-2xl font-bold text-white tracking-tight relative z-10">${Math.round(financials.netProfit).toLocaleString()}</p>
                                  <span className="text-[10px] text-green-300 relative z-10">Profit final operativo</span>
                              </div>
                          </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                              <h4 className="text-sm font-bold text-slate-600 mb-4">Evolución de Volumen (6 Meses)</h4>
                              <SimpleBarChart data={chartData} />
                          </div>
                          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center items-center text-center">
                              <h4 className="text-sm font-bold text-slate-600 mb-6 self-start">Salud del Negocio</h4>
                              <div className="w-40 h-40 rounded-full border-[12px] border-slate-100 border-t-[#4ADE80] border-r-[#4ADE80] flex flex-col items-center justify-center mb-4 transform -rotate-45">
                                  <div className="transform rotate-45 text-center">
                                      <span className="text-3xl font-bold text-slate-800">{financials.activeUsers}</span>
                                      <span className="block text-[10px] text-slate-400 font-bold uppercase">Usuarios Activos</span>
                                  </div>
                              </div>
                              <p className="text-sm text-slate-500">Ticket Promedio: <span className="font-bold text-slate-800">${Math.round(financials.avgTicket).toLocaleString()}</span></p>
                          </div>
                      </div>
                  </div>
              )}

              {/* AUDIT TAB */}
              {reportSubTab === 'audit' && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                      {activeAlerts.length > 0 && (
                          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                              <h4 className="font-bold text-orange-800 flex items-center gap-2 mb-2"><AlertTriangle size={18}/> Alertas del Sistema</h4>
                              <div className="space-y-2">
                                  {activeAlerts.map(alert => (
                                      <div key={alert.id} className="text-sm text-orange-700 bg-white/50 p-2 rounded border border-orange-100 flex justify-between">
                                          <span><strong>{alert.title}:</strong> {alert.description}</span>
                                          {alert.action === 'clients' && <button onClick={() => setActiveTab('clients')} className="underline font-bold">Ver Clientes</button>}
                                      </div>
                                  ))}
                              </div>
                          </div>
                      )}

                      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                          <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                              <h3 className="font-bold text-slate-700">Registro de Transacciones</h3>
                              <div className="text-xs text-slate-500">Mostrando {auditTransactions.length} registros</div>
                          </div>
                          <div className="max-h-[600px] overflow-y-auto">
                              <table className="w-full text-left text-sm">
                                  <thead className="bg-white text-slate-500 font-bold uppercase text-[10px] sticky top-0 z-10 border-b border-slate-100">
                                      <tr>
                                          <th className="px-6 py-3">Fecha</th>
                                          <th className="px-6 py-3">ID</th>
                                          <th className="px-6 py-3">Usuario</th>
                                          <th className="px-6 py-3">Tipo</th>
                                          <th className="px-6 py-3 text-right">Monto</th>
                                          <th className="px-6 py-3 text-center">Estado</th>
                                          <th className="px-6 py-3 text-center">Riesgo</th>
                                      </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                      {auditTransactions.map(tx => {
                                          const isHighRisk = tx.amount > 5000 || tx.status === 'Rechazado';
                                          return (
                                              <tr key={tx.id} className="hover:bg-slate-50">
                                                  <td className="px-6 py-3 text-slate-500 text-xs">{tx.date}</td>
                                                  <td className="px-6 py-3 font-mono text-xs text-slate-400">#{tx.id}</td>
                                                  <td className="px-6 py-3 font-bold text-slate-700">{tx.userName}</td>
                                                  <td className="px-6 py-3 text-xs uppercase">{tx.type}</td>
                                                  <td className="px-6 py-3 text-right font-mono font-medium">{formatMoney(tx.amount, tx.currency)} {tx.currency}</td>
                                                  <td className="px-6 py-3 text-center">
                                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${tx.status === 'Completado' ? 'bg-green-100 text-green-700' : tx.status === 'Rechazado' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                                                          {tx.status}
                                                      </span>
                                                  </td>
                                                  <td className="px-6 py-3 text-center">
                                                      {isHighRisk && <span className="bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded text-[10px] font-bold flex items-center justify-center gap-1"><ShieldAlert size={10}/> ALERTA</span>}
                                                  </td>
                                              </tr>
                                          );
                                      })}
                                  </tbody>
                              </table>
                          </div>
                      </div>
                  </div>
              )}

              {/* USERS REPORT TAB */}
              {reportSubTab === 'users' && (
                  <div className="flex gap-6 animate-in fade-in slide-in-from-right-4 h-[600px]">
                      {/* User List Side */}
                      <div className="w-1/3 flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
                          <div className="p-4 border-b border-slate-100 bg-slate-50">
                              <div className="relative">
                                  <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                                  <input 
                                      type="text" 
                                      placeholder="Buscar usuario..." 
                                      value={reportUserSearch}
                                      onChange={(e) => setReportUserSearch(e.target.value)}
                                      className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:border-[#0C0E0D] outline-none"
                                  />
                              </div>
                          </div>
                          <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                              {filteredReportUsers.map(user => (
                                  <div 
                                      key={user.id} 
                                      onClick={() => setSelectedReportUser(user)}
                                      className={`p-4 cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between ${selectedReportUser?.id === user.id ? 'bg-slate-50 border-l-4 border-[#0C0E0D]' : ''}`}
                                  >
                                      <div className="flex items-center gap-3">
                                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${user.isBlocked ? 'bg-red-100 text-red-600' : 'bg-slate-200 text-slate-600'}`}>
                                              {user?.name?.charAt(0) ?? "?"}
                                          </div>
                                          <div className="overflow-hidden">
                                              <p className="font-bold text-slate-800 text-sm truncate w-32">{user.name}</p>
                                              <p className="text-xs text-slate-500 truncate w-32">{user.email}</p>
                                          </div>
                                      </div>
                                      <ChevronRight size={16} className="text-slate-300"/>
                                  </div>
                              ))}
                          </div>
                      </div>

                      {/* Detail Side */}
                      <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                          {selectedReportUser ? (
                              <div className="flex-col h-full flex">
                                  <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-start">
                                      <div>
                                          <h2 className="text-xl font-bold text-slate-800">{selectedReportUser.name}</h2>
                                          <div className="flex gap-2 mt-1">
                                              <span className="text-xs text-slate-500 font-mono">ID: {selectedReportUser.id}</span>
                                              <span className={`text-[10px] px-2 rounded-full font-bold uppercase ${selectedReportUser.kycStatus === 'verified' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{selectedReportUser.kycStatus || 'pending'}</span>
                                          </div>
                                      </div>
                                      <div className="text-right">
                                          <p className="text-xs text-slate-500 uppercase font-bold">Volumen Histórico</p>
                                          <p className="text-xl font-bold text-[#0C0E0D]">${formatMoney(getUserVolume(selectedReportUser.id).totalUSD, 'USD')}</p>
                                      </div>
                                  </div>
                                  <div className="flex-1 overflow-y-auto p-6">
                                      <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2"><Activity size={16}/> Actividad Reciente</h3>
                                      <div className="space-y-3">
                                          {historyTransactions.filter(tx => tx.userId === selectedReportUser.id).map(tx => (
                                              <div key={tx.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100">
                                                  <div className="flex items-center gap-3">
                                                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${tx.type === 'load' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-[#4ADE80]'}`}>
                                                          {tx.initials}
                                                      </div>
                                                      <div>
                                                          <p className="text-sm font-bold text-slate-700">{tx.title}</p>
                                                          <p className="text-xs text-slate-400">{tx.date} • {tx.id}</p>
                                                      </div>
                                                  </div>
                                                  <div className="text-right">
                                                      <p className="font-mono text-sm font-bold">{formatMoney(tx.amount, tx.currency)} {tx.currency}</p>
                                                      <span className={`text-[9px] uppercase font-bold ${tx.status === 'Completado' ? 'text-green-600' : 'text-orange-500'}`}>{tx.status}</span>
                                                  </div>
                                              </div>
                                          ))}
                                          {historyTransactions.filter(tx => tx.userId === selectedReportUser.id).length === 0 && (
                                              <p className="text-center text-slate-400 py-8 text-sm">Este usuario no tiene transacciones registradas.</p>
                                          )}
                                      </div>
                                  </div>
                              </div>
                          ) : (
                              <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
                                  <UserCheck size={64} className="mb-4 opacity-50"/>
                                  <p className="text-lg font-medium text-slate-400">Selecciona un usuario para ver su reporte</p>
                              </div>
                          )}
                      </div>
                  </div>
              )}

              {/* BACKUP TAB */}
              {reportSubTab === 'backup' && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                      <div className="bg-red-50 border border-red-100 rounded-xl p-6 mb-6">
                          <h3 className="text-red-800 font-bold flex items-center gap-2 mb-2"><ShieldAlert size={20}/> Zona de Seguridad de Datos</h3>
                          <p className="text-sm text-red-700 leading-relaxed max-w-3xl">
                              Estas herramientas permiten descargar una copia completa de la base de datos o restaurar el sistema a un punto anterior. 
                              <strong> Úsalo con precaución.</strong> Restaurar una copia sobrescribirá todos los datos actuales, incluyendo usuarios y transacciones recientes.
                          </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center text-center hover:shadow-md transition-shadow">
                              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center text-[#4ADE80] mb-6">
                                  <Database size={40} strokeWidth={1.5} />
                              </div>
                              <h3 className="text-xl font-bold text-slate-800 mb-2">Copia de Seguridad (Backup)</h3>
                              <p className="text-slate-500 text-sm mb-8 px-4">
                                  Descarga un archivo JSON con lo que el panel tiene cargado: los clientes en pantalla, los movimientos recientes, la configuración y la tesorería. No es la base completa ni va cifrado: la copia de la base entera la hace Supabase.
                              </p>
                              <button onClick={downloadDatabase} className="w-full bg-[#0C0E0D] py-3 rounded-xl font-bold hover:bg-[#161A17] transition-colors flex items-center justify-center gap-2">
                                  <Download size={18}/> Descargar lo cargado
                              </button>
                          </div>

                          <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center text-center hover:shadow-md transition-shadow relative overflow-hidden">
                              <div className="w-20 h-20 bg-purple-50 rounded-full flex items-center justify-center text-purple-600 mb-6">
                                  <UploadCloud size={40} strokeWidth={1.5} />
                              </div>
                              <h3 className="text-xl font-bold text-slate-800 mb-2">Restauración de Sistema</h3>
                              <p className="text-slate-500 text-sm mb-8 px-4">
                                  Sube un archivo de backup previamente descargado para restaurar el sistema. Ideal para recuperación ante desastres.
                              </p>
                              <label className="w-full bg-white border-2 border-purple-100 text-purple-700 py-3 rounded-xl font-bold hover:bg-purple-50 hover:border-purple-200 transition-colors cursor-pointer flex items-center justify-center gap-2">
                                  <Upload size={18}/> Cargar Archivo de Restauración
                                  <input type="file" ref={fileInputRef} onChange={handleRestoreDatabase} className="hidden" accept=".json" />
                              </label>
                          </div>
                      </div>
                  </div>
              )}
          </div>
      );
  };

  const RecaptchaConfigBlock: React.FC<{ systemConfig: any; updateSystemConfig: (c: any) => void }> = ({ systemConfig, updateSystemConfig }) => {
    const [key, setKey] = React.useState(systemConfig.recaptchaSiteKey ?? '');
    const [saved, setSaved] = React.useState(false);
    const handleSave = () => {
      updateSystemConfig({ recaptchaSiteKey: key.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    };
    return (
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h3 className="font-bold text-slate-800 mb-1 flex items-center gap-2"><ShieldAlert size={18}/> reCAPTCHA v3</h3>
        <p className="text-xs text-slate-500 mb-4">Site Key de Google reCAPTCHA v3 (invisible, sin checkbox). Déjala vacía para desactivar. Obtén la clave en <span className="font-mono text-[#0C0E0D]">google.com/recaptcha/admin</span>.</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0C0E0D]/20"
          />
          <button onClick={handleSave}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${saved ? 'bg-green-600' : 'bg-[#0C0E0D] hover:bg-[#161A17]'}`}>
            {saved ? <><CheckCircle size={15}/> Guardado</> : <><Save size={15}/> Guardar</>}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">Se activa en el login inmediatamente al guardar.</p>
      </div>
    );
  };

  const renderConfig = () => (
    <div className="space-y-6 animate-in fade-in duration-300">
        <AdminLimitesEnvio />
        {/* Países habilitados — modelo hub multi-país. Controla qué países ven
            los clientes en Enviar/Beneficiarios (Activo), cuáles aparecen como
            "Próximamente" en el inicio, y cuáles quedan ocultos. */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><Landmark size={20}/> Países y monedas</h3>
            <p className="text-xs text-slate-500 mb-5">Cada país opera su riel local contra USDT (nunca fiat→fiat directo). Activa un país solo cuando su riel esté conectado.</p>
            {/* Si el guardado falló, se dice ACA. Antes el interruptor se
                quedaba puesto aunque no se hubiera guardado en ningún lado, y
                los clientes nunca veían el cambio. */}
            {configError && (
                <div className="mb-3 flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                    <AlertTriangle size={15} className="text-red-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-xs font-bold text-red-900">El cambio no se guardó</p>
                        <p className="text-[11px] text-red-700 mt-0.5">{configError}</p>
                    </div>
                </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {([
                    { name: 'Colombia', rail: 'Bre-B · ACH · COP', def: 'on' },
                    { name: 'Estados Unidos', rail: 'USDT (TRON) · USD', def: 'on' },
                    { name: 'México', rail: 'SPEI · MXN', def: 'soon' },
                    { name: 'Brasil', rail: 'Pix · BRL', def: 'soon' },
                    { name: 'Perú', rail: 'CCI · PEN', def: 'off' },
                    { name: 'Chile', rail: 'Transferencia · CLP', def: 'off' },
                    { name: 'Venezuela', rail: 'Pago móvil · VES', def: 'off' },
                    // Europa: la parte EURC del producto. El riel es SEPA y la
                    // moneda digital es EURC, igual que USDC para el dolar.
                    { name: 'Europa', rail: 'SEPA · EUR', def: 'soon' },
                    { name: 'Suiza', rail: 'SIC · CHF', def: 'soon' },
                    { name: 'Reino Unido', rail: 'Faster Payments · GBP', def: 'soon' },
                ] as const).map(c => {
                    const cs: Record<string, string> = { Colombia: 'on', 'Estados Unidos': 'on', 'México': 'soon', Brasil: 'soon', ...((systemConfig as any).countryStatus || {}) };
                    const cur = cs[c.name] ?? c.def;
                    const setStatus = (v: string) => updateSystemConfig({ countryStatus: { ...cs, [c.name]: v } } as any);
                    return (
                        <div key={c.name} className="flex items-center justify-between gap-3 border border-slate-200 rounded-xl px-4 py-3">
                            <div className="min-w-0">
                                <p className="font-bold text-slate-800 text-sm">{c.name}</p>
                                <p className="text-[11px] text-slate-400">{c.rail}</p>
                                {/* Activo = a los clientes les aparece la billetera en la app.
                                    Se avisa acá porque "Activo" suena a una vista previa y no
                                    lo es: sin riel conectado, esa cuenta no puede recibir ni
                                    mandar un peso, y el cliente la va a ver igual. */}
                                {cur === 'on' && !['Colombia', 'Estados Unidos'].includes(c.name) && (
                                    <p className="text-[10.5px] text-amber-600 font-semibold mt-1 leading-snug">
                                        Los clientes ya ven esta billetera. El riel todavía no está conectado:
                                        no van a poder cargar ni enviar.
                                    </p>
                                )}
                            </div>
                            <select value={cur} onChange={e => setStatus(e.target.value)} className="border border-slate-200 rounded-lg text-xs font-bold p-2 shrink-0">
                                <option value="on">Activo</option>
                                <option value="soon">Próximamente</option>
                                <option value="off">Oculto</option>
                            </select>
                        </div>
                    );
                })}
            </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2"><Settings size={20}/> Configuración General</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Comisión Global (%)</label>
                    <NumericInput 
                        value={systemConfig.globalFee} 
                        onChange={(val) => updateSystemConfig({ globalFee: val })} 
                        className="w-full border p-2 rounded-lg" 
                        suffix="%" 
                    />
                    <p className="text-xs text-slate-400 mt-1">Fee base aplicado a todas las conversiones.</p>
                </div>
                
                <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Límite de Volumen (Risk)</label>
                    <NumericInput 
                        value={systemConfig.volumeLimit} 
                        onChange={(val) => updateSystemConfig({ volumeLimit: val })} 
                        className="w-full border p-2 rounded-lg" 
                        prefix="$" 
                    />
                    <p className="text-xs text-slate-400 mt-1">Alerta si un usuario supera este monto.</p>
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <div>
                        <span className="font-bold text-slate-700 block">Modo Mantenimiento</span>
                        <span className="text-xs text-slate-500">Bloquea el acceso a usuarios no administradores.</span>
                    </div>
                    <button 
                        onClick={() => updateSystemConfig({ maintenanceMode: !systemConfig.maintenanceMode })}
                        className={`w-12 h-6 rounded-full p-1 transition-colors ${systemConfig.maintenanceMode ? 'bg-red-500' : 'bg-slate-300'}`}
                    >
                        <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${systemConfig.maintenanceMode ? 'translate-x-6' : ''}`}></div>
                    </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <div>
                        <span className="font-bold text-slate-700 block">Nuevos Registros</span>
                        <span className="text-xs text-slate-500">Permitir que nuevos usuarios se registren.</span>
                    </div>
                    <button 
                        onClick={() => updateSystemConfig({ allowNewRegistrations: !systemConfig.allowNewRegistrations })}
                        className={`w-12 h-6 rounded-full p-1 transition-colors ${systemConfig.allowNewRegistrations ? 'bg-green-500' : 'bg-slate-300'}`}
                    >
                        <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${systemConfig.allowNewRegistrations ? 'translate-x-6' : ''}`}></div>
                    </button>
                </div>
            </div>
        </div>

        {/* reCAPTCHA */}
        <RecaptchaConfigBlock systemConfig={systemConfig} updateSystemConfig={updateSystemConfig} />

    </div>
);


const renderBanks = () => (
    <div className="space-y-6 animate-in fade-in duration-300">
        <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-slate-800">Configuración de Bancos</h2>
            <div className="flex gap-2 items-center">
                <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-600 animate-pulse"></div> Sistema Operativo</span>
                <span className="text-sm text-slate-400 font-medium">14/12/2025</span>
            </div>
        </div>

        <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-800">Cuentas Bancarias y Redes</h3>
            <div className="flex flex-col md:flex-row justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200">
                <div className="flex-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">SELECCIONAR PAÍS</p>
                    <div className="flex flex-wrap gap-2">
                        {BANK_COUNTRIES.map(country => (
                            <button 
                                key={country}
                                onClick={() => setSelectedBankCountry(country)}
                                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all border ${selectedBankCountry === country ? 'bg-[#0C0E0D] border-[#0C0E0D]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                            >
                                {country}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex items-end">
                    <button onClick={() => { setEditingBank(null); setBankForm({ id: '', name: '', type: 'bank', accountNumber: '', accountType: '', beneficiary: '', taxId: '', taxIdType: '', logoColor: 'bg-slate-100 text-slate-500', logoText: '', qrImageUrl: '' }); setShowBankModal(true); }} className="bg-[#0C0E0D] px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 h-10 shadow-lg hover:bg-[#161A17] transition-colors">
                        <Plus size={16}/> Agregar Cuenta
                    </button>
                </div>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(bankingOptions[selectedBankCountry] || []).map(bank => (
                <div key={bank.id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm relative group">
                    <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setEditingBank(bank); setBankForm(bank); setShowBankModal(true); }} className="text-slate-400 hover:text-[#0C0E0D] p-1"><Edit2 size={16}/></button>
                        <button onClick={() => { 
                            const newList = bankingOptions[selectedBankCountry].filter(b => b.id !== bank.id);
                            updateBankList(selectedBankCountry, newList);
                        }} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={16}/></button>
                    </div>

                    <div className="flex items-center gap-4 mb-6">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-sm ${bank.logoColor || 'bg-yellow-400 text-black'}`}>
                            {bank.logoText || bank.name.substring(0,2)}
                        </div>
                        <div>
                            <h4 className="font-bold text-slate-800 text-lg">{bank.name}</h4>
                            <span className="bg-slate-50 text-[#4ADE80] text-[10px] font-bold px-2 py-0.5 rounded uppercase">{bank.type === 'qr' ? 'CÓDIGO QR' : 'CUENTA BANCARIA'}</span>
                        </div>
                    </div>

                    <div className="flex justify-between items-end text-sm">
                        <div className="space-y-1">
                            <p className="text-slate-400">Cuenta / Key:</p>
                            <p className="text-slate-400">Tipo:</p>
                            <p className="text-slate-400">Beneficiario:</p>
                        </div>
                        <div className="space-y-1 text-right">
                            <p className="font-bold text-slate-700 font-mono">{bank.accountNumber}</p>
                            <p className="font-medium text-slate-600">{bank.accountType}</p>
                            <p className="font-medium text-slate-600">{bank.beneficiary}</p>
                        </div>
                    </div>
                </div>
            ))}
            
            <div 
                onClick={() => { setEditingBank(null); setBankForm({ id: '', name: '', type: 'bank', accountNumber: '', accountType: '', beneficiary: '', taxId: '', taxIdType: '', logoColor: 'bg-slate-100 text-slate-500', logoText: '', qrImageUrl: '' }); setShowBankModal(true); }}
                className="border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center p-8 text-slate-400 cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-all min-h-[200px]"
            >
                <Plus size={32} className="mb-2"/>
                <span className="font-bold text-sm">Agregar Nueva Cuenta</span>
            </div>
        </div>

        {/* Bank Modal - Specific Layout Requested */}
        {showBankModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
                <div className="bg-white rounded-xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                        <h3 className="font-bold text-xl text-slate-800">Editar Cuenta</h3>
                        <button onClick={() => setShowBankModal(false)}><X className="text-slate-400 hover:text-slate-600" /></button>
                    </div>
                    
                    <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">PAÍS</label>
                            <div className="w-full h-12 px-4 border border-slate-200 rounded-lg bg-slate-50 text-slate-600 flex items-center">
                                {selectedBankCountry}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">NOMBRE BANCO/RED</label>
                                <input type="text" value={bankForm.name} onChange={(e) => setBankForm({...bankForm, name: e.target.value})} className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-[#0C0E0D] outline-none" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">TIPO</label>
                                <select value={bankForm.type} onChange={(e) => setBankForm({...bankForm, type: e.target.value as any})} className="w-full h-11 px-3 border border-slate-300 rounded-lg bg-white focus:border-[#0C0E0D] outline-none">
                                    <option value="bank">Cuenta Bancaria</option>
                                    <option value="qr">Código QR</option>
                                    <option value="crypto">Crypto Wallet</option>
                                </select>
                            </div>
                        </div>

                        {/* QR Image Area - Recreated as requested */}
                        {bankForm.type === 'qr' && (
                            <div className="border-2 border-dashed border-slate-200 bg-slate-50/30 rounded-xl p-4 text-center">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2 text-left">IMAGEN DEL CÓDIGO QR</label>
                                <div className="flex items-center gap-4">
                                    <div className="w-20 h-20 bg-white border border-slate-200 rounded-lg flex items-center justify-center overflow-hidden">
                                        {bankForm.qrImageUrl ? (
                                            <img src={bankForm.qrImageUrl} alt="QR" className="w-full h-full object-cover" />
                                        ) : (
                                            <QrCode size={32} className="text-slate-300" />
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <label className="cursor-pointer bg-white border border-slate-300 hover:border-[#0C0E0D] text-slate-700 font-bold text-sm py-2 px-4 rounded-lg w-full flex items-center justify-center gap-2 transition-colors">
                                            <UploadCloud size={16}/> Subir Imagen
                                            <input type="file" className="hidden" accept="image/*" onChange={handleQrUpload}/>
                                        </label>
                                        <p className="text-[10px] text-slate-400 mt-2 text-left">Formatos aceptados: JPG, PNG</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{bankForm.type === 'qr' ? 'REFERENCIA/LINK DEL QR' : 'NÚMERO DE CUENTA'}</label>
                            <input 
                                type="text" 
                                value={bankForm.accountNumber} 
                                onChange={(e) => setBankForm({...bankForm, accountNumber: e.target.value})} 
                                className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-[#0C0E0D] outline-none" 
                                placeholder={bankForm.type === 'qr' ? "Opcional si subes imagen" : "000-000000-00"}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{bankForm.type === 'crypto' ? 'RED (NETWORK)' : 'TIPO CUENTA'}</label>
                                <input type="text" value={bankForm.accountType} onChange={(e) => setBankForm({...bankForm, accountType: e.target.value})} className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-[#0C0E0D] outline-none" placeholder="Ej: Ahorros / TRC20"/>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">BENEFICIARIO</label>
                                <input type="text" value={bankForm.beneficiary} onChange={(e) => setBankForm({...bankForm, beneficiary: e.target.value})} className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-[#0C0E0D] outline-none" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">TIPO ID</label>
                                <input type="text" value={bankForm.taxIdType} onChange={(e) => setBankForm({...bankForm, taxIdType: e.target.value})} className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-[#0C0E0D] outline-none" placeholder="NIT/RUT"/>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">NÚMERO ID</label>
                                <input type="text" value={bankForm.taxId} onChange={(e) => setBankForm({...bankForm, taxId: e.target.value})} className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-[#0C0E0D] outline-none" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">COLOR LOGO (TAILWIND)</label>
                                <input type="text" value={bankForm.logoColor} onChange={(e) => setBankForm({...bankForm, logoColor: e.target.value})} className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-[#0C0E0D] outline-none text-xs" placeholder="bg-yellow-400 text-black"/>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">TEXTO LOGO (2 LETRAS)</label>
                                <input type="text" value={bankForm.logoText} onChange={(e) => setBankForm({...bankForm, logoText: e.target.value})} className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-[#0C0E0D] outline-none" />
                            </div>
                        </div>

                        <button onClick={handleBankSave} className="w-full h-12 bg-[#0C0E0D] font-bold rounded-lg hover:bg-[#161A17] shadow-lg mt-4">
                            Guardar Cuenta
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
);

const renderRates = () => {
  const handleSaveRates = () => {
    // Persistence happens automatically via localStorage in ExchangeRateContext
    // This button just gives user confirmation feedback
    setRatesSaved(true);
    showToast('Tasas y fees guardados correctamente');
    setTimeout(() => setRatesSaved(false), 2500);
  };
  // Perfil sintético para el RatesPanel compartido (mismo componente del
  // admin de Personas): este admin entra con rol 'admin' de la app, que
  // equivale a super_admin del panel de tasas.
  const ratesProfile: AdminProfile = {
    id: currentUser?.id ?? 'admin',
    email: currentUser?.email ?? '',
    fullName: currentUser?.companyName || currentUser?.name || 'Admin',
    role: 'super_admin',
    assignedCurrency: null,
  };
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
        {/* Sistema de tasas UNIFICADO (el mismo del admin Personas):
            FastForex + fx_rate_snapshots en vivo + ventana nocturna +
            modo API/Manual por par + Tiers de comisión. Una sola fuente
            de verdad para apps y paneles. */}
        <RatesPanel profile={ratesProfile} />

    </div>
  );
};

// renderTeam() se eliminó: guardaba nombres en un JSON de configuración y no
// creaba ni restringía ningún acceso. Dejarla, aunque fuera sin usar, invitaba
// a que alguien la volviera a conectar creyendo que administraba permisos. El
// equipo de verdad está en AdminEquipo, contra admin_miembros.

const renderDesign = () => (
      <div className="space-y-8 animate-in fade-in duration-300 max-w-4xl">
          
          {/* Blue Palette Chooser */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <Palette size={20} className="text-[#4ADE80]"/> Paletas de Azules
              </h3>
              <p className="text-slate-500 text-sm mb-4">Elige entre 10 variaciones de azul para la identidad visual de Lincoin.</p>
              <button
                  onClick={() => setShowPaletteChooser(true)}
                  className="w-full py-3 rounded-xl font-bold text-white transition-all hover:opacity-90 flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg, #050A14, #4ADE80)' }}
              >
                  <Palette size={18}/> Ver las 10 paletas de azules
              </button>
          </div>

          {/* Quick Themes */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                  <Palette size={20} className="text-[#0C0E0D]"/> Temas Predefinidos (Temporadas)
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <button onClick={() => { setThemePreset('default'); showToast('Tema Default aplicado'); }} className="p-4 rounded-xl border border-slate-200 hover:border-[#0C0E0D] transition-all flex flex-col items-center gap-2 group bg-slate-50">
                      <div className="text-2xl">🔵</div>
                      <span className="font-bold text-xs text-slate-700">Default</span>
                  </button>
                  <button onClick={() => { setThemePreset('christmas'); showToast('Tema Navidad aplicado'); }} className="p-4 rounded-xl border border-slate-200 hover:border-red-600 transition-all flex flex-col items-center gap-2 group bg-red-50">
                      <div className="text-2xl">🎄</div>
                      <span className="font-bold text-xs text-red-700">Navidad</span>
                  </button>
                  <button onClick={() => { setThemePreset('halloween'); showToast('Tema Halloween aplicado'); }} className="p-4 rounded-xl border border-slate-200 hover:border-orange-500 transition-all flex flex-col items-center gap-2 group bg-orange-50">
                      <div className="text-2xl">🎃</div>
                      <span className="font-bold text-xs text-orange-600">Halloween</span>
                  </button>
                  <button onClick={() => { setThemePreset('autumn'); showToast('Tema Otoño aplicado'); }} className="p-4 rounded-xl border border-slate-200 hover:border-yellow-600 transition-all flex flex-col items-center gap-2 group bg-yellow-50">
                      <div className="text-2xl">🍂</div>
                      <span className="font-bold text-xs text-yellow-700">Otoño</span>
                  </button>
                  <button onClick={() => { setThemePreset('summer'); showToast('Tema Verano aplicado'); }} className="p-4 rounded-xl border border-slate-200 hover:border-green-400 transition-all flex flex-col items-center gap-2 group bg-slate-50">
                      <div className="text-2xl">☀️</div>
                      <span className="font-bold text-xs text-[#4ADE80]">Verano</span>
                  </button>
                  <button onClick={() => { setThemePreset('patrias'); showToast('Tema Fiestas Patrias aplicado'); }} className="p-4 rounded-xl border border-slate-200 hover:border-red-800 transition-all flex flex-col items-center gap-2 group bg-slate-100">
                      <FlagImg code="CL" className="w-8 h-6 object-cover rounded shadow-sm" />
                      <span className="font-bold text-xs text-slate-800">Fiestas Patrias</span>
                  </button>
                  <button onClick={() => { setThemePreset('dead'); showToast('Tema Día de Muertos aplicado'); }} className="p-4 rounded-xl border border-slate-200 hover:border-purple-600 transition-all flex flex-col items-center gap-2 group bg-purple-50">
                      <div className="text-2xl">💀</div>
                      <span className="font-bold text-xs text-purple-700">Día de Muertos</span>
                  </button>
                  <button onClick={() => { setThemePreset('spring'); showToast('Tema Primavera aplicado'); }} className="p-4 rounded-xl border border-slate-200 hover:border-green-500 transition-all flex flex-col items-center gap-2 group bg-green-50">
                      <div className="text-2xl">🌸</div>
                      <span className="font-bold text-xs text-green-700">Primavera</span>
                  </button>
              </div>
          </div>

          {/* Branding */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                  <Layout size={20} className="text-[#0C0E0D]"/> Personalización Manual
              </h3>
              
              <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Color Primario</label>
                          <div className="flex items-center gap-2">
                              <input 
                                  type="color" 
                                  value={systemConfig.themeColor} 
                                  onChange={(e) => updateSystemConfig({ themeColor: e.target.value })}
                                  className="w-10 h-10 rounded cursor-pointer border-0 p-0"
                              />
                              <input 
                                  type="text" 
                                  value={systemConfig.themeColor}
                                  onChange={(e) => updateSystemConfig({ themeColor: e.target.value })}
                                  className="border border-slate-300 rounded px-3 py-2 text-sm font-mono flex-1 uppercase"
                              />
                          </div>
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Color Acento</label>
                          <div className="flex items-center gap-2">
                              <input 
                                  type="color" 
                                  value={systemConfig.accentColor} 
                                  onChange={(e) => updateSystemConfig({ accentColor: e.target.value })}
                                  className="w-10 h-10 rounded cursor-pointer border-0 p-0"
                              />
                              <input 
                                  type="text" 
                                  value={systemConfig.accentColor}
                                  onChange={(e) => updateSystemConfig({ accentColor: e.target.value })}
                                  className="border border-slate-300 rounded px-3 py-2 text-sm font-mono flex-1 uppercase"
                              />
                          </div>
                      </div>
                  </div>

                  <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Cargar Logo</label>
                      <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:bg-slate-50 transition-colors relative cursor-pointer">
                          <input type="file" onChange={handleLogoUpload} accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" />
                          <div className="flex flex-col items-center">
                              <Cloud size={24} className="text-slate-400 mb-2"/>
                              <span className="text-sm font-bold text-[#0C0E0D]">Click para subir imagen</span>
                              <span className="text-xs text-slate-400 mt-1">PNG, SVG o JPG (Max 2MB)</span>
                          </div>
                      </div>
                      {systemConfig.logoUrl && (
                          <div className="mt-4 p-2 bg-slate-800 rounded flex justify-center">
                              <img src={systemConfig.logoUrl} alt="Logo Preview" className="h-10 object-contain" />
                          </div>
                      )}
                  </div>
              </div>
          </div>

          {/* Marketing Modal */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-center mb-6">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      <Gift size={20} className="text-[#0C0E0D]"/> Pop-up Promocional (Modal)
                  </h3>
                  <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-500 uppercase">{systemConfig.marketingModal?.isActive ? 'Activo' : 'Inactivo'}</span>
                      <button 
                          onClick={() => updateSystemConfig({ 
                              marketingModal: { ...systemConfig.marketingModal, isActive: !systemConfig.marketingModal.isActive } 
                          })} 
                          className={`w-12 h-6 rounded-full p-1 transition-colors ${systemConfig.marketingModal?.isActive ? 'bg-green-500' : 'bg-slate-300'}`}
                      >
                          <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${systemConfig.marketingModal?.isActive ? 'translate-x-6' : ''}`}></div>
                      </button>
                  </div>
              </div>

              <div className="space-y-4">
                  <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Cargar Imagen Promocional</label>
                      <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:bg-slate-50 transition-colors relative cursor-pointer">
                          <input type="file" onChange={handlePromoUpload} accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" />
                          <div className="flex flex-col items-center">
                              <ImageIcon size={24} className="text-slate-400 mb-2"/>
                              <span className="text-sm font-bold text-[#0C0E0D]">Subir Banner</span>
                          </div>
                      </div>
                  </div>
                  
                  <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Enlace de Destino</label>
                      <input 
                          type="text" 
                          value={systemConfig.marketingModal?.linkUrl || ''} 
                          onChange={(e) => updateSystemConfig({ marketingModal: { ...systemConfig.marketingModal, linkUrl: e.target.value } })}
                          className="border border-slate-300 rounded-lg px-4 py-2 w-full text-sm"
                          placeholder="#"
                      />
                  </div>

                  {systemConfig.marketingModal?.imageUrl && (
                      <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
                          <p className="text-xs font-bold text-slate-500 uppercase mb-2">Vista Previa:</p>
                          <img src={systemConfig.marketingModal.imageUrl} alt="Preview" className="max-w-xs h-auto rounded shadow-sm" />
                      </div>
                  )}
              </div>
          </div>
      </div>
  );

  const renderSecurity = (businessOtcOnly = false) => {
      const baseUsers = businessOtcOnly
        ? allUsers.filter((u: any) => (u.otcEnabled || u.raw_data?.otcEnabled))
        : allUsers;
      // Lo cargado que coincide, más lo que encontró el servidor en toda la
      // base (respetando el filtro de OTC).
      const filteredUsers = conLocales<User>(idsSeguridad, allUsers, baseUsers.filter(u =>
          (u.name ?? '').toLowerCase().includes(securitySearch.toLowerCase()) ||
          (u.email ?? '').toLowerCase().includes(securitySearch.toLowerCase()) ||
          u.id.includes(securitySearch)
      )).filter((u: any) => !businessOtcOnly || u.otcEnabled || u.raw_data?.otcEnabled);

      const userTransactions = selectedSecurityUser ? historyTransactions.filter(tx => tx.userId === selectedSecurityUser.id).sort((a,b) => b.id - a.id) : [];

      return (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Centro de Seguridad: el tablero. Todo lo que muestra sale de
              datos reales — un tablero con cifras de ejemplo da confianza
              sobre algo que nadie verificó. */}
          {currentUser?.id && <AdminSecurityCenter userId={currentUser.id} />}

          {/* Los editores completos van PLEGADOS. El tablero de arriba ya
              muestra el acceso y las llaves; dejarlos también sueltos acá
              hacía que la misma información apareciera dos veces y no
              quedara claro cuál manda. Se abren cuando hay que configurar a
              fondo — quitar un país, borrar una llave, probar el aviso—,
              que no es lo de todos los días. */}
          <details style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16 }}>
            <summary style={{ cursor: 'pointer', listStyle: 'none', padding: '14px 18px', fontFamily: 'Archivo, system-ui, sans-serif', fontWeight: 800, fontSize: 14, color: '#F4F4F2', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span>Configuración avanzada</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(244,244,242,0.45)' }}>
                acceso · llaves · aviso de ingreso · 2FA
              </span>
            </summary>
            <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <AdminAccessPolicy userId={currentUser?.id} />
              {currentUser?.id && <AdminPasskeys userId={currentUser.id} />}
              {currentUser?.id && <AdminLoginAlerts userId={currentUser.id} />}

          {/* Tu propio 2FA — protege el cambio de proveedor de tesorería */}
          <div className={`rounded-xl border p-4 ${adminMfaOn ? 'border-green-200 bg-green-50/50' : 'border-amber-300 bg-amber-50/60'}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="font-bold text-slate-800 flex items-center gap-2"><Shield size={16} className={adminMfaOn ? 'text-green-600' : 'text-amber-600'} /> Tu verificación en dos pasos (2FA)</p>
                <p className="text-xs text-slate-500 mt-0.5">{adminMfaOn ? 'Activo. El cambio de dirección de un proveedor exige tu código — nadie puede desviar el dinero sin él.' : 'NO está activo. Sin 2FA, el sistema BLOQUEA cambiar la dirección de un proveedor (protección). Actívalo para poder gestionarlos y para blindar tu cuenta.'}</p>
              </div>
              <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${adminMfaOn ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{adminMfaOn ? '✅ Activo' : '⚠ Inactivo'}</span>
            </div>
            {!adminMfaOn && !mfaEnroll && (
              <button onClick={startMfaEnroll} disabled={mfaBusy} className="mt-3 px-4 py-2 text-sm font-bold rounded-lg bg-[#0C0E0D] text-white hover:bg-[#161A17] disabled:opacity-60">{mfaBusy ? 'Generando…' : 'Activar 2FA ahora'}</button>
            )}
            {mfaEnroll && (
              <div className="mt-3 grid md:grid-cols-2 gap-4 items-start">
                <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
                  <p className="text-xs text-slate-500 mb-2">1. Escanea este QR con Google Authenticator / Authy</p>
                  {mfaEnroll.qrCode ? <img src={mfaEnroll.qrCode} alt="QR 2FA" className="w-44 h-44 mx-auto" /> : <p className="text-xs text-slate-400">QR no disponible — usa la clave de abajo.</p>}
                  <p className="text-[11px] text-slate-500 mt-2">o ingresa esta clave a mano:</p>
                  <p className="text-[11px] font-mono break-all text-slate-700 bg-slate-50 rounded p-1.5 mt-1">{mfaEnroll.secret}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-2">2. Escribe el código de 6 dígitos que muestra la app</p>
                  <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(e) => { if (e.key === 'Enter') confirmMfaEnroll(); }} placeholder="123 456" inputMode="numeric" className="w-full px-3 py-3 rounded-lg border border-slate-300 outline-none focus:border-[#0C0E0D] font-mono text-lg tracking-widest text-center" />
                  <div className="flex gap-2 mt-2">
                    <button onClick={confirmMfaEnroll} disabled={mfaBusy || mfaCode.length !== 6} className="px-4 py-2 text-sm font-bold rounded-lg bg-[#4ADE80] text-[#0C0E0D] hover:bg-[#26bda9] disabled:opacity-60">{mfaBusy ? 'Verificando…' : 'Confirmar y activar'}</button>
                    <button onClick={() => { setMfaEnroll(null); setMfaCode(''); setMfaMsg(null); }} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                  </div>
                </div>
              </div>
            )}
            {mfaMsg && <p className={`mt-2 text-xs font-semibold ${mfaMsg.startsWith('✅') ? 'text-green-700' : 'text-red-700'}`}>{mfaMsg}</p>}

            {/* Salud del 2FA de TODAS las cuentas (clientes incluidos). */}
            <div className="mt-3">
              <button onClick={runMfaHealth} disabled={mfaHealthBusy}
                      className="px-3 py-2 text-xs font-bold rounded-lg disabled:opacity-60"
                      style={{ backgroundColor: '#121413', color: '#F4F4F2', border: '1px solid rgba(255,255,255,0.12)' }}>
                {mfaHealthBusy ? 'Revisando…' : '🩺 Revisar salud del 2FA de todas las cuentas'}
              </button>
              {mfaHealth && (
                <div className="mt-2 rounded-xl p-3" style={{ backgroundColor: '#121413', border: '1px solid rgba(255,255,255,0.10)' }}>
                  {mfaHealth.error ? (
                    <p className="text-xs" style={{ color: '#F87171' }}>{String(mfaHealth.error)}</p>
                  ) : (
                    <>
                      <p className="text-sm font-bold" style={{ color: mfaHealth.unreadable > 0 ? '#F87171' : '#4ADE80' }}>
                        {mfaHealth.unreadable > 0
                          ? `⚠ ${mfaHealth.unreadable} de ${mfaHealth.total} cuentas con 2FA no pueden entrar`
                          : `✅ Las ${mfaHealth.total} cuentas con 2FA están sanas`}
                      </p>
                      <p className="text-xs mt-1" style={{ color: '#878E88' }}>
                        Cifradas con otra llave: <b style={{ color: '#F4F4F2' }}>{mfaHealth.keyMismatch ?? 0}</b> ·
                        {' '}Sin códigos de respaldo: <b style={{ color: '#F4F4F2' }}>{mfaHealth.noBackup ?? 0}</b> ·
                        {' '}En texto plano (legacy): <b style={{ color: '#F4F4F2' }}>{mfaHealth.legacyPlain ?? 0}</b>
                      </p>
                      {Array.isArray(mfaHealth.affected) && mfaHealth.affected.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {mfaHealth.affected.map((a: any) => (
                            <li key={a.email} className="text-xs font-mono" style={{ color: '#FBBF24' }}>{a.email} — {a.motivo}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Códigos de respaldo — se muestran UNA sola vez, al activar. */}
            {mfaBackupCodes && (
              <div className="mt-3 rounded-xl p-4" style={{ backgroundColor: '#121413', border: '1px solid rgba(74,222,128,0.25)' }}>
                <p className="text-sm font-bold" style={{ color: '#F4F4F2' }}>Guarda estos códigos de respaldo</p>
                <p className="text-xs mt-1" style={{ color: '#878E88' }}>
                  Cada uno sirve <b style={{ color: '#F4F4F2' }}>una vez</b> para entrar si pierdes el teléfono o el 2FA deja de
                  validar. Es la única vía que no depende de la app ni de la Bóveda.
                  <b style={{ color: '#FBBF24' }}> No se vuelven a mostrar.</b>
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                  {mfaBackupCodes.map(c => (
                    <span key={c} className="font-mono text-sm text-center rounded-lg py-2"
                          style={{ color: '#F4F4F2', backgroundColor: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)', letterSpacing: '1px' }}>{c}</span>
                  ))}
                </div>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <button onClick={() => { navigator.clipboard?.writeText(mfaBackupCodes.join('\n')); }}
                          className="px-3 py-2 text-xs font-bold rounded-lg"
                          style={{ backgroundColor: '#4ADE80', color: '#0C0E0D' }}>Copiar los 8</button>
                  <button onClick={() => setMfaBackupCodes(null)}
                          className="px-3 py-2 text-xs font-bold rounded-lg"
                          style={{ backgroundColor: 'transparent', color: '#878E88', border: '1px solid rgba(255,255,255,0.12)' }}>Ya los guardé</button>
                </div>
              </div>
            )}
          </div>
            </div>
          </details>

          <div className="flex h-[calc(100vh-260px)]">
              {/* Left Panel: User List */}
              <div className="w-1/3 bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden">
                  <div className="p-4 border-b border-slate-100 bg-slate-50">
                      <div className="relative">
                          <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                          <input 
                              type="text" 
                              placeholder="Buscar usuario..." 
                              value={securitySearch}
                              onChange={(e) => setSecuritySearch(e.target.value)}
                              className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:border-[#0C0E0D] outline-none"
                          />
                      </div>
                  </div>
                  <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                      {filteredUsers.map(user => (
                          <div 
                              key={user.id} 
                              onClick={() => { setSelectedSecurityUser(user); setRevealPassword(false); }}
                              className={`p-4 cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between ${selectedSecurityUser?.id === user.id ? 'bg-slate-50 border-l-4 border-[#0C0E0D]' : ''}`}
                          >
                              <div className="flex items-center gap-3">
                                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${user.isBlocked ? 'bg-red-100 text-red-600' : 'bg-slate-200 text-slate-600'}`}>
                                      {user?.name?.charAt(0) ?? "?"}
                                  </div>
                                  <div>
                                      <p className="font-bold text-slate-800 text-sm truncate max-w-[150px]">{user.name}</p>
                                      <p className="text-xs text-slate-500 truncate max-w-[150px]">{user.email}</p>
                                  </div>
                              </div>
                              {user.isBlocked && <Lock size={16} className="text-red-500" />}
                          </div>
                      ))}
                  </div>
              </div>

              {/* Right Panel: Details */}
              <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                  {selectedSecurityUser ? (
                      <>
                          {/* Header */}
                          <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50">
                              <div className="flex items-center gap-4">
                                  <div className="w-16 h-16 bg-[#0C0E0D] text-white rounded-full flex items-center justify-center text-2xl font-bold">
                                      {selectedSecurityUser?.name?.charAt(0) ?? "?"}
                                  </div>
                                  <div>
                                      <h2 className="text-xl font-bold text-slate-800">{selectedSecurityUser.name}</h2>
                                      <div className="flex items-center gap-2 mt-1">
                                          <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-xs font-bold uppercase">{selectedSecurityUser.role}</span>
                                          <span className="text-slate-400 text-xs font-mono">ID: {selectedSecurityUser.id}</span>
                                      </div>
                                  </div>
                              </div>
                              <button 
                                  onClick={handleSecurityBlockUser}
                                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-colors ${selectedSecurityUser.isBlocked ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                              >
                                  {selectedSecurityUser.isBlocked ? <><Unlock size={16}/> Desbloquear</> : <><Ban size={16}/> Bloquear Acceso</>}
                              </button>
                          </div>

                          <div className="flex-1 overflow-y-auto p-6 space-y-8">
                              
                              {/* Credentials Section */}
                              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                                  <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                      <Shield size={18} className="text-[#0C0E0D]"/> Credenciales de Acceso
                                  </h3>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                      <div>
                                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Correo Electrónico (Login)</label>
                                          <div className="w-full p-3 bg-slate-100 rounded-lg text-slate-700 font-medium text-sm flex justify-between items-center">
                                              {selectedSecurityUser.email}
                                              <Copy size={14} className="text-slate-400 cursor-pointer hover:text-[#0C0E0D]" onClick={() => navigator.clipboard.writeText(selectedSecurityUser.email)}/>
                                          </div>
                                      </div>
                                      <div>
                                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Contraseña Actual</label>
                                          <div className="relative">
                                              <div className="w-full p-3 bg-slate-100 rounded-lg text-slate-700 font-medium text-sm flex justify-between items-center border border-slate-200">
                                                  <span className={revealPassword ? '' : 'font-mono tracking-widest'}>
                                                      {revealPassword ? (selectedSecurityUser.password || 'Sin clave') : '••••••••••••'}
                                                  </span>
                                                  <button onClick={() => setRevealPassword(!revealPassword)} className="text-slate-400 hover:text-[#0C0E0D]">
                                                      {revealPassword ? <EyeOff size={16}/> : <Eye size={16}/>}
                                                  </button>
                                              </div>
                                          </div>
                                          <p className="text-[10px] text-red-500 mt-1 flex items-center gap-1">
                                              <AlertTriangle size={10}/> Solo visible para administradores. No compartir.
                                          </p>
                                      </div>
                                  </div>
                              </div>

                              {/* Access Log Simulation */}
                              <div>
                                  <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                      <Smartphone size={18} className="text-slate-400"/> Historial de Dispositivos (Simulado)
                                  </h3>
                                  <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
                                      <div className="flex justify-between items-center text-sm border-b border-slate-200 pb-2">
                                          <div className="flex items-center gap-3">
                                              <div className="bg-green-100 p-1.5 rounded text-green-700"><CheckCircle size={14}/></div>
                                              <div>
                                                  <p className="font-bold text-slate-700">Chrome en Windows</p>
                                                  <p className="text-xs text-slate-500">Bogotá, Colombia • 192.168.1.10</p>
                                              </div>
                                          </div>
                                          <span className="text-xs text-slate-500">Hace 2 horas</span>
                                      </div>
                                      <div className="flex justify-between items-center text-sm">
                                          <div className="flex items-center gap-3">
                                              <div className="bg-slate-200 p-1.5 rounded text-slate-500"><Lock size={14}/></div>
                                              <div>
                                                  <p className="font-bold text-slate-700">Safari en iPhone 14</p>
                                                  <p className="text-xs text-slate-500">Medellín, Colombia • 10.0.0.5</p>
                                              </div>
                                          </div>
                                          <span className="text-xs text-slate-500">Ayer, 14:30 PM</span>
                                      </div>
                                  </div>
                              </div>

                              {/* Transaction Audit */}
                              <div>
                                  <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                      <FileText size={18} className="text-slate-400"/> Auditoría de Transacciones
                                  </h3>
                                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                                      <table className="w-full text-left text-sm">
                                          <thead className="bg-slate-100 text-slate-500 font-bold uppercase text-xs">
                                              <tr>
                                                  <th className="px-4 py-3">ID</th>
                                                  <th className="px-4 py-3">Tipo</th>
                                                  <th className="px-4 py-3 text-right">Monto</th>
                                                  <th className="px-4 py-3">Fecha</th>
                                                  <th className="px-4 py-3 text-center">Estado</th>
                                              </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100">
                                              {userTransactions.map(tx => (
                                                  <tr key={tx.id} className="hover:bg-slate-50">
                                                      <td className="px-4 py-3 font-mono text-xs">{tx.id}</td>
                                                      <td className="px-4 py-3 font-medium">{tx.title}</td>
                                                      <td className="px-4 py-3 text-right font-mono">{formatMoney(tx.amount, tx.currency)}</td>
                                                      <td className="px-4 py-3 text-slate-500 text-xs">{tx.date}</td>
                                                      <td className="px-4 py-3 text-center">
                                                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${tx.status === 'Completado' ? 'bg-green-100 text-green-700' : tx.status === 'Rechazado' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                                                              {tx.status}
                                                          </span>
                                                      </td>
                                                  </tr>
                                              ))}
                                              {userTransactions.length === 0 && (
                                                  <tr><td colSpan={5} className="p-4 text-center text-slate-400 text-xs">Sin registros</td></tr>
                                              )}
                                          </tbody>
                                      </table>
                                  </div>
                              </div>

                          </div>
                      </>
                  ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
                          <Shield size={64} className="mb-4 opacity-50"/>
                          <p className="text-lg font-medium text-slate-400">Selecciona un usuario para auditar</p>
                      </div>
                  )}
              </div>
          </div>
        </div>
      );
  };

  const renderFallos = () => {
    const railLabel = (cur: string): string => {
      const c = String(cur ?? '');
      if (c === 'COP_BREB') return 'Bre-B';
      if (c === 'COP_ACH') return 'ACH';
      if (c === 'COP') return 'Saldo Lincoin';
      if (c.startsWith('USD')) return 'USDT';
      return c || '—';
    };
    // El error del proveedor llega como objeto {step, httpStatus, path, body}.
    // Mostrarlo como un JSON pegado y cortado obligaba a adivinar; se desglosa
    // en QUÉ paso falló, con qué código HTTP y qué respondió el proveedor —
    // que es lo único que permite distinguir "dato mal mapeado" de "el
    // proveedor rechazó la operación".
    const errParts = (t: any): { paso?: string; http?: string; cuerpo?: string; texto: string } => {
      const raw = t.error ?? t.raw_data?.error;
      let obj: any = raw;
      if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { obj = null; } }
      const em = t.errorMessage ?? t.raw_data?.errorMessage;
      if (!obj && em) { try { obj = JSON.parse(String(em)); } catch { /* texto plano */ } }
      const PASOS: Record<string, string> = { destino: 'Registrar la cuenta destino', retiro: 'Crear la orden de retiro' };
      if (obj && typeof obj === 'object') {
        let cuerpo = '';
        try { cuerpo = obj.body ? JSON.stringify(obj.body, null, 1) : ''; } catch { cuerpo = String(obj.body ?? ''); }
        return {
          paso: obj.step ? (PASOS[String(obj.step)] ?? String(obj.step)) : undefined,
          http: obj.httpStatus ? `HTTP ${obj.httpStatus}` : undefined,
          cuerpo: cuerpo || undefined,
          texto: em ? String(em) : JSON.stringify(obj),
        };
      }
      const http = t.httpStatus ?? t.raw_data?.httpStatus;
      return { http: http ? `HTTP ${http}` : undefined, texto: em ? String(em) : 'Sin detalle técnico' };
    };
    const errText = (t: any): string => errParts(t).texto;
    const emailOf = (t: any): string => allUsers.find((u: any) => u.id === t.userId)?.email ?? t.userName ?? t.raw_data?.userName ?? t.userId ?? '—';
    // new Date(undefined) no lanza: devuelve una fecha inválida y toLocaleString
    // imprime "Invalid Date". El try/catch no atrapaba nada. Se comprueba el
    // valor, y se aceptan las dos formas en que llega la fecha.
    const fmtDate = (d: any) => {
      const t = new Date(d ?? '');
      if (!d || Number.isNaN(t.getTime())) return '—';
      return t.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    };
    const fechaDe = (t: any) => t?.createdAt ?? t?.created_at ?? t?.raw_data?.requestedAt ?? t?.requestedAt ?? null;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><AlertTriangle size={18} className="text-red-500" /> Fallos de operaciones</h2>
            <p className="text-sm text-slate-500">Operaciones que necesitan una decisión: las que quedaron sin confirmar con el proveedor, y las que fallaron o fueron rechazadas con su error técnico real. Al cliente solo se le muestra un mensaje amable.</p>
          </div>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-red-50 text-red-700 border border-red-200">{failuresCount} {failuresCount === 1 ? 'caso' : 'casos'}</span>
        </div>

        {/* PENDIENTES DE VERIFICAR — no son fallos.
            En un fallo la plata ya volvió al cliente y el caso está cerrado.
            Acá la plata salió de la cuenta y no sabemos si llegó, porque el
            proveedor no expone un estado consultable. La mayoría habrá salido
            bien; hay que cotejarlas contra su consola.

            Va en la paleta de la app —negro, bordes translúcidos, ámbar solo
            como acento fino— y no en un bloque crema: un panel de color claro
            metido en una pantalla oscura se lee como un error de maquetación,
            no como una advertencia. */}
        {sinConfirmarList.length > 0 && (
          <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center" style={{ gap: 9 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FBBF24', flexShrink: 0 }} />
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#F4F4F2', margin: 0 }}>
                  Pendientes de verificar con el proveedor
                </h3>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#878E88', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '2px 8px' }}>
                  {sinConfirmarList.length}
                </span>
              </div>
              <p style={{ fontSize: 12.5, color: '#878E88', margin: '8px 0 0', lineHeight: 1.6, maxWidth: 720 }}>
                Estos envíos siguen sin un estado confirmado por el proveedor. Probá primero{' '}
                <span style={{ color: '#F4F4F2' }}>Conciliar ahora</span>: consulta el estado real de cada uno
                y cierra solo los que Mouv confirma, reembolsando los devueltos. Lo que quede acá después
                de eso es lo que hay que cotejar a mano en su consola por la referencia.
              </p>
              <button
                onClick={conciliarBreb}
                disabled={conciliando}
                style={{
                  marginTop: 12, fontSize: 12.5, fontWeight: 700, color: '#0A0A0A', background: '#4ADE80',
                  border: 'none', borderRadius: 9, padding: '9px 15px', cursor: conciliando ? 'default' : 'pointer',
                  opacity: conciliando ? 0.5 : 1,
                }}>
                {conciliando ? 'Consultando al proveedor…' : 'Conciliar ahora con el proveedor'}
              </button>
            </div>

            {sinConfirmarList.map((t: any) => (
              <div key={t.id} className="flex items-start justify-between flex-wrap"
                style={{ gap: 14, padding: '14px 18px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ minWidth: 0, flex: '1 1 300px' }}>
                  <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: '#F4F4F2' }}>
                      {Number(t.amount).toLocaleString('es-CO')}
                      <span style={{ fontSize: 11.5, color: '#878E88', fontWeight: 600 }}> {String(t.currency ?? '').split('_')[0]}</span>
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#878E88', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '2px 8px' }}>
                      {railLabel(t.currency)}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'rgba(244,244,242,0.45)' }}>{fmtDate(fechaDe(t))}</span>
                  </div>
                  <p style={{ fontSize: 12.5, color: '#878E88', margin: '6px 0 0' }}>
                    {t.beneficiary ?? '—'}{t.account ? ` · ${t.account}` : ''}
                  </p>
                  <p style={{ fontSize: 11.5, color: 'rgba(244,244,242,0.45)', margin: '3px 0 0' }}>
                    {emailOf(t)}
                    {(t.providerRef ?? t.raw_data?.providerRef) && (
                      <> · <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{t.providerRef ?? t.raw_data?.providerRef}</span></>
                    )}
                  </p>
                </div>
                {/* Confirmar primero: es el desenlace de la mayoría. Poner
                    "Reembolsar" como acción principal en diez filas donde nueve
                    salieron bien invita a devolver plata que sí se pagó. */}
                <div className="flex items-center" style={{ gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => confirmarDispersion(t)}
                    disabled={resolviendo === t.id}
                    style={{ fontSize: 12.5, fontWeight: 700, color: '#0A0A0A', background: '#F4F4F2', border: 'none', borderRadius: 9, padding: '9px 15px', cursor: 'pointer', opacity: resolviendo === t.id ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                    {resolviendo === t.id ? 'Procesando…' : 'Sí se pagó'}
                  </button>
                  <button
                    onClick={() => vincularRef(t)}
                    disabled={resolviendo === t.id}
                    title="Pegar el ID que muestra la consola del proveedor"
                    style={{ fontSize: 12.5, fontWeight: 700, color: '#878E88', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, padding: '9px 13px', cursor: 'pointer', opacity: resolviendo === t.id ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                    Vincular ID
                  </button>
                  <button
                    onClick={() => devolverDispersion(t)}
                    disabled={resolviendo === t.id}
                    style={{ fontSize: 12.5, fontWeight: 700, color: '#F87171', background: 'transparent', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 9, padding: '9px 15px', cursor: 'pointer', opacity: resolviendo === t.id ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                    Reembolsar
                  </button>
                  <button
                    onClick={() => marcarReembolsada(t)}
                    disabled={resolviendo === t.id}
                    title="Ya le devolviste el saldo por fuera del sistema"
                    style={{ fontSize: 12.5, fontWeight: 700, color: '#878E88', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, padding: '9px 13px', cursor: 'pointer', opacity: resolviendo === t.id ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                    Ya la devolví
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {sinConfirmarList.length > 0 && failuresList.length > 0 && (
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.6px', color: '#878E88', margin: '26px 0 10px' }}>
            FALLOS Y RECHAZOS
          </p>
        )}
        {failuresList.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
            <p className="text-slate-700 font-semibold">Sin fallos recientes</p>
            <p className="text-slate-400 text-sm mt-1">Cuando una operación falle o sea rechazada, aparecerá aquí con su motivo técnico.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {failuresList.map((t: any) => (
              <div key={t.id} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{railLabel(t.currency)}</span>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">{String(t.status).toUpperCase()}</span>
                      <span className="text-xs text-slate-400">{fmtDate(fechaDe(t))}</span>
                    </div>
                    <p className="text-sm font-bold text-slate-800 mt-1.5">{Number(t.amount).toLocaleString('es-CO')} <span className="text-slate-400 font-medium">{String(t.currency ?? '').split('_')[0]}</span></p>
                    <p className="text-xs text-slate-500 mt-0.5">Cliente: <span className="font-semibold text-slate-700">{emailOf(t)}</span></p>
                    {(t.beneficiary || t.account) && (
                      <p className="text-xs text-slate-500">Beneficiario: <span className="font-semibold text-slate-700">{t.beneficiary ?? '—'}</span>{t.account ? ` · ${t.account}` : ''}</p>
                    )}
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(errText(t)).then(() => showToast('Error copiado')).catch(() => {}); }}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 shrink-0"
                  ><Copy size={13} /> Copiar</button>
                </div>
                {(() => {
                  const p = errParts(t);
                  return (
                    <div className="mt-2.5 rounded-lg p-3 overflow-x-auto" style={{ backgroundColor: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)' }}>
                      {(p.paso || p.http) && (
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          {p.paso && <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(251,191,36,0.14)', color: '#FBBF24' }}>Falló al: {p.paso}</span>}
                          {p.http && <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(248,113,113,0.14)', color: '#F87171' }}>{p.http}</span>}
                        </div>
                      )}
                      <code className="text-[11px] leading-relaxed whitespace-pre-wrap break-words" style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: '#F4F4F2' }}>
                        {p.cuerpo ?? p.texto}
                      </code>
                      {p.cuerpo && (
                        <p className="text-[10px] mt-2 mb-0" style={{ color: '#878E88' }}>
                          Respuesta literal del proveedor. Si el paso es «Registrar la cuenta destino», el rechazo es por los datos del beneficiario, no por el monto ni por la bolsa.
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderAuditoria = () => {
    const fmtDate = (d: any) => { try { return new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };
    const actionLabel = (a: string): string => {
      const s = String(a ?? '');
      if (s === 'gasfree.set_providers') return 'Cambió la dirección de un proveedor de tesorería';
      if (s === 'gasfree.set_treasury_config') return 'Modificó la configuración de tesorería';
      return s || 'Acción';
    };
    const actorOf = (row: any): string => row?.metadata?.byEmail ?? row?.metadata?.byId ?? row?.user_id ?? 'Desconocido';
    const whenOf = (row: any): any => row?.metadata?.at ?? row?.created_at ?? row?.createdAt;
    const isProviderChange = (row: any) => String(row?.action) === 'gasfree.set_providers';
    const providerDiff = (row: any) => {
      const before: any[] = Array.isArray(row?.metadata?.before) ? row.metadata.before : [];
      const after: any[] = Array.isArray(row?.metadata?.after) ? row.metadata.after : [];
      const ids = Array.from(new Set([...before.map((p) => p.id), ...after.map((p) => p.id)]));
      return ids.map((id) => {
        const b = before.find((p) => p.id === id);
        const a = after.find((p) => p.id === id);
        return { id, name: a?.name ?? b?.name ?? id, from: b?.detail ?? '—', to: a?.detail ?? '—', changed: (b?.detail ?? '') !== (a?.detail ?? '') };
      });
    };
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Shield size={18} className="text-slate-500" /> Auditoría</h2>
            <p className="text-sm text-slate-500">Registro de cambios sensibles: quién cambió la dirección de un proveedor de tesorería y cuándo. Solo cubre cambios <span className="font-semibold">a partir de ahora</span>; los cambios anteriores a esta función no quedaron registrados.</p>
          </div>
          <button onClick={() => { loadAudit(); loadAdminLogins(); }} disabled={auditLoading} className="text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-1.5 disabled:opacity-50">{auditLoading ? 'Cargando…' : 'Actualizar'}</button>
        </div>

        {/* Ingresos de admin — última vez de ingreso + actividad con IP */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="font-bold text-slate-800 flex items-center gap-2 mb-2"><Shield size={16} className="text-slate-500" /> Ingresos de administrador</p>
          {!adminLogins ? (
            <p className="text-sm text-slate-400">Cargando…</p>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {(adminLogins.admins ?? []).map((a: any) => (
                  <div key={a.id} className="rounded-lg border border-slate-200 p-3">
                    <p className="font-bold text-slate-800 text-sm break-all">{a.email}</p>
                    <p className="text-xs text-slate-600 mt-1">Último ingreso: <span className="font-semibold">{a.last_sign_in_at ? new Date(a.last_sign_in_at).toLocaleString('es-CO') : '—'}</span></p>
                    <p className="text-[11px] text-slate-400">Cuenta creada: {a.created_at ? new Date(a.created_at).toLocaleString('es-CO') : '—'}</p>
                  </div>
                ))}
                {(adminLogins.admins ?? []).length === 0 && <p className="text-xs text-slate-400">No se pudo leer la fecha del último ingreso.</p>}
              </div>
              {(adminLogins.activity ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-600 mb-1.5">Actividad reciente con IP</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="text-slate-400 text-left"><th className="py-1 pr-3">Fecha</th><th className="py-1 pr-3">Acción</th><th className="py-1 pr-3">Correo</th><th className="py-1 pr-3">IP</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {(adminLogins.activity ?? []).slice(0, 30).map((ev: any, i: number) => (
                          <tr key={i} className={ev.hadSession === false ? 'bg-red-50' : ''}>
                            <td className="py-1 pr-3 text-slate-500 whitespace-nowrap">{ev.at ? new Date(ev.at).toLocaleString('es-CO') : '—'}</td>
                            <td className="py-1 pr-3 font-semibold text-slate-700">{ev.action === 'auth.admin_login' ? 'Ingreso' : ev.action}</td>
                            <td className="py-1 pr-3 text-slate-600 break-all">{ev.byEmail ?? (ev.hadSession === false ? '⚠ sin sesión' : '—')}</td>
                            <td className="py-1 pr-3 font-mono text-slate-700">{ev.ip ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-slate-400">"Último ingreso" es una fecha única del servidor de acceso. La actividad con IP se registra de aquí en adelante — los ingresos anteriores no quedaron con IP.</p>
            </div>
          )}
        </div>
        {auditLoading && auditRows === null ? (
          <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm">Cargando registro…</div>
        ) : (auditRows ?? []).length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
            <p className="text-slate-700 font-semibold">Sin registros de auditoría</p>
            <p className="text-slate-400 text-sm mt-1">Cuando alguien cambie la dirección de un proveedor u otra configuración de tesorería, aparecerá aquí con el correo y la fecha.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(auditRows ?? []).map((row: any, i: number) => (
              <div key={row.id ?? i} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isProviderChange(row) && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Cambio de proveedor</span>}
                      <span className="text-xs text-slate-400">{fmtDate(whenOf(row))}</span>
                    </div>
                    <p className="text-sm font-bold text-slate-800 mt-1.5">{actionLabel(row.action)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">Por: <span className="font-semibold text-slate-700">{actorOf(row)}</span></p>
                    {row?.metadata?.hadSession === false && (
                      <p className="text-[11px] font-bold text-red-600 mt-0.5">⚠ Sin sesión iniciada — posible AdminBypass (clave filtrada). La IP es la única huella.</p>
                    )}
                    {row?.metadata?.ip && (
                      <p className="text-[11px] text-slate-500 mt-0.5">IP: <span className="font-mono text-slate-700">{row.metadata.ip}</span>{row?.metadata?.origin ? ` · ${row.metadata.origin}` : ''}</p>
                    )}
                    {row?.metadata?.userAgent && (
                      <p className="text-[11px] text-slate-400 mt-0.5 break-all">Dispositivo: {String(row.metadata.userAgent).slice(0, 120)}</p>
                    )}
                  </div>
                </div>
                {isProviderChange(row) && (
                  <div className="mt-2.5 space-y-2">
                    {providerDiff(row).filter((d) => d.changed).length === 0 ? (
                      <p className="text-xs text-slate-400">Sin cambios de dirección detectados en este registro.</p>
                    ) : providerDiff(row).filter((d) => d.changed).map((d) => (
                      <div key={d.id} className="rounded-lg border border-slate-200 p-3 bg-slate-50">
                        <p className="text-xs font-bold text-slate-700 mb-1">{d.name}</p>
                        <div className="text-[11px] leading-relaxed break-all" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                          <p className="text-red-600">− {d.from}</p>
                          <p className="text-green-700">+ {d.to}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!isProviderChange(row) && row.metadata && (
                  <div className="mt-2.5 rounded-lg bg-slate-900 text-slate-100 p-3 overflow-x-auto">
                    <code className="text-[11px] leading-relaxed whitespace-pre-wrap break-words" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{(() => { try { return JSON.stringify(row.metadata, null, 2); } catch { return String(row.metadata); } })()}</code>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const closeSidebar = () => setIsSidebarOpen(false);
  const navTo = (tab: string) => { setActiveTab(tab as any); closeSidebar(); };
  // Cualquier salto a otra pestaña (un aviso, un botón "volver", la billetera
  // USDT) vuelve a la Billetera si el rol no la tiene. El servidor igual le
  // negaría los datos; esto evita que vea una pantalla vacía o con errores.
  useEffect(() => {
    if (soloTesoreria && !TABS_TESORERIA.includes(activeTab)) setActiveTab('cargues');
  }, [soloTesoreria, activeTab]);
  // El Dashboard/Monitoreo usan el tema oscuro Lincoin (AdminMonitor trae su
  // propio header); el resto de secciones mantienen su lienzo claro actual.
  const isDark = activeTab === 'overview' || activeTab === 'monitoreo' || activeTab === 'comando' || activeTab === 'security';

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900 flex">
        {/* Va ACÁ, fuera de renderFallos(): la conciliación automática corre cada
            3 min desde cualquier pestaña y puede REEMBOLSAR plata. Montado sólo
            dentro de Fallos, ese aviso no se veía nunca salvo que el operador
            estuviera justo en esa pestaña — o sea, casi nunca. Se devolvía
            dinero y en pantalla no pasaba nada. */}
        {resConciliar && <PanelConciliacion datos={resConciliar} onCerrar={() => setResConciliar(null)} />}
        {/* Correos que no están llegando. Va suelto y fijo arriba a la derecha
            porque el aviso tiene que verse desde CUALQUIER pestaña: quien no
            recibe el código no puede escribirnos para contarlo. */}
        <div className="fixed top-3 right-3 z-40 w-[min(26rem,calc(100vw-1.5rem))] space-y-2">
            {/* DATOS VIEJOS EN PANTALLA.
                El panel hidrata desde un caché del navegador para no quedarse
                en cero mientras la edge function arranca en frío. Si el
                refresco falla, ese puente se vuelve permanente -- y el panel
                mostraba "Procesando" en un envío que el cliente ya veía
                "Completado". Dos pantallas afirmando cosas distintas del mismo
                movimiento, sin que ninguna admitiera no saber. */}
            {syncError && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-2.5 shadow-sm">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                        <p className="text-sm font-bold text-amber-900">Estás viendo datos guardados</p>
                        <p className="text-xs text-amber-800 mt-0.5 leading-snug">
                            {syncError.motivo} Lo que ves es de las {new Date(syncError.at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} y
                            puede estar desactualizado — un movimiento puede figurar en otro estado del que tiene de verdad.
                        </p>
                        <button onClick={() => window.location.reload()}
                            className="text-xs font-bold text-amber-900 underline mt-1.5">
                            Reintentar
                        </button>
                    </div>
                </div>
            )}
            <AvisoCorreos />
        </div>
        {/* Mobile overlay — tap outside sidebar to close */}
        {isSidebarOpen && (
          <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={closeSidebar}/>
        )}
        {/* Sidebar */}
        <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-[#0C0E0D] text-white transition-transform duration-300 lg:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:static flex flex-col`}>
            <div className="h-20 flex items-center px-6 border-b border-white/10 justify-between">
                <Logo variant="white" />
                <button onClick={closeSidebar} className="lg:hidden text-white/40 hover:text-white p-1 rounded-lg">
                  <X size={20}/>
                </button>
            </div>
            <div className="flex-1 overflow-y-auto py-5 px-3 space-y-1">
                {/* Dashboard — fijo arriba, resaltado en verde. El rol Tesorería
                    no lo tiene: entra directo a la Billetera. */}
                {!soloTesoreria && <button
                    onClick={() => navTo('overview')}
                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl font-semibold text-sm transition-colors hover:bg-white/5"
                    style={activeTab === 'overview'
                        ? { background: 'rgba(74,222,128,0.16)', color: '#4ADE80', boxShadow: 'inset 0 0 0 1px rgba(74,222,128,0.35)' }
                        : { color: '#e2e8f0' }}
                >
                    <BarChart3 size={18} color={activeTab === 'overview' ? '#4ADE80' : '#e2e8f0'} /> Dashboard
                </button>}

                {(() => {
                    // Tesorería es un acordeón: Billetera primero (los cargues,
                    // lo que más se usa) y después el tablero de Tesorería.
                    const pendTes = pendingDeposits.length + pendingWithdrawals.length;
                    const grupoTesoreria = (
                        <AdminSidebarGrupo icon={Landmark} label="Tesorería"
                            active={activeTab === 'treasury' || activeTab === 'cargues' || activeTab === 'lincoin'}
                            badge={pendTes > 0 ? pendTes : undefined}
                            items={[
                                { key: 'cargues', icon: Wallet, label: 'Billetera', active: activeTab === 'cargues', onClick: () => navTo('cargues') },
                                { key: 'treasury', icon: BarChart3, label: 'Tesorería', active: activeTab === 'treasury', badge: pendTes > 0 ? pendTes : undefined, onClick: () => navTo('treasury') },
                                { key: 'lincoin', icon: Landmark, label: 'Lincoin', active: activeTab === 'lincoin', onClick: () => navTo('lincoin') },
                            ]} />
                    );
                    const groups: { key: string; title: string; items: React.ReactNode }[] = [
                        { key: 'operacion', title: 'Operación', items: <>
                            <AdminSidebarItem icon={Users} label="Clientes" active={activeTab === 'clients'} badge={pendingClientsCount > 0 ? pendingClientsCount : undefined} onClick={() => navTo('clients')} />
                            {grupoTesoreria}
                            <AdminSidebarItem icon={MessageSquare} label="Cierres OTC" active={activeTab === 'otcCierres'} badge={otcPend > 0 ? otcPend : undefined} onClick={() => navTo('otcCierres')} />
                            <AdminSidebarItem icon={Landmark} label="Gowd" active={activeTab === 'gowd'} onClick={() => navTo('gowd')} />
                            <AdminSidebarItem icon={AlertTriangle} label="Fallos" active={activeTab === 'fallos'} badge={failuresCount > 0 ? failuresCount : undefined} onClick={() => navTo('fallos')} />
                        </> },
                        { key: 'finanzas', title: 'Finanzas', items: <>
                            <AdminSidebarItem icon={FileText} label="Reportes" active={activeTab === 'reports'} onClick={() => navTo('reports')} />
                            <AdminSidebarItem icon={Building2} label="Bancos" active={activeTab === 'banks'} onClick={() => navTo('banks')} />
                            <AdminSidebarItem icon={TrendingUp} label="Tasas de Cambio" active={activeTab === 'rates'} onClick={() => navTo('rates')} />
                            <AdminSidebarItem icon={ArrowLeftRight} label="Contabilidad" active={activeTab === 'otcConfig'} onClick={() => navTo('otcConfig')} />
                        </> },
                        { key: 'sistema', title: 'Sistema', items: <>
                            {/* Seguridad y Cumplimiento son una entrada cada
                                una: adentro llevan sus pestañas. Antes eran
                                siete renglones sueltos. */}
                            <AdminSidebarItem icon={Shield} label="Seguridad" active={GRUPO_SEG.includes(activeTab)} onClick={() => navTo('security')} />
                            <AdminSidebarItem icon={ShieldAlert} label="Cumplimiento" active={GRUPO_CUMP.includes(activeTab)} badge={cuposPend + operadoresPend > 0 ? cuposPend + operadoresPend : undefined} onClick={() => navTo(operadoresPend > 0 ? 'operadores' : cuposPend > 0 ? 'cupos' : 'compliance')} />
                            <AdminSidebarItem icon={Megaphone} label="Marketing" active={activeTab === 'marketing'} onClick={() => navTo('marketing')} />
                            <AdminSidebarItem icon={Palette} label="Diseño" active={activeTab === 'design'} onClick={() => navTo('design')} />
                            <AdminSidebarItem icon={Settings} label="Configuración" active={activeTab === 'config'} onClick={() => navTo('config')} />
                        </> },
                    ];
                    // Rol Tesorería: solo Clientes y Tesorería. Lo demás ni
                    // se ofrece (el servidor igual se lo negaría).
                    const visibles = soloTesoreria
                        ? [{ key: 'operacion', title: 'Operación', items: <>
                            <AdminSidebarItem icon={Users} label="Clientes" active={activeTab === 'clients'} badge={pendingClientsCount > 0 ? pendingClientsCount : undefined} onClick={() => navTo('clients')} />
                            {grupoTesoreria}
                          </> }]
                        : groups;
                    // Los grupos ya no se pliegan: todo queda a la vista. El
                    // título es solo un rótulo y cada renglón muestra su aviso.
                    return visibles.map(g => (
                        <div key={g.key} className="pt-3">
                            <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{g.title}</p>
                            <div className="mt-1 space-y-1">{g.items}</div>
                        </div>
                    ));
                })()}
            </div>
            <div className="p-3 border-t border-white/10 space-y-2">
                <div className="flex items-center gap-2.5 px-2 py-2">
                    <div className="w-8 h-8 rounded-full bg-white/10 grid place-items-center text-xs font-bold text-white shrink-0">{(currentUser?.email ?? 'A').charAt(0).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-white truncate">{currentUser?.email ?? 'Administrador'}</p>
                        <p className="text-[10px] flex items-center gap-1.5" style={{ color: !isOnline ? '#F87171' : dataReady ? '#4ADE80' : '#FBBF24' }}>
                            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: !isOnline ? '#F87171' : dataReady ? '#4ADE80' : '#FBBF24' }} />
                            {!isOnline ? 'Sin conexión' : dataReady ? 'Conectado' : 'Conectando…'}
                        </p>
                    </div>
                </div>
                <button onClick={onLogout} className="flex items-center gap-3 w-full px-4 py-2.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors font-medium text-sm">
                    <LogOut size={18} /> Cerrar Sesión
                </button>
            </div>
        </aside>

        <main className={`flex-1 flex flex-col h-screen overflow-hidden ${isDark ? 'bg-[#070808]' : ''}`}>
            {isDark ? (
                <div className="lg:hidden flex items-center h-14 px-4 border-b border-white/10">
                    <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="text-white/70"><Menu size={24}/></button>
                </div>
            ) : (
            <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8">
                <div className="flex items-center gap-4">
                    <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="lg:hidden text-slate-500"><Menu size={24}/></button>
                    {/* El título salía del nombre INTERNO de la pestaña ('clients',
                        'treasury'…), por eso se leía en inglés en pantalla. */}
                    <h1 className="text-lg sm:text-xl font-bold text-slate-800 truncate">{TAB_TITLES[activeTab] ?? activeTab}</h1>
                </div>
                <div className="flex items-center gap-4">
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${!isOnline ? 'bg-red-50 text-red-700' : dataReady ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                        <div className={`w-2 h-2 rounded-full ${!isOnline ? 'bg-red-500' : dataReady ? 'bg-green-500 animate-pulse' : 'bg-amber-500 animate-pulse'}`}></div>
                        {!isOnline ? 'Modo Offline (Local)' : dataReady ? 'Sistema Online' : 'Conectando…'}
                    </div>
                </div>
            </header>
            )}

            <div className={`flex-1 overflow-y-auto ${isDark ? 'p-6' : 'p-8'}`}>
                {/* ── Pestañas de las dos secciones agrupadas ──────────────
                    La barra lateral tenía catorce entradas sueltas en Sistema
                    y cuatro de ellas eran la misma cosa —quién entra, qué hace
                    y quién puede— mientras TusDatos y Kumplo son las dos
                    mitades del mismo control. Se agrupan bajo Seguridad y
                    Cumplimiento, que es como se piensan.

                    Cada subpantalla CONSERVA su propia clave de vista, así que
                    los enlaces directos que alguien ya tenga guardados siguen
                    funcionando y entran con su pestaña marcada. */}
                {(GRUPO_SEG.includes(activeTab) || GRUPO_CUMP.includes(activeTab)) && (() => {
                    const tabs = GRUPO_SEG.includes(activeTab) ? GRUPO_SEG : GRUPO_CUMP;
                    return (
                        <div className="flex flex-wrap gap-1.5 mb-5">
                            {tabs.map(t => {
                                const on = activeTab === t;
                                return (
                                    <button key={t} onClick={() => navTo(t)}
                                        className="transition-colors"
                                        style={{
                                            fontSize: 12.5, fontWeight: on ? 700 : 600,
                                            padding: '7px 13px', borderRadius: 9,
                                            color: on ? '#F4F4F2' : '#878E88',
                                            background: on ? 'rgba(255,255,255,0.08)' : 'transparent',
                                            border: `1px solid ${on ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
                                        }}>
                                        {SUBTAB_TITLES[t] ?? TAB_TITLES[t] ?? t}
                                        {t === 'operadores' && operadoresPend > 0 && (
                                            <span style={{ marginLeft: 7, fontSize: 10.5, fontWeight: 800, color: '#070808', background: '#FBBF24', borderRadius: 999, padding: '1px 7px' }}>{operadoresPend}</span>
                                        )}
                                        {t === 'cupos' && cuposPend > 0 && (
                                            <span style={{ marginLeft: 7, fontSize: 10.5, fontWeight: 800, color: '#070808', background: '#FBBF24', borderRadius: 999, padding: '1px 7px' }}>{cuposPend}</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    );
                })()}
                {activeTab === 'overview' && <AdminMonitor />}
                {activeTab === 'monitoreo' && (
                  <div className="space-y-4">
                    {/* Cruza los envíos contra los movimientos que ve el
                        cliente. Va primero: si algo salió sin dejar registro,
                        es lo que hay que atender antes que nada. */}
                    <AdminReconcile />
                    <AdminMonitor />
                  </div>
                )}
                {activeTab === 'clients' && (
                  <div className="animate-in fade-in duration-300">
                    {/* La herramienta de correo huérfano vive acá y no dentro de
                        la vista de clientes: usa el estado del panel y duplicarla
                        seria tener dos copias de algo que borra cuentas. */}
                    {showOrphanTool && (
                      <div style={{ background: '#0C0E0D', border: '1px solid rgba(251,191,36,0.28)', borderRadius: 14, padding: '15px 17px', marginBottom: 16, fontFamily: 'Archivo, system-ui, sans-serif' }}>
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div style={{ maxWidth: 640 }}>
                            <p style={{ fontSize: 13.5, fontWeight: 700, color: '#FBBF24', margin: 0 }}>Liberar correo huérfano</p>
                            <p style={{ fontSize: 12, color: '#878E88', margin: '5px 0 0', lineHeight: 1.55 }}>
                              Para cuando alguien eliminó su cuenta y un registro nuevo con el <b style={{ color: '#F4F4F2' }}>mismo correo</b> nunca llega a crearse
                              — el perfil se borró pero la cuenta de acceso quedó atascada con ese correo. Borra cualquier rastro que quede, de forma permanente.
                            </p>
                          </div>
                          <button onClick={() => setShowOrphanTool(false)} style={{ background: 'transparent', border: 'none', color: '#878E88', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
                        </div>
                        <div className="flex gap-2 flex-wrap items-center" style={{ marginTop: 13 }}>
                          <input type="email" value={orphanEmail} onChange={e => setOrphanEmail(e.target.value)}
                            placeholder="correo@empresa.com"
                            style={{ flex: 1, minWidth: 220, height: 40, background: '#121413', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 9, padding: '0 13px', color: '#F4F4F2', fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
                          <button onClick={freeOrphanEmail} disabled={orphanBusy || !orphanEmail.trim()}
                            style={{ height: 40, padding: '0 16px', borderRadius: 9, background: 'transparent', border: '1px solid rgba(248,113,113,0.34)', color: '#F87171', fontSize: 12.5, fontWeight: 700, cursor: orphanBusy || !orphanEmail.trim() ? 'not-allowed' : 'pointer', opacity: orphanBusy || !orphanEmail.trim() ? 0.5 : 1, fontFamily: 'inherit' }}>
                            {orphanBusy ? 'Liberando…' : 'Liberar correo'}
                          </button>
                        </div>
                        {orphanMsg && <p style={{ fontSize: 12, color: '#878E88', margin: '9px 0 0' }}>{orphanMsg}</p>}
                      </div>
                    )}
                    <AdminClientes showToast={showToast} onSincronizarCripto={soloTesoreria ? undefined : handleSyncCrypto} onLiberarCorreo={() => setShowOrphanTool(v => !v)} sinBrasil={soloTesoreria} />
                  </div>
                )}
                {activeTab === 'marketing' && renderMarketing()}
                {activeTab === 'lincoin' && renderLincoin()}
                {activeTab === 'treasury' && (tesoreriaOk ? renderTreasury() : (
                  <div className="py-8">
                    <AdminStepUp
                      userId={currentUser?.id ?? ''}
                      motivo="Para entrar a Tesorería"
                      onListo={() => setTesoreriaOk(true)}
                    />
                  </div>
                ))}
                {activeTab === 'cargues' && renderCargues()}
                {activeTab === 'reports' && renderReports()}
                {activeTab === 'config' && renderConfig()}
                {activeTab === 'design' && renderDesign()}
                {activeTab === 'banks' && renderBanks()}
                {activeTab === 'rates' && renderRates()}
                {activeTab === 'team' && <AdminEquipo />}
                {activeTab === 'comando' && <div className="animate-in fade-in duration-300"><AdminCommandCenter /></div>}
                {activeTab === 'security' && renderSecurity()}
                {activeTab === 'tusdatos' && <div className="animate-in fade-in duration-300"><AdminTusdatos /></div>}
                {activeTab === 'compliance' && <div className="animate-in fade-in duration-300 space-y-6"><AdminCompliance /><AdminLimitesEnvio /></div>}
                {/* Normativa de cupo mensual por beneficiario: pestaña propia
                    dentro de Cumplimiento, para que las solicitudes de aumento
                    no queden al fondo de la bandeja de casos. */}
                {activeTab === 'cupos' && <div className="animate-in fade-in duration-300"><AdminCupos /></div>}
                {activeTab === 'operadores' && <div className="animate-in fade-in duration-300"><AdminOperadores onCambio={() => setOperadoresVer(v => v + 1)} /></div>}
                {activeTab === 'kumplo' && <div className="animate-in fade-in duration-300"><AdminKumplo /></div>}
                {activeTab === 'risk' && <div className="animate-in fade-in duration-300"><AdminLincoinRisk /></div>}
                {/* Sarblock: ventas de Lincoin Risk, historiales de todas las
                    empresas y la AML de beneficiarios. Trae su propio lienzo
                    oscuro, como el resto de Lincoin Risk. */}
                {(activeTab as string) === 'sarblock' && <div className="animate-in fade-in duration-300" style={{ background: '#070808', color: '#F4F4F2', borderRadius: 20, padding: '24px 20px', fontFamily: "'Archivo', system-ui, sans-serif" }}><AdminSarblock /></div>}
                {activeTab === 'gasfree' && (<>
                  {/* Igual que Cargues: se entra por Tesorería → Billeteras → USDT. */}
                  <button onClick={() => navTo('treasury')}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold mb-4"
                    style={{ backgroundColor: '#121413', color: '#F4F4F2', border: '1px solid rgba(255,255,255,0.12)' }}>
                    <ArrowLeft size={14} /> Tesorería · Billetera USDT
                  </button>
                  <AdminGasFreeSection />
                </>)}
                {activeTab === 'otcConfig' && <AdminContabilidad />}
                {activeTab === 'gowd' && <AdminGowd />}
                {activeTab === 'otcCierres' && <AdminOtcCierres />}
                {activeTab === 'fallos' && renderFallos()}
                {activeTab === 'auditoria' && renderAuditoria()}
            </div>
        </main>

        {/* Global Toasts */}
        {toastMessage && (
            <div className="fixed top-6 right-6 z-[70] bg-[#0C0E0D] text-white px-6 py-3 rounded-lg shadow-xl flex items-center gap-3 animate-in slide-in-from-top-4 fade-in max-w-md">
                <CheckCircle size={20} className="text-[#4ADE80]" />
                <span className="font-medium text-sm">{toastMessage}</span>
            </div>
        )}

        {/* Internal Movement Modal */}
        {showInternalMovementModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                <div className="bg-white rounded-xl w-full max-w-lg p-6">
                    <h3 className="font-bold text-lg mb-4">Registrar Movimiento Interno</h3>
                    <div className="space-y-4">
                        <div className="flex gap-2 p-1 bg-slate-100 rounded-lg">
                            <button onClick={() => setInternalMoveType('debit')} className={`flex-1 py-1.5 text-sm font-bold rounded ${internalMoveType === 'debit' ? 'bg-red-500 text-white' : 'text-slate-500'}`}>Egreso</button>
                            <button onClick={() => setInternalMoveType('credit')} className={`flex-1 py-1.5 text-sm font-bold rounded ${internalMoveType === 'credit' ? 'bg-green-600 text-white' : 'text-slate-500'}`}>Ingreso</button>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <select value={internalCurrency} onChange={(e) => setInternalCurrency(e.target.value)} className="border p-2 rounded">
                                {['USD','COP','CLP','PEN','MXN','BRL','VES','EUR'].map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <input type="number" placeholder="Monto" value={internalAmount} onChange={(e) => setInternalAmount(e.target.value)} className="border p-2 rounded" />
                        </div>

                        <select value={internalAccountId} onChange={(e) => setInternalAccountId(e.target.value)} className="w-full border p-2 rounded">
                            <option value="">Seleccionar Cuenta Tesorería...</option>
                            {treasuryAccounts.filter(acc => acc.currency === internalCurrency).map(acc => (
                                <option key={acc.id} value={acc.id}>{acc.bank} ({acc.country}) - Saldo: {formatMoney(acc.amount, '')}</option>
                            ))}
                        </select>

                        <input type="text" placeholder="Motivo / Descripción" value={internalReason} onChange={(e) => setInternalReason(e.target.value)} className="w-full border p-2 rounded" />
                        <input type="text" placeholder="ID Referencia Externa (Opcional)" value={internalReferenceId} onChange={(e) => setInternalReferenceId(e.target.value)} className="w-full border p-2 rounded" />
                        
                        <div className="border-2 border-dashed border-slate-300 rounded p-4 text-center cursor-pointer relative hover:bg-slate-50">
                            <input type="file" className="absolute inset-0 opacity-0" onChange={(e) => setInternalProofFile(e.target.files?.[0] || null)}/>
                            <p className="text-xs text-slate-500">{internalProofFile ? internalProofFile.name : 'Adjuntar Comprobante (Opcional)'}</p>
                        </div>

                        <div className="flex justify-end gap-2 mt-4">
                            <button onClick={() => setShowInternalMovementModal(false)} className="px-4 py-2 text-slate-500">Cancelar</button>
                            <button onClick={handleRegisterInternalMovement} className="px-4 py-2 bg-[#0C0E0D] rounded font-bold">Registrar</button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* Transaction Detail Modal */}
        {selectedTreasuryTx && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                <div className="bg-white rounded-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                    <div className="flex justify-between items-start mb-6">
                        <h3 className="font-bold text-xl text-slate-800">Detalle de Transacción #{selectedTreasuryTx.id}</h3>
                        <button onClick={() => setSelectedTreasuryTx(null)}><X size={20} className="text-slate-400"/></button>
                    </div>
                    
                    <div className="space-y-4 text-sm">
                        <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg">
                            <div>
                                <span className="block text-xs text-slate-500 uppercase font-bold">Tipo</span>
                                <span className={`font-bold ${selectedTreasuryTx.type === 'load' ? 'text-green-600' : 'text-[#4ADE80]'}`}>{selectedTreasuryTx.type === 'load' ? 'Depósito Entrante' : 'Solicitud Retiro'}</span>
                            </div>
                            <div>
                                <span className="block text-xs text-slate-500 uppercase font-bold">Monto</span>
                                <span className="font-bold text-slate-800">{formatMoney(selectedTreasuryTx.amount, selectedTreasuryTx.currency)} {selectedTreasuryTx.currency}</span>
                            </div>
                            <div>
                                <span className="block text-xs text-slate-500 uppercase font-bold">Usuario</span>
                                <span className="font-medium text-slate-800">{selectedTreasuryTx.userName}</span>
                            </div>
                            <div>
                                <span className="block text-xs text-slate-500 uppercase font-bold">Fecha</span>
                                <span className="font-medium text-slate-800">{selectedTreasuryTx.date}</span>
                            </div>
                        </div>

                        {selectedTreasuryTx.type === 'load' ? (
                            <div className="border p-4 rounded-lg">
                                <h4 className="font-bold text-slate-700 mb-2">Datos del Depósito</h4>
                                <p><span className="font-bold">Método:</span> {selectedTreasuryTx.method}</p>
                                {selectedTreasuryTx.proofUrl && (() => {
                                    const proof = selectedTreasuryTx.proofUrl === '__stored__' ? resolvedProof : selectedTreasuryTx.proofUrl;
                                    return (
                                        <div className="mt-2">
                                            <span className="text-xs font-bold text-slate-500 uppercase block mb-1">Comprobante</span>
                                            {proof ? (
                                                <>
                                                    <a href={proof} download="comprobante.png" className="text-[#4ADE80] underline text-xs flex items-center gap-1"><Download size={12}/> Descargar Evidencia</a>
                                                    {proof.startsWith('data:image') && (
                                                        <img src={proof} alt="Comprobante" className="mt-2 rounded border max-h-40 object-contain" />
                                                    )}
                                                </>
                                            ) : selectedTreasuryTx.proofUrl === '__stored__' ? (
                                                <p className="text-xs text-slate-400 flex items-center gap-1"><RefreshCw size={12} className="animate-spin"/> Cargando comprobante…</p>
                                            ) : null}
                                        </div>
                                    );
                                })()}
                            </div>
                        ) : (
                            <div className="border p-4 rounded-lg">
                                <h4 className="font-bold text-slate-700 mb-2">Datos de Destino</h4>
                                {/* Una solicitud que insertó el propio cliente sin que el
                                    servidor le descontara el saldo NO se paga: sería pagar
                                    (o, al rechazarla, "devolver") plata que nunca salió. */}
                                {selectedTreasuryTx.type === 'send' && (selectedTreasuryTx as any).insertadoPorCliente === true && !(selectedTreasuryTx as any).debitado && (
                                    <p className="mb-2 inline-block text-[11px] font-bold px-2.5 py-1 rounded-full border border-red-300 bg-red-50 text-red-700">Sin débito verificado</p>
                                )}
                                <p><span className="font-bold">Banco:</span> {selectedTreasuryTx.bank}</p>
                                <p><span className="font-bold">Cuenta:</span> {selectedTreasuryTx.account}</p>
                                <p><span className="font-bold">Beneficiario:</span> {selectedTreasuryTx.beneficiary}</p>
                                <p><span className="font-bold">Motivo:</span> {selectedTreasuryTx.reason}</p>
                            </div>
                        )}

                        {selectedTreasuryTx.status === 'Pendiente' && (
                            <div className="mt-6 pt-6 border-t border-slate-100">
                                <div className="mb-4">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Razón de Rechazo (Opcional)</label>
                                    <input 
                                        type="text" 
                                        value={rejectReason} 
                                        onChange={(e) => setRejectReason(e.target.value)} 
                                        className="w-full border rounded px-3 py-2 text-sm"
                                        placeholder="Si vas a rechazar, indica el motivo..."
                                    />
                                </div>
                                <div className="flex gap-3">
                                    <button 
                                        onClick={() => handleTxAction('reject')} disabled={txAccionando}
                                        className="flex-1 py-3 border border-red-200 bg-red-50 text-red-700 font-bold rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-wait"
                                    >
                                        {txAccionando ? 'Procesando…' : 'Rechazar'}
                                    </button>
                                    <button 
                                        onClick={() => handleTxAction('approve')} disabled={txAccionando || (selectedTreasuryTx.type === 'send' && (selectedTreasuryTx as any).insertadoPorCliente === true && !(selectedTreasuryTx as any).debitado)}
                                        title={selectedTreasuryTx.type === 'send' && (selectedTreasuryTx as any).insertadoPorCliente === true && !(selectedTreasuryTx as any).debitado ? 'Esta solicitud no tiene el saldo descontado por el servidor: no se puede pagar.' : undefined}
                                        className="flex-1 py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition-colors shadow-lg shadow-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {txAccionando ? 'Procesando…' : 'Aprobar Operación'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}
        {showPaletteChooser && <PaletteChooser onClose={() => setShowPaletteChooser(false)} />}
    </div>
  );
};