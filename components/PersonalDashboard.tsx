import React, { useState, useEffect, useRef } from 'react';
import {
  Landmark,
  CheckCircle2,
  Info,
  Home,
  Send,
  RefreshCw,
  CreditCard,
  Activity,
  LogOut,
  Trash2,
  Bell,
  ChevronDown,
  ChevronUp,
  Plus,
  ArrowDownLeft,
  X,
  Clock,
  UploadCloud,
  CheckCircle,
  Copy,
  User,
  ArrowLeft,
  Gift,
  ArrowRight,
  ShieldCheck,
  Lock,
  LayoutGrid,
  Share2,
  Download,
  Megaphone,
  Plane,
  ShoppingBag,
  GraduationCap,
  TrendingUp,
  Layers,
  MoreHorizontal,
  Settings,
  Loader2,
  Ban,
  QrCode,
  Edit2,
  Tag,
  Minus,
  Equal,
  Users,
  AlertTriangle,
  Link2,
  Timer,
  Zap,
  Building2,
  MapPin,
  Wallet,
  BookUser,
  Search,
  SlidersHorizontal,
  ArrowLeftRight,
  XCircle
} from 'lucide-react';
import { Logo } from './Logo';
import { MouvSection, fetchMouvBalance, fetchMouvRateValue, fetchMouvUsdCopConfig, callMouv } from './OtcMigration';
import { MouvDispersion } from './MouvDispersion';
import { ContactsSection, contactStatus } from './ContactsSection';
import { WalletsGasfreeSection } from './WalletsGasfreeSection';
import { supabase } from '../lib/supabaseClient';
import { FlagImg, FlagSelect } from './FlagImg';
import { useExchangeRates } from '../context/ExchangeRateContext';
import { useSystemConfig } from '../context/SystemConfigContext'; 
import { useDatabase } from '../context/DatabaseContext';

interface PersonalDashboardProps {
  onLogout: () => void;
}

const INITIAL_WALLET_CARDS = [
  { code: 'USD', name: 'Dólar Digital', type: 'USDT · GasFree' },
  { code: 'COP', name: 'Peso Colombiano', type: 'Cuenta Local' },
  { code: 'CLP', name: 'Peso Chileno', type: 'Cuenta Local' },
  { code: 'PEN', name: 'Sol Peruano', type: 'Cuenta Local' },
  { code: 'MXN', name: 'Peso Mexicano', type: 'Cuenta Local' },
  { code: 'BRL', name: 'Real Brasileño', type: 'Cuenta Local' },
  { code: 'VES', name: 'Bolívar', type: 'Cuenta Local' },
];

const CONVERSION_CURRENCIES = [
  { code: 'USD', name: 'Dólar' },
  { code: 'CLP', name: 'Peso Chileno' },
  { code: 'COP', name: 'Peso Col' },
  { code: 'PEN', name: 'Sol Peruano' },
  { code: 'MXN', name: 'Peso Mex' },
  { code: 'BRL', name: 'Real' },
  { code: 'VES', name: 'Bolívar' },
];

const SEND_COUNTRIES = [
    { code: 'CLP', name: 'Chile', currency: 'CLP' },
    { code: 'COP', name: 'Colombia', currency: 'COP' },
    { code: 'PEN', name: 'Perú', currency: 'PEN' },
    { code: 'MXN', name: 'México', currency: 'MXN' },
    { code: 'BRL', name: 'Brasil', currency: 'BRL' },
    { code: 'VES', name: 'Venezuela', currency: 'VES' },
    { code: 'USD', name: 'Estados Unidos', currency: 'USD' },
];

const PAY_LINK_COUNTRIES = [
  { code: 'CO', name: 'Colombia',  currency: 'COP' },
  { code: 'CL', name: 'Chile',     currency: 'CLP' },
  { code: 'PE', name: 'Perú',      currency: 'PEN' },
  { code: 'MX', name: 'México',    currency: 'MXN' },
  { code: 'BR', name: 'Brasil',    currency: 'BRL' },
  { code: 'US', name: 'USA',       currency: 'USD' },
  { code: 'VE', name: 'Venezuela', currency: 'VES' },
];

const DOC_TYPES: Record<string, { label: string; value: string }[]> = {
  CO: [
    { label: 'Cédula de Ciudadanía', value: 'CC' },
    { label: 'Cédula de Extranjería', value: 'CE' },
    { label: 'NIT', value: 'NIT' },
    { label: 'Pasaporte', value: 'PAS' },
    { label: 'Tarjeta de Identidad', value: 'TI' },
  ],
  CL: [
    { label: 'RUT', value: 'RUT' },
    { label: 'Cédula de Identidad', value: 'CI' },
    { label: 'Pasaporte', value: 'PAS' },
  ],
  PE: [
    { label: 'DNI', value: 'DNI' },
    { label: 'Carné de Extranjería', value: 'CE' },
    { label: 'RUC', value: 'RUC' },
    { label: 'Pasaporte', value: 'PAS' },
  ],
  MX: [
    { label: 'CURP', value: 'CURP' },
    { label: 'RFC', value: 'RFC' },
    { label: 'INE/IFE', value: 'INE' },
    { label: 'Pasaporte', value: 'PAS' },
  ],
  BR: [
    { label: 'CPF', value: 'CPF' },
    { label: 'CNPJ', value: 'CNPJ' },
    { label: 'RG', value: 'RG' },
    { label: 'Pasaporte', value: 'PAS' },
  ],
  US: [
    { label: 'SSN', value: 'SSN' },
    { label: 'ITIN', value: 'ITIN' },
    { label: 'Passport', value: 'PAS' },
  ],
  VE: [
    { label: 'Cédula de Identidad', value: 'CI' },
    { label: 'RIF', value: 'RIF' },
    { label: 'Pasaporte', value: 'PAS' },
  ],
};

const SidebarItem: React.FC<{
  icon: React.ElementType;
  label: string;
  active?: boolean;
  badge?: boolean;
  onClick: () => void;
  small?: boolean;
}> = ({ icon: Icon, label, active, badge, onClick, small }) => (
  <button
    onClick={onClick}
    className={`
      w-full flex items-center justify-between px-4 py-3.5 mb-1 rounded-xl transition-all duration-200 group
      ${active
        ? 'bg-[#0C0E0D] font-bold shadow-lg shadow-green-900/10'
        : small
          ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          : 'text-slate-700 hover:bg-slate-50 hover:text-[#0C0E0D] hover:shadow-sm font-medium'}
      ${small ? 'text-xs' : 'text-sm'}
    `}
  >
    <div className="flex items-center gap-3">
      <Icon size={small ? 16 : 20} className={active ? 'text-[#4ADE80]' : 'text-slate-500 group-hover:text-[#0C0E0D]'} />
      {/* color explícito: el label del item activo se perdía (navy sobre navy
          según el orden de clases) — blanco fijo cuando está activo */}
      <span style={active ? { color: '#FFFFFF' } : undefined}>{label}</span>
    </div>
    {badge && (
      <span className={`w-2 h-2 rounded-full ${active ? 'bg-[#4ADE80]' : 'bg-red-500'}`}></span>
    )}
  </button>
);

// Sonido de notificación — dos tonos suaves (ding) vía Web Audio, sin
// archivos externos. Se reutiliza un único AudioContext. Los navegadores
// exigen un gesto previo del usuario para reproducir audio; como esto suena
// tras interactuar con la app (login/navegación), normalmente ya está
// permitido.
let _notifAudioCtx: any = null;
function playNotifSound() {
    try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        _notifAudioCtx = _notifAudioCtx || new AC();
        const ctx = _notifAudioCtx;
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        ([[880, 0], [1318.5, 0.12]] as Array<[number, number]>).forEach(([freq, t]) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.0001, now + t);
            g.gain.exponentialRampToValueAtTime(0.22, now + t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.35);
            o.connect(g); g.connect(ctx.destination);
            o.start(now + t);
            o.stop(now + t + 0.4);
        });
    } catch { /* audio no disponible */ }
}

// Sonido de DEPÓSITO recibido — acorde ascendente tipo "cha-ching" (más
// celebratorio que el ding normal). Mismo AudioContext.
function playDepositSound() {
    try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        _notifAudioCtx = _notifAudioCtx || new AC();
        const ctx = _notifAudioCtx;
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        ([[523.25, 0], [659.25, 0.1], [783.99, 0.2], [1046.5, 0.32]] as Array<[number, number]>).forEach(([freq, t]) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'triangle';
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.0001, now + t);
            g.gain.exponentialRampToValueAtTime(0.25, now + t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.42);
            o.connect(g); g.connect(ctx.destination);
            o.start(now + t);
            o.stop(now + t + 0.46);
        });
    } catch { /* audio no disponible */ }
}

