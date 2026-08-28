import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { MouvSection, fetchMouvBalance } from './OtcMigration';
import { supabase } from '../lib/supabaseClient';
import { Header } from './Header';
import { Logo } from './Logo';
import { FeatureCarousel } from './DashboardWidgets';
import { 
  CheckCircle,
  X,
  Wallet,
  ArrowDownLeft,
  RefreshCw,
  History,
  Send,
  Building2,
  Users,
  Plus,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Settings,
  CreditCard,
  LockKeyhole,
  Activity,
  ArrowLeft,
  Loader2,
  Copy,
  Clock,
  AlertTriangle,
  UploadCloud,
  QrCode,
  LayoutGrid,
  ShieldCheck,
  User,
  Edit2,
  Lock,
  Minus,
  Equal,
  Link,
  DollarSign,
  Megaphone,
  BarChart3,
  Handshake,
  TrendingUp,
  Construction,
  Ban,
  Share2,
  Tag,
  Trophy,
  Award,
  Zap,
  Plane,
  Hotel,
  Car,
  MapPin,
  Calendar,
  Users2,
  ArrowLeftRight,
  Search,
  Link2,
  Timer,
  Trash2,
  LogOut
} from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';
import { useSystemConfig } from '../context/SystemConfigContext';
import { useExchangeRates } from '../context/ExchangeRateContext';
import { FlagImg, FlagSelect } from './FlagImg';

// ... (Existing Interfaces and Constants: DESTINATION_BANKS, INITIAL_WALLET_CARDS, etc. - kept same)
interface DashboardProps {
    onLogout: () => void;
    showSuccessBanner?: boolean;
}

const INITIAL_WALLET_CARDS = [
  { code: 'USD', name: 'Cuenta Dólar', type: 'Internacional' },
  { code: 'COP', name: 'Peso Colombiano', type: 'Local' },
  { code: 'CLP', name: 'Peso Chileno', type: 'Local' },
  { code: 'MXN', name: 'Peso Mexicano', type: 'Local' },
  { code: 'EUR', name: 'Euro', type: 'Internacional' },
  { code: 'PEN', name: 'Sol Peruano', type: 'Local' },
  { code: 'BRL', name: 'Real Brasileño', type: 'Local' },
];

const CONVERSION_CURRENCIES = [
  { code: 'USD', name: 'Dólar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'CLP', name: 'Peso Chileno' },
  { code: 'COP', name: 'Peso Col' },
  { code: 'PEN', name: 'Sol Peruano' },
  { code: 'MXN', name: 'Peso Mex' },
  { code: 'BRL', name: 'Real' },
];

const SEND_COUNTRIES = [
    { code: 'CLP', name: 'Chile', currency: 'CLP' },
    { code: 'COP', name: 'Colombia', currency: 'COP' },
    { code: 'PEN', name: 'Perú', currency: 'PEN' },
    { code: 'MXN', name: 'México', currency: 'MXN' },
    { code: 'BRL', name: 'Brasil', currency: 'BRL' },
    { code: 'USD', name: 'Estados Unidos', currency: 'USD' },
    { code: 'EUR', name: 'Europa (SEPA)', currency: 'EUR' },
    { code: 'CNY', name: 'China', currency: 'CNY' },
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

const DiditKycButton: React.FC<{ userId?: string; kycStatus?: string; showToast: (msg: string) => void }> = ({ userId, kycStatus, showToast }) => {
  const [loading, setLoading] = React.useState(false);
  const [checkingStatus, setCheckingStatus] = React.useState(false);
  const isInProgress = kycStatus === 'in_progress';
  const isRejected = kycStatus === 'rejected';

  // Poll Didit for status updates — every 10s, and bursts on tab-focus return
  React.useEffect(() => {
    if (!isInProgress || !userId) return;
    const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
    const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
    let active = true;
    const poll = async () => {
      try {
        const r = await fetch(`${SURL}/functions/v1/didit-kyc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
          body: JSON.stringify({ action: 'get_status', userId }),
        });
        if (!active) return;
        const d = await r.json();
        if (d.status === 'verified') {
          showToast('¡Verificación aprobada! Actualizando...');
          setTimeout(() => window.location.reload(), 1200);
        } else if (d.status === 'rejected') {
          setTimeout(() => window.location.reload(), 500);
        }
      } catch { /* network error — retry next tick */ }
    };
    poll(); // immediate on mount
    const id = setInterval(poll, 10_000);
    // Burst polls when user tabs back — catches approval quickly
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        poll();
        setTimeout(poll, 3_000);
        setTimeout(poll, 7_000);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { active = false; clearInterval(id); document.removeEventListener('visibilitychange', onVisibility); };
  }, [isInProgress, userId]);

  const checkStatusManually = async () => {
    if (!userId || checkingStatus) return;
    setCheckingStatus(true);
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      const r = await fetch(`${SURL}/functions/v1/didit-kyc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
        body: JSON.stringify({ action: 'get_status', userId }),
      });
      const d = await r.json();
      if (d.status === 'verified') {
        showToast('¡Verificación aprobada! Actualizando...');
        setTimeout(() => window.location.reload(), 1200);
      } else if (d.status === 'in_review') {
        showToast('Tu verificación está en revisión manual.');
      } else if (d.status === 'rejected') {
        showToast('Tu verificación fue rechazada. Intenta de nuevo.');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        showToast('Aún en proceso. Intenta nuevamente en unos minutos.');
      }
    } catch {
      showToast('Error al consultar estado. Intenta más tarde.');
    }
    setCheckingStatus(false);
  };

  const startVerification = async () => {
    if (!userId || loading) return;
    setLoading(true);
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      // If already in_progress, resume the SAME session (never create a new one)
      const action = isInProgress ? 'resume_session' : 'create_session';
      const r = await fetch(`${SURL}/functions/v1/didit-kyc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
        body: JSON.stringify({ action, userId, type: 'kyb' }),
      });
      const data = await r.json();
      if (data.status === 'verified') {
        showToast('¡Verificación aprobada! Actualizando...');
        setTimeout(() => window.location.reload(), 1500);
        return;
      }
      if (data.status === 'in_review') {
        showToast('Tu verificación está en revisión. Te notificaremos cuando esté lista.');
        return;
      }
      if (data.status === 'rejected') {
        showToast('Verificación rechazada. Intenta de nuevo.');
        setTimeout(() => window.location.reload(), 1500);
        return;
      }
      if (data.no_url) {
        showToast('Tu sesión de verificación está activa en Lincoin. Si ya completaste los pasos, espera unos segundos y la página se actualizará sola.');
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      } else {
        showToast(data.error || 'Error al iniciar verificación. Contacta soporte.');
      }
    } catch {
      showToast('Error de conexión. Intenta de nuevo.');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-2">
      <button
        onClick={startVerification}
        disabled={loading}
        className="w-full py-3 px-6 bg-[#0C0E0D] font-bold rounded-xl hover:bg-[#152e52] disabled:opacity-50 transition-colors flex items-center justify-center gap-2 text-sm"
      >
        {loading ? (
          <><span className="animate-spin">⏳</span> Iniciando verificación...</>
        ) : isRejected ? (
          <><ShieldCheck size={16}/> Reintentar verificación de identidad</>
        ) : isInProgress ? (
          <><ShieldCheck size={16}/> Continuar verificación de identidad</>
        ) : (
          <><ShieldCheck size={16}/> Verificar identidad con Lincoin</>
        )}
      </button>
      {isInProgress && (
        <div className="flex flex-col items-center gap-2">
          <button onClick={checkStatusManually} disabled={checkingStatus}
            className="text-xs text-[#0C0E0D] font-bold underline underline-offset-2 hover:text-[#0C0E0D] disabled:opacity-50">
            {checkingStatus ? '⏳ Consultando...' : '¿Ya terminaste? → Verificar estado ahora'}
          </button>
          <p className="text-xs text-slate-400 text-center">El estado se actualiza automáticamente cada 15 seg.</p>
        </div>
      )}
      {isRejected && (
        <p className="text-xs text-red-500 text-center">Tu verificación fue rechazada. Asegúrate de usar documentos vigentes y buena iluminación.</p>
      )}
      {!isInProgress && !isRejected && (
        <p className="text-xs text-slate-400 text-center">Proceso rápido · Foto de documento + selfie · Resultado en minutos</p>
      )}
    </div>
  );
};

export const Dashboard: React.FC<DashboardProps> = ({ onLogout, showSuccessBanner = false }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState<'dashboard' | 'movements' | 'wallet-detail' | 'profile' | 'notifications' | 'enviar' | 'convertir' | 'referrals' | 'affiliates' | 'otc' | 'servicios' | 'travel' | 'seguros' | 'mouv'>('dashboard');
  const [travelTab, setTravelTab] = useState<'vuelos' | 'hoteles' | 'autos'>('vuelos');
  const [segTab, setSegTab] = useState<'vehicular' | 'empresarial'>('vehicular');
  const [segPais, setSegPais] = useState('Colombia');
  const [segPlaca, setSegPlaca] = useState('');
  const [segTipo, setSegTipo] = useState<'soat' | 'todoriesgo' | 'ambos'>('soat');
  const [segSolicitado, setSegSolicitado] = useState(false);
  const [travelType, setTravelType] = useState<'ida' | 'idavuelta'>('idavuelta');
  const [travelOrigin, setTravelOrigin] = useState('');
  const [travelDest, setTravelDest] = useState('');
  const [travelDateOut, setTravelDateOut] = useState('');
  const [travelDateIn, setTravelDateIn] = useState('');
  const [travelPax, setTravelPax] = useState(1);
  const [travelHotelDest, setTravelHotelDest] = useState('');
  const [travelHotelIn, setTravelHotelIn] = useState('');
  const [travelHotelOut, setTravelHotelOut] = useState('');
  const [travelRooms, setTravelRooms] = useState(1);
  const [travelSearched, setTravelSearched] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(showSuccessBanner);
  
  // Data Context
  const {
      currentUser,
      getBalance,
      getPersonalMovements,
      requestDeposit,
      requestWithdrawal,
      performConversion,
      bankingOptions,
      getUserNotifications,
      markNotificationsRead,
      getAllUsers,
      sendCuypayPayment,
      enrollMFA,
      verifyMFAEnrollment,
      unenrollMFA,
      getMFAStatus,
      updateUserProfile,
      deleteUser,
      logoutUser,
      refreshData,
  } = useDatabase();
  const { config } = useSystemConfig();
  const { getRate, getFee, getFeeForAmount } = useExchangeRates();

  const movements = getPersonalMovements();
  const isKycVerified = currentUser?.kycStatus === 'verified';
  const isBlocked = currentUser?.isBlocked;
  const notifications = getUserNotifications();
  const allUsers = getAllUsers();

  // Delete account state
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // 2FA state
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | undefined>(undefined);
  const [mfaTotpSecret, setMfaTotpSecret] = useState<string | undefined>(undefined);
  const [mfaModalOpen, setMfaModalOpen] = useState(false);
  const [mfaEnrollData, setMfaEnrollData] = useState<{ qrCode: string; secret: string; factorId: string } | null>(null);
  const [mfaVerifyCode, setMfaVerifyCode] = useState('');
  const [mfaVerifyError, setMfaVerifyError] = useState('');
  const [mfaVerifyLoading, setMfaVerifyLoading] = useState(false);
  const [mfaDisableModalOpen, setMfaDisableModalOpen] = useState(false);

  useEffect(() => {
    getMFAStatus().then(({ enrolled, factorId, totpSecret }) => {
      setMfaEnrolled(enrolled);
      setMfaFactorId(factorId);
      setMfaTotpSecret(totpSecret);
    });
  }, [currentUser?.id]);

  const handleOpenMFAEnroll = async () => {
    const data = await enrollMFA();
    if (!data) { showToast('Error al iniciar 2FA. Intenta nuevamente.'); return; }
    setMfaEnrollData(data);
    setMfaVerifyCode('');
    setMfaVerifyError('');
    setMfaModalOpen(true);
  };

  const handleVerifyMFAEnrollment = async () => {
    if (!mfaEnrollData || mfaVerifyCode.length !== 6) return;
    setMfaVerifyLoading(true);
    setMfaVerifyError('');
    const { ok, error: mfaErr } = await verifyMFAEnrollment(mfaEnrollData.factorId, mfaVerifyCode, mfaEnrollData.secret);
    setMfaVerifyLoading(false);
    if (!ok) { setMfaVerifyError(mfaErr || 'Código incorrecto. Intenta nuevamente.'); setMfaVerifyCode(''); return; }
    setMfaEnrolled(true);
    setMfaFactorId(mfaEnrollData.factorId);
    setMfaTotpSecret(mfaEnrollData.secret);
    setMfaModalOpen(false);
    setMfaEnrollData(null);
    showToast('¡Verificación en 2 pasos activada!');
  };

  const handleDisableMFA = async () => {
    if (!mfaFactorId) return;
    await unenrollMFA(mfaFactorId);
    setMfaEnrolled(false);
    setMfaFactorId(undefined);
    setMfaTotpSecret(undefined);
    if (currentUser) updateUserProfile(currentUser.id, { raw_data: { ...(currentUser as any).raw_data, mfaEnabled: false, mfaFactorId: null, totpSecret: null } });
    setMfaDisableModalOpen(false);
    showToast('Verificación en 2 pasos desactivada.');
  };

  const seasonEmojis = config.seasonEmojis || [];

  // UI States
  const [selectedWalletCode, setSelectedWalletCode] = useState<string | null>(null);
  // BreB Lincoin: saldo COP separado (key 'COP_BREB' en balances) que se
  // fondea moviendo desde Peso Lincoin y se usa para dispersar vía Mouv.
  const [brebMoveOpen, setBrebMoveOpen] = useState(false);
  const [brebDir, setBrebDir] = useState<'to_breb' | 'to_peso'>('to_breb');
  const [brebAmountStr, setBrebAmountStr] = useState('');
  const [brebMoving, setBrebMoving] = useState(false);
  // Saldo REAL en Mouv (Peso Lincoin conectado a la cuenta Mouv).
  // mouvChecked distingue "cargando" de "ya respondió sin saldo".
  const [mouvBal, setMouvBal] = useState<number | null>(null);
  const [mouvChecked, setMouvChecked] = useState(false);

  useEffect(() => {
    if (activeView !== 'wallet-detail' || selectedWalletCode !== 'COP' || !currentUser?.id) return;
    let alive = true;
    setMouvChecked(false);
    fetchMouvBalance(currentUser.id).then(v => {
      if (!alive) return;
      setMouvBal(v);
      setMouvChecked(true);
    });
    return () => { alive = false; };
  }, [activeView, selectedWalletCode, currentUser?.id]);

  const handleBrebMove = async () => {
    if (!currentUser?.id || brebMoving) return;
    const amount = Number(brebAmountStr.replace(/[^\d]/g, ''));
    const cop  = getBalance('COP');
    const breb = getBalance('COP_BREB');
    if (!amount || amount <= 0) { showToast('Ingresa un monto válido'); return; }
    const source = brebDir === 'to_breb' ? cop : breb;
    if (amount > source) { showToast('Saldo insuficiente en la cuenta de origen'); return; }
    setBrebMoving(true);
    const newBalances = brebDir === 'to_breb'
      ? { COP: cop - amount, COP_BREB: breb + amount }
      : { COP: cop + amount, COP_BREB: breb - amount };
    await updateUserProfile(currentUser.id, { balances: newBalances });
    // Registro del movimiento (best-effort — el saldo ya quedó actualizado)
    try {
      await supabase.from('transactions').insert({
        user_id: currentUser.id,
        type: 'breb_move', amount, currency: 'COP', status: 'Completado',
        raw_data: {
          initials: 'BB',
          title: brebDir === 'to_breb' ? 'Peso Lincoin → BreB Lincoin' : 'BreB Lincoin → Peso Lincoin',
          date: new Date().toLocaleDateString('es-CO'), createdAt: new Date().toISOString(),
          userName: currentUser.companyName || currentUser.name,
        },
      });
    } catch { /* el saldo es la fuente de verdad */ }
    setBrebMoving(false);
    setBrebMoveOpen(false);
    setBrebAmountStr('');
    showToast(brebDir === 'to_breb' ? 'Saldo movido a BreB Lincoin ⚡' : 'Saldo devuelto a Peso Lincoin');
  };
  const [showAllWallets, setShowAllWallets] = useState(false);
  const [movementsTab, setMovementsTab] = useState<'all' | 'income' | 'expense'>('all');
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [myWallets, setMyWallets] = useState(INITIAL_WALLET_CARDS);
  const displayedWallets = showAllWallets ? myWallets : myWallets.slice(0, 3);
  const [isWalletOrderModalOpen, setIsWalletOrderModalOpen] = useState(false);
  const [walletDraftOrder, setWalletDraftOrder] = useState<string[]>([]);

  // Modal States
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isFeatureModalOpen, setIsFeatureModalOpen] = useState(false);
  const [featureModalData, setFeatureModalData] = useState({ title: '', desc: '', icon: Construction });
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [loadStep, setLoadStep] = useState(1);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedBankName, setSelectedBankName] = useState('');
  const [loadAmount, setLoadAmount] = useState('');
  const [timeLeft, setTimeLeft] = useState(300);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [sendStep, setSendStep] = useState(1);
  const [sendMode, setSendMode] = useState<'bank' | 'pay' | 'cash' | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [payRecipientCode, setPayRecipientCode] = useState('');
  const [payRecipientUser, setPayRecipientUser] = useState<any>(null);
  const [payLookupStatus, setPayLookupStatus] = useState<'idle' | 'found' | 'not_found'>('idle');
  const [isPaySending, setIsPaySending] = useState(false);
  const [showPayVerify, setShowPayVerify] = useState(false);
  const [payVerifyCode, setPayVerifyCode] = useState('');
  const [payVerifyError, setPayVerifyError] = useState('');
  const [payVerifyLoading, setPayVerifyLoading] = useState(false);
  const [sendForm, setSendForm] = useState({
      destinationCountry: 'Chile',
      destinationCurrency: 'CLP',
      amount: '',
      beneficiaryType: 'business' as 'personal' | 'business',
      beneficiaryName: '',
      documentType: '',
      documentNumber: '',
      bankName: '',
      accountType: '',
      accountNumber: '',
      reason: 'Pago a Proveedor',
  });
  const [cashForm, setCashForm] = useState({ recipientName: '', docType: 'CC', docNumber: '', phone: '', city: '' });
  const [cashReference, setCashReference] = useState('');
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [convertAmountStr, setConvertAmountStr] = useState('1.000');
  const [sourceCurr, setSourceCurr] = useState('USD');
  const [targetCurr, setTargetCurr] = useState('COP');
  const [isConverting, setIsConverting] = useState(false);
  const [showConvertDetails, setShowConvertDetails] = useState(false);
  
  // Coupon States
  const [showCouponInput, setShowCouponInput] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{code: string, discount: number} | null>(null);

  // New Receive Modal
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [receiveCurrency, setReceiveCurrency] = useState('USD');

  // OTC State
  const [otcAmount, setOtcAmount] = useState('');
  const [otcCoin, setOtcCoin] = useState<'USDT' | 'USDC'>('USDT');
  const [otcNetwork, setOtcNetwork] = useState<Record<string, string>>({ USDT: 'USDT_TRON', USDC: 'USDC_BSC' });
  const [otcWallets, setOtcWallets] = useState<Record<string, { address: string; balance: number; loading: boolean; error?: string }>>({});
  const [otcWithdrawAddress, setOtcWithdrawAddress] = useState('');
  const [otcWithdrawSending, setOtcWithdrawSending] = useState(false);
  const [otcWithdrawNetwork, setOtcWithdrawNetwork] = useState<Record<string, string>>({ USDT: 'USDT_TRON', USDC: 'USDC_BSC' });
  const [showQrScanner, setShowQrScanner] = useState(false);
  const qrVideoRef = useRef<HTMLVideoElement>(null);
  const qrStreamRef = useRef<MediaStream | null>(null);
  const qrDetectRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [otcTab, setOtcTab] = useState<'deposit' | 'withdraw' | 'convert' | 'history'>('deposit');
  const [otcConvertTarget, setOtcConvertTarget] = useState('');
  const [otcConvertSending, setOtcConvertSending] = useState(false);
  const [otcConvertError, setOtcConvertError] = useState('');

  const OTC_NETWORKS: Record<string, Array<{ key: string; label: string; placeholder: string }>> = {
    USDT: [
      { key: 'USDT_TRON', label: 'TRC-20 (Tron)', placeholder: 'T...' },
      { key: 'USDT_BSC',  label: 'BEP-20 (BSC)',  placeholder: '0x...' },
    ],
    USDC: [
      { key: 'USDC_BSC',   label: 'BEP-20 (BSC)', placeholder: '0x...' },
      { key: 'USDC_BASE',  label: 'Base',          placeholder: '0x...' },
    ],
  };

  // Platform withdrawal fee per network (deducted from the amount, in USDT/USDC)
  const PLATFORM_WITHDRAW_FEES: Record<string, number> = {
    USDT_BSC: 1, USDC_BSC: 1, USDT_TRON: 10, USDC_BASE: 1,
  };
  const OTC_NETWORK_FEES: Record<string, string> = {
    USDT_TRON:  '10 USDT',
    USDT_BSC:   '1 USDT',

    USDC_BSC:   '1 USDC',
    USDC_BASE:  '1 USDC',
  };

  // PayLink State
  const [isPayLinkOpen, setIsPayLinkOpen] = useState(false);
  const [payLinkStep, setPayLinkStep] = useState(1);
  const [payLinkCountry, setPayLinkCountry] = useState('CO');
  const [payLinkAmount, setPayLinkAmount] = useState('');
  const [payLinkPayerName, setPayLinkPayerName] = useState('');
  const [payLinkDocType, setPayLinkDocType] = useState('CC');
  const [payLinkDocNumber, setPayLinkDocNumber] = useState('');
  const [payLinkUrl, setPayLinkUrl] = useState('');
  const [payLinkSecondsLeft, setPayLinkSecondsLeft] = useState(1800);

  // Date for delivery estimate
  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + 1);
  const deliveryDateStr = deliveryDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });

  // Calculation for conversion
  const formatInputNumber = (value: string) => {
      const cleanVal = value.replace(/\D/g, '');
      if (!cleanVal) return '';
      return new Intl.NumberFormat('es-DE').format(Number(cleanVal));
  };
  const getRawAmount = (val: string) => Number(val.replace(/\./g, ''));
  
  const rawAmount = getRawAmount(convertAmountStr);
  const conversionRate = getRate(sourceCurr, targetCurr);
  
  // Comisión con tiers por volumen (fx_pair_config.tiers en el admin). Si no hay
  // tiers configurados, getFeeForAmount cae al flat fee legacy.
  const applicableFeePercentage = getFeeForAmount(sourceCurr, targetCurr, rawAmount);
  const baseFee = rawAmount * (applicableFeePercentage / 100);
  
  const discountMultiplier = appliedCoupon ? (100 - appliedCoupon.discount) / 100 : 1;
  const finalFee = baseFee * discountMultiplier;
  const amountToConvert = rawAmount - finalFee;
  const finalAmount = amountToConvert * conversionRate;

  useEffect(() => {
      if (currentUser?.country) {
          const countryMap: Record<string, string> = {
              'Perú': 'PEN', 'Peru': 'PEN', 'Chile': 'CLP', 'Colombia': 'COP',
              'México': 'MXN', 'Mexico': 'MXN', 'Brasil': 'BRL', 'Brazil': 'BRL',
              'Venezuela': 'VES', 'Estados Unidos': 'USD'
          };
          const localCurrency = countryMap[currentUser.country] || 'USD';
          
          setMyWallets(prev => {
              const sorted = [...prev];
              const usdIdx = sorted.findIndex(w => w.code === 'USD');
              if (usdIdx > -1) {
                  const [usd] = sorted.splice(usdIdx, 1);
                  sorted.unshift(usd);
              }
              if (localCurrency !== 'USD') {
                  const localIdx = sorted.findIndex(w => w.code === localCurrency);
                  if (localIdx > -1) {
                      const [local] = sorted.splice(localIdx, 1);
                      sorted.unshift(local);
                  }
              }
              return sorted;
          });
      }
  }, [currentUser]);

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

  useEffect(() => {
    if (payLinkStep !== 3 || payLinkSecondsLeft <= 0) return;
    const t = setTimeout(() => setPayLinkSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [payLinkStep, payLinkSecondsLeft]);

  // Maps wallet network key → currency symbol stored in crypto_balances
  const WALLET_CURRENCY: Record<string, string> = {
    USDT_TRON: 'USDT', USDT_BSC: 'USDT',
    USDC_MATIC: 'USDC', USDC_BSC: 'USDC', USDC_BASE: 'USDC',
  };

  const [otcRefreshing, setOtcRefreshing] = useState(false);
  const handleOtcRefresh = async () => {
    setOtcRefreshing(true);
    await refreshData();
    // Reload wallets without clearing — avoids the error flash
    loadOtcWallet(otcNetwork['USDT'] ?? 'USDT_TRON', true);
    loadOtcWallet(otcNetwork['USDC'] ?? 'USDC_BSC', true);
    // Fire verify_and_credit in background — credits any on-chain balance not yet reflected
    const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
    const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
    if (currentUser?.id && SURL) {
      const walletKey = otcNetwork['USDT'] ?? 'USDT_TRON';
      fetch(`${SURL}/functions/v1/gasfree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
        body: JSON.stringify({ action: 'verify_and_credit', userId: currentUser.id, walletKey }),
      }).then(r => r.json()).then(d => {
        if (d.synced && d.credited > 0) {
          showToast(`✅ Depósito acreditado: ${d.credited} ${walletKey}`);
          refreshData();
        }
      }).catch(() => {});
    }
    setOtcRefreshing(false);
  };

  // Track which walletKeys have already been auto-verified this session
  const autoVerifiedRef = React.useRef<Set<string>>(new Set());

  // Load GasFree OTC wallet when user enters OTC view or changes network
  const loadOtcWallet = (walletKey: string, force = false) => {
    if (!currentUser?.otcEnabled || !currentUser?.id) return;
    if (!force && otcWallets[walletKey]?.address) return;
    const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
    const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
    setOtcWallets(prev => ({ ...prev, [walletKey]: { address: '', balance: 0, loading: true } }));
    (async () => {
      try {
        const r = await fetch(`${SURL}/functions/v1/gasfree`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
          body: JSON.stringify({ action: 'get_or_create', userId: currentUser.id, walletKey }),
        });
        const data = await r.json();
        if (data.address) {
          const balance = (currentUser.balances as Record<string, number>)?.[walletKey] ?? 0;
          setOtcWallets(prev => ({ ...prev, [walletKey]: { address: data.address, balance, loading: false } }));

          // Auto-verify on-chain once per session — catches deposits missed by GasFree webhook
          if (!autoVerifiedRef.current.has(walletKey) && SURL && currentUser?.id) {
            autoVerifiedRef.current.add(walletKey);
            fetch(`${SURL}/functions/v1/gasfree`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
              body: JSON.stringify({ action: 'verify_and_credit', userId: currentUser.id, walletKey }),
            }).then(res => res.json()).then(d => {
              if (d.synced && d.credited > 0) {
                showToast(`✅ Depósito detectado: +${d.credited} ${walletKey.split('_')[0]}`);
                refreshData();
              }
            }).catch(() => {});
          }
        } else {
          setOtcWallets(prev => ({ ...prev, [walletKey]: { address: '', balance: 0, loading: false, error: data.error ?? 'Error desconocido' } }));
        }
      } catch (e: any) {
        setOtcWallets(prev => ({ ...prev, [walletKey]: { address: '', balance: 0, loading: false, error: e?.message ?? 'Error de red' } }));
      }
    })();
  };

  // Keep displayed OTC balances in sync with currentUser whenever admin credits/debits
  // Warn before unload when a withdrawal is being processed
  useEffect(() => {
    if (!otcWithdrawSending) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Hay un retiro en proceso. ¿Estás seguro de que quieres salir?';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [otcWithdrawSending]);

  useEffect(() => {
    if (!currentUser?.balances) return;
    const balsNow = currentUser.balances as Record<string, number>;
    setOtcWallets(prev => {
      const updated = { ...prev };
      for (const [key] of Object.entries(WALLET_CURRENCY)) {
        const newBal = balsNow[key] ?? 0;
        if (updated[key]) {
          // Update balance even if address hasn't loaded (admin credit case)
          if (updated[key].balance !== newBal) {
            updated[key] = { ...updated[key], balance: newBal };
          }
        } else if (newBal > 0) {
          // Balance exists but wallet entry doesn't yet — create a placeholder so card shows it
          updated[key] = { address: '', balance: newBal, loading: false };
        }
      }
      return updated;
    });
  }, [currentUser?.balances]);

  useEffect(() => {
    if (activeView !== 'otc' || !currentUser?.otcEnabled || !currentUser?.id) return;
    loadOtcWallet(otcNetwork['USDT'] ?? 'USDT_TRON');
    loadOtcWallet(otcNetwork['USDC'] ?? 'USDC_BSC');
  }, [activeView, currentUser?.id, currentUser?.otcEnabled]);

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
    setPayLinkUrl(`https://cuypay.com/pay/${id}`);
    setPayLinkSecondsLeft(1800);
    setPayLinkStep(3);
  };

  const formatCountdown = (secs: number) =>
    `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

  const handleOtcWithdraw = async () => {
    if (!currentUser?.id || !otcWithdrawAddress.trim() || otcWithdrawSending) return;
    const walletKey = otcWithdrawNetwork[otcCoin] ?? (otcCoin === 'USDT' ? 'USDT_TRON' : 'USDC_BSC');
    const parsedAmt = parseFloat(otcAmount) || 0;
    const balsNow = (currentUser?.balances as Record<string, number>) ?? {};
    // Check network-specific key first (USDT_BSC), then generic (USDT)
    const walletBal = balsNow[walletKey] ?? balsNow[otcCoin] ?? 0;
    if (parsedAmt <= 0 || parsedAmt > walletBal) return;
    setOtcWithdrawSending(true);
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000); // 2 min max
      let r: Response;
      try {
        r = await fetch(`${SURL}/functions/v1/gasfree`, {
          method: 'POST',
          keepalive: true, // persists even if tab is closed mid-flight
          headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
          body: JSON.stringify({ action: 'send_withdrawal', userId: currentUser.id, walletKey, amount: parsedAmt, toAddress: otcWithdrawAddress.trim() }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const data = await r!.json();
      if (data.ok) {
        const msg = data.txHash ? `✅ Retiro enviado. TX: ${data.txHash.slice(0,16)}...` : '✅ Retiro procesado correctamente.';
        showToast(msg);
        setOtcAmount('');
        setOtcWithdrawAddress('');
      } else {
        showToast(`❌ ${data.error || 'Error al procesar retiro.'}`);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        showToast('⏱ Tiempo de espera agotado. Verifica en Historial si el retiro fue procesado.');
      } else {
        showToast(`❌ Error: ${e?.message || 'Error de conexión.'}`);
      }
    }
    setOtcWithdrawSending(false);
  };

  const startQrScanner = async () => {
    setShowQrScanner(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      qrStreamRef.current = stream;
      if (qrVideoRef.current) {
        qrVideoRef.current.srcObject = stream;
        qrVideoRef.current.play();
      }
      // Use BarcodeDetector if available (modern browsers)
      const BD = (window as any).BarcodeDetector;
      if (BD) {
        const detector = new BD({ formats: ['qr_code'] });
        qrDetectRef.current = setInterval(async () => {
          if (!qrVideoRef.current) return;
          try {
            const codes = await detector.detect(qrVideoRef.current);
            if (codes.length > 0) {
              stopQrScanner();
              setOtcWithdrawAddress(codes[0].rawValue);
            }
          } catch {}
        }, 400);
      }
    } catch {
      setShowQrScanner(false);
      showToast('No se pudo acceder a la cámara.');
    }
  };

  const stopQrScanner = () => {
    if (qrDetectRef.current) { clearInterval(qrDetectRef.current); qrDetectRef.current = null; }
    if (qrStreamRef.current) { qrStreamRef.current.getTracks().forEach(t => t.stop()); qrStreamRef.current = null; }
    setShowQrScanner(false);
  };

  const handleOtcConvert = async () => {
    if (!currentUser?.id || !otcConvertTarget || otcConvertSending) return;
    const walletKey = otcNetwork[otcCoin] ?? (otcCoin === 'USDT' ? 'USDT_TRON' : 'USDC_BSC');
    const parsedAmt = parseFloat(otcAmount) || 0;
    // Balance stored as walletKey ('USDT_BSC') or coin name ('USDT') — try both
    const bals = currentUser.balances as Record<string, number> ?? {};
    const availBal = bals[walletKey] ?? bals[otcCoin] ?? 0;
    if (parsedAmt <= 0) { setOtcConvertError('Ingresa un monto válido.'); return; }
    if (parsedAmt > availBal) { setOtcConvertError(`Saldo insuficiente. Disponible: ${availBal.toLocaleString('es', {minimumFractionDigits:2})} ${otcCoin}`); return; }
    const pairs: any[] = config.otcFiatPairs ?? [];
    const pairKey = `${otcCoin}_${otcConvertTarget}`;
    const pairInfo = pairs.find((p: any) => p.pair === pairKey);
    if (!pairInfo) return;
    setOtcConvertError('');
    setOtcConvertSending(true);
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      const r = await fetch(`${SURL}/functions/v1/gasfree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
        body: JSON.stringify({ action: 'request_convert', userId: currentUser.id, walletKey, amount: parsedAmt, targetCurrency: otcConvertTarget, rate: pairInfo.rate }),
      });
      const data = await r.json();
      if (data.ok) {
        const fiatAmt = (data.targetAmount ?? parsedAmt * pairInfo.rate).toLocaleString('es', {minimumFractionDigits:2});
        showToast(`✓ Conversión exitosa. Se acreditaron ${fiatAmt} ${otcConvertTarget} a tu cuenta.`);
        setOtcAmount('');
        setOtcConvertError('');
        // Update local wallet balance immediately, then refresh from server
        setOtcWallets(prev => {
          const w = prev[walletKey];
          return w ? { ...prev, [walletKey]: { ...w, balance: Math.max(0, w.balance - parsedAmt) } } : prev;
        });
        await refreshData();
      } else {
        setOtcConvertError(data.error || 'Error al procesar la conversión.');
      }
    } catch {
      setOtcConvertError('Error de conexión. Intenta de nuevo.');
    }
    setOtcConvertSending(false);
  };

  // Helper Functions
  const formatMoney = (amount: number, currency: string) => {
      return new Intl.NumberFormat('es-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  };

  const fileToBase64 = (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = error => reject(error);
      });
  };
  const showToast = (msg: string) => {
      setToastMessage(msg);
      setTimeout(() => setToastMessage(null), 3000);
  };
  const handleWalletClick = (code: string) => {
      setSelectedWalletCode(code);
      setMovementsTab('all');
      setActiveView('wallet-detail');
  };

  useEffect(() => {
      const saved = localStorage.getItem('cuypay_wallet_order_biz');
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
      localStorage.setItem('cuypay_wallet_order_biz', JSON.stringify(walletDraftOrder));
      setIsWalletOrderModalOpen(false);
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
      setCouponCode('');
      setAppliedCoupon(null);
      setShowCouponInput(false);
  };
  const closeSendModal = () => {
      setIsSendModalOpen(false);
      setSendStep(1);
      setSendMode(null);
      setPayRecipientCode('');
      setPayRecipientUser(null);
      setPayLookupStatus('idle');
      setSendForm({ ...sendForm, amount: '', beneficiaryName: '', accountNumber: '', reason: 'Pago a Proveedor' });
      setCashForm({ recipientName: '', docType: 'CC', docNumber: '', phone: '', city: '' });
      setCashReference('');
  };

  const handlePayLookup = (code: string) => {
      const upper = code.toUpperCase();
      setPayRecipientCode(upper);
      if (upper.length < 4) { setPayRecipientUser(null); setPayLookupStatus('idle'); return; }
      const found = getAllUsers().find((u: any) => u.ownReferralCode?.toUpperCase() === upper && u.id !== currentUser?.id);
      if (found) { setPayRecipientUser(found); setPayLookupStatus('found'); }
      else { setPayRecipientUser(null); setPayLookupStatus('not_found'); }
  };

  const handlePaySubmit = () => {
      if (isPaySending || payLookupStatus !== 'found' || !payRecipientUser) return;
      if (mfaEnrolled) {
          // MFA enrolled — require verification before sending
          setPayVerifyCode('');
          setPayVerifyError('');
          setShowPayVerify(true);
      } else {
          // No MFA enrolled — send directly
          executePay();
      }
  };

  const executePay = async () => {
      if (!payRecipientUser) return;
      setIsPaySending(true);
      const result = await sendCuypayPayment(payRecipientUser.ownReferralCode, getRawAmount(sendForm.amount), sendForm.destinationCurrency);
      setIsPaySending(false);
      if (result?.error) { showToast(result.error); }
      else { setSendStep(4); }
  };

  const handlePayVerifyAndSend = async () => {
      if (payVerifyLoading || payVerifyCode.length !== 6 || !payRecipientUser) return;
      setPayVerifyLoading(true);
      setPayVerifyError('');
      const { ok, error: mfaErr } = await verifyMFAEnrollment(mfaFactorId ?? 'local', payVerifyCode, mfaTotpSecret);
      if (!ok) { setPayVerifyLoading(false); setPayVerifyError(mfaErr || 'Código incorrecto.'); setPayVerifyCode(''); return; }
      setShowPayVerify(false);
      setPayVerifyLoading(false);
      await executePay();
  };
  const handleFeatureClick = (title: string, desc: string, icon: any) => {
      setFeatureModalData({ title, desc, icon });
      setIsFeatureModalOpen(true);
  };
  
  const getFilteredMovements = (walletCode?: string | null) => {
      let filtered = movements;
      if (walletCode) filtered = filtered.filter(tx => tx.currency === walletCode);
      if (movementsTab === 'income') filtered = filtered.filter(tx => tx.type === 'load' || tx.type === 'receive' || tx.type === 'convert' || tx.type === 'referral_payout' || tx.type === 'referral_commission');
      else if (movementsTab === 'expense') filtered = filtered.filter(tx => tx.type === 'send');
      return filtered;
  };

  const handleActionRestricted = (_requireMfa = false) => {
      if (isBlocked) {
          alert("Tu cuenta está bloqueada. No puedes realizar esta acción.");
          return true;
      }
      // KYC check only applies to withdrawals (send-to-bank), not to conversion or PAY
      return false;
  };

  const handleLoadClick = (walletCode?: string) => {
      if (handleActionRestricted()) return;
      const countryMap: Record<string, string> = { 
          'COP': 'Colombia', 'CLP': 'Chile', 'PEN': 'Perú', 
          'MXN': 'México', 'BRL': 'Brasil', 'VES': 'Venezuela', 'USD': 'Estados Unidos'
      };
      if (walletCode && countryMap[walletCode]) {
          setSelectedCountry(countryMap[walletCode]);
          setLoadStep(2);
      } else {
          setLoadStep(1);
      }
      setIsLoadModalOpen(true);
      setTimeLeft(300);
  };

  const handleBankSelect = (bankName: string) => { setSelectedBankName(bankName); setLoadStep(3); };
  const handleAmountConfirm = () => {
      const rawAmount = getRawAmount(loadAmount);
      if (!loadAmount || isNaN(rawAmount) || rawAmount <= 0) { alert("Ingresa un monto válido"); return; }
      setLoadStep(4);
  };
  const handleLoadSubmit = async () => {
      const numericAmount = getRawAmount(loadAmount);
      let currency = 'CLP'; 
      if (selectedCountry === 'Colombia') currency = 'COP';
      else if (selectedCountry === 'Estados Unidos') currency = 'USD';
      
      let proofUrl = undefined;
      if (proofFile) try { proofUrl = await fileToBase64(proofFile); } catch (e) {}
      requestDeposit(numericAmount, currency, selectedBankName, proofUrl);
      closeModal();
      showToast(`Solicitud enviada.`);
  };

  // --- COUPON & CONVERSION LOGIC ---
  
  const handleApplyCoupon = () => {
      const found = (config.coupons || []).find((c: any) => c.code === couponCode.toUpperCase() && c.active);
      if (found) {
          setAppliedCoupon(found);
          setShowCouponInput(false);
          showToast(`¡Cupón ${found.code} aplicado! ${found.discount}% de descuento en la comisión.`);
      } else {
          alert("Cupón inválido o expirado.");
      }
  };

  const handleConvertInput = (e: React.ChangeEvent<HTMLInputElement>) => { setConvertAmountStr(formatInputNumber(e.target.value)); };
  
  const handleConvertSubmit = () => {
      if (!rawAmount || rawAmount <= 0) { showToast('Ingresa un monto válido.'); return; }
      const currentBalance = getBalance(sourceCurr);
      if (currentBalance < rawAmount) {
          alert(`Saldo insuficiente en ${sourceCurr}.`);
          return;
      }
      if (isConverting) return;
      setIsConverting(true);
      performConversion(sourceCurr, targetCurr, rawAmount, finalAmount, finalFee, appliedCoupon?.code)
        .then((result: any) => {
          setIsConverting(false);
          if (result?.error) { showToast(result.error); return; }
          closeConvertModal();
          showToast(`Conversión exitosa. Has recibido ${formatMoney(finalAmount, targetCurr)} ${targetCurr}`);
        }).catch(() => {
          setIsConverting(false);
          showToast('Error al procesar la conversión.');
        });
  };

  // ... (handleSendNext, handleSendSubmit)
  const handleSendNext = () => {
      setSendStep(prev => prev + 1);
  };
  const handleSendSubmit = () => {
      if (isSending) return;
      setIsSending(true);
      requestWithdrawal(getRawAmount(sendForm.amount), sendForm.destinationCurrency, sendForm.bankName, sendForm.accountNumber, sendForm.beneficiaryName, sendForm.reason)
        .then(() => { setIsSending(false); setSendStep(4); })
        .catch(() => { setIsSending(false); showToast('Error al procesar el envío.'); });
  };

  const handleCashSubmit = () => {
      if (isSending) return;
      const ref = 'CASH-' + Math.random().toString(36).slice(2, 7).toUpperCase();
      setIsSending(true);
      requestWithdrawal(
          getRawAmount(sendForm.amount),
          sendForm.destinationCurrency,
          'Punto Físico',
          cashForm.docNumber,
          cashForm.recipientName,
          `Retiro en punto físico — ${cashForm.city}`
      ).then(() => {
          setCashReference(ref);
          setIsSending(false);
          setSendStep(4);
      }).catch(() => {
          setIsSending(false);
          showToast('Error al procesar el retiro.');
      });
  };

  const myReferrals = (allUsers || []).filter(u => u.referredBy === currentUser?.id);

  // --- RENDERERS ---

  const renderDashboard = () => (
      <div className="space-y-8 animate-in fade-in duration-500">
          {/* Header Area */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pt-4">
              <div>
                  <h1 className="text-2xl font-bold text-[#0C0E0D]">
                      Hola, {currentUser?.companyName || currentUser?.name || 'Empresa'} {seasonEmojis.length > 0 && <span className="ml-2">{seasonEmojis[0]}</span>}
                  </h1>
                  <p className="text-slate-500 text-sm">Resumen de liquidez</p>
                  {currentUser?.ownReferralCode && (
                      <button
                          className="mt-2 inline-flex items-center gap-2 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
                          onClick={() => { navigator.clipboard.writeText(currentUser.ownReferralCode || ''); }}
                      >
                          <Zap size={13} className="text-green-600" />
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Mi ID Lincoin:</span>
                          <span className="font-mono font-extrabold text-[#0C0E0D] tracking-widest text-sm">{currentUser.ownReferralCode}</span>
                          <Copy size={12} className="text-slate-400" />
                      </button>
                  )}
              </div>
              <div className="flex gap-3">
                  <button 
                    onClick={() => { if(!handleActionRestricted()) { setLoadStep(1); setIsLoadModalOpen(true); } }} 
                    disabled={isBlocked || !isKycVerified} 
                    className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors shadow-lg ${isBlocked || !isKycVerified ? 'bg-slate-400 cursor-not-allowed opacity-70' : 'bg-[#0C0E0D] hover:bg-[#152e52] shadow-green-900/20'}`}
                  >
                      <Plus size={18} /> Fondear Cuenta
                  </button>
              </div>
          </div>

          {/* Feature Carousel */}
          <div className="mb-4">
              <FeatureCarousel />
          </div>

          {/* ... (Existing Banners for Block/KYC) ... */}
          {isBlocked && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 shadow-sm animate-pulse">
                  <Ban className="text-red-600 shrink-0 mt-0.5" size={24} />
                  <div>
                      <h3 className="text-red-800 font-bold text-sm">Cuenta Bloqueada Temporalmente</h3>
                      <p className="text-red-700 text-xs mt-1">Motivo: <span className="font-bold">{currentUser?.blockReason || 'Revisión de seguridad'}</span>.</p>
                  </div>
              </div>
          )}
          {!isKycVerified && !isBlocked && (() => {
              const ks = currentUser?.kycStatus;
              if (ks === 'rejected') return (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 shadow-sm animate-in slide-in-from-top-4">
                  <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center shrink-0"><AlertTriangle className="text-red-600" size={20} /></div>
                  <div className="flex-1">
                    <h3 className="text-red-800 font-bold text-sm">Verificación rechazada</h3>
                    <p className="text-red-700 text-xs mt-1">Tu verificación empresarial fue rechazada. Por favor intenta de nuevo o contacta soporte.</p>
                  </div>
                  <DiditKycButton userId={currentUser?.id} kycStatus={ks} showToast={showToast} />
                </div>
              );
              if (ks === 'in_review') return (
                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5 flex items-start gap-4 shadow-sm animate-in slide-in-from-top-4">
                  <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center shrink-0"><Clock className="text-orange-600" size={20} /></div>
                  <div>
                    <h3 className="text-orange-800 font-bold text-sm">Verificación empresarial en revisión</h3>
                    <p className="text-orange-700 text-xs mt-1">Nuestro equipo está revisando tu empresa. Te notificaremos cuando tu cuenta esté activa. Puede tomar hasta 24h.</p>
                  </div>
                </div>
              );
              if (ks === 'in_progress') return (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 shadow-sm animate-in slide-in-from-top-4">
                  <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center shrink-0"><ShieldCheck className="text-[#0C0E0D]" size={20} /></div>
                  <div className="flex-1">
                    <h3 className="text-[#0C0E0D] font-bold text-sm">Verificación KYB en progreso</h3>
                    <p className="text-[#4ADE80] text-xs mt-1">Abriste Lincoin pero aún no terminaste. Completa el proceso para activar tu cuenta empresarial.</p>
                  </div>
                  <DiditKycButton userId={currentUser?.id} kycStatus={ks} showToast={showToast} />
                </div>
              );
              return (
                <div className="bg-gradient-to-r from-[#0C0E0D] to-[#0C0E0D] rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 shadow-lg animate-in slide-in-from-top-4">
                  <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center shrink-0"><ShieldCheck className="text-white" size={20} /></div>
                  <div className="flex-1">
                    <h3 className="text-white font-bold text-sm">Activa tu cuenta — Verificación Empresarial (KYB)</h3>
                    <p className="text-green-200 text-xs mt-1">Verifica tu empresa con Lincoin para acceder a todos los servicios. El proceso toma menos de 5 minutos.</p>
                  </div>
                  <DiditKycButton userId={currentUser?.id} kycStatus={ks} showToast={showToast} />
                </div>
              );
          })()}

          <section>
              <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-700 text-xs flex items-center gap-2 uppercase tracking-wider">
                      <Wallet size={16} className="text-[#4ADE80]"/> Balances Disponibles
                  </h3>
                  <div className="flex items-center gap-3">
                      <button onClick={openWalletOrderModal} title="Ordenar billeteras" className="text-slate-400 hover:text-[#0C0E0D] transition-colors">
                          <Settings size={15} />
                      </button>
                      <button onClick={() => setShowAllWallets(!showAllWallets)} className="text-[#0C0E0D] text-xs font-bold hover:underline">
                          {showAllWallets ? 'Ver menos' : 'Ver más'}
                      </button>
                  </div>
              </div>
              <div className="space-y-3">
                  {/* First wallet — large full-width card */}
                  {displayedWallets.slice(0, 1).map(wallet => {
                      const balance = getBalance(wallet.code);
                      return (
                          <div
                              key={wallet.code}
                              onClick={() => handleWalletClick(wallet.code)}
                              className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:border-[#0C0E0D] hover:shadow-md transition-all cursor-pointer group relative overflow-hidden flex flex-col justify-between"
                              style={{ minHeight: '9rem' }}
                          >
                              <div className="flex justify-between items-start">
                                  <div className="flex items-center gap-3">
                                      <div className="w-11 h-11 rounded-full bg-slate-50 flex items-center justify-center shadow-sm border border-slate-100 overflow-hidden">
                                          <FlagImg code={wallet.code} className="w-full h-full object-cover" />
                                      </div>
                                      <div>
                                          <p className="font-bold text-slate-800 text-base leading-tight">{wallet.name}</p>
                                          <p className="text-[11px] text-slate-400 font-medium uppercase">{wallet.type}</p>
                                      </div>
                                  </div>
                                  <div className="w-7 h-7 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-[#4ADE80] group-hover:text-[#0C0E0D] transition-colors shrink-0">
                                      <ArrowRight size={13} />
                                  </div>
                              </div>
                              <div className="mt-4">
                                  <p className="text-3xl font-bold text-slate-800 tracking-tight">
                                      {formatMoney(balance, wallet.code)} <span className="text-base text-slate-400 font-normal">{wallet.code}</span>
                                  </p>
                              </div>
                          </div>
                      );
                  })}
                  {/* Remaining wallets — 2-column grid */}
                  {displayedWallets.length > 1 && (
                      <div className="grid grid-cols-2 gap-3">
                          {displayedWallets.slice(1).map(wallet => {
                              const balance = getBalance(wallet.code);
                              return (
                                  <div
                                      key={wallet.code}
                                      onClick={() => handleWalletClick(wallet.code)}
                                      className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:border-[#0C0E0D] hover:shadow-md transition-all cursor-pointer group relative overflow-hidden h-36 flex flex-col justify-between"
                                  >
                                      <div className="flex justify-between items-start">
                                          <div className="flex items-center gap-2">
                                              <div className="w-9 h-9 rounded-full bg-slate-50 flex items-center justify-center shadow-sm border border-slate-100 overflow-hidden">
                                                  <FlagImg code={wallet.code} className="w-full h-full object-cover" />
                                              </div>
                                              <div>
                                                  <p className="font-bold text-slate-800 text-sm leading-tight">{wallet.name}</p>
                                                  <p className="text-[10px] text-slate-400 font-medium uppercase">{wallet.type}</p>
                                              </div>
                                          </div>
                                          <div className="w-6 h-6 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-[#4ADE80] group-hover:text-[#0C0E0D] transition-colors shrink-0">
                                              <ArrowRight size={12} />
                                          </div>
                                      </div>
                                      <div>
                                          <p className="text-lg font-bold text-slate-800 tracking-tight">
                                              {formatMoney(balance, wallet.code)} <span className="text-xs text-slate-400 font-normal">{wallet.code}</span>
                                          </p>
                                      </div>
                                  </div>
                              );
                          })}
                      </div>
                  )}
              </div>
          </section>

          {/* ... (Actions Section - kept same) ... */}
          <section>
              <h3 className="font-bold text-slate-700 text-xs mb-4 uppercase tracking-wider">Acciones Rápidas</h3>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                  <button onClick={() => { if(!handleActionRestricted()) { setLoadStep(1); setIsLoadModalOpen(true); } }} className={`bg-white p-6 rounded-2xl border border-slate-200 transition-all flex flex-col items-center gap-3 group ${isBlocked || !isKycVerified ? 'opacity-50 cursor-not-allowed' : 'hover:border-[#4ADE80] hover:shadow-md'}`}>
                      <div className="w-12 h-12 bg-slate-50 text-slate-600 rounded-xl flex items-center justify-center group-hover:bg-[#4ADE80] group-hover:text-[#0C0E0D] transition-colors">
                          <Plus size={24} />
                      </div>
                      <span className="font-bold text-slate-700 text-xs text-center uppercase tracking-wide">Fondear</span>
                  </button>

                  <button onClick={() => { if(!handleActionRestricted(true)) setIsSendModalOpen(true); }} className={`bg-white p-6 rounded-2xl border border-slate-200 transition-all flex flex-col items-center gap-3 group ${isBlocked || !isKycVerified ? 'opacity-50 cursor-not-allowed' : 'hover:border-[#4ADE80] hover:shadow-md'}`}>
                      <div className="w-12 h-12 bg-slate-50 text-slate-600 rounded-xl flex items-center justify-center group-hover:bg-[#4ADE80] group-hover:text-[#0C0E0D] transition-colors">
                          <Send size={24} />
                      </div>
                      <span className="font-bold text-slate-700 text-xs text-center uppercase tracking-wide">Pagar</span>
                  </button>

                  <button 
                      onClick={() => setIsReceiveModalOpen(true)}
                      className="bg-white p-6 rounded-2xl border border-slate-200 hover:border-[#4ADE80] hover:shadow-md transition-all flex flex-col items-center gap-3 group"
                  >
                      <div className="w-12 h-12 bg-slate-50 text-slate-600 rounded-xl flex items-center justify-center group-hover:bg-[#4ADE80] group-hover:text-[#0C0E0D] transition-colors">
                          <ArrowDownLeft size={24} />
                      </div>
                      <span className="font-bold text-slate-700 text-xs text-center uppercase tracking-wide">Cobrar</span>
                  </button>

                  <button onClick={() => { if(!handleActionRestricted()) setIsConvertModalOpen(true); }} className={`bg-white p-6 rounded-2xl border border-slate-200 transition-all flex flex-col items-center gap-3 group ${isBlocked || !isKycVerified ? 'opacity-50 cursor-not-allowed' : 'hover:border-[#4ADE80] hover:shadow-md'}`}>
                      <div className="w-12 h-12 bg-slate-50 text-slate-600 rounded-xl flex items-center justify-center group-hover:bg-[#4ADE80] group-hover:text-[#0C0E0D] transition-colors">
                          <RefreshCw size={24} />
                      </div>
                      <span className="font-bold text-slate-700 text-xs text-center uppercase tracking-wide">Convertir</span>
                  </button>

                  <button
                      onClick={() => setActiveView('servicios')}
                      className="bg-white p-6 rounded-2xl border border-slate-200 hover:border-[#4ADE80] hover:shadow-md transition-all flex flex-col items-center gap-3 group"
                  >
                      <div className="w-12 h-12 bg-slate-50 text-slate-600 rounded-xl flex items-center justify-center group-hover:bg-[#4ADE80] group-hover:text-[#0C0E0D] transition-colors">
                          <LayoutGrid size={24} />
                      </div>
                      <span className="font-bold text-slate-700 text-xs text-center uppercase tracking-wide">Servicios</span>
                  </button>

                  <button
                      onClick={() => setActiveView('otc')}
                      className="bg-white p-6 rounded-2xl border border-slate-200 hover:border-[#4ADE80] hover:shadow-md transition-all flex flex-col items-center gap-3 group"
                  >
                      <div className="w-12 h-12 bg-slate-50 text-slate-600 rounded-xl flex items-center justify-center group-hover:bg-[#4ADE80] group-hover:text-[#0C0E0D] transition-colors">
                          <TrendingUp size={24} />
                      </div>
                      <span className="font-bold text-slate-700 text-xs text-center uppercase tracking-wide">OTC</span>
                  </button>

                  <button
                      onClick={() => { if(!handleActionRestricted()) setIsPayLinkOpen(true); }}
                      className={`bg-white p-6 rounded-2xl border border-slate-200 transition-all flex flex-col items-center gap-3 group ${isBlocked || !isKycVerified ? 'opacity-50 cursor-not-allowed' : 'hover:border-[#4ADE80] hover:shadow-md'}`}
                  >
                      <div className="w-12 h-12 bg-slate-50 text-slate-600 rounded-xl flex items-center justify-center group-hover:bg-[#4ADE80] group-hover:text-[#0C0E0D] transition-colors">
                          <Link2 size={24} />
                      </div>
                      <span className="font-bold text-slate-700 text-xs text-center uppercase tracking-wide">Cobrar Link</span>
                  </button>
              </div>
          </section>

          {/* ... (Movements Section - kept same) ... */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm uppercase tracking-wider">
                      <History size={18} className="text-slate-400"/> Movimientos Recientes
                  </h3>
                  <button onClick={() => { setMovementsTab('all'); setActiveView('movements'); }} className="text-[#0C0E0D] text-sm font-bold hover:underline">Ver reporte completo</button>
              </div>
              <div className="divide-y divide-slate-50">
                  {movements.length > 0 ? movements.slice(0, 5).map(tx => (
                      <button key={tx.id} type="button" className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left" onClick={() => setSelectedTx(tx)}>
                          <div className="flex items-center gap-4">
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs ${tx.type === 'load' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                                  {tx.initials}
                              </div>
                              <div>
                                  <p className="font-bold text-slate-800 text-sm">{tx.title}</p>
                                  <p className="text-xs text-slate-400">{tx.date} • {tx.userName}</p>
                              </div>
                          </div>
                          <div className="text-right">
                              <p className={`font-bold text-sm ${tx.type === 'load' || tx.type === 'referral_payout' ? 'text-green-600' : 'text-slate-800'}`}>
                                  {tx.type === 'load' || tx.type === 'referral_payout' ? '+' : '-'} {formatMoney(tx.amount, tx.currency)}
                              </p>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${tx.status === 'Completado' ? 'bg-green-50 text-green-600' : tx.status === 'Pendiente' ? 'bg-orange-50 text-orange-600' : 'bg-red-50 text-red-600'}`}>
                                  {tx.status}
                              </span>
                          </div>
                      </button>
                  )) : (
                      <div className="p-10 text-center text-slate-400 text-sm">
                          <Activity size={32} className="mx-auto mb-2 opacity-30"/>
                          <p>No hay movimientos registrados en la cuenta empresa.</p>
                      </div>
                  )}
              </div>
          </section>
      </div>
  );

  const renderMovements = () => (
      <div className="space-y-6 animate-in fade-in duration-300">
          {/* ... same implementation ... */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
             {getFilteredMovements(null).map(tx => (
                 <button key={tx.id} type="button" className="w-full p-4 border-b border-slate-50 flex justify-between items-center hover:bg-slate-50 transition-colors text-left" onClick={() => setSelectedTx(tx)}>
                    <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs ${tx.type === 'load' || tx.type === 'referral_payout' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                            {tx.initials}
                        </div>
                        <div>
                            <p className="font-bold text-slate-800 text-sm">{tx.title}</p>
                            <p className="text-xs text-slate-400">{tx.date}</p>
                        </div>
                    </div>
                    <span className={`font-bold text-sm ${tx.type === 'load' || tx.type === 'referral_payout' ? 'text-green-600' : 'text-slate-800'}`}>
                        {tx.type === 'load' || tx.type === 'referral_payout' ? '+' : '-'} {formatMoney(tx.amount, tx.currency)}
                    </span>
                 </button>
             ))}
             {getFilteredMovements(null).length === 0 && <div className="p-12 text-center text-slate-400">No hay movimientos para mostrar.</div>}
          </div>
      </div>
  );

  // ... (renderWalletDetail, renderProfile, renderReferrals, renderAffiliates - same as previous) ...
  const renderWalletDetail = () => {
      // ... same implementation ... 
      if (!selectedWalletCode) return <div>Selecciona una billetera</div>;
      const wallet = myWallets.find(w => w.code === selectedWalletCode);
      const balance = getBalance(selectedWalletCode);
      return (
          <div className="space-y-6 animate-in fade-in duration-300 pt-6">
              <button onClick={() => setActiveView('dashboard')} className="flex items-center gap-2 text-slate-500 font-bold text-sm hover:text-[#0C0E0D]">
                  <ArrowLeft size={16} /> Volver al inicio
              </button>
              <div className="bg-gradient-to-br from-[#0C0E0D] to-[#0C0E0D] p-8 rounded-3xl text-white shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                  <div className="relative z-10">
                      <div className="flex justify-between items-start mb-8">
                          <div className="flex items-center gap-4">
                              <FlagImg code={wallet?.code ?? ''} className="w-14 h-10 object-cover rounded-lg shadow-md ring-2 ring-white/30" />
                              <div><h2 className="text-2xl font-bold">{wallet?.name}</h2><p className="text-green-200">{wallet?.type}</p></div>
                          </div>
                          <span className="bg-white/10 px-3 py-1 rounded-lg text-sm font-bold border border-white/20">{wallet?.code}</span>
                      </div>
                      <p className="text-5xl font-bold mb-8 tracking-tight">{formatMoney(balance, selectedWalletCode)}</p>
                      <div className="flex gap-4">
                          <button onClick={() => { if(!handleActionRestricted()) handleLoadClick(selectedWalletCode); }} disabled={isBlocked || !isKycVerified} className={`flex-1 text-[#0C0E0D] py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors ${isBlocked || !isKycVerified ? 'bg-slate-400 cursor-not-allowed opacity-70' : 'bg-[#4ADE80] hover:bg-[#22C55E]'}`}><Plus size={18} /> Cargar</button>
                          <button onClick={() => { if(!handleActionRestricted(true)) setIsSendModalOpen(true); }} disabled={isBlocked || !isKycVerified} className={`flex-1 text-white border py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors ${isBlocked || !isKycVerified ? 'bg-white/10 border-white/10 cursor-not-allowed opacity-70' : 'bg-white/10 border-white/20 hover:bg-white/20'}`}><Send size={18} /> Enviar</button>
                      </div>
                  </div>
              </div>
              {/* COP se divide en DOS SALDOS separados: Peso Lincoin (interno) y
                  BreB Lincoin (dispersión Bre-B vía Mouv — solo Colombia).
                  Se mueven entre sí con el formulario "Mover saldo". */}
              {selectedWalletCode === 'COP' && (() => {
                  const brebBal = getBalance('COP_BREB');
                  return (
                  <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-white rounded-2xl border border-slate-200 p-5">
                          <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                  <div className="w-9 h-9 rounded-xl bg-[#0C0E0D] flex items-center justify-center">
                                      <Wallet size={16} className="text-[#4ADE80]" />
                                  </div>
                                  <div>
                                      <p className="font-bold text-slate-800 text-sm">Peso Lincoin</p>
                                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Cuenta principal · COP</p>
                                  </div>
                              </div>
                              {mouvBal != null && (
                                  <span className="text-[9px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                                      ● Conectado a Mouv
                                  </span>
                              )}
                          </div>
                          <p className="text-2xl font-bold text-[#0C0E0D] font-mono">
                              {formatMoney(mouvBal ?? balance, 'COP')}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-1">
                              {mouvBal != null
                                  ? 'Saldo real de tu cuenta Mouv — es el que se usa para dispersar.'
                                  : mouvChecked
                                      ? 'Tu saldo interno Lincoin: cargas, envíos entre usuarios y conversiones.'
                                      : 'Saldo interno Lincoin · consultando Mouv…'}
                          </p>
                      </div>

                      <div className="bg-white rounded-2xl border-2 border-[#4ADE80]/40 p-5 relative overflow-hidden">
                          <div className="absolute -right-8 -top-8 w-28 h-28 bg-[#4ADE80]/10 rounded-full blur-2xl"></div>
                          <div className="flex items-center justify-between mb-2 relative z-10">
                              <div className="flex items-center gap-2">
                                  <div className="w-9 h-9 rounded-xl bg-[#4ADE80] flex items-center justify-center">
                                      <Zap size={16} className="text-[#0C0E0D]" />
                                  </div>
                                  <div>
                                      <p className="font-bold text-slate-800 text-sm">BreB Lincoin</p>
                                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Pagos instantáneos Bre-B · Solo Colombia</p>
                                  </div>
                              </div>
                              <span className="text-[9px] font-bold uppercase bg-[#4ADE80]/15 text-[#16A34A] px-2 py-0.5 rounded-full">Bre-B</span>
                          </div>
                          <p className="text-2xl font-bold text-[#0C0E0D] font-mono relative z-10">{formatMoney(brebBal, 'COP')}</p>
                          <p className="text-[11px] text-slate-600 mt-1 relative z-10">
                              Saldo para dispersar a cuentas bancarias en Colombia en segundos, por el riel Bre-B.
                          </p>
                          <div className="flex gap-2 mt-3 relative z-10">
                              <button
                                  onClick={() => { setBrebMoveOpen(!brebMoveOpen); setBrebDir('to_breb'); }}
                                  className="flex-1 py-2.5 rounded-xl bg-white border border-slate-300 text-[#0C0E0D] text-sm font-bold flex items-center justify-center gap-1.5 hover:bg-slate-50 transition-colors"
                              >
                                  <RefreshCw size={14} /> Mover saldo
                              </button>
                              <button
                                  onClick={() => setActiveView('mouv')}
                                  disabled={brebBal <= 0}
                                  className="flex-1 py-2.5 rounded-xl bg-[#4ADE80] hover:bg-[#6EE7A0] text-[#0C0E0D] text-sm font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                              >
                                  <Send size={14} /> Dispersar
                              </button>
                          </div>
                      </div>
                  </div>

                  {/* Mover saldo Peso ⇄ BreB */}
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
                  {getFilteredMovements(selectedWalletCode).map(tx => (
                       <button key={tx.id} type="button" className="w-full p-4 border-b border-slate-50 flex justify-between items-center hover:bg-slate-50 text-left" onClick={() => setSelectedTx(tx)}>
                           <div className="flex items-center gap-3">
                               <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${tx.type === 'load' || tx.type === 'referral_payout' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{tx.initials}</div>
                               <div><p className="font-bold text-slate-800 text-sm">{tx.title}</p><p className="text-xs text-slate-400">{tx.date}</p></div>
                           </div>
                           <span className={`font-bold text-sm ${tx.type === 'load' || tx.type === 'referral_payout' ? 'text-green-600' : 'text-slate-800'}`}>{tx.type === 'load' || tx.type === 'referral_payout' ? '+' : '-'} {formatMoney(tx.amount, tx.currency)}</span>
                       </button>
                  ))}
                  {getFilteredMovements(selectedWalletCode).length === 0 && <div className="p-12 text-center text-slate-400 text-sm">Sin movimientos recientes en {selectedWalletCode}</div>}
              </div>
          </div>
      );
  };

  const renderProfile = () => (<>
      <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
          <h2 className="text-2xl font-bold text-slate-800 mb-6">Perfil de Empresa</h2>
          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm text-center">
              <div className="w-24 h-24 bg-slate-100 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl font-bold text-slate-400">
                  {currentUser?.companyName?.substring(0, 2).toUpperCase() || 'EM'}
              </div>
              <h3 className="text-xl font-bold text-slate-800">{currentUser?.companyName}</h3>
              <p className="text-slate-500">{currentUser?.email}</p>
              
              <div className="mt-4 inline-flex items-center gap-2 bg-slate-50 border border-slate-200 px-4 py-2 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => {navigator.clipboard.writeText(currentUser?.ownReferralCode || currentUser?.id?.slice(-6).toUpperCase() || ''); showToast("Código copiado")}}>
                  <span className="text-xs text-slate-500 font-bold uppercase">ID de Usuario / Código:</span>
                  <span className="font-mono font-bold text-[#0C0E0D] text-lg">{currentUser?.ownReferralCode || currentUser?.id?.slice(-6).toUpperCase() || '—'}</span>
                  <Copy size={14} className="text-[#0C0E0D]" />
              </div>

              <div className="mt-6 flex justify-center gap-2 flex-wrap">
                  <span className="px-3 py-1 bg-slate-50 text-[#0C0E0D] rounded-full text-xs font-bold border border-slate-200">Cuenta Empresa</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                    isKycVerified ? 'bg-green-50 text-green-700 border-green-100' :
                    currentUser?.kycStatus === 'rejected' ? 'bg-red-50 text-red-700 border-red-100' :
                    currentUser?.kycStatus === 'in_review' ? 'bg-slate-50 text-[#4ADE80] border-slate-200' :
                    currentUser?.kycStatus === 'in_progress' ? 'bg-yellow-50 text-yellow-700 border-yellow-100' :
                    'bg-orange-50 text-orange-700 border-orange-100'
                  }`}>
                    {isKycVerified ? '✓ Identidad Verificada' :
                     currentUser?.kycStatus === 'rejected' ? '✗ Verificación Rechazada' :
                     currentUser?.kycStatus === 'in_review' ? '⏳ En Revisión' :
                     currentUser?.kycStatus === 'in_progress' ? '⏳ Verificación en Proceso' :
                     'KYC Pendiente'}
                  </span>
              </div>
              {!isKycVerified && (
                  <div className="mt-4">
                      <DiditKycButton userId={currentUser?.id} kycStatus={currentUser?.kycStatus} showToast={showToast} />
                  </div>
              )}
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 font-bold text-slate-800">Detalles de la Cuenta</div>
              <div className="p-6 space-y-4">
                  <div className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-500">Razón Social</span>
                      <span className="font-medium text-slate-800">{currentUser?.companyName || 'No registrado'}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-500">ID Tributario</span>
                      <span className="font-medium text-slate-800">{currentUser?.taxId || 'No registrado'}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-500">País de Registro</span>
                      <span className="font-medium text-slate-800">{currentUser?.country || 'No registrado'}</span>
                  </div>
              </div>
          </div>

          {/* 2FA Section */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 font-bold text-slate-800 flex items-center gap-2"><ShieldCheck size={18} className="text-[#0C0E0D]"/> Seguridad</div>
              <div className="p-6">
                  <div className="flex justify-between items-center">
                      <div>
                          <p className="font-medium text-slate-800 text-sm">Autenticador 2FA (TOTP)</p>
                          <p className="text-xs text-slate-500">Google Authenticator, Authy o cualquier app TOTP</p>
                          {!mfaEnrolled && <p className="text-xs text-orange-600 font-bold mt-0.5">⚠ Requerido para realizar transferencias</p>}
                      </div>
                      {mfaEnrolled ? (
                          <div className="flex items-center gap-2">
                              <span className="px-3 py-1 bg-green-50 text-green-700 border border-green-100 rounded-full text-xs font-bold">Activo</span>
                              <button onClick={() => setMfaDisableModalOpen(true)} className="px-3 py-1.5 text-xs font-bold border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors">Desactivar</button>
                          </div>
                      ) : (
                          <button onClick={handleOpenMFAEnroll} className="px-4 py-2 text-sm font-bold bg-[#0C0E0D] rounded-lg hover:bg-[#152e52] transition-colors">Activar</button>
                      )}
                  </div>
              </div>
          </div>

          {/* Zona de peligro */}
          <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-red-100 font-bold text-red-700 flex items-center gap-2">
                  <AlertTriangle size={18}/> Zona de peligro
              </div>
              <div className="p-6">
                  <div className="flex items-center justify-between mb-2">
                      <div>
                          <p className="font-medium text-red-700 text-sm">Eliminar cuenta</p>
                          <p className="text-xs text-slate-500">Esta acción es permanente e irreversible</p>
                      </div>
                      {!showDeleteAccountConfirm && (
                          <button onClick={() => setShowDeleteAccountConfirm(true)} className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
                              <Trash2 size={14}/> Eliminar cuenta
                          </button>
                      )}
                  </div>
                  {showDeleteAccountConfirm && (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                          <p className="text-sm font-bold text-red-700">⚠️ ¿Eliminar tu cuenta permanentemente?</p>
                          <p className="text-xs text-slate-600">Se eliminarán todos tus datos, transacciones y saldo. No podrás recuperarlos.</p>
                          <div className="flex gap-2">
                              <button
                                  onClick={async () => {
                                      setIsDeletingAccount(true);
                                      await Promise.race([
                                          deleteUser(currentUser!.id),
                                          new Promise(r => setTimeout(r, 12000)),
                                      ]).catch(() => {});
                                      logoutUser();
                                  }}
                                  disabled={isDeletingAccount}
                                  className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60"
                              >
                                  {isDeletingAccount ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin inline-block"/> : <Trash2 size={12}/>}
                                  {isDeletingAccount ? 'Eliminando...' : 'Sí, eliminar'}
                              </button>
                              <button onClick={() => setShowDeleteAccountConfirm(false)} className="px-4 py-2 text-sm font-bold border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
                                  Cancelar
                              </button>
                          </div>
                      </div>
                  )}
              </div>
          </div>
      </div>

      {/* 2FA ENROLLMENT MODAL */}
      {mfaModalOpen && mfaEnrollData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 animate-in zoom-in-95 relative overflow-y-auto max-h-[90vh]">
                  <button onClick={() => { setMfaModalOpen(false); setMfaEnrollData(null); }} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20}/></button>
                  <div className="text-center mb-6">
                      <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3"><ShieldCheck size={24} className="text-[#0C0E0D]"/></div>
                      <h3 className="text-xl font-bold text-[#0C0E0D]">Activar verificación en 2 pasos</h3>
                  </div>
                  <div className="flex items-start gap-3 mb-4 p-3 bg-slate-50 rounded-xl">
                      <span className="w-6 h-6 bg-[#0C0E0D] text-white rounded-full text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                      <div>
                          <p className="text-sm font-bold text-slate-700">Abre Google Authenticator o Authy</p>
                          <p className="text-xs text-slate-500">Toca "+" → "Escanear código QR" y apunta la cámara al código de abajo</p>
                      </div>
                  </div>
                  <div className="flex flex-col items-center mb-4">
                      <div className="bg-white border-2 border-slate-200 rounded-xl p-3 mb-2"><img src={mfaEnrollData.qrCode} alt="QR 2FA" className="w-48 h-48" /></div>
                      <p className="text-xs text-slate-400 mb-1">¿No puedes escanear? Ingresa este código manual:</p>
                      <code className="bg-slate-100 text-slate-700 font-mono text-xs px-3 py-2 rounded-lg tracking-widest break-all text-center select-all">{mfaEnrollData.secret}</code>
                  </div>
                  <div className="flex items-start gap-3 mb-3 p-3 bg-green-50 rounded-xl">
                      <span className="w-6 h-6 bg-green-600 text-white rounded-full text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
                      <p className="text-sm font-bold text-slate-700">Ingresa el código de 6 dígitos que aparece en la app</p>
                  </div>
                  {mfaVerifyError && <p className="text-red-500 text-sm text-center mb-3">{mfaVerifyError}</p>}
                  <input type="text" inputMode="numeric" maxLength={6} value={mfaVerifyCode} onChange={(e) => setMfaVerifyCode(e.target.value.replace(/\D/g, ''))} className="w-full h-14 text-center text-2xl font-bold tracking-[0.4em] border-2 border-slate-200 rounded-xl focus:border-[#0C0E0D] outline-none mb-4 bg-slate-50" placeholder="000000" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleVerifyMFAEnrollment()} />
                  <button onClick={handleVerifyMFAEnrollment} disabled={mfaVerifyCode.length !== 6 || mfaVerifyLoading} className="w-full h-12 bg-[#0C0E0D] font-bold rounded-xl disabled:opacity-50 hover:bg-[#152e52] transition-colors">
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
                  <p className="text-slate-500 text-sm mb-6">¿Estás seguro? No podrás hacer transferencias sin reactivarlo.</p>
                  <div className="flex gap-3">
                      <button onClick={() => setMfaDisableModalOpen(false)} className="flex-1 h-11 border border-slate-200 text-slate-600 font-bold rounded-lg hover:bg-slate-50 transition-colors">Cancelar</button>
                      <button onClick={handleDisableMFA} className="flex-1 h-11 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors">Desactivar</button>
                  </div>
              </div>
          </div>
      )}
  </>);

  const renderReferrals = () => (
      <div className="animate-in fade-in duration-300">
          <div className="bg-[#0C0E0D] rounded-3xl p-8 md:p-12 text-white text-center mb-8 relative overflow-hidden">
               <div className="relative z-10">
                   <h2 className="text-3xl font-bold mb-4">Invita y Gana $20 USD</h2>
                   <p className="text-green-100 max-w-lg mx-auto mb-8">
                       Comparte tu código con socios o empresas amigas. 
                       <br/>Gana <span className="text-[#4ADE80] font-bold">$20 USD</span> cuando operen sus primeros $1,000 USD.
                       <br/>Además, recibe <span className="text-[#4ADE80] font-bold">{config.referralCommission}%</span> de cada operación de por vida.
                   </p>
                   <div className="bg-white/10 p-4 rounded-xl max-w-md mx-auto flex items-center gap-4 backdrop-blur-sm border border-white/20">
                       <code className="flex-1 font-mono text-xl font-bold text-white tracking-widest">{currentUser?.ownReferralCode || currentUser?.id?.slice(-6).toUpperCase() || '—'}</code>
                       <button onClick={() => {navigator.clipboard.writeText(currentUser?.ownReferralCode || ''); showToast("Código copiado")}} className="bg-white text-[#0C0E0D] px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-50">Copiar</button>
                   </div>
               </div>
               <div className="absolute top-0 right-0 w-64 h-64 bg-[#4ADE80]/20 rounded-full blur-3xl translate-x-1/2 -translate-y-1/2"></div>
               <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl -translate-x-1/2 translate-y-1/2"></div>
          </div>
          {/* ... stats grid ... */}
          {/* ... referrals table ... */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wider flex items-center gap-2">
                      <Users size={18} className="text-[#0C0E0D]"/> Tu Equipo de Referidos
                  </h3>
              </div>
              <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-xs">
                          <tr>
                              <th className="px-6 py-4">Usuario</th>
                              <th className="px-6 py-4">Progreso Bono $20</th>
                              <th className="px-6 py-4 text-center">Volumen Total</th>
                              <th className="px-6 py-4 text-center">Comisiones Generadas</th>
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
                                                  <p className="text-[10px] text-slate-400">ID: {ref.ownReferralCode}</p>
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
                                              {progress >= 100 && <span className="text-[10px] text-[#4ADE80] font-bold mt-1 block">¡Bono Completado!</span>}
                                          </div>
                                      </td>
                                      <td className="px-6 py-4 text-center font-bold text-slate-700">
                                          $ {formatMoney(volume, 'USD')}
                                      </td>
                                      <td className="px-6 py-4 text-center">
                                          <span className="text-green-600 font-bold bg-green-50 px-2 py-1 rounded text-xs">
                                              Recurrente: {config.referralCommission}%
                                          </span>
                                      </td>
                                      <td className="px-6 py-4 text-right">
                                          <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${ref.hasTriggeredBonus ? 'bg-purple-100 text-purple-700' : 'bg-slate-50 text-[#4ADE80]'}`}>
                                              {ref.hasTriggeredBonus ? 'Ganando Comisiones' : 'En camino a Bono'}
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
      <div className="animate-in fade-in duration-300 text-center py-12">
          {/* ... same implementation ... */}
          <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 text-[#0C0E0D]">
              <Megaphone size={32} />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-4">Programa de Aliados</h2>
          <p className="text-slate-500 max-w-lg mx-auto mb-8">
              Si eres contador, abogado o asesor financiero, únete a nuestro programa de partners y gestiona las finanzas de tus clientes con beneficios exclusivos.
          </p>
          <button className="bg-[#0C0E0D] px-8 py-3 rounded-xl font-bold hover:bg-[#152e52] transition-colors">
              Contactar para Alianza
          </button>
      </div>
  );

  const renderSeguros = () => {
    const PAISES = [
      { pais: 'Colombia',  oblig: 'SOAT',   oblig_desc: 'Seguro Obligatorio de Accidentes de Tránsito',   todo: 'Todo Riesgo' },
      { pais: 'Chile',     oblig: 'SOAP',   oblig_desc: 'Seguro Obligatorio de Accidentes Personales',    todo: 'Todo Riesgo' },
      { pais: 'Perú',      oblig: 'SOAT',   oblig_desc: 'Seguro Obligatorio de Accidentes de Tránsito',   todo: 'Todo Riesgo' },
      { pais: 'México',    oblig: 'Seguro RC', oblig_desc: 'Seguro de Responsabilidad Civil (obligatorio)', todo: 'Amplia Cobertura' },
      { pais: 'Argentina', oblig: 'Seguro RC', oblig_desc: 'Responsabilidad Civil obligatoria',             todo: 'Todo Riesgo' },
    ];
    const paisData = PAISES.find(p => p.pais === segPais) || PAISES[0];

    const CORP_PRODUCTS = [
      { label: 'Seguro de Flota',      desc: 'Cubre todos los vehículos de tu empresa en una sola póliza.',  icon: Car },
      { label: 'Seguro de Carga',      desc: 'Protección para mercancías en tránsito nacional e internacional.', icon: Tag },
      { label: 'Responsabilidad Civil', desc: 'Cobertura ante daños a terceros por operaciones de la empresa.', icon: ShieldCheck },
      { label: 'Seguro de Viaje Corp.', desc: 'Asistencia médica y de viaje para empleados en el exterior.', icon: Plane },
    ];

    return (
      <div className="pt-6 space-y-4 animate-in fade-in duration-300">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => { setActiveView('servicios'); setSegSolicitado(false); }} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold text-sm">
            <ArrowLeft size={18}/> Servicios
          </button>
          <h2 className="text-xl font-bold text-[#0C0E0D]">Seguros Lincoin</h2>
        </div>

        {/* Hero */}
        <div className="relative bg-gradient-to-br from-rose-600 to-rose-900 rounded-3xl p-6 text-white overflow-hidden">
          <div className="absolute right-0 top-0 w-40 h-40 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"/>
          <p className="text-rose-200 font-bold text-xs uppercase tracking-widest mb-1">Protección vehicular y empresarial</p>
          <h3 className="text-2xl font-bold mb-1">Asegúrate con Lincoin</h3>
          <p className="text-rose-200 text-sm">Paga tu seguro directamente desde tu saldo. Disponible en 5 países.</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {[{ id: 'vehicular', label: 'Vehicular' }, { id: 'empresarial', label: 'Empresarial' }].map(t => (
            <button key={t.id} onClick={() => { setSegTab(t.id as any); setSegSolicitado(false); }}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm border-2 transition-colors ${segTab === t.id ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-500 bg-white'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {segTab === 'vehicular' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
            {/* País */}
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">País</label>
              <select value={segPais} onChange={e => setSegPais(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-rose-400 bg-white">
                {PAISES.map(p => <option key={p.pais} value={p.pais}>{p.pais}</option>)}
              </select>
            </div>

            {/* Tipo de seguro */}
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Tipo de seguro</label>
              <div className="space-y-2">
                <button onClick={() => setSegTipo('soat')}
                  className={`w-full p-4 rounded-xl border-2 text-left transition-colors ${segTipo === 'soat' ? 'border-rose-500 bg-rose-50' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-slate-800 text-sm">{paisData.oblig}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{paisData.oblig_desc}</p>
                    </div>
                    <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Obligatorio</span>
                  </div>
                </button>
                <button onClick={() => setSegTipo('todoriesgo')}
                  className={`w-full p-4 rounded-xl border-2 text-left transition-colors ${segTipo === 'todoriesgo' ? 'border-rose-500 bg-rose-50' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-slate-800 text-sm">{paisData.todo}</p>
                      <p className="text-xs text-slate-500 mt-0.5">Cobertura completa: daños propios, robo, terceros</p>
                    </div>
                    <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Recomendado</span>
                  </div>
                </button>
                <button onClick={() => setSegTipo('ambos')}
                  className={`w-full p-4 rounded-xl border-2 text-left transition-colors ${segTipo === 'ambos' ? 'border-rose-500 bg-rose-50' : 'border-slate-200'}`}>
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{paisData.oblig} + {paisData.todo}</p>
                    <p className="text-xs text-slate-500 mt-0.5">Pack completo con el mejor precio</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Placa */}
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Placa del vehículo</label>
              <input value={segPlaca} onChange={e => setSegPlaca(e.target.value.toUpperCase())} placeholder="Ej: ABC123"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono font-bold tracking-widest uppercase focus:outline-none focus:border-rose-400"/>
            </div>

            <button onClick={() => setSegSolicitado(true)} disabled={!segPlaca}
              className="w-full bg-rose-600 text-white py-3.5 rounded-xl font-bold text-base disabled:opacity-40 disabled:cursor-not-allowed hover:bg-rose-700 transition-colors flex items-center justify-center gap-2">
              <ShieldCheck size={18}/> Solicitar cotización
            </button>
          </div>
        )}

        {segTab === 'empresarial' && (
          <div className="space-y-3">
            {CORP_PRODUCTS.map(({ label, desc, icon: Icon }) => (
              <div key={label} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-start gap-4 hover:border-rose-300 hover:shadow-md transition-all cursor-pointer group"
                onClick={() => setSegSolicitado(true)}>
                <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Icon size={22}/>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-bold text-slate-800 text-sm">{label}</h3>
                    <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full ml-2">Cotizar</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {segSolicitado && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center space-y-3 animate-in fade-in duration-300">
            <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto">
              <ShieldCheck size={28} className="text-rose-600"/>
            </div>
            <h3 className="font-bold text-slate-800">¡Solicitud recibida!</h3>
            <p className="text-slate-500 text-sm">Nuestro equipo de seguros te enviará la cotización en menos de 2 horas. El pago se realiza desde tu saldo Lincoin.</p>
            <button onClick={() => setSegSolicitado(false)} className="mt-2 px-6 py-2.5 bg-[#0C0E0D] rounded-xl font-bold text-sm hover:bg-[#152e52] transition-colors">
              Nueva cotización
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderTravel = () => {
    const tabs = [
      { id: 'vuelos',  label: 'Vuelos',  icon: Plane },
      { id: 'hoteles', label: 'Hoteles', icon: Hotel },
      { id: 'autos',   label: 'Autos',   icon: Car },
    ] as const;
    return (
      <div className="pt-6 space-y-4 animate-in fade-in duration-300">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => { setActiveView('servicios'); setTravelSearched(false); }} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold text-sm">
            <ArrowLeft size={18}/> Servicios
          </button>
          <h2 className="text-xl font-bold text-[#0C0E0D]">Lincoin Travel</h2>
        </div>

        {/* Hero */}
        <div className="relative bg-gradient-to-br from-[#0C0E0D] to-[#0C0E0D] rounded-3xl p-6 text-white overflow-hidden">
          <div className="absolute right-0 top-0 w-40 h-40 bg-[#4ADE80]/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"/>
          <p className="text-[#4ADE80] font-bold text-xs uppercase tracking-widest mb-1">Corporativo</p>
          <h3 className="text-2xl font-bold mb-1">Viaja más, gasta menos</h3>
          <p className="text-green-200 text-sm">Vuelos, hoteles y autos para tu empresa con tarifas preferenciales.</p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex border-b border-slate-100">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => { setTravelTab(id); setTravelSearched(false); }}
                className={`flex-1 flex items-center justify-center gap-2 py-3.5 font-bold text-sm transition-colors ${travelTab === id ? 'text-[#0C0E0D] border-b-2 border-[#4ADE80] bg-slate-50' : 'text-slate-400 hover:text-slate-600'}`}>
                <Icon size={16}/>{label}
              </button>
            ))}
          </div>

          <div className="p-5 space-y-4">
            {travelTab === 'vuelos' && (
              <>
                <div className="flex gap-2">
                  {(['idavuelta', 'ida'] as const).map(t => (
                    <button key={t} onClick={() => setTravelType(t)}
                      className={`px-4 py-1.5 rounded-full text-xs font-bold border-2 transition-colors ${travelType === t ? 'border-[#4ADE80] bg-[#4ADE80]/10 text-[#0C0E0D]' : 'border-slate-200 text-slate-500'}`}>
                      {t === 'idavuelta' ? 'Ida y vuelta' : 'Solo ida'}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative">
                    <MapPin size={16} className="absolute left-3 top-3.5 text-slate-400"/>
                    <input value={travelOrigin} onChange={e => setTravelOrigin(e.target.value)} placeholder="Origen" className="w-full pl-9 pr-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#4ADE80]"/>
                  </div>
                  <div className="relative">
                    <MapPin size={16} className="absolute left-3 top-3.5 text-slate-400"/>
                    <input value={travelDest} onChange={e => setTravelDest(e.target.value)} placeholder="Destino" className="w-full pl-9 pr-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#4ADE80]"/>
                  </div>
                  <div className="relative">
                    <Calendar size={16} className="absolute left-3 top-3.5 text-slate-400"/>
                    <input type="date" value={travelDateOut} onChange={e => setTravelDateOut(e.target.value)} className="w-full pl-9 pr-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#4ADE80] text-slate-600"/>
                  </div>
                  {travelType === 'idavuelta' && (
                    <div className="relative">
                      <Calendar size={16} className="absolute left-3 top-3.5 text-slate-400"/>
                      <input type="date" value={travelDateIn} onChange={e => setTravelDateIn(e.target.value)} className="w-full pl-9 pr-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#4ADE80] text-slate-600"/>
                    </div>
                  )}
                  <div className="relative col-span-2">
                    <Users2 size={16} className="absolute left-3 top-3.5 text-slate-400"/>
                    <select value={travelPax} onChange={e => setTravelPax(Number(e.target.value))} className="w-full pl-9 pr-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#4ADE80] text-slate-600 appearance-none bg-white">
                      {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n} pasajero{n > 1 ? 's' : ''}</option>)}
                    </select>
                  </div>
                </div>
              </>
            )}

            {travelTab === 'hoteles' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="relative col-span-2">
                  <MapPin size={16} className="absolute left-3 top-3.5 text-slate-400"/>
                  <input value={travelHotelDest} onChange={e => setTravelHotelDest(e.target.value)} placeholder="Ciudad o hotel" className="w-full pl-9 pr-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#4ADE80]"/>
                </div>
                <div className="relative">
                  <Calendar size={16} className="absolute left-3 top-3.5 text-slate-400"/>
                  <input type="date" value={travelHotelIn} onChange={e => setTravelHotelIn(e.target.value)} className="w-full pl-9 pr-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#4ADE80] text-slate-600"/>
                </div>
                <div className="relative">
                  <Calendar size={16} className="absolute left-3 top-3.5 text-slate-400"/>
                  <input type="date" value={travelHotelOut} onChange={e => setTravelHotelOut(e.target.value)} className="w-full pl-9 pr-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#4ADE80] text-slate-600"/>
                </div>
                <div className="relative col-span-2">
                  <Hotel size={16} className="absolute left-3 top-3.5 text-slate-400"/>
                  <select value={travelRooms} onChange={e => setTravelRooms(Number(e.target.value))} className="w-full pl-9 pr-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#4ADE80] text-slate-600 appearance-none bg-white">
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} habitación{n > 1 ? 'es' : ''}</option>)}
                  </select>
                </div>
              </div>
            )}

            {travelTab === 'autos' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="relative col-span-2">
                  <MapPin size={16} className="absolute left-3 top-3.5 text-slate-400"/>
                  <input placeholder="Ciudad de recogida" className="w-full pl-9 pr-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#4ADE80]"/>
                </div>
                <div className="relative">
                  <Calendar size={16} className="absolute left-3 top-3.5 text-slate-400"/>
                  <input type="date" className="w-full pl-9 pr-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#4ADE80] text-slate-600"/>
                </div>
                <div className="relative">
                  <Calendar size={16} className="absolute left-3 top-3.5 text-slate-400"/>
                  <input type="date" className="w-full pl-9 pr-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#4ADE80] text-slate-600"/>
                </div>
              </div>
            )}

            <button onClick={() => setTravelSearched(true)}
              className="w-full bg-[#4ADE80] text-[#0C0E0D] py-3.5 rounded-xl font-bold text-base hover:bg-[#00b396] transition-colors flex items-center justify-center gap-2">
              <Search size={18}/> Buscar
            </button>
          </div>
        </div>

        {travelSearched && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center space-y-3 animate-in fade-in duration-300">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
              <Plane size={28} className="text-green-600"/>
            </div>
            <h3 className="font-bold text-slate-800">¡Casi listo!</h3>
            <p className="text-slate-500 text-sm">Nuestro equipo de travel corporativo revisará tu solicitud y te enviará las mejores opciones en menos de 2 horas hábiles.</p>
            <p className="text-xs text-slate-400">El pago se realizará directamente desde tu saldo Lincoin.</p>
            <button onClick={() => setTravelSearched(false)} className="mt-2 px-6 py-2.5 bg-[#0C0E0D] rounded-xl font-bold text-sm hover:bg-[#152e52] transition-colors">
              Nueva búsqueda
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderServicios = () => {
    const SERVICES = [
      { icon: Users,        label: 'Nómina',              desc: 'Paga sueldos locales e internacionales en un clic.',            color: 'bg-slate-50 text-[#4ADE80]', action: undefined },
      { icon: Plane,        label: 'Travel Corporativo',  desc: 'Vuelos, hoteles y autos para tu equipo al mejor precio.',      color: 'bg-slate-50 text-green-700', action: () => setActiveView('travel') },
      { icon: CreditCard,   label: 'Tarjeta Virtual',     desc: 'Tarjeta corporativa virtual para pagos en línea.',             color: 'bg-violet-50 text-violet-700', action: undefined },
      { icon: BarChart3,    label: 'API Empresarial',     desc: 'Integra Lincoin directamente en tu plataforma o ERP.',         color: 'bg-orange-50 text-orange-700', action: undefined },
      { icon: ShieldCheck,  label: 'Seguros',             desc: 'SOAT, Todo Riesgo y seguros corporativos para tu flota.',     color: 'bg-rose-50 text-rose-700', action: () => setActiveView('seguros') },
    ];
    return (
      <div className="pt-6 space-y-6 animate-in fade-in duration-300">
        <div className="flex items-center gap-3">
          <button onClick={() => setActiveView('dashboard')} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold text-sm">
            <ArrowLeft size={18}/> Volver
          </button>
          <h2 className="text-xl font-bold text-[#0C0E0D]">Servicios Empresariales</h2>
        </div>
        <p className="text-slate-500 text-sm">Servicios premium disponibles para cuentas empresariales verificadas. Solicita activación al equipo de soporte.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SERVICES.map(({ icon: Icon, label, desc, color, action }) => (
            <div key={label} onClick={action} className={`bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-start gap-4 hover:border-[#4ADE80] hover:shadow-md transition-all group ${action ? 'cursor-pointer' : ''}`}>
              <div className={`w-12 h-12 rounded-xl ${color} flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform`}>
                <Icon size={22}/>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-bold text-slate-800 text-sm">{label}</h3>
                  {action
                    ? <span className="text-[10px] font-bold bg-slate-100 text-green-700 px-2 py-0.5 rounded-full shrink-0 ml-2 flex items-center gap-1"><ArrowRight size={10}/> Abrir</span>
                    : <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full shrink-0 ml-2">Solicitar</span>
                  }
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-[#0C0E0D] rounded-2xl p-6 text-white text-center">
          <Handshake size={32} className="mx-auto mb-3 text-[#4ADE80]"/>
          <h3 className="font-bold text-lg mb-1">¿Necesitas un servicio personalizado?</h3>
          <p className="text-green-200 text-sm mb-4">Nuestro equipo diseña soluciones a medida para tu empresa.</p>
          <a href="mailto:soporte@cuypay.com" className="inline-flex items-center gap-2 bg-[#4ADE80] text-[#0C0E0D] font-bold px-6 py-2.5 rounded-xl hover:bg-[#00b396] transition-colors text-sm">
            Contactar a soporte
          </a>
        </div>
      </div>
    );
  };

  const renderOTC = () => {
      const isEnabled = currentUser?.otcEnabled === true;
      const usdtRate = config.otcUsdtRate ?? 0.995;
      const usdcRate = config.otcUsdcRate ?? 0.998;
      const selectedRate = otcCoin === 'USDT' ? usdtRate : usdcRate;
      const parsedAmt = parseFloat(otcAmount) || 0;
      const usdResult = parsedAmt * selectedRate;
      const walletKey = otcNetwork[otcCoin] ?? (otcCoin === 'USDT' ? 'USDT_TRON' : 'USDC_BSC');
      const walletData = otcWallets[walletKey];
      const _bals = (currentUser?.balances as Record<string, number>) ?? {};
      // Read network-specific key first (USDT_BSC), fall back to generic (USDT)
      const walletBal = _bals[walletKey] ?? _bals[otcCoin] ?? walletData?.balance ?? 0;
      const walletAddr = walletData?.address ?? '';
      const walletLoading = walletData?.loading ?? false;
      const currentNets = OTC_NETWORKS[otcCoin] ?? [];
      const currentNetInfo = currentNets.find(n => n.key === walletKey) ?? currentNets[0];
      const withdrawNetKey = otcWithdrawNetwork[otcCoin] ?? (otcCoin === 'USDT' ? 'USDT_TRON' : 'USDC_BSC');
      const withdrawNetInfo = currentNets.find(n => n.key === withdrawNetKey) ?? currentNets[0];

      if (!isEnabled) {
          return (
              <div className="pt-6 max-w-lg mx-auto text-center space-y-6 animate-in fade-in duration-300">
                  <button onClick={() => setActiveView('dashboard')} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold text-sm mb-2">
                      <ArrowLeft size={18}/> Volver al inicio
                  </button>
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-10 flex flex-col items-center gap-5">
                      <div className="w-20 h-20 rounded-full bg-[#0C0E0D] flex items-center justify-center">
                          <TrendingUp size={36} className="text-[#4ADE80]"/>
                      </div>
                      <div>
                          <h2 className="text-2xl font-bold text-[#0C0E0D] mb-2">Mesa OTC</h2>
                          <p className="text-slate-500 text-sm leading-relaxed">
                              Opera con <span className="font-bold text-[#0C0E0D]">USDT y USDC</span> a tasas preferenciales exclusivas para empresas. Conversiones rápidas, liquidez inmediata.
                          </p>
                      </div>
                      <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-4 text-left">
                          <p className="text-amber-800 font-bold text-sm mb-1">Servicio bajo solicitud</p>
                          <p className="text-amber-700 text-xs">Este servicio no está habilitado por defecto. Contacta a nuestro equipo de soporte para activarlo en tu cuenta empresarial.</p>
                      </div>
                      <a
                          href="mailto:soporte@cuypay.com"
                          className="w-full bg-[#0C0E0D] text-white py-4 rounded-2xl font-bold text-base hover:bg-[#152e52] transition-colors flex items-center justify-center gap-2"
                      >
                          <Handshake size={20}/> Solicitar Acceso OTC
                      </a>
                  </div>
              </div>
          );
      }

      return (
          <div className="pt-6 space-y-5 animate-in fade-in duration-300">
              {/* Header */}
              <div className="flex items-center gap-3">
                  <button onClick={() => setActiveView('dashboard')} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold text-sm">
                      <ArrowLeft size={18}/> Volver
                  </button>
                  <h2 className="text-xl font-bold text-[#0C0E0D]">Mesa OTC</h2>
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded-full">Activo</span>
                  <button
                      onClick={handleOtcRefresh}
                      disabled={otcRefreshing}
                      className="ml-auto flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-[#4ADE80] transition-colors disabled:opacity-40"
                      title="Actualizar saldos"
                  >
                      <RefreshCw size={13} className={otcRefreshing ? 'animate-spin' : ''}/>
                      {otcRefreshing ? 'Actualizando...' : 'Actualizar'}
                  </button>
              </div>

              {/* Coin selector */}
              <div className="flex gap-3">
                  {(['USDT', 'USDC'] as const).map(coin => {
                      const key = otcNetwork[coin] ?? (coin === 'USDT' ? 'USDT_TRON' : 'USDC_BSC');
                      const w = otcWallets[key];
                      const bal = w?.balance ?? 0;
                      const loading = w?.loading ?? false;
                      const rate = coin === 'USDT' ? usdtRate : usdcRate;
                      return (
                          <button
                              key={coin}
                              onClick={() => setOtcCoin(coin)}
                              className={`flex-1 p-4 rounded-2xl border-2 text-left transition-all ${otcCoin === coin ? 'border-[#4ADE80] bg-[#4ADE80]/5' : 'border-slate-200 bg-white'}`}
                          >
                              <div className="flex items-center gap-2 mb-2">
                                  {coin === 'USDT' ? (
                                      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                                          <circle cx="16" cy="16" r="16" fill="#26A17B"/>
                                          <path d="M17.922 17.383v-.002c-.11.008-.677.042-1.942.042-1.01 0-1.721-.03-1.971-.042v.003c-3.888-.171-6.79-.848-6.79-1.658 0-.809 2.902-1.486 6.79-1.66v2.644c.254.018.982.061 1.988.061 1.207 0 1.812-.05 1.925-.06v-2.643c3.88.173 6.775.85 6.775 1.658 0 .81-2.895 1.485-6.775 1.657m0-3.59v-2.366h5.414V7.819H8.595v3.608h5.414v2.365c-4.4.202-7.709 1.074-7.709 2.126 0 1.053 3.309 1.924 7.709 2.126v7.608h3.913v-7.61c4.393-.202 7.694-1.073 7.694-2.124 0-1.051-3.301-1.922-7.694-2.125" fill="white"/>
                                      </svg>
                                  ) : (
                                      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                                          <circle cx="16" cy="16" r="16" fill="#2775CA"/>
                                          <path d="M20.022 18.124c0-2.124-1.28-2.852-3.84-3.156-1.828-.243-2.193-.728-2.193-1.578 0-.85.61-1.396 1.828-1.396 1.097 0 1.707.364 2.01 1.275a.458.458 0 00.427.303h.973a.44.44 0 00.44-.44v-.06a3.04 3.04 0 00-2.743-2.489V9.5a.46.46 0 00-.46-.46h-.915a.46.46 0 00-.46.46v1.04c-1.645.242-2.693 1.338-2.693 2.76 0 2.002 1.218 2.791 3.778 3.095 1.707.303 2.255.668 2.255 1.639 0 .97-.85 1.638-2.01 1.638-1.585 0-2.133-.667-2.315-1.578a.444.444 0 00-.44-.364h-1.034a.44.44 0 00-.44.44v.06c.244 1.578 1.28 2.73 3.354 3.034v1.06a.46.46 0 00.46.46h.915a.46.46 0 00.46-.46v-1.04c1.645-.303 2.693-1.46 2.693-2.94z" fill="white"/>
                                          <path d="M13.17 23.096c-3.657-1.305-5.547-5.39-4.244-9.047a6.93 6.93 0 014.244-4.244.477.477 0 00.303-.45V8.33a.457.457 0 00-.577-.44c-4.55 1.397-7.058 6.12-5.66 10.67a8.865 8.865 0 005.66 5.66.457.457 0 00.577-.44v-1.024a.503.503 0 00-.303-.46zM19.13 7.89a.457.457 0 00-.578.44v1.024c0 .182.122.364.304.45a6.93 6.93 0 014.244 4.244c1.303 3.657-.588 7.742-4.245 9.047a.477.477 0 00-.303.46v1.023a.457.457 0 00.578.44c4.55-1.396 7.058-6.12 5.66-10.67A8.956 8.956 0 0019.13 7.89z" fill="white"/>
                                      </svg>
                                  )}
                                  <span className="font-bold text-slate-700 text-sm">{coin}</span>
                              </div>
                              {loading ? (
                                  <Loader2 size={16} className="animate-spin text-slate-400"/>
                              ) : (
                                  <p className="text-lg font-bold text-[#0C0E0D]">{bal.toLocaleString('es', {minimumFractionDigits:2, maximumFractionDigits:2})}</p>
                              )}
                              <p className="text-xs text-slate-400">1 {coin} = {rate} USD</p>
                          </button>
                      );
                  })}
              </div>

              {/* Unified network selector — applies to both Deposit and Withdraw */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                  <p className="text-xs font-bold text-slate-400 uppercase mb-3">Red blockchain</p>
                  <div className="flex gap-2">
                      {currentNets.map(net => {
                          const isSelected = walletKey === net.key;
                          const netColors: Record<string, string> = {
                              'USDT_TRON':  'bg-red-500',
                              'USDT_BSC':   'bg-yellow-400',

                              'USDC_BSC':   'bg-yellow-400',
                          };
                          return (
                              <button
                                  key={net.key}
                                  onClick={() => {
                                      setOtcNetwork(prev => ({ ...prev, [otcCoin]: net.key }));
                                      setOtcWithdrawNetwork(prev => ({ ...prev, [otcCoin]: net.key }));
                                      loadOtcWallet(net.key);
                                      setOtcWithdrawAddress('');
                                  }}
                                  className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold border-2 transition-all flex items-center justify-center gap-1.5 ${isSelected ? 'border-[#0C0E0D] bg-[#0C0E0D]' : 'border-slate-200 text-slate-600 bg-white hover:border-slate-300'}`}
                              >
                                  <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-white' : netColors[net.key] ?? 'bg-slate-400'}`}/>
                                  {net.label}
                              </button>
                          );
                      })}
                  </div>
                  <p className="text-xs text-slate-400 mt-2">
                      <span className="font-bold">Comisión:</span> {OTC_NETWORK_FEES[walletKey] ?? 'Variable'}
                  </p>
              </div>

              {/* Tabs */}
              <div className="flex bg-slate-100 rounded-xl p-1">
                  {(['deposit', 'withdraw', 'convert', 'history'] as const).map(tab => (
                      <button
                          key={tab}
                          onClick={() => setOtcTab(tab)}
                          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${otcTab === tab ? 'bg-white text-[#0C0E0D] shadow-sm' : 'text-slate-500'}`}
                      >
                          {tab === 'deposit' ? 'Depositar' : tab === 'withdraw' ? 'Retirar' : tab === 'convert' ? 'Convertir' : 'Historial'}
                      </button>
                  ))}
              </div>

              {/* DEPOSIT TAB */}
              {otcTab === 'deposit' && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                      <div>
                          <p className="font-bold text-slate-700 mb-1">
                              Tu dirección {otcCoin}
                              <span className="ml-1 font-normal text-slate-400 text-xs">({currentNetInfo?.label})</span>
                          </p>
                          <p className="text-xs text-slate-500 mb-3">Envía {otcCoin} a esta dirección. Los fondos se acreditarán tras la confirmación en blockchain.</p>
                          {walletLoading ? (
                              <div className="flex items-center gap-2 p-4 bg-slate-50 rounded-xl">
                                  <Loader2 size={16} className="animate-spin text-slate-400"/>
                                  <span className="text-sm text-slate-400">Generando dirección...</span>
                              </div>
                          ) : walletAddr ? (
                              <div className="space-y-4">
                                  {/* QR Code */}
                                  <div className="flex flex-col items-center bg-white border-2 border-slate-100 rounded-2xl p-4">
                                      <img
                                          src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(walletAddr)}&size=200x200&margin=12&color=0B1B32`}
                                          alt={`QR ${otcCoin}`}
                                          className="w-48 h-48 rounded-xl"
                                      />
                                      <p className="text-[10px] text-slate-400 mt-2 font-medium uppercase tracking-wide">{otcCoin} — {currentNetInfo?.label}</p>
                                  </div>
                                  {/* Address */}
                                  <div className="p-4 bg-slate-50 rounded-xl">
                                      <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Dirección</p>
                                      <code className="text-sm font-mono text-slate-700 break-all block mb-3">{walletAddr}</code>
                                      <button
                                          onClick={() => { navigator.clipboard.writeText(walletAddr); showToast('Dirección copiada'); }}
                                          className="flex items-center gap-1.5 text-xs font-bold text-[#0C0E0D] hover:underline"
                                      >
                                          <Copy size={12}/> Copiar dirección
                                      </button>
                                  </div>
                              </div>
                          ) : (
                              <div className="p-4 bg-red-50 rounded-xl space-y-3">
                                  <p className="text-xs font-bold text-red-700">Error al cargar dirección</p>
                                  <p className="text-xs text-red-600 font-mono break-all">
                                    {walletData
                                      ? (walletData.error || 'Sin dirección generada — contacta soporte')
                                      : 'No se pudo iniciar la carga. Presiona Reintentar.'}
                                  </p>
                                  <button
                                    onClick={() => {
                                      setOtcWallets(prev => { const n = {...prev}; delete n[walletKey]; return n; });
                                      setTimeout(() => loadOtcWallet(walletKey), 50);
                                    }}
                                    className="text-xs font-bold text-red-700 underline"
                                  >
                                    Reintentar
                                  </button>
                              </div>
                          )}
                      </div>
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                          <p className="text-amber-800 font-bold text-xs mb-0.5">Importante</p>
                          <p className="text-amber-700 text-xs">Solo envíes {otcCoin} en la red <strong>{currentNetInfo?.label}</strong>. Envíos en otras redes se perderán sin recuperación.</p>
                      </div>
                  </div>
              )}

              {/* WITHDRAW TAB */}
              {otcTab === 'withdraw' && (() => {
                const maxWithdraw = walletBal;
                const pct = (p: number) => setOtcAmount((maxWithdraw * p / 100).toFixed(6).replace(/\.?0+$/, ''));
                const selectedPct = maxWithdraw > 0 ? Math.round((parsedAmt / maxWithdraw) * 100) : 0;
                return (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
                      {/* Amount */}
                      <div>
                          <div className="flex items-center justify-between mb-2">
                              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Monto de retiro</label>
                              <div className="flex items-center gap-2">
                                  <span className="text-xs text-slate-400">Disponible: <span className="font-bold text-slate-700">{walletBal.toLocaleString('es', {minimumFractionDigits:2, maximumFractionDigits:8})} {otcCoin}</span></span>
                                  <button
                                      onClick={() => pct(100)}
                                      className="text-xs font-bold text-[#4ADE80] bg-slate-50 px-2.5 py-1 rounded-lg hover:bg-slate-100 active:scale-95 transition-all duration-150"
                                  >Máx</button>
                              </div>
                          </div>
                          {/* Amount input */}
                          <div className="relative">
                              <input
                                  type="number"
                                  value={otcAmount}
                                  onChange={e => setOtcAmount(e.target.value)}
                                  placeholder="0.00"
                                  className="w-full border-2 border-slate-200 rounded-xl px-4 py-3.5 text-2xl font-bold focus:outline-none focus:border-[#4ADE80] transition-colors pr-20"
                              />
                              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">{otcCoin}</span>
                          </div>
                          {parsedAmt > 0 && (PLATFORM_WITHDRAW_FEES[withdrawNetKey] ?? 0) > 0 && (
                              <div className="mt-2 flex items-center justify-between text-xs text-slate-500 px-1 animate-in fade-in duration-200">
                                  <span>Comisión red</span>
                                  <span className="font-semibold text-orange-500">−{PLATFORM_WITHDRAW_FEES[withdrawNetKey]} {otcCoin}</span>
                              </div>
                          )}
                          {parsedAmt > 0 && (
                              <div className="mt-1 flex items-center justify-between text-xs px-1 animate-in fade-in duration-200">
                                  <span className="text-slate-500">Recibirás</span>
                                  <span className="font-bold text-[#0C0E0D]">{Math.max(0, parsedAmt - (PLATFORM_WITHDRAW_FEES[withdrawNetKey] ?? 0)).toFixed(6).replace(/\.?0+$/, '')} {otcCoin}</span>
                              </div>
                          )}
                      </div>
                      {/* Destination */}
                      <div>
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">
                              Dirección destino · <span className="font-normal normal-case text-slate-400">{currentNetInfo?.label}</span>
                          </label>
                          <div className="flex gap-2">
                              <input
                                  type="text"
                                  value={otcWithdrawAddress}
                                  onChange={e => setOtcWithdrawAddress(e.target.value)}
                                  placeholder={currentNetInfo?.placeholder ?? '0x...'}
                                  className="flex-1 border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-[#4ADE80] transition-colors"
                              />
                              <button
                                  type="button"
                                  onClick={startQrScanner}
                                  className="flex items-center justify-center w-12 h-12 rounded-xl border-2 border-slate-200 bg-slate-50 hover:bg-slate-100 active:scale-95 transition-all text-slate-600"
                                  title="Escanear QR"
                              >
                                  <QrCode size={20} />
                              </button>
                          </div>
                      </div>
                      <button
                          disabled={parsedAmt <= 0 || parsedAmt > walletBal || !otcWithdrawAddress.trim() || otcWithdrawSending}
                          onClick={handleOtcWithdraw}
                          className="w-full bg-[#0C0E0D] py-4 rounded-2xl font-bold text-base disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#152e52] active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-2 shadow-lg shadow-slate-900/10"
                      >
                          {otcWithdrawSending ? <Loader2 size={18} className="animate-spin"/> : <Send size={18}/>}
                          {otcWithdrawSending ? 'Procesando en blockchain...' : `Retirar ${otcCoin}`}
                      </button>
                      <p className="text-xs text-slate-400 text-center">Retiro automático · confirmación en ~1 minuto</p>
                  </div>
                );
              })()}

              {/* CONVERT TAB */}
              {/* HISTORY TAB */}
              {otcTab === 'history' && (() => {
                  const otcTxs = movements.filter(tx =>
                      ['otc_withdraw', 'otc_withdraw_request', 'otc_deposit', 'otc_convert_request'].includes(tx.type)
                  );
                  const typeLabel: Record<string, string> = {
                      otc_deposit:          '↓ Depósito cripto',
                      otc_withdraw:         '↑ Retiro cripto',
                      otc_withdraw_request: '↑ Retiro (pendiente)',
                      otc_convert_request:  '⇄ Conversión cripto',
                  };
                  const typeColor: Record<string, string> = {
                      otc_deposit: 'text-green-600',
                      otc_withdraw: 'text-red-500',
                      otc_withdraw_request: 'text-orange-500',
                      otc_convert_request: 'text-[#4ADE80]',
                  };
                  return (
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                          {otcTxs.length === 0 ? (
                              <div className="p-10 text-center text-slate-400 text-sm">No hay movimientos cripto aún.</div>
                          ) : (
                              <div className="divide-y divide-slate-100">
                                  {otcTxs.slice(0, 30).map(tx => {
                                      const raw = tx as any;
                                      const txHash: string = raw.txHash ?? '';
                                      const net: string = raw.walletKey ?? tx.currency ?? '';
                                      const dt = raw.sentAt ?? raw.requestedAt ?? raw.createdAt;
                                      const dateStr = dt ? new Date(dt).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'2-digit' }) : tx.date ?? '';
                                      const explorers: Record<string, string> = {
                                          USDT_TRON:  'https://tronscan.org/#/transaction/',
                                          USDT_BSC:   'https://bscscan.com/tx/',
                                          USDC_BSC:   'https://bscscan.com/tx/',
                                      };
                                      const explorerUrl = txHash ? (explorers[net] ?? '') + txHash : '';
                                      const statusStyle = tx.status === 'Completado' || tx.status === 'completed'
                                          ? 'bg-green-50 text-green-700'
                                          : tx.status === 'Pendiente' || tx.status === 'pending'
                                          ? 'bg-orange-50 text-orange-600'
                                          : 'bg-slate-50 text-slate-500';
                                      return (
                                          <div key={tx.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                                              <div className="flex-1 min-w-0">
                                                  <p className={`text-sm font-bold ${typeColor[tx.type] ?? 'text-slate-700'}`}>
                                                      {typeLabel[tx.type] ?? tx.type}
                                                  </p>
                                                  <p className="text-xs text-slate-400">{net} · {dateStr}</p>
                                                  {explorerUrl && (
                                                      <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
                                                          className="text-[10px] text-[#0C0E0D] font-mono hover:underline truncate block max-w-[200px]">
                                                          {txHash.slice(0,20)}...
                                                      </a>
                                                  )}
                                              </div>
                                              <div className="text-right ml-3 flex-shrink-0">
                                                  <p className="font-bold text-slate-800 text-sm">{tx.amount.toLocaleString('es', {minimumFractionDigits:2})} {WALLET_CURRENCY[net] ?? tx.currency}</p>
                                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${statusStyle}`}>{tx.status}</span>
                                              </div>
                                          </div>
                                      );
                                  })}
                              </div>
                          )}
                      </div>
                  );
              })()}

              {otcTab === 'convert' && (() => {
                  const allPairs: any[] = config.otcFiatPairs ?? [];
                  const availPairs = allPairs.filter((p: any) => p.enabled && p.pair.startsWith(otcCoin));
                  const selectedPair = availPairs.find((p: any) => p.pair === `${otcCoin}_${otcConvertTarget}`);
                  const parsedAmt2 = parseFloat(otcAmount) || 0;
                  const convertResult = selectedPair ? parsedAmt2 * selectedPair.rate : 0;
                  const bals2 = currentUser?.balances as Record<string, number> ?? {};
                  // Balance stored as walletKey ('USDT_BSC') or coin name ('USDT') — try both
                  const availBal2 = bals2[walletKey] ?? bals2[otcCoin] ?? walletData?.balance ?? 0;
                  const exceedsBalance = parsedAmt2 > availBal2;
                  return (
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                          <div>
                              <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Monto {otcCoin} a convertir</label>
                              <div className="relative">
                                  <input
                                      type="number"
                                      value={otcAmount}
                                      onChange={e => { setOtcAmount(e.target.value); setOtcConvertError(''); }}
                                      placeholder="0.00"
                                      className={`w-full border rounded-xl px-4 py-3 text-lg font-bold focus:outline-none pr-20 ${exceedsBalance ? 'border-red-400 focus:border-red-400' : 'border-slate-200 focus:border-[#4ADE80]'}`}
                                  />
                                  <button
                                      onClick={() => { setOtcAmount(availBal2.toFixed(6).replace(/\.?0+$/, '')); setOtcConvertError(''); }}
                                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#4ADE80] bg-slate-50 px-2.5 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                                  >Máx</button>
                              </div>
                              <div className="flex items-center justify-between mt-1">
                                  <p className="text-xs text-slate-400">Disponible: {walletLoading ? '...' : availBal2.toLocaleString('es', {minimumFractionDigits:2})} {otcCoin}</p>
                                  {exceedsBalance && <p className="text-xs text-red-500 font-bold">Saldo no disponible</p>}
                              </div>
                              {otcConvertError && <p className="text-xs text-red-500 font-bold mt-1">{otcConvertError}</p>}
                          </div>

                          <div>
                              <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Recibir en</label>
                              <div className="grid grid-cols-3 gap-2">
                                  {availPairs.length === 0 && (
                                      <p className="col-span-3 text-xs text-slate-400 text-center py-3">No hay pares activos para {otcCoin}. Contacta al administrador.</p>
                                  )}
                                  {availPairs.map((p: any) => {
                                      const fiat = p.pair.split('_')[1];
                                      return (
                                          <button
                                              key={p.pair}
                                              onClick={() => setOtcConvertTarget(fiat)}
                                              className={`py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${otcConvertTarget === fiat ? 'border-[#4ADE80] bg-[#4ADE80]/10 text-[#0C0E0D]' : 'border-slate-200 text-slate-600'}`}
                                          >
                                              {fiat}
                                          </button>
                                      );
                                  })}
                              </div>
                          </div>

                          {selectedPair && parsedAmt2 > 0 && (
                              <div className="bg-[#0C0E0D] rounded-xl p-4 flex justify-between items-center">
                                  <div>
                                      <p className="text-green-300 text-xs">Recibes</p>
                                      <p className="text-white font-bold text-2xl">{convertResult.toLocaleString('es', {minimumFractionDigits:2, maximumFractionDigits:2})} {otcConvertTarget}</p>
                                  </div>
                                  <div className="text-right">
                                      <p className="text-green-300 text-xs">Tasa OTC</p>
                                      <p className="text-[#4ADE80] font-bold">1 {otcCoin} = {selectedPair.rate.toLocaleString('es')} {otcConvertTarget}</p>
                                  </div>
                              </div>
                          )}

                          <button
                              disabled={parsedAmt2 <= 0 || exceedsBalance || !otcConvertTarget || otcConvertSending}
                              onClick={handleOtcConvert}
                              className="w-full bg-[#4ADE80] text-[#0C0E0D] py-4 rounded-2xl font-bold text-base disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#00b396] transition-colors flex items-center justify-center gap-2"
                          >
                              {otcConvertSending ? <Loader2 size={18} className="animate-spin"/> : <ArrowLeftRight size={18}/>}
                              {otcConvertSending ? 'Procesando...' : `Convertir ${otcCoin} → ${otcConvertTarget || '?'}`}
                          </button>
                          <p className="text-xs text-slate-400 text-center">La conversión es inmediata. El saldo {otcConvertTarget || 'fiat'} se acredita al instante.</p>
                      </div>
                  );
              })()}
          </div>
      );
  };

  const TX_LABELS: Record<string, string> = {
    convert: 'Conversión de divisas',
    load: 'Carga de saldo',
    send: 'Envío / Retiro',
    pay_sent: 'Pago Lincoin enviado',
    pay_received: 'Pago Lincoin recibido',
    referral_payout: 'Bono de referido',
    referral_commission: 'Comisión de referido',
    internal: 'Movimiento interno',
  };

  const renderTxDetail = () => {
    if (!selectedTx) return null;
    const tx = selectedTx;
    const dt = tx.createdAt ? new Date(tx.createdAt) : null;
    const dateStr = dt
      ? dt.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })
      : (tx.date || '');
    const timeStr = dt
      ? dt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
      : '';
    const isCredit = tx.type === 'load' || tx.type === 'pay_received' || tx.type === 'referral_payout' || tx.type === 'referral_commission';
    const rawData = tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : tx;
    const targetAmount = tx.targetAmount ?? rawData.targetAmount;
    const targetCurrency = tx.targetCurrency ?? rawData.targetCurrency;
    const txFee = tx.fee ?? rawData.fee;
    const couponCode = tx.couponCode ?? rawData.couponCode;
    const rate = targetAmount != null && tx.amount > 0 ? (targetAmount / tx.amount) : null;
    const statusColor = tx.status === 'Completado' ? 'text-green-600' : tx.status === 'Pendiente' ? 'text-orange-500' : 'text-red-500';
    const fields: { label: string; value: string }[] = [
      { label: 'Descripción', value: TX_LABELS[tx.type] || tx.title || tx.type },
      { label: 'Estado', value: tx.status },
      { label: 'Fecha', value: timeStr ? `${dateStr} · ${timeStr}` : dateStr },
      ...(tx.type === 'convert' && targetCurrency ? [{ label: 'Par de conversión', value: `${tx.currency} → ${targetCurrency}` }] : []),
      ...(tx.type === 'convert' && rate != null ? [{ label: 'Tasa de cambio', value: `1 ${tx.currency} = ${rate.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${targetCurrency}` }] : []),
      ...(tx.type === 'convert' && targetAmount != null ? [{ label: 'Monto recibido', value: `${formatMoney(targetAmount, targetCurrency || '')} ${targetCurrency || ''}` }] : []),
      ...(tx.type === 'convert' && txFee != null ? [{ label: 'Comisión cobrada', value: `${formatMoney(txFee, tx.currency)} ${tx.currency}` }] : []),
      ...(tx.type === 'convert' && couponCode ? [{ label: 'Cupón', value: couponCode }] : []),
      ...(tx.type === 'pay_sent' && tx.recipientName ? [{ label: 'Destinatario', value: tx.recipientName }] : []),
      ...(tx.type === 'pay_received' && tx.senderName ? [{ label: 'Remitente', value: tx.senderName }] : []),
      ...(tx.type === 'send' && tx.bank ? [{ label: 'Banco / Método', value: tx.bank }] : []),
      ...(tx.type === 'send' && tx.beneficiary ? [{ label: 'Beneficiario', value: tx.beneficiary }] : []),
      ...(tx.type === 'send' && tx.account ? [{ label: 'Número de cuenta', value: tx.account }] : []),
      ...(tx.type === 'send' && tx.reason ? [{ label: 'Motivo', value: tx.reason }] : []),
      ...(tx.type === 'load' && tx.method ? [{ label: 'Método', value: tx.method }] : []),
      { label: 'Referencia', value: String(tx.id) },
    ];
    return (
      <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm"
        onClick={() => setSelectedTx(null)}
      >
        <div
          className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex justify-center pt-3 pb-1 sm:hidden">
            <div className="w-10 h-1 bg-slate-200 rounded-full" />
          </div>
          {/* Logo + title */}
          <div className="flex flex-col items-center pt-6 pb-4 px-6">
            <div className="flex items-center gap-0.5 mb-2">
              <span className="text-2xl font-black text-[#0C0E0D] tracking-tight">CUY</span>
              <span className="text-2xl font-black text-[#4ADE80] tracking-tight">PAY</span>
            </div>
            <p className="text-base font-bold text-slate-800">Resumen de movimiento</p>
          </div>
          {/* Amount */}
          <div className="mx-6 mb-5 rounded-2xl bg-[#F4F6F9] p-4 text-center">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">
              {isCredit ? 'Monto recibido' : 'Monto debitado'}
            </p>
            <p className={`text-4xl font-black ${isCredit ? 'text-green-600' : 'text-[#0C0E0D]'}`}>
              {isCredit ? '+' : '-'}{formatMoney(tx.amount, tx.currency)}
            </p>
            <p className="text-sm text-slate-400 font-bold mt-0.5">{tx.currency}</p>
          </div>
          {/* Fields */}
          <div className="px-6 pb-4 space-y-0">
            {fields.map((f, i) => (
              <div key={f.label} className={`py-3 ${i < fields.length - 1 ? 'border-b border-slate-100' : ''}`}>
                <p className="text-xs font-bold text-[#0C0E0D] mb-0.5">{f.label}</p>
                <p className={`font-bold text-sm ${f.label === 'Estado' ? statusColor : 'text-slate-800'}`}>{f.value}</p>
              </div>
            ))}
          </div>
          {/* Footer */}
          <div className="px-6 pt-2 pb-8">
            <button type="button" onClick={() => setSelectedTx(null)} className="w-full h-12 bg-[#0C0E0D] hover:bg-[#152e52] font-bold rounded-xl transition-colors text-sm">
              Listo
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans">
      
      {toastMessage && (
          <div className="fixed top-6 right-6 z-[70] bg-[#0C0E0D] text-white px-6 py-3 rounded-lg shadow-xl flex items-center gap-3 animate-in slide-in-from-top-4 fade-in max-w-md">
              <CheckCircle size={20} className="text-[#4ADE80]" />
              <span className="font-medium text-sm">{toastMessage}</span>
          </div>
      )}

      <Sidebar 
        isOpen={sidebarOpen} 
        activeView={activeView}
        onNavigate={(view) => { 
            if (view === 'enviar') { if(!handleActionRestricted(true)) setIsSendModalOpen(true); return; }
            if (view === 'convertir') { if(!handleActionRestricted()) setIsConvertModalOpen(true); return; }
            setActiveView(view as any); 
            setSidebarOpen(false); 
        }}
        onLogout={onLogout}
      />
      
      <Header 
        onMenuClick={() => setSidebarOpen(!sidebarOpen)} 
        onLogout={onLogout}
        onNavigate={(view) => setActiveView(view as any)}
      />

      <main className="pt-20 pb-12 px-4 md:px-8 transition-all duration-300 lg:ml-64">
        <div className="max-w-6xl mx-auto min-h-[calc(100vh-160px)]">
          {activeView === 'dashboard' && renderDashboard()}
          {activeView === 'movements' && renderMovements()}
          {activeView === 'wallet-detail' && renderWalletDetail()}
          {activeView === 'profile' && renderProfile()}
          {activeView === 'referrals' && renderReferrals()}
          {activeView === 'affiliates' && renderAffiliates()}
          {activeView === 'otc' && renderOTC()}
          {activeView === 'servicios' && renderServicios()}
          {activeView === 'travel' && renderTravel()}
          {activeView === 'seguros' && renderSeguros()}
          {activeView === 'mouv' && currentUser?.id && (
              <MouvSection
                  userId={currentUser.id}
                  brebBalance={getBalance('COP_BREB')}
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
                                  userName: currentUser.companyName || currentUser.name,
                              },
                          });
                      } catch { /* saldo ya debitado; el registro es best-effort */ }
                  }}
              />
          )}
        </div>
      </main>

      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

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

      {/* ... (Other modals: Feature, Receive, Load, Send - kept same) ... */}
      
      {/* ... Receive Modal ... */}
      {isReceiveModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <h3 className="font-bold text-lg text-slate-800">Recibir Pagos</h3>
                      <button onClick={() => setIsReceiveModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors"><X size={20}/></button>
                  </div>
                  
                  <div className="p-6 space-y-6">
                      <p className="text-sm text-slate-500 text-center">
                          Comparte estos datos con tus clientes para recibir pagos internacionales o locales directamente en tu cuenta.
                      </p>

                      <div className="bg-[#F8FAFC] border border-slate-200 rounded-xl p-4">
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Selecciona la moneda a recibir</label>
                          <select 
                              value={receiveCurrency}
                              onChange={(e) => setReceiveCurrency(e.target.value)}
                              className="w-full h-12 border border-slate-300 rounded-lg px-4 bg-white font-bold text-slate-800 focus:border-[#0C0E0D] outline-none"
                          >
                              <option value="USD">USD - Dólar (Internacional)</option>
                              <option value="CLP">CLP - Peso Chileno</option>
                              <option value="COP">COP - Peso Colombiano</option>
                              <option value="PEN">PEN - Sol Peruano</option>
                              <option value="EUR">EUR - Euro (SEPA)</option>
                          </select>
                      </div>

                      {/* Dynamic Bank Details based on Selection */}
                      <div className="space-y-3">
                          <div className="flex justify-between items-center py-2 border-b border-slate-100">
                              <span className="text-slate-500 text-xs font-bold uppercase">Beneficiario</span>
                              <span className="font-bold text-slate-800 text-sm text-right">LINCOIN {receiveCurrency === 'USD' ? 'LLC' : 'SAS'}</span>
                          </div>
                          <div className="flex justify-between items-center py-2 border-b border-slate-100">
                              <span className="text-slate-500 text-xs font-bold uppercase">Banco</span>
                              <span className="font-bold text-slate-800 text-sm text-right">{receiveCurrency === 'USD' ? 'Community Federal Savings Bank' : receiveCurrency === 'COP' ? 'Bancolombia' : 'Santander'}</span>
                          </div>
                          <div className="flex justify-between items-center py-2 border-b border-slate-100">
                              <span className="text-slate-500 text-xs font-bold uppercase">Número de Cuenta</span>
                              <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-800 text-sm text-right">{receiveCurrency === 'USD' ? '1234567890' : '9876543210'}</span>
                                  <button onClick={() => showToast("Número de cuenta copiado")} className="text-[#0C0E0D] hover:bg-slate-50 p-1 rounded"><Copy size={14}/></button>
                              </div>
                          </div>
                          {receiveCurrency === 'USD' && (
                              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                                  <span className="text-slate-500 text-xs font-bold uppercase">Routing / ACH</span>
                                  <div className="flex items-center gap-2">
                                      <span className="font-bold text-slate-800 text-sm text-right">026073150</span>
                                      <button onClick={() => showToast("Routing copiado")} className="text-[#0C0E0D] hover:bg-slate-50 p-1 rounded"><Copy size={14}/></button>
                                  </div>
                              </div>
                          )}
                          <div className="bg-slate-50 p-3 rounded-lg text-xs text-[#4ADE80] flex gap-2 items-start mt-4">
                              <Share2 size={16} className="shrink-0 mt-0.5" />
                              <p>Al recibir transferencias, recuerda que debes notificar el ingreso en la sección "Fondear" para acreditar tu saldo.</p>
                          </div>
                      </div>

                      <button onClick={() => { showToast("Datos copiados al portapapeles"); setIsReceiveModalOpen(false); }} className="w-full py-4 bg-[#0C0E0D] font-bold rounded-xl hover:bg-[#152e52] shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2">
                          <Copy size={18}/> Copiar Datos Completos
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* ... Load Modal ... (kept same) */}
      {isLoadModalOpen && (
          // ... same modal structure ...
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <h3 className="font-bold text-lg text-slate-800">Cargar Saldo Empresa</h3>
                      <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors"><X size={20}/></button>
                  </div>
                  {/* ... content same as previous ... */}
                  <div className="p-6 overflow-y-auto">
                      {/* ... load steps ... */}
                      {loadStep === 1 && (
                          <div className="space-y-4">
                              <p className="text-sm text-slate-500 mb-2">Selecciona el país desde donde transfieres:</p>
                              {Object.keys(bankingOptions).map(country => (
                                  <button key={country} onClick={() => { setSelectedCountry(country); setLoadStep(2); }} className="w-full flex items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-[#0C0E0D] hover:bg-slate-50 transition-all group">
                                      <span className="font-bold text-slate-700 group-hover:text-[#0C0E0D]">{country}</span>
                                      <ChevronDown className="text-slate-300 group-hover:text-[#0C0E0D]"/>
                                  </button>
                              ))}
                          </div>
                      )}
                      {/* ... other steps ... */}
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
                              <button onClick={handleAmountConfirm} className="w-full py-4 bg-[#0C0E0D] font-bold rounded-xl hover:bg-[#152e52] shadow-lg transition-transform active:scale-95">Continuar</button>
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
                              <button onClick={handleLoadSubmit} className="w-full py-4 bg-[#0C0E0D] font-bold rounded-xl hover:bg-[#152e52] shadow-lg transition-transform active:scale-95">
                                  Notificar Transferencia
                              </button>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {/* ... Send Modal ... (kept same) */}
      {isSendModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                      <h3 className="font-bold text-xl text-slate-800">
                          {sendStep === 1 && "Enviar Pago"}
                          {sendStep === 2 && sendMode === 'pay' && "ID Lincoin del destinatario"}
                          {sendStep === 2 && sendMode === 'bank' && "Datos del Beneficiario"}
                          {sendStep === 3 && sendMode === 'bank' && "Confirmar Pago"}
                          {sendStep === 2 && sendMode === 'cash' && "Datos del Receptor"}
                          {sendStep === 3 && sendMode === 'cash' && "Confirmar Retiro"}
                          {sendStep === 4 && (sendMode === 'cash' ? "¡Retiro Solicitado!" : "Pago Exitoso")}
                      </h3>
                      {sendStep !== 4 && <button onClick={closeSendModal} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200 transition-colors"><X size={20}/></button>}
                  </div>
                  <div className="p-6 overflow-y-auto">
                      {/* STEP 1: Amount + Mode selection */}
                      {sendStep === 1 && (
                          <div className="space-y-5">
                              <div>
                                  <label className="block text-sm font-bold text-slate-700 mb-2">Monto a enviar</label>
                                  <div className="relative">
                                      <input type="text" value={sendForm.amount} onChange={(e) => setSendForm({...sendForm, amount: formatInputNumber(e.target.value)})} className="w-full h-16 pl-4 pr-20 text-3xl font-bold text-slate-900 border border-slate-300 rounded-xl focus:border-[#0C0E0D] focus:ring-1 focus:ring-[#0C0E0D] outline-none" placeholder="0" autoFocus />
                                      <select value={sendForm.destinationCurrency} onChange={(e) => setSendForm({...sendForm, destinationCurrency: e.target.value})} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 font-bold text-sm bg-slate-100 border-0 rounded-lg px-2 py-1 outline-none cursor-pointer">
                                          {CONVERSION_CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                                      </select>
                                  </div>
                              </div>
                              <div>
                                  <label className="block text-sm font-bold text-slate-700 mb-2">¿Cómo deseas enviar?</label>
                                  <div className="grid grid-cols-3 gap-2">
                                      <button onClick={() => { if (!getRawAmount(sendForm.amount)) { showToast('Ingresa un monto'); return; } setSendMode('pay'); setSendStep(2); }} className="flex flex-col items-center gap-2 p-3 py-4 border-2 border-green-200 bg-green-50 rounded-xl hover:border-green-400 hover:bg-green-100 transition-all">
                                          <Send size={20} className="text-green-600"/>
                                          <span className="font-bold text-xs text-green-800">ID Lincoin</span>
                                          <span className="text-[10px] text-green-600 text-center leading-tight">Instantáneo entre usuarios</span>
                                      </button>
                                      <button onClick={() => { if (!getRawAmount(sendForm.amount)) { showToast('Ingresa un monto'); return; } setSendMode('bank'); setSendStep(2); }} className="flex flex-col items-center gap-2 p-3 py-4 border-2 border-slate-200 bg-slate-50 rounded-xl hover:border-[#0C0E0D] hover:bg-slate-100 transition-all">
                                          <Building2 size={20} className="text-[#0C0E0D]"/>
                                          <span className="font-bold text-xs text-[#0C0E0D]">Banco / Cuenta</span>
                                          <span className="text-[10px] text-[#4ADE80] text-center leading-tight">Transferencia bancaria</span>
                                      </button>
                                      <button onClick={() => { if (!getRawAmount(sendForm.amount)) { showToast('Ingresa un monto'); return; } setSendMode('cash'); setSendStep(2); }} className="flex flex-col items-center gap-2 p-3 py-4 border-2 border-orange-200 bg-orange-50 rounded-xl hover:border-orange-400 hover:bg-orange-100 transition-all">
                                          <MapPin size={20} className="text-orange-600"/>
                                          <span className="font-bold text-xs text-orange-800">Punto Físico</span>
                                          <span className="text-[10px] text-orange-600 text-center leading-tight">Retiro en efectivo</span>
                                      </button>
                                  </div>
                              </div>
                          </div>
                      )}
                      {/* STEP 2 PAY: Lincoin ID lookup */}
                      {sendStep === 2 && sendMode === 'pay' && (
                          <div className="space-y-5">
                              <button onClick={() => { setSendStep(1); setSendMode(null); setPayRecipientCode(''); setPayRecipientUser(null); setPayLookupStatus('idle'); }} className="text-xs text-slate-400 flex items-center gap-1 hover:text-slate-600 font-bold"><ArrowLeft size={12}/> Volver</button>
                              <div className="bg-green-50 border border-green-100 p-3 rounded-xl text-center">
                                  <p className="text-sm font-bold text-green-800">Enviando <span className="text-green-600">{formatMoney(getRawAmount(sendForm.amount), sendForm.destinationCurrency)}</span> instantáneamente</p>
                              </div>
                              <div>
                                  <label className="block text-sm font-bold text-slate-700 mb-2">ID Lincoin del destinatario</label>
                                  <input type="text" value={payRecipientCode} onChange={(e) => handlePayLookup(e.target.value)} placeholder="Ej: ABC123" maxLength={8} autoFocus className="w-full h-14 px-4 border-2 border-slate-300 rounded-xl focus:border-green-500 outline-none text-xl font-mono font-bold tracking-widest text-center uppercase" />
                                  <p className="text-xs text-slate-400 mt-1 text-center">El ID de 6 caracteres que el destinatario puede compartir contigo</p>
                              </div>
                              {payLookupStatus === 'found' && payRecipientUser && (
                                  <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3 animate-in slide-in-from-bottom-2 duration-200">
                                      <div className="w-12 h-12 bg-green-600 rounded-full flex items-center justify-center text-white font-extrabold text-xl flex-shrink-0">{(payRecipientUser.name || payRecipientUser.companyName || '?').charAt(0).toUpperCase()}</div>
                                      <div className="flex-1 min-w-0"><p className="text-[10px] text-green-600 font-bold uppercase tracking-wide">Destinatario encontrado</p><p className="font-bold text-slate-800 truncate">{payRecipientUser.name || payRecipientUser.companyName || payRecipientUser.email}</p></div>
                                      <CheckCircle size={22} className="text-green-500 flex-shrink-0" />
                                  </div>
                              )}
                              {payLookupStatus === 'not_found' && payRecipientCode.length >= 4 && (
                                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center"><p className="text-sm text-red-600 font-bold">No se encontró ningún usuario con ese ID</p></div>
                              )}
                              <button onClick={handlePaySubmit} disabled={payLookupStatus !== 'found' || isPaySending} className="w-full h-12 bg-green-600 text-white font-bold rounded-xl disabled:opacity-50 hover:bg-green-700 transition-colors flex items-center justify-center gap-2">
                                  {isPaySending ? <Loader2 className="animate-spin" size={20}/> : <><Send size={18}/> Enviar ahora</>}
                              </button>
                          </div>
                      )}
                      {/* STEP 2 BANK: Beneficiary details */}
                      {sendStep === 2 && sendMode === 'bank' && (
                          <div className="space-y-4">
                              <button onClick={() => { setSendStep(1); setSendMode(null); }} className="text-xs text-slate-400 flex items-center gap-1 hover:text-slate-600 mb-2 font-bold"><ArrowLeft size={12}/> Volver</button>
                              <div className="flex gap-2 p-1 bg-slate-100 rounded-lg mb-2">
                                  <button onClick={() => setSendForm({...sendForm, beneficiaryType: 'business'})} className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${sendForm.beneficiaryType === 'business' ? 'bg-white text-[#0C0E0D] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Empresa</button>
                                  <button onClick={() => setSendForm({...sendForm, beneficiaryType: 'personal'})} className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${sendForm.beneficiaryType === 'personal' ? 'bg-white text-[#0C0E0D] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Persona</button>
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre / Razón Social</label>
                                  <input type="text" value={sendForm.beneficiaryName} onChange={(e) => setSendForm({...sendForm, beneficiaryName: e.target.value})} className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-[#0C0E0D] outline-none text-sm"/>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                  <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo Doc.</label><select className="w-full h-11 px-3 border border-slate-300 rounded-lg bg-white"><option>Selecc.</option></select></div>
                                  <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Número ID</label><input type="text" className="w-full h-11 px-3 border border-slate-300 rounded-lg"/></div>
                              </div>
                              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cuenta</label><input type="text" value={sendForm.accountNumber} onChange={(e)=>setSendForm({...sendForm, accountNumber: e.target.value})} className="w-full h-11 px-3 border border-slate-300 rounded-lg"/></div>
                              <button onClick={() => setSendStep(3)} className="w-full h-12 bg-[#0C0E0D] font-bold rounded-lg hover:bg-[#152e52] mt-4 flex items-center justify-center gap-2 shadow-lg">Revisar Datos</button>
                          </div>
                      )}
                      {/* STEP 3 BANK: Confirm */}
                      {sendStep === 3 && sendMode === 'bank' && (
                          <div className="space-y-6">
                              <h4 className="text-center text-slate-500 text-sm mb-2">Confirma los datos de pago</h4>
                              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col items-center">
                                  <span className="text-xs font-bold text-[#4ADE80] uppercase tracking-widest mb-1">TOTAL A PAGAR</span>
                                  <span className="text-3xl font-extrabold text-[#0C0E0D]">{formatMoney(getRawAmount(sendForm.amount), sendForm.destinationCurrency)}</span>
                              </div>
                              <div className="bg-slate-50 rounded-xl p-4 space-y-3 text-sm border border-slate-200">
                                  <div className="flex justify-between"><span className="text-slate-500">Beneficiario:</span><span className="font-bold text-slate-800">{sendForm.beneficiaryName}</span></div>
                                  <div className="flex justify-between"><span className="text-slate-500">Cuenta:</span><span className="font-bold text-slate-800">{sendForm.accountNumber}</span></div>
                              </div>
                              <div className="flex gap-3">
                                  <button onClick={() => setSendStep(2)} className="flex-1 py-3 border border-slate-300 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors">Corregir</button>
                                  <button onClick={handleSendSubmit} className="flex-1 py-3 bg-[#0C0E0D] font-bold rounded-xl hover:bg-[#152e52] shadow-lg transition-colors flex items-center justify-center gap-2">{isSending ? <Loader2 className="animate-spin" /> : <><Send size={18}/> Confirmar</>}</button>
                              </div>
                          </div>
                      )}
                      {/* STEP 2 CASH: Recipient details */}
                      {sendStep === 2 && sendMode === 'cash' && (
                          <div className="space-y-4">
                              <button onClick={() => { setSendStep(1); setSendMode(null); }} className="text-xs text-slate-400 flex items-center gap-1 hover:text-slate-600 mb-2 font-bold"><ArrowLeft size={12}/> Volver</button>
                              <div className="bg-orange-50 border border-orange-100 p-3 rounded-xl text-center">
                                  <p className="text-sm font-bold text-orange-800">Retiro de <span className="text-orange-600">{formatMoney(getRawAmount(sendForm.amount), sendForm.destinationCurrency)}</span> en efectivo</p>
                                  <p className="text-xs text-orange-600 mt-1">Un agente procesará el pago en el punto físico más cercano</p>
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre completo del receptor</label>
                                  <input type="text" value={cashForm.recipientName} onChange={(e) => setCashForm({...cashForm, recipientName: e.target.value})} placeholder="Nombre y apellido" className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-orange-400 focus:ring-1 focus:ring-orange-200 outline-none text-sm"/>
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
                                  <input type="text" value={cashForm.city} onChange={(e) => setCashForm({...cashForm, city: e.target.value})} placeholder="Ej: Bogotá, Medellín, Lima..." className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-orange-400 outline-none text-sm"/>
                              </div>
                              <button
                                  onClick={() => {
                                      if (!cashForm.recipientName.trim()) { showToast('Ingresa el nombre del receptor'); return; }
                                      if (!cashForm.docNumber.trim()) { showToast('Ingresa el número de documento'); return; }
                                      if (!cashForm.city.trim()) { showToast('Ingresa la ciudad de retiro'); return; }
                                      setSendStep(3);
                                  }}
                                  className="w-full h-12 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 mt-2 flex items-center justify-center gap-2 shadow-lg transition-colors"
                              >
                                  <MapPin size={16}/> Revisar datos
                              </button>
                          </div>
                      )}
                      {/* STEP 3 CASH: Confirm */}
                      {sendStep === 3 && sendMode === 'cash' && (
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
                                  <button onClick={() => setSendStep(2)} className="flex-1 py-3 border border-slate-300 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors">Corregir</button>
                                  <button onClick={handleCashSubmit} className="flex-1 py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 shadow-lg transition-colors flex items-center justify-center gap-2">
                                      {isSending ? <Loader2 size={18} className="animate-spin"/> : <><MapPin size={16}/> Confirmar</>}
                                  </button>
                              </div>
                          </div>
                      )}
                      {/* STEP 4: Success */}
                      {sendStep === 4 && (
                          <div className="flex flex-col items-center text-center py-8 animate-in zoom-in duration-300">
                              <div className={`w-20 h-20 ${sendMode === 'cash' ? 'bg-orange-100' : 'bg-green-100'} rounded-full flex items-center justify-center mb-6`}>
                                  {sendMode === 'cash' ? <MapPin size={40} className="text-orange-500"/> : <CheckCircle size={40} className="text-green-600"/>}
                              </div>
                              <h2 className="text-2xl font-bold text-[#0C0E0D] mb-2">
                                  {sendMode === 'pay' ? '¡Pago Enviado!' : sendMode === 'cash' ? '¡Retiro Solicitado!' : '¡Pago Iniciado!'}
                              </h2>
                              {sendMode === 'cash' && cashReference && (
                                  <div className="w-full bg-orange-50 border-2 border-orange-200 rounded-2xl p-5 mb-4">
                                      <p className="text-xs text-orange-500 font-bold uppercase tracking-widest mb-2">Código de retiro</p>
                                      <p className="text-3xl font-extrabold text-orange-700 tracking-widest font-mono">{cashReference}</p>
                                      <p className="text-xs text-slate-500 mt-3 leading-relaxed">
                                          Presenta este código junto con el documento <strong>{cashForm.docType} {cashForm.docNumber}</strong> en el punto físico de <strong>{cashForm.city}</strong>.
                                      </p>
                                  </div>
                              )}
                              {sendMode === 'cash' && (
                                  <p className="text-sm text-slate-500 mb-4">Un agente se comunicará al <strong>{cashForm.phone || 'número registrado'}</strong> para coordinar el punto de entrega.</p>
                              )}
                              <button onClick={closeSendModal} className="w-full bg-[#0C0E0D] font-bold py-3 rounded-xl hover:bg-[#152e52] transition-colors">Finalizar</button>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {/* CONVERT MODAL */}
      {isConvertModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-[480px] overflow-hidden animate-in zoom-in-95 duration-300 relative">
                  
                  {/* Close Button Top Right */}
                  <button onClick={closeConvertModal} className="absolute top-4 right-4 text-slate-300 hover:text-slate-600 z-10 p-1 rounded-full hover:bg-slate-100 transition-colors">
                      <X size={20}/>
                  </button>

                  <div className="p-8 pb-4">
                      {/* Input: TU ENVÍAS */}
                      <div className="border border-slate-200 rounded-2xl p-4 mb-3 relative bg-white hover:border-[#0C0E0D] transition-colors group focus-within:border-[#0C0E0D]">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                              TU ENVÍAS
                          </label>
                          <div className="flex justify-between items-center gap-2">
                              <input 
                                type="text" 
                                value={convertAmountStr}
                                onChange={handleConvertInput}
                                className="text-3xl font-bold text-slate-900 w-full outline-none bg-transparent"
                              />
                              <FlagSelect items={CONVERSION_CURRENCIES} value={sourceCurr} onChange={setSourceCurr} />
                          </div>
                      </div>

                      {/* Divider Icon */}
                      <div className="flex justify-center -my-6 relative z-10 pointer-events-none">
                          <div className="bg-white border border-slate-200 rounded-full p-1.5 shadow-sm text-slate-400">
                              <div className="font-serif font-bold text-xs">$</div> 
                          </div>
                      </div>

                      {/* Output: TU CONTACTO RECIBE */}
                      <div className="border border-slate-200 rounded-2xl p-4 mt-3 mb-4 relative bg-white hover:border-[#0C0E0D] transition-colors group">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                              TU CONTACTO RECIBE
                          </label>
                          <div className="flex justify-between items-center gap-2">
                              <span className="text-3xl font-bold text-slate-900 w-full overflow-hidden text-ellipsis whitespace-nowrap">
                                  {formatInputNumber((getRawAmount(convertAmountStr) * (1 - (appliedCoupon ? (applicableFeePercentage * (100 - appliedCoupon.discount)/100) : applicableFeePercentage)/100) * getRate(sourceCurr, targetCurr)).toFixed(0))}
                              </span>
                              <FlagSelect items={CONVERSION_CURRENCIES} value={targetCurr} onChange={setTargetCurr} />
                          </div>
                      </div>

                      {/* Coupon Section */}
                      <div className="mb-4">
                          {!showCouponInput && !appliedCoupon && (
                              <button onClick={() => setShowCouponInput(true)} className="text-xs font-bold text-[#0C0E0D] flex items-center gap-1 hover:underline">
                                  <Tag size={14} /> ¿Tienes un cupón?
                              </button>
                          )}
                          
                          {showCouponInput && (
                              <div className="flex gap-2 animate-in fade-in slide-in-from-top-1">
                                  <input 
                                    type="text" 
                                    value={couponCode} 
                                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())} 
                                    className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-xs uppercase focus:border-[#0C0E0D] outline-none" 
                                    placeholder="CÓDIGO"
                                  />
                                  <button onClick={handleApplyCoupon} className="bg-[#0C0E0D] px-3 py-1.5 rounded-lg font-bold text-xs hover:bg-[#152e52]">Aplicar</button>
                                  <button onClick={() => setShowCouponInput(false)} className="text-slate-400 hover:text-slate-600"><X size={16}/></button>
                              </div>
                          )}

                          {appliedCoupon && (
                              <div className="flex justify-between items-center bg-green-50 border border-green-100 p-2 rounded-lg text-xs animate-in fade-in">
                                  <span className="text-green-700 font-bold flex items-center gap-1"><Tag size={12}/> Cupón {appliedCoupon.code} aplicado</span>
                                  <div className="flex items-center gap-2">
                                      <span className="text-green-600 font-bold">-{appliedCoupon.discount}% Fee</span>
                                      <button onClick={() => { setAppliedCoupon(null); setCouponCode(''); }} className="text-slate-400 hover:text-red-500"><X size={12}/></button>
                                  </div>
                              </div>
                          )}
                      </div>

                      {/* Breakdown */}
                      <div className="space-y-3 mb-4 px-1">
                          <div className="flex justify-between items-center text-xs">
                              <div className="flex items-center gap-2 text-[#415DA1] font-medium">
                                  <div className="w-4 h-4 rounded-full bg-[#415DA1] text-white flex items-center justify-center text-[8px]"><Minus size={8} strokeWidth={4}/></div>
                                  Costo de envío ({applicableFeePercentage}%):
                              </div>
                              <span className="font-bold text-[#0C0E0D]">{formatMoney(rawAmount * (appliedCoupon ? (applicableFeePercentage * (100 - appliedCoupon.discount)/100) : applicableFeePercentage)/100, sourceCurr)} {sourceCurr}</span>
                          </div>
                          
                          <div className="flex justify-between items-center text-xs">
                              <div className="flex items-center gap-2 text-slate-500 font-medium">
                                  <div className="w-4 h-4 rounded-full bg-[#415DA1] text-white flex items-center justify-center text-[8px]"><Equal size={8} strokeWidth={4}/></div>
                                  Monto a convertir:
                              </div>
                              <span className="font-bold text-[#0C0E0D]">{formatMoney(amountToConvert, sourceCurr)} {sourceCurr}</span>
                          </div>

                          <div className="flex justify-between items-center text-xs">
                              <div className="flex items-center gap-2 text-slate-500 font-medium">
                                  <div className="w-4 h-4 rounded-full bg-[#415DA1] text-white flex items-center justify-center text-[8px]">÷</div>
                                  Tipo de cambio:
                              </div>
                              <span className="font-bold text-[#0C0E0D]">1 {sourceCurr} = {conversionRate} {targetCurr}</span>
                          </div>
                          
                          <div className="flex justify-center pt-1">
                              <button onClick={() => setShowConvertDetails(!showConvertDetails)} className="text-[#415DA1] text-xs font-medium hover:underline flex items-center gap-1">
                                  Ver detalle completo <ChevronDown size={12}/>
                              </button>
                          </div>
                      </div>

                      {/* Delivery Info */}
                      <div className="bg-[#EBF2FA] rounded-xl p-3 flex items-start gap-3 mb-6">
                          <div className="bg-white p-1 rounded-full text-[#0C0E0D] shrink-0"><Clock size={14}/></div>
                          <span className="text-xs text-[#0C0E0D]">Tu dinero llega de forma <span className="font-bold">inmediata</span> una vez confirmada la operación</span>
                      </div>

                      {/* Action Button */}
                      <button
                          onClick={handleConvertSubmit}
                          disabled={isConverting}
                          className="w-full h-12 bg-[#0C0E0D] font-bold rounded-xl hover:bg-[#152e52] shadow-lg text-sm transition-transform active:scale-95 flex justify-center items-center gap-2"
                      >
                          {isConverting ? <Loader2 className="animate-spin" /> : 'Confirmar Operación'}
                      </button>

                      <div className="text-center mt-4 flex items-center justify-center gap-2 text-[10px] text-slate-400 font-medium">
                          <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div> Sistema de envíos seguros
                      </div>
                  </div>
              </div>
          </div>
      )}

      {showPayVerify && (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-300 p-6">
                  <div className="flex items-center justify-between mb-5">
                      <h3 className="font-bold text-slate-800 text-lg">Verificación 2FA</h3>
                      <button onClick={() => setShowPayVerify(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100"><X size={20}/></button>
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
                      onClick={handlePayVerifyAndSend}
                      disabled={payVerifyCode.length !== 6 || payVerifyLoading}
                      className="w-full h-12 bg-[#0C0E0D] font-bold rounded-xl disabled:opacity-50 hover:bg-[#152e52] transition-colors flex items-center justify-center gap-2"
                  >
                      {payVerifyLoading ? <><Loader2 size={18} className="animate-spin"/> Verificando...</> : 'Confirmar pago'}
                  </button>
              </div>
          </div>
      )}

      {isPayLinkOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-300">
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
                      {payLinkStep === 1 && (
                          <div className="space-y-5">
                              <p className="text-sm text-slate-500">Selecciona el país del pagador y el monto a cobrar.</p>
                              <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase mb-3">País del pagador</label>
                                  <div className="grid grid-cols-4 gap-2">
                                      {PAY_LINK_COUNTRIES.map(c => (
                                          <button key={c.code} onClick={() => handleSelectPayLinkCountry(c.code)}
                                              className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border transition-all ${payLinkCountry === c.code ? 'border-[#0C0E0D] bg-slate-50 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}>
                                              <FlagImg code={c.code} className="w-8 h-6 object-cover rounded shadow-sm" />
                                              <span className={`text-[10px] font-bold ${payLinkCountry === c.code ? 'text-[#0C0E0D]' : 'text-slate-500'}`}>{c.code}</span>
                                          </button>
                                      ))}
                                  </div>
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Monto a cobrar</label>
                                  <div className="flex items-center border border-slate-300 rounded-xl overflow-hidden focus-within:border-[#0C0E0D] transition-colors">
                                      <input type="text" inputMode="numeric" placeholder="0"
                                          value={payLinkAmount ? payLinkAmount.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : ''}
                                          onChange={e => setPayLinkAmount(e.target.value.replace(/\./g, '').replace(/\D/g, ''))}
                                          className="flex-1 px-4 py-3 text-lg font-bold text-slate-800 outline-none bg-transparent"
                                      />
                                      <span className="px-4 py-3 bg-slate-50 font-bold text-slate-500 text-sm border-l border-slate-200">
                                          {PAY_LINK_COUNTRIES.find(c => c.code === payLinkCountry)?.currency}
                                      </span>
                                  </div>
                              </div>
                              <button onClick={() => setPayLinkStep(2)} disabled={!payLinkAmount || Number(payLinkAmount) <= 0}
                                  className="w-full py-3.5 bg-[#0C0E0D] font-bold rounded-xl hover:bg-[#152e52] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                                  Continuar
                              </button>
                          </div>
                      )}
                      {payLinkStep === 2 && (
                          <div className="space-y-4">
                              <p className="text-sm text-slate-500">Ingresa los datos de quien realizará el pago.</p>
                              <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nombre completo del pagador</label>
                                  <input type="text" placeholder="Ej. Juan García López" value={payLinkPayerName}
                                      onChange={e => setPayLinkPayerName(e.target.value)}
                                      className="w-full px-4 py-3 border border-slate-300 rounded-xl outline-none focus:border-[#0C0E0D] transition-colors text-slate-800" />
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Tipo de documento</label>
                                  <select value={payLinkDocType} onChange={e => setPayLinkDocType(e.target.value)}
                                      className="w-full px-4 py-3 border border-slate-300 rounded-xl outline-none focus:border-[#0C0E0D] transition-colors text-slate-800 bg-white">
                                      {(DOC_TYPES[payLinkCountry] ?? []).map(d => (
                                          <option key={d.value} value={d.value}>{d.label}</option>
                                      ))}
                                  </select>
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Número de documento</label>
                                  <input type="text" placeholder="Ej. 1234567890" value={payLinkDocNumber}
                                      onChange={e => setPayLinkDocNumber(e.target.value)}
                                      className="w-full px-4 py-3 border border-slate-300 rounded-xl outline-none focus:border-[#0C0E0D] transition-colors text-slate-800" />
                              </div>
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
                              <button onClick={handleGeneratePayLink} disabled={!payLinkPayerName.trim() || !payLinkDocNumber.trim()}
                                  className="w-full py-3.5 bg-[#4ADE80] text-[#0C0E0D] font-bold rounded-xl hover:bg-[#22C55E] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                                  <Link2 size={18}/> Generar Link de Pago
                              </button>
                          </div>
                      )}
                      {payLinkStep === 3 && (
                          <div className="space-y-5 text-center">
                              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold ${payLinkSecondsLeft > 300 ? 'bg-green-50 text-green-700' : payLinkSecondsLeft > 60 ? 'bg-orange-50 text-orange-700' : 'bg-red-50 text-red-700'}`}>
                                  <Timer size={16}/>
                                  {payLinkSecondsLeft > 0 ? `Expira en ${formatCountdown(payLinkSecondsLeft)}` : 'Link vencido'}
                              </div>
                              <div className="flex justify-center">
                                  <div className="bg-white border-2 border-slate-200 rounded-2xl p-3 shadow-sm inline-block">
                                      <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(payLinkUrl)}&color=0B1B32`}
                                          alt="QR Link de Pago" className="w-44 h-44" />
                                  </div>
                              </div>
                              <div>
                                  <p className="text-xs text-slate-400 mb-2 font-bold uppercase">Link de pago único</p>
                                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                                      <span className="text-sm text-[#0C0E0D] font-mono flex-1 text-left break-all">{payLinkUrl}</span>
                                      <button onClick={() => { navigator.clipboard?.writeText(payLinkUrl); showToast('Link copiado'); }}
                                          className="shrink-0 p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors">
                                          <Copy size={16}/>
                                      </button>
                                  </div>
                              </div>
                              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-sm space-y-1 text-left">
                                  <p className="font-bold text-slate-700 mb-2">Resumen del cobro</p>
                                  <div className="flex justify-between"><span className="text-slate-500">Pagador</span><span className="font-bold">{payLinkPayerName}</span></div>
                                  <div className="flex justify-between"><span className="text-slate-500">Documento</span><span className="font-bold">{payLinkDocType} {payLinkDocNumber}</span></div>
                                  <div className="flex justify-between"><span className="text-slate-500">Monto</span><span className="font-bold text-[#0C0E0D]">{Number(payLinkAmount).toLocaleString()} {PAY_LINK_COUNTRIES.find(c => c.code === payLinkCountry)?.currency}</span></div>
                              </div>
                              <div className="flex gap-3">
                                  <button onClick={() => { if (navigator.share) { navigator.share({ title: 'Link de pago LINCOIN', url: payLinkUrl }); } else { navigator.clipboard?.writeText(payLinkUrl); showToast('Link copiado'); } }}
                                      className="flex-1 py-3 bg-[#0C0E0D] font-bold rounded-xl hover:bg-[#152e52] transition-colors flex items-center justify-center gap-2">
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

      {/* TRANSACTION DETAIL MODAL */}
      {renderTxDetail()}

      {/* QR SCANNER MODAL */}
      {showQrScanner && (
        <div className="fixed inset-0 z-[90] bg-black/80 flex flex-col items-center justify-center p-4">
          <div className="bg-white rounded-2xl overflow-hidden w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="font-bold text-slate-800 flex items-center gap-2"><QrCode size={18}/> Escanear QR</span>
              <button onClick={stopQrScanner} className="p-1 rounded-full hover:bg-slate-100 text-slate-500"><X size={20}/></button>
            </div>
            <div className="relative bg-black">
              <video
                ref={qrVideoRef}
                className="w-full aspect-square object-cover"
                muted
                playsInline
              />
              {/* aiming frame overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-48 border-4 border-[#4ADE80] rounded-2xl opacity-80" />
              </div>
            </div>
            <p className="text-xs text-slate-500 text-center py-3 px-4">Apunta la cámara al código QR de la dirección destino</p>
          </div>
        </div>
      )}

    </div>
  );
};