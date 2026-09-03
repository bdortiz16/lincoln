import React, { useState, useEffect, useRef } from 'react';
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
import { AdminOtcSection } from './AdminOtcSection';
import { Zap, ArrowLeftRight, Info } from 'lucide-react';
import { CollectionWalletCard } from './CollectionWalletCard';
import type { AdminProfile } from './AdminPersonas/lib/adminAuth';
import { FlagImg, flagUrl } from './FlagImg';
import { PaletteChooser } from './PaletteChooser';
import { useExchangeRates } from '../context/ExchangeRateContext'; 
import { useSystemConfig, Coupon } from '../context/SystemConfigContext'; 
import { useDatabase, AdminUser, BankDetail, Transaction, User, TreasuryAccount } from '../context/DatabaseContext';

interface AdminDashboardProps {
  onLogout: () => void;
}

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

// File helper
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
};

// Admin panel for Didit KYC — sync session by providing Didit internal session ID
const DiditAdminPanel: React.FC<{ client: any; showToast: (m: string) => void }> = ({ client, showToast }) => {
  const [syncId, setSyncId] = React.useState('');
  const [syncing, setSyncing] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);

  const handleSync = async () => {
    setSyncing(true);
    setResult(null);
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      const r = await fetch(`${SURL}/functions/v1/didit-kyc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
        body: JSON.stringify({ action: 'admin_sync_session', userId: client.id }),
      });
      const d = await r.json();
      setResult(d);
      if (d.status === 'verified') showToast(`✅ Usuario verificado (${client.name})`);
      else if (d.error) showToast(`Error: ${d.error}`);
      else showToast(`Lincoin: ${d.status ?? 'sin estado'}${d.raw ? ` (raw: "${d.raw}")` : ''}`);
    } catch (e: any) {
      showToast('Error al sincronizar: ' + e.message);
    }
    setSyncing(false);
  };

  return (
    <div className={`border rounded-xl p-4 space-y-3 ${client.kycStatus === 'verified' ? 'bg-green-50 border-green-200' : client.kycStatus === 'rejected' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}`}>
      <h3 className="font-bold text-sm flex items-center gap-2">🔐 Verificación Lincoin</h3>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          { label: 'Estado Lincoin', val: client.kycStatus },
          { label: 'Session ID guardado', val: client.raw_data?.diditSessionId ? client.raw_data.diditSessionId.slice(0, 16) + '...' : null },
          { label: 'Vendor Data (userId)', val: client.id?.slice(0, 16) + '...' },
          { label: 'Verificado el', val: client.raw_data?.verifiedAt ? new Date(client.raw_data.verifiedAt).toLocaleDateString('es-CO') : null },
        ].filter(r => r.val).map(({ label, val }) => (
          <div key={label} className="bg-white/70 rounded p-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase">{label}</p>
            <p className="font-medium text-slate-700 break-all">{val}</p>
          </div>
        ))}
      </div>
      {client.kycStatus !== 'verified' && (
        <div className="space-y-2 pt-2 border-t border-yellow-200">
          <p className="text-[11px] text-slate-600 font-medium">Sincronizar estado desde Lincoin automáticamente:</p>
          <p className="text-[10px] text-slate-400">Busca todas las sesiones de este usuario en Lincoin y actualiza el estado si hay una aprobada.</p>
          <button onClick={handleSync} disabled={syncing}
            className="w-full px-4 py-2 bg-yellow-500 text-white text-xs font-bold rounded-lg hover:bg-yellow-600 disabled:opacity-50">
            {syncing ? 'Consultando Lincoin...' : '🔄 Sincronizar estado desde Lincoin'}
          </button>
          {result && (
            <div className={`text-xs p-2 rounded-lg font-mono ${result.status === 'verified' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
              Estado: <strong>{result.status}</strong>
              {result.raw ? ` (raw: "${result.raw}")` : ''}
              {result.sessionId ? ` · ID: ${result.sessionId.slice(0, 12)}...` : ''}
              {result.error ? ` · Error: ${result.error}` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'clients' | 'treasury' | 'cargues' | 'team' | 'reports' | 'marketing' | 'config' | 'banks' | 'rates' | 'security' | 'design' | 'gasfree' | 'otcConfig' | 'fallos' | 'auditoria'>('overview');
  const [auditRows, setAuditRows] = useState<any[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
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
  const [carguesClient, setCarguesClient] = useState<User | null>(null);
  const [carguesRail, setCarguesRail] = useState<'COP' | 'COP_BREB' | 'COP_ACH'>('COP');
  const [carguesAmount, setCarguesAmount] = useState('');
  const [carguesNote, setCarguesNote] = useState('');
  const [carguesDir, setCarguesDir] = useState<'credit' | 'debit'>('credit');
  const [carguesRecordOnly, setCarguesRecordOnly] = useState(false);
  const [carguesBusy, setCarguesBusy] = useState(false);
  const [carguesMsg, setCarguesMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [carguesConfirm, setCarguesConfirm] = useState<{ raw: number } | null>(null);
  // "Cargar de todos modos" cuando el cargue excede lo disponible en la bolsa
  // (protección contra sobre-acreditar más de lo que respalda el proveedor).
  const [carguesOverride, setCarguesOverride] = useState(false);
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

  useEffect(() => {
    if (activeTab === 'cargues' && !mouvPool) loadMouvPool();
    if (activeTab === 'cargues' && !finityPool) loadFinityPool();
    if (activeTab === 'auditoria') loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const railLabelOf = (r: string) => (r === 'COP' ? 'Saldo Lincoin' : r === 'COP_BREB' ? 'Bre-B' : 'ACH');

  // Paso 1: validar y abrir la ventana de confirmación propia.
  const requestCargue = () => {
    if (!carguesClient) return;
    const raw = parseFloat((carguesAmount || '').replace(/[^\d.]/g, ''));
    if (!isFinite(raw) || raw <= 0) { setCarguesMsg({ ok: false, text: 'Ingresa un monto válido.' }); return; }
    setCarguesMsg(null);
    setCarguesOverride(false);
    setCarguesConfirm({ raw });
  };

  // Paso 2: aplicar el cargue (lo llama el botón del modal).
  const submitCargue = async () => {
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
        body: JSON.stringify({ action: 'admin_credit_balance', userId: carguesClient.id, currency: carguesRail, amount: delta, note: carguesNote.trim() || undefined, ...(carguesRecordOnly ? { recordOnly: true } : {}) }),
      });
      const d = await r.json();
      if (d?.success) {
        setCarguesMsg({ ok: true, text: d.recordOnly
          ? `✅ Movimiento registrado en el historial. El saldo NO cambió (${formatMoney(d.newBalance ?? 0, '')} COP).`
          : d.feeCop > 0
          ? `✅ ${railLabel} actualizado. Cargue ${formatMoney(d.grossCop ?? raw, '')} − comisión ${formatMoney(d.feeCop, '')} (${d.feePct}%) = ${formatMoney(d.netCop ?? 0, '')} acreditados. Nuevo saldo: ${formatMoney(d.newBalance ?? 0, '')} COP`
          : `✅ ${railLabel} actualizado. Nuevo saldo: ${formatMoney(d.newBalance ?? 0, '')} COP` });
        setCarguesAmount(''); setCarguesNote('');
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
  const railMoveAction = async (txId: string | number, action: 'approve' | 'reject') => {
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
      const r = await fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: authHeader },
        body: JSON.stringify({ action: action === 'approve' ? 'approve_rail_move' : 'reject_rail_move', txId }),
      });
      const d = await r.json();
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
  const { config: systemConfig, updateConfig: updateSystemConfig, addCoupon, removeCoupon, toggleCoupon, setThemePreset } = useSystemConfig();
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
  } = useDatabase();

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
  const adminTeam = getAdminTeam();

  // ── Panel de Fallos ──────────────────────────────────────────────────────
  // Operaciones de dinero que FALLARON o fueron RECHAZADAS, con el error
  // técnico real (para el admin). Al cliente solo se le muestra el mensaje
  // amable ("la llave no es válida…"); el detalle vive aquí.
  const failuresList = (getTransactionHistory() as any[])
    .filter(t => ['Fallido', 'Rechazado'].includes(String(t.status)))
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
  const failuresCount = failuresList.length;

  const pendingClientsCount = allUsers.filter(u => u.kycStatus === 'pending' || u.kycStatus === 'in_review').length;

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
          
          if (!isOnline) newAlerts.push({ id: 'db-offline', type: 'error', title: 'Base de Datos Desconectada', description: 'La app está en modo local. Configura Supabase.' });

          const totalPendingTx = pendingDeposits.length + pendingWithdrawals.length;
          if (pendingClientsCount > 0) newAlerts.push({ id: 'kyc-pending', type: 'info', title: 'Verificación de Clientes', description: `Hay ${pendingClientsCount} usuarios esperando validación KYC.`, action: 'clients' });
          if (totalPendingTx > 5) newAlerts.push({ id: 'high-load', type: 'info', title: 'Alto Volumen de Solicitudes', description: `Hay ${totalPendingTx} transacciones pendientes de revisión.` });
          
          if (systemConfig.maintenanceMode) newAlerts.push({ id: 'maintenance', type: 'error', title: 'Sistema en Mantenimiento', description: 'El acceso a usuarios finales está restringido.' });
          
          const limit = systemConfig.volumeLimit || 10000;
          let usersOverLimit = 0;
          allUsers.forEach(u => { const { totalUSD } = getUserVolume(u.id); if (totalUSD > limit) usersOverLimit++; });
          if (usersOverLimit > 0) newAlerts.push({ id: 'volume-risk', type: 'warning', title: 'Límite de Volumen Excedido', description: `${usersOverLimit} clientes superaron el límite de $${limit.toLocaleString()}. Revisar Compliance.`, action: 'clients' });

          setActiveAlerts(newAlerts);
      };
      generateAlerts();
      const interval = setInterval(generateAlerts, 30000);
      return () => clearInterval(interval);
  }, [apiStatus, pendingDeposits, pendingWithdrawals, systemConfig, allUsers, historyTransactions, pendingClientsCount, getRate, isOnline]); 

  const showToast = (msg: string) => { setToastMessage(msg); setTimeout(() => setToastMessage(null), 3000); };
  
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
    try {
      await fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'set_kyc_status', userId, kycStatus }),
      });
    } catch {}
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
    await setKycViaEdgeFn(selectedClient.id, 'verified');
    updateUserProfile(selectedClient.id, { kycStatus: 'verified', notifications: [...existing, notif] });
    setSelectedClient(null);
    showToast('Cliente verificado.');
  };
  const handleRejectKYC = async () => {
    if (!selectedClient) return;
    const existing: any[] = selectedClient.notifications ?? [];
    const notif = { id: Date.now(), type: 'kyc', title: 'KYC Rechazado', message: 'Tu solicitud de verificación fue rechazada. Por favor contacta a soporte para más información.', read: false, date: new Date().toLocaleDateString() };
    await setKycViaEdgeFn(selectedClient.id, 'rejected');
    updateUserProfile(selectedClient.id, { kycStatus: 'rejected', notifications: [...existing, notif] });
    setSelectedClient(null);
    showToast('Cliente rechazado.');
  };
  const handleBlockUser = () => { if (!selectedClient) return; toggleUserBlock(selectedClient.id, !selectedClient.isBlocked, blockReason); showToast("Estado de bloqueo actualizado"); setSelectedClient(null); setShowBlockInput(false); setBlockReason(''); };
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

  const handleRegisterInternalMovement = async () => {
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

      let proofUrl = undefined;
      if (internalProofFile) {
          try {
              proofUrl = await fileToBase64(internalProofFile);
          } catch (e) {
              console.error(e);
          }
      }

      registerInternalMovement(
          parseFloat(internalAmount), 
          internalCurrency, 
          internalMoveType, 
          internalReason,
          internalAccountId,
          internalReferenceId,
          proofUrl
      );
      
      setShowInternalMovementModal(false);
      setInternalAmount('');
      setInternalReason('');
      setInternalReferenceId('');
      setInternalProofFile(null);
      showToast("Movimiento interno registrado y saldo actualizado.");
  };

  const handleTxAction = (action: 'approve' | 'reject') => {
      if (!selectedTreasuryTx) return;

      if (action === 'approve') {
          if (selectedTreasuryTx.type === 'load') {
              approveDeposit(selectedTreasuryTx.id);
              showToast("Depósito aprobado y saldo acreditado.");
          } else if (selectedTreasuryTx.type === 'send') {
              completeWithdrawal(selectedTreasuryTx.id);
              showToast("Retiro completado.");
          }
      } else {
          if (selectedTreasuryTx.type === 'load') {
              rejectDeposit(selectedTreasuryTx.id);
              showToast("Depósito rechazado.");
          } else if (selectedTreasuryTx.type === 'send') {
              rejectWithdrawal(selectedTreasuryTx.id, rejectReason || 'Rechazado por administración');
              showToast("Retiro rechazado y fondos devueltos.");
          }
      }
      setSelectedTreasuryTx(null);
      setRejectReason('');
  };

  const formatMoney = (amount: number, currency: string) => {
      return new Intl.NumberFormat('es-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  };

  // --- REPORT GENERATION HELPERS ---
  const downloadDatabase = () => {
      const data = {
          generatedAt: new Date().toISOString(),
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
      showToast("Backup completo descargado correctamente");
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
      const pendingClients = allUsers.filter(u => u.kycStatus === 'pending' || u.kycStatus === 'in_review');
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
  
  const renderClients = () => {
      // No se filtra por rol: esta base es SOLO de Empresas (el personal vive
      // en otra base). Antes se exigía role === 'business' y las cuentas que
      // quedaron como 'personal' (registro por Google con pista vieja, cuentas
      // previas al arreglo) no salían en "Empresas" → RESULTADOS (0). allUsers
      // ya excluye a los admins/equipo, así que aquí van todos los clientes.
      const filteredUsers = allUsers.filter(u =>
          (clientKycFilter === 'all' || u.kycStatus === 'pending' || u.kycStatus === 'in_review') &&
          ((u.name ?? '').toLowerCase().includes(clientSearch.toLowerCase()) || (u.email ?? '').toLowerCase().includes(clientSearch.toLowerCase()))
      );

      const handleRefreshClients = async () => {
        setClientRefreshing(true);
        await refreshData();
        setClientRefreshing(false);
      };

      return (
          <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex flex-wrap gap-3 items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex gap-2">
                      {/* Solo empresas en este admin — personas van en /admin-personas */}
                      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                          <span style={{ color: '#FFFFFF' }} className="px-4 py-2 rounded-lg text-sm font-bold bg-[#0C0E0D] shadow-md">Empresas</span>
                      </div>
                      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                          <button onClick={() => setClientKycFilter('all')} className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${clientKycFilter === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Todos</button>
                          <button onClick={() => setClientKycFilter('pending')} className={`px-3 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-1 ${clientKycFilter === 'pending' ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                              Pendientes {pendingClientsCount > 0 && <span className="bg-white text-orange-600 text-[10px] rounded-full px-1.5 font-bold">{pendingClientsCount}</span>}
                          </button>
                      </div>
                  </div>
                  <div className="flex gap-2">
                      <div className="relative w-48">
                          <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                          <input
                              type="text"
                              placeholder="Buscar cliente..."
                              value={clientSearch}
                              onChange={(e) => setClientSearch(e.target.value)}
                              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:border-[#0C0E0D] outline-none"
                          />
                      </div>
                      <button onClick={handleRefreshClients} disabled={clientRefreshing} className="flex items-center gap-1 px-3 py-2 bg-[#0C0E0D] rounded-lg text-sm font-bold hover:bg-[#152e52] disabled:opacity-60 transition-colors">
                          <RefreshCw size={14} className={clientRefreshing ? 'animate-spin' : ''} /> Actualizar
                      </button>
                      <button onClick={() => setShowOrphanTool(v => !v)} className="flex items-center gap-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                          <Trash2 size={14} /> Liberar correo huérfano
                      </button>
                  </div>
              </div>

              {showOrphanTool && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
                      <p className="text-sm font-bold text-amber-800">Liberar correo huérfano</p>
                      <p className="text-xs text-amber-700">
                          Úsalo cuando alguien eliminó su cuenta pero un registro nuevo con el <b>mismo correo</b> nunca se crea
                          (ej. pasar de Personal a Empresa) — pasa cuando el perfil se borró pero la cuenta de acceso de Supabase
                          quedó "atascada" con ese correo. Esto borra cualquier rastro que quede de ese correo, permanentemente.
                      </p>
                      <div className="flex gap-2 flex-wrap items-center">
                          <input
                              type="email"
                              value={orphanEmail}
                              onChange={e => setOrphanEmail(e.target.value)}
                              placeholder="correo@empresa.com"
                              className="flex-1 min-w-[220px] px-3 py-2 rounded-lg border border-amber-300 text-sm outline-none focus:border-amber-500"
                          />
                          <button onClick={freeOrphanEmail} disabled={orphanBusy || !orphanEmail.trim()} style={{ color: '#FFFFFF' }} className="px-4 py-2 text-sm font-bold bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">
                              {orphanBusy ? 'Liberando…' : 'Liberar correo'}
                          </button>
                      </div>
                      {orphanMsg && <p className="text-xs font-semibold text-slate-700">{orphanMsg}</p>}
                  </div>
              )}

              <div className="flex gap-6 h-[600px]">
                  {/* List */}
                  <div className="w-1/3 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                      <div className="p-4 border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-500 uppercase">
                          Resultados ({filteredUsers.length})
                      </div>
                      <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                          {filteredUsers.map(client => (
                              <div 
                                  key={client.id} 
                                  onClick={() => { setSelectedClient(client); setShowDeleteConfirm(false); setShowBlockInput(false); }}
                                  className={`p-4 cursor-pointer hover:bg-slate-50 transition-colors ${selectedClient?.id === client.id ? 'bg-slate-50 border-l-4 border-[#0C0E0D]' : ''}`}
                              >
                                  <div className="flex items-center gap-3">
                                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm ${client.kycStatus === 'verified' ? 'bg-green-500' : client.kycStatus === 'rejected' ? 'bg-red-500' : 'bg-orange-400'}`}>
                                          {(client.name ?? client.email ?? '?').charAt(0).toUpperCase()}
                                      </div>
                                      <div>
                                          <p className="font-bold text-slate-800 text-sm truncate w-40">{client.name || client.email}</p>
                                          <p className="text-xs text-slate-500 truncate w-40">{client.email}</p>
                                      </div>
                                  </div>
                                  {client.isBlocked && <span className="text-[10px] text-red-500 font-bold mt-1 block">BLOQUEADO</span>}
                              </div>
                          ))}
                      </div>
                  </div>

                  {/* Detail */}
                  <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                      {selectedClient ? (
                          <div className="flex flex-col h-full">
                              <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50">
                                  <div>
                                      <h2 className="text-xl font-bold text-slate-800">{selectedClient.name}</h2>
                                      <p className="text-sm text-slate-500">{selectedClient.email}</p>
                                      <div className="flex gap-2 mt-2">
                                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${selectedClient.kycStatus === 'verified' ? 'bg-green-100 text-green-700' : selectedClient.kycStatus === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                                              KYC: {selectedClient.kycStatus}
                                          </span>
                                          <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase">{selectedClient.role}</span>
                                      </div>
                                  </div>
                                  <div className="flex gap-2 flex-wrap justify-end">
                                      <button onClick={openEditClient} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-900 transition-colors flex items-center gap-1">
                                          <Edit2 size={14}/> Editar
                                      </button>
                                      {selectedClient.kycStatus !== 'verified' && (
                                          <button onClick={handleApproveKYC} className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-green-700 transition-colors flex items-center gap-1">
                                              <CheckCircle size={14}/> Aprobar
                                          </button>
                                      )}
                                      <button onClick={() => setShowBlockInput(!showBlockInput)} className="bg-red-100 text-red-700 border border-red-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-200 transition-colors flex items-center gap-1">
                                          <Ban size={14}/> {selectedClient.isBlocked ? 'Desbloquear' : 'Bloquear'}
                                      </button>
                                      <button onClick={() => { setShowDeleteConfirm(true); setShowBlockInput(false); }} className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-700 transition-colors flex items-center gap-1">
                                          <Trash2 size={14}/> Eliminar
                                      </button>
                                      <button onClick={() => handleSyncCrypto(selectedClient.id, selectedClient.name)} className="bg-[#4ADE80] text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-[#22C55E] transition-colors flex items-center gap-1">
                                          <RefreshCw size={14}/> Sincronizar Cripto
                                      </button>
                                      {selectedClient.role === 'business' && (
                                          <button
                                              onClick={() => {
                                                  updateUserProfile(selectedClient.id, { otcEnabled: !selectedClient.otcEnabled });
                                                  setSelectedClient({ ...selectedClient, otcEnabled: !selectedClient.otcEnabled });
                                                  showToast(selectedClient.otcEnabled ? 'OTC desactivado' : 'OTC activado');
                                              }}
                                              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1 ${selectedClient.otcEnabled ? 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'}`}
                                          >
                                              <TrendingUp size={14}/> OTC {selectedClient.otcEnabled ? 'ON' : 'OFF'}
                                          </button>
                                      )}
                                  </div>
                              </div>
                              
                              {editClientOpen && (
                                  <div className="p-4 bg-slate-50 border-b border-slate-200 animate-in fade-in slide-in-from-top-2 space-y-3">
                                      <div>
                                          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Nombre {editClientRole === 'business' ? '/ Razón social' : 'completo'}</label>
                                          <input value={editClientName} onChange={e => setEditClientName(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm text-slate-800 outline-none focus:border-slate-800" placeholder="Nombre del cliente" />
                                      </div>
                                      <div>
                                          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Tipo de cuenta</label>
                                          <div className="flex gap-2">
                                              <button onClick={() => setEditClientRole('personal')} className={`flex-1 h-10 rounded-lg text-sm font-bold border transition-colors ${editClientRole === 'personal' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}`}>Persona</button>
                                              <button onClick={() => setEditClientRole('business')} className={`flex-1 h-10 rounded-lg text-sm font-bold border transition-colors ${editClientRole === 'business' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}`}>Empresa</button>
                                          </div>
                                      </div>
                                      <div className="flex gap-2">
                                          <button onClick={() => setEditClientOpen(false)} className="flex-1 h-10 rounded-lg text-sm font-bold border border-slate-300 text-slate-600 hover:bg-slate-100">Cancelar</button>
                                          <button onClick={saveEditClient} disabled={editClientSaving} className="flex-1 h-10 rounded-lg text-sm font-bold bg-[#0C0E0D] text-white hover:bg-slate-800 disabled:opacity-60">{editClientSaving ? 'Guardando…' : 'Guardar cambios'}</button>
                                      </div>
                                  </div>
                              )}
                              {showBlockInput && (
                                  <div className="p-4 bg-red-50 border-b border-red-100 flex gap-2 animate-in fade-in slide-in-from-top-2">
                                      <input
                                          type="text"
                                          value={blockReason}
                                          onChange={(e) => setBlockReason(e.target.value)}
                                          placeholder="Motivo del bloqueo / desbloqueo..."
                                          className="flex-1 border border-red-200 rounded px-3 text-sm focus:outline-none focus:border-red-400"
                                      />
                                      <button onClick={handleBlockUser} className="bg-red-600 text-white px-4 py-2 rounded text-xs font-bold hover:bg-red-700">Confirmar</button>
                                  </div>
                              )}

                              {showDeleteConfirm && (
                                  <div className="p-4 bg-red-50 border-b border-red-200 animate-in fade-in slide-in-from-top-2">
                                      <p className="text-sm font-bold text-red-800 mb-1">⚠️ Eliminar cuenta permanentemente</p>
                                      <p className="text-xs text-red-700 mb-3">Se eliminarán el perfil, todas las transacciones y el acceso de <span className="font-bold">{selectedClient.email}</span>. Esta acción no se puede deshacer.</p>
                                      <div className="flex gap-2">
                                          <button onClick={handleDeleteUser} disabled={deletingUser} className="bg-red-600 text-white px-4 py-2 rounded text-xs font-bold hover:bg-red-700 disabled:opacity-60 flex items-center gap-1">
                                              {deletingUser ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin inline-block"/> : <Trash2 size={12}/>}
                                              {deletingUser ? 'Eliminando...' : 'Sí, eliminar'}
                                          </button>
                                          <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 rounded text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50">Cancelar</button>
                                      </div>
                                  </div>
                              )}

                              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                  {/* Info Grid */}
                                  <div className="grid grid-cols-2 gap-4">
                                      <div className="p-3 border border-slate-100 rounded-lg">
                                          <p className="text-xs text-slate-400 font-bold uppercase">ID Cliente</p>
                                          <p className="text-sm font-mono text-slate-700">{selectedClient.id}</p>
                                      </div>
                                      <div className="p-3 border border-slate-100 rounded-lg">
                                          <p className="text-xs text-slate-400 font-bold uppercase">País</p>
                                          <p className="text-sm font-bold text-slate-700">{selectedClient.country || selectedClient.companyCountry || 'N/A'}</p>
                                      </div>
                                      <div className="p-3 border border-slate-100 rounded-lg">
                                          <p className="text-xs text-slate-400 font-bold uppercase">NIT / Documento</p>
                                          <p className="text-sm font-bold text-slate-700">{selectedClient.taxId || selectedClient.docNumber || 'N/A'}</p>
                                      </div>
                                      <div className="p-3 border border-slate-100 rounded-lg">
                                          <p className="text-xs text-slate-400 font-bold uppercase">Tipo ID</p>
                                          <p className="text-sm font-bold text-slate-700">{selectedClient.taxIdType || selectedClient.docType || 'N/A'}</p>
                                      </div>
                                  </div>

                                  {/* Didit Verification Result */}
                                  <DiditAdminPanel client={selectedClient} showToast={showToast} />

                                  {/* Business KYC Data */}
                                  {selectedClient.role === 'business' && (
                                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                                          <h3 className="font-bold text-[#0C0E0D] text-sm flex items-center gap-2">
                                              <Building2 size={16}/> Datos KYC Empresa
                                          </h3>
                                          <div className="grid grid-cols-2 gap-3">
                                              {[
                                                  { label: 'Razón Social', val: selectedClient.companyName || selectedClient.name },
                                                  { label: 'Ciudad', val: selectedClient.companyCity },
                                                  { label: 'Dirección', val: selectedClient.companyAddress || selectedClient.address },
                                                  { label: 'Rep. Legal', val: selectedClient.repLegalName || `${selectedClient.repFirstName ?? ''} ${selectedClient.repLastName ?? ''}`.trim() },
                                                  { label: 'Doc. Rep', val: selectedClient.repDocNumber },
                                                  { label: 'Tipo Doc. Rep', val: selectedClient.repDocType },
                                                  { label: 'Nacionalidad Rep', val: selectedClient.repNationality },
                                                  { label: 'PEP', val: selectedClient.isPep ? 'Sí' : 'No' },
                                              ].map(({ label, val }) => (
                                                  <div key={label} className="bg-white rounded-lg p-2 border border-slate-200">
                                                      <p className="text-[10px] font-bold text-[#4ADE80] uppercase">{label}</p>
                                                      <p className="text-sm text-slate-700 font-medium">{val || 'N/A'}</p>
                                                  </div>
                                              ))}
                                          </div>
                                      </div>
                                  )}

                                  {/* Documents */}
                                  <div>
                                      <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><FileText size={16}/> Documentación</h3>
                                      {selectedClient.documents ? (
                                          <div className="grid grid-cols-2 gap-4">
                                              {Object.entries(selectedClient.documents).map(([key, val]) => (
                                                  <div key={key} className="border border-slate-200 rounded-lg p-2">
                                                      <p className="text-xs font-bold text-slate-500 uppercase mb-2">{key}</p>
                                                      {typeof val === 'string' && val.startsWith('data:image') ? (
                                                          <img src={val} alt={key} className="w-full h-32 object-cover rounded bg-slate-100 cursor-pointer hover:opacity-90" onClick={() => {const w = window.open(""); w?.document.write(`<img src="${val}"/>`)}}/>
                                                      ) : (
                                                          <a href={val as string} download className="text-[#4ADE80] text-xs underline truncate block">{val ? 'Descargar Archivo' : 'Sin archivo'}</a>
                                                      )}
                                                  </div>
                                              ))}
                                          </div>
                                      ) : (
                                          <div className="p-4 bg-slate-50 rounded text-center text-slate-400 text-sm">No hay documentos cargados.</div>
                                      )}
                                  </div>

                                  {/* Balances */}
                                  <div>
                                      <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><Wallet size={16}/> Balances</h3>
                                      <div className="flex gap-2 flex-wrap">
                                          {Object.entries(selectedClient.balances).map(([curr, amount]) => (
                                              <div key={curr} className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                                                  <span className="text-xs font-bold text-slate-400 block">{curr}</span>
                                                  <span className="font-bold text-slate-800">${formatMoney(amount as number, curr)}</span>
                                              </div>
                                          ))}
                                      </div>
                                  </div>
                              </div>
                          </div>
                      ) : (
                          <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
                              <UserCheck size={64} className="mb-4 opacity-50"/>
                              <p className="text-lg font-medium text-slate-400">Selecciona un cliente para ver detalles</p>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      );
  };

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
                  <button onClick={handleAddCoupon} className="bg-[#0C0E0D] px-6 py-2 rounded-lg font-bold text-sm hover:bg-[#152e52] h-[38px] flex items-center gap-2">
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
      const list = allUsers
        .filter(u => !q || (u.name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q))
        .slice(0, 40);
      const bal = (u: User | null, code: string) => Number((u?.balances as any)?.[code] ?? 0);
      const railMeta: Record<string, { label: string; sub: string; icon: React.ElementType }> = {
        COP:      { label: 'Saldo Lincoin', sub: 'Cuenta principal · COP', icon: Wallet },
        COP_BREB: { label: 'Bre-B',         sub: 'Pagos inmediatos 24/7',  icon: Zap },
        COP_ACH:  { label: 'ACH',           sub: 'Interbancario L–V',       icon: Landmark },
      };

      // ── Respaldo y utilidad por riel ──────────────────────────────
      // Lo que Lincoin YA le debe a los clientes en cada riel (suma de sus
      // saldos). La bolsa del proveedor (Mouv=Bre-B, Finity=ACH) debe cubrir
      // eso; lo que sobra es la UTILIDAD que va quedando en pesos.
      const obligOf = (code: string) => allUsers.reduce((s, u) => s + Number((u.balances as any)?.[code] ?? 0), 0);
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

      return (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Aviso: proceso temporal */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <Info size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-amber-800">Cargue manual de saldo (temporal)</p>
              <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                Mientras Mouv apifica el conversor, el pago llega por el grupo cerrado y aquí reflejas el saldo del cliente
                en el riel correspondiente. Elige el cliente, el riel (Saldo Lincoin, Bre-B o ACH) y el monto.
                Cada cargue queda registrado en el historial del cliente.
              </p>
            </div>
          </div>

          {/* Saldo REAL disponible en Mouv (la bolsa desde donde se carga) */}
          <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16, padding: '18px 22px' }}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div style={{ width: 40, height: 40, borderRadius: 11, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.30)', display: 'grid', placeItems: 'center' }}>
                  <Wallet size={19} style={{ color: '#4ADE80' }} />
                </div>
                <div>
                  <p style={{ fontSize: 12.5, color: '#878E88', fontWeight: 600 }}>Saldo disponible en Mouv</p>
                  {mouvPool?.loading ? (
                    <p style={{ fontSize: 22, fontWeight: 800, color: '#878E88', letterSpacing: '-0.6px' }}>Cargando…</p>
                  ) : mouvPool?.error ? (
                    <p style={{ fontSize: 13, color: '#F87171', fontWeight: 600, maxWidth: 520 }}>{mouvPool.error}</p>
                  ) : (
                    <p style={{ fontSize: 26, fontWeight: 800, color: '#F4F4F2', letterSpacing: '-1px' }}>
                      {Math.round(Number(mouvPool?.total ?? 0)).toLocaleString('es-CO')} <span style={{ fontSize: 13, color: '#878E88', fontWeight: 600 }}>COP</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div style={{ background: '#0A0C0B', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 11, padding: '9px 14px', minWidth: 130 }}>
                  <div className="flex items-center gap-1.5" style={{ color: '#878E88', marginBottom: 2 }}><Zap size={12} /><span style={{ fontSize: 11, fontWeight: 600 }}>Wallet BreB</span></div>
                  <p style={{ fontSize: 15, fontWeight: 700, color: '#F4F4F2' }}>{mouvPool?.breb != null ? Math.round(mouvPool.breb).toLocaleString('es-CO') : '—'}</p>
                </div>
                <div style={{ background: '#0A0C0B', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 11, padding: '9px 14px', minWidth: 130 }}>
                  <div className="flex items-center gap-1.5" style={{ color: '#878E88', marginBottom: 2 }}><Landmark size={12} /><span style={{ fontSize: 11, fontWeight: 600 }}>Cuenta ACH</span></div>
                  <p style={{ fontSize: 15, fontWeight: 700, color: '#F4F4F2' }}>{mouvPool?.ach != null ? Math.round(mouvPool.ach).toLocaleString('es-CO') : '—'}</p>
                </div>
                <button onClick={loadMouvPool} disabled={mouvPool?.loading} title="Actualizar saldo Mouv"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.11)', color: '#F4F4F2', borderRadius: 10, padding: '9px 11px', cursor: 'pointer' }}>
                  <RefreshCw size={15} className={mouvPool?.loading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>
          </div>

          {/* Respaldo y utilidad por riel: bolsa del proveedor − comprometido
              con clientes = disponible para cargar (= utilidad en pesos). */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {([
              { rail: 'COP_BREB', label: 'Bre-B · Mouv', icon: Zap, pool: brebPool, oblig: obligBreb, free: freeBreb,
                loading: mouvPool?.loading, error: mouvPool?.error, reload: loadMouvPool },
              { rail: 'COP_ACH', label: 'ACH · Finity', icon: Landmark, pool: achPool, oblig: obligAch, free: freeAch,
                loading: finityPool?.loading, error: finityPool?.error, reload: loadFinityPool },
            ] as const).map(c => (
              <div key={c.rail} style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16, padding: '16px 18px' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                  <div className="flex items-center gap-2" style={{ color: '#F4F4F2' }}>
                    <c.icon size={15} style={{ color: '#4ADE80' }} />
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>{c.label}</span>
                  </div>
                  <button onClick={c.reload} disabled={c.loading} title="Actualizar"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.11)', color: '#F4F4F2', borderRadius: 9, padding: '6px 8px', cursor: 'pointer' }}>
                    <RefreshCw size={13} className={c.loading ? 'animate-spin' : ''} />
                  </button>
                </div>
                {c.error ? (
                  <p style={{ fontSize: 12, color: '#F87171', fontWeight: 600 }}>{c.error}</p>
                ) : c.loading ? (
                  <p style={{ fontSize: 13, color: '#878E88' }}>Cargando…</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between" style={{ padding: '6px 0' }}>
                      <span style={{ fontSize: 12.5, color: '#878E88' }}>Bolsa en {c.rail === 'COP_BREB' ? 'Mouv' : 'Finity'}</span>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>{Math.round(c.pool).toLocaleString('es-CO')} COP</span>
                    </div>
                    <div className="flex items-center justify-between" style={{ padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <span style={{ fontSize: 12.5, color: '#878E88' }}>Comprometido con clientes</span>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>− {Math.round(c.oblig).toLocaleString('es-CO')} COP</span>
                    </div>
                    <div className="flex items-center justify-between" style={{ padding: '9px 0 2px', borderTop: '1px solid rgba(255,255,255,0.10)', marginTop: 4 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: c.free < 0 ? '#F87171' : '#4ADE80' }}>
                        {c.free < 0 ? '⚠ Faltante (sobre-cargado)' : 'Disponible · utilidad'}
                      </span>
                      <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.4px', color: c.free < 0 ? '#F87171' : '#4ADE80' }}>
                        {Math.round(c.free).toLocaleString('es-CO')} COP
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

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

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Columna izquierda — buscar y elegir cliente */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <p className="text-sm font-bold text-slate-800 mb-3">1 · Elegir cliente</p>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="Buscar por nombre o correo..."
                  value={carguesSearch}
                  onChange={(e) => setCarguesSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:border-[#0C0E0D] outline-none"
                />
              </div>
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
                {list.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-6">Sin clientes que coincidan.</p>
                )}
                {list.map(u => {
                  const active = carguesClient?.id === u.id;
                  return (
                    <button
                      key={u.id}
                      onClick={() => { setCarguesClient(u); setCarguesMsg(null); }}
                      className="w-full text-left p-3 rounded-lg transition-colors flex items-center gap-3"
                      style={{
                        border: active ? '1.5px solid #4ADE80' : '1px solid rgba(255,255,255,0.10)',
                        background: active ? 'rgba(74,222,128,0.10)' : 'transparent',
                      }}
                    >
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)', color: '#F4F4F2' }}>
                        {(u.name ?? 'U').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate" style={{ color: '#F4F4F2' }}>{u.name ?? 'Sin nombre'}</p>
                        <p className="text-xs truncate" style={{ color: '#878E88' }}>{u.email}</p>
                      </div>
                      {active && <CheckCircle size={16} className="flex-shrink-0" style={{ color: '#4ADE80' }} />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Columna derecha — form del cargue */}
            <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              {!carguesClient ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-16 text-slate-400">
                  <Wallet size={30} className="mb-3 opacity-40" />
                  <p className="text-sm font-medium">Selecciona un cliente a la izquierda</p>
                  <p className="text-xs mt-1">para aplicarle un cargue de saldo.</p>
                </div>
              ) : (
                <>
                  {/* Cabecera cliente + saldos actuales */}
                  <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
                    <div className="w-11 h-11 rounded-full bg-[#0C0E0D] flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                      {(carguesClient.name ?? 'U').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-bold text-slate-800 truncate">{carguesClient.name}</p>
                      <p className="text-xs text-slate-400 truncate">{carguesClient.email}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 py-4">
                    {(['COP', 'COP_BREB', 'COP_ACH'] as const).map(code => {
                      const M = railMeta[code];
                      return (
                        <div key={code} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                          <div className="flex items-center gap-1.5 text-slate-500 mb-1"><M.icon size={13} /><span className="text-[11px] font-semibold">{M.label}</span></div>
                          <p className="text-sm font-bold text-slate-800">{formatMoney(bal(carguesClient, code), '')}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* 2 · Riel */}
                  <p className="text-sm font-bold text-slate-800 mb-2 mt-1">2 · Riel destino</p>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {(['COP', 'COP_BREB', 'COP_ACH'] as const).map(code => {
                      const M = railMeta[code];
                      const active = carguesRail === code;
                      return (
                        <button
                          key={code}
                          onClick={() => setCarguesRail(code)}
                          className="p-3 rounded-lg text-left transition-colors"
                          style={{
                            border: active ? '1.5px solid #4ADE80' : '1px solid rgba(255,255,255,0.14)',
                            background: active ? 'rgba(74,222,128,0.12)' : 'transparent',
                          }}
                        >
                          <M.icon size={16} style={{ color: active ? '#4ADE80' : '#878E88' }} />
                          <p className="text-xs font-bold mt-1.5" style={{ color: '#F4F4F2' }}>{M.label}</p>
                          <p className="text-[10px] leading-tight mt-0.5" style={{ color: '#878E88' }}>{M.sub}</p>
                          {active && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 10, fontWeight: 700, color: '#4ADE80' }}><CheckCircle size={11} /> Seleccionado</span>}
                        </button>
                      );
                    })}
                  </div>

                  {/* 3 · Dirección + monto */}
                  <p className="text-sm font-bold text-slate-800 mb-2">3 · Movimiento</p>
                  <div className="flex gap-2 p-1 bg-slate-100 rounded-lg mb-3">
                    <button onClick={() => setCarguesDir('credit')} className={`flex-1 py-1.5 text-sm font-bold rounded transition-colors ${carguesDir === 'credit' ? 'bg-green-600 text-white' : 'text-slate-500'}`}>Acreditar (+)</button>
                    <button onClick={() => setCarguesDir('debit')} className={`flex-1 py-1.5 text-sm font-bold rounded transition-colors ${carguesDir === 'debit' ? 'bg-red-500 text-white' : 'text-slate-500'}`}>Descontar (−)</button>
                  </div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Monto (COP)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={carguesAmount ? Number(carguesAmount).toLocaleString('es-CO') : ''}
                    onChange={(e) => setCarguesAmount(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-lg font-bold text-slate-800 focus:border-[#0C0E0D] outline-none mb-3"
                  />
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Nota (opcional)</label>
                  <input
                    type="text"
                    placeholder="Ref. Mouv, motivo del ajuste..."
                    value={carguesNote}
                    onChange={(e) => setCarguesNote(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 focus:border-[#0C0E0D] outline-none mb-3"
                  />
                  {/* Registro histórico: crea el MOVIMIENTO sin tocar el saldo —
                      para cuadrar cargues viejos que se acreditaron sin fila en
                      transacciones (el resumen de Movimientos no los veía). */}
                  <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
                    <input type="checkbox" checked={carguesRecordOnly} onChange={e => setCarguesRecordOnly(e.target.checked)} style={{ width: 15, height: 15, accentColor: '#4ADE80' }} />
                    <span className="text-xs text-slate-500">Solo registrar movimiento histórico (<b>no</b> modifica el saldo ni cobra comisión)</span>
                  </label>

                  {carguesMsg && (
                    <div className={`text-xs font-medium rounded-lg p-3 mb-3 ${carguesMsg.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                      {carguesMsg.text}
                    </div>
                  )}

                  <button
                    onClick={requestCargue}
                    disabled={carguesBusy || !carguesAmount}
                    className="w-full py-3 rounded-lg text-sm font-bold text-white bg-[#0C0E0D] hover:bg-[#152e52] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {carguesBusy ? <><RefreshCw size={15} className="animate-spin" /> Aplicando…</> : <>{carguesDir === 'credit' ? 'Acreditar' : 'Descontar'} saldo</>}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Ventana de confirmación del cargue (tema Lincoin) */}
          {carguesConfirm && carguesClient && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }} onClick={() => !carguesBusy && setCarguesConfirm(null)}>
              <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#121413', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, overflow: 'hidden', fontFamily: "'Archivo', system-ui, sans-serif", boxShadow: '0 24px 60px rgba(0,0,0,0.55)' }}>
                <div style={{ padding: '22px 24px 4px' }}>
                  <div style={{ width: 46, height: 46, borderRadius: 13, display: 'grid', placeItems: 'center', marginBottom: 14,
                    background: carguesDir === 'credit' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                    border: `1px solid ${carguesDir === 'credit' ? 'rgba(74,222,128,0.32)' : 'rgba(248,113,113,0.32)'}` }}>
                    <Wallet size={21} style={{ color: carguesDir === 'credit' ? '#4ADE80' : '#F87171' }} />
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 800, color: '#F4F4F2', letterSpacing: '-0.4px' }}>
                    Confirmar {carguesDir === 'credit' ? 'cargue' : 'descuento'}
                  </h3>
                  <p style={{ fontSize: 13.5, color: '#878E88', marginTop: 4, lineHeight: 1.5 }}>
                    Vas a {carguesDir === 'credit' ? 'acreditar' : 'descontar'} saldo en el riel <b style={{ color: '#F4F4F2' }}>{railLabelOf(carguesRail)}</b> de <b style={{ color: '#F4F4F2' }}>{carguesClient.name}</b>.
                  </p>
                </div>
                {(() => {
                  // Bre-B: al cliente se le cobra 0,10% POR RECIBIR el cargue —
                  // el neto es lo que de verdad entra a su billetera Bre-B.
                  const isBrebCredit = carguesRail === 'COP_BREB' && carguesDir === 'credit' && !carguesRecordOnly;
                  const fee = isBrebCredit ? Math.round(carguesConfirm.raw * 0.10 / 100) : 0;
                  const net = carguesConfirm.raw - fee;
                  const deltaNet = carguesDir === 'credit' ? net : -carguesConfirm.raw;
                  return (
                <div style={{ margin: '16px 24px', padding: '16px 18px', background: '#0A0C0B', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 13 }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                    <span style={{ fontSize: 12.5, color: '#878E88' }}>Monto{isBrebCredit ? ' del cargue' : ''}</span>
                    <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.6px', color: carguesDir === 'credit' ? '#4ADE80' : '#F87171' }}>
                      {carguesDir === 'credit' ? '+' : '−'} {carguesConfirm.raw.toLocaleString('es-CO')} <span style={{ fontSize: 12, color: '#878E88', fontWeight: 600 }}>COP</span>
                    </span>
                  </div>
                  {isBrebCredit && (
                    <>
                      <div className="flex items-center justify-between" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
                        <span style={{ fontSize: 12.5, color: '#878E88' }}>Comisión por recepción Bre-B (0,10%)</span>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#F87171' }}>− {fee.toLocaleString('es-CO')} COP</span>
                      </div>
                      <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
                        <span style={{ fontSize: 12.5, color: '#878E88' }}>Neto que se acredita</span>
                        <span style={{ fontSize: 13.5, fontWeight: 800, color: '#F4F4F2' }}>{net.toLocaleString('es-CO')} COP</span>
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-between" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10, marginTop: isBrebCredit ? 10 : 0 }}>
                    <span style={{ fontSize: 12.5, color: '#878E88' }}>Saldo {railLabelOf(carguesRail)} actual</span>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>{Number((carguesClient.balances as any)?.[carguesRail] ?? 0).toLocaleString('es-CO')} COP</span>
                  </div>
                  <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
                    <span style={{ fontSize: 12.5, color: '#878E88' }}>Quedará en</span>
                    <span style={{ fontSize: 13.5, fontWeight: 800, color: '#4ADE80' }}>
                      {Math.max(0, Number((carguesClient.balances as any)?.[carguesRail] ?? 0) + deltaNet).toLocaleString('es-CO')} COP
                    </span>
                  </div>
                  {carguesNote.trim() && <p style={{ fontSize: 12, color: '#878E88', marginTop: 12, fontStyle: 'italic' }}>“{carguesNote.trim()}”</p>}
                </div>
                  );
                })()}
                {cargueExceeds && (
                  <div style={{ margin: '0 24px 12px', padding: '12px 14px', background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.38)', borderRadius: 12 }}>
                    <p style={{ fontSize: 12.5, color: '#F87171', fontWeight: 800 }}>⚠ Excede lo disponible en {carguesRail === 'COP_BREB' ? 'Mouv' : 'Finity'}</p>
                    <p style={{ fontSize: 11.5, color: 'rgba(248,113,113,0.9)', lineHeight: 1.5, marginTop: 4 }}>
                      Libre para cargar: <b>{Math.round(freeForRail).toLocaleString('es-CO')} COP</b>. Con este cargue quedarías corto en <b>{cargueShortfall.toLocaleString('es-CO')} COP</b> frente a lo que ya les debes a los clientes — estarías acreditando saldo que la bolsa no respalda.
                    </p>
                    <label className="flex items-center gap-2" style={{ marginTop: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={carguesOverride} onChange={e => setCarguesOverride(e.target.checked)} />
                      <span style={{ fontSize: 12, color: '#F4F4F2', fontWeight: 600 }}>Entiendo el faltante — cargar de todos modos</span>
                    </label>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, padding: '4px 24px 22px' }}>
                  <button onClick={() => { setCarguesConfirm(null); setCarguesOverride(false); }} disabled={carguesBusy}
                    style={{ flex: 1, padding: '12px', borderRadius: 11, fontSize: 14, fontWeight: 700, color: '#F4F4F2', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', cursor: carguesBusy ? 'default' : 'pointer' }}>
                    Cancelar
                  </button>
                  <button onClick={submitCargue} disabled={carguesBusy || (cargueExceeds && !carguesOverride)}
                    style={{ flex: 1.4, padding: '12px', borderRadius: 11, fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      color: '#0A0C0B', background: (carguesBusy || (cargueExceeds && !carguesOverride)) ? 'rgba(74,222,128,0.4)' : '#4ADE80', border: 'none', cursor: (carguesBusy || (cargueExceeds && !carguesOverride)) ? 'not-allowed' : 'pointer' }}>
                    {carguesBusy ? <><RefreshCw size={15} className="animate-spin" /> Aplicando…</> : <>Confirmar {carguesDir === 'credit' ? 'cargue' : 'descuento'}</>}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
  };

  const renderTreasury = () => {
      const CRYPTO_TYPES = ['otc_withdraw', 'otc_withdraw_request', 'otc_deposit', 'admin_hot_withdrawal', 'otc_convert_request'];
      const cryptoTxs = historyTransactions.filter(tx => CRYPTO_TYPES.includes(tx.type))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      let data = treasuryTab === 'deposits' ? pendingDeposits
               : treasuryTab === 'withdrawals' ? pendingWithdrawals
               : treasuryTab === 'crypto' ? [] // handled separately below
               : historyTransactions;

      if (treasurySearch) {
          const q = treasurySearch.toLowerCase();
          data = data.filter(tx => 
              tx.userName.toLowerCase().includes(q) || 
              tx.id.toString().includes(q) ||
              tx.amount.toString().includes(q) ||
              tx.title.toLowerCase().includes(q)
          );
      }

      if (treasurySegment !== 'all') {
          data = data.filter(tx => tx.userRole === treasurySegment);
      }

      if (sortConfig) {
          data = [...data].sort((a, b) => {
              if (a[sortConfig.key as keyof Transaction] < b[sortConfig.key as keyof Transaction]) {
                  return sortConfig.direction === 'asc' ? -1 : 1;
              }
              if (a[sortConfig.key as keyof Transaction] > b[sortConfig.key as keyof Transaction]) {
                  return sortConfig.direction === 'asc' ? 1 : -1;
              }
              return 0;
          });
      }

      const handleSort = (key: string) => {
          let direction: 'asc' | 'desc' = 'asc';
          if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
              direction = 'desc';
          }
          setSortConfig({ key, direction });
      };

      const totalTreasuryUSD = treasuryAccounts.reduce((acc, account) => {
          const rateToUSD = getRate(account.currency, 'USD');
          return acc + (Math.max(0, account.amount) * rateToUSD);
      }, 0);

      const pendingRailMoves = (getAllTransactions() as any[]).filter(t => t.type === 'rail_move' && t.status === 'Pendiente');
      return (
      <div className="space-y-8 animate-in fade-in duration-300">
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

          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                  <h2 className="text-2xl font-bold text-[#0C0E0D]">Tesoreria y Finanzas</h2>
                  <div className="flex items-center gap-2 mt-1">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                      <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Sistema Operativo</span>
                      <span className="text-xs text-slate-400 ml-2">{new Date().toLocaleDateString()}</span>
                  </div>
              </div>
              <button 
                  onClick={() => setShowInternalMovementModal(true)}
                  className="bg-[#0C0E0D] hover:bg-[#152e52] px-5 py-2.5 rounded-xl font-bold text-sm shadow-lg flex items-center gap-2 transition-all"
              >
                  <RefreshCw size={16} /> Registrar Movimiento
              </button>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
              {treasuryAccounts.map((bal) => (
                  <div key={bal.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm min-w-[200px] flex flex-col justify-between hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-2">
                              <span className="text-xl font-bold text-slate-700">{bal.flag}</span>
                              <span className="text-sm font-bold text-slate-700">{bal.country}</span>
                          </div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{bal.currency}</span>
                      </div>
                      <div>
                          <p className={`text-xl font-bold tracking-tight ${bal.amount < 0 ? 'text-red-600' : 'text-slate-800'}`}>$ {formatMoney(bal.amount, '')}</p>
                          <p className="text-[10px] text-slate-400 mt-1 truncate">{bal.bank}</p>
                      </div>
                  </div>
              ))}
          </div>

          <div className="space-y-4">
              <div className="flex gap-6 border-b border-slate-200">
                  <button onClick={() => setTreasuryTab('deposits')} className={`pb-3 text-sm font-bold transition-colors border-b-2 ${treasuryTab === 'deposits' ? 'text-[#0C0E0D] border-[#0C0E0D]' : 'text-slate-400 border-transparent hover:text-slate-600'}`}>
                      Solicitudes Carga <span className="ml-1 bg-slate-100 text-[#4ADE80] px-1.5 py-0.5 rounded-full text-[10px]">{pendingDeposits.length}</span>
                  </button>
                  <button onClick={() => setTreasuryTab('withdrawals')} className={`pb-3 text-sm font-bold transition-colors border-b-2 ${treasuryTab === 'withdrawals' ? 'text-[#0C0E0D] border-[#0C0E0D]' : 'text-slate-400 border-transparent hover:text-slate-600'}`}>
                      Solicitudes Retiro <span className="ml-1 bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full text-[10px]">{pendingWithdrawals.length}</span>
                  </button>
                  <button onClick={() => setTreasuryTab('history')} className={`pb-3 text-sm font-bold transition-colors border-b-2 ${treasuryTab === 'history' ? 'text-[#0C0E0D] border-[#0C0E0D]' : 'text-slate-400 border-transparent hover:text-slate-600'}`}>
                      Historial Fiat
                  </button>
                  <button onClick={() => setTreasuryTab('crypto')} className={`pb-3 text-sm font-bold transition-colors border-b-2 ${treasuryTab === 'crypto' ? 'text-[#0C0E0D] border-[#0C0E0D]' : 'text-slate-400 border-transparent hover:text-slate-600'}`}>
                      Operaciones Cripto <span className="ml-1 bg-slate-100 text-[#4ADE80] px-1.5 py-0.5 rounded-full text-[10px]">{cryptoTxs.length}</span>
                  </button>
              </div>

              <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white p-2 rounded-xl border border-slate-200">
                  {/* Solo empresas — la fuente ya viene filtrada (isBusinessTx) */}
                  <div className="flex bg-slate-100 p-1 rounded-lg">
                      <span style={{ color: '#FFFFFF' }} className="px-4 py-1.5 rounded-md text-xs font-bold bg-[#0C0E0D] shadow-sm">Empresas</span>
                  </div>
                  
                  <div className="relative w-full md:w-64">
                      <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                      <input 
                          type="text" 
                          placeholder="Buscar usuario o ID..." 
                          value={treasurySearch}
                          onChange={(e) => setTreasurySearch(e.target.value)}
                          className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:border-[#0C0E0D] outline-none transition-colors"
                      />
                  </div>
              </div>
          </div>

          {treasuryTab !== 'crypto' ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                      <thead className="bg-[#F8FAFC] text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
                          <tr>
                              <th className="px-6 py-4 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('id')}>ID <ArrowUpDown size={10} className="inline ml-1"/></th>
                              <th className="px-6 py-4">TIPO CLIENTE</th>
                              <th className="px-6 py-4 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('userName')}>USUARIO <ArrowUpDown size={10} className="inline ml-1"/></th>
                              <th className="px-6 py-4 text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('amount')}>MONTO <ArrowUpDown size={10} className="inline ml-1"/></th>
                              <th className="px-6 py-4">DETALLES</th>
                              <th className="px-6 py-4 text-center">ESTADO</th>
                              <th className="px-6 py-4 text-right">ACCIÓN</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                          {data.map(tx => (
                              <tr key={tx.id} className="hover:bg-slate-50 transition-colors group">
                                  <td className="px-6 py-4 font-mono text-xs text-slate-400">#{tx.id}</td>
                                  <td className="px-6 py-4">
                                      {tx.userRole === 'business' ? (
                                          <span className="flex items-center gap-1 text-slate-600 font-bold text-xs"><Building2 size={14}/> Empresa</span>
                                      ) : (
                                          <span className="flex items-center gap-1 text-slate-600 font-bold text-xs"><Users size={14}/> Persona</span>
                                      )}
                                  </td>
                                  <td className="px-6 py-4">
                                      <div className="flex flex-col">
                                          <span className="font-bold text-slate-800 text-sm">{tx.userName}</span>
                                          <span className="text-[10px] text-slate-400">ID: {tx.userId}</span>
                                          {tx.amount > 5000 && <span className="flex items-center gap-1 text-[9px] text-orange-600 mt-1 font-bold"><AlertTriangle size={10}/> Alto Volumen</span>}
                                      </div>
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                      <span className={`font-bold text-sm ${tx.type === 'load' ? 'text-green-600' : 'text-slate-800'}`}>
                                          {tx.type === 'load' ? '+' : '-'} {formatMoney(tx.amount, tx.currency)} <span className="text-[10px] text-slate-400">{tx.currency}</span>
                                      </span>
                                  </td>
                                  <td className="px-6 py-4">
                                      <div className="text-xs text-slate-600 max-w-[150px] truncate" title={tx.title}>
                                          {tx.type === 'load' ? tx.method || 'Transferencia' : tx.bank}
                                      </div>
                                      <div className="text-[10px] text-slate-400 truncate">{tx.type === 'load' ? 'Depósito' : tx.account}</div>
                                  </td>
                                  <td className="px-6 py-4 text-center">
                                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${tx.status === 'Completado' ? 'bg-green-100 text-green-700' : tx.status === 'Pendiente' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
                                          {tx.status}
                                      </span>
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                      <button
                                          onClick={() => setSelectedTreasuryTx(tx)}
                                          className="text-[#0C0E0D] font-bold text-xs border border-slate-200 bg-slate-50 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                                      >
                                          Ver / Gestionar
                                      </button>
                                  </td>
                              </tr>
                          ))}
                          {data.length === 0 && (
                              <tr>
                                  <td colSpan={7} className="p-12 text-center text-slate-400">
                                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                          <Search size={24} className="opacity-50"/>
                                      </div>
                                      <p>No se encontraron movimientos con los filtros actuales.</p>
                                  </td>
                              </tr>
                          )}
                      </tbody>
                  </table>
              </div>
          </div>
          ) : (
          /* ── CRYPTO OPERATIONS HISTORY ── */
          <div className="space-y-4">
            {/* Summary cards */}
            {(() => {
              const completed = cryptoTxs.filter(t => t.status === 'Completado');
              const deposits   = completed.filter(t => t.type === 'otc_deposit');
              const userWDs    = completed.filter(t => t.type === 'otc_withdraw');
              const adminWDs   = completed.filter(t => t.type === 'admin_hot_withdrawal');
              const totalDep   = deposits.reduce((s, t) => s + t.amount, 0);
              const totalWD    = userWDs.reduce((s, t) => s + t.amount, 0);
              const totalAdm   = adminWDs.reduce((s, t) => s + t.amount, 0);
              const totalFees  = userWDs.reduce((s, t) => s + (t.raw_data?.fee ?? 0), 0);
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <p className="text-[10px] font-bold text-green-700 uppercase mb-1 flex items-center gap-1"><ArrowDownCircle size={12}/> Depósitos recibidos</p>
                    <p className="text-2xl font-black text-green-800">{totalDep.toFixed(2)}</p>
                    <p className="text-xs text-green-600 mt-0.5">{deposits.length} operaciones</p>
                  </div>
                  <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                    <p className="text-[10px] font-bold text-orange-700 uppercase mb-1 flex items-center gap-1"><ArrowUpCircle size={12}/> Retiros usuarios</p>
                    <p className="text-2xl font-black text-orange-800">{totalWD.toFixed(2)}</p>
                    <p className="text-xs text-orange-600 mt-0.5">{userWDs.length} operaciones</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <p className="text-[10px] font-bold text-green-700 uppercase mb-1 flex items-center gap-1"><DollarSign size={12}/> Comisiones cobradas</p>
                    <p className="text-2xl font-black text-green-800">{totalFees.toFixed(2)}</p>
                    <p className="text-xs text-green-600 mt-0.5">de retiros procesados</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <p className="text-[10px] font-bold text-slate-700 uppercase mb-1 flex items-center gap-1"><Vault size={12}/> Retiros admin</p>
                    <p className="text-2xl font-black text-slate-800">{totalAdm.toFixed(2)}</p>
                    <p className="text-xs text-slate-600 mt-0.5">{adminWDs.length} operaciones</p>
                  </div>
                </div>
              );
            })()}

            {/* Crypto transactions table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F8FAFC] text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3">FECHA</th>
                      <th className="px-4 py-3">TIPO</th>
                      <th className="px-4 py-3">USUARIO</th>
                      <th className="px-4 py-3">RED / TOKEN</th>
                      <th className="px-4 py-3 text-right">MONTO</th>
                      <th className="px-4 py-3 text-right">COMISIÓN</th>
                      <th className="px-4 py-3">DIRECCIÓN</th>
                      <th className="px-4 py-3">TX HASH</th>
                      <th className="px-4 py-3 text-center">ESTADO</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cryptoTxs.length === 0 && (
                      <tr><td colSpan={9} className="p-12 text-center text-slate-400">No hay operaciones cripto registradas aún.</td></tr>
                    )}
                    {cryptoTxs.map(tx => {
                      const raw = tx.raw_data ?? {};
                      const walletKey: string = raw.walletKey ?? tx.currency ?? '';
                      const [token, net] = walletKey.includes('_') ? walletKey.split('_') : [walletKey, ''];
                      const netLabel: Record<string, string> = { BSC: 'BSC', TRON: 'TRC-20', BASE: 'Base', MATIC: 'Polygon' };
                      const typeLabel: Record<string, {label: string; color: string}> = {
                        otc_deposit:           { label: '↓ Depósito',        color: 'bg-green-100 text-green-700' },
                        otc_withdraw:          { label: '↑ Retiro usuario',  color: 'bg-orange-100 text-orange-700' },
                        otc_withdraw_request:  { label: '⏳ Retiro pendiente',color: 'bg-yellow-100 text-yellow-700' },
                        admin_hot_withdrawal:  { label: '🏦 Retiro admin',   color: 'bg-slate-100 text-slate-700' },
                        otc_convert_request:   { label: '⇄ Conversión',      color: 'bg-slate-100 text-[#4ADE80]' },
                      };
                      const tInfo = typeLabel[tx.type] ?? { label: tx.type, color: 'bg-slate-100 text-slate-600' };
                      const shortHash = (h: string) => h ? `${h.slice(0,6)}…${h.slice(-4)}` : '—';
                      const shortAddr = (a: string) => a ? `${a.slice(0,6)}…${a.slice(-4)}` : '—';
                      const isAdmin = tx.userId === 'admin';
                      return (
                        <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                            {new Date(tx.date).toLocaleDateString('es', { day:'2-digit', month:'short', year:'2-digit' })}
                            <span className="block text-[10px] text-slate-400">{new Date(tx.date).toLocaleTimeString('es', { hour:'2-digit', minute:'2-digit' })}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${tInfo.color}`}>{tInfo.label}</span>
                          </td>
                          <td className="px-4 py-3">
                            {isAdmin ? (
                              <span className="text-xs font-bold text-slate-700 flex items-center gap-1"><Shield size={12} className="text-[#4ADE80]"/> Admin</span>
                            ) : (
                              <div>
                                <p className="text-xs font-bold text-slate-800">{tx.userName || '—'}</p>
                                <p className="text-[10px] text-slate-400 font-mono">{tx.userId?.slice(0,8)}…</p>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-black text-slate-800">{token || tx.currency}</span>
                              {net && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{netLabel[net] ?? net}</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-xs font-bold text-slate-800">{tx.amount?.toFixed(4)}</span>
                            <span className="text-[10px] text-slate-400 ml-1">{token || tx.currency}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {raw.fee > 0 ? (
                              <span className="text-xs font-bold text-green-700">{Number(raw.fee).toFixed(2)} {token}</span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {(raw.toAddress || raw.fromAddress) ? (
                              <span className="text-[11px] font-mono text-slate-600" title={raw.toAddress || raw.fromAddress}>
                                {shortAddr(raw.toAddress || raw.fromAddress)}
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {raw.txHash ? (
                              <span className="text-[11px] font-mono text-[#4ADE80] cursor-pointer hover:underline" title={raw.txHash}
                                onClick={() => navigator.clipboard.writeText(raw.txHash).then(() => showToast('TxHash copiado'))}>
                                {shortHash(raw.txHash)}
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${tx.status === 'Completado' ? 'bg-green-100 text-green-700' : tx.status === 'Pendiente' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
                              {tx.status}
                            </span>
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
      </div>
  );
  };

  const renderReports = () => {
      // Filter logic for User Reports
      const filteredReportUsers = allUsers.filter(u => 
          u.name.toLowerCase().includes(reportUserSearch.toLowerCase()) || 
          u.email.toLowerCase().includes(reportUserSearch.toLowerCase()) ||
          u.id.includes(reportUserSearch)
      );

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
                                  Descarga un archivo JSON encriptado con toda la información de usuarios, historial, configuración y tesorería.
                              </p>
                              <button onClick={downloadDatabase} className="w-full bg-[#0C0E0D] py-3 rounded-xl font-bold hover:bg-[#152e52] transition-colors flex items-center justify-center gap-2">
                                  <Download size={18}/> Descargar Base de Datos
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
            className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${saved ? 'bg-green-600' : 'bg-[#0C0E0D] hover:bg-[#152e52]'}`}>
            {saved ? <><CheckCircle size={15}/> Guardado</> : <><Save size={15}/> Guardar</>}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">Se activa en el login inmediatamente al guardar.</p>
      </div>
    );
  };

  const renderConfig = () => (
    <div className="space-y-6 animate-in fade-in duration-300">
        {/* Países habilitados — modelo hub multi-país. Controla qué países ven
            los clientes en Enviar/Beneficiarios (Activo), cuáles aparecen como
            "Próximamente" en el inicio, y cuáles quedan ocultos. */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><Landmark size={20}/> Países y monedas</h3>
            <p className="text-xs text-slate-500 mb-5">Cada país opera su riel local contra USDT (nunca fiat→fiat directo). Activa un país solo cuando su riel esté conectado.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {([
                    { name: 'Colombia', rail: 'Bre-B · ACH · COP', def: 'on' },
                    { name: 'Estados Unidos', rail: 'USDT (TRON) · USD', def: 'on' },
                    { name: 'México', rail: 'SPEI · MXN', def: 'soon' },
                    { name: 'Brasil', rail: 'Pix · BRL', def: 'soon' },
                    { name: 'Perú', rail: 'CCI · PEN', def: 'off' },
                    { name: 'Chile', rail: 'Transferencia · CLP', def: 'off' },
                    { name: 'Venezuela', rail: 'Pago móvil · VES', def: 'off' },
                ] as const).map(c => {
                    const cs: Record<string, string> = { Colombia: 'on', 'Estados Unidos': 'on', 'México': 'soon', Brasil: 'soon', ...((systemConfig as any).countryStatus || {}) };
                    const cur = cs[c.name] ?? c.def;
                    const setStatus = (v: string) => updateSystemConfig({ countryStatus: { ...cs, [c.name]: v } } as any);
                    return (
                        <div key={c.name} className="flex items-center justify-between gap-3 border border-slate-200 rounded-xl px-4 py-3">
                            <div className="min-w-0">
                                <p className="font-bold text-slate-800 text-sm">{c.name}</p>
                                <p className="text-[11px] text-slate-400">{c.rail}</p>
                            </div>
                            <select value={cur} onChange={e => setStatus(e.target.value)} className="border border-slate-200 rounded-lg text-xs font-bold p-2">
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
                    <button onClick={() => { setEditingBank(null); setBankForm({ id: '', name: '', type: 'bank', accountNumber: '', accountType: '', beneficiary: '', taxId: '', taxIdType: '', logoColor: 'bg-slate-100 text-slate-500', logoText: '', qrImageUrl: '' }); setShowBankModal(true); }} className="bg-[#0C0E0D] px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 h-10 shadow-lg hover:bg-[#152e52] transition-colors">
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

                        <button onClick={handleBankSave} className="w-full h-12 bg-[#0C0E0D] font-bold rounded-lg hover:bg-[#152e52] shadow-lg mt-4">
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

const renderTeam = () => (
    <div className="space-y-6 animate-in fade-in duration-300">
        <div className="flex justify-between items-center">
            <h3 className="font-bold text-slate-800">Gestión de Equipo</h3>
            <button onClick={() => { setEditingUserId(null); setNewUserForm({name:'', email:'', role:'Soporte L1', status:'Activo'}); setShowAddUserModal(true); }} className="bg-[#0C0E0D] px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2">
                <UserPlus size={16}/> Nuevo Usuario
            </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]">
                    <tr>
                        <th className="px-6 py-4">Usuario</th>
                        <th className="px-6 py-4">Rol</th>
                        <th className="px-6 py-4">Estado</th>
                        <th className="px-6 py-4">Último Acceso</th>
                        <th className="px-6 py-4 text-right">Acciones</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {adminTeam.map(admin => (
                        <tr key={admin.id} className="hover:bg-slate-50">
                            <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-[#0C0E0D] text-white flex items-center justify-center font-bold text-xs">{admin?.name?.charAt(0) ?? "?"}</div>
                                    <div>
                                        <p className="font-bold text-slate-800">{admin.name}</p>
                                        <p className="text-xs text-slate-400">{admin.email}</p>
                                    </div>
                                </div>
                            </td>
                            <td className="px-6 py-4">
                                <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold">{admin.role}</span>
                            </td>
                            <td className="px-6 py-4">
                                <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${admin.status === 'Activo' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {admin.status}
                                </span>
                            </td>
                            <td className="px-6 py-4 text-xs text-slate-500">{admin.lastAccess}</td>
                            <td className="px-6 py-4 text-right">
                                <div className="flex justify-end gap-2">
                                    <button onClick={() => { setEditingUserId(admin.id); setNewUserForm(admin); setShowAddUserModal(true); }} className="text-[#4ADE80] hover:bg-slate-50 p-1.5 rounded"><Edit2 size={16}/></button>
                                    <button onClick={() => { if(confirm('Eliminar usuario?')) deleteAdminUser(admin.id); }} className="text-red-600 hover:bg-red-50 p-1.5 rounded"><Trash2 size={16}/></button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>

        {/* Add User Modal */}
        {showAddUserModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                <div className="bg-white rounded-xl w-full max-w-sm p-6">
                    <h3 className="font-bold text-lg mb-4">{editingUserId ? 'Editar' : 'Nuevo'} Administrador</h3>
                    <div className="space-y-4">
                        <input type="text" placeholder="Nombre" value={newUserForm.name} onChange={(e) => setNewUserForm({...newUserForm, name: e.target.value})} className="w-full border p-2 rounded" />
                        <input type="email" placeholder="Email" value={newUserForm.email} onChange={(e) => setNewUserForm({...newUserForm, email: e.target.value})} className="w-full border p-2 rounded" />
                        <select value={newUserForm.role} onChange={(e) => setNewUserForm({...newUserForm, role: e.target.value as any})} className="w-full border p-2 rounded">
                            <option value="Soporte L1">Soporte L1</option>
                            <option value="Tesorero">Tesorero</option>
                            <option value="Auditor">Auditor</option>
                            <option value="Super Admin">Super Admin</option>
                        </select>
                        <select value={newUserForm.status} onChange={(e) => setNewUserForm({...newUserForm, status: e.target.value as any})} className="w-full border p-2 rounded">
                            <option value="Activo">Activo</option>
                            <option value="Inactivo">Inactivo</option>
                        </select>
                        <div className="flex justify-end gap-2 mt-2">
                            <button onClick={() => setShowAddUserModal(false)} className="px-4 py-2 text-slate-500">Cancelar</button>
                            <button onClick={handleTeamSave} className="px-4 py-2 bg-[#0C0E0D] rounded font-bold">Guardar</button>
                        </div>
                    </div>
                </div>
            </div>
        )}
    </div>
);

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
      const filteredUsers = baseUsers.filter(u =>
          u.name.toLowerCase().includes(securitySearch.toLowerCase()) ||
          u.email.toLowerCase().includes(securitySearch.toLowerCase()) ||
          u.id.includes(securitySearch)
      );

      const userTransactions = selectedSecurityUser ? historyTransactions.filter(tx => tx.userId === selectedSecurityUser.id).sort((a,b) => b.id - a.id) : [];

      return (
          <div className="space-y-6 animate-in fade-in duration-300 flex h-[calc(100vh-140px)]">
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
    const errText = (t: any): string => {
      const em = t.errorMessage ?? t.raw_data?.errorMessage;
      if (em) return String(em);
      const e = t.error ?? t.raw_data?.error;
      let s = '';
      try { s = typeof e === 'string' ? e : (e ? JSON.stringify(e) : ''); } catch { s = String(e ?? ''); }
      const http = t.httpStatus ?? t.raw_data?.httpStatus;
      return [http ? `HTTP ${http}` : '', s].filter(Boolean).join(' · ') || 'Sin detalle técnico';
    };
    const emailOf = (t: any): string => allUsers.find((u: any) => u.id === t.userId)?.email ?? t.userName ?? t.raw_data?.userName ?? t.userId ?? '—';
    const fmtDate = (d: any) => { try { return new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><AlertTriangle size={18} className="text-red-500" /> Fallos de operaciones</h2>
            <p className="text-sm text-slate-500">Envíos/retiros que fallaron o fueron rechazados, con el error técnico real. Al cliente solo se le muestra un mensaje amable.</p>
          </div>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-red-50 text-red-700 border border-red-200">{failuresCount} {failuresCount === 1 ? 'fallo' : 'fallos'}</span>
        </div>
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
                      <span className="text-xs text-slate-400">{fmtDate(t.createdAt)}</span>
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
                <div className="mt-2.5 rounded-lg bg-slate-900 text-slate-100 p-3 overflow-x-auto">
                  <code className="text-[11px] leading-relaxed whitespace-pre-wrap break-words" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{errText(t)}</code>
                </div>
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
          <button onClick={loadAudit} disabled={auditLoading} className="text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-1.5 disabled:opacity-50">{auditLoading ? 'Cargando…' : 'Actualizar'}</button>
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
  const navTo = (tab: string) => { setActiveTab(tab); closeSidebar(); };

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900 flex">
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
            <div className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
                <AdminSidebarItem icon={BarChart3} label="Dashboard" active={activeTab === 'overview'} onClick={() => navTo('overview')} />
                <AdminSidebarItem icon={Users} label="Clientes" active={activeTab === 'clients'} badge={pendingClientsCount > 0 ? pendingClientsCount : undefined} onClick={() => navTo('clients')} />
                <AdminSidebarItem icon={Landmark} label="Tesorería" active={activeTab === 'treasury'} badge={pendingDeposits.length + pendingWithdrawals.length > 0 ? pendingDeposits.length + pendingWithdrawals.length : undefined} onClick={() => navTo('treasury')} />
                <AdminSidebarItem icon={Wallet} label="Cargues" active={activeTab === 'cargues'} onClick={() => navTo('cargues')} />
                <AdminSidebarItem icon={AlertTriangle} label="Fallos" active={activeTab === 'fallos'} badge={failuresCount > 0 ? failuresCount : undefined} onClick={() => navTo('fallos')} />
                <AdminSidebarItem icon={Shield} label="Auditoría" active={activeTab === 'auditoria'} onClick={() => navTo('auditoria')} />
                <AdminSidebarItem icon={FileText} label="Reportes" active={activeTab === 'reports'} onClick={() => navTo('reports')} />
                <AdminSidebarItem icon={Settings} label="Configuración" active={activeTab === 'config'} onClick={() => navTo('config')} />
                <AdminSidebarItem icon={Palette} label="Diseño" active={activeTab === 'design'} onClick={() => navTo('design')} />
                <AdminSidebarItem icon={Shield} label="Seguridad" active={activeTab === 'security'} onClick={() => navTo('security')} />
                <AdminSidebarItem icon={Megaphone} label="Marketing" active={activeTab === 'marketing'} onClick={() => navTo('marketing')} />
                <AdminSidebarItem icon={Building2} label="Bancos" active={activeTab === 'banks'} onClick={() => navTo('banks')} />
                <AdminSidebarItem icon={TrendingUp} label="Tasas de Cambio" active={activeTab === 'rates'} onClick={() => navTo('rates')} />
                <AdminSidebarItem icon={Zap} label="GasFree USDT" active={activeTab === 'gasfree'} onClick={() => navTo('gasfree')} />
                <AdminSidebarItem icon={ArrowLeftRight} label="Contabilidad OTC" active={activeTab === 'otcConfig'} onClick={() => navTo('otcConfig')} />
                <AdminSidebarItem icon={UserCheck} label="Equipo Admin" active={activeTab === 'team'} onClick={() => navTo('team')} />
            </div>
            <div className="p-4 border-t border-white/10">
                <button onClick={onLogout} className="flex items-center gap-3 w-full px-4 py-3 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors font-medium text-sm">
                    <LogOut size={18} /> Cerrar Sesión
                </button>
            </div>
        </aside>

        <main className="flex-1 flex flex-col h-screen overflow-hidden">
            <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8">
                <div className="flex items-center gap-4">
                    <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="lg:hidden text-slate-500"><Menu size={24}/></button>
                    <h1 className="text-xl font-bold text-slate-800 capitalize">{activeTab === 'overview' ? 'Resumen General' : activeTab === 'design' ? 'Diseño y Apariencia' : activeTab}</h1>
                </div>
                <div className="flex items-center gap-4">
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${!isOnline ? 'bg-red-50 text-red-700' : dataReady ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                        <div className={`w-2 h-2 rounded-full ${!isOnline ? 'bg-red-500' : dataReady ? 'bg-green-500 animate-pulse' : 'bg-amber-500 animate-pulse'}`}></div>
                        {!isOnline ? 'Modo Offline (Local)' : dataReady ? 'Sistema Online' : 'Conectando…'}
                    </div>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8">
                {activeTab === 'overview' && renderOverview()}
                {activeTab === 'clients' && renderClients()}
                {activeTab === 'marketing' && renderMarketing()}
                {activeTab === 'treasury' && renderTreasury()}
                {activeTab === 'cargues' && renderCargues()}
                {activeTab === 'reports' && renderReports()}
                {activeTab === 'config' && renderConfig()}
                {activeTab === 'design' && renderDesign()}
                {activeTab === 'banks' && renderBanks()}
                {activeTab === 'rates' && renderRates()}
                {activeTab === 'team' && renderTeam()}
                {activeTab === 'security' && renderSecurity()}
                {activeTab === 'gasfree' && <AdminGasFreeSection />}
                {activeTab === 'otcConfig' && <AdminOtcSection />}
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
                                        onClick={() => handleTxAction('reject')}
                                        className="flex-1 py-3 border border-red-200 bg-red-50 text-red-700 font-bold rounded-lg hover:bg-red-100 transition-colors"
                                    >
                                        Rechazar
                                    </button>
                                    <button 
                                        onClick={() => handleTxAction('approve')}
                                        className="flex-1 py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition-colors shadow-lg shadow-green-200"
                                    >
                                        Aprobar Operación
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