export const PersonalDashboard: React.FC<PersonalDashboardProps> = ({ onLogout }) => {
  const [activeView, setActiveView] = useState<'dashboard' | 'movements' | 'wallet-detail' | 'profile' | 'notifications' | 'referrals' | 'affiliates' | 'settings' | 'servicios' | 'mouv' | 'contactos' | 'walletsGasfree'>('dashboard');
  // 'mouv' se usa para dos entradas distintas: "Dispersar" (Bre-B, flujo
  // completo con cuentas destino/movimientos) y el boton "OTC" en Servicios
  // (solo el convertidor USD->COP, sin nada de dispersion bancaria).
  const [mouvMode, setMouvMode] = useState<'full' | 'converter'>('full');
  // Riel elegido para dispersar (lo fija el botón "Dispersar" de cada tarjeta).
  const [dispersRail, setDispersRail] = useState<'COP_BREB' | 'COP_ACH'>('COP_BREB');
  const [selectedWalletCode, setSelectedWalletCode] = useState<string | null>(null);
  // BreB Lincoin: saldo COP separado (key 'COP_BREB') que se fondea desde
  // Peso Lincoin y se usa para dispersar vía Mouv (solo Colombia).
  const [brebMoveOpen, setBrebMoveOpen] = useState(false);
  const [brebDir, setBrebDir] = useState<'to_breb' | 'to_peso'>('to_breb');
  const [brebAmountStr, setBrebAmountStr] = useState('');
  const [brebMoving, setBrebMoving] = useState(false);
  // Saldo REAL en Mouv (Peso Lincoin está conectado a la cuenta Mouv).
  // null = no disponible → se muestra el saldo interno como respaldo.
  // mouvChecked distingue "cargando" de "ya respondió y no hay saldo".
  // ⚠️ El useEffect que lo carga vive DESPUÉS del useDatabase() — usa
  // currentUser, que se declara allá (si no: TDZ crash al montar).
  const [mouvBal, setMouvBal] = useState<number | null>(null);
  const [mouvChecked, setMouvChecked] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  
  const [showAllWallets, setShowAllWallets] = useState(false);
  const [myWallets, setMyWallets] = useState(INITIAL_WALLET_CARDS);
  const [isWalletOrderModalOpen, setIsWalletOrderModalOpen] = useState(false);
  const [walletDraftOrder, setWalletDraftOrder] = useState<string[]>([]);
  const [movementsTab, setMovementsTab] = useState<'all' | 'income' | 'expense'>('all');
  const [movSearch, setMovSearch] = useState('');
  const [movShowFilters, setMovShowFilters] = useState(false);
  const [movStatus, setMovStatus] = useState<'all' | 'Pendiente' | 'Completado' | 'Rechazado'>('all');
  const [movCurrency, setMovCurrency] = useState('all');
  const [movDateFrom, setMovDateFrom] = useState('');
  const [movDateTo, setMovDateTo] = useState('');
  const [movType, setMovType] = useState<'all' | 'send' | 'load' | 'convert'>('all');

  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [loadStep, setLoadStep] = useState(1);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedBankName, setSelectedBankName] = useState('');
  const [loadAmount, setLoadAmount] = useState('');
  const [timeLeft, setTimeLeft] = useState(300);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const [kycLoading, setKycLoading] = useState(false);

  // 2FA States
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | undefined>(undefined);
  const [mfaTotpSecret, setMfaTotpSecret] = useState<string | undefined>(undefined);
  const [mfaModalOpen, setMfaModalOpen] = useState(false);
  const [mfaEnrollData, setMfaEnrollData] = useState<{ qrCode: string; secret: string; factorId: string } | null>(null);
  const [mfaVerifyCode, setMfaVerifyCode] = useState('');
  const [mfaVerifyError, setMfaVerifyError] = useState('');
  const [mfaVerifyLoading, setMfaVerifyLoading] = useState(false);
  const [mfaDisableCode, setMfaDisableCode] = useState('');
  const [mfaDisableModalOpen, setMfaDisableModalOpen] = useState(false);
  const [mfaLoadingStatus, setMfaLoadingStatus] = useState(false);

  // Conversion States
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [convertAmountStr, setConvertAmountStr] = useState('1.000');
  const [sourceCurr, setSourceCurr] = useState('USD'); 
  const [targetCurr, setTargetCurr] = useState('COP');
  const [isConverting, setIsConverting] = useState(false);
  const [showConvertDetails, setShowConvertDetails] = useState(false);
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [showCouponInput, setShowCouponInput] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{code: string, discount: number} | null>(null);

  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [sendStep, setSendStep] = useState(1);
  // Buscador del selector de contactos inscritos (envíos COP · banco)
  const [contactSearch, setContactSearch] = useState('');
  // ID de la external account de Mouv del contacto elegido — con él la
  // confirmación crea la ORDEN DE RETIRO REAL en Mouv (destination_id).
  const [mouvDestId, setMouvDestId] = useState<string | null>(null);
  const [sendForm, setSendForm] = useState({
      destinationCountry: 'Chile',
      destinationCurrency: 'CLP',
      amount: '',
      beneficiaryType: 'personal' as 'personal' | 'business',
      beneficiaryName: '',
      documentType: '',
      documentNumber: '',
      bankName: '',
      accountType: '',
      accountNumber: '',
      reason: 'Envío de dinero',
  });
  // Billetera de ORIGEN para envíos COP: los 3 rieles son saldos SEPARADOS
  // (Saldo Lincoin / Bre-B / ACH). El cliente elige de cuál sale el dinero;
  // el disponible, la validación y el débito salen de ese riel.
  const [sendSourceRail, setSendSourceRail] = useState<'COP' | 'COP_BREB' | 'COP_ACH'>('COP');
  // Contacto elegido para el envío COP (trae destKind/brebKey/banco para la
  // dispersión REAL inline de Mouv).
  const [sendContact, setSendContact] = useState<any>(null);
  // Método elegido en el paso 2 del flujo (diseño Flujo Enviar): lista radio.
  const [sendMethodSel, setSendMethodSel] = useState<'breb' | 'ach' | 'pay' | 'cash' | null>(null);
  const [isSending, setIsSending] = useState(false);
  // Candado síncrono anti doble-clic (el estado de React tarda un render en
  // reflejarse; el ref bloquea desde el primer instante).
  const sendingRef = useRef(false);
  // true = se despachó una orden a Mouv y NO sabemos si se creó (timeout /
  // error de red). Bloquea reintentos hasta que el usuario verifique.
  const [mouvUnknown, setMouvUnknown] = useState(false);

  // PAY (P2P) flow
  const [sendMode, setSendMode] = useState<'bank' | 'pay' | 'cash' | 'wallet' | null>(null);
  const [cashForm, setCashForm] = useState({ recipientName: '', docType: 'CC', docNumber: '', phone: '', city: '' });
  const [cashReference, setCashReference] = useState('');
  const [payRecipientCode, setPayRecipientCode] = useState('');
  const [payRecipientUser, setPayRecipientUser] = useState<any>(null);
  const [payLookupStatus, setPayLookupStatus] = useState<'idle' | 'found' | 'not_found'>('idle');
  const [isPaySending, setIsPaySending] = useState(false);
  const [showPayVerify, setShowPayVerify] = useState(false);
  const [payVerifyCode, setPayVerifyCode] = useState('');
  const [payVerifyLoading, setPayVerifyLoading] = useState(false);
  const [payVerifyError, setPayVerifyError] = useState('');

  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editNickname, setEditNickname] = useState('');
  const [editAvatar, setEditAvatar] = useState<string | null>(null);
  const [featureModalData, setFeatureModalData] = useState({ title: '', desc: '', icon: MoreHorizontal });
  const [isFeatureModalOpen, setIsFeatureModalOpen] = useState(false);

  // Pay-Link Modal
  const [isPayLinkOpen, setIsPayLinkOpen] = useState(false);
  const [payLinkStep, setPayLinkStep] = useState(1);
  const [payLinkCountry, setPayLinkCountry] = useState('CO');
  const [payLinkAmount, setPayLinkAmount] = useState('');
  const [payLinkPayerName, setPayLinkPayerName] = useState('');
  const [payLinkDocType, setPayLinkDocType] = useState('CC');
  const [payLinkDocNumber, setPayLinkDocNumber] = useState('');
  const [payLinkUrl, setPayLinkUrl] = useState('');
  const [payLinkSecondsLeft, setPayLinkSecondsLeft] = useState(1800);

  // Legacy (kept for bank-data receive flow if needed)
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [receiveCurrency, setReceiveCurrency] = useState('USD');
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const { getRate, getFee, getFeeForAmount } = useExchangeRates();
  const { config } = useSystemConfig(); 
  const {
      getBalance,
      getPersonalMovements,
      getUserNotifications,
      markNotificationsRead,
      mergeNotifications,
      deleteNotification,
      clearNotifications,
      requestDeposit,
      requestWithdrawal,
      performConversion,
      sendCuypayPayment,
      currentUser,
      updateUserProfile,
      bankingOptions,
      getAllUsers,
      sendPasswordReset,
      enrollMFA,
      verifyMFAEnrollment,
      unenrollMFA,
      getMFAStatus,
      deleteUser,
      logoutUser,
      refreshData,
      bumpLocalBalance,
      addLocalTx,
  } = useDatabase();

  const isKycVerified = currentUser?.kycStatus === 'verified';
  const isInReview = currentUser?.kycStatus === 'in_review';
  // Lincoin web = producto EMPRESAS: aquí TODA cuenta es empresa y su
  // verificación es KYB (los clientes personales solo existen en la app
  // móvil). Por eso el copy de verificación se muestra siempre como KYB,
  // sin depender del rol guardado — que en cuentas viejas o creadas por
  // otra vía pudo quedar como 'personal' y hacía salir "KYC" por error.
  const isBusinessProduct = true;
  const isBlocked = currentUser?.isBlocked;
  const movements = getPersonalMovements();

  // ── Notificaciones automáticas (cuenta aprobada / pago completado / USDT
  //    recibido) con sonido + animación. Se generan del lado del cliente
  //    observando movimientos y contactos, y se deduplican con una lista
  //    PERSISTENTE de eventos ya avisados (`notifiedEvents`, guardada en el
  //    perfil). Así: (a) no vuelve a avisar el mismo evento cada vez que
  //    entras, y (b) si borras una notificación NO reaparece al recargar,
  //    porque su id sigue marcado como "ya avisado" aunque ya no esté en la
  //    lista visible. ──────────────────────────────────────────────────
  const [bellAnim, setBellAnim] = useState(false);
  // Celebración visible cuando llega un depósito (animación + sonido cha-ching).
  const [depositFx, setDepositFx] = useState<{ amount: number } | null>(null);
  const celebrateDeposit = (amount: number) => {
      setDepositFx({ amount });
      if ((currentUser as any)?.notifSound !== false) playDepositSound();
      setBellAnim(true);
      setTimeout(() => setBellAnim(false), 1200);
      setTimeout(() => setDepositFx(null), 4200);
  };
  useEffect(() => {
      if (!currentUser?.id) return;
      const cuAny: any = currentUser;
      const candidates: Array<{ id: string; type?: string; title: string; message: string }> = [];

      // Pago completado + USDT recibido (desde los movimientos)
      for (const m of movements as any[]) {
          const cur = String(m.currency ?? '');
          const isUsdt = /USDT|USD/i.test(cur);
          if (m.status === 'Completado' && m.type === 'send') {
              candidates.push({ id: `txdone-${m.id}`, type: 'success', title: 'Pago completado',
                  message: `Tu envío de ${formatMoney(m.amount, cur)} ${cur.split('_')[0]} se completó.` });
          }
          if (m.status === 'Completado' && (m.type === 'load' || m.type === 'otc_deposit') && isUsdt) {
              candidates.push({ id: `usdtin-${m.id}`, type: 'success', title: 'Recibiste USDT',
                  message: `Llegaron ${formatMoney(m.amount, cur)} ${cur.split('_')[0]} a tu wallet.` });
          }
      }

      // Cuenta (contacto) aprobada
      const contactsAll: any[] = [
          ...(Array.isArray(cuAny?.raw_data?.mouvContacts) ? cuAny.raw_data.mouvContacts : (Array.isArray(cuAny?.mouvContacts) ? cuAny.mouvContacts : [])),
          ...(Array.isArray(cuAny?.raw_data?.walletContacts) ? cuAny.raw_data.walletContacts : (Array.isArray(cuAny?.walletContacts) ? cuAny.walletContacts : [])),
      ];
      for (const c of contactsAll) {
          if (contactStatus(c) === 'aprobada') {
              candidates.push({ id: `contact-${c.id}`, type: 'success', title: 'Cuenta aprobada',
                  message: `La cuenta de ${c.name} quedó aprobada. Ya puedes transferirle.` });
          }
      }

      const existingNotifs = (Array.isArray(cuAny.notifications) ? cuAny.notifications : []) as any[];
      const notifiedEvents: string[] = Array.isArray(cuAny.notifiedEvents) ? cuAny.notifiedEvents : [];
      const seedDone = Array.isArray(cuAny.notifiedEvents);
      // "Ya avisado" = lo persistido + lo que aún está en la lista visible.
      const seen = new Set<string>([...notifiedEvents, ...existingNotifs.map((n: any) => String(n.id))]);

      // Primera vez (nunca sembrado): marcar TODO lo actual como ya avisado,
      // sin sonar ni mostrar nada — para no repetir el histórico ni revivir
      // lo que el usuario ya vio/borró.
      if (!seedDone) {
          const seedIds = Array.from(new Set([...seen, ...candidates.map(c => c.id)])).slice(-400);
          updateUserProfile(currentUser.id, { notifiedEvents: seedIds });
          return;
      }

      const fresh = candidates.filter(c => !seen.has(c.id));
      if (!fresh.length) return;

      const stamped = fresh.map(c => ({ type: 'success', read: false, date: new Date().toLocaleDateString('es-CO'), ...c }));
      const newNotifs = [...stamped, ...existingNotifs].slice(0, 50);
      const newSeen = Array.from(new Set([...notifiedEvents, ...fresh.map(c => c.id)])).slice(-400);
      // Una sola escritura (notificaciones + eventos avisados) para no pisar
      // una con la otra.
      updateUserProfile(currentUser.id, { notifications: newNotifs, notifiedEvents: newSeen });

      // El sonido se puede silenciar en Ajustes → Notificaciones (notifSound).
      if (cuAny?.notifSound !== false) playNotifSound();
      setBellAnim(true);
      setTimeout(() => setBellAnim(false), 1200);
      showToast(`🔔 ${fresh[0].title}: ${fresh[0].message}`, 5000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movements, currentUser?.id, currentUser?.notifications, currentUser?.notifiedEvents, currentUser?.raw_data]);

  // Cargar el saldo real de Mouv al abrir la billetera COP
  useEffect(() => {
    if (activeView !== 'wallet-detail' || selectedWalletCode !== 'COP' || !currentUser?.id) return;
    let alive = true;
    setMouvChecked(false);
    fetchMouvBalance(currentUser.id).then(v => {
      if (!alive) return;
      setMouvBal(v);
      setMouvChecked(true);
    });
    // Sincronizar el estado REAL de las órdenes de retiro desde Mouv (y de
    // paso limpiar duplicados de la misma orden). Así el estado que ve el
    // cliente lo dicta Mouv — se corrige solo tanto lo que ya salió (pasa a
    // Completado) como lo que estaba mal marcado (vuelve a Pendiente), sin
    // depender de que el webhook de Mouv haya llegado.
    callMouv('reconcile_withdrawals', currentUser.id)
      .then((r: any) => { if (alive && r?.reconciled > 0) refreshData?.(); })
      .catch(() => {});
    return () => { alive = false; };
  }, [activeView, selectedWalletCode, currentUser?.id]);
  // El convertidor GENERAL ya NO usa Mouv para nada — siempre tasa
  // FastForex (getRate) y comisión por tramos (getFeeForAmount), para
  // TODOS los pares, incluido USD↔COP. La conversión con tasa/comisión de
  // Mouv vive únicamente en "Servicios → OTC" (MouvSection), que es
  // la que de verdad ejecuta el 2-step contra la API y barre a la
  // recaudadora. Mezclarlas aquí era lo que causaba el "se dañó otra vez"
  // (esta pantalla ni siquiera ejecutaba Mouv — solo mostraba su tasa).
  const mouvCfg: { feePct: number; mouvOn: boolean } | null = null;
  const isMouvPair = false;

  const conversionRate = getRate(sourceCurr, targetCurr);
  const isLiveMouvRate = false;
  const notifications = getUserNotifications();
  const unreadNotifications = notifications.filter(n => !n.read).length;
  const allUsers = getAllUsers();

  const seasonEmojis = config.seasonEmojis || [];

  const formatMoney = (amount: number, currency: string) => {
      return new Intl.NumberFormat('es-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  };
  
  const formatInputNumber = (value: string) => {
      const cleanVal = value.replace(/\D/g, '');
      if (!cleanVal) return '';
      return new Intl.NumberFormat('es-DE').format(Number(cleanVal));
  };

  const getRawAmount = (val: string) => Number(val.replace(/\./g, ''));

  const fileToBase64 = (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = error => reject(error);
      });
  };

  // Redimensiona y comprime una imagen (para avatares): una foto de celular
  // pesa varios MB y guardarla completa en el perfil fallaba. Se reduce a
  // maxSize px y se exporta como JPEG liviano (~20-60 KB).
  const resizeImage = (file: File, maxSize = 256, quality = 0.85): Promise<string> => {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
              const img = new Image();
              img.onload = () => {
                  let { width, height } = img;
                  if (width >= height && width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; }
                  else if (height > width && height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; }
                  const canvas = document.createElement('canvas');
                  canvas.width = width; canvas.height = height;
                  const ctx = canvas.getContext('2d');
                  if (!ctx) { resolve(reader.result as string); return; }
                  ctx.drawImage(img, 0, 0, width, height);
                  try { resolve(canvas.toDataURL('image/jpeg', quality)); }
                  catch { resolve(reader.result as string); }
              };
              img.onerror = reject;
              img.src = reader.result as string;
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
      });
  };

  // Date for delivery estimate
  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + 1);
  const deliveryDateStr = deliveryDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });

  // Calculation for conversion. Usamos getFeeForAmount para que las comisiones
  // por tramos (tiers configurados en el admin) se apliquen según el volumen
  // de la operación. Si el par no tiene tiers, cae al flat fee legacy.
  const rawAmount = getRawAmount(convertAmountStr);
  // USD↔COP con Mouv ACTIVO (toggle del admin): manda la comisión del
  // Panel Mouv (fx_pair_config.base_fee_pct, ej. 0.25%), no la legacy.
  const applicableFeePercentage = (isMouvPair && mouvCfg?.mouvOn && mouvCfg.feePct > 0)
      ? mouvCfg.feePct
      : getFeeForAmount(sourceCurr, targetCurr, rawAmount);
  const baseFee = rawAmount * (applicableFeePercentage / 100);
  
  const discountMultiplier = appliedCoupon ? (100 - appliedCoupon.discount) / 100 : 1;
  const finalFee = baseFee * discountMultiplier;
  const amountToConvert = rawAmount - finalFee;
  const finalAmount = amountToConvert * conversionRate;

  // ── Regla de negocio de cupones ──
  // Con comisión promocional (<4%, ej. Mouv 0.25%) los cupones NO aplican:
  // el descuento dejaría la operación en margen cero o pérdida. Si el
  // usuario cambia a un par promocional con cupón puesto, se remueve solo.
  const COUPON_MIN_FEE_PCT = 4;
  const couponsAllowed = applicableFeePercentage >= COUPON_MIN_FEE_PCT;
  useEffect(() => {
      if (appliedCoupon && !couponsAllowed) {
          setAppliedCoupon(null);
          setCouponCode('');
          showToast(`Cupón removido: la comisión de esta conversión (${applicableFeePercentage}%) ya es una tarifa promocional.`);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [couponsAllowed, appliedCoupon]);

  useEffect(() => {
      const saved = localStorage.getItem('cuypay_wallet_order');
      if (saved) {
          try {
              const codes: string[] = JSON.parse(saved);
              setMyWallets(prev => {
                  const ordered = codes.map(c => prev.find(w => w.code === c)).filter(Boolean) as typeof prev;
                  const rest = prev.filter(w => !codes.includes(w.code));
                  return [...ordered, ...rest];
              });
          } catch {}
      }
  }, []);

  useEffect(() => {
      if (currentUser?.country && !localStorage.getItem('cuypay_wallet_order')) {
          const countryMap: Record<string, string> = {
              'Perú': 'PEN', 'Peru': 'PEN', 'Chile': 'CLP', 'Colombia': 'COP',
              'México': 'MXN', 'Mexico': 'MXN', 'Brasil': 'BRL', 'Brazil': 'BRL',
              'Venezuela': 'VES', 'Estados Unidos': 'USD'
          };
          const localCurrency = countryMap[currentUser.country] || 'USD';
          setMyWallets(prev => {
              const sorted = [...prev];
              const usdIdx = sorted.findIndex(w => w.code === 'USD');
              if (usdIdx > -1) { const [usd] = sorted.splice(usdIdx, 1); sorted.unshift(usd); }
              if (localCurrency !== 'USD') {
                  const localIdx = sorted.findIndex(w => w.code === localCurrency);
                  if (localIdx > -1) { const [local] = sorted.splice(localIdx, 1); sorted.unshift(local); }
              }
              return sorted;
          });
      }
  }, [currentUser]);

  const openWalletOrderModal = () => {
      setWalletDraftOrder(myWallets.map(w => w.code));
      setIsWalletOrderModalOpen(true);
  };
  const moveWalletInDraft = (index: number, dir: -1 | 1) => {
      setWalletDraftOrder(prev => {
          const next = [...prev];
          const swap = index + dir;
          if (swap < 0 || swap >= next.length) return prev;
          [next[index], next[swap]] = [next[swap], next[index]];
          return next;
      });
  };
  const saveWalletOrder = () => {
      const reordered = walletDraftOrder.map(code => myWallets.find(w => w.code === code)).filter(Boolean) as typeof myWallets;
      setMyWallets(reordered);
      localStorage.setItem('cuypay_wallet_order', JSON.stringify(walletDraftOrder));
      setIsWalletOrderModalOpen(false);
  };

  useEffect(() => {
    let interval: any;
    if (isLoadModalOpen && loadStep === 4 && timeLeft > 0) {
        interval = setInterval(() => {
            setTimeLeft((prev) => prev - 1);
        }, 1000);
    } else if (timeLeft === 0 && loadStep === 4) {
        closeModal();
        showToast("Tiempo agotado. La sesión de carga ha expirado.");
    }
    return () => clearInterval(interval);
  }, [isLoadModalOpen, loadStep, timeLeft]);

  const showToast = (msg: string, durationMs: number = 3000, type: 'success' | 'error' = 'success') => {
      setToastMessage(msg);
      setToastType(type);
      setTimeout(() => setToastMessage(null), durationMs);
  };

  const handleWalletClick = (code: string) => {
      setSelectedWalletCode(code);
      setMovementsTab('all');
      setActiveView('wallet-detail');
  };

  // When in_progress: poll get_status so DB stays synced even without a webhook.
  // DatabaseContext's 10 s polling picks up the updated kyc_status automatically.
  useEffect(() => {
    const isInProgress = currentUser?.kycStatus === 'in_progress';
    if (!isInProgress || !currentUser?.id) return;
    const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
    const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
    const poll = () => fetch(`${SURL}/functions/v1/didit-kyc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
      body: JSON.stringify({ action: 'get_status', userId: currentUser.id }),
    }).catch(() => {});
    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [currentUser?.kycStatus, currentUser?.id]);

  const startDiditKyc = async () => {
    if (!currentUser?.id || kycLoading) return;
    setKycLoading(true);
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      const r = await fetch(`${SURL}/functions/v1/didit-kyc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
        body: JSON.stringify({ action: 'create_session', userId: currentUser.id }),
      });
      const data = await r.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        showToast(data.error || 'Error al iniciar la verificación. Contacta soporte.', 5000, 'error');
      }
    } catch {
      showToast('Error de conexión. Intenta de nuevo.', 5000, 'error');
    }
    setKycLoading(false);
  };

  const handleActionRestricted = (requireKyc = true) => {
      if (isBlocked) {
          showToast("Tu cuenta está bloqueada. No puedes realizar esta acción.", 5000, 'error');
          return true;
      }
      if (requireKyc && !isKycVerified) {
          showToast(isBusinessProduct ? "Completa la verificación KYB de tu empresa para usar esta función." : "Completa tu verificación KYC para usar esta función.", 5000, 'error');
          return true;
      }
      return false;
  };

  // ── Cargar USDT (Dólar digital): depósito on-chain vía GasFree ──
  // El USD de la app NO se carga por banco: se envía USDT (TRC-20) a la
  // dirección personal del cliente (gasfree get_or_create) y al
  // detectarse el depósito (verify_and_credit) pasa 1:1 al saldo USD.
  const [usdtModalOpen, setUsdtModalOpen] = useState(false);
  const [usdtAddr, setUsdtAddr] = useState('');
  const [usdtLoadErr, setUsdtLoadErr] = useState<string | null>(null);
  const [usdtLoadingAddr, setUsdtLoadingAddr] = useState(false);
  const [usdtVerifying, setUsdtVerifying] = useState(false);

  // JWT de la sesión propia — lo exige gasfree para las acciones "my_*"
  // (nadie más que el propio usuario, ni con la llave pública, puede
  // pedir/gastar su wallet GasFree).
  const myAuthHeader = (): string => {
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      try {
          const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
          if (k) {
              const d = JSON.parse(localStorage.getItem(k) || '{}');
              if (d.access_token) return `Bearer ${d.access_token}`;
          }
      } catch { /* sin sesión supabase */ }
      return `Bearer ${SKEY}`;
  };
  const callGasfree = async (payload: Record<string, unknown>) => {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      const r = await fetch(`${SURL}/functions/v1/gasfree`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: myAuthHeader() },
          body: JSON.stringify(payload),
      });
      return r.json();
  };
  const callMouvProxy = async (payload: Record<string, unknown>) => {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      const r = await fetch(`${SURL}/functions/v1/mouv-proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: myAuthHeader() },
          body: JSON.stringify(payload),
      });
      return r.json();
  };

  // Cotización EN VIVO de la comisión de GasFree para el envío a wallet —
  // se pide justo al llegar a confirmar (varía: $1, $1.2, $1.5... según la
  // red, nunca se cachea ni se asume un valor fijo).
  const [gasfreeFeePreview, setGasfreeFeePreview] = useState<{ loading: boolean; feeUsdt?: number; transferFeeUsdt?: number; activateFeeUsdt?: number; error?: string }>({ loading: false });
  useEffect(() => {
      if (!(sendStep === 4 && sendMode === 'wallet' && currentUser?.id)) return;
      setGasfreeFeePreview({ loading: true });
      callGasfree({ action: 'my_status', userId: currentUser.id })
          .then(d => setGasfreeFeePreview(d?.feeQuote
              ? { loading: false, feeUsdt: d.feeQuote.totalFeeUsdt, transferFeeUsdt: d.feeQuote.transferFeeUsdt, activateFeeUsdt: d.feeQuote.activateFeeUsdt }
              : { loading: false, error: d?.error ?? 'No se pudo cotizar' }))
          .catch(e => setGasfreeFeePreview({ loading: false, error: String(e?.message ?? e) }));
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendStep, sendMode, currentUser?.id]);

  // Saldo REAL de la wallet GasFree (blockchain) — la billetera "USDT" ya
  // NO muestra el "Dólar digital" (el contable interno que se podía
  // desincronizar del saldo real y llevó al cliente a intentar enviar más
  // de lo que en verdad tenía). Mismo patrón que mouvBal para Peso Lincoin.
  const [gasfreeBal, setGasfreeBal] = useState<number | null>(null);
  const [gasfreeBalChecked, setGasfreeBalChecked] = useState(false);
  const refreshGasfreeBal = async (uid: string) => {
      setGasfreeBalChecked(false);
      try {
          const d = await callGasfree({ action: 'my_status', userId: uid });
          setGasfreeBal(typeof d?.balance === 'number' ? d.balance : null);
      } finally {
          setGasfreeBalChecked(true);
      }
  };
  useEffect(() => {
      if (!currentUser?.id) return;
      refreshGasfreeBal(currentUser.id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // Mientras el cliente tiene abierta la billetera USDT, se vigila la
  // llegada de un depósito nuevo: cada 15 s se refresca el saldo real de
  // GasFree Y se verifica/acredita en silencio (mismo endpoint que el
  // botón "Verificar" del modal de carga, sin necesidad de abrirlo). Así
  // el saldo y "Movimientos de esta cuenta" se actualizan solos apenas
  // llega el USDT, sin que el cliente tenga que recargar la página.
  useEffect(() => {
      // Se vigila la llegada de depósitos tanto en el DETALLE de la billetera
      // USDT como en el INICIO (donde está la tarjeta USDT) — así el saldo se
      // actualiza solo sin que el cliente tenga que recargar la página.
      const onUsdDetail = activeView === 'wallet-detail' && selectedWalletCode === 'USD';
      const onDashboard = activeView === 'dashboard';
      if (!((onUsdDetail || onDashboard) && currentUser?.id)) return;
      const uid = currentUser.id;
      let alive = true;
      const poll = async () => {
          await refreshGasfreeBal(uid);
          try {
              const d = await callGasfree({ action: 'my_verify_deposit', userId: uid });
              if (!alive) return;
              const credited = Number(d?.credited ?? 0);
              if (d?.synced && credited > 0) {
                  refreshData?.();
                  refreshGasfreeBal(uid);
                  celebrateDeposit(credited);
                  showToast(`✅ Depósito detectado: +${credited.toLocaleString('en-US')} USDT`);
              }
          } catch { /* silencioso — es un poll en segundo plano, no una acción del usuario */ }
      };
      poll(); // una verificación inmediata al entrar/cambiar de vista
      const t = setInterval(poll, 15000);
      return () => { alive = false; clearInterval(t); };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, selectedWalletCode, currentUser?.id]);

  // Saldo a MOSTRAR para una billetera: para USD es el real de GasFree
  // (blockchain); para las demás, el saldo interno de siempre.
  // USD (Dólar digital): el saldo REAL es el on-chain de GasFree una vez leído
  // (gasfreeBal). Mientras carga, se usa el de la BD. No se usa Math.max para no
  // "congelar" un valor sobre-acreditado por pruebas — la verdad es la cadena.
  const displayBalance = (code: string): number =>
    code === 'USD' ? (gasfreeBalChecked ? Number(gasfreeBal ?? 0) : Number(getBalance('USD') ?? 0)) : getBalance(code);

  const openUsdtDeposit = async () => {
      if (!currentUser?.id) return;
      setUsdtModalOpen(true);
      if (usdtAddr) return;
      // La dirección GasFree es SIEMPRE la misma (determinista) — si ya
      // quedó guardada en el perfil (anidada o aplanada), se usa YA, sin
      // tocar la red. Nada de volver a "generar" cada vez que se abre.
      const cu: any = currentUser as any;
      const cached = cu?.raw_data?.gasfreeAddress ?? cu?.gasfreeAddress ?? null;
      if (cached) { setUsdtAddr(cached); return; }
      setUsdtLoadingAddr(true);
      setUsdtLoadErr(null);
      try {
          const d = await callGasfree({ action: 'my_status', userId: currentUser.id });
          if (d.gasFreeAddress) setUsdtAddr(d.gasFreeAddress);
          else setUsdtLoadErr(d.error ?? 'No se pudo generar tu dirección GasFree.');
      } catch (e: any) {
          setUsdtLoadErr(String(e?.message ?? e));
      }
      setUsdtLoadingAddr(false);
  };

  const verifyUsdtDeposit = async () => {
      if (!currentUser?.id || usdtVerifying) return;
      setUsdtVerifying(true);
      try {
          const d = await callGasfree({ action: 'my_verify_deposit', userId: currentUser.id });
          const credited = Number(d?.credited ?? 0);
          if (d?.synced && credited > 0) {
              // El servidor ya acreditó balances.USD — refrescamos la vista + saldo on-chain
              refreshData?.();
              if (currentUser?.id) refreshGasfreeBal(currentUser.id);
              celebrateDeposit(credited);
              showToast(`✅ Depósito detectado: +${credited.toLocaleString('en-US')} USDT en tu Dólar digital`);
              setUsdtModalOpen(false);
          } else if (d?.error) {
              showToast(`Error verificando: ${d.error}`, 6000, 'error');
          } else {
              showToast(d?.reason || 'Aún no se detecta el depósito. La red puede tardar unos minutos — vuelve a verificar.', 8000);
          }
      } catch (e: any) {
          showToast(`Error verificando: ${String(e?.message ?? e)}`, 5000, 'error');
      }
      setUsdtVerifying(false);
  };

  // ── Consolidación del Dólar digital ──
  // El saldo USD visible ES el agregado de dólares digitales: cualquier
  // USDT que quede en el libro cripto (USDT_TRON/USDT_BSC/USDT — llegan
  // por webhook de GasFree, OTC o verificación) pasa solo, 1:1, al saldo
  // USD. Sin esto, un depósito acreditado como USDT_TRON quedaba
  // invisible en la tarjeta Dólar.
  const usdtConsolidatingRef = useRef(false);
  useEffect(() => {
      if (!currentUser?.id || usdtConsolidatingRef.current) return;
      const keys = ['USDT_TRON', 'USDT_BSC', 'USDT'];
      const total = keys.reduce((s, k) => s + (Number(getBalance(k)) || 0), 0);
      if (total < 0.000001) return;
      usdtConsolidatingRef.current = true;
      (async () => {
          try {
              const newBalances: Record<string, number> = { USD: getBalance('USD') + total };
              for (const k of keys) if ((Number(getBalance(k)) || 0) > 0) newBalances[k] = 0;
              await updateUserProfile(currentUser.id, { balances: newBalances });
              try {
                  await supabase.from('transactions').insert({
                      user_id: currentUser.id,
                      type: 'load', amount: total, currency: 'USD', status: 'Completado',
                      raw_data: {
                          initials: '₮', title: 'USDT acreditados al Dólar digital',
                          date: new Date().toLocaleDateString('es-CO'), createdAt: new Date().toISOString(),
                          userName: currentUser.name, source: 'USDT_CONSOLIDATION',
                      },
                  });
              } catch { /* el saldo es la fuente de verdad */ }
              showToast(`+${total.toLocaleString('en-US')} USDT acreditados a tu Dólar digital ⚡`);
          } finally {
              usdtConsolidatingRef.current = false;
          }
      })();
  }, [currentUser?.id, currentUser?.balances]);

  const handleLoadClick = (walletCode: string) => {
      if (handleActionRestricted(false)) return;
      // USD (Dólar digital) se carga con USDT on-chain, no por banco.
      if (walletCode === 'USD') { openUsdtDeposit(); return; }
      const countryMap: Record<string, string> = {
          'COP': 'Colombia', 'CLP': 'Chile', 'PEN': 'Perú',
          'MXN': 'México', 'BRL': 'Brasil', 'VES': 'Venezuela'
      };
      if (countryMap[walletCode]) {
          setSelectedCountry(countryMap[walletCode]);
          setLoadStep(2);
      } else {
          setLoadStep(1);
      }
      setIsLoadModalOpen(true);
      setTimeLeft(300);
  };

  const handleBankSelect = (bankName: string) => {
      setSelectedBankName(bankName);
      setLoadStep(3);
  };

  const handleAmountConfirm = () => {
      const rawAmount = getRawAmount(loadAmount);
      if (!loadAmount || isNaN(rawAmount) || rawAmount <= 0) {
          showToast("Ingresa un monto válido", 3000, 'error');
          return;
      }
      setLoadStep(4);
  };

  const handleLoadSubmit = async () => {
      const numericAmount = getRawAmount(loadAmount);
      let currency = 'CLP';
      if (selectedCountry === 'Colombia') currency = 'COP';
      else if (selectedCountry === 'Perú') currency = 'PEN';
      else if (selectedCountry === 'México') currency = 'MXN';
      else if (selectedCountry === 'Brasil') currency = 'BRL';
      else if (selectedCountry === 'Venezuela') currency = 'VES';
      else if (selectedCountry === 'Estados Unidos') currency = 'USD';

      let proofUrl = 'base64_placeholder';
      if (proofFile) {
          try {
              proofUrl = await fileToBase64(proofFile);
          } catch (error) {
              console.error("Error reading file", error);
          }
      }
      requestDeposit(numericAmount, currency, selectedBankName, proofUrl);
      closeModal();
      showToast(`Solicitud de carga de ${formatMoney(numericAmount, currency)} ${currency} enviada.`);
  };

  const handleApplyCoupon = () => {
      if (!couponsAllowed) {
          showToast(`Cupones no válidos para esta conversión: la comisión actual (${applicableFeePercentage}%) ya es una tarifa promocional.`, 6000, 'error');
          return;
      }
      const found = (config.coupons || []).find((c: any) => c.code === couponCode.toUpperCase() && c.active);
      if (found) {
          setAppliedCoupon(found);
          setShowCouponInput(false);
          showToast(`Cupón ${found.code} aplicado: ${found.discount}% descuento`);
      } else {
          showToast("Cupón no válido o expirado.", 3000, 'error');
      }
  };

  const handleConvertSubmit = () => {
      if (!rawAmount || rawAmount <= 0) return;
      const currentBalance = getBalance(sourceCurr);
      if (currentBalance < rawAmount) {
          showToast(`Saldo insuficiente en ${sourceCurr}.`, 3000, 'error');
          return;
      }
      setIsConverting(true);
      const convTimeout = new Promise<{ error: string }>(resolve =>
          setTimeout(() => resolve({ error: 'Tiempo de espera agotado. Intenta de nuevo.' }), 12000)
      );
      Promise.race([
          performConversion(sourceCurr, targetCurr, rawAmount, finalAmount, finalFee, appliedCoupon?.code),
          convTimeout,
      ]).then((result) => {
          setIsConverting(false);
          if (result?.error) {
              showToast(result.error, 4000, 'error');
          } else {
              closeConvertModal();
              showToast(`Conversión exitosa. Has recibido ${formatMoney(finalAmount, targetCurr)} ${targetCurr}`);
          }
      }).catch(() => { setIsConverting(false); showToast('Error al procesar la conversión.', 4000, 'error'); });
  };

  const handleSendNext = () => {
      if (sendStep === 1) {
          const rawAmount = getRawAmount(sendForm.amount);
          if (!sendForm.amount || rawAmount <= 0) {
              showToast("Por favor ingresa un monto válido.", 3000, 'error');
              return;
          }
          const currentBalance = sendForm.destinationCurrency === 'COP' ? getBalance(sendSourceRail) : displayBalance(sendForm.destinationCurrency);
          if (currentBalance < rawAmount) {
              const railName = sendSourceRail === 'COP' ? 'Saldo Lincoin' : sendSourceRail === 'COP_BREB' ? 'Bre-B' : 'ACH';
              showToast(sendForm.destinationCurrency === 'COP' ? `Saldo insuficiente en ${railName}.` : `Saldo insuficiente en ${sendForm.destinationCurrency === 'USD' ? 'USDT' : sendForm.destinationCurrency}.`, 3000, 'error');
              return;
          }
          // Beneficiario preseleccionado (botón "Enviar" de Beneficiarios):
          // ya se sabe destino y método — del monto directo a confirmar.
          if (sendContact && sendMode && sendForm.beneficiaryName) { setSendStep(4); return; }
          // USDT: único método es wallet — directo al destinatario.
          if (sendForm.destinationCurrency === 'USD') { setSendMode('wallet'); setSendStep(3); return; }
          setSendStep(2); // → method selection
      } else if (sendStep === 3 && sendMode === 'bank') {
          if (!sendForm.beneficiaryName || !sendForm.documentNumber || !sendForm.accountNumber) {
              showToast("Completa todos los campos obligatorios.", 3000, 'error');
              return;
          }
          setSendStep(4);
      }
  };

  const handlePayLookup = (code: string) => {
      const upper = code.toUpperCase();
      setPayRecipientCode(upper);
      if (upper.length < 4) { setPayRecipientUser(null); setPayLookupStatus('idle'); return; }
      const allUsers = getAllUsers();
      const found = allUsers.find(u => u.ownReferralCode?.toUpperCase() === upper && u.id !== currentUser?.id);
      if (found) { setPayRecipientUser(found); setPayLookupStatus('found'); }
      else { setPayRecipientUser(null); setPayLookupStatus('not_found'); }
  };

  const executePay = async () => {
      if (!payRecipientUser) return;
      setIsPaySending(true);
      try {
          const timeout = new Promise<{ error: string }>(resolve =>
              setTimeout(() => resolve({ error: 'Tiempo de espera agotado. Intenta de nuevo.' }), 30000)
          );
          const result = await Promise.race([
              sendCuypayPayment(payRecipientUser.ownReferralCode, getRawAmount(sendForm.amount), sendForm.destinationCurrency),
              timeout,
          ]);
          if (result?.error) { showToast(result.error, 4000, 'error'); }
          else { setSendStep(4); }
      } catch { showToast('Error al procesar el pago', 4000, 'error'); }
      finally { setIsPaySending(false); }
  };

  const handlePaySubmit = () => {
      if (isPaySending || payLookupStatus !== 'found' || !payRecipientUser) return;
      if (mfaEnrolled) {
          setPayVerifyCode('');
          setPayVerifyError('');
          setShowPayVerify(true);
      } else {
          executePay();
      }
  };

  const handlePayVerifyAndSend = async () => {
      if (payVerifyLoading || payVerifyCode.length !== 6 || !payRecipientUser) return;
      setPayVerifyLoading(true);
      setPayVerifyError('');
      const { ok, error: mfaErr } = await verifyMFAEnrollment(mfaFactorId ?? 'local', payVerifyCode, mfaTotpSecret);
      if (!ok) {
          setPayVerifyLoading(false);
          setPayVerifyError(mfaErr || 'Código incorrecto. Intenta nuevamente.');
          setPayVerifyCode('');
          return;
      }
      setShowPayVerify(false);
      setPayVerifyLoading(false);
      await executePay();
  };

  const handleCashSubmit = () => {
      if (isSending || sendingRef.current) return;
      sendingRef.current = true;
      const ref = 'CASH-' + Math.random().toString(36).slice(2, 7).toUpperCase();
      setIsSending(true);
      requestWithdrawal(
          getRawAmount(sendForm.amount),
          sendForm.destinationCurrency,
          'Punto Físico',
          cashForm.docNumber,
          cashForm.recipientName,
          `Retiro en punto físico — ${cashForm.city}`,
          cashForm.docType,
          cashForm.docNumber
      ).then(() => {
          setCashReference(ref);
          sendingRef.current = false;
          setIsSending(false);
          setSendStep(5);
      }).catch(() => {
          sendingRef.current = false;
          setIsSending(false);
          showToast('Error al procesar el retiro.', 4000, 'error');
      });
  };

  const handleSendSubmit = async () => {
      if (isSending || sendingRef.current || mouvUnknown) return;
      sendingRef.current = true;
      setIsSending(true);
      const amount = getRawAmount(sendForm.amount);

      // ── Dispersión REAL vía Mouv (envíos COP a banco/llave) ──
      // El riel lo determina el TIPO de destino: contacto Bre-B → payout_breb
      // (debita COP_BREB) · contacto ACH/cuenta → payout_ach (debita COP_ACH).
      // Todo el asentamiento (validar saldo interno → debitar → llamar a Mouv
      // /transfers/send → REINTEGRAR si falla) lo hace el edge mouv-proxy, así
      // que NUNCA queda saldo descontado sin transferencia.
      if (sendMode === 'bank' && sendForm.destinationCurrency === 'COP' && currentUser?.id) {
          const isBreb = (sendContact?.destKind ?? 'ach') === 'breb';
          const rail = isBreb ? 'COP_BREB' : 'COP_ACH';
          if (getBalance(rail) < amount) {
              sendingRef.current = false; setIsSending(false);
              showToast(`Saldo insuficiente en ${isBreb ? 'Bre-B' : 'ACH'} para esta dispersión.`, 6000, 'error');
              return;
          }
          const recipient = isBreb
              ? { keyType: sendContact?.brebKeyType ?? 'celular', key: sendContact?.brebKey ?? sendContact?.accountNumber ?? sendForm.accountNumber, holderName: sendForm.beneficiaryName, documentNumber: sendForm.documentNumber, reference: sendForm.reason }
              : { bankCode: sendContact?.bank ?? sendForm.bankName, accountType: (sendContact?.accountType === 'checking' ? 'corriente' : 'ahorros'), accountNumber: sendForm.accountNumber, documentType: sendForm.documentType, documentNumber: sendForm.documentNumber, holderName: sendForm.beneficiaryName, reference: sendForm.reason };
          try {
              const r = await Promise.race([
                  callMouvProxy({ action: isBreb ? 'payout_breb' : 'payout_ach', userId: currentUser.id, amount, recipient }),
                  new Promise<any>((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000)),
              ]);
              if (r?.ok) {
                  sendingRef.current = false; setIsSending(false); setSendStep(5);
                  refreshData?.();
                  return;
              }
              // Falló o aún sin cablear → el edge YA reintegró el saldo (refunded).
              sendingRef.current = false; setIsSending(false);
              const msg = r?.message || r?.error || 'La dispersión no se pudo completar.';
              showToast(msg, 11000, 'error');
              if (r?.refunded) refreshData?.();
              return;
          } catch {
              // Timeout: NO sabemos si Mouv la creó → bloquear reintento.
              sendingRef.current = false; setIsSending(false); setMouvUnknown(true);
              showToast('La conexión tardó demasiado y NO se sabe si la dispersión salió. Revisa tu Historial antes de reintentar — NO vuelvas a enviar todavía.', 12000);
              return;
          }
      }

      // ── Envío REAL a wallet externa: USDT sale de la wallet GasFree
      // PROPIA del cliente (la misma "cajita" donde recibe sus depósitos),
      // NO de la recaudadora — nunca se mueve dinero de otro cliente ni de
      // tesorería para pagar un envío ajeno. No hay nada que debitar ni
      // devolver en el libro: el saldo mostrado YA es el real on-chain, así
      // que tras un envío exitoso simplemente se refresca.
      if (sendMode === 'wallet' && currentUser?.id) {
          try {
              const resp = await Promise.race([
                  callGasfree({ action: 'my_send', userId: currentUser.id, toAddress: sendForm.accountNumber, amount }),
                  new Promise<any>((_, rej) => setTimeout(() => rej(new Error('timeout')), 90000)),
              ]);
              if (resp?.error || !resp?.traceId) {
                  sendingRef.current = false;
                  setIsSending(false);
                  showToast(`No se pudo enviar: ${String(resp?.error ?? JSON.stringify(resp)).slice(0, 160)} — no se debitó tu saldo.`, 10000, 'error');
                  return;
              }
              sendingRef.current = false;
              setIsSending(false);
              setSendStep(5);
              const activateBreakdown = resp.activateFeeUsdt ? ` (incluye ${Number(resp.activateFeeUsdt).toFixed(2)} USDT de activación, solo esta vez)` : '';
              showToast(`✅ Enviado. Comisión GasFree cobrada: ${Number(resp.feeChargedUsdt ?? 0).toFixed(2)} USDT${activateBreakdown}`, 9000);
              refreshGasfreeBal(currentUser.id);
              refreshData?.();
              return;
          } catch {
              sendingRef.current = false;
              setIsSending(false);
              setMouvUnknown(true);
              showToast('La red tardó demasiado y NO se sabe si el envío salió. Revisa tu Historial (o la wallet destino en Tronscan) antes de reintentar.', 12000);
              return;
          }
      }

      // ── Resto de países / métodos: flujo interno de siempre ──
      const sendTimeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 12000));
      Promise.race([
          requestWithdrawal(
              amount,
              sendForm.destinationCurrency,
              sendForm.destinationCountry === 'Brasil' ? 'PIX System' : sendForm.bankName,
              sendForm.accountNumber,
              sendForm.beneficiaryName,
              sendForm.reason,
              sendForm.documentType,
              sendForm.documentNumber,
              sendForm.destinationCurrency === 'COP' ? sendSourceRail : undefined
          ),
          sendTimeout,
      ]).then(() => { sendingRef.current = false; setIsSending(false); setSendStep(5); })
        .catch(() => { sendingRef.current = false; setIsSending(false); showToast('Error al procesar el envío.', 4000, 'error'); });
  };

  const handleNotificationsClick = () => {
      // Solo abre/cierra el panel. Marcar como leído es una acción explícita
      // (botón "Marcar como leído") — así el usuario controla el punto de
      // "no leídas" en vez de que desaparezca solo al abrir.
      setShowNotifications(!showNotifications);
  };

  const closeModal = () => {
      setIsLoadModalOpen(false);
      setLoadStep(1);
      setProofFile(null);
      setSelectedCountry('');
      setSelectedBankName('');
      setLoadAmount('');
  };

  const closeConvertModal = () => {
      setIsConvertModalOpen(false);
      setConvertAmountStr('1.000');
      setShowConvertDetails(false);
      setAppliedCoupon(null);
      setCouponCode('');
      setShowCouponInput(false);
  };

  const closeSendModal = () => {
      setIsSendModalOpen(false);
      setSendStep(1);
      setSendMode(null);
      setPayRecipientCode('');
      setPayRecipientUser(null);
      setPayLookupStatus('idle');
      setSendForm({ ...sendForm, amount: '', beneficiaryName: '', accountNumber: '', reason: 'Envío de dinero', bankName: '' });
      setCashForm({ recipientName: '', docType: 'CC', docNumber: '', phone: '', city: '' });
      setCashReference('');
      setMouvDestId(null);
      setMouvUnknown(false);
      sendingRef.current = false;
      setContactSearch('');
      setSendSourceRail('COP');
      setSendContact(null);
      setSendMethodSel(null);
  };

  const handleEditProfileClick = () => {
      setEditName(currentUser?.name || '');
      setEditNickname(currentUser?.nickname || '');
      setEditAvatar(currentUser?.avatarUrl || null);
      setIsEditProfileModalOpen(true);
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) { showToast('Selecciona una imagen', 3000, 'error'); return; }
      try {
          const base64 = await resizeImage(file, 256, 0.85);
          setEditAvatar(base64);
      } catch (error) {
          console.error('Error al procesar la imagen', error);
          showToast('No se pudo procesar la imagen. Prueba con otra.', 4000, 'error');
      } finally {
          // Permite volver a elegir la MISMA foto (si no, onChange no dispara 2ª vez)
          e.target.value = '';
      }
  };

  const handleSaveProfile = async () => {
      if (!currentUser) return;
      const profile = { name: editName, nickname: editNickname, avatarUrl: editAvatar || undefined };
      // Estado local inmediato + intento directo
      updateUserProfile(currentUser.id, profile);
      setIsEditProfileModalOpen(false);
      showToast("Perfil actualizado");
      // Persistencia CONFIABLE vía servidor (service role) — funciona aunque
      // la sesión no tenga JWT real, igual que la lectura de movimientos.
      try {
          const SURL = (import.meta as any).env?.VITE_SUPABASE_URL || '';
          const SKEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';
          let tok = SKEY;
          try { const k = Object.keys(localStorage).find(x => x.startsWith('sb-') && x.endsWith('-auth-token')); if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) tok = d.access_token; } } catch {}
          await fetch(`${SURL}/functions/v1/gasfree`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tok}` },
              body: JSON.stringify({ action: 'my_save_profile', userId: currentUser.id, profile }),
          });
          refreshData?.();
      } catch { /* red flaky */ }
  };
  
  const handleFeatureClick = (title: string, desc: string, icon: any) => {
      setFeatureModalData({ title, desc, icon });
      setIsFeatureModalOpen(true);
  };

  // Las conversiones OTC (Mouv) guardan el monto en la moneda DESTINO
  // (lo que el cliente RECIBE, ej. COP) — a diferencia del convertidor
  // general, que guarda la moneda de ORIGEN (lo que se debita). Por eso
  // una conversión Mouv SÍ es un crédito visualmente y las demás no.
  const isTxCredit = (t: any): boolean =>
      t.type === 'load' || t.type === 'referral_payout' || t.type === 'pay_received' || t.type === 'otc_deposit'
      || (t.type === 'convert' && (t.source === 'MOUV' || t.raw_data?.source === 'MOUV'));

  const baseCurrency = (c?: string) => String(c || '').split('_')[0];

  // ── Metadatos de fila para las listas de movimientos ─────────────────
  // Muchas transacciones vienen del servidor SIN initials/title/date (las
  // inserta el edge). Aquí se derivan SIEMPRE: título por tipo, subtítulo
  // (beneficiario en dispersiones/envíos, fecha en el resto) e ícono real
  // en vez del cuadro gris con iniciales vacías.
  const ROW_LABELS: Record<string, string> = {
    convert: 'Conversión', load: 'Carga de saldo', send: 'Envío / Retiro',
    pay_sent: 'Pago enviado', pay_received: 'Pago recibido',
    otc_deposit: 'Depósito cripto', otc_withdraw: 'Retiro cripto',
    dispersion: 'Dispersión', adjustment: 'Ajuste de saldo',
    breb_move: 'Movimiento entre cuentas', referral_payout: 'Bono de referido',
  };
  const txRowMeta = (tx: any): { title: string; sub: string; Icon: React.ElementType } => {
    const title = tx.title || ROW_LABELS[tx.type] || tx.type;
    const dt = tx.createdAt ? new Date(tx.createdAt) : null;
    const dateStr = tx.date || (dt ? dt.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '');
    const beneficiary = tx.beneficiary || tx.recipient?.holderName || '';
    const sub = beneficiary ? `a ${beneficiary}${dateStr ? ` · ${dateStr}` : ''}` : dateStr;
    const Icon: React.ElementType =
      tx.type === 'dispersion' ? (tx.currency === 'COP_ACH' ? Landmark : Zap)
      : tx.type === 'load' ? ArrowDownLeft
      : tx.type === 'send' || tx.type === 'pay_sent' ? Send
      : tx.type === 'pay_received' || tx.type === 'referral_payout' ? ArrowDownLeft
      : tx.type === 'convert' ? RefreshCw
      : tx.type === 'breb_move' ? ArrowLeftRight
      : tx.type === 'adjustment' ? Wallet
      : tx.type === 'otc_deposit' ? ArrowDownLeft
      : tx.type === 'otc_withdraw' ? Send
      : ArrowLeftRight;
    return { title, sub, Icon };
  };
  const getFilteredMovements = (walletCode?: string | null, opts?: { full?: boolean }) => {
      let filtered = movements;
      if (walletCode) filtered = filtered.filter(tx => tx.currency === walletCode);
      if (movementsTab === 'income') filtered = filtered.filter(tx => tx.type === 'load' || tx.type === 'receive' || tx.type === 'convert' || tx.type === 'pay_received' || tx.type === 'referral_payout' || tx.type === 'referral_commission');
      else if (movementsTab === 'expense') filtered = filtered.filter(tx => tx.type === 'send' || tx.type === 'pay_sent');
      // Filtros avanzados (solo en el Historial completo): estado, moneda,
      // rango de fechas y buscador.
      if (opts?.full) {
          if (movStatus !== 'all') filtered = filtered.filter(tx => String(tx.status || '') === movStatus);
          if (movType === 'send') filtered = filtered.filter(tx => tx.type === 'send' || tx.type === 'pay_sent');
          else if (movType === 'load') filtered = filtered.filter(tx => tx.type === 'load' || tx.type === 'otc_deposit' || tx.type === 'pay_received');
          else if (movType === 'convert') filtered = filtered.filter(tx => tx.type === 'convert');
          if (movCurrency !== 'all') filtered = filtered.filter(tx => baseCurrency(tx.currency) === movCurrency);
          if (movDateFrom) { const f = new Date(`${movDateFrom}T00:00:00`); filtered = filtered.filter(tx => { const d = tx.createdAt ? new Date(tx.createdAt) : null; return d ? d >= f : true; }); }
          if (movDateTo) { const t = new Date(`${movDateTo}T23:59:59`); filtered = filtered.filter(tx => { const d = tx.createdAt ? new Date(tx.createdAt) : null; return d ? d <= t : true; }); }
          const q = movSearch.trim().toLowerCase();
          if (q) filtered = filtered.filter(tx => [tx.title, tx.beneficiary, tx.bank, tx.reason, String(tx.amount), tx.currency, tx.status]
              .filter(Boolean).join(' ').toLowerCase().includes(q));
      }
      return filtered;
  };
  const movActiveFilters = (movStatus !== 'all' ? 1 : 0) + (movCurrency !== 'all' ? 1 : 0) + (movDateFrom || movDateTo ? 1 : 0) + (movType !== 'all' ? 1 : 0);
  const movClearFilters = () => { setMovStatus('all'); setMovCurrency('all'); setMovDateFrom(''); setMovDateTo(''); setMovType('all'); };
  // Badge de estado para las filas de movimientos
  const movStatusStyle = (s: string) => s === 'Completado' ? 'bg-green-50 text-green-700 border-green-200'
      : s === 'Rechazado' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200';
  const movStatusLabel = (s: string) => s === 'Completado' ? 'Completado' : s === 'Rechazado' ? 'Rechazado' : 'Pendiente';
  
  const handleConvertInput = (e: React.ChangeEvent<HTMLInputElement>) => { setConvertAmountStr(formatInputNumber(e.target.value)); };

  const myReferrals = (allUsers || []).filter(u => u.referredBy === currentUser?.id);

  const renderDashboard = () => {
      const displayedWallets = showAllWallets ? myWallets : myWallets.slice(0, 3);

      return (
      <div className="space-y-10 animate-in fade-in duration-500 pt-6">
          <div className="flex justify-between items-center mb-8">
              <div>
                  <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.8px', color: '#F4F4F2' }}>Tus cuentas</h1>
                  <p className="font-medium" style={{ color: '#878E88', fontSize: 14, marginTop: 5, textTransform: 'capitalize' }}>
                      {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
                      {(currentUser?.companyName || currentUser?.name) ? ` · ${currentUser?.role === 'business' ? (currentUser?.companyName || currentUser?.name) : currentUser?.name}` : ''}
                  </p>
              </div>
              <div className="flex items-center gap-4 relative">
                  {/* Identidad de la sesión SIEMPRE visible — los magic links de los
                      correos de verificación inician sesión sin contraseña y esto
                      hace obvio con qué cuenta quedaste. */}
                  <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs max-w-[220px]" style={{ background: '#121413', border: '1px solid rgba(255,255,255,0.09)' }}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#4ADE80' }}></span>
                      <span className="truncate font-bold" style={{ color: '#F4F4F2' }}>{currentUser?.email}</span>
                  </span>
                  <button onClick={handleNotificationsClick} className={`w-10 h-10 rounded-[9px] flex items-center justify-center transition-all relative ${bellAnim ? 'animate-bounce' : ''}`} style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.11)', color: bellAnim ? '#4ADE80' : '#F4F4F2' }}>
                      <Bell size={19} />
                      {unreadNotifications > 0 && <span className={`absolute w-2.5 h-2.5 rounded-full ${bellAnim ? 'animate-ping' : ''}`} style={{ top: 8, right: 9, background: '#4ADE80', border: '1.5px solid #0A0C0B' }}></span>}
                  </button>
                  {showNotifications && (
                      <div className="absolute top-full right-0 mt-3 w-80 rounded-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 origin-top-right" style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', boxShadow: '0 24px 60px rgba(0,0,0,0.6)' }}>
                          <div className="p-4 flex justify-between items-center" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                              <span className="font-bold text-sm" style={{ color: '#F4F4F2' }}>Notificaciones</span>
                              <div className="flex items-center gap-3">
                                  {unreadNotifications > 0 && (
                                      <button onClick={() => markNotificationsRead()} className="text-[11px] font-bold hover:underline transition-colors" style={{ color: '#4ADE80' }}>Marcar como leído</button>
                                  )}
                                  <button onClick={() => setShowNotifications(false)}><X size={16} style={{ color: '#878E88' }}/></button>
                              </div>
                          </div>
                          <div className="max-h-64 overflow-y-auto p-2">
                              {notifications.length > 0 ? notifications.map(n => (
                                  <div key={n.id} className={`group p-3 rounded-lg transition-colors mb-1 hover:bg-white/[0.03] animate-in fade-in slide-in-from-top-1 duration-300 ${n.read ? 'opacity-60' : ''}`}>
                                      <div className="flex gap-3">
                                          <div className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: n.read ? '#878E88' : n.type === 'success' ? '#4ADE80' : '#EF4444' }}></div>
                                          <div className="flex-1 min-w-0">
                                              <p className={`text-xs ${n.read ? 'font-semibold' : 'font-bold'}`} style={{ color: '#F4F4F2' }}>{n.title}</p>
                                              <p className="text-xs mt-0.5" style={{ color: '#878E88' }}>{n.message}</p>
                                              <p className="text-[10px] mt-1" style={{ color: '#878E88' }}>{n.date}</p>
                                          </div>
                                          <button
                                              onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                                              className="shrink-0 hover:text-red-500 active:text-red-600 transition-colors self-start p-1"
                                              style={{ color: '#878E88' }}
                                              title="Eliminar notificación"
                                          >
                                              <Trash2 size={14} />
                                          </button>
                                      </div>
                                  </div>
                              )) : (
                                  <div className="p-6 text-center text-xs" style={{ color: '#878E88' }}>Sin notificaciones</div>
                              )}
                          </div>
                      </div>
                  )}
                  
                  <div className="relative group">
                      <button onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)} className="flex items-center gap-2.5 pl-1 pr-2.5 py-1 rounded-full transition-all" style={{ background: '#121413', border: '1px solid rgba(255,255,255,0.09)' }}>
                          <div className="w-7 h-7 rounded-[7px] flex items-center justify-center font-extrabold text-xs overflow-hidden" style={{ background: 'linear-gradient(140deg, #2E3330, #1A1D1B)', border: '1px solid rgba(255,255,255,0.1)', color: '#F4F4F2' }}>
                              {currentUser?.avatarUrl ? <img src={currentUser.avatarUrl} className="w-full h-full object-cover"/> : (currentUser?.name?.charAt(0) ?? '?').toUpperCase()}
                          </div>
                          <ChevronDown size={13} style={{ color: '#878E88' }}/>
                      </button>

                      {isProfileMenuOpen && (
                          <div className="absolute top-full right-0 mt-3 w-56 rounded-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 origin-top-right" style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', boxShadow: '0 24px 60px rgba(0,0,0,0.6)' }}>
                              <div className="p-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#878E88' }}>Cuenta</p>
                                  <p className="text-sm font-bold truncate" style={{ color: '#F4F4F2' }}>{currentUser?.email}</p>
                              </div>
                              <div className="p-2 space-y-1">
                                  <button onClick={() => { setActiveView('profile'); setIsProfileMenuOpen(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors hover:bg-white/[0.04]" style={{ color: '#878E88' }}><User size={16} /> Mi Perfil</button>
                                  <button onClick={() => { setActiveView('settings'); setIsProfileMenuOpen(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors hover:bg-white/[0.04]" style={{ color: '#878E88' }}><Settings size={16} /> Configuración</button>
                                  <div className="h-px my-1" style={{ background: 'rgba(255,255,255,0.07)' }}></div>
                                  <button onClick={onLogout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors hover:bg-red-500/10" style={{ color: '#F87171' }}><LogOut size={16} /> Salir</button>
                              </div>
                          </div>
                      )}
                  </div>
              </div>
          </div>

          {/* Lincoin ID chip — share to receive PAY transfers */}
          {currentUser?.ownReferralCode && (
              <div className="flex items-center gap-2">
                  <div
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-all hover:border-[rgba(74,222,128,0.4)]"
                      style={{ background: '#121413', border: '1px solid rgba(255,255,255,0.09)' }}
                      onClick={() => { navigator.clipboard.writeText(currentUser.ownReferralCode || ''); showToast('ID Lincoin copiado'); }}
                  >
                      <Zap size={13} style={{ color: '#4ADE80' }} />
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#878E88' }}>Mi ID Lincoin:</span>
                      <span className="font-mono font-extrabold tracking-widest text-sm" style={{ color: '#F4F4F2' }}>{currentUser.ownReferralCode}</span>
                      <Copy size={11} style={{ color: '#878E88' }} />
                  </div>
              </div>
          )}

          {isBlocked && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 shadow-sm animate-pulse">
                  <Ban className="text-red-600 shrink-0 mt-0.5" size={24} />
                  <div>
                      <h3 className="text-red-800 font-bold text-sm">Cuenta Bloqueada Temporalmente</h3>
                      <p className="text-red-700 text-xs mt-1">
                          Hemos detectado actividad que requiere revisión o falta documentación. 
                          <br/>Motivo: <span className="font-bold">{currentUser?.blockReason || 'Revisión de seguridad'}</span>.
                          <br/>Por favor contacta a soporte para desbloquear tus operaciones.
                      </p>
                  </div>
              </div>
          )}

          {!isKycVerified && !isBlocked && (() => {
              const ks = currentUser?.kycStatus;
              if (ks === 'rejected') return (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 shadow-sm animate-in slide-in-from-top-4">
                  <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center shrink-0">
                    <AlertTriangle className="text-red-600" size={20} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-red-800 font-bold text-sm">Verificación rechazada</h3>
                    <p className="text-red-700 text-xs mt-1">Tu verificación de identidad fue rechazada. Por favor intenta de nuevo. Si el problema persiste, contacta soporte.</p>
                  </div>
                  <button onClick={startDiditKyc} disabled={kycLoading} className="shrink-0 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg disabled:opacity-50 flex items-center gap-2 transition-colors">
                    {kycLoading ? <><RefreshCw size={14} className="animate-spin"/> Cargando...</> : <><ShieldCheck size={14}/> Reintentar verificación</>}
                  </button>
                </div>
              );
              if (ks === 'in_review') return (
                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5 flex items-start gap-4 shadow-sm animate-in slide-in-from-top-4">
                  <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center shrink-0">
                    <Clock className="text-orange-600" size={20} />
                  </div>
                  <div>
                    <h3 className="text-orange-800 font-bold text-sm">Verificación en revisión manual</h3>
                    <p className="text-orange-700 text-xs mt-1">Nuestro equipo está revisando tu identidad. Te notificaremos cuando tu cuenta esté activada. Esto puede tomar hasta 24h.</p>
                  </div>
                </div>
              );
              if (ks === 'in_progress') return (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 shadow-sm animate-in slide-in-from-top-4">
                  <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center shrink-0">
                    <ShieldCheck className="text-[#0C0E0D]" size={20} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-[#0C0E0D] font-bold text-sm">Verificación en progreso</h3>
                    <p className="text-[#4ADE80] text-xs mt-1">Abriste Lincoin pero aún no terminaste. Completa el proceso para activar tu cuenta.</p>
                  </div>
                  <button onClick={startDiditKyc} disabled={kycLoading} className="shrink-0 px-4 py-2 bg-[#0C0E0D] hover:bg-[#152e52] text-xs font-bold rounded-lg disabled:opacity-50 flex items-center gap-2 transition-colors">
                    {kycLoading ? <><RefreshCw size={14} className="animate-spin"/> Cargando...</> : <><ShieldCheck size={14}/> Continuar verificación</>}
                  </button>
                </div>
              );
              // pending / not_started / undefined
              return (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 animate-in slide-in-from-top-4">
                  <div className="w-9 h-9 bg-amber-100 rounded-full flex items-center justify-center shrink-0">
                    <ShieldCheck className="text-amber-600" size={18} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-amber-900 font-bold text-sm">{isBusinessProduct ? 'Verifica tu empresa para desbloquear envíos' : 'Verifica tu identidad para desbloquear envíos'}</h3>
                    <p className="text-amber-700 text-xs mt-0.5">Puedes cargar dinero ahora. Para enviar y convertir, completa la verificación {isBusinessProduct ? 'KYB de tu empresa' : 'KYC'} en menos de 2 minutos.</p>
                  </div>
                  <button onClick={startDiditKyc} disabled={kycLoading} className="shrink-0 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg disabled:opacity-50 flex items-center gap-2 transition-colors">
                    {kycLoading ? <><RefreshCw size={14} className="animate-spin"/> Cargando...</> : <><ShieldCheck size={14}/> Verificar ahora</>}
                  </button>
                </div>
              );
          })()}


          <style>{`
            .lincoin-panel { background:#0C0E0D; border:1px solid rgba(255,255,255,0.09); border-radius:14px; padding:20px; }
            @media (max-width: 1000px) { .lincoin-dash-bottom { grid-template-columns: 1fr !important; } }
          `}</style>

          {/* ═══════════ BILLETERAS ═══════════ */}
          <div>
            <div className="flex items-baseline justify-between" style={{ marginBottom: 13 }}>
              <div className="flex items-baseline gap-2">
                <span style={{ fontSize: 15, fontWeight: 700, color: '#F4F4F2' }}>Billeteras</span>
                <span style={{ fontSize: 12.5, color: '#878E88' }}>2 activas</span>
              </div>
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              {/* USDT — principal */}
              {(() => {
                const usdt = displayBalance('USD');
                const parts = usdt.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split(',');
                return (
                  <div style={{ background: '#0C0E0D', border: '1px solid rgba(74,222,128,0.28)', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '18px 18px 16px', flex: 1 }}>
                      <div className="flex items-start justify-between" style={{ marginBottom: 14 }}>
                        <div className="flex items-center gap-2.5">
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#26A17B', color: '#fff', fontWeight: 800, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>₮</div>
                          <div>
                            <p style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>Dólar digital</p>
                            <p style={{ fontSize: 11, color: '#878E88' }}>USDT · GasFree · TRON</p>
                          </div>
                        </div>
                        <span style={{ border: '1px solid rgba(74,222,128,0.3)', color: '#4ADE80', fontSize: 9, fontWeight: 700, letterSpacing: '0.7px', padding: '3px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>PRINCIPAL</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                        <span style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1, color: '#F4F4F2' }}>{parts[0]}<span style={{ fontSize: 16, color: '#878E88' }}>,{parts[1]}</span></span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#878E88', marginBottom: 1 }}>USDT</span>
                      </div>
                      <p style={{ fontSize: 11.5, color: '#878E88', marginTop: 5 }}>Disponible · 1 USDT = 1 USD</p>
                    </div>
                    <div style={{ padding: '11px 18px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10.5, color: '#878E88', fontFamily: 'ui-monospace, Menlo, monospace' }}>{usdtAddr ? `${usdtAddr.slice(0, 6)}…${usdtAddr.slice(-4)}` : 'Red TRON · TRC-20'}</span>
                      <div className="flex items-center" style={{ gap: 13 }}>
                        <button onClick={() => handleLoadClick('USD')} style={{ fontSize: 12, fontWeight: 600, color: '#F4F4F2' }} className="hover:text-[#4ADE80] transition-colors">Cargar</button>
                        <button onClick={() => { setSelectedWalletCode('USD'); setActiveView('mouv'); }} style={{ fontSize: 12, fontWeight: 600, color: '#F4F4F2' }} className="hover:text-[#4ADE80] transition-colors">Convertir</button>
                      </div>
                    </div>
                  </div>
                );
              })()}
              {/* COP — cuenta local (BreB + ACH vía Mouv) */}
              {(() => {
                const cop = getBalance('COP') + getBalance('COP_BREB') + getBalance('COP_ACH');
                const usdt = displayBalance('USD');
                const rate = getRate('USD', 'COP');
                return (
                  <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '18px 18px 16px', flex: 1 }}>
                      <div className="flex items-start justify-between" style={{ marginBottom: 14 }}>
                        <div className="flex items-center gap-2.5">
                          <div style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                            <span style={{ height: '50%', background: '#FCD116' }} />
                            <span style={{ height: '25%', background: '#003893' }} />
                            <span style={{ height: '25%', background: '#CE1126' }} />
                          </div>
                          <div>
                            <p style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>Peso colombiano</p>
                            <p style={{ fontSize: 11, color: '#878E88' }}>Cuenta local · COP</p>
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                        <span style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1, color: '#F4F4F2' }}>{Math.round(cop).toLocaleString('es-CO')}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#878E88', marginBottom: 1 }}>COP</span>
                      </div>
                      <p style={{ fontSize: 11.5, color: '#878E88', marginTop: 5 }}>{rate ? `≈ ${(cop / rate).toLocaleString('es-CO', { maximumFractionDigits: 2 })} USDT · ${Math.round(rate).toLocaleString('es-CO')}` : 'BreB · ACH'}</p>
                    </div>
                    <div style={{ padding: '11px 18px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10.5, color: '#878E88', fontFamily: 'ui-monospace, Menlo, monospace' }}>BreB · ACH</span>
                      <div className="flex items-center" style={{ gap: 13 }}>
                        <button onClick={() => { setSelectedWalletCode('COP'); setActiveView('wallet-detail'); }} style={{ fontSize: 12, fontWeight: 600, color: '#F4F4F2' }} className="hover:text-[#4ADE80] transition-colors">Ver</button>
                        <button onClick={() => { setSelectedWalletCode('USD'); setActiveView('mouv'); }} style={{ fontSize: 12, fontWeight: 600, color: '#F4F4F2' }} className="hover:text-[#4ADE80] transition-colors">Retirar</button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ═══════════ ZONA INFERIOR ═══════════ */}
          <div className="lincoin-dash-bottom" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 18, alignItems: 'start' }}>
            {/* Movimientos recientes */}
            <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, overflow: 'hidden', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 22px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#F4F4F2' }}>Movimientos recientes</span>
                <button onClick={() => { setMovementsTab('all'); setActiveView('movements'); }} style={{ fontSize: 12.5, fontWeight: 600, color: '#F4F4F2' }} className="hover:text-[#4ADE80] transition-colors">Ver todo →</button>
              </div>
              {movements.length > 0 ? movements.slice(0, 8).map(tx => {
                const credit = isTxCredit(tx);
                const meta = txRowMeta(tx);
                return (
                  <button key={tx.id} type="button" onClick={() => setSelectedTx(tx)} style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 12, padding: '13px 22px', borderTop: '1px solid rgba(255,255,255,0.05)', textAlign: 'left' }} className="hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: credit ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.055)', color: credit ? '#4ADE80' : '#F4F4F2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><meta.Icon size={15} /></div>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 13.5, fontWeight: 600, color: '#F4F4F2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.title}</p>
                        {meta.sub && <p style={{ fontSize: 11.5, color: '#878E88', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.sub}</p>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: 13.5, fontWeight: 700, color: credit ? '#4ADE80' : '#F4F4F2', whiteSpace: 'nowrap' }}>{credit ? '+' : '−'} {formatMoney(tx.amount, tx.currency)}</p>
                      <span style={{ display: 'inline-block', marginTop: 3, fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, border: tx.status === 'Completado' ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(255,255,255,0.14)', color: tx.status === 'Completado' ? '#4ADE80' : '#878E88' }}>{tx.status}</span>
                    </div>
                  </button>
                );
              }) : (
                <div style={{ padding: 40, textAlign: 'center' }}>
                  <p style={{ color: '#F4F4F2', fontWeight: 600, fontSize: 13.5 }}>Aún no tienes movimientos</p>
                  <p style={{ color: '#878E88', fontSize: 12, marginTop: 4 }}>Cuando cargues, conviertas o retires, tus operaciones aparecerán aquí.</p>
                </div>
              )}
            </div>

            {/* Columna derecha */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Servicios */}
              <div className="lincoin-panel">
                <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#F4F4F2' }}>Servicios</span>
                  <button onClick={() => setActiveView('servicios')} style={{ fontSize: 12, color: '#878E88' }} className="hover:text-[#F4F4F2] transition-colors">Ver más ›</button>
                </div>
                {([
                  { Icon: ArrowLeftRight, t: 'Mesa OTC',   d: 'Operaciones de alto volumen con tasa negociada' },
                  { Icon: TrendingUp,     t: 'Staking',    d: 'Genera rendimientos con tu saldo digital' },
                  { Icon: Layers,         t: 'Multiwallet', d: 'Varias billeteras y monedas en una sola cuenta' },
                  { Icon: ShoppingBag,    t: 'Comercio',   d: 'Cobra a tus clientes con links y botones de pago' },
                ] as const).map(({ Icon, t, d }, i) => (
                  <div key={t} className="flex items-center gap-3" style={{ padding: '12px 0', borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,0.055)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={15} style={{ color: '#F4F4F2' }} /></div>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 600, color: '#F4F4F2' }}>{t}</p>
                      <p style={{ fontSize: 11.5, color: '#878E88' }}>{d}</p>
                    </div>
                  </div>
                ))}
              </div>
              {/* TU DINERO — confianza (aliados reales de Lincoin) */}
              <div className="lincoin-panel">
                <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.8px', color: '#878E88', marginBottom: 14 }}>TU DINERO</p>
                {[['Respaldo en USDT', 'Dólar digital de Tether (USDT), 1:1 con el dólar.'], ['Rieles locales', 'Retiros en Colombia por BreB y ACH vía Mouv.'], ['Identidad verificada', 'KYC/KYB y monitoreo SARLAFT con Didit.']].map(([t, d]) => (
                  <div key={t} className="flex items-start gap-3" style={{ marginBottom: 13, fontSize: 12.5 }}>
                    <ShieldCheck size={16} style={{ color: '#878E88', flexShrink: 0, marginTop: 1 }} />
                    <div><span style={{ fontWeight: 700, color: '#F4F4F2' }}>{t}</span> <span style={{ color: '#878E88' }}>— {d}</span></div>
                  </div>
                ))}
                <p style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 12, marginTop: 2, fontSize: 11.5, color: '#878E88', lineHeight: 1.5 }}>Lincoin no es un banco. Los criptoactivos no están cubiertos por fondos de garantía de depósitos.</p>
              </div>
            </div>
          </div>

      </div>
  );
  };

  const renderMovements = () => (
      <div className="space-y-6 animate-in fade-in duration-300 pt-6">
          <div className="flex flex-col gap-3">
              <button onClick={() => setActiveView('dashboard')} style={{ color: '#0C0E0D' }} className="flex items-center gap-2 font-bold text-sm self-start">
                  <ArrowLeft size={16} /> Volver
              </button>
              <div className="flex justify-between items-center">
                 <h2 className="text-xl font-bold text-slate-800">Historial de Movimientos</h2>
                 <div className="flex gap-2 bg-white p-1 rounded-lg border border-slate-200">
                     <button onClick={() => setMovementsTab('all')} className={`px-4 py-2 rounded-lg text-sm font-bold ${movementsTab === 'all' ? 'bg-[#0C0E0D]' : 'text-slate-500 hover:bg-slate-50'}`}>Todos</button>
                     <button onClick={() => setMovementsTab('income')} className={`px-4 py-2 rounded-lg text-sm font-bold ${movementsTab === 'income' ? 'bg-[#0C0E0D]' : 'text-slate-500 hover:bg-slate-50'}`}>Ingresos</button>
                     <button onClick={() => setMovementsTab('expense')} className={`px-4 py-2 rounded-lg text-sm font-bold ${movementsTab === 'expense' ? 'bg-[#0C0E0D]' : 'text-slate-500 hover:bg-slate-50'}`}>Egresos</button>
                 </div>
              </div>
          </div>
          {/* Buscador + filtros */}
          <div className="space-y-3">
              <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input value={movSearch} onChange={e => setMovSearch(e.target.value)}
                          placeholder="Buscar por concepto, monto, beneficiario…"
                          className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-200 text-sm outline-none focus:border-[#4ADE80]" />
                  </div>
                  <button type="button" onClick={() => setMovShowFilters(v => !v)} title="Filtros"
                      className={`relative h-11 px-3.5 rounded-xl border text-sm font-bold flex items-center gap-2 transition-colors ${movShowFilters || movActiveFilters ? 'bg-[#0C0E0D] text-white border-[#0C0E0D]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                      <SlidersHorizontal size={16} />
                      <span className="hidden sm:inline">Filtros</span>
                      {movActiveFilters > 0 && <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#4ADE80] text-[#0C0E0D] text-[10px] font-black flex items-center justify-center">{movActiveFilters}</span>}
                  </button>
              </div>
              {movShowFilters && (
                  <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
                      {/* Estado */}
                      <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Estado</p>
                          <div className="flex flex-wrap gap-2">
                              {(['all', 'Pendiente', 'Completado', 'Rechazado'] as const).map(s => (
                                  <button key={s} type="button" onClick={() => setMovStatus(s)}
                                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${movStatus === s ? 'bg-[#4ADE80] text-[#0C0E0D] border-[#4ADE80]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                                      {s === 'all' ? 'Todos' : s}
                                  </button>
                              ))}
                          </div>
                      </div>
                      {/* Tipo de operación */}
                      <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Tipo de operación</p>
                          <div className="flex flex-wrap gap-2">
                              {([['all', 'Todas'], ['send', 'Envíos'], ['load', 'Depósitos'], ['convert', 'Conversiones']] as const).map(([k, lbl]) => (
                                  <button key={k} type="button" onClick={() => setMovType(k)}
                                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${movType === k ? 'bg-[#4ADE80] text-[#0C0E0D] border-[#4ADE80]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                                      {lbl}
                                  </button>
                              ))}
                          </div>
                      </div>
                      {/* Moneda */}
                      <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Moneda</p>
                          <div className="flex flex-wrap gap-2">
                              {['all', ...Array.from(new Set(movements.map(m => baseCurrency(m.currency)).filter(Boolean)))].map(c => (
                                  <button key={c} type="button" onClick={() => setMovCurrency(c)}
                                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${movCurrency === c ? 'bg-[#4ADE80] text-[#0C0E0D] border-[#4ADE80]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                                      {c === 'all' ? 'Todas' : c}
                                  </button>
                              ))}
                          </div>
                      </div>
                      {/* Fecha */}
                      <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Fecha</p>
                          <div className="flex items-center gap-2">
                              <div className="flex-1">
                                  <label className="text-[10px] text-slate-400">Desde</label>
                                  <input type="date" value={movDateFrom} onChange={e => setMovDateFrom(e.target.value)}
                                      className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm outline-none focus:border-[#4ADE80]" />
                              </div>
                              <div className="flex-1">
                                  <label className="text-[10px] text-slate-400">Hasta</label>
                                  <input type="date" value={movDateTo} onChange={e => setMovDateTo(e.target.value)}
                                      className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm outline-none focus:border-[#4ADE80]" />
                              </div>
                          </div>
                      </div>
                      {movActiveFilters > 0 && (
                          <button type="button" onClick={movClearFilters} className="text-xs font-bold text-[#16A34A] hover:underline">Limpiar filtros</button>
                      )}
                  </div>
              )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
             {getFilteredMovements(null, { full: true }).map(tx => {
                 const meta = txRowMeta(tx);
                 return (
                 <button key={tx.id} type="button" onClick={() => setSelectedTx(tx)} className="w-full p-4 border-b border-slate-50 flex justify-between items-center gap-3 hover:bg-slate-50 transition-colors text-left cursor-pointer">
                    <div className="flex items-center gap-4 min-w-0">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isTxCredit(tx) ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                            <meta.Icon size={17} />
                        </div>
                        <div className="min-w-0">
                            <p className="font-bold text-slate-800 text-sm truncate">{meta.title}</p>
                            <div className="flex items-center gap-2 mt-0.5 min-w-0">
                                {meta.sub && <p className="text-xs text-slate-400 truncate">{meta.sub}</p>}
                                {tx.status && (
                                    <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border shrink-0 ${movStatusStyle(tx.status)}`}>{movStatusLabel(tx.status)}</span>
                                )}
                            </div>
                        </div>
                    </div>
                    <span className={`font-bold text-sm shrink-0 ${isTxCredit(tx) ? 'text-green-600' : 'text-slate-800'}`}>
                        {isTxCredit(tx) ? '+' : '-'} {formatMoney(tx.amount, tx.currency)}
                    </span>
                 </button>
                 );
             })}
             {getFilteredMovements(null, { full: true }).length === 0 && (
                 <div className="p-12 text-center text-slate-400">
                     No hay movimientos para mostrar.
                     {(() => {
                         // Diagnóstico de la última lectura vacía (para depurar en
                         // móvil, donde no hay consola). Lo escribe fetchData.
                         try {
                             const d = JSON.parse(localStorage.getItem('lincoin_tx_debug') || 'null');
                             if (!d) return null;
                             return (
                                 <p style={{ fontSize: 10, color: '#6B726C', marginTop: 10, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                     dbg · edge:{d.edge ? `${d.edge.count ?? '—'}${d.edge.error ? ` (${String(d.edge.error).slice(0, 80)})` : ''}` : '—'}
                                     {' '}· rpc:{d.rpcCount ?? '—'}{d.rpcErr ? ` (${String(d.rpcErr).slice(0, 60)})` : ''}
                                     {' '}· sel:{d.directCount ?? '—'}{d.directErr ? ` (${String(d.directErr).slice(0, 60)})` : ''}
                                     {' '}· u:{String(d.userId).slice(0, 8)}
                                 </p>
                             );
                         } catch { return null; }
                     })()}
                 </div>
             )}
          </div>
      </div>
  );

  const handleBrebMove = async () => {
    if (!currentUser?.id || brebMoving) return;
    const amount = Number(brebAmountStr.replace(/[^\d]/g, ''));
    const cop  = getBalance('COP');
    const breb = getBalance('COP_BREB');
    if (!amount || amount <= 0) { showToast('Ingresa un monto válido', 3000, 'error'); return; }
    const source = brebDir === 'to_breb' ? cop : breb;
    if (amount > source) { showToast('Saldo insuficiente en la cuenta de origen', 3000, 'error'); return; }
    setBrebMoving(true);
    const newBalances = brebDir === 'to_breb'
      ? { COP: cop - amount, COP_BREB: breb + amount }
      : { COP: cop + amount, COP_BREB: breb - amount };
    await updateUserProfile(currentUser.id, { balances: newBalances });
    try {
      await supabase.from('transactions').insert({
        user_id: currentUser.id,
        type: 'breb_move', amount, currency: 'COP', status: 'Completado',
        raw_data: {
          initials: 'BB',
          title: brebDir === 'to_breb' ? 'Peso Lincoin → BreB Lincoin' : 'BreB Lincoin → Peso Lincoin',
          date: new Date().toLocaleDateString('es-CO'), createdAt: new Date().toISOString(),
          userName: currentUser.name,
        },
      });
    } catch { /* el saldo es la fuente de verdad */ }
    setBrebMoving(false);
    setBrebMoveOpen(false);
    setBrebAmountStr('');
    showToast(brebDir === 'to_breb' ? 'Saldo movido a BreB Lincoin ⚡' : 'Saldo devuelto a Peso Lincoin');
  };

  const renderWalletDetail = () => {
      if (!selectedWalletCode) return <div>Selecciona una billetera</div>;
      const wallet = myWallets.find(w => w.code === selectedWalletCode);
      const balance = displayBalance(selectedWalletCode);
      return (
          <div className="space-y-6 animate-in fade-in duration-300 pt-6">
              {/* Breadcrumb */}
              <div className="flex items-center gap-2" style={{ fontSize: 13, color: '#878E88' }}>
                  <button onClick={() => setActiveView('dashboard')} className="flex items-center gap-2 hover:text-[#F4F4F2] transition-colors"><ArrowLeft size={14} /> Billeteras</button>
                  <span style={{ color: 'rgba(244,244,242,0.3)' }}>/</span>
                  <span style={{ color: '#F4F4F2', fontWeight: 600 }}>{wallet?.name}</span>
              </div>

              {selectedWalletCode === 'COP' ? (() => {
                  const _cop = getBalance('COP'), _breb = getBalance('COP_BREB'), _ach = getBalance('COP_ACH');
                  const _total = _cop + _breb + _ach; const _rate = getRate('USD', 'COP');
                  return (
                  <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 16, padding: '26px 28px' }} className="flex flex-col lg:flex-row lg:items-start justify-between gap-8">
                      <div>
                          <div className="flex items-center gap-3">
                              <div style={{ width: 38, height: 38, borderRadius: '50%', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                                  <span style={{ height: '50%', background: '#FCD116' }} /><span style={{ height: '25%', background: '#003893' }} /><span style={{ height: '25%', background: '#CE1126' }} />
                              </div>
                              <div className="flex items-baseline gap-2.5">
                                  <h2 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.6px', color: '#F4F4F2' }}>Peso colombiano</h2>
                                  <span style={{ border: '1px solid rgba(255,255,255,0.14)', color: '#878E88', fontSize: 10.5, fontWeight: 700, letterSpacing: '1px', padding: '3px 8px', borderRadius: 999 }}>COP</span>
                              </div>
                          </div>
                          <p style={{ fontSize: 13, color: '#878E88', marginTop: 3 }}>Cuenta local · Colombia · 3 rieles</p>
                          <div style={{ marginTop: 22, display: 'flex', alignItems: 'baseline', gap: 10 }}>
                              <span style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-1.8px', lineHeight: 1, color: '#F4F4F2' }}>{Math.round(_total).toLocaleString('es-CO')}</span>
                              <span style={{ fontSize: 16, fontWeight: 600, color: '#878E88' }}>COP</span>
                          </div>
                          <p style={{ marginTop: 9, fontSize: 13.5, color: '#878E88' }}>{_rate ? `≈ ${(_total / _rate).toLocaleString('es-CO', { maximumFractionDigits: 2 })} USDT · tasa ${Math.round(_rate).toLocaleString('es-CO')}` : 'Saldo Lincoin · Bre-B · ACH'}</p>
                      </div>
                      <div className="flex gap-2.5 flex-wrap">
                          <button onClick={() => { setSelectedWalletCode('USD'); setActiveView('mouv'); }} style={{ background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)', color: '#F4F4F2', fontWeight: 600, fontSize: 13.5, padding: '11px 18px', borderRadius: 9 }} className="hover:bg-white/[0.09] transition-colors flex items-center gap-2"><RefreshCw size={15} /> Convertir</button>
                          <button onClick={() => handleLoadClick('COP')} style={{ background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)', color: '#F4F4F2', fontWeight: 600, fontSize: 13.5, padding: '11px 18px', borderRadius: 9 }} className="hover:bg-white/[0.09] transition-colors flex items-center gap-2"><Plus size={15} /> Cargar</button>
                          <button onClick={() => { if (!handleActionRestricted()) setIsSendModalOpen(true); }} disabled={isBlocked || !isKycVerified} style={{ fontWeight: 700, fontSize: 13.5, padding: '11px 20px', borderRadius: 9, opacity: (isBlocked || !isKycVerified) ? 0.6 : 1 }} className="lincoin-btn-white transition-colors flex items-center gap-2"><Send size={15} /> Enviar dinero</button>
                      </div>
                  </div>
                  );
              })() : (
              <div className="bg-gradient-to-br from-[#0C0E0D] to-[#0C0E0D] p-8 rounded-3xl text-white shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                  <div className="relative z-10">
                      <div className="flex justify-between items-start mb-8">
                          <div className="flex items-center gap-4">
                              <div className="w-14 h-10 rounded-lg shadow-md ring-2 ring-white/30 bg-white/15 flex items-center justify-center font-bold text-lg">₮</div>
                              <div><h2 className="text-2xl font-bold">{wallet?.name}</h2><p className="text-green-200">{wallet?.type}</p></div>
                          </div>
                          <span className="bg-white/10 px-3 py-1 rounded-lg text-sm font-bold border border-white/20">USDT</span>
                      </div>
                      <p className="text-5xl font-bold mb-8 tracking-tight">
                          {formatMoney(balance, selectedWalletCode)}
                          <span className="text-base font-normal text-green-200 ml-2">
                              {gasfreeBalChecked ? (gasfreeBal != null ? 'saldo real en tu wallet GasFree' : 'sin conexión — mostrando último saldo conocido') : 'consultando saldo real…'}
                          </span>
                      </p>
                      <div className="flex gap-4">
                          <button onClick={() => { handleLoadClick(selectedWalletCode); }} disabled={isBlocked} className={`flex-1 text-[#0C0E0D] py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors ${isBlocked ? 'bg-slate-400 cursor-not-allowed opacity-70' : 'bg-[#4ADE80] hover:bg-[#22C55E]'}`}><Plus size={18} /> Cargar</button>
                          <button onClick={() => { if(!handleActionRestricted()) setIsSendModalOpen(true); }} disabled={isBlocked || !isKycVerified} className={`flex-1 text-white border py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors ${isBlocked || !isKycVerified ? 'bg-white/10 border-white/10 cursor-not-allowed opacity-70' : 'bg-white/10 border-white/20 hover:bg-white/20'}`}><Send size={18} /> Enviar</button>
                      </div>
                  </div>
              </div>
              )}

              {/* La billetera Colombia (COP) contiene el saldo interno (Peso Lincoin)
                  y DOS rieles de dispersión vía Mouv: BreB (inmediato 24/7) y
                  ACH (L-V). Saldos separados con claves COP_BREB y COP_ACH. */}
              {selectedWalletCode === 'COP' && (() => {
                  const cop = getBalance('COP');
                  const brebBal = getBalance('COP_BREB');
                  const achBal = getBalance('COP_ACH');
                  // Estado del riel ACH: L–V 7:00–18:00 hora Colombia (UTC-5).
                  const _cot = new Date(Date.now() - 5 * 3600 * 1000);
                  const _dow = _cot.getUTCDay(); const _hr = _cot.getUTCHours();
                  const achOpen = _dow >= 1 && _dow <= 5 && _hr >= 7 && _hr < 18;
                  return (
                  <>
                  <div>
                    <div className="flex items-baseline justify-between" style={{ marginBottom: 13 }}>
                        <div className="flex items-baseline gap-2.5 flex-wrap">
                            <span style={{ fontSize: 15, fontWeight: 700, color: '#F4F4F2' }}>Rieles de esta cuenta</span>
                            <span style={{ fontSize: 12.5, color: '#878E88' }}>Cómo entra y sale el dinero en Colombia</span>
                        </div>
                    </div>
                    <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                      {/* Riel 1 — Saldo Lincoin (principal) */}
                      <div style={{ background: '#0C0E0D', border: '1px solid rgba(74,222,128,0.28)', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                          <div style={{ padding: '18px 20px 16px', flex: 1 }}>
                              <div className="flex items-start justify-between" style={{ gap: 10 }}>
                                  <div className="flex items-center gap-2.5">
                                      <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,0.055)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Wallet size={17} style={{ color: '#F4F4F2' }} /></div>
                                      <div>
                                          <p style={{ fontSize: 14.5, fontWeight: 700, color: '#F4F4F2' }}>Saldo Lincoin</p>
                                          <p style={{ fontSize: 11, color: '#878E88' }}>Cuenta principal · COP</p>
                                      </div>
                                  </div>
                                  <span style={{ border: '1px solid rgba(74,222,128,0.3)', color: '#4ADE80', fontSize: 9, fontWeight: 700, letterSpacing: '0.7px', padding: '3px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>PRINCIPAL</span>
                              </div>
                              <p style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-1px', color: '#F4F4F2', marginTop: 16 }}>{Math.round(cop).toLocaleString('es-CO')}</p>
                              <p style={{ fontSize: 12, color: '#878E88', lineHeight: 1.5, margin: '8px 0 0' }}>Cargas, envíos entre usuarios de Lincoin y conversiones a USDT.</p>
                              <div className="flex items-center" style={{ gap: 7, marginTop: 12 }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ADE80' }} />
                                  <span style={{ fontSize: 11.5, color: '#878E88' }}>Disponible 24/7 · sin comisión interna</span>
                              </div>
                          </div>
                          <div style={{ padding: '11px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)', display: 'flex', gap: 13 }}>
                              <button onClick={() => handleLoadClick('COP')} style={{ fontSize: 12, fontWeight: 600, color: '#F4F4F2' }} className="hover:text-[#4ADE80] transition-colors">Cargar</button>
                              <button onClick={() => { setBrebMoveOpen(true); setBrebDir('to_breb'); }} style={{ fontSize: 12, fontWeight: 600, color: '#F4F4F2' }} className="hover:text-[#4ADE80] transition-colors">Mover a otro riel</button>
                          </div>
                      </div>

                      {/* Riel 2 — Bre-B */}
                      <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                          <div style={{ padding: '18px 20px 16px', flex: 1 }}>
                              <div className="flex items-start justify-between" style={{ gap: 10 }}>
                                  <div className="flex items-center gap-2.5">
                                      <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,0.055)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Zap size={17} style={{ color: '#F4F4F2' }} /></div>
                                      <div>
                                          <p style={{ fontSize: 14.5, fontWeight: 700, color: '#F4F4F2' }}>Bre-B</p>
                                          <p style={{ fontSize: 11, color: '#878E88' }}>Pagos inmediatos · Colombia</p>
                                      </div>
                                  </div>
                                  <span style={{ border: '1px solid rgba(255,255,255,0.14)', color: '#878E88', fontSize: 9, fontWeight: 700, letterSpacing: '0.7px', padding: '3px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>SEGUNDOS</span>
                              </div>
                              <p style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-1px', color: '#F4F4F2', marginTop: 16 }}>{Math.round(brebBal).toLocaleString('es-CO')}</p>
                              <p style={{ fontSize: 12, color: '#878E88', lineHeight: 1.5, margin: '8px 0 0' }}>Dispersa a cuentas bancarias colombianas por llave Bre-B en segundos.</p>
                              <div className="flex items-center" style={{ gap: 7, marginTop: 12 }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ADE80' }} />
                                  <span style={{ fontSize: 11.5, color: '#878E88' }}>Operativo 24/7 · hasta 50 M por envío</span>
                              </div>
                          </div>
                          <div style={{ padding: '11px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)', display: 'flex', gap: 13 }}>
                              <button onClick={() => { setDispersRail('COP_BREB'); setMouvMode('full'); setActiveView('mouv'); }} disabled={brebBal <= 0} style={{ fontSize: 12, fontWeight: 600, color: brebBal <= 0 ? '#878E88' : '#F4F4F2' }} className="hover:text-[#4ADE80] transition-colors disabled:cursor-not-allowed">Dispersar</button>
                              <button onClick={() => { setBrebMoveOpen(true); setBrebDir('to_peso'); }} style={{ fontSize: 12, fontWeight: 600, color: '#F4F4F2' }} className="hover:text-[#4ADE80] transition-colors">Mover saldo</button>
                          </div>
                      </div>

                      {/* Riel 3 — ACH (horario) */}
                      <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                          <div style={{ padding: '18px 20px 16px', flex: 1 }}>
                              <div className="flex items-start justify-between" style={{ gap: 10 }}>
                                  <div className="flex items-center gap-2.5">
                                      <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,0.055)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Landmark size={17} style={{ color: '#F4F4F2' }} /></div>
                                      <div>
                                          <p style={{ fontSize: 14.5, fontWeight: 700, color: '#F4F4F2' }}>ACH</p>
                                          <p style={{ fontSize: 11, color: '#878E88' }}>Transferencias interbancarias</p>
                                      </div>
                                  </div>
                                  <span style={{ border: '1px solid rgba(255,255,255,0.14)', color: '#878E88', fontSize: 9, fontWeight: 700, letterSpacing: '0.7px', padding: '3px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>HORARIO</span>
                              </div>
                              <p style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-1px', color: '#F4F4F2', marginTop: 16 }}>{Math.round(achBal).toLocaleString('es-CO')}</p>
                              <p style={{ fontSize: 12, color: '#878E88', lineHeight: 1.5, margin: '8px 0 0' }}>Dispersa a cualquier cuenta en Colombia por el riel ACH tradicional.</p>
                              <div className="flex items-center" style={{ gap: 7, marginTop: 12 }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: achOpen ? '#4ADE80' : '#878E88' }} />
                                  <span style={{ fontSize: 11.5, color: '#878E88' }}>L–V 7:00–18:00 · {achOpen ? 'operativo ahora' : 'fuera de horario'}</span>
                              </div>
                          </div>
                          <div style={{ padding: '11px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)', display: 'flex', gap: 13 }}>
                              <button onClick={() => { if (achOpen) { setDispersRail('COP_ACH'); setMouvMode('full'); setActiveView('mouv'); } }} disabled={!achOpen || achBal <= 0} title={achOpen ? '' : 'Disponible L–V 7:00–18:00 hora Colombia'} style={{ fontSize: 12, fontWeight: 600, color: (!achOpen || achBal <= 0) ? '#878E88' : '#F4F4F2', cursor: achOpen ? 'pointer' : 'not-allowed' }} className="transition-colors">Dispersar</button>
                              <button onClick={() => { setBrebMoveOpen(true); setBrebDir('to_peso'); }} style={{ fontSize: 12, fontWeight: 600, color: '#F4F4F2' }} className="hover:text-[#4ADE80] transition-colors">Mover saldo</button>
                          </div>
                      </div>
                    </div>
                  </div>


                  {brebMoveOpen && (
                      <div className="bg-white rounded-2xl border border-slate-200 p-5">
                          <p className="font-bold text-slate-800 text-sm mb-3">Mover saldo entre tus cuentas COP</p>
                          <div className="flex flex-col md:flex-row gap-3 md:items-end">
                              <div className="flex-1">
                                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Dirección</label>
                                  <div className="flex gap-2 mt-1">
                                      <button
                                          onClick={() => setBrebDir('to_breb')}
                                          className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors ${brebDir === 'to_breb' ? 'bg-[#0C0E0D] border-transparent' : 'bg-white text-slate-600 border-slate-200'}`}
                                      >
                                          Peso → BreB ⚡
                                      </button>
                                      <button
                                          onClick={() => setBrebDir('to_peso')}
                                          className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors ${brebDir === 'to_peso' ? 'bg-[#0C0E0D] border-transparent' : 'bg-white text-slate-600 border-slate-200'}`}
                                      >
                                          BreB → Peso 🏦
                                      </button>
                                  </div>
                              </div>
                              <div className="flex-1">
                                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                      Monto (disponible: {formatMoney(brebDir === 'to_breb' ? balance : brebBal, 'COP')})
                                  </label>
                                  <input
                                      inputMode="numeric"
                                      placeholder="0"
                                      value={brebAmountStr}
                                      onChange={e => setBrebAmountStr(e.target.value.replace(/[^\d]/g, ''))}
                                      className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:border-[#4ADE80] outline-none"
                                  />
                              </div>
                              <button
                                  onClick={handleBrebMove}
                                  disabled={brebMoving || !brebAmountStr}
                                  className="py-2.5 px-6 rounded-xl bg-[#4ADE80] hover:bg-[#6EE7A0] text-[#0C0E0D] text-sm font-bold disabled:opacity-50 transition-colors"
                              >
                                  {brebMoving ? 'Moviendo…' : 'Mover'}
                              </button>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-2">
                              El movimiento es inmediato y queda registrado en tus movimientos.
                          </p>
                      </div>
                  )}
                  </>
                  );
              })()}

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-4 border-b border-slate-100 font-bold text-slate-800">Movimientos de esta cuenta</div>
                  {getFilteredMovements(selectedWalletCode).map(tx => {
                       const meta = txRowMeta(tx);
                       return (
                       <button key={tx.id} type="button" onClick={() => setSelectedTx(tx)} className="w-full p-4 border-b border-slate-50 flex justify-between items-center hover:bg-slate-50 text-left cursor-pointer">
                           <div className="flex items-center gap-3 min-w-0">
                               <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isTxCredit(tx) ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}><meta.Icon size={15} /></div>
                               <div className="min-w-0">
                                   <p className="font-bold text-slate-800 text-sm truncate">{meta.title}</p>
                                   <p className="text-xs text-slate-400 truncate">
                                       {meta.sub}
                                       {(tx.gasfree === true || tx.raw_data?.gasfree === true) && (tx.feeChargedUsdt ?? tx.raw_data?.feeChargedUsdt) != null && (
                                           <span> · comisión {Number(tx.feeChargedUsdt ?? tx.raw_data?.feeChargedUsdt).toFixed(2)} USDT</span>
                                       )}
                                   </p>
                               </div>
                           </div>
                           <span className={`font-bold text-sm shrink-0 ${isTxCredit(tx) ? 'text-green-600' : 'text-slate-800'}`}>{isTxCredit(tx) ? '+' : '-'} {formatMoney(tx.amount, tx.currency)}</span>
                       </button>
                       );
                  })}
                  {getFilteredMovements(selectedWalletCode).length === 0 && <div className="p-12 text-center text-slate-400 text-sm">Sin movimientos recientes en {selectedWalletCode}</div>}
              </div>

              {/* Volver también al final, para no tener que subir la página */}
              <button onClick={() => setActiveView('dashboard')} style={{ color: '#121413' }} className="flex items-center gap-2 font-bold text-sm hover:text-[#0C0E0D] hover:underline mx-auto">
                  <ArrowLeft size={16} /> Volver al inicio
              </button>
          </div>
      );
  };

  const renderProfile = () => (
      <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300 pt-6">
          <button onClick={() => setActiveView('dashboard')} className="flex items-center gap-2 text-slate-700 font-bold text-sm mb-2 hover:text-[#0C0E0D]">
              <ArrowLeft size={16} /> Volver
          </button>
          <h2 className="text-2xl font-bold text-slate-800 mb-6">Mi Perfil</h2>
          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm text-center relative group">
              <div onClick={handleEditProfileClick} className="absolute top-4 right-4 p-2 text-slate-400 hover:text-[#0C0E0D] cursor-pointer hover:bg-slate-50 rounded-full transition-colors">
                  <Edit2 size={18}/>
              </div>
              <div className="w-24 h-24 bg-slate-100 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl font-bold text-slate-400 overflow-hidden border-2 border-white shadow-sm">
                  {currentUser?.avatarUrl ? <img src={currentUser.avatarUrl} alt="Avatar" className="w-full h-full object-cover" /> : currentUser?.name?.charAt(0)}
              </div>
              <h3 className="text-xl font-bold text-slate-800">{currentUser?.name}</h3>
              <p className="text-slate-500">{currentUser?.email}</p>
              
              <div className="mt-4 inline-flex items-center gap-2 bg-slate-50 border border-slate-200 px-4 py-2 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => {navigator.clipboard.writeText(currentUser?.ownReferralCode || ''); showToast("Código copiado")}}>
                  <span className="text-xs text-slate-500 font-bold uppercase">ID Usuario:</span>
                  <span className="font-mono font-bold text-[#0C0E0D] text-lg">{currentUser?.ownReferralCode || 'GENERANDO...'}</span>
                  <Copy size={14} className="text-[#0C0E0D]" />
              </div>

              <div className="mt-6 flex justify-center gap-2">
                  <span className="px-3 py-1 bg-slate-50 text-[#0C0E0D] rounded-full text-xs font-bold border border-slate-200">{isBusinessProduct ? 'Cuenta Empresa' : 'Cuenta Personal'}</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold border ${isKycVerified ? 'bg-green-50 text-green-700 border-green-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
                      {isKycVerified ? 'Verificado' : (isBusinessProduct ? 'KYB Pendiente' : 'KYC Pendiente')}
                  </span>
              </div>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 font-bold text-slate-800">Detalles Personales</div>
              <div className="p-6 space-y-4">
                  <div className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-500">Nombre Completo</span>
                      <span className="font-medium text-slate-800">{currentUser?.name || 'No registrado'}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-500">Documento ID</span>
                      <span className="font-medium text-slate-800">{currentUser?.docNumber || 'No registrado'}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-500">País de Residencia</span>
                      <span className="font-medium text-slate-800">{currentUser?.country || 'No registrado'}</span>
                  </div>
              </div>
          </div>
      </div>
  );

  // Load MFA status when settings view opens
  useEffect(() => {
    if (activeView === 'settings') {
      setMfaLoadingStatus(true);
      getMFAStatus().then(({ enrolled, factorId, totpSecret }) => {
        setMfaEnrolled(enrolled);
        setMfaFactorId(factorId);
        setMfaTotpSecret(totpSecret);
        setMfaLoadingStatus(false);
      });
    }
  }, [activeView]);

  // Pay-link 30-min countdown
  useEffect(() => {
    if (payLinkStep !== 3 || payLinkSecondsLeft <= 0) return;
    const t = setTimeout(() => setPayLinkSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [payLinkStep, payLinkSecondsLeft]);

  const closePayLink = () => {
    setIsPayLinkOpen(false);
    setPayLinkStep(1);
    setPayLinkAmount('');
    setPayLinkPayerName('');
    setPayLinkDocNumber('');
    setPayLinkUrl('');
    setPayLinkSecondsLeft(1800);
  };

  const handleSelectPayLinkCountry = (code: string) => {
    setPayLinkCountry(code);
    setPayLinkDocType(DOC_TYPES[code]?.[0]?.value ?? '');
  };

  const handleGeneratePayLink = () => {
    const id = Math.random().toString(36).substring(2, 10).toUpperCase();
    setPayLinkUrl(`${window.location.origin}/pay/${id}`);
    setPayLinkSecondsLeft(1800);
    setPayLinkStep(3);
  };

  const formatCountdown = (secs: number) =>
    `${Math.floor(secs / 60).toString().padStart(2, '0')}:${(secs % 60).toString().padStart(2, '0')}`;

  const handleOpenMFAEnroll = async () => {
    const data = await enrollMFA();
    if (!data) { showToast('Error al iniciar 2FA. Intenta nuevamente.', 4000, 'error'); return; }
    setMfaEnrollData(data);
    setMfaVerifyCode('');
    setMfaVerifyError('');
    setMfaModalOpen(true);
  };

  const handleVerifyMFAEnrollment = async () => {
    if (!mfaEnrollData || mfaVerifyCode.length !== 6) return;
    setMfaVerifyLoading(true);
    setMfaVerifyError('');
    try {
      const { ok, error: mfaErr } = await verifyMFAEnrollment(mfaEnrollData.factorId, mfaVerifyCode, mfaEnrollData.secret);
      if (!ok) { setMfaVerifyError(mfaErr || 'Código incorrecto. Intenta nuevamente.'); setMfaVerifyCode(''); return; }
      setMfaEnrolled(true);
      setMfaFactorId(mfaEnrollData.factorId);
      setMfaTotpSecret(mfaEnrollData.secret);
      setMfaModalOpen(false);
      setMfaEnrollData(null);
      showToast('¡Verificación en 2 pasos activada!');
    } catch (e: any) {
      setMfaVerifyError(e?.message || 'Error al verificar. Intenta nuevamente.');
    } finally {
      setMfaVerifyLoading(false);
    }
  };

  const handleDisableMFA = async () => {
    if (!mfaFactorId) return;
    const ok = await unenrollMFA(mfaFactorId);
    if (!ok) { showToast('Error al desactivar. Intenta nuevamente.', 4000, 'error'); return; }
    setMfaEnrolled(false);
    setMfaFactorId(undefined);
    setMfaTotpSecret(undefined);
    if (currentUser) updateUserProfile(currentUser.id, { raw_data: { ...(currentUser as any).raw_data, mfaEnabled: false, mfaFactorId: null, totpSecret: null } });
    setMfaDisableModalOpen(false);
    showToast('Verificación en 2 pasos desactivada.');
  };

  const toggleNotifPref = (key: string) => {
      if (!currentUser) return;
      const current = (currentUser as any)[key];
      updateUserProfile(currentUser.id, { [key]: current === false ? true : false });
  };

  const handleSendPasswordReset = async () => {
      if (!currentUser?.email) return;
      await sendPasswordReset(currentUser.email);
      showToast('Email de restablecimiento enviado a ' + currentUser.email);
  };

  const renderSettings = () => (
      <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300 pt-6">
          <button onClick={() => setActiveView('dashboard')} className="flex items-center gap-2 text-slate-700 font-bold text-sm mb-4 hover:text-[#0C0E0D]">
              <ArrowLeft size={16}/> Volver
          </button>
          <h2 className="text-2xl font-bold text-slate-800">Configuración</h2>

          {/* Security */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 font-bold text-slate-800 flex items-center gap-2">
                  <Lock size={18} className="text-[#0C0E0D]"/> Seguridad
              </div>
              <div className="p-6 space-y-4">
                  <div className="flex justify-between items-center py-2 border-b border-slate-50">
                      <div>
                          <p className="font-medium text-slate-800 text-sm">Contraseña</p>
                          <p className="text-xs text-slate-500">Recibirás un email para cambiarla</p>
                      </div>
                      <button onClick={handleSendPasswordReset} className="px-4 py-2 text-sm font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors">
                          Cambiar
                      </button>
                  </div>
                  <div className="flex justify-between items-center py-2">
                      <div>
                          <p className="font-medium text-slate-800 text-sm">Verificación en dos pasos (2FA)</p>
                          <p className="text-xs text-slate-500">Código de 6 dígitos cada 30 seg (Google Authenticator, Authy)</p>
                      </div>
                      {mfaLoadingStatus ? (
                          <span className="text-xs text-slate-400">Cargando...</span>
                      ) : mfaEnrolled ? (
                          <div className="flex items-center gap-2">
                              <span className="px-3 py-1 bg-green-50 text-green-700 border border-green-100 rounded-full text-xs font-bold">Activo</span>
                              <button onClick={() => setMfaDisableModalOpen(true)} className="px-3 py-1.5 text-xs font-bold border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                                  Desactivar
                              </button>
                          </div>
                      ) : (
                          <button onClick={handleOpenMFAEnroll} className="px-4 py-2 text-sm font-bold bg-[#0C0E0D] rounded-lg hover:bg-[#152e52] transition-colors">
                              Activar
                          </button>
                      )}
                  </div>
              </div>
          </div>

          {/* Notifications */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 font-bold text-slate-800 flex items-center gap-2">
                  <Bell size={18} className="text-[#0C0E0D]"/> Notificaciones
              </div>
              <div className="p-6 space-y-1">
                  {[
                      { key: 'notifTransfers', label: 'Transferencias', desc: 'Envíos y recepciones de dinero' },
                      { key: 'notifDeposits', label: 'Depósitos', desc: 'Cargas de saldo aprobadas' },
                      { key: 'notifSecurity', label: 'Seguridad', desc: 'Accesos y cambios en la cuenta' },
                      { key: 'notifPromotions', label: 'Promociones', desc: 'Ofertas y novedades de LINCOIN' },
                      { key: 'notifSound', label: 'Sonido de notificaciones', desc: 'Reproduce un sonido al llegar una alerta nueva' },
                  ].map(({ key, label, desc }) => {
                      const enabled = (currentUser as any)?.[key] !== false;
                      return (
                          <div key={key} className="flex justify-between items-center py-3 border-b border-slate-50 last:border-0">
                              <div>
                                  <p className="font-medium text-slate-800 text-sm">{label}</p>
                                  <p className="text-xs text-slate-500">{desc}</p>
                              </div>
                              <button
                                  onClick={() => toggleNotifPref(key)}
                                  className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${enabled ? 'bg-[#0C0E0D]' : 'bg-slate-200'}`}
                              >
                                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${enabled ? 'left-6' : 'left-1'}`}/>
                              </button>
                          </div>
                      );
                  })}
              </div>
          </div>

          {/* Account info */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 font-bold text-slate-800 flex items-center gap-2">
                  <User size={18} className="text-[#0C0E0D]"/> Información de Cuenta
              </div>
              <div className="p-6 space-y-3">
                  <div className="flex justify-between border-b border-slate-50 pb-3">
                      <span className="text-slate-500 text-sm">Email</span>
                      <span className="font-medium text-slate-800 text-sm truncate ml-4">{currentUser?.email}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-50 pb-3">
                      <span className="text-slate-500 text-sm">ID de cuenta</span>
                      <span className="font-mono font-bold text-[#0C0E0D] text-sm">{currentUser?.ownReferralCode}</span>
                  </div>
                  <div className="flex justify-between">
                      <span className="text-slate-500 text-sm">Tipo de cuenta</span>
                      <span className="font-medium text-slate-800 text-sm capitalize">Personal</span>
                  </div>
              </div>
          </div>

          {/* Danger zone */}
          <div className="bg-red-50 rounded-2xl border border-red-100 p-6">
              <h3 className="font-bold text-red-800 mb-1 text-sm">Zona de peligro</h3>
              <p className="text-xs text-red-600 mb-4">Esta acción es permanente e irreversible.</p>
              <div className="flex flex-col gap-3">
                  {!showDeleteAccountConfirm ? (
                      <button onClick={() => setShowDeleteAccountConfirm(true)} className="px-4 py-2 text-sm font-bold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 w-fit">
                          <Trash2 size={14}/> Eliminar cuenta
                      </button>
                  ) : (
                      <div className="bg-white border border-red-200 rounded-xl p-4 space-y-3">
                          <p className="text-sm font-bold text-red-800">⚠️ ¿Eliminar tu cuenta permanentemente?</p>
                          <p className="text-xs text-slate-600">Se eliminarán tu perfil, historial y acceso. Esta acción <span className="font-bold">no se puede deshacer</span>.</p>
                          <div className="flex gap-2">
                              <button
                                  onClick={async () => {
                                      if (!currentUser) return;
                                      setIsDeletingAccount(true);
                                      await Promise.race([
                                          deleteUser(currentUser.id),
                                          new Promise(r => setTimeout(r, 12000)),
                                      ]).catch(() => {});
                                      logoutUser();
                                  }}
                                  disabled={isDeletingAccount}
                                  className="px-4 py-2 text-xs font-bold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60 flex items-center gap-1"
                              >
                                  {isDeletingAccount ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin inline-block"/> : <Trash2 size={12}/>}
                                  {isDeletingAccount ? 'Eliminando...' : 'Sí, eliminar'}
                              </button>
                              <button onClick={() => setShowDeleteAccountConfirm(false)} className="px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">
                                  Cancelar
                              </button>
                          </div>
                      </div>
                  )}
              </div>
          </div>
      </div>
  );

  const renderReferrals = () => (
      <div className="animate-in fade-in duration-300">
          <button onClick={() => setActiveView('dashboard')} className="flex items-center gap-2 text-slate-700 font-bold text-sm mb-6 hover:text-[#0C0E0D]">
              <ArrowLeft size={16} /> Volver
          </button>
          <div className="bg-[#0C0E0D] rounded-3xl p-8 md:p-12 text-white text-center mb-8 relative overflow-hidden">
               <div className="relative z-10">
                   <h2 className="text-3xl font-bold mb-4">Invita y Gana $20 USD</h2>
                   <p className="text-green-100 max-w-lg mx-auto mb-8">
                       Comparte tu código con amigos. 
                       <br/>Gana <span className="text-[#4ADE80] font-bold">$20 USD</span> cuando operen sus primeros $1,000 USD.
                       <br/>Además, recibe <span className="text-[#4ADE80] font-bold">{config.referralCommission}%</span> de cada operación de por vida.
                   </p>
                   <div className="bg-white/10 p-4 rounded-xl max-w-md mx-auto flex items-center gap-4 backdrop-blur-sm border border-white/20">
                       <code className="flex-1 font-mono text-xl font-bold text-white tracking-widest">{currentUser?.ownReferralCode || 'GENERANDO...'}</code>
                       <button onClick={() => {navigator.clipboard.writeText(currentUser?.ownReferralCode || ''); showToast("Código copiado")}} className="bg-white text-[#0C0E0D] px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-50">Copiar</button>
                   </div>
               </div>
               <div className="absolute top-0 right-0 w-64 h-64 bg-[#4ADE80]/20 rounded-full blur-3xl translate-x-1/2 -translate-y-1/2"></div>
               <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl -translate-x-1/2 translate-y-1/2"></div>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wider flex items-center gap-2">
                      <Users size={18} className="text-[#0C0E0D]"/> Tus Referidos
                  </h3>
              </div>
              <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-xs">
                          <tr>
                              <th className="px-6 py-4">Usuario</th>
                              <th className="px-6 py-4">Progreso Bono $20</th>
                              <th className="px-6 py-4 text-center">Volumen Total</th>
                              <th className="px-6 py-4 text-center">Comisiones</th>
                              <th className="px-6 py-4 text-right">Estado</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                          {myReferrals.length > 0 ? myReferrals.map((ref) => {
                              const volume = ref.lifetimeVolume || 0;
                              const progress = Math.min((volume / 1000) * 100, 100);
                              return (
                                  <tr key={ref.id} className="hover:bg-slate-50 transition-colors">
                                      <td className="px-6 py-4">
                                          <div className="flex items-center gap-3">
                                              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-bold text-xs text-slate-500">
                                                  {ref.name?.charAt(0) ?? '?'}
                                              </div>
                                              <div>
                                                  <p className="font-bold text-slate-700">{ref.name}</p>
                                              </div>
                                          </div>
                                      </td>
                                      <td className="px-6 py-4">
                                          <div className="w-full max-w-[140px]">
                                              <div className="flex justify-between text-[10px] mb-1 font-bold text-slate-500">
                                                  <span>${Math.min(volume, 1000).toFixed(0)}</span>
                                                  <span>$1,000</span>
                                              </div>
                                              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                                  <div className={`h-full rounded-full transition-all duration-500 ${progress >= 100 ? 'bg-[#4ADE80]' : 'bg-green-400'}`} style={{ width: `${progress}%` }}></div>
                                              </div>
                                          </div>
                                      </td>
                                      <td className="px-6 py-4 text-center font-bold text-slate-700">
                                          $ {formatMoney(volume, 'USD')}
                                      </td>
                                      <td className="px-6 py-4 text-center">
                                          <span className="text-green-600 font-bold bg-green-50 px-2 py-1 rounded text-xs">
                                              {config.referralCommission}%
                                          </span>
                                      </td>
                                      <td className="px-6 py-4 text-right">
                                          <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${ref.hasTriggeredBonus ? 'bg-purple-100 text-purple-700' : 'bg-slate-50 text-[#4ADE80]'}`}>
                                              {ref.hasTriggeredBonus ? 'Ganado' : 'En proceso'}
                                          </span>
                                      </td>
                                  </tr>
                              );
                          }) : (
                              <tr>
                                  <td colSpan={5} className="p-12 text-center text-slate-400">
                                      <p className="mb-2">Aún no tienes referidos.</p>
                                      <p className="text-xs">Comparte tu código para empezar a ganar.</p>
                                  </td>
                              </tr>
                          )}
                      </tbody>
                  </table>
              </div>
          </div>
      </div>
  );

  const renderAffiliates = () => (
      <div className="animate-in fade-in duration-300">
      <button onClick={() => setActiveView('dashboard')} className="flex items-center gap-2 text-slate-700 font-bold text-sm mb-6 hover:text-[#0C0E0D]">
          <ArrowLeft size={16} /> Volver
      </button>
      <div className="text-center py-12">
          <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 text-[#0C0E0D]">
              <Megaphone size={32} />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-4">Programa de Aliados</h2>
          <p className="text-slate-500 max-w-lg mx-auto mb-8">
              ¿Eres influencer, creador de contenido o tienes una comunidad? Únete a nuestro programa de afiliados y obtén beneficios exclusivos.
          </p>
          <button className="bg-[#0C0E0D] px-8 py-3 rounded-xl font-bold hover:bg-[#152e52] transition-colors">
              Aplicar al Programa
          </button>
      </div>
      </div>
  );

  const renderServicios = () => {
    const SERVICES = [
      { icon: ArrowLeftRight, label: 'Mesa OTC',   desc: 'Operaciones de alto volumen con tasa negociada.',            color: 'bg-slate-50 text-green-700',
        onClick: () => { setMouvMode('converter'); setActiveView('mouv'); } },
      { icon: TrendingUp,     label: 'Staking',    desc: 'Genera rendimientos con tu saldo digital.',                  color: 'bg-green-50 text-green-700' },
      { icon: Layers,         label: 'Multiwallet', desc: 'Varias billeteras y monedas en una sola cuenta.',           color: 'bg-violet-50 text-violet-700' },
      { icon: ShoppingBag,    label: 'Comercio',   desc: 'Cobra a tus clientes con links y botones de pago.',          color: 'bg-amber-50 text-amber-700' },
      { icon: GraduationCap,  label: 'Educación',  desc: 'Paga matrículas y cursos en el exterior.',                   color: 'bg-rose-50 text-rose-700' },
    ];
    return (
      <div className="pt-6 space-y-6 animate-in fade-in duration-300">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => setActiveView('dashboard')} className="flex items-center gap-2 text-slate-700 hover:text-slate-900 font-bold text-sm">
            <ArrowLeft size={18}/> Volver
          </button>
          <h2 className="text-xl font-bold text-[#0C0E0D]">Servicios</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SERVICES.map(({ icon: Icon, label, desc, color, onClick }: any) => (
            <div
              key={label}
              onClick={onClick}
              className={`bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-start gap-4 transition-all ${onClick ? 'cursor-pointer hover:border-[#4ADE80] hover:shadow-md' : 'hover:border-[#4ADE80] hover:shadow-md'}`}
            >
              <div className={`w-12 h-12 rounded-xl ${color} flex items-center justify-center shrink-0`}>
                <Icon size={22}/>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-bold text-slate-800 text-sm">{label}</h3>
                  {!onClick && <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full ml-2">Próximamente</span>}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-[#0C0E0D] rounded-2xl p-6 text-white text-center">
          <h3 className="font-bold text-lg mb-1">¿Necesitas ayuda?</h3>
          <p className="text-green-200 text-sm mb-4">Nuestro equipo está disponible para asistirte.</p>
          <a href="mailto:soporte@lincoin.me" className="inline-flex items-center gap-2 bg-[#4ADE80] text-[#0C0E0D] font-bold px-6 py-2.5 rounded-xl hover:bg-[#00b396] transition-colors text-sm">
            Contactar soporte
          </a>
        </div>
      </div>
    );
  };

  const TX_LABELS: Record<string, string> = {
    convert: 'Conversión de divisas', load: 'Carga de saldo', send: 'Envío / Retiro',
    pay_sent: 'Pago Lincoin enviado', pay_received: 'Pago Lincoin recibido',
    otc_withdraw_request: 'Retiro OTC', otc_convert_request: 'Conversión OTC',
    otc_deposit: 'Depósito cripto', otc_withdraw: 'Retiro cripto',
    dispersion: 'Dispersión', adjustment: 'Ajuste de saldo',
  };

  // Moneda amigable para mostrar: los rieles internos COP_BREB / COP_ACH son
  // pesos — el sufijo del riel va como contexto, no como ticker.
  const displayCurrency = (c?: string): string => String(c || '').split('_')[0];
  const railOfCurrency = (c?: string): string | null =>
    c === 'COP_BREB' ? 'Bre-B' : c === 'COP_ACH' ? 'ACH' : null;

  const WALLET_NETWORK: Record<string, string> = {
    USDT_BSC: 'BSC (BEP-20)', USDC_BSC: 'BSC (BEP-20)', BNB: 'BSC (BEP-20)',
    USDT_TRON: 'TRON (TRC-20)', TRX: 'TRON (TRC-20)',
    USDC_MATIC: 'Polygon (MATIC)', USDC_BASE: 'Base',
    ETH: 'Ethereum (ERC-20)', USDC: 'Ethereum (ERC-20)',
  };

  const EXPLORER_URL: Record<string, string> = {
    BSC: 'https://bscscan.com/tx/', TRON: 'https://tronscan.org/#/transaction/',
    MATIC: 'https://polygonscan.com/tx/', BASE: 'https://basescan.org/tx/',
    ETH: 'https://etherscan.io/tx/',
  };

  function getExplorerUrl(walletKey: string, chain: string, hash: string): string {
    const chainKey = chain?.toUpperCase() || '';
    const wKey = walletKey?.toUpperCase() || '';
    const base =
      EXPLORER_URL[chainKey] ||
      (wKey.includes('TRON') || wKey === 'TRX' ? EXPLORER_URL.TRON :
       wKey.includes('MATIC') ? EXPLORER_URL.MATIC :
       wKey.includes('BASE') ? EXPLORER_URL.BASE :
       wKey === 'ETH' || wKey === 'USDC' ? EXPLORER_URL.ETH :
       EXPLORER_URL.BSC);
    return base + hash;
  }

  const renderTxDetail = () => {
    if (!selectedTx) return null;
    const tx = selectedTx;
    const dt = tx.createdAt ? new Date(tx.createdAt) : null;
    const dateStr = dt ? dt.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' }) : (tx.date || '');
    const timeStr = dt ? dt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '';
    const rawData = tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {};
    // Las conversiones OTC (Mouv) guardan el monto en la moneda DESTINO
    // (lo que el cliente RECIBE — ej. COP), a diferencia del convertidor
    // general que guarda la moneda de ORIGEN (lo que se debita) — por eso
    // esta sí es un crédito y las demás 'convert' no.
    const isOtcConvertCredit = tx.type === 'convert' && (tx.source === 'MOUV' || rawData.source === 'MOUV');
    const isCredit = tx.type === 'load' || tx.type === 'pay_received' || tx.type === 'referral_payout' || tx.type === 'otc_deposit' || isOtcConvertCredit;
    const targetAmount = tx.targetAmount ?? rawData.targetAmount;
    const targetCurrency = tx.targetCurrency ?? rawData.targetCurrency;
    const txFee = tx.fee ?? rawData.fee;
    const couponCode = tx.couponCode ?? rawData.couponCode;
    const rate = targetAmount != null && tx.amount > 0 ? (targetAmount / tx.amount) : null;
    const statusColor = tx.status === 'Completado' ? 'text-green-600' : tx.status === 'Pendiente' ? 'text-orange-500' : 'text-red-500';

    // Envíos GasFree (Enviar → Wallet): traceId + comisión real cobrada,
    // guardados por mySend en raw_data. No es un hash de blockchain
    // confirmado (es el traceId de GasFree), por eso no lleva link Tronscan.
    // tx.raw_data se APLANA al nivel superior de tx al cargar (ver
    // DatabaseContext: "...t.raw_data"), así que tx.raw_data como key
    // literal NO existe en transacciones ya cargadas — solo en las que
    // se acaban de insertar en este mismo render. Por eso todo se lee
    // primero de tx.X (aplanado) y solo se cae a rawData.X de respaldo.
    const isGasfree = tx.gasfree === true || rawData.gasfree === true;
    const gasfreeTraceId: string = tx.traceId ?? rawData.traceId ?? '';
    const gasfreeFee: number | undefined = tx.feeChargedUsdt ?? tx.gasfreeFee ?? rawData.feeChargedUsdt ?? rawData.gasfreeFee;
    const gasfreeActivateFee: number | undefined = tx.activateFeeUsdt ?? rawData.activateFeeUsdt;
    // Conversión OTC (Mouv): USDT que entró, tasa, USDT que salió a la
    // recaudadora y comisión GasFree — todo en el mismo comprobante.
    const isMouvConvert = isOtcConvertCredit;
    const mouvFromAmount: number | undefined = tx.fromAmount ?? rawData.fromAmount;
    const mouvRate: number | undefined = tx.mouvRate ?? rawData.mouvRate;
    const mouvFeePct: number | undefined = tx.feePct ?? rawData.feePct;
    const gasfreeUsdtOut: number | undefined = tx.usdtOut ?? rawData.usdtOut;

    // Depósito USDT GasFree (type 'load' con source GASFREE): de dónde vino
    // (fromAddress), a qué dirección llegó (toAddress = wallet GasFree del
    // usuario), la red y el TxID on-chain — guardados por myVerifyDeposit.
    const isGasfreeDeposit = tx.type === 'load' && (tx.source === 'GASFREE' || rawData.source === 'GASFREE');
    const depFrom: string = tx.fromAddress ?? rawData.fromAddress ?? '';
    const depTo: string = tx.toAddress ?? rawData.toAddress ?? '';
    const depNetwork: string = tx.network ?? rawData.network ?? 'TRON (TRC-20)';
    const depTxId: string = tx.txId ?? rawData.txId ?? tx.txHash ?? rawData.txHash ?? '';
    const depTxUrl = depTxId ? `https://tronscan.org/#/transaction/${depTxId}` : '';

    // Crypto-specific fields from raw_data
    const isCrypto = tx.type === 'otc_deposit' || tx.type === 'otc_withdraw';
    const txHash: string = rawData.txHash || rawData.txId || '';
    const cryptoAddress: string = rawData.toAddress || rawData.address || tx.toAddress || '';
    const walletKey: string = rawData.walletKey || tx.currency || '';
    const chain: string = rawData.chain || '';
    const networkLabel = WALLET_NETWORK[walletKey] || walletKey || chain || '';
    const netAmount: number | undefined = rawData.netAmount;
    const networkFee: number | undefined = rawData.networkFee ?? (tx.type === 'otc_withdraw' && txFee != null ? txFee : undefined);
    const explorerUrl = txHash ? getExplorerUrl(walletKey, chain, txHash) : '';

    const copyToClipboard = (text: string) => {
      navigator.clipboard.writeText(text).then(() => setToastMessage('Copiado al portapapeles')).catch(() => {});
    };

    // Dispersión Mouv (Bre-B/ACH): beneficiario, destino y referencia del
    // proveedor. Los guarda mouv-proxy (title/beneficiary/bank/account); las
    // filas viejas solo traen `recipient` — se leen como respaldo.
    const isDispersion = tx.type === 'dispersion';
    const dispRecipient = (tx.recipient && typeof tx.recipient === 'object') ? tx.recipient : (rawData.recipient ?? {});
    const dispBeneficiary: string = tx.beneficiary ?? dispRecipient.holderName ?? '';
    const dispDest: string = tx.account ?? dispRecipient.key ?? dispRecipient.accountNumber ?? '';
    const dispProviderRef: string = tx.providerRef ?? rawData.providerRef ?? '';

    // Documento con tipo (CC 1005237062) — usado por dispersión y genéricos.
    const docValue = `${tx.documentType ?? rawData.documentType ?? ''} ${tx.documentNumber ?? rawData.documentNumber ?? ''}`.trim();

    const fields: { label: string; value: string; copyable?: boolean; link?: string; mono?: boolean }[] = [
      { label: 'Descripción', value: tx.title || TX_LABELS[tx.type] || tx.type },
      // ── Dispersión Mouv: bloque ORDENADO y sin redundancias — quién
      // recibió, a qué llave/cuenta, por qué método, y las referencias.
      // (El "Riel de pago" ya va en el monto "COP · Bre-B" y en el Método.)
      ...(isDispersion && dispBeneficiary ? [{ label: 'Beneficiario', value: dispBeneficiary }] : []),
      ...(isDispersion && docValue ? [{ label: 'Documento', value: docValue }] : []),
      ...(isDispersion && dispDest ? [{ label: tx.currency === 'COP_BREB' ? 'Llave destino' : 'Cuenta destino', value: dispDest, copyable: true, mono: true }] : []),
      ...(isDispersion && tx.bank ? [{ label: 'Método', value: tx.bank }] : []),
      ...(isDispersion && dispProviderRef ? [{ label: 'Referencia Mouv', value: dispProviderRef, copyable: true, mono: true }] : []),
      { label: 'Estado', value: tx.status },
      { label: 'Fecha', value: timeStr ? `${dateStr} · ${timeStr}` : dateStr },
      ...(isCrypto && networkLabel ? [{ label: 'Red', value: networkLabel }] : []),
      ...(isCrypto && cryptoAddress ? [{ label: tx.type === 'otc_withdraw' ? 'Dirección destino' : 'Dirección de depósito', value: cryptoAddress, copyable: true, mono: true }] : []),
      ...(isCrypto && txHash ? [{ label: 'TxID', value: txHash, copyable: true, link: explorerUrl, mono: true }] : []),
      ...(isCrypto && netAmount != null ? [{ label: 'Monto enviado', value: `${netAmount} ${tx.currency}` }] : []),
      ...(isCrypto && networkFee != null ? [{ label: 'Comisión de red', value: `${networkFee} ${tx.currency}` }] : []),
      // Depósito USDT GasFree: origen, destino, red y TxID on-chain.
      ...(isGasfreeDeposit ? [{ label: 'Red', value: depNetwork }] : []),
      ...(isGasfreeDeposit && depFrom ? [{ label: 'De (origen)', value: depFrom, copyable: true, mono: true }] : []),
      ...(isGasfreeDeposit && depTo ? [{ label: 'A (tu wallet GasFree)', value: depTo, copyable: true, mono: true }] : []),
      ...(isGasfreeDeposit && depTxId ? [{ label: 'TxID', value: depTxId, copyable: true, link: depTxUrl, mono: true }] : []),
      // Conversión OTC (Mouv): el desglose completo va aquí — USDT que
      // entró, tasa, COP recibido, USDT que salió a la recaudadora, comisión.
      ...(isMouvConvert ? [{ label: 'Par de conversión', value: 'USDT → COP' }] : []),
      ...(isMouvConvert && mouvFromAmount != null ? [{ label: 'USDT convertido', value: `${Number(mouvFromAmount).toFixed(2)} USDT` }] : []),
      ...(isMouvConvert && mouvRate != null ? [{ label: 'Tasa Lincoin', value: `1 USD = ${Number(mouvRate).toLocaleString('es-CO', { maximumFractionDigits: 2 })} COP${mouvFeePct != null ? ` (comisión ${mouvFeePct}%)` : ''}` }] : []),
      ...(isMouvConvert ? [{ label: 'COP recibido', value: `${formatMoney(tx.amount, 'COP')} COP` }] : []),
      ...(isMouvConvert && gasfreeUsdtOut != null ? [{ label: 'USDT enviado a recaudadora', value: `${Number(gasfreeUsdtOut).toFixed(2)} USDT` }] : []),
      ...(isGasfree && gasfreeActivateFee ? [{ label: 'Activación de wallet (1ª vez)', value: `${Number(gasfreeActivateFee).toFixed(2)} USDT` }] : []),
      ...(isGasfree && gasfreeFee != null ? [{ label: 'Comisión GasFree', value: `${Number(gasfreeFee).toFixed(2)} USDT` }] : []),
      ...(isGasfree && gasfreeTraceId ? [{ label: 'TxID (GasFree)', value: gasfreeTraceId, copyable: true, mono: true }] : []),
      // Conversiones internas (no-Mouv): par/tasa/monto clásicos.
      ...(tx.type === 'convert' && !isMouvConvert && targetCurrency ? [{ label: 'Par de conversión', value: `${tx.currency} → ${targetCurrency}` }] : []),
      ...(tx.type === 'convert' && !isMouvConvert && rate != null ? [{ label: 'Tasa de cambio', value: `1 ${tx.currency} = ${rate.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${targetCurrency}` }] : []),
      ...(tx.type === 'convert' && !isMouvConvert && targetAmount != null ? [{ label: 'Monto recibido', value: `${formatMoney(targetAmount, targetCurrency || '')} ${targetCurrency || ''}` }] : []),
      ...(tx.type === 'convert' && !isMouvConvert && txFee != null ? [{ label: 'Comisión cobrada', value: `${formatMoney(txFee, tx.currency)} ${tx.currency}` }] : []),
      ...(couponCode ? [{ label: 'Cupón aplicado', value: couponCode }] : []),
      ...(!isDispersion && tx.bank ? [{ label: 'Banco / Método', value: tx.bank }] : []),
      ...(!isDispersion && tx.beneficiary ? [{ label: 'Beneficiario', value: tx.beneficiary }] : []),
      ...(!isDispersion && docValue ? [{ label: 'Documento', value: docValue }] : []),
      ...(!isDispersion && tx.account ? [{ label: tx.currency === 'COP_BREB' ? 'Llave destino' : 'Número de cuenta', value: tx.account }] : []),
      ...(!isCrypto && !isGasfreeDeposit && tx.toAddress ? [{ label: 'Dirección destino', value: tx.toAddress, copyable: true, mono: true }] : []),
      ...(tx.reason ? [{ label: 'Motivo', value: tx.reason }] : []),
      { label: 'Referencia', value: String(tx.id) },
    ];

    // ── Compartir / descargar el comprobante como imagen (PNG) ──
    // Se dibuja el comprobante en un canvas (sin librerías externas) con la
    // marca Lincoin, el monto, el estado y todos los campos, y se comparte
    // (share nativo en móvil) o se descarga.
    const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    const roundRect = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    };
    const buildReceiptCanvas = () => {
      const scale = 3, W = 380, PAD = 26, maxW = W - PAD * 2;
      const F_VALUE = `600 14px ${FONT}`, F_LABEL = `700 10px ${FONT}`;
      const mctx = document.createElement('canvas').getContext('2d')!;
      const wrap = (text: string, font: string) => {
        mctx.font = font;
        const out: string[] = [];
        let line = '';
        for (const ch of String(text ?? '')) {
          if (ch === '\n') { out.push(line); line = ''; continue; }
          const test = line + ch;
          if (mctx.measureText(test).width > maxW && line !== '') { out.push(line); line = ch; }
          else line = test;
        }
        out.push(line);
        return out;
      };
      const rows = fields.filter(f => f.label !== 'Estado').map(f => ({ f, lines: wrap(f.value, F_VALUE) }));
      // Medir alto
      let H = PAD + 30 + 22 + 16 + 84 + 20;
      for (const r of rows) H += 16 + r.lines.length * 18 + 14;
      H += 44;

      const canvas = document.createElement('canvas');
      canvas.width = W * scale; canvas.height = H * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);
      // Fondo oscuro Lincoin
      ctx.fillStyle = '#0C0E0D'; ctx.fillRect(0, 0, W, H);

      let y = PAD + 24;
      // Logo: wordmark tipográfico "Lincoin" + punto verde (NUNCA ícono/cubo
      // ni el nombre viejo — reglas de marca en CLAUDE.md).
      ctx.font = `800 26px Archivo, ${FONT}`;
      const wWord = ctx.measureText('Lincoin').width, wDot = ctx.measureText('.').width;
      const gx = (W - (wWord + wDot)) / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#F4F4F2'; ctx.fillText('Lincoin', gx, y);
      ctx.fillStyle = '#4ADE80'; ctx.fillText('.', gx + wWord, y);
      // Subtítulo
      y += 24;
      ctx.textAlign = 'center'; ctx.font = `700 14px Archivo, ${FONT}`; ctx.fillStyle = '#878E88';
      ctx.fillText(`Detalle de ${isCredit ? 'depósito' : 'retiro'}`, W / 2, y);
      // Caja de monto
      y += 16;
      const boxY = y, boxH = 72;
      roundRect(ctx, PAD, boxY, maxW, boxH, 14); ctx.fillStyle = '#121413'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
      roundRect(ctx, PAD, boxY, maxW, boxH, 14); ctx.stroke();
      ctx.font = `800 25px Archivo, ${FONT}`; ctx.fillStyle = isCredit ? '#4ADE80' : '#F4F4F2';
      const amtLabel = `${isCredit ? '+' : '-'}${formatMoney(tx.amount, tx.currency)} ${displayCurrency(tx.currency)}${railOfCurrency(tx.currency) ? ` · ${railOfCurrency(tx.currency)}` : ''}`;
      ctx.fillText(amtLabel, W / 2, boxY + 34);
      // Chip de estado: borde de color, sin fondos rojos/naranjas chillones
      const stCol = tx.status === 'Completado' ? '#4ADE80' : tx.status === 'Pendiente' ? '#F59E0B' : '#F87171';
      ctx.font = `700 11px Archivo, ${FONT}`;
      const stW = ctx.measureText(tx.status).width + 26;
      ctx.strokeStyle = stCol; ctx.lineWidth = 1.2;
      roundRect(ctx, (W - stW) / 2, boxY + 46, stW, 22, 11); ctx.stroke();
      ctx.fillStyle = stCol; ctx.fillText(tx.status, W / 2, boxY + 46 + 15);
      // Campos
      ctx.textAlign = 'left';
      y = boxY + boxH + 20;
      for (const r of rows) {
        ctx.font = F_LABEL; ctx.fillStyle = '#878E88';
        ctx.fillText(r.f.label.toUpperCase(), PAD, y + 10);
        y += 16;
        ctx.font = F_VALUE; ctx.fillStyle = '#F4F4F2';
        for (const ln of r.lines) { ctx.fillText(ln, PAD, y + 13); y += 18; }
        y += 6;
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
        y += 8;
      }
      // Pie
      y += 20;
      ctx.textAlign = 'center'; ctx.font = `600 11px Archivo, ${FONT}`; ctx.fillStyle = 'rgba(244,244,242,0.45)';
      ctx.fillText('Comprobante Lincoin', W / 2, y);
      return canvas;
    };
    const shareReceipt = async () => {
      try {
        const canvas = buildReceiptCanvas();
        const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/png'));
        if (!blob) { showToast('No se pudo generar el comprobante', 4000, 'error'); return; }
        const fileName = `Lincoin-comprobante-${tx.id}.png`;
        const file = new File([blob], fileName, { type: 'image/png' });
        const nav = navigator as any;
        if (nav.canShare && nav.canShare({ files: [file] })) {
          try { await nav.share({ files: [file], title: 'Comprobante Lincoin' }); return; }
          catch { /* usuario canceló el share → cae a descarga */ }
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showToast('Comprobante descargado');
      } catch { showToast('No se pudo generar el comprobante', 4000, 'error'); }
    };
    // Descarga directa (sin diálogo de compartir): guarda el PNG del comprobante.
    const downloadReceipt = async () => {
      try {
        const canvas = buildReceiptCanvas();
        const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/png'));
        if (!blob) { showToast('No se pudo generar el comprobante', 4000, 'error'); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `Lincoin-comprobante-${tx.id}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showToast('Comprobante descargado');
      } catch { showToast('No se pudo generar el comprobante', 4000, 'error'); }
    };

    return (
      <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm" onClick={() => setSelectedTx(null)}>
        <div className="relative bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          {/* Descargar / compartir comprobante — navy con icono blanco (visible;
              antes el hover:bg-[#0C0E0D] activaba la regla global que forzaba el
              icono a blanco SIEMPRE y quedaba invisible sobre el fondo claro). */}
          <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
            <button
              type="button"
              onClick={downloadReceipt}
              title="Descargar comprobante"
              className="w-9 h-9 rounded-full bg-[#0C0E0D] text-white hover:bg-[#152e52] flex items-center justify-center transition-colors shadow-md"
            >
              <Download size={16} />
            </button>
            <button
              type="button"
              onClick={shareReceipt}
              title="Compartir comprobante"
              className="w-9 h-9 rounded-full bg-[#0C0E0D] text-white hover:bg-[#152e52] flex items-center justify-center transition-colors shadow-md"
            >
              <Share2 size={16} />
            </button>
          </div>
          <div className="flex justify-center pt-3 pb-1 sm:hidden">
            <div className="w-10 h-1 bg-slate-200 rounded-full" />
          </div>
          {/* Logo + title — compacto */}
          <div className="flex flex-col items-center pt-4 pb-2 px-6">
            <p className="text-sm font-bold text-slate-800">Detalle de {isCredit ? 'depósito' : 'retiro'}</p>
          </div>
          {/* Amount — contenido, no gigante */}
          <div className="mx-5 mb-3 rounded-xl bg-[#F4F6F9] px-4 py-3 text-center">
            <p className={`text-2xl font-extrabold tracking-tight ${isCredit ? 'text-green-600' : 'text-[#0C0E0D]'}`}>
              {isCredit ? '+' : '-'}{formatMoney(tx.amount, tx.currency)} <span className="text-base">{displayCurrency(tx.currency)}</span>{railOfCurrency(tx.currency) && <span className="text-xs font-semibold text-slate-400 ml-1">· {railOfCurrency(tx.currency)}</span>}
            </p>
            <div className={`inline-flex items-center gap-1 mt-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${tx.status === 'Completado' ? 'bg-white text-green-700 border-green-500' : tx.status === 'Pendiente' ? 'bg-white text-orange-600 border-orange-400' : 'bg-white text-red-700 border-red-400'}`}>
              <CheckCircle size={11} />
              {tx.status}
            </div>
          </div>
          {/* Fields — filas compactas: etiqueta y valor en la misma línea;
              los largos (mono/Motivo) apilados a lo ancho. */}
          <div className="px-5 pb-2">
            {fields.filter(f => f.label !== 'Estado').map((f) => {
              const stacked = f.mono || f.label === 'Motivo';
              return (
              <div key={f.label} className={`py-2 border-b border-slate-100 ${stacked ? '' : 'flex items-center justify-between gap-3'}`}>
                <p className={`text-[11px] font-semibold text-slate-400 ${stacked ? 'mb-0.5' : 'shrink-0'}`}>{f.label}</p>
                <div className={`flex items-center gap-1.5 min-w-0 ${stacked ? 'justify-between' : 'justify-end flex-1'}`}>
                  {f.mono ? (
                    <p className="font-mono text-[11px] text-slate-800 break-all flex-1 leading-relaxed">{f.value}</p>
                  ) : (
                    <p className="font-bold text-[13px] text-slate-800 text-right truncate">{f.value}</p>
                  )}
                  {f.copyable && (
                    <button type="button" onClick={() => copyToClipboard(f.value)} className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors shrink-0">
                      <Copy size={12} />
                    </button>
                  )}
                  {f.link && (
                    <a href={f.link} target="_blank" rel="noopener noreferrer" className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-[#4ADE80] transition-colors shrink-0">
                      <Link2 size={12} />
                    </a>
                  )}
                </div>
              </div>
              );
            })}
          </div>
          {/* Footer */}
          <div className="px-5 pt-3 pb-6">
            <button type="button" onClick={() => setSelectedTx(null)} className="w-full h-11 bg-[#0C0E0D] hover:bg-[#152e52] font-bold rounded-xl transition-colors text-sm">
              Listo
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900 flex">
      {/* Toast */}
      {toastMessage && (
          <div className={`fixed top-6 right-6 z-[70] px-6 py-3 rounded-lg shadow-xl flex items-center gap-3 animate-in slide-in-from-top-4 fade-in max-w-md ${toastType === 'error' ? 'bg-red-600 text-white' : 'bg-[#0C0E0D] text-white'}`}>
              {toastType === 'error' ? <XCircle size={20} className="text-white shrink-0" /> : <CheckCircle size={20} className="text-[#4ADE80] shrink-0" />}
              <span className="font-medium text-sm">{toastMessage}</span>
          </div>
      )}

      {/* Sidebar - COLLAPSIBLE ON MOBILE */}
      <aside className={`
          fixed inset-y-0 left-0 z-30 w-64 bg-white border-r border-slate-200 transform transition-transform duration-300 lg:translate-x-0
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:static flex flex-col
      `}>
          <div className="h-20 flex items-center px-6 border-b border-slate-50">
              {/* Cuentas de empresa: etiqueta BUSINESS bajo el logo (como en el
                  antiguo panel de empresas) */}
              <Logo business={currentUser?.role === 'business'} />
          </div>

          <div className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
              <SidebarItem icon={Home} label="Inicio" active={activeView === 'dashboard'} onClick={() => {setActiveView('dashboard'); setIsMobileMenuOpen(false);}} />
              <SidebarItem icon={Send} label="Enviar Dinero" active={false} onClick={() => { if(!handleActionRestricted()) setIsSendModalOpen(true); }} />
              <SidebarItem icon={RefreshCw} label="Convertir" active={false} onClick={() => { if(!handleActionRestricted()) setIsConvertModalOpen(true); }} />
              <SidebarItem icon={Activity} label="Movimientos" active={activeView === 'movements'} onClick={() => {setActiveView('movements'); setIsMobileMenuOpen(false);}} />
              <SidebarItem icon={BookUser} label="Beneficiarios" active={activeView === 'contactos'} onClick={() => {setActiveView('contactos'); setIsMobileMenuOpen(false);}} />
              
              <div className="pt-6 pb-2 pl-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Descubre</div>
              <SidebarItem 
                  icon={Share2} 
                  label="Invita y Gana" 
                  active={activeView === 'referrals'} 
                  onClick={() => {setActiveView('referrals'); setIsMobileMenuOpen(false);}} 
                  badge={true}
              />
              <SidebarItem 
                  icon={Megaphone} 
                  label="Aliados LINCOIN" 
                  active={activeView === 'affiliates'} 
                  onClick={() => {setActiveView('affiliates'); setIsMobileMenuOpen(false);}} 
              />
          </div>

          <div className="p-4 border-t border-slate-50">
              <button onClick={onLogout} className="flex items-center gap-3 w-full px-4 py-3 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors font-medium text-sm">
                  <LogOut size={18} /> Cerrar Sesión
              </button>
          </div>
      </aside>

      <main className="flex-1 lg:pt-0 pt-16 h-screen overflow-y-auto p-4 md:p-8 lg:p-10">
          <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-20">
              <Logo collapsed />
              <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 text-slate-600">
                  <span className="sr-only">Menu</span>
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
          </header>

          {activeView === 'dashboard' && renderDashboard()}
          {activeView === 'movements' && renderMovements()}
          {activeView === 'wallet-detail' && renderWalletDetail()}
          {activeView === 'profile' && renderProfile()}
          {activeView === 'referrals' && renderReferrals()}
          {activeView === 'affiliates' && renderAffiliates()}
          {activeView === 'settings' && renderSettings()}
      {activeView === 'servicios' && renderServicios()}
      {activeView === 'walletsGasfree' && currentUser?.id && (
          <WalletsGasfreeSection
              userId={currentUser.id}
              callGasfree={callGasfree}
              showToast={showToast}
              onBack={() => setActiveView('servicios')}
          />
      )}
      {activeView === 'contactos' && (
          <ContactsSection
              onBack={() => setActiveView('dashboard')}
              onSendTo={(c: any) => {
                  // "Enviar" desde Beneficiarios: abre Enviar Dinero con el
                  // beneficiario, país y riel preseleccionados. Solo falta el
                  // monto — al continuar salta directo a la confirmación.
                  const isWallet = c.accountKind === 'wallet';
                  setSendForm({
                      destinationCountry: isWallet ? 'Estados Unidos' : (c.country || 'Colombia'),
                      destinationCurrency: isWallet ? 'USD' : (c.country && c.country !== 'Colombia' ? sendForm.destinationCurrency : 'COP'),
                      amount: '',
                      beneficiaryType: c.kind === 'empresa' ? 'business' : 'personal',
                      beneficiaryName: c.name,
                      documentType: c.docType ?? '',
                      documentNumber: c.docNumber ?? '',
                      bankName: c.bank ?? '',
                      accountType: c.accountType ?? '',
                      accountNumber: c.accountNumber ?? '',
                      reason: 'Envío de dinero',
                  });
                  setSendContact(c);
                  setSendMode(isWallet ? 'wallet' : 'bank');
                  setSendSourceRail(isWallet ? 'COP' : (c.destKind === 'breb' ? 'COP_BREB' : 'COP_ACH'));
                  setMouvDestId(null);
                  setSendStep(1);
                  setActiveView('dashboard');
                  setIsSendModalOpen(true);
              }}
          />
      )}
      {activeView === 'mouv' && currentUser?.id && (
          <div className="pt-6">
              <button onClick={() => setActiveView('dashboard')} className="flex items-center gap-2 text-slate-700 font-bold text-sm hover:text-[#0C0E0D] mb-2">
                  <ArrowLeft size={16} /> Volver
              </button>
              {mouvMode === 'full' ? (
                  <MouvDispersion
                      userId={currentUser.id}
                      rail={dispersRail}
                      balance={getBalance(dispersRail)}
                      authHeader={myAuthHeader}
                      onDone={() => refreshData?.()}
                  />
              ) : mouvMode === 'converter' && (currentUser as any)?.otcConfig?.enabled !== true ? (
                  <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                      <p className="text-slate-500 text-sm">El servicio OTC no está habilitado para tu cuenta todavía.</p>
                      <p className="text-slate-400 text-xs mt-1">Escríbenos a soporte para activarlo.</p>
                  </div>
              ) : (
              <MouvSection
                  mode={mouvMode}
                  userId={currentUser.id}
                  brebBalance={getBalance('COP_BREB')}
                  usdBalance={displayBalance('USD')}
                  copBalance={getBalance('COP')}
                  onSwept={() => currentUser?.id && refreshGasfreeBal(currentUser.id)}
                  feePctOverride={(currentUser as any)?.otcConfig?.feePct}
                  onConverted={async (usdAmount, copClientAmount, mouvRate) => {
                      // Movimiento OPTIMISTA: aparece al instante en la lista.
                      addLocalTx?.({
                          userId: currentUser.id, type: 'convert', amount: copClientAmount, currency: 'COP', status: 'Completado',
                          initials: 'FX', title: `USDT → COP · tasa ${Number(mouvRate ?? 0).toLocaleString('es-CO')}`,
                          userName: (currentUser as any)?.email, fromCurrency: 'USD', fromAmount: usdAmount,
                          destAmount: copClientAmount, mouvRate, source: 'MOUV', gasfree: true,
                      });
                      // Todo el asentamiento (débito USDT on-chain, crédito COP y
                      // el movimiento) ya lo hizo el edge (my_convert_settle),
                      // autoritativo. Aquí SOLO se refresca la vista: el COP se
                      // relee de la DB y el saldo USDT del on-chain real.
                      showToast(`Convertiste ${usdAmount.toLocaleString('en-US')} USDT → ${copClientAmount.toLocaleString('es-CO')} COP (Peso Lincoin) ⚡`);
                      // Actualización OPTIMISTA e inmediata del Peso Lincoin (el
                      // crédito ya lo hizo el edge) — así no hay que recargar.
                      bumpLocalBalance?.('COP', copClientAmount);
                      // Refrescos ESCALONADOS: la fila de la conversión pasa de
                      // 'Pendiente' (insert del settle) a 'Completado' (credit)
                      // y en sesiones half-auth la DB puede tardar en reflejarlo
                      // para la lectura — se reintenta unas veces.
                      refreshData?.();
                      setTimeout(() => refreshData?.(), 2500);
                      setTimeout(() => refreshData?.(), 6000);
                      if (currentUser?.id) refreshGasfreeBal(currentUser.id);
                  }}
                  onDispersed={async (amount, reference) => {
                      // La dispersión sale del saldo BreB Lincoin
                      await updateUserProfile(currentUser.id, {
                          balances: { COP_BREB: getBalance('COP_BREB') - amount },
                      });
                      try {
                          await supabase.from('transactions').insert({
                              user_id: currentUser.id,
                              type: 'send', amount, currency: 'COP', status: 'Completado',
                              raw_data: {
                                  initials: 'BB',
                                  title: `Dispersión Bre-B${reference ? ` · ${reference}` : ''}`,
                                  date: new Date().toLocaleDateString('es-CO'), createdAt: new Date().toISOString(),
                                  userName: currentUser.name,
                              },
                          });
                      } catch { /* saldo ya debitado; el registro es best-effort */ }
                  }}
              />
              )}
          </div>
      )}
      </main>

      {/* --- MODALS --- */}

      {/* WALLET ORDER MODAL */}
      {isWalletOrderModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" onClick={() => setIsWalletOrderModalOpen(false)}>
              <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center p-5 border-b border-slate-100">
                      <div>
                          <h3 className="font-bold text-slate-800">Ordenar billeteras</h3>
                          <p className="text-xs text-slate-400 mt-0.5">Las primeras aparecen en tu inicio</p>
                      </div>
                      <button onClick={() => setIsWalletOrderModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
                  </div>
                  <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
                      {walletDraftOrder.map((code, index) => {
                          const wallet = myWallets.find(w => w.code === code);
                          if (!wallet) return null;
                          const isVisible = index < 3;
                          return (
                              <div key={code} className={`flex items-center gap-3 p-3 rounded-xl border ${isVisible ? 'border-[#0C0E0D]/20 bg-slate-50/40' : 'border-slate-200 bg-slate-50/40'}`}>
                                  <span className={`text-[10px] font-bold w-6 text-center ${isVisible ? 'text-[#0C0E0D]' : 'text-slate-400'}`}>#{index + 1}</span>
                                  <FlagImg code={code} className="w-7 h-5 object-cover rounded shadow-sm shrink-0" />
                                  <div className="flex-1 min-w-0">
                                      <p className="font-bold text-slate-800 text-sm leading-tight truncate">{wallet.name}</p>
                                      <p className="text-[10px] text-slate-400">{wallet.code}</p>
                                  </div>
                                  {isVisible && <span className="text-[9px] font-bold text-[#0C0E0D] bg-slate-100 px-1.5 py-0.5 rounded shrink-0">Visible</span>}
                                  <div className="flex flex-col gap-0.5 shrink-0">
                                      <button onClick={() => moveWalletInDraft(index, -1)} disabled={index === 0} className="p-1 text-slate-400 hover:text-[#0C0E0D] disabled:opacity-25 disabled:cursor-not-allowed transition-colors">
                                          <ChevronUp size={14}/>
                                      </button>
                                      <button onClick={() => moveWalletInDraft(index, 1)} disabled={index === walletDraftOrder.length - 1} className="p-1 text-slate-400 hover:text-[#0C0E0D] disabled:opacity-25 disabled:cursor-not-allowed transition-colors">
                                          <ChevronDown size={14}/>
                                      </button>
                                  </div>
                              </div>
                          );
                      })}
                  </div>
                  <div className="p-4 border-t border-slate-100 flex gap-3">
                      <button onClick={() => setIsWalletOrderModalOpen(false)} className="flex-1 h-11 border border-slate-200 rounded-xl text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors">Cancelar</button>
                      <button onClick={saveWalletOrder} className="flex-1 h-11 bg-[#0C0E0D] hover:bg-[#152e52] text-sm font-bold rounded-xl transition-colors">Guardar</button>
                  </div>
              </div>
          </div>
      )}

      {/* 2FA ENROLLMENT MODAL */}
      {mfaModalOpen && mfaEnrollData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 animate-in zoom-in-95 relative">
                  <button onClick={() => { unenrollMFA(mfaEnrollData.factorId); setMfaModalOpen(false); setMfaEnrollData(null); }} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20}/></button>
                  <div className="text-center mb-6">
                      <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                          <ShieldCheck size={24} className="text-[#0C0E0D]"/>
                      </div>
                      <h3 className="text-xl font-bold text-[#0C0E0D]">Activar verificación en 2 pasos</h3>
                      <p className="text-slate-500 text-sm mt-1">Escanea el código QR con tu app autenticadora</p>
                  </div>
                  <div className="flex flex-col items-center mb-6">
                      <div className="bg-white border-2 border-slate-200 rounded-xl p-3 mb-4">
                          <img src={mfaEnrollData.qrCode} alt="QR Code 2FA" className="w-48 h-48" />
                      </div>
                      <p className="text-xs text-slate-500 mb-1 font-medium">O ingresa este código manualmente:</p>
                      <code className="bg-slate-100 text-slate-700 font-mono text-xs px-3 py-2 rounded-lg tracking-widest break-all text-center">
                          {mfaEnrollData.secret}
                      </code>
                  </div>
                  <p className="text-xs text-slate-500 text-center mb-4">Usa <strong>Google Authenticator</strong>, <strong>Authy</strong> o cualquier app TOTP. Luego ingresa el código de 6 dígitos:</p>
                  {mfaVerifyError && <p className="text-red-500 text-sm text-center mb-3">{mfaVerifyError}</p>}
                  <input
                      type="text" inputMode="numeric" maxLength={6}
                      value={mfaVerifyCode}
                      onChange={(e) => setMfaVerifyCode(e.target.value.replace(/\D/g, ''))}
                      className="w-full h-14 text-center text-2xl font-bold tracking-[0.4em] border-2 border-slate-200 rounded-xl focus:border-[#0C0E0D] outline-none mb-4 bg-slate-50"
                      placeholder="000000"
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleVerifyMFAEnrollment()}
                  />
                  <button
                      onClick={handleVerifyMFAEnrollment}
                      disabled={mfaVerifyCode.length !== 6 || mfaVerifyLoading}
                      className="w-full h-12 bg-[#0C0E0D] font-bold rounded-xl disabled:opacity-50 hover:bg-[#152e52] transition-colors"
                  >
                      {mfaVerifyLoading ? 'Verificando...' : 'Confirmar activación'}
                  </button>
              </div>
          </div>
      )}

      {/* 2FA DISABLE MODAL */}
      {mfaDisableModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 animate-in zoom-in-95">
                  <h3 className="text-lg font-bold text-slate-800 mb-2">Desactivar 2FA</h3>
                  <p className="text-slate-500 text-sm mb-6">¿Estás seguro? Tu cuenta quedará protegida solo con contraseña.</p>
                  <div className="flex gap-3">
                      <button onClick={() => setMfaDisableModalOpen(false)} className="flex-1 h-11 border border-slate-200 text-slate-600 font-bold rounded-lg hover:bg-slate-50 transition-colors">
                          Cancelar
                      </button>
                      <button onClick={handleDisableMFA} className="flex-1 h-11 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors">
                          Desactivar
                      </button>
                  </div>
              </div>
          </div>
      )}

      {renderTxDetail()}

      {/* PAY 2FA VERIFY MODAL */}
      {showPayVerify && (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden p-6">
                  <div className="flex items-center justify-between mb-5">
                      <h3 className="font-bold text-slate-800 text-lg">Verificación 2FA</h3>
                      <button type="button" onClick={() => setShowPayVerify(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100"><X size={20}/></button>
                  </div>
                  <p className="text-sm text-slate-500 mb-4 text-center">Ingresa el código de 6 dígitos de tu app autenticadora para confirmar el pago.</p>
                  {payVerifyError && <p className="text-red-500 text-sm text-center mb-3">{payVerifyError}</p>}
                  <input
                      type="text" inputMode="numeric" maxLength={6}
                      value={payVerifyCode}
                      onChange={e => setPayVerifyCode(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={e => e.key === 'Enter' && handlePayVerifyAndSend()}
                      className="w-full h-14 text-center text-2xl font-bold tracking-[0.4em] border-2 border-slate-200 rounded-xl focus:border-[#0C0E0D] outline-none mb-4 bg-slate-50"
                      placeholder="000000"
                      autoFocus
                  />
                  <button
                      type="button"
                      onClick={handlePayVerifyAndSend}
                      disabled={payVerifyCode.length !== 6 || payVerifyLoading}
                      className="w-full h-12 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                      {payVerifyLoading ? 'Verificando...' : 'Confirmar Pago'}
                  </button>
              </div>
          </div>
      )}

      {/* PAY-LINK MODAL */}
      {isPayLinkOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-300">

                  {/* Header */}
                  <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                          {payLinkStep > 1 && payLinkStep < 3 && (
                              <button onClick={() => setPayLinkStep(s => s - 1)} className="text-slate-400 hover:text-slate-700 p-1">
                                  <ArrowLeft size={18}/>
                              </button>
                          )}
                          <div>
                              <h3 className="font-bold text-slate-800">
                                  {payLinkStep === 1 ? 'Nuevo Link de Pago' : payLinkStep === 2 ? 'Datos del Pagador' : 'Link Generado'}
                              </h3>
                              <p className="text-xs text-slate-400">Paso {payLinkStep} de 3</p>
                          </div>
                      </div>
                      <button onClick={closePayLink} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100"><X size={20}/></button>
                  </div>

                  <div className="p-5 overflow-y-auto max-h-[80vh]">

                      {/* ─── STEP 1: Country + Amount ─── */}
                      {payLinkStep === 1 && (
                          <div className="space-y-5">
                              <p className="text-sm text-slate-500">Selecciona el país del pagador y el monto a cobrar.</p>

                              {/* Country grid */}
                              <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase mb-3">País del pagador</label>
                                  <div className="grid grid-cols-4 gap-2">
                                      {PAY_LINK_COUNTRIES.map(c => {
                                          const sel = payLinkCountry === c.code;
                                          return (
                                          <button
                                              key={c.code}
                                              onClick={() => handleSelectPayLinkCountry(c.code)}
                                              className="flex flex-col items-center gap-1 p-2.5 rounded-xl transition-all"
                                              style={{
                                                  border: sel ? '1.5px solid #4ADE80' : '1px solid rgba(255,255,255,0.14)',
                                                  background: sel ? 'rgba(74,222,128,0.12)' : 'transparent',
                                              }}
                                          >
                                              <FlagImg code={c.code} className="w-8 h-6 object-cover rounded shadow-sm" />
                                              <span className="text-[10px] font-bold" style={{ color: sel ? '#4ADE80' : '#878E88' }}>{c.code}</span>
                                          </button>
                                          );
                                      })}
                                  </div>
                              </div>

                              {/* Amount */}
                              <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Monto a cobrar</label>
                                  <div className="flex items-center border border-slate-300 rounded-xl overflow-hidden focus-within:border-[#0C0E0D] transition-colors">
                                      <input
                                          type="text"
                                          inputMode="numeric"
                                          placeholder="0"
                                          value={payLinkAmount ? payLinkAmount.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : ''}
                                          onChange={e => setPayLinkAmount(e.target.value.replace(/\./g, '').replace(/\D/g, ''))}
                                          className="flex-1 px-4 py-3 text-lg font-bold text-slate-800 outline-none bg-transparent"
                                      />
                                      <span className="px-4 py-3 bg-slate-50 font-bold text-slate-500 text-sm border-l border-slate-200">
                                          {PAY_LINK_COUNTRIES.find(c => c.code === payLinkCountry)?.currency}
                                      </span>
                                  </div>
                              </div>

                              <button
                                  onClick={() => setPayLinkStep(2)}
                                  disabled={!payLinkAmount || Number(payLinkAmount) <= 0}
                                  style={{ color: '#FFFFFF' }}
                                  className="w-full py-3.5 bg-[#0C0E0D] font-bold rounded-xl hover:bg-[#152e52] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                  Continuar
                              </button>
                          </div>
                      )}

                      {/* ─── STEP 2: Payer Form ─── */}
                      {payLinkStep === 2 && (
                          <div className="space-y-4">
                              <p className="text-sm text-slate-500">Ingresa los datos de quien realizará el pago.</p>

                              <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nombre completo del pagador</label>
                                  <input
                                      type="text"
                                      placeholder="Ej. Juan García López"
                                      value={payLinkPayerName}
                                      onChange={e => setPayLinkPayerName(e.target.value)}
                                      className="w-full px-4 py-3 border border-slate-300 rounded-xl outline-none focus:border-[#0C0E0D] transition-colors text-slate-800"
                                  />
                              </div>

                              <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Tipo de documento</label>
                                  <select
                                      value={payLinkDocType}
                                      onChange={e => setPayLinkDocType(e.target.value)}
                                      className="w-full px-4 py-3 border border-slate-300 rounded-xl outline-none focus:border-[#0C0E0D] transition-colors text-slate-800 bg-white"
                                  >
                                      {(DOC_TYPES[payLinkCountry] ?? []).map(d => (
                                          <option key={d.value} value={d.value}>{d.label}</option>
                                      ))}
                                  </select>
                              </div>

                              <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Número de documento</label>
                                  <input
                                      type="text"
                                      placeholder="Ej. 1234567890"
                                      value={payLinkDocNumber}
                                      onChange={e => setPayLinkDocNumber(e.target.value)}
                                      className="w-full px-4 py-3 border border-slate-300 rounded-xl outline-none focus:border-[#0C0E0D] transition-colors text-slate-800"
                                  />
                              </div>

                              {/* Summary */}
                              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-sm space-y-1">
                                  <div className="flex justify-between">
                                      <span className="text-slate-500">País</span>
                                      <span className="font-bold flex items-center gap-1.5"><FlagImg code={payLinkCountry} size="sm" /> {PAY_LINK_COUNTRIES.find(c => c.code === payLinkCountry)?.name}</span>
                                  </div>
                                  <div className="flex justify-between">
                                      <span className="text-slate-500">Monto</span>
                                      <span className="font-bold text-[#0C0E0D]">{Number(payLinkAmount).toLocaleString()} {PAY_LINK_COUNTRIES.find(c => c.code === payLinkCountry)?.currency}</span>
                                  </div>
                              </div>

                              <button
                                  onClick={handleGeneratePayLink}
                                  disabled={!payLinkPayerName.trim() || !payLinkDocNumber.trim()}
                                  className="w-full py-3.5 bg-[#4ADE80] text-[#0C0E0D] font-bold rounded-xl hover:bg-[#22C55E] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                              >
                                  <Link2 size={18}/> Generar Link de Pago
                              </button>
                          </div>
                      )}

                      {/* ─── STEP 3: Result ─── */}
                      {payLinkStep === 3 && (
                          <div className="space-y-5 text-center">

                              {/* Countdown */}
                              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold ${payLinkSecondsLeft > 300 ? 'bg-green-50 text-green-700' : payLinkSecondsLeft > 60 ? 'bg-orange-50 text-orange-700' : 'bg-red-50 text-red-700'}`}>
                                  <Timer size={16}/>
                                  {payLinkSecondsLeft > 0 ? `Expira en ${formatCountdown(payLinkSecondsLeft)}` : 'Link vencido'}
                              </div>

                              {/* QR Code */}
                              <div className="flex justify-center">
                                  <div className="bg-white border-2 border-slate-200 rounded-2xl p-3 shadow-sm inline-block">
                                      <img
                                          src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(payLinkUrl)}&color=0B1B32`}
                                          alt="QR Link de Pago"
                                          className="w-44 h-44"
                                      />
                                  </div>
                              </div>

                              {/* Link */}
                              <div>
                                  <p className="text-xs text-slate-400 mb-2 font-bold uppercase">Link de pago único</p>
                                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                                      <span className="text-sm text-[#0C0E0D] font-mono flex-1 text-left break-all">{payLinkUrl}</span>
                                      <button
                                          onClick={() => { navigator.clipboard?.writeText(payLinkUrl); showToast('Link copiado'); }}
                                          className="shrink-0 p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"
                                      >
                                          <Copy size={16}/>
                                      </button>
                                  </div>
                              </div>

                              {/* Payer info summary */}
                              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-sm space-y-1 text-left">
                                  <p className="font-bold text-slate-700 mb-2">Resumen del cobro</p>
                                  <div className="flex justify-between"><span className="text-slate-500">Pagador</span><span className="font-bold">{payLinkPayerName}</span></div>
                                  <div className="flex justify-between"><span className="text-slate-500">Documento</span><span className="font-bold">{payLinkDocType} {payLinkDocNumber}</span></div>
                                  <div className="flex justify-between"><span className="text-slate-500">Monto</span><span className="font-bold text-[#0C0E0D]">{Number(payLinkAmount).toLocaleString()} {PAY_LINK_COUNTRIES.find(c => c.code === payLinkCountry)?.currency}</span></div>
                              </div>

                              <div className="flex gap-3">
                                  <button
                                      onClick={() => { if (navigator.share) { navigator.share({ title: 'Link de pago LINCOIN', url: payLinkUrl }); } else { navigator.clipboard?.writeText(payLinkUrl); showToast('Link copiado'); } }}
                                      className="flex-1 py-3 bg-[#0C0E0D] font-bold rounded-xl hover:bg-[#152e52] transition-colors flex items-center justify-center gap-2"
                                  >
                                      <Share2 size={16}/> Compartir
                                  </button>
                                  <button onClick={closePayLink} className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors">
                                      Cerrar
                                  </button>
                              </div>
                          </div>
                      )}

                  </div>
              </div>
          </div>
      )}

      {/* LOAD MODAL */}
      {/* Celebración cuando llega un depósito — animación + (sonido ya sonó) */}
      {depositFx && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center pointer-events-none p-4" style={{ fontFamily: "'Archivo', system-ui, sans-serif" }}>
              <div className="lincoin-deposit-fx" style={{ background: '#0C0E0D', border: '1px solid rgba(74,222,128,0.4)', borderRadius: 20, padding: '30px 40px', textAlign: 'center', boxShadow: '0 30px 90px rgba(0,0,0,0.65)' }}>
                  <div style={{ position: 'relative', width: 72, height: 72, margin: '0 auto 16px' }}>
                      <span className="lincoin-fx-ring" style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(74,222,128,0.5)' }} />
                      <div className="lincoin-fx-check" style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(74,222,128,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <CheckCircle2 size={40} style={{ color: '#4ADE80' }} />
                      </div>
                  </div>
                  <p style={{ color: '#F4F4F2', fontWeight: 800, fontSize: 26, letterSpacing: '-0.6px', lineHeight: 1 }}>+{depositFx.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ fontSize: 16, color: '#878E88' }}>USDT</span></p>
                  <p style={{ color: '#878E88', fontSize: 13, marginTop: 6 }}>Depósito acreditado a tu Dólar digital</p>
              </div>
          </div>
      )}

      {/* Cargar USDT — depósito on-chain a la wallet GasFree del cliente */}
      {usdtModalOpen && (
          <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(4,5,4,0.72)', backdropFilter: 'blur(3px)', fontFamily: "'Archivo', system-ui, sans-serif" }} onClick={() => setUsdtModalOpen(false)}>
              <div onClick={(e) => e.stopPropagation()} className="w-full animate-in fade-in zoom-in-95 duration-200" style={{ maxWidth: 468, background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, overflow: 'hidden' }} role="dialog" aria-modal="true">
                  {/* Cabecera — mismo fondo, sin banda gris */}
                  <div className="flex items-start justify-between" style={{ gap: 16, padding: '22px 24px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <div className="flex items-center gap-3">
                          <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#26A17B', color: '#fff', fontWeight: 800, fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>₮</div>
                          <div>
                              <h3 style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.3px', color: '#F4F4F2' }}>Cargar dólar digital</h3>
                              <p style={{ fontSize: 12.5, color: '#878E88', marginTop: 3 }}>Recibe USDT en tu dirección personal</p>
                          </div>
                      </div>
                      <button onClick={() => setUsdtModalOpen(false)} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', color: '#878E88', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} className="hover:bg-white/[0.05] transition-colors"><X size={14}/></button>
                  </div>

                  <div style={{ padding: '20px 24px 24px' }}>
                      {/* Red de depósito — Lincoin solo usa TRON */}
                      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: '#878E88', marginBottom: 9 }}>RED DE DEPÓSITO</p>
                      <div style={{ display: 'flex', gap: 7 }}>
                          <div style={{ flex: 1, textAlign: 'center', padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 700, color: '#F4F4F2', border: '1px solid rgba(74,222,128,0.35)', background: 'rgba(74,222,128,0.07)' }}>TRON · TRC-20</div>
                      </div>
                      <p style={{ fontSize: 12, color: '#878E88', lineHeight: 1.5, margin: '9px 0 0' }}>El USDT circula por la red TRON (TRC-20). Sin gas para ti: la comisión de red se paga en USDT vía GasFree.</p>

                      {/* QR + dirección */}
                      {usdtLoadingAddr ? (
                          <div style={{ marginTop: 16, height: 156, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }} className="animate-pulse" />
                      ) : usdtLoadErr ? (
                          <div style={{ marginTop: 16, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', color: '#878E88', fontSize: 12.5 }}>{usdtLoadErr}</div>
                      ) : usdtAddr && (
                          <div style={{ marginTop: 16, padding: 20, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: 18, alignItems: 'center' }}>
                              <div style={{ width: 116, height: 116, background: '#F4F4F2', borderRadius: 10, padding: 8, flexShrink: 0 }}>
                                  <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(usdtAddr)}&color=0A0A0A&bgcolor=F4F4F2&margin=0`} alt="QR dirección USDT" style={{ width: '100%', height: '100%' }} />
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: '#878E88' }}>TU DIRECCIÓN USDT · TRON</p>
                                  <p style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, lineHeight: 1.5, wordBreak: 'break-all', color: '#F4F4F2', marginTop: 7 }}>{usdtAddr}</p>
                                  <div style={{ display: 'flex', gap: 7, marginTop: 12 }}>
                                      <button onClick={() => { navigator.clipboard?.writeText(usdtAddr); showToast('Dirección copiada'); }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, color: '#F4F4F2' }} className="hover:bg-white/[0.09] transition-colors"><Copy size={13}/> Copiar</button>
                                      <button onClick={() => { const t = `Mi dirección USDT (TRON): ${usdtAddr}`; if ((navigator as any).share) { (navigator as any).share({ text: t }).catch(() => {}); } else { navigator.clipboard?.writeText(usdtAddr); showToast('Dirección copiada'); } }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, color: '#F4F4F2' }} className="hover:bg-white/[0.09] transition-colors"><Send size={13}/> Compartir</button>
                                  </div>
                              </div>
                          </div>
                      )}

                      {/* Detalles del depósito */}
                      <div style={{ marginTop: 16, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden' }}>
                          {[['Moneda aceptada', 'USDT únicamente', false], ['Depósito mínimo', '1,00 USDT', false], ['Se acredita tras', 'confirmación en TRON · ~1 min', false], ['Comisión de Lincoin', 'Sin comisión', true]].map(([k, v, green], i) => (
                              <div key={k as string} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', fontSize: 13, borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
                                  <span style={{ color: '#878E88' }}>{k}</span>
                                  <span style={{ color: green ? '#4ADE80' : '#F4F4F2', fontWeight: 700 }}>{v}</span>
                              </div>
                          ))}
                      </div>

                      {/* Advertencia — gris con filo verde, sin amarillo */}
                      <div style={{ display: 'flex', gap: 11, marginTop: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderLeft: '2px solid #4ADE80', borderRadius: 10, padding: '13px 15px' }}>
                          <Info size={16} style={{ color: '#878E88', flexShrink: 0, marginTop: 1 }} />
                          <p style={{ fontSize: 12.5, color: '#878E88', lineHeight: 1.55 }}>Envía <b style={{ color: '#F4F4F2', fontWeight: 700 }}>solo USDT por la red TRON (TRC-20)</b> a esta dirección. Otra moneda u otra red no se puede recuperar.</p>
                      </div>

                      {/* Acciones — primario BLANCO, sin verde ni glow */}
                      <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
                          <button onClick={() => setUsdtModalOpen(false)} style={{ flex: 1, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)', color: '#F4F4F2', fontWeight: 600, fontSize: 14, padding: '13px 0', borderRadius: 10 }} className="hover:bg-white/[0.09] transition-colors">Cerrar</button>
                          <button onClick={verifyUsdtDeposit} disabled={usdtVerifying || !usdtAddr} style={{ flex: 1.4, fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 10, opacity: (usdtVerifying || !usdtAddr) ? 0.6 : 1 }} className="lincoin-btn-white transition-colors">{usdtVerifying ? 'Buscando tu depósito…' : 'Ya envié el depósito'}</button>
                      </div>

                      {/* Estado de monitoreo */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ADE80' }} className="lincoin-op-dot" />
                          <span style={{ fontSize: 12, color: '#878E88' }}>Estamos monitoreando la red. El saldo aparecerá solo.</span>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {isLoadModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <h3 className="font-bold text-lg text-slate-800">Cargar Saldo Personal</h3>
                      <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors"><X size={20}/></button>
                  </div>
                  
                  <div className="p-6 overflow-y-auto">
                      {loadStep === 1 && (
                          <div className="space-y-4">
                              <p className="text-sm text-slate-500 mb-2">Selecciona el país desde donde transfieres:</p>
                              {Object.keys(bankingOptions).length === 0 ? (
                                  <div className="text-center py-8 text-slate-400">
                                      <p className="font-medium">Métodos de pago no disponibles aún.</p>
                                      <p className="text-sm mt-1">Contáctanos para coordinar tu depósito.</p>
                                  </div>
                              ) : Object.keys(bankingOptions).map(country => (
                                  <button key={country} onClick={() => { setSelectedCountry(country); setLoadStep(2); }} className="w-full flex items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-[#0C0E0D] hover:bg-slate-50 transition-all group">
                                      <span className="font-bold text-slate-700 group-hover:text-[#0C0E0D]">{country}</span>
                                      <ChevronDown className="text-slate-300 group-hover:text-[#0C0E0D]"/>
                                  </button>
                              ))}
                          </div>
                      )}
                      {/* ... other steps same ... */}
                      {loadStep === 2 && selectedCountry && (
                          <div className="space-y-4">
                              <button onClick={() => setLoadStep(1)} className="text-xs text-slate-400 flex items-center gap-1 hover:text-slate-600 mb-2"><ArrowLeft size={12}/> Cambiar país</button>
                              <p className="text-sm text-slate-500">Selecciona el método de carga en {selectedCountry}:</p>
                              {(bankingOptions[selectedCountry] || []).map(bank => (
                                  <button key={bank.id} onClick={() => handleBankSelect(bank.name)} className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 hover:border-[#0C0E0D] hover:bg-slate-50 transition-all group text-left">
                                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs ${bank.logoColor || 'bg-slate-100 text-slate-600'}`}>{bank.logoText || bank.name.substring(0, 2)}</div>
                                      <div>
                                          <p className="font-bold text-slate-700 group-hover:text-[#0C0E0D]">{bank.name}</p>
                                          <p className="text-xs text-slate-400">{bank.type === 'qr' ? 'Escanea y paga al instante' : bank.type === 'crypto' ? 'Depósito vía Cripto' : 'Transferencia bancaria local'}</p>
                                      </div>
                                  </button>
                              ))}
                          </div>
                      )}
                      {loadStep === 3 && (
                          <div className="space-y-6">
                              <button onClick={() => setLoadStep(2)} className="text-xs text-slate-400 flex items-center gap-1 hover:text-slate-600"><ArrowLeft size={12}/> Volver a bancos</button>
                              <div>
                                  <label className="block text-sm font-bold text-slate-700 mb-2">¿Cuánto deseas cargar?</label>
                                  <div className="relative">
                                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                                      <input 
                                          type="text" 
                                          value={loadAmount} 
                                          onChange={(e) => setLoadAmount(formatInputNumber(e.target.value))} 
                                          className="w-full h-14 pl-8 pr-4 text-2xl font-bold text-slate-900 border border-slate-200 rounded-xl focus:border-[#0C0E0D] focus:ring-1 focus:ring-[#0C0E0D] outline-none transition-all" 
                                          placeholder="0" 
                                          autoFocus
                                      />
                                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                                          {selectedCountry === 'Colombia' ? 'COP' : selectedCountry === 'Perú' ? 'PEN' : selectedCountry === 'México' ? 'MXN' : selectedCountry === 'Brasil' ? 'BRL' : selectedCountry === 'Venezuela' ? 'VES' : 'USD'}
                                      </span>
                                  </div>
                              </div>
                              <button onClick={handleAmountConfirm} style={{ color: '#FFFFFF' }} className="w-full py-4 bg-[#0C0E0D] font-bold rounded-xl hover:bg-[#152e52] shadow-lg transition-transform active:scale-95">Continuar</button>
                          </div>
                      )}
                      {loadStep === 4 && (
                          <div className="space-y-6 animate-in fade-in">
                              <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 flex items-start gap-3">
                                  <Clock className="text-orange-500 shrink-0 mt-0.5" size={18}/>
                                  <div>
                                      <p className="text-sm font-bold text-orange-800">Tienes 5 minutos para transferir</p>
                                      <p className="text-xs text-orange-600">La tasa de cambio se mantendrá por {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</p>
                                  </div>
                              </div>
                              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                                  <div className="flex justify-between items-center py-2 border-b border-slate-200">
                                      <span className="text-slate-500 text-sm">Monto a Transferir</span>
                                      <span className="font-extrabold text-[#0C0E0D] text-lg text-right">
                                          {formatMoney(getRawAmount(loadAmount), selectedCountry === 'Colombia' ? 'COP' : selectedCountry === 'Perú' ? 'PEN' : selectedCountry === 'México' ? 'MXN' : selectedCountry === 'Brasil' ? 'BRL' : selectedCountry === 'Venezuela' ? 'VES' : 'USD')}
                                      </span>
                                  </div>
                                  <div className="py-2">
                                      <p className="text-xs font-bold text-slate-400 uppercase mb-2">Cuenta Destino</p>
                                      <p className="font-bold text-slate-800">{selectedBankName}</p>
                                      <p className="text-sm text-slate-600">
                                          {bankingOptions[selectedCountry]?.find(b => b.name === selectedBankName)?.accountNumber || '123-456-7890'}
                                      </p>
                                      <p className="text-xs text-slate-500 mt-1">
                                          {bankingOptions[selectedCountry]?.find(b => b.name === selectedBankName)?.beneficiary || 'LINCOIN CORP'}
                                      </p>
                                  </div>
                              </div>
                              <div>
                                  <label className="block text-sm font-bold text-slate-700 mb-2">Adjuntar Comprobante</label>
                                  <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:bg-slate-50 transition-colors cursor-pointer relative">
                                      <input type="file" onChange={(e) => setProofFile(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*,.pdf"/>
                                      {proofFile ? (
                                          <div className="flex items-center justify-center gap-2 text-green-600 font-bold">
                                              <CheckCircle size={20} /> {proofFile.name}
                                          </div>
                                      ) : (
                                          <div className="text-slate-400">
                                              <UploadCloud size={32} className="mx-auto mb-2"/>
                                              <p className="text-sm font-medium">Click para subir o arrastra aquí</p>
                                          </div>
                                      )}
                                  </div>
                              </div>
                              <button onClick={handleLoadSubmit} style={{ color: '#FFFFFF' }} className="w-full py-4 bg-[#0C0E0D] font-bold rounded-xl hover:bg-[#152e52] shadow-lg transition-transform active:scale-95">
                                  Notificar Transferencia
                              </button>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {isSendModalOpen && (
          <div className="fixed inset-0 z-50 p-4" style={{ background: 'rgba(4,5,4,0.72)', display: 'grid', placeItems: 'center' }}>
              <div className="w-full animate-in zoom-in-95 duration-300 flex flex-col" role="dialog" aria-modal="true"
                  style={{ maxWidth: 476, background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, overflow: 'hidden', maxHeight: '92vh', fontFamily: "'Archivo', system-ui, sans-serif" }}>
                  {/* Cabecera + progreso (diseño Flujo Enviar: 4 pasos) */}
                  <div style={{ padding: '18px 22px 14px' }}>
                      <div className="flex items-start justify-between gap-3">
                          <div>
                              <h3 style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.3px', color: '#F4F4F2' }}>
                                  {sendStep === 1 && 'Enviar dinero'}
                                  {sendStep === 2 && '¿Cómo lo enviamos?'}
                                  {sendStep === 3 && (sendMode === 'bank' ? '¿A quién le envías?' : sendMode === 'wallet' ? 'Enviar a wallet' : sendMode === 'pay' ? 'Pago Lincoin' : 'Datos del receptor')}
                                  {sendStep === 4 && (sendMode === 'pay' ? '¡Pago enviado!' : 'Confirma el envío')}
                                  {sendStep === 5 && (sendMode === 'cash' ? '¡Retiro solicitado!' : '¡Envío exitoso!')}
                              </h3>
                              <p style={{ fontSize: 12.5, color: '#878E88', marginTop: 3 }}>
                                  {sendStep === 1 && (sendForm.destinationCurrency === 'USD' ? 'Desde tu billetera USDT' : 'Desde tu cuenta en pesos colombianos')}
                                  {sendStep === 2 && <>Enviando <span style={{ color: '#F4F4F2', fontWeight: 700 }}>{formatMoney(getRawAmount(sendForm.amount), sendForm.destinationCurrency)} {displayCurrency(sendForm.destinationCurrency)}</span> · <button onClick={() => setSendStep(1)} style={{ textDecoration: 'underline', color: '#F4F4F2' }}>cambiar</button></>}
                                  {sendStep === 3 && sendMode === 'bank' && <>{formatMoney(getRawAmount(sendForm.amount), 'COP')} COP · {sendSourceRail === 'COP_ACH' ? 'ACH' : 'Bre-B'} · solo beneficiarios inscritos</>}
                                  {sendStep === 4 && sendMode !== 'pay' && 'Revisa los datos antes de confirmar'}
                              </p>
                          </div>
                          {sendStep !== 5 && !(sendStep === 4 && sendMode === 'pay') && (
                              <button onClick={closeSendModal} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                                  <X size={13} style={{ color: '#878E88' }} strokeWidth={1.7} />
                              </button>
                          )}
                      </div>
                      {sendStep <= 4 && (
                          <div className="flex" style={{ gap: 5, marginTop: 14 }}>
                              {[1, 2, 3, 4].map(s => (
                                  <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: sendStep >= s ? '#4ADE80' : 'rgba(255,255,255,0.1)' }} />
                              ))}
                          </div>
                      )}
                  </div>
                  <div style={{ padding: '6px 22px 22px', overflowY: 'auto' }}>

                      {/* STEP 1: DESDE (cuenta + rieles con saldo) + monto */}
                      {sendStep === 1 && (() => {
                          const isUsdt = sendForm.destinationCurrency === 'USD';
                          const avail = isUsdt ? displayBalance('USD') : getBalance(sendSourceRail);
                          const quicks = isUsdt ? [5, 20, 50] : [10000, 50000, 200000];
                          const setAmt = (n: number) => setSendForm({ ...sendForm, amount: formatInputNumber(String(Math.floor(n))) });
                          return (
                          <div className="space-y-4">
                              {/* DESDE */}
                              <div>
                                  <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: '#878E88' }}>DESDE</label>
                                  <div style={{ marginTop: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.025)', borderRadius: 13, padding: '13px 15px' }}>
                                      <div className="flex items-center justify-between gap-2 flex-wrap">
                                          <div className="flex items-center gap-2.5">
                                              <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'block', background: isUsdt ? '#26A17B' : 'linear-gradient(180deg,#FCD116 0 50%,#003893 50% 75%,#CE1126 75%)', color: '#fff', fontWeight: 800, fontSize: 11, textAlign: 'center', lineHeight: '26px' }}>{isUsdt ? '₮' : ''}</span>
                                              <div>
                                                  <p style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>{isUsdt ? 'Dólar digital' : 'Peso colombiano'}</p>
                                                  <p style={{ fontSize: 11, color: '#878E88' }}>{isUsdt ? 'USDT · disponible' : `${sendSourceRail === 'COP' ? 'Saldo Lincoin' : sendSourceRail === 'COP_BREB' ? 'Bre-B' : 'ACH'} · disponible`}</p>
                                              </div>
                                          </div>
                                          <p style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.6px', color: '#F4F4F2' }}>{isUsdt ? Number(avail).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(avail).toLocaleString('es-CO')}</p>
                                      </div>
                                      {/* Chips de riel / cambio de cuenta */}
                                      <div className="flex flex-wrap" style={{ gap: 6, marginTop: 12 }}>
                                          {([
                                              { key: 'COP', label: 'Saldo Lincoin' },
                                              { key: 'COP_BREB', label: 'Bre-B' },
                                              { key: 'COP_ACH', label: 'ACH' },
                                          ] as const).map(r => {
                                              const sel = !isUsdt && sendSourceRail === r.key;
                                              return (
                                                  <button key={r.key} type="button"
                                                      onClick={() => { setSendForm(f => ({ ...f, destinationCountry: 'Colombia', destinationCurrency: 'COP' })); setSendSourceRail(r.key); }}
                                                      style={{ borderRadius: 999, padding: '6px 12px', fontSize: 11.5, fontWeight: sel ? 700 : 500, border: sel ? '1px solid rgba(74,222,128,0.35)' : '1px solid rgba(255,255,255,0.1)', background: sel ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.03)', color: sel ? '#F4F4F2' : '#878E88' }}>
                                                      {r.label} · {Math.round(getBalance(r.key)).toLocaleString('es-CO')}
                                                  </button>
                                              );
                                          })}
                                          <button type="button"
                                              onClick={() => { setSendForm(f => ({ ...f, destinationCountry: 'Estados Unidos', destinationCurrency: 'USD' })); }}
                                              style={{ borderRadius: 999, padding: '6px 12px', fontSize: 11.5, fontWeight: isUsdt ? 700 : 500, border: isUsdt ? '1px solid rgba(74,222,128,0.35)' : '1px solid rgba(255,255,255,0.1)', background: isUsdt ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.03)', color: isUsdt ? '#F4F4F2' : '#878E88' }}>
                                              ₮ USDT · {Number(displayBalance('USD')).toLocaleString('es-CO', { maximumFractionDigits: 2 })}
                                          </button>
                                      </div>
                                  </div>
                              </div>
                              {/* MONTO */}
                              <div>
                                  <div className="flex items-center justify-between">
                                      <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: '#878E88' }}>MONTO A ENVIAR</label>
                                      {!isUsdt && <span style={{ fontSize: 11.5, color: '#878E88' }}>Mínimo <span style={{ color: '#F4F4F2', fontWeight: 700 }}>5 000</span></span>}
                                  </div>
                                  <div className="relative" style={{ marginTop: 6 }}>
                                      <input type="text" value={sendForm.amount} onChange={(e) => setSendForm({ ...sendForm, amount: formatInputNumber(e.target.value) })} placeholder="0" autoFocus
                                          style={{ width: '100%', height: 62, padding: '0 74px 0 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 13, color: '#F4F4F2', fontSize: 28, fontWeight: 800, letterSpacing: '-1px', outline: 'none', fontFamily: 'inherit' }} />
                                      <span className="absolute right-4 top-1/2 -translate-y-1/2" style={{ color: '#878E88', fontWeight: 700, fontSize: 15 }}>{isUsdt ? 'USDT' : 'COP'}</span>
                                  </div>
                                  <div className="flex flex-wrap" style={{ gap: 6, marginTop: 10 }}>
                                      {quicks.map(n => (
                                          <button key={n} type="button" onClick={() => setAmt(n)}
                                              style={{ borderRadius: 7, padding: '6px 12px', fontSize: 11.5, fontWeight: 600, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#878E88' }} className="hover:bg-white/[0.09] transition-colors">
                                              {n.toLocaleString('es-CO')}
                                          </button>
                                      ))}
                                      <button type="button" onClick={() => setAmt(avail)}
                                          style={{ borderRadius: 7, padding: '6px 12px', fontSize: 11.5, fontWeight: 600, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#878E88' }} className="hover:bg-white/[0.09] transition-colors">
                                          Todo
                                      </button>
                                  </div>
                              </div>
                              <div className="flex items-center" style={{ gap: 8 }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ADE80', flexShrink: 0 }} />
                                  <span style={{ fontSize: 12, color: '#878E88' }}>{isUsdt ? 'Comisión de red GasFree cotizada antes de confirmar.' : 'Sin comisión entre usuarios de Lincoin.'}</span>
                              </div>
                              <div className="flex" style={{ gap: 9, paddingTop: 4 }}>
                                  <button onClick={closeSendModal} style={{ flex: 1, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)', color: '#F4F4F2', fontWeight: 600, fontSize: 14, padding: '13px 0', borderRadius: 10 }} className="hover:bg-white/[0.09] transition-colors">Cancelar</button>
                                  <button onClick={handleSendNext} className="lincoin-btn-white transition-colors" style={{ flex: 1.5, fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 10, border: 'none' }}>Continuar</button>
                              </div>
                          </div>
                          );
                      })()}

                      {/* STEP 2: Método — lista de radio (diseño Flujo Enviar) */}
                      {sendStep === 2 && (
                          <div className="space-y-4">
                              <div className="space-y-2">
                                  {([
                                      { key: 'breb', title: 'Bre-B a cuenta bancaria', pill: 'SEGUNDOS', desc: 'A cualquier banco de Colombia por llave' },
                                      { key: 'ach', title: 'ACH tradicional', pill: null, desc: 'L–V 7:00–18:00 · llega el mismo día' },
                                      { key: 'pay', title: 'A otro usuario de Lincoin', pill: 'SIN COMISIÓN', desc: 'Por ID o correo · instantáneo, 24/7' },
                                      { key: 'cash', title: 'Retiro en punto físico', pill: null, desc: 'Efectivo en corresponsales aliados · código de retiro' },
                                  ] as const).map(m => {
                                      const sel = sendMethodSel === m.key;
                                      return (
                                          <button key={m.key} type="button" onClick={() => setSendMethodSel(m.key)}
                                              className="w-full flex items-center gap-3 text-left transition-colors"
                                              style={{ padding: '13px 15px', borderRadius: 12, border: sel ? '1px solid rgba(74,222,128,0.35)' : '1px solid rgba(255,255,255,0.1)', background: sel ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.025)' }}>
                                              <span className="flex-1 min-w-0">
                                                  <span className="flex items-center gap-2">
                                                      <span style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>{m.title}</span>
                                                      {m.pill && <span style={{ border: '1px solid rgba(74,222,128,0.3)', color: '#4ADE80', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.6px', padding: '2px 6px', borderRadius: 999, whiteSpace: 'nowrap' }}>{m.pill}</span>}
                                                  </span>
                                                  <span style={{ display: 'block', fontSize: 11.5, color: '#878E88', marginTop: 2 }}>{m.desc}</span>
                                              </span>
                                              <span style={{ width: 17, height: 17, borderRadius: '50%', flexShrink: 0, border: sel ? '5px solid #4ADE80' : '1.5px solid rgba(255,255,255,0.25)' }} />
                                          </button>
                                      );
                                  })}
                              </div>
                              {/* Mover entre cuentas — fila secundaria, no es un envío */}
                              <button
                                  onClick={() => { setIsSendModalOpen(false); setSendStep(1); setSelectedWalletCode('COP'); setBrebMoveOpen(true); setActiveView('wallet-detail'); }}
                                  className="w-full flex items-center justify-between transition-colors hover:bg-white/[0.04]"
                                  style={{ padding: '11px 15px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent' }}>
                                  <span style={{ fontSize: 12.5, color: '#878E88' }}>¿Solo quieres mover saldo entre tus rieles?</span>
                                  <span style={{ fontSize: 12.5, fontWeight: 600, color: '#F4F4F2' }}>Mover entre mis cuentas →</span>
                              </button>
                              <div className="flex" style={{ gap: 9 }}>
                                  <button onClick={() => setSendStep(1)} style={{ flex: 1, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)', color: '#F4F4F2', fontWeight: 600, fontSize: 14, padding: '13px 0', borderRadius: 10 }} className="hover:bg-white/[0.09] transition-colors">Atrás</button>
                                  <button
                                      onClick={() => {
                                          if (!sendMethodSel) return;
                                          if (sendMethodSel === 'breb' || sendMethodSel === 'ach') {
                                              setSendMode('bank');
                                              setSendSourceRail(sendMethodSel === 'breb' ? 'COP_BREB' : 'COP_ACH');
                                          } else {
                                              setSendMode(sendMethodSel);
                                          }
                                          setSendStep(3);
                                      }}
                                      disabled={!sendMethodSel}
                                      className="lincoin-btn-white transition-colors"
                                      style={{ flex: 1.5, fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 10, border: 'none', opacity: sendMethodSel ? 1 : 0.45, cursor: sendMethodSel ? 'pointer' : 'not-allowed' }}>
                                      Continuar
                                  </button>
                              </div>
                          </div>
                      )}

                      {/* STEP 3 BANK: beneficiarios inscritos como tarjetas (diseño) */}
                      {sendStep === 3 && sendMode === 'bank' && (() => {
                          const all: any[] = ((currentUser as any)?.raw_data?.mouvContacts) ?? ((currentUser as any)?.mouvContacts) ?? [];
                          const railKind = sendSourceRail === 'COP_ACH' ? 'ach' : 'breb';
                          // Solo Colombia y del riel elegido en el paso 2.
                          const myContacts = all.filter((c: any) => c.accountKind !== 'wallet' && (c.country ?? 'Colombia') === 'Colombia' && ((c.destKind ?? 'ach') === railKind));
                          const q = contactSearch.trim().toLowerCase();
                          const list = myContacts.filter((c: any) => !q || `${c.name} ${c.bank} ${c.docNumber} ${c.accountNumber} ${c.brebKey ?? ''}`.toLowerCase().includes(q));
                          const goContacts = () => { setIsSendModalOpen(false); setActiveView('contactos'); };
                          const maskAcc = (a: string) => (a?.length > 4 ? `···${a.slice(-4)}` : a);
                          const initials = (n: string) => { const p = String(n || '').trim().split(/\s+/); return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '·'; };
                          const pickContact = (c: any) => {
                              setSendForm({
                                  ...sendForm,
                                  beneficiaryName: c.name,
                                  documentType: c.docType ?? sendForm.documentType,
                                  documentNumber: c.docNumber,
                                  bankName: c.bank,
                                  accountNumber: c.accountNumber,
                                  accountType: c.accountType ?? sendForm.accountType,
                                  beneficiaryType: c.kind === 'empresa' ? 'business' : 'personal',
                              });
                              setSendContact(c);
                              setSendSourceRail((c as any).destKind === 'breb' ? 'COP_BREB' : 'COP_ACH');
                              setMouvDestId(null);
                          };
                          return (
                              <div className="space-y-3">
                                  {myContacts.length > 3 && (
                                      <div className="relative">
                                          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#878E88' }} />
                                          <input value={contactSearch} onChange={e => setContactSearch(e.target.value)} placeholder="Buscar beneficiario…"
                                              style={{ width: '100%', height: 40, paddingLeft: 36, paddingRight: 12, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 9, color: '#F4F4F2', fontSize: 13, outline: 'none' }} />
                                      </div>
                                  )}
                                  <div className="space-y-2" style={{ maxHeight: 300, overflowY: 'auto' }}>
                                      {list.map((c: any) => {
                                          const st = contactStatus(c);
                                          const selectable = st === 'aprobada';
                                          const sel = sendContact?.id === c.id;
                                          const railLine = c.destKind === 'breb'
                                              ? `Bre-B · ${maskAcc(c.brebKey ?? c.accountNumber)}`
                                              : `${c.accountType === 'savings' ? 'Ahorros' : 'Corriente'} ${maskAcc(c.accountNumber)}`;
                                          return (
                                              <button key={c.id} disabled={!selectable} onClick={() => selectable && pickContact(c)}
                                                  className="w-full flex items-center gap-3 text-left transition-colors"
                                                  style={{ padding: '12px 14px', borderRadius: 12, opacity: selectable ? 1 : 0.5, cursor: selectable ? 'pointer' : 'not-allowed',
                                                      border: sel ? '1px solid rgba(74,222,128,0.35)' : '1px solid rgba(255,255,255,0.1)',
                                                      background: sel ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.025)' }}>
                                                  <span style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(140deg, #2E3330, #1A1D1B)', border: '1px solid rgba(255,255,255,0.12)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                                                      <span style={{ color: '#878E88', fontWeight: 800, fontSize: 12 }}>{initials(c.name)}</span>
                                                  </span>
                                                  <span className="flex-1 min-w-0">
                                                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#F4F4F2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                                                      <span style={{ display: 'block', fontSize: 11.5, color: '#878E88', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{railLine}{c.bank && !String(c.bank).startsWith('Bre-B') ? ` · ${c.bank}` : ''}</span>
                                                  </span>
                                                  {selectable
                                                      ? <span style={{ border: '1px solid rgba(74,222,128,0.3)', color: '#4ADE80', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }}>VERIFICADA</span>
                                                      : <span style={{ border: '1px solid rgba(255,255,255,0.14)', color: '#878E88', fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }}>{st === 'rechazada' ? 'RECHAZADA' : 'EN VALIDACIÓN'}</span>}
                                              </button>
                                          );
                                      })}
                                      {list.length === 0 && (
                                          <p className="text-center py-4" style={{ fontSize: 12.5, color: '#878E88' }}>
                                              {myContacts.length === 0 ? `Aún no tienes beneficiarios ${railKind === 'breb' ? 'Bre-B' : 'ACH'} inscritos.` : `Sin resultados para "${contactSearch}"`}
                                          </p>
                                      )}
                                      {/* Inscribir nuevo — tarjeta punteada */}
                                      <button onClick={goContacts} className="w-full text-left transition-colors hover:bg-white/[0.03]"
                                          style={{ padding: '12px 14px', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.2)', background: 'transparent' }}>
                                          <span style={{ fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}>+ Inscribir nuevo beneficiario</span>
                                          <span style={{ display: 'block', fontSize: 11.5, color: '#878E88', marginTop: 2 }}>Se valida con el banco antes del primer envío</span>
                                      </button>
                                  </div>
                                  <div className="flex" style={{ gap: 9, paddingTop: 4 }}>
                                      <button onClick={() => setSendStep(2)} style={{ flex: 1, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)', color: '#F4F4F2', fontWeight: 600, fontSize: 14, padding: '13px 0', borderRadius: 10 }} className="hover:bg-white/[0.09] transition-colors">Atrás</button>
                                      <button onClick={() => sendContact && setSendStep(4)} disabled={!sendContact}
                                          className="lincoin-btn-white transition-colors"
                                          style={{ flex: 1.5, fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 10, border: 'none', opacity: sendContact ? 1 : 0.45, cursor: sendContact ? 'pointer' : 'not-allowed' }}>
                                          Continuar
                                      </button>
                                  </div>
                              </div>
                          );
                      })()}

                      {/* STEP 3 WALLET: wallets inscritas (solo USD) */}
                      {sendStep === 3 && sendMode === 'wallet' && (() => {
                          // Wallets: lista propia (walletContacts) + compat con las que
                          // quedaron dentro de mouvContacts. Anidado o aplanado.
                          const cuW: any = currentUser as any;
                          const readW = (k: string): any[] => Array.isArray(cuW?.raw_data?.[k]) ? cuW.raw_data[k] : Array.isArray(cuW?.[k]) ? cuW[k] : [];
                          const myWalletsList = [
                              ...readW('walletContacts'),
                              ...readW('mouvContacts').filter((c: any) => c.accountKind === 'wallet'),
                          ];
                          const q = contactSearch.trim().toLowerCase();
                          const list = myWalletsList.filter((c: any) =>
                              !q || `${c.name} ${c.walletCoin} ${c.walletNetwork} ${c.accountNumber}`.toLowerCase().includes(q));
                          const goContacts = () => { setIsSendModalOpen(false); setActiveView('contactos'); };
                          const maskAddr = (a: string) => (a?.length > 10 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a);
                          return (
                              <div className="space-y-4">
                                  <button onClick={() => setSendStep(2)} className="text-xs text-slate-400 flex items-center gap-1 hover:text-slate-600 mb-2 font-bold"><ArrowLeft size={12}/> Volver</button>
                                  <p className="text-sm text-slate-600">
                                      Los envíos en USD a wallet van <b>solo a wallets inscritas</b> en Contactos. Elige el destinatario:
                                  </p>
                                  {myWalletsList.length === 0 ? (
                                      <div className="text-center py-8 space-y-3">
                                          <p className="text-sm text-slate-400">Aún no tienes wallets inscritas.</p>
                                          <button onClick={goContacts} style={{ color: '#0C0E0D' }} className="py-2.5 px-5 rounded-xl bg-[#4ADE80] hover:bg-[#6EE7A0] text-sm font-bold">
                                              + Inscribir mi primera wallet
                                          </button>
                                      </div>
                                  ) : (
                                      <>
                                      <div className="relative">
                                          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                          <input
                                              value={contactSearch}
                                              onChange={e => setContactSearch(e.target.value)}
                                              placeholder="Buscar por nombre, red o dirección…"
                                              className="w-full h-11 pl-9 pr-3 border border-slate-300 rounded-lg focus:border-[#0C0E0D] outline-none text-sm"
                                          />
                                      </div>
                                      <div className="space-y-2 max-h-72 overflow-y-auto">
                                          {list.length === 0 && <p className="text-center text-sm text-slate-400 py-4">Sin resultados para "{contactSearch}"</p>}
                                          {list.map((c: any) => (
                                              <button
                                                  key={c.id}
                                                  onClick={() => {
                                                      setSendForm({
                                                          ...sendForm,
                                                          beneficiaryName: c.name,
                                                          documentNumber: '—',
                                                          bankName: `Wallet ${c.walletCoin ?? 'USDT'} ${c.walletNetwork ?? 'TRC-20'}`,
                                                          accountNumber: c.accountNumber,
                                                          beneficiaryType: 'personal',
                                                      });
                                                      setMouvDestId(null);
                                                      setSendStep(4);
                                                  }}
                                                  className="w-full flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 hover:border-[#0C0E0D] hover:bg-slate-50 transition-all text-left"
                                              >
                                                  <div className="min-w-0 flex items-center gap-3">
                                                      <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center shrink-0"><Wallet size={16} className="text-[#16A34A]" /></div>
                                                      <div className="min-w-0">
                                                          <p className="font-bold text-slate-800 text-sm truncate">{c.name}</p>
                                                          <p className="text-xs text-slate-500 truncate font-mono">{c.walletCoin ?? 'USDT'} · {c.walletNetwork ?? 'TRC-20'} · {maskAddr(c.accountNumber)}</p>
                                                      </div>
                                                  </div>
                                                  <span className="shrink-0 text-[9px] font-bold uppercase bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">Wallet</span>
                                              </button>
                                          ))}
                                      </div>
                                      <button onClick={goContacts} className="w-full text-xs font-bold text-[#16A34A] hover:underline py-1">
                                          + Inscribir nueva wallet
                                      </button>
                                      </>
                                  )}
                              </div>
                          );
                      })()}

                      {/* STEP 3 PAY: Lincoin ID lookup */}
                      {sendStep === 3 && sendMode === 'pay' && (
                          <div className="space-y-5">
                              <button onClick={() => { setSendStep(2); setPayRecipientCode(''); setPayRecipientUser(null); setPayLookupStatus('idle'); }} className="text-xs text-slate-400 flex items-center gap-1 hover:text-slate-600 font-bold"><ArrowLeft size={12}/> Volver</button>
                              <div className="bg-green-50 border border-green-100 p-4 rounded-xl text-center">
                                  <p className="text-xs text-green-500 font-bold uppercase mb-0.5">Enviando</p>
                                  <p className="text-2xl font-extrabold text-green-700">{formatMoney(getRawAmount(sendForm.amount), sendForm.destinationCurrency)} <span className="text-lg">{sendForm.destinationCurrency}</span></p>
                              </div>
                              <div>
                                  <label className="block text-sm font-bold text-slate-700 mb-2">ID Lincoin del destinatario</label>
                                  <input
                                      type="text"
                                      value={payRecipientCode}
                                      onChange={(e) => handlePayLookup(e.target.value)}
                                      placeholder="Ej: ABC123"
                                      maxLength={8}
                                      autoFocus
                                      className="w-full h-14 px-4 border-2 border-slate-300 rounded-xl focus:border-green-500 focus:ring-1 focus:ring-green-400 outline-none text-xl font-mono font-bold tracking-widest text-center uppercase"
                                  />
                                  <p className="text-xs text-slate-400 mt-1 text-center">El ID de 6 caracteres que el destinatario puede compartir contigo</p>
                              </div>
                              {payLookupStatus === 'found' && payRecipientUser && (
                                  <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3 animate-in slide-in-from-bottom-2 duration-200">
                                      <div className="w-12 h-12 bg-green-600 rounded-full flex items-center justify-center text-white font-extrabold text-xl flex-shrink-0">
                                          {payRecipientUser.name?.charAt(0).toUpperCase()}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                          <p className="text-[10px] text-green-600 font-bold uppercase tracking-wide">Destinatario encontrado</p>
                                          <p className="font-bold text-slate-800 truncate">{payRecipientUser.name}</p>
                                      </div>
                                      <CheckCircle size={22} className="text-green-500 flex-shrink-0" />
                                  </div>
                              )}
                              {payLookupStatus === 'not_found' && (
                                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center animate-in slide-in-from-bottom-2 duration-200">
                                      <p className="text-sm text-red-600 font-bold">ID no encontrado. Verifica el código.</p>
                                  </div>
                              )}
                              <button
                                  onClick={handlePaySubmit}
                                  disabled={payLookupStatus !== 'found' || isPaySending}
                                  className="w-full h-14 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 flex items-center justify-center gap-2 text-lg shadow-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                              >
                                  {isPaySending ? <Loader2 className="animate-spin" size={22}/> : <><Zap size={20}/> Enviar ahora</>}
                              </button>
                          </div>
                      )}

                      {/* STEP 4 BANK: Confirmar (diseño Flujo Enviar) */}
                      {sendStep === 4 && sendMode === 'bank' && (() => {
                          const amt = getRawAmount(sendForm.amount);
                          const isBrebM = (sendContact?.destKind ?? (sendSourceRail === 'COP_BREB' ? 'breb' : 'ach')) === 'breb';
                          const railLbl = isBrebM ? 'Bre-B' : 'ACH';
                          const initials = (n: string) => { const p = String(n || '').trim().split(/\s+/); return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '·'; };
                          const destLine = isBrebM
                              ? `Bre-B · ${sendContact?.brebKey ? `···${String(sendContact.brebKey).slice(-4)}` : ''}${sendForm.bankName && !String(sendForm.bankName).startsWith('Bre-B') ? ` · ${sendForm.bankName}` : ''}`
                              : `${sendForm.bankName} · ${sendForm.accountType === 'checking' ? 'Corriente' : 'Ahorros'} ···${String(sendForm.accountNumber || '').slice(-4)}`;
                          return (
                          <div className="space-y-4">
                              {/* Destinatario + Editar */}
                              <div className="flex items-center gap-3" style={{ padding: '13px 15px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.025)' }}>
                                  <span style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(140deg, #2E3330, #1A1D1B)', border: '1px solid rgba(255,255,255,0.12)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                                      <span style={{ color: '#878E88', fontWeight: 800, fontSize: 13 }}>{initials(sendForm.beneficiaryName)}</span>
                                  </span>
                                  <div className="flex-1 min-w-0">
                                      <p style={{ fontSize: 14, fontWeight: 700, color: '#F4F4F2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sendForm.beneficiaryName}</p>
                                      <p style={{ fontSize: 11.5, color: '#878E88', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{destLine}</p>
                                  </div>
                                  <button onClick={() => setSendStep(3)} style={{ fontSize: 12.5, fontWeight: 600, color: '#F4F4F2', textDecoration: 'underline', flexShrink: 0 }}>Editar</button>
                              </div>
                              {/* RECIBE */}
                              <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 13, padding: '15px 16px', background: 'rgba(255,255,255,0.025)' }}>
                                  <span style={{ color: '#878E88', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px' }}>RECIBE</span>
                                  <p style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-1.2px', color: '#F4F4F2', marginTop: 4 }}>{formatMoney(amt, 'COP')} <span style={{ fontSize: 15, color: '#878E88', fontWeight: 700 }}>COP</span></p>
                              </div>
                              {/* Desglose */}
                              <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 13, overflow: 'hidden' }}>
                                  {[
                                      { l: 'Sale de', v: `${sendSourceRail === 'COP' ? 'Saldo Lincoin' : sendSourceRail === 'COP_BREB' ? 'Bre-B' : 'ACH'} · COP` },
                                      { l: `Comisión ${railLbl}`, v: 'Sin comisión' },
                                      { l: 'Llega', v: isBrebM ? 'En segundos' : 'El mismo día hábil' },
                                  ].map((row, i) => (
                                      <div key={row.l} className="flex items-center justify-between" style={{ padding: '11px 16px', fontSize: 13, borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
                                          <span style={{ color: '#878E88' }}>{row.l}</span>
                                          <span style={{ color: '#F4F4F2', fontWeight: 700 }}>{row.v}</span>
                                      </div>
                                  ))}
                                  <div className="flex items-center justify-between" style={{ padding: '11px 16px', fontSize: 13, borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
                                      <span style={{ color: '#878E88' }}>Total que sale</span>
                                      <span style={{ color: '#4ADE80', fontWeight: 700 }}>{formatMoney(amt, 'COP')} COP</span>
                                  </div>
                              </div>
                              {/* Aviso antes de confirmar */}
                              <div className="flex items-start" style={{ gap: 11, border: '1px solid rgba(255,255,255,0.1)', borderLeft: '2px solid #4ADE80', background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '12px 15px' }}>
                                  <Clock size={16} style={{ color: '#878E88', flexShrink: 0, marginTop: 1 }} strokeWidth={1.5} />
                                  <span style={{ fontSize: 12, color: '#878E88', lineHeight: 1.5 }}>Al confirmar no se puede reversar. Puede tardar <span style={{ color: '#F4F4F2', fontWeight: 700 }}>hasta 1 minuto</span>; te avisamos aquí y por correo.</span>
                              </div>
                              {mouvUnknown ? (
                                  <div style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12, padding: 16 }} className="space-y-3">
                                      <p style={{ fontSize: 13, fontWeight: 700, color: '#F4F4F2' }}>La conexión se demoró y NO se sabe si el envío se procesó.</p>
                                      <p style={{ fontSize: 12, color: '#878E88' }}>Para evitar transferencias duplicadas, revisa primero tu Historial. Si la orden NO aparece, reintenta.</p>
                                      <button onClick={() => setMouvUnknown(false)} style={{ width: '100%', padding: '12px 0', background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)', color: '#F4F4F2', fontWeight: 700, fontSize: 13.5, borderRadius: 10 }} className="hover:bg-white/[0.09] transition-colors">Ya verifiqué — habilitar reintento</button>
                                  </div>
                              ) : (
                                  <div className="flex" style={{ gap: 9 }}>
                                      <button onClick={() => setSendStep(3)} disabled={isSending} style={{ flex: 1, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)', color: '#F4F4F2', fontWeight: 600, fontSize: 14, padding: '13px 0', borderRadius: 10, opacity: isSending ? 0.5 : 1 }} className="hover:bg-white/[0.09] transition-colors">Corregir</button>
                                      <button onClick={handleSendSubmit} disabled={isSending} className="lincoin-btn-white transition-colors flex items-center justify-center gap-2" style={{ flex: 1.5, fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 10, border: 'none', opacity: isSending ? 0.45 : 1 }}>
                                          {isSending ? <><Loader2 className="animate-spin" size={16} /> Procesando…</> : 'Confirmar envío'}
                                      </button>
                                  </div>
                              )}
                              {isSending && <p className="text-center" style={{ fontSize: 11.5, color: '#878E88' }}>Procesando la transferencia — puede tardar hasta 1 minuto. <b style={{ color: '#F4F4F2' }}>No pulses de nuevo ni cierres esta ventana.</b></p>}
                              <div className="flex items-center justify-center" style={{ gap: 8 }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ADE80' }} />
                                  <span style={{ fontSize: 12, color: '#878E88' }}>Operación protegida · confirmación en dos pasos</span>
                              </div>
                          </div>
                          );
                      })()}

                      {/* STEP 4 WALLET: Confirm (flujo GasFree existente) */}
                      {sendStep === 4 && sendMode === 'wallet' && (
                          <div className="space-y-6">
                              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col items-center">
                                  <span className="text-xs font-bold text-[#4ADE80] uppercase tracking-widest mb-1">MONTO TOTAL</span>
                                  <span className="text-3xl font-extrabold text-[#0C0E0D]">{formatMoney(getRawAmount(sendForm.amount), sendForm.destinationCurrency)}</span>
                              </div>
                              <div className="bg-slate-50 rounded-xl p-4 space-y-3 text-sm border border-slate-200">
                                  <div className="flex justify-between"><span className="text-slate-500">Destinatario:</span><span className="font-bold text-slate-800">{sendForm.beneficiaryName}</span></div>
                                  <div className="flex justify-between"><span className="text-slate-500">Red:</span><span className="font-bold text-slate-800">{sendForm.bankName}</span></div>
                                  <div className="flex justify-between gap-3"><span className="text-slate-500">Dirección:</span><span className="font-bold text-slate-800 font-mono text-xs break-all text-right">{sendForm.accountNumber}</span></div>
                                  {sendMode === 'wallet' && (
                                      <div className="pt-2 border-t border-slate-200 space-y-1.5">
                                          {gasfreeFeePreview.loading ? (
                                              <div className="flex justify-between items-center">
                                                  <span className="text-slate-500">Comisión GasFree (vigente hoy):</span>
                                                  <span className="text-slate-400 text-xs flex items-center gap-1"><Loader2 size={12} className="animate-spin"/> cotizando…</span>
                                              </div>
                                          ) : gasfreeFeePreview.feeUsdt != null ? (
                                              <>
                                                  {!!gasfreeFeePreview.activateFeeUsdt && (
                                                      <div className="flex justify-between items-center">
                                                          <span className="text-slate-500">Activación de tu wallet (solo 1ª vez):</span>
                                                          <span className="font-bold text-slate-700">{gasfreeFeePreview.activateFeeUsdt.toFixed(2)} USDT</span>
                                                      </div>
                                                  )}
                                                  <div className="flex justify-between items-center">
                                                      <span className="text-slate-500">Comisión de envío:</span>
                                                      <span className="font-bold text-slate-700">{(gasfreeFeePreview.transferFeeUsdt ?? gasfreeFeePreview.feeUsdt).toFixed(2)} USDT</span>
                                                  </div>
                                                  <div className="flex justify-between items-center">
                                                      <span className="text-slate-500 font-bold">Total comisión GasFree:</span>
                                                      <span className="font-bold text-amber-600">{gasfreeFeePreview.feeUsdt.toFixed(2)} USDT</span>
                                                  </div>
                                              </>
                                          ) : (
                                              <div className="flex justify-between items-center">
                                                  <span className="text-slate-500">Comisión GasFree (vigente hoy):</span>
                                                  <span className="text-red-500 text-xs">{gasfreeFeePreview.error ?? '—'}</span>
                                              </div>
                                          )}
                                      </div>
                                  )}
                              </div>
                              {sendMode === 'wallet' && gasfreeFeePreview.feeUsdt != null && (
                                  <p className="text-[10px] text-slate-400 -mt-3 text-center">
                                      Total a debitar: {formatMoney(getRawAmount(sendForm.amount) + gasfreeFeePreview.feeUsdt, 'USD')} USD (monto + comisión de red de GasFree)
                                  </p>
                              )}
                              {mouvUnknown ? (
                                  <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-4 space-y-3">
                                      <p className="text-sm font-bold text-amber-800">⚠️ La conexión se demoró y NO se sabe si el envío se procesó.</p>
                                      <p className="text-xs text-amber-700">{sendMode === 'wallet'
                                          ? 'Para evitar envíos duplicados, revisa primero tu Historial en Lincoin (o la wallet destino en Tronscan). Si el envío NO aparece, reintenta.'
                                          : 'Para evitar transferencias duplicadas, revisa primero tu Historial en Lincoin. Si la orden NO aparece, reintenta.'}</p>
                                      <button
                                          onClick={() => setMouvUnknown(false)}
                                          style={{ color: '#FFFFFF' }}
                                          className="w-full py-3 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 transition-colors"
                                      >Ya verifiqué — habilitar reintento</button>
                                  </div>
                              ) : (
                                  <div className="flex gap-3">
                                      <button onClick={() => setSendStep(3)} disabled={isSending} className="flex-1 py-3 border border-slate-300 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">Corregir</button>
                                      <button onClick={handleSendSubmit} disabled={isSending} style={{ color: '#FFFFFF' }} className="flex-1 py-3 bg-[#0C0E0D] font-bold rounded-xl hover:bg-[#152e52] shadow-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">{isSending ? <><Loader2 className="animate-spin" size={18} /> Procesando… no cierres</> : <><Send size={18}/> Confirmar</>}</button>
                                  </div>
                              )}
                              {isSending && sendForm.destinationCurrency === 'COP' && (
                                  <p className="text-center text-[11px] text-slate-500 -mt-2">Procesando la transferencia — puede tardar hasta 1 minuto. <b>No pulses de nuevo ni cierres esta ventana.</b></p>
                              )}
                              {isSending && sendMode === 'wallet' && (
                                  <p className="text-center text-[11px] text-slate-500 -mt-2">Enviando USDT por la red — puede tardar 1-2 minutos. <b>No pulses de nuevo ni cierres esta ventana.</b></p>
                              )}
                          </div>
                      )}

                      {/* STEP 4 PAY: Success */}
                      {sendStep === 4 && sendMode === 'pay' && (
                          <div className="flex flex-col items-center text-center py-8 animate-in zoom-in duration-300">
                              <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6">
                                  <Zap size={44} className="text-green-600" />
                              </div>
                              <h2 className="text-2xl font-bold text-green-700 mb-3">¡Pago Enviado!</h2>
                              <p className="text-slate-500 text-sm mb-1">Enviaste <span className="font-bold text-slate-700">{formatMoney(getRawAmount(sendForm.amount), sendForm.destinationCurrency)} {sendForm.destinationCurrency}</span></p>
                              <p className="text-slate-500 text-sm mb-8">a <span className="font-bold text-slate-700">{payRecipientUser?.name}</span></p>
                              <button onClick={closeSendModal} style={{ color: '#FFFFFF' }} className="w-full bg-green-600 text-white font-bold py-3 rounded-xl hover:bg-green-700 transition-colors">Finalizar</button>
                          </div>
                      )}

                      {/* STEP 3 CASH: Recipient form */}
                      {sendStep === 3 && sendMode === 'cash' && (
                          <div className="space-y-4">
                              <button onClick={() => setSendStep(2)} className="text-xs text-slate-400 flex items-center gap-1 hover:text-slate-600 mb-2 font-bold"><ArrowLeft size={12}/> Volver</button>
                              <div className="bg-orange-50 border border-orange-100 p-3 rounded-xl text-center">
                                  <p className="text-sm font-bold text-orange-800">Retiro de <span className="text-orange-600">{formatMoney(getRawAmount(sendForm.amount), sendForm.destinationCurrency)}</span> en efectivo</p>
                                  <p className="text-xs text-orange-600 mt-1">Un agente procesará el pago en el punto físico más cercano</p>
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre completo del receptor</label>
                                  <input type="text" value={cashForm.recipientName} onChange={(e) => setCashForm({...cashForm, recipientName: e.target.value})} placeholder="Nombre y apellido" className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-orange-400 outline-none text-sm"/>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                  <div>
                                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo de documento</label>
                                      <select value={cashForm.docType} onChange={(e) => setCashForm({...cashForm, docType: e.target.value})} className="w-full h-11 px-3 border border-slate-300 rounded-lg bg-white text-sm focus:border-orange-400 outline-none">
                                          {['CC','DNI','RUT','Pasaporte','CURP','CI','CPF','RIF','NIT'].map(t => <option key={t} value={t}>{t}</option>)}
                                      </select>
                                  </div>
                                  <div>
                                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Número de documento</label>
                                      <input type="text" value={cashForm.docNumber} onChange={(e) => setCashForm({...cashForm, docNumber: e.target.value})} placeholder="Ej: 12345678" className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-orange-400 outline-none text-sm"/>
                                  </div>
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Teléfono de contacto</label>
                                  <input type="tel" value={cashForm.phone} onChange={(e) => setCashForm({...cashForm, phone: e.target.value})} placeholder="+57 300 000 0000" className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-orange-400 outline-none text-sm"/>
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ciudad de retiro</label>
                                  <input type="text" value={cashForm.city} onChange={(e) => setCashForm({...cashForm, city: e.target.value})} placeholder="Ej: Bogotá, Lima, Santiago..." className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-orange-400 outline-none text-sm"/>
                              </div>
                              <button
                                  onClick={() => {
                                      if (!cashForm.recipientName.trim()) { showToast('Ingresa el nombre del receptor', 3000, 'error'); return; }
                                      if (!cashForm.docNumber.trim()) { showToast('Ingresa el número de documento', 3000, 'error'); return; }
                                      if (!cashForm.city.trim()) { showToast('Ingresa la ciudad de retiro', 3000, 'error'); return; }
                                      setSendStep(4);
                                  }}
                                  className="w-full h-12 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 mt-2 flex items-center justify-center gap-2 shadow-lg transition-colors"
                              >
                                  <MapPin size={16}/> Revisar datos
                              </button>
                          </div>
                      )}

                      {/* STEP 4 CASH: Confirm */}
                      {sendStep === 4 && sendMode === 'cash' && (
                          <div className="space-y-5">
                              <h4 className="text-center text-slate-500 text-sm">Confirma los datos del retiro en efectivo</h4>
                              <div className="bg-orange-50 p-4 rounded-xl border border-orange-200 flex flex-col items-center">
                                  <span className="text-xs font-bold text-orange-400 uppercase tracking-widest mb-1">MONTO A RETIRAR</span>
                                  <span className="text-3xl font-extrabold text-orange-700">{formatMoney(getRawAmount(sendForm.amount), sendForm.destinationCurrency)}</span>
                              </div>
                              <div className="bg-slate-50 rounded-xl p-4 space-y-2.5 text-sm border border-slate-200">
                                  <div className="flex justify-between"><span className="text-slate-500">Receptor:</span><span className="font-bold text-slate-800">{cashForm.recipientName}</span></div>
                                  <div className="flex justify-between"><span className="text-slate-500">Documento:</span><span className="font-bold text-slate-800">{cashForm.docType} {cashForm.docNumber}</span></div>
                                  {cashForm.phone && <div className="flex justify-between"><span className="text-slate-500">Teléfono:</span><span className="font-bold text-slate-800">{cashForm.phone}</span></div>}
                                  <div className="flex justify-between"><span className="text-slate-500">Ciudad:</span><span className="font-bold text-slate-800">{cashForm.city}</span></div>
                              </div>
                              <p className="text-xs text-slate-400 text-center">El receptor deberá presentar su documento de identidad en el punto físico para cobrar.</p>
                              <div className="flex gap-3">
                                  <button onClick={() => setSendStep(3)} className="flex-1 py-3 border border-slate-300 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors">Corregir</button>
                                  <button onClick={handleCashSubmit} className="flex-1 py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 shadow-lg transition-colors flex items-center justify-center gap-2">
                                      {isSending ? <Loader2 size={18} className="animate-spin"/> : <><MapPin size={16}/> Confirmar</>}
                                  </button>
                              </div>
                          </div>
                      )}

                      {/* STEP 5: Success */}
                      {sendStep === 5 && sendMode !== 'cash' && (
                          <div className="flex flex-col items-center text-center py-8 animate-in zoom-in duration-300">
                              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6"><CheckCircle size={40} className="text-green-600" /></div>
                              <h2 className="text-2xl font-bold text-[#0C0E0D] mb-2">¡Envío Exitoso!</h2>
                              <p className="text-slate-500 text-sm mb-6">Tu dinero está en camino a {sendForm.destinationCountry}.</p>
                              <button onClick={closeSendModal} style={{ color: '#FFFFFF' }} className="w-full bg-[#0C0E0D] font-bold py-3 rounded-xl hover:bg-[#152e52] transition-colors">Finalizar</button>
                          </div>
                      )}

                      {/* STEP 5 CASH: Success with reference code */}
                      {sendStep === 5 && sendMode === 'cash' && (
                          <div className="flex flex-col items-center text-center py-8 animate-in zoom-in duration-300">
                              <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mb-6">
                                  <MapPin size={40} className="text-orange-500"/>
                              </div>
                              <h2 className="text-2xl font-bold text-[#0C0E0D] mb-4">¡Retiro Solicitado!</h2>
                              {cashReference && (
                                  <div className="w-full bg-orange-50 border-2 border-orange-200 rounded-2xl p-5 mb-4">
                                      <p className="text-xs text-orange-500 font-bold uppercase tracking-widest mb-2">Código de retiro</p>
                                      <p className="text-3xl font-extrabold text-orange-700 tracking-widest font-mono">{cashReference}</p>
                                      <p className="text-xs text-slate-500 mt-3 leading-relaxed">
                                          Presenta este código junto con el documento <strong>{cashForm.docType} {cashForm.docNumber}</strong> en el punto físico de <strong>{cashForm.city}</strong>.
                                      </p>
                                  </div>
                              )}
                              <p className="text-sm text-slate-500 mb-6">Un agente se comunicará al <strong>{cashForm.phone || 'número registrado'}</strong> para coordinar el punto de entrega.</p>
                              <button onClick={closeSendModal} style={{ color: '#FFFFFF' }} className="w-full bg-[#0C0E0D] font-bold py-3 rounded-xl hover:bg-[#152e52] transition-colors">Finalizar</button>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {/* CONVERT MODAL */}
      {isConvertModalOpen && (() => {
          const cvFee = rawAmount * (appliedCoupon ? (applicableFeePercentage * (100 - appliedCoupon.discount) / 100) : applicableFeePercentage) / 100;
          const cvAvail = displayBalance(sourceCurr);
          const cvOver = rawAmount > cvAvail;
          const cvTotal = amountToConvert * conversionRate;
          const fmtSrc = (n: number) => Number(n || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const srcTicker = sourceCurr === 'USD' ? 'USDT' : sourceCurr;
          const setPct = (p: number) => {
              // "Todo" descuenta la comisión para que el resultado sea exacto.
              const base = p === 100 ? cvAvail : cvAvail * p / 100;
              setConvertAmountStr(formatInputNumber(String(Math.floor(base * 100) / 100)));
          };
          return (
          <div className="fixed inset-0 z-50 p-4" style={{ background: 'rgba(4,5,4,0.74)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center' }} onClick={closeConvertModal}>
              <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" className="w-full animate-in zoom-in-95 duration-300" style={{ maxWidth: 476, background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, overflow: 'hidden', fontFamily: "'Archivo', system-ui, sans-serif" }}>

                  {/* Cabecera */}
                  <div className="flex items-start justify-between" style={{ gap: 16, padding: '21px 24px 17px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <div>
                          <h3 style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.3px', color: '#F4F4F2', margin: 0 }}>Convertir y enviar</h3>
                          <p style={{ fontSize: 12.5, color: '#878E88', margin: '3px 0 0' }}>De tu billetera {srcTicker} a tu cuenta en pesos</p>
                      </div>
                      <button onClick={closeConvertModal} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                          <X size={13} style={{ color: '#878E88' }} strokeWidth={1.7} />
                      </button>
                  </div>

                  <div style={{ padding: '20px 24px 24px' }}>
                      {/* CONVIERTES */}
                      <div style={{ border: cvOver ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.1)', borderRadius: 13, padding: '15px 16px', background: 'rgba(255,255,255,0.025)' }}>
                          <div className="flex items-center justify-between" style={{ marginBottom: 9 }}>
                              <span style={{ color: '#878E88', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px' }}>CONVIERTES</span>
                              <button onClick={() => setPct(100)} style={{ fontSize: 11.5, color: '#878E88' }}>Disponible <span style={{ color: '#F4F4F2', fontWeight: 700 }}>{fmtSrc(cvAvail)}</span></button>
                          </div>
                          <div className="flex items-center" style={{ gap: 12 }}>
                              <input
                                  type="text"
                                  value={convertAmountStr}
                                  onChange={handleConvertInput}
                                  autoFocus
                                  className="flex-1 min-w-0 outline-none"
                                  style={{ background: 'transparent', border: 'none', fontSize: 34, fontWeight: 800, letterSpacing: '-1.4px', lineHeight: 1.1, color: '#F4F4F2', fontFamily: 'inherit', width: '100%' }}
                              />
                              <div className="flex items-center" style={{ flexShrink: 0, gap: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '8px 12px' }}>
                                  <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#26A17B', color: '#fff', fontWeight: 800, fontSize: 11, display: 'grid', placeItems: 'center' }}>₮</span>
                                  <span style={{ fontSize: 14, fontWeight: 700, color: '#F4F4F2' }}>{srcTicker}</span>
                              </div>
                          </div>
                          {cvOver && <p style={{ fontSize: 12, color: '#878E88', marginTop: 6 }}>Supera tu saldo disponible</p>}
                          <div className="flex" style={{ gap: 6, marginTop: 12 }}>
                              {[25, 50, 100].map(p => (
                                  <button key={p} onClick={() => setPct(p)} style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', borderRadius: 7, padding: '5px 11px', fontSize: 11.5, fontWeight: 600, color: '#878E88' }} className="hover:bg-white/[0.09] transition-colors">
                                      {p === 100 ? 'Todo' : `${p} %`}
                                  </button>
                              ))}
                          </div>
                      </div>

                      {/* Switch de dirección (visual) */}
                      <div className="flex items-center" style={{ gap: 12, padding: '9px 0' }}>
                          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
                          <div style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: '#0C0E0D', display: 'grid', placeItems: 'center' }}>
                              <ArrowLeftRight size={15} style={{ color: '#878E88', transform: 'rotate(90deg)' }} strokeWidth={1.5} />
                          </div>
                          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
                      </div>

                      {/* RECIBES */}
                      <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 13, padding: '15px 16px', background: 'rgba(255,255,255,0.025)' }}>
                          <div className="flex items-center justify-between" style={{ marginBottom: 9 }}>
                              <span style={{ color: '#878E88', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px' }}>RECIBES</span>
                              <span style={{ fontSize: 11.5, color: '#878E88' }}>Cuenta local · Colombia</span>
                          </div>
                          <div className="flex items-center" style={{ gap: 12 }}>
                              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-1.4px', lineHeight: 1.1, color: '#F4F4F2' }}>
                                  {Math.round(cvTotal).toLocaleString('es-CO')}
                              </span>
                              <div className="flex items-center" style={{ flexShrink: 0, gap: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '8px 12px' }}>
                                  <span style={{ width: 24, height: 24, borderRadius: '50%', overflow: 'hidden', display: 'block', background: 'linear-gradient(to bottom, #FCD116 0%, #FCD116 50%, #003893 50%, #003893 75%, #CE1126 75%, #CE1126 100%)' }} />
                                  <span style={{ fontSize: 14, fontWeight: 700, color: '#F4F4F2' }}>COP</span>
                              </div>
                          </div>
                      </div>

                      {/* Cupón (compacto, mismo lenguaje) */}
                      {couponsAllowed && (
                          <div style={{ marginTop: 12 }}>
                              {!showCouponInput && !appliedCoupon && (
                                  <button onClick={() => setShowCouponInput(true)} style={{ fontSize: 12, fontWeight: 600, color: '#878E88' }} className="hover:text-[#4ADE80] transition-colors flex items-center gap-1">
                                      <Tag size={13} /> ¿Tienes un cupón?
                                  </button>
                              )}
                              {showCouponInput && (
                                  <div className="flex gap-2 animate-in fade-in slide-in-from-top-1">
                                      <input type="text" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} placeholder="CÓDIGO"
                                          style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '7px 11px', fontSize: 12, color: '#F4F4F2', textTransform: 'uppercase', outline: 'none' }} />
                                      <button onClick={handleApplyCoupon} style={{ background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)', color: '#F4F4F2', borderRadius: 8, padding: '7px 13px', fontSize: 12, fontWeight: 700 }}>Aplicar</button>
                                      <button onClick={() => setShowCouponInput(false)} style={{ color: '#878E88' }}><X size={15}/></button>
                                  </div>
                              )}
                              {appliedCoupon && (
                                  <div className="flex justify-between items-center animate-in fade-in" style={{ border: '1px solid rgba(74,222,128,0.3)', background: 'rgba(74,222,128,0.08)', borderRadius: 8, padding: '7px 11px', fontSize: 12 }}>
                                      <span style={{ color: '#4ADE80', fontWeight: 700 }} className="flex items-center gap-1"><Tag size={12}/> Cupón {appliedCoupon.code} · −{appliedCoupon.discount}% fee</span>
                                      <button onClick={() => { setAppliedCoupon(null); setCouponCode(''); }} style={{ color: '#878E88' }}><X size={12}/></button>
                                  </div>
                              )}
                          </div>
                      )}

                      {/* Desglose — siempre visible */}
                      <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 13, overflow: 'hidden', marginTop: 16 }}>
                          {[
                              { l: `Comisión de envío · ${applicableFeePercentage} %`, v: `${fmtSrc(cvFee)} ${srcTicker}` },
                              { l: 'Monto convertido', v: `${fmtSrc(amountToConvert)} ${srcTicker}` },
                              { l: 'Tasa aplicada', v: `1 ${srcTicker} = ${Number(conversionRate).toLocaleString('es-CO')} COP` },
                          ].map((row, i) => (
                              <div key={row.l} className="flex items-center justify-between" style={{ padding: '12px 16px', fontSize: 13, borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
                                  <span style={{ color: '#878E88' }}>{row.l}</span>
                                  <span style={{ color: '#F4F4F2', fontWeight: 700 }}>{row.v}</span>
                              </div>
                          ))}
                          <div className="flex items-center justify-between" style={{ padding: '12px 16px', fontSize: 13, borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
                              <span style={{ color: '#878E88' }}>Total que recibes</span>
                              <span style={{ color: '#4ADE80', fontWeight: 700 }}>{Math.round(cvTotal).toLocaleString('es-CO')} COP</span>
                          </div>
                      </div>

                      {/* Aviso de entrega */}
                      <div className="flex items-center" style={{ gap: 11, border: '1px solid rgba(255,255,255,0.1)', borderLeft: '2px solid #4ADE80', background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '12px 15px', marginTop: 14 }}>
                          <Clock size={16} style={{ color: '#878E88', flexShrink: 0 }} strokeWidth={1.5} />
                          <span style={{ fontSize: 12.5, color: '#878E88', lineHeight: 1.5 }}>El dinero llega <span style={{ color: '#F4F4F2', fontWeight: 700 }}>en segundos</span> una vez confirmes la operación.</span>
                      </div>

                      {/* Acciones */}
                      <div className="flex" style={{ gap: 9, marginTop: 18 }}>
                          <button onClick={closeConvertModal} style={{ flex: 1, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)', color: '#F4F4F2', fontWeight: 600, fontSize: 14, padding: '13px 0', borderRadius: 10 }} className="hover:bg-white/[0.09] transition-colors">Cancelar</button>
                          <button
                              onClick={handleConvertSubmit}
                              disabled={isConverting || rawAmount <= 0 || cvOver}
                              className="lincoin-btn-white flex justify-center items-center gap-2 transition-colors"
                              style={(isConverting || rawAmount <= 0 || cvOver)
                                  ? { flex: 1.5, background: 'rgba(255,255,255,0.1)', color: '#878E88', fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 10, cursor: 'not-allowed', border: 'none' }
                                  : { flex: 1.5, fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 10, border: 'none' }}
                          >
                              {isConverting ? <Loader2 size={16} className="animate-spin" /> : 'Confirmar conversión'}
                          </button>
                      </div>

                      {/* Pie de confianza */}
                      <div className="flex items-center justify-center" style={{ gap: 8, marginTop: 13 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ADE80' }} />
                          <span style={{ fontSize: 12, color: '#878E88' }}>Operación protegida · confirmación en dos pasos</span>
                      </div>
                  </div>
              </div>
          </div>
          );
      })()}

      {/* EDIT PROFILE MODAL */}
      {isEditProfileModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-300 p-6">
                  <h3 className="font-bold text-lg text-slate-800 mb-4">Editar Perfil</h3>
                  <div className="space-y-4">
                      <div className="flex justify-center mb-4">
                          <label className="relative w-24 h-24 rounded-full overflow-hidden bg-slate-100 group cursor-pointer border-2 border-dashed border-slate-300 hover:border-[#0C0E0D] block">
                              {editAvatar ? <img src={editAvatar} className="w-full h-full object-cover pointer-events-none"/> : <div className="w-full h-full flex items-center justify-center text-slate-400 pointer-events-none"><User size={32}/></div>}
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-white text-xs font-bold pointer-events-none">Cambiar</div>
                              <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleAvatarChange} accept="image/*"/>
                          </label>
                      </div>
                      <input type="text" placeholder="Nombre Completo" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full border p-2 rounded-lg text-sm"/>
                      <input type="text" placeholder="Apodo (Opcional)" value={editNickname} onChange={(e) => setEditNickname(e.target.value)} className="w-full border p-2 rounded-lg text-sm"/>
                      <div className="flex justify-end gap-2 mt-2">
                          <button onClick={() => setIsEditProfileModalOpen(false)} className="px-4 py-2 text-slate-500 text-sm">Cancelar</button>
                          <button onClick={handleSaveProfile} className="px-4 py-2 bg-[#0C0E0D] rounded-lg text-sm font-bold">Guardar</button>
                      </div>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};