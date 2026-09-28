// ══════════════════════════════════════════════════════════════════
//  Enviar dinero — el modal COMPLETO del panel de empresas, como componente.
//
//  Se extrajo tal cual de PersonalDashboard para que el portal de Personas
//  use EXACTAMENTE el mismo flujo: país de origen, monto, método (Bre-B,
//  cuenta bancaria, persona Lincoin, wallet), beneficiario inscrito y
//  verificado, confirmación con el código 2FA y resultado. Toda la lógica de
//  saldo, comisión, cotización y dispersión vive aquí; el panel que lo usa
//  solo lo abre (ref.abrir) y le pasa lo que no es del envío: el toast, el
//  estado del 2FA, el saldo mostrado y el saldo real de GasFree.
// ══════════════════════════════════════════════════════════════════
import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Landmark, CheckCircle2, ArrowUpRight, History, Info, Send, RefreshCw, CreditCard, Activity, LogOut, Trash2, Bell, ChevronDown, ChevronUp, Plus, ArrowDownLeft, X, Clock, UploadCloud, CheckCircle, Copy, User, ArrowLeft, ArrowRight, ShieldCheck, ScanSearch, Lock, LayoutGrid, Share2, FileText, Download, ExternalLink, Megaphone, Plane, GraduationCap, TrendingUp, Layers, MoreHorizontal, Settings, Loader2, Ban, QrCode, Edit2, Tag, Minus, Equal, Users, AlertTriangle, Link2, Timer, Zap, Building2, MapPin, Wallet, BookUser, Search, SlidersHorizontal, ArrowLeftRight, XCircle, Archive, MessageSquare } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';
import { MOTIVOS_ENVIO } from '../lib/motivosEnvio';
import { contactStatus } from './ContactsSection';
import { FlagImg, FlagSelect, flagUrl } from './FlagImg';
import { CodeInput } from './CodeInput';
import { achEta, achEtaShort } from './achEta';
import { useExchangeRates } from '../context/ExchangeRateContext';
import { useSystemConfig } from '../context/SystemConfigContext';
import { useDatabase } from '../context/DatabaseContext';

export type EnviarPrefill = {
  mode?: 'bank' | 'pay' | 'cash' | 'wallet' | null;
  contact?: any;
  rail?: 'COP' | 'COP_BREB' | 'COP_ACH';
  form?: Partial<{
    destinationCountry: string; destinationCurrency: string; amount: string; beneficiaryType: 'personal' | 'business';
    beneficiaryName: string; documentType: string; documentNumber: string; bankName: string; accountType: string; accountNumber: string; reason: string; motivo: string;
  }>;
  step?: number;
};
export type EnviarHandle = { abrir: (p?: EnviarPrefill) => void; cerrar: () => void; abierto: () => boolean };

type Props = {
  showToast: (msg: string, ms?: number, tipo?: 'success' | 'error') => void;
  mfaEnrolled: boolean;
  /** Saldo que se muestra por moneda (el USD sale de GasFree en empresas). */
  displayBalance: (code: string) => number;
  callGasfree: (payload: Record<string, unknown>) => Promise<any>;
  refreshGasfreeBal: (uid: string) => Promise<void> | void;
  movements: any[];
  /** Cambiar de pantalla en el panel que lo aloja (p. ej. a Ajustes). */
  onIrA: (vista: string) => void;
  onVerMovimiento?: (tx: any) => void;
  /** Personas: su COP vive en un solo saldo; el riel lo cubre el servidor. */
  saldoUnificado?: boolean;
  mfaFactorId?: string;
  mfaTotpSecret?: string;
  /** "Mover entre cuentas" desde el modal (solo empresas). */
  onMoverEntreCuentas?: () => void;
};

// "Enviar" desde un beneficiario inscrito: abre el modal con TODO precargado
// desde el contacto (nombre, documento, banco o llave, país y riel).
export const prefillDeContacto = (c: any): EnviarPrefill => {
  const isWallet = c?.accountKind === 'wallet';
  return {
    form: {
      destinationCountry: isWallet ? 'Estados Unidos' : (c.country || 'Colombia'),
      destinationCurrency: isWallet ? 'USD' : 'COP',
      amount: '',
      beneficiaryType: c.kind === 'empresa' ? 'business' : 'personal',
      beneficiaryName: c.name,
      documentType: c.docType ?? '',
      documentNumber: c.docNumber ?? '',
      bankName: c.bank ?? '',
      accountType: c.accountType ?? '',
      accountNumber: c.accountNumber ?? '',
      reason: 'Envío de dinero',
    },
    contact: c,
    mode: isWallet ? 'wallet' : 'bank',
    rail: isWallet ? 'COP' : (c.destKind === 'breb' ? 'COP_BREB' : 'COP_ACH'),
    step: 1,
  };
};

export const EnviarDineroModal = forwardRef<EnviarHandle, Props>(function EnviarDineroModal(props, ref) {
  const { showToast, mfaEnrolled, displayBalance, callGasfree, refreshGasfreeBal, movements, onIrA, onVerMovimiento, saldoUnificado = false, mfaFactorId, mfaTotpSecret, onMoverEntreCuentas } = props;
  const { currentUser, getBalance: getBalanceCtx, requestWithdrawal, sendCuypayPayment, getAllUsers, verifyMfaCode, refreshData } = useDatabase();
  const { config } = useSystemConfig();
  const displayCurrency = (c?: string): string => String(c || '').split('_')[0];
  const setSelectedWalletCode = (_c: string) => { /* lo maneja el panel */ };
  const setBrebMoveOpen = (_v: boolean) => { onMoverEntreCuentas?.(); };
  const { getRate } = useExchangeRates();
  const setActiveView = (v: string) => onIrA(v);
  const setSelectedTx = (tx: any) => onVerMovimiento?.(tx);
  // Personas: los tres rieles COP se leen como UN solo saldo. El servidor
  // (mouv-proxy) cubre el riel del envío desde el Saldo Lincoin antes de
  // debitar, así que el chequeo de acá tiene que ver lo mismo.
  const getBalance = (code: string): number => {
    if (saldoUnificado && (code === 'COP' || code === 'COP_BREB' || code === 'COP_ACH')) {
      return (getBalanceCtx('COP') || 0) + (getBalanceCtx('COP_BREB') || 0) + (getBalanceCtx('COP_ACH') || 0);
    }
    return getBalanceCtx(code);
  };
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [sendStep, setSendStep] = useState(1);
  // Resultado del envío para el paso 5 ("Envío en camino" / fallo): datos
  // reales de la dispersión — referencia del proveedor, costo, riel, hora.
  const [sendResult, setSendResult] = useState<{ ok: boolean; message?: string; providerRef?: string | null; feeCop?: number; rail?: string; at?: string } | null>(null);
  // Buscador del selector de contactos inscritos (envíos COP · banco)
  const [contactSearch, setContactSearch] = useState('');
  // ID de la external account de Mouv del contacto elegido — con él la
  // confirmación crea la ORDEN DE RETIRO REAL en Mouv (destination_id).
  const [mouvDestId, setMouvDestId] = useState<string | null>(null);
  // Default Colombia/COP: el chip de país se pinta seleccionado por la
  // MONEDA — si el default fuera otro país (CLP…), Colombia se vería
  // elegida pero la validación miraría el saldo de la moneda vieja
  // ("saldo insuficiente en CLP" con plata en Bre-B).
  const [sendForm, setSendForm] = useState({
      destinationCountry: 'Colombia',
      destinationCurrency: 'COP',
      amount: '',
      beneficiaryType: 'personal' as 'personal' | 'business',
      beneficiaryName: '',
      documentType: '',
      documentNumber: '',
      bankName: '',
      accountType: '',
      accountNumber: '',
      reason: 'Envío de dinero',
      // El motivo del envío: se pregunta al confirmar, se le manda a Finity
      // con la orden, y decide qué documento sale en Siigo.
      motivo: '',
  });
  // Billetera de ORIGEN para envíos COP: los 3 rieles son saldos SEPARADOS
  // (Saldo Lincoin / Bre-B / ACH). El cliente elige de cuál sale el dinero;
  // el disponible, la validación y el débito salen de ese riel.
  const [sendSourceRail, setSendSourceRail] = useState<'COP' | 'COP_BREB' | 'COP_ACH'>('COP');
  // Contacto elegido para el envío COP (trae destKind/brebKey/banco para la
  // dispersión REAL inline de Mouv).
  const [sendContact, setSendContact] = useState<any>(null);

  // ── Quién recibe la plata: UNA sola fuente ────────────────────────────
  //
  // Había dos objetos describiendo a la misma persona: `sendContact` (el
  // beneficiario inscrito, de donde salía la llave Bre-B y el banco) y
  // `sendForm` (el formulario, de donde salían el nombre y el documento).
  // Se podían desincronizar, y cuando pasó el resultado fue el peor posible:
  // la pantalla de confirmación mostró la llave de una persona con el nombre
  // y la cédula de otra, y el envío habría salido así — a la llave de una,
  // con la cédula de otra, y con el control de antecedentes hecho sobre el
  // documento equivocado.
  //
  // Con un beneficiario inscrito, TODO sale de él. El formulario solo manda
  // cuando no hay inscrito (destinos escritos a mano).
  //
  // `coherente` es la red de seguridad: si por cualquier camino los dos
  // objetos discrepan en llave, cuenta o documento, no se envía. Preferimos
  // hacer volver al usuario al selector que mandarle la plata a quien no es.
  const destinatario = React.useMemo(() => {
    const c = sendContact;
    if (!c) {
      return {
        name: sendForm.beneficiaryName, docType: sendForm.documentType, docNumber: sendForm.documentNumber,
        bank: sendForm.bankName, accountType: sendForm.accountType, accountNumber: sendForm.accountNumber,
        brebKey: undefined as string | undefined, brebKeyType: undefined as string | undefined,
        address: undefined as string | undefined, cityCode: undefined as string | undefined, cityName: undefined as string | undefined, stateCode: undefined as string | undefined,
        esInscrito: false, coherente: true,
      };
    }
    const mismo = (a: unknown, b: unknown) => {
      const x = String(a ?? '').trim().toLowerCase();
      const y = String(b ?? '').trim().toLowerCase();
      return !x || !y || x === y;   // si el formulario no lo trae, no contradice
    };
    const llave = c.brebKey ?? c.accountNumber;
    const coherente =
      mismo(sendForm.documentNumber, c.docNumber)
      && mismo(sendForm.beneficiaryName, c.name)
      && (c.destKind === 'breb' ? true : mismo(sendForm.accountNumber, c.accountNumber));
    return {
      name: c.name, docType: c.docType, docNumber: c.docNumber,
      bank: c.bank, accountType: c.accountType, accountNumber: c.accountNumber,
      brebKey: llave, brebKeyType: c.brebKeyType,
      // Ciudad y dirección del beneficiario: van al tercero en Siigo.
      address: c.address, cityCode: c.cityCode, cityName: c.cityName, stateCode: c.stateCode,
      esInscrito: true, coherente,
    };
  }, [sendContact, sendForm.beneficiaryName, sendForm.documentType, sendForm.documentNumber, sendForm.bankName, sendForm.accountType, sendForm.accountNumber]);

  // Método elegido en el paso 2 del flujo (diseño Flujo Enviar): lista radio.
  const [sendMethodSel, setSendMethodSel] = useState<'breb' | 'ach' | 'pay' | 'cash' | null>(null);
  // Cotización de la comisión del proveedor para el paso Confirmar:
  // Bre-B → Mouv (fija + variable + IVA, cotizada en vivo y cobrada al
  // cliente) · ACH → Finity (precio fijo por transferencia, se descuenta al
  // confirmar con el valor que reporta la orden).
  const [payoutQuote, setPayoutQuote] = useState<{ loading: boolean; feeCop?: number | null; provider?: string; error?: string } | null>(null);
  const [isSending, setIsSending] = useState(false);
  // Candado síncrono anti doble-clic (el estado de React tarda un render en
  // reflejarse; el ref bloquea desde el primer instante).
  const sendingRef = useRef(false);
  // Mismos candados SÍNCRONOS anti doble-clic para pagar (P2P) y convertir:
  // el estado de React tarda un render; el ref bloquea desde el primer clic.
  const payingRef = useRef(false);
  const convertingRef = useRef(false);
  // Código 2FA del envío en curso — se envía al servidor para que RE-valide el
  // TOTP antes de mover dinero (no basta con la pantalla del navegador).
  const sentOtpRef = useRef('');
  // true = se despachó una orden a Mouv y NO sabemos si se creó (timeout /
  // error de red). Bloquea reintentos hasta que el usuario verifique.
  const [mouvUnknown, setMouvUnknown] = useState(false);
  // Desafío 2FA al CONFIRMAR un envío: antes de mover el dinero se pide el
  // código de la app de autenticación. Sin esto el 2FA solo servía de puerta
  // para abrir el panel, pero no se validaba al confirmar la transacción.
  const [sendOtpOpen, setSendOtpOpen] = useState(false);
  const [sendOtpCode, setSendOtpCode] = useState('');
  const [sendOtpError, setSendOtpError] = useState('');
  const [sendOtpLoading, setSendOtpLoading] = useState(false);

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


  // ── Utilidades (copiadas del panel: formato de montos y llamadas al riel) ──
  const formatMoney = (amount: number, _currency: string) => {
      return new Intl.NumberFormat('es-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  };
  const formatInputNumber = (value: string) => {
      const cleanVal = value.replace(/\D/g, '');
      if (!cleanVal) return '';
      return new Intl.NumberFormat('es-DE').format(Number(cleanVal));
  };
  const getRawAmount = (val: string) => Number(val.replace(/\./g, ''));
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
  const [amlSrv, setAmlSrv] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    const uid = currentUser?.id;
    if (!uid || !isSendModalOpen) return;
    let vivo = true;
    (async () => {
      const e = await llamarFuncion('tusdatos', { action: 'estado', userId: uid });
      // Solo una respuesta explícita cambia el estado: si la consulta falla
      // se conserva lo último que sí supimos.
      if (vivo && e?.ok) setAmlSrv(e.beneficiarios ?? {});

      // Y se arrancan las consultas que falten. Ahora que un beneficiario sin
      // resultado NO se puede elegir, quedarse esperando una consulta que
      // nadie lanzó dejaría la cuenta sin poder enviar. Abrir el envío es
      // justo el momento de pedirlas.
      const p = await llamarFuncion('tusdatos', { action: 'verificar_pendientes', userId: uid, limite: 4 });
      if (!vivo || !p?.ok) return;
      // Recoger lo que ya haya vuelto y refrescar, para no dejar la pantalla
      // diciendo "espera" cuando el resultado ya llegó.
      await llamarFuncion('tusdatos', { action: 'recoger_pendientes', userId: uid });
      const e2 = await llamarFuncion('tusdatos', { action: 'estado', userId: uid });
      if (vivo && e2?.ok) setAmlSrv(e2.beneficiarios ?? {});
    })();
    return () => { vivo = false; };
  }, [currentUser?.id, isSendModalOpen]);

  // Cotizar la comisión del riel al entrar a Confirmar (paso 4 · banco).
  useEffect(() => {
      if (!(sendStep === 4 && sendMode === 'bank' && currentUser?.id)) { setPayoutQuote(null); return; }
      const isBrebM = (sendContact?.destKind ?? (sendSourceRail === 'COP_BREB' ? 'breb' : 'ach')) === 'breb';
      const amt = getRawAmount(sendForm.amount);
      setPayoutQuote({ loading: true });
      callMouvProxy({ action: 'payout_quote', userId: currentUser.id, rail: isBrebM ? 'BREB' : 'ACH', amount: amt, ...(isBrebM ? { keyValue: sendContact?.brebKey ?? sendForm.accountNumber } : {}) })
          .then(r => setPayoutQuote(r?.ok ? { loading: false, feeCop: Number(r.feeCop ?? 0), provider: isBrebM ? 'mouv' : 'finity' } : { loading: false, error: r?.message ?? 'No se pudo cotizar' }))
          .catch(e => setPayoutQuote({ loading: false, error: String(e?.message ?? e) }));
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendStep, sendMode, currentUser?.id]);

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

  const vigilarHasta = useRef(0);
  useEffect(() => {
      if (!currentUser?.id) return;
      const t = setInterval(async () => {
          if (Date.now() > vigilarHasta.current) return;
          if (document.hidden) return;
          const r = await callMouvProxy({ action: 'reconcile_breb', userId: currentUser.id, recientesMin: 20 }).catch(() => null);
          const cambios = (r?.results ?? []).filter((x: any) => x.result === 'refunded' || x.result === 'completed');
          if (!cambios.length) return;
          vigilarHasta.current = 0;   // ya se resolvió: dejar de insistir
          refreshData?.();
          if (cambios.some((x: any) => x.result === 'refunded')) {
              showToast('Tu envío Bre-B fue devuelto — el monto y la comisión ya volvieron a tu saldo.', 9000);
          } else {
              showToast('✅ Tu envío Bre-B fue confirmado.');
          }
      }, 12000);
      return () => clearInterval(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // Y la vigilancia normal, que CORRE SOLA CADA 45 SEGUNDOS mientras haya algo

  const handleSendNext = () => {
      if (sendStep === 1) {
          const rawAmount = getRawAmount(sendForm.amount);
          if (!sendForm.amount || rawAmount <= 0) {
              showToast("Por favor ingresa un monto válido.", 3000, 'error');
              return;
          }
          // Mínimo por envío COP: $5.000 (los rieles lo exigen — Finity
          // rechaza retiros ACH menores con "amount must be at least 5,000").
          if (sendForm.destinationCurrency === 'COP' && rawAmount < 5000) {
              showToast('El monto mínimo por envío es $5.000 COP.', 4000, 'error');
              return;
          }
          // COP: la billetera ya NO se elige en el paso 1 — el método del paso
          // 2 la define. Aquí solo se valida que ALGUNA de las 3 cuentas
          // pueda cubrir el monto (el paso 2 exige monto + comisión por método).
          const currentBalance = sendForm.destinationCurrency === 'COP'
              ? Math.max(getBalance('COP'), getBalance('COP_BREB'), getBalance('COP_ACH'))
              : displayBalance(sendForm.destinationCurrency);
          if (currentBalance < rawAmount) {
              showToast(sendForm.destinationCurrency === 'COP'
                  ? 'Saldo insuficiente: ninguna de tus cuentas COP cubre ese monto.'
                  : `Saldo insuficiente en ${sendForm.destinationCurrency === 'USD' ? 'USDT' : sendForm.destinationCurrency}.`, 4000, 'error');
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
      // 1) Escaneo local (rápido; funciona para admins y antes de endurecer RLS).
      const allUsers = getAllUsers();
      const found = allUsers.find(u => u.ownReferralCode?.toUpperCase() === upper && u.id !== currentUser?.id);
      if (found) { setPayRecipientUser(found); setPayLookupStatus('found'); return; }
      // 2) Con RLS estricta el cliente ya no ve a otros usuarios → se resuelve
      //    en el servidor (solo devuelve id + nombre, sin saldos ni PII).
      (async () => {
        try {
          const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
          const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
          if (!SURL) { setPayRecipientUser(null); setPayLookupStatus('not_found'); return; }
          const r = await fetch(`${SURL}/functions/v1/admin-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: myAuthHeader() },
            body: JSON.stringify({ action: 'lookup_recipient', code: upper }),
          }).then(x => x.json()).catch(() => null);
          if (r?.found && r.id && r.id !== currentUser?.id) {
            setPayRecipientUser({ id: r.id, name: r.name, ownReferralCode: upper } as any);
            setPayLookupStatus('found');
          } else {
            setPayRecipientUser(null); setPayLookupStatus('not_found');
          }
        } catch { setPayRecipientUser(null); setPayLookupStatus('not_found'); }
      })();
  };

  const executePay = async () => {
      if (!payRecipientUser) return;
      if (payingRef.current || isPaySending) return; // candado síncrono anti doble-envío
      payingRef.current = true;
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
      finally { payingRef.current = false; setIsPaySending(false); }
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
      const ok = await verifyMfaCode(payVerifyCode);   // local o server (secreto cifrado)
      if (!ok) {
          setPayVerifyLoading(false);
          setPayVerifyError('Código incorrecto. Intenta nuevamente.');
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

  // Puerta 2FA de la CONFIRMACIÓN: el botón "Confirmar" llama aquí. Si el
  // usuario tiene 2FA activo (obligatorio para enviar), pide el código antes
  // de ejecutar el movimiento. Solo tras validarlo se corre handleSendSubmit.
  const requestSendConfirm = () => {
      if (isSending || sendingRef.current || mouvUnknown) return;
      if (mfaEnrolled && (mfaTotpSecret || mfaFactorId)) {
          setSendOtpCode(''); setSendOtpError(''); setSendOtpOpen(true);
          return;
      }
      // Sin 2FA no debería llegar acá (el envío está gateado), pero por
      // seguridad se ejecuta el flujo normal si por algún motivo no lo tiene.
      handleSendSubmit();
  };

  const confirmSendOtp = async () => {
      if (sendOtpLoading || sendOtpCode.length !== 6) return;
      setSendOtpLoading(true); setSendOtpError('');
      try {
          const ok = await verifyMfaCode(sendOtpCode);   // local o server (secreto cifrado)
          if (!ok) { setSendOtpError('Código incorrecto. Intenta nuevamente.'); setSendOtpCode(''); return; }
          sentOtpRef.current = sendOtpCode; // el servidor lo re-valida al mover el dinero
          setSendOtpOpen(false); setSendOtpCode('');
          handleSendSubmit();
      } catch (e: any) {
          setSendOtpError(e?.message || 'No se pudo verificar el código.');
      } finally {
          setSendOtpLoading(false);
      }
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
          // Comisión estimada para el pre-chequeo de saldo. Bre-B = fijo $1.200
          // ($800 de Mouv + $400 de utilidad); el 0,10% NO va aquí (ya se cobró
          // en el cargue). ACH = fijo $2.500. Si el servidor ya cotizó
          // (payoutQuote), se usa ese valor exacto.
          const feeCop = isBreb
              ? Number(payoutQuote?.feeCop ?? 1200)
              : 2500;
          if (getBalance(rail) < amount + feeCop) {
              sendingRef.current = false; setIsSending(false);
              showToast(`Saldo insuficiente en ${isBreb ? 'Bre-B' : 'ACH'}: necesitas ${(amount + feeCop).toLocaleString('es-CO')} COP (monto + comisión ${feeCop.toLocaleString('es-CO')}).`, 7000, 'error');
              return;
          }
          // UNA SOLA FUENTE. Antes la llave salía de sendContact y el nombre y
          // el documento de sendForm: dos objetos distintos describiendo a la
          // MISMA persona. Si se desincronizaban —y se desincronizaban— el
          // dinero salía hacia la llave de uno con la cédula de otro, y el
          // control de antecedentes se había hecho sobre el documento
          // equivocado. Si hay beneficiario inscrito, TODO sale de él.
          const d = destinatario;
          if (sendContact && !d.coherente) {
              sendingRef.current = false; setIsSending(false);
              showToast('Los datos del beneficiario no coinciden. Vuelve a elegirlo en la lista antes de enviar.', 8000, 'error');
              setSendStep(3);
              return;
          }
          // Sin motivo no sale: es lo que Finity pide y lo que decide la
          // factura o el documento soporte en Siigo.
          if (!sendForm.motivo) {
              sendingRef.current = false; setIsSending(false);
              showToast('Elige el motivo del envío antes de confirmar.', 5000, 'error');
              return;
          }
          // Ciudad y dirección del beneficiario: quedan en el movimiento y
          // de ahí van al tercero en Siigo (documento soporte).
          const direccion = d.cityCode ? { address: d.address ?? '', cityCode: d.cityCode, cityName: d.cityName, stateCode: d.stateCode } : {};
          const recipient = isBreb
              ? { keyType: d.brebKeyType ?? 'celular', key: d.brebKey ?? d.accountNumber, holderName: d.name, documentNumber: d.docNumber, reference: sendForm.reason, motivo: sendForm.motivo, ...direccion }
              : { bankCode: d.bank, accountType: (d.accountType === 'checking' ? 'corriente' : 'ahorros'), accountNumber: d.accountNumber, documentType: d.docType, documentNumber: d.docNumber, holderName: d.name, reference: sendForm.reason, motivo: sendForm.motivo, ...(sendContact?.finityId ? { finityId: sendContact.finityId } : {}), ...direccion };
          try {
              const r = await Promise.race([
                  callMouvProxy({ action: isBreb ? 'payout_breb' : 'payout_ach', userId: currentUser.id, amount, recipient, otp: sentOtpRef.current }),
                  new Promise<any>((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000)),
              ]);
              if (r?.ok) {
                  setSendResult({ ok: true, providerRef: r?.providerRef ?? null, feeCop: Number(r?.feeCop ?? (isBreb ? 1200 : 2500)), rail, at: new Date().toISOString() });
                  // Arranca la vigilancia rápida: 4 minutos preguntando cada 12 s
                  // por el desenlace de ESTE envío. Si se devolvió, el cliente
                  // se entera mientras todavía está en la pantalla.
                  vigilarHasta.current = Date.now() + 4 * 60 * 1000;
                  sendingRef.current = false; setIsSending(false); setSendStep(5);
                  refreshData?.();
                  return;
              }
              // Falló o aún sin cablear → el edge YA reintegró el saldo (refunded).
              sendingRef.current = false; setIsSending(false);
              const msg = r?.message || r?.error || 'La dispersión no se pudo completar.';
              setSendResult({ ok: false, message: String(msg), rail, at: new Date().toISOString() });
              setSendStep(5);
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
                  callGasfree({ action: 'my_send', userId: currentUser.id, toAddress: sendForm.accountNumber, amount, otp: sentOtpRef.current }),
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
              setSendResult({ ok: true, providerRef: resp?.traceId ?? null, feeCop: 0, rail: 'USDT', at: new Date().toISOString() });
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
      ]).then(() => { sendingRef.current = false; setIsSending(false); setSendResult({ ok: true, rail: sendForm.destinationCurrency === 'COP' ? sendSourceRail : sendForm.destinationCurrency, at: new Date().toISOString() }); setSendStep(5); })
        .catch(() => { sendingRef.current = false; setIsSending(false); showToast('Error al procesar el envío.', 4000, 'error'); });
  };


  const closeSendModal = () => {
      setIsSendModalOpen(false);
      setSendStep(1);
      setSendMode(null);
      setPayRecipientCode('');
      setPayRecipientUser(null);
      setPayLookupStatus('idle');
      // Se limpia TODO lo del destinatario. Antes se dejaban documentType y
      // documentNumber del envío anterior: un residuo de la persona a la que
      // se le acababa de pagar, esperando a mezclarse con el siguiente
      // beneficiario. Solo sobreviven país y moneda, que son preferencias.
      setSendForm({
        ...sendForm,
        amount: '', reason: 'Envío de dinero',
        beneficiaryName: '', beneficiaryType: 'personal',
        documentType: '', documentNumber: '',
        bankName: '', accountType: '', accountNumber: '',
      });
      setCashForm({ recipientName: '', docType: 'CC', docNumber: '', phone: '', city: '' });
      setCashReference('');
      setMouvDestId(null);
      setMouvUnknown(false);
      setSendResult(null);
      setSendOtpOpen(false); setSendOtpCode(''); setSendOtpError('');
      sendingRef.current = false;
      setContactSearch('');
      setSendSourceRail('COP');
      setSendContact(null);
      setSendMethodSel(null);
  };

  const abrir = (p?: EnviarPrefill) => {
    if (p?.form) setSendForm(prev => ({ ...prev, ...p.form }));
    if (p && 'contact' in p) setSendContact(p.contact ?? null);
    if (p && 'mode' in p) setSendMode(p.mode ?? null);
    if (p?.rail) setSendSourceRail(p.rail);
    setMouvDestId(null);
    setSendStep(p?.step ?? 1);
    setIsSendModalOpen(true);
  };
  useImperativeHandle(ref, () => ({ abrir, cerrar: closeSendModal, abierto: () => isSendModalOpen }));

  return (
    <>
      {sendOtpOpen && (
          <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(4,5,5,0.72)', backdropFilter: 'blur(4px)' }}>
              <div style={{ width: '100%', maxWidth: 400, background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: '26px 24px', fontFamily: "'Archivo', system-ui, sans-serif" }} className="rounded-t-3xl sm:rounded-[18px]">
                  <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                      <div style={{ width: 42, height: 42, borderRadius: '50%', border: '1.5px solid rgba(74,222,128,0.4)', background: 'rgba(74,222,128,0.08)', display: 'grid', placeItems: 'center' }}>
                          <ShieldCheck size={20} color="#4ADE80" />
                      </div>
                      <button type="button" onClick={() => { if (!sendOtpLoading) { setSendOtpOpen(false); setSendOtpCode(''); setSendOtpError(''); } }} style={{ color: '#878E88' }} className="hover:text-white p-1"><X size={20} /></button>
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.4px', color: '#F4F4F2', marginTop: 14 }}>Confirma con tu 2FA</h3>
                  <p style={{ fontSize: 13, color: '#878E88', marginTop: 6, lineHeight: 1.5 }}>Por tu seguridad, ingresa el código de 6 dígitos de tu app de autenticación para autorizar este envío.</p>
                  <div style={{ marginTop: 18 }}>
                      <CodeInput
                          value={sendOtpCode}
                          onChange={setSendOtpCode}
                          onComplete={() => { if (!sendOtpLoading) confirmSendOtp(); }}
                          status={sendOtpLoading ? 'verifying' : sendOtpError ? 'error' : 'idle'}
                          tone="dark"
                          autoFocus
                          disabled={sendOtpLoading}
                          aria="Código para autorizar el envío"
                      />
                  </div>
                  {sendOtpError && <p style={{ fontSize: 12.5, color: '#F4F4F2', marginTop: 10, fontWeight: 600 }}>{sendOtpError}</p>}
                  <button
                      type="button"
                      onClick={confirmSendOtp}
                      disabled={sendOtpCode.length !== 6 || sendOtpLoading}
                      className="lincoin-btn-white transition-colors"
                      style={{ width: '100%', marginTop: 18, padding: '13px 0', borderRadius: 11, fontSize: 14, fontWeight: 700, border: 'none', opacity: (sendOtpCode.length !== 6 || sendOtpLoading) ? 0.5 : 1 }}
                  >
                      {sendOtpLoading ? 'Verificando…' : 'Autorizar y enviar'}
                  </button>
                  <div className="flex items-center justify-center" style={{ gap: 8, marginTop: 14 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ADE80' }} />
                      <span style={{ fontSize: 11.5, color: '#878E88' }}>Operación protegida · verificación en dos pasos</span>
                  </div>
              </div>
          </div>
      )}
      {isSendModalOpen && (
          <div className="fixed inset-0 z-50 p-4" style={{ background: 'rgba(4,5,4,0.72)', display: 'grid', placeItems: 'center' }}>
              <div className="w-full animate-in zoom-in-95 duration-300 flex flex-col" role="dialog" aria-modal="true"
                  style={{ maxWidth: 476, background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, overflow: 'hidden', maxHeight: '92vh', fontFamily: "'Archivo', system-ui, sans-serif" }}>
                  {/* Cabecera + progreso (diseño Flujo Enviar: 4 pasos).
                      En el paso 5 (éxito/fallo, no-cash) se OCULTA: el título
                      vive una sola vez dentro de la cabecera del resultado. */}
                  {!(sendStep === 5 && sendMode !== 'cash') && (
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
                  )}
                  <div style={{ padding: sendStep === 5 && sendMode !== 'cash' ? '0 22px 22px' : '6px 22px 22px', overflowY: 'auto' }}>

                      {/* STEP 1: DESDE (cuenta + rieles con saldo) + monto */}
                      {sendStep === 1 && (() => {
                          const isUsdt = sendForm.destinationCurrency === 'USD';
                          // Un envío sale de UN SOLO riel (lo define el método del
                          // paso 2), así que lo enviable de una vez es el riel MAYOR,
                          // no la suma — 'Todo' con la suma nunca pasaba la validación.
                          const avail = isUsdt ? displayBalance('USD') : Math.max(getBalance('COP'), getBalance('COP_BREB'), getBalance('COP_ACH'));
                          const quicks = isUsdt ? [5, 20, 50] : [10000, 50000, 200000];
                          const setAmt = (n: number) => setSendForm({ ...sendForm, amount: formatInputNumber(String(Math.floor(n))) });
                          return (
                          <div className="space-y-4">
                              {/* DESDE — primero el PAÍS (activables desde admin), luego la
                                  cuenta/riel dentro del país. Hoy: Colombia (COP) y USA (USDT). */}
                              <div>
                                  <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: '#878E88' }}>DESDE</label>
                                  {(() => {
                                      const cs: Record<string, string> = { Colombia: 'on', 'Estados Unidos': 'on', ...((config as any).countryStatus || {}) };
                                      const enabled = ['Colombia', 'Estados Unidos', 'México', 'Brasil', 'Perú', 'Chile', 'Venezuela'].filter(c => cs[c] === 'on');
                                      // Bandera REAL (flagcdn, como en el resto de la app) — los
                                      // degradados caseros se veían mal (EE. UU. parecía Perú).
                                      const ISO: Record<string, string> = {
                                          Colombia: 'co', 'Estados Unidos': 'us', 'México': 'mx',
                                          Brasil: 'br', 'Perú': 'pe', Chile: 'cl', Venezuela: 've',
                                      };
                                      return (
                                      <>
                                      {/* Selector de país */}
                                      <div className="flex flex-wrap" style={{ gap: 6, marginTop: 6 }}>
                                          {enabled.map(country => {
                                              const sel = country === 'Estados Unidos' ? isUsdt : !isUsdt;
                                              return (
                                                  <button key={country} type="button"
                                                      onClick={() => setSendForm(f => country === 'Estados Unidos'
                                                          ? { ...f, destinationCountry: 'Estados Unidos', destinationCurrency: 'USD' }
                                                          : { ...f, destinationCountry: 'Colombia', destinationCurrency: 'COP' })}
                                                      className="flex items-center gap-2"
                                                      style={{ borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: sel ? 700 : 500, border: sel ? '1px solid rgba(74,222,128,0.35)' : '1px solid rgba(255,255,255,0.1)', background: sel ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.03)', color: sel ? '#F4F4F2' : '#878E88' }}>
                                                      <span style={{ width: 16, height: 16, borderRadius: '50%', overflow: 'hidden', display: 'block', flexShrink: 0, background: '#2E3330' }}>
                                                          <img src={flagUrl(ISO[country] ?? 'co')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                      </span>
                                                      {country}
                                                  </button>
                                              );
                                          })}
                                      </div>
                                      {/* Cuenta dentro del país */}
                                      <div style={{ marginTop: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.025)', borderRadius: 13, padding: '13px 15px' }}>
                                          <div className="flex items-center justify-between gap-2 flex-wrap">
                                              <div className="flex items-center gap-2.5">
                                                  {isUsdt
                                                      ? <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'block', background: '#26A17B', color: '#fff', fontWeight: 800, fontSize: 11, textAlign: 'center', lineHeight: '26px' }}>₮</span>
                                                      : <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'block', overflow: 'hidden', background: '#2E3330' }}>
                                                            <img src={flagUrl('co')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                        </span>}
                                                  <div>
                                                      <p style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>{isUsdt ? 'Dólar digital' : 'Peso colombiano'}</p>
                                                      <p style={{ fontSize: 11, color: '#878E88' }}>{isUsdt ? 'USDT · disponible' : 'Máximo por envío (tu cuenta con más saldo) · el método define de cuál sale'}</p>
                                                  </div>
                                              </div>
                                              <p style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.6px', color: '#F4F4F2' }}>{isUsdt ? Number(avail).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(avail).toLocaleString('es-CO')}</p>
                                          </div>
                                          <div className="flex flex-wrap" style={{ gap: 6, marginTop: 12 }}>
                                              {!isUsdt ? (
                                                  /* Saldos INFORMATIVOS — ya no se elige billetera aquí:
                                                     el método del paso 2 define de cuál cuenta sale. */
                                                  ([
                                                      { key: 'COP', label: 'Saldo Lincoin' },
                                                      { key: 'COP_BREB', label: 'Bre-B' },
                                                      { key: 'COP_ACH', label: 'ACH' },
                                                  ] as const).map(r => (
                                                      <span key={r.key}
                                                          style={{ borderRadius: 999, padding: '6px 12px', fontSize: 11.5, fontWeight: 500, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#878E88' }}>
                                                          {r.label} · <b style={{ color: '#F4F4F2', fontWeight: 700 }}>{Math.round(getBalance(r.key)).toLocaleString('es-CO')}</b>
                                                      </span>
                                                  ))
                                              ) : (
                                                  <>
                                                      <button type="button"
                                                          style={{ borderRadius: 999, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, border: '1px solid rgba(74,222,128,0.35)', background: 'rgba(74,222,128,0.06)', color: '#F4F4F2' }}>
                                                          ₮ USDT · {Number(displayBalance('USD')).toLocaleString('es-CO', { maximumFractionDigits: 2 })}
                                                      </button>
                                                      <span className="flex items-center gap-1.5" style={{ borderRadius: 999, padding: '6px 12px', fontSize: 11.5, fontWeight: 500, border: '1px dashed rgba(255,255,255,0.14)', color: '#878E88', opacity: 0.8 }}>
                                                          Cuenta USD <span style={{ border: '1px solid rgba(255,255,255,0.14)', fontSize: 8, fontWeight: 700, letterSpacing: '0.5px', padding: '1px 6px', borderRadius: 999 }}>PRÓXIMAMENTE</span>
                                                      </span>
                                                  </>
                                              )}
                                          </div>
                                      </div>
                                      </>
                                      );
                                  })()}
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
                      {sendStep === 2 && (() => {
                          // El MÉTODO define de qué cuenta sale la plata — aquí se
                          // muestra el SALDO de cada una y solo se puede elegir la
                          // que cubra el monto + su comisión.
                          const amtStep2 = getRawAmount(sendForm.amount);
                          const METHODS = [
                              { key: 'breb', title: 'Bre-B a cuenta bancaria', pill: 'SEGUNDOS', time: 'Por llave a cualquier banco · en segundos', rail: 'COP_BREB', railLabel: 'Bre-B', fee: 1200 },
                              { key: 'ach', title: 'ACH tradicional', pill: null, time: `Ciclos ACH · L–V sin festivos · ${achEtaShort()}`, rail: 'COP_ACH', railLabel: 'ACH', fee: 2500 },
                              { key: 'pay', title: 'A otro usuario de Lincoin', pill: 'SIN COMISIÓN', time: 'Por ID o correo · instantáneo, 24/7', rail: 'COP', railLabel: 'Saldo Lincoin', fee: 0 },
                              { key: 'cash', title: 'Retiro en punto físico', pill: null, time: 'Efectivo en corresponsales aliados', rail: 'COP', railLabel: 'Saldo Lincoin', fee: 0 },
                          ] as const;
                          const selMeta = METHODS.find(x => x.key === sendMethodSel);
                          const selOk = !!selMeta && getBalance(selMeta.rail) >= amtStep2 + selMeta.fee;
                          return (
                          <div className="space-y-4">
                              <div className="space-y-2">
                                  {METHODS.map(m => {
                                      const bal = getBalance(m.rail);
                                      const need = amtStep2 + m.fee;
                                      const enough = bal >= need;
                                      const sel = sendMethodSel === m.key;
                                      return (
                                          <button key={m.key} type="button" onClick={() => { if (enough) setSendMethodSel(m.key as any); }}
                                              className="w-full flex items-center gap-3 text-left transition-colors"
                                              style={{ padding: '13px 15px', borderRadius: 12, opacity: enough ? 1 : 0.55, cursor: enough ? 'pointer' : 'not-allowed',
                                                  border: sel ? '1px solid rgba(74,222,128,0.35)' : '1px solid rgba(255,255,255,0.1)', background: sel ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.025)' }}>
                                              <span className="flex-1 min-w-0">
                                                  <span className="flex items-center gap-2">
                                                      <span style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>{m.title}</span>
                                                      {m.pill && <span style={{ border: '1px solid rgba(74,222,128,0.3)', color: '#4ADE80', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.6px', padding: '2px 6px', borderRadius: 999, whiteSpace: 'nowrap' }}>{m.pill}</span>}
                                                  </span>
                                                  <span style={{ display: 'block', fontSize: 11.5, color: '#878E88', marginTop: 2 }}>
                                                      {m.time}{m.fee > 0 ? ` · $${m.fee.toLocaleString('es-CO')} por envío` : ''}
                                                  </span>
                                                  <span style={{ display: 'block', fontSize: 11.5, marginTop: 3, fontWeight: 600, color: enough ? '#4ADE80' : '#878E88' }}>
                                                      Saldo {m.railLabel}: ${Math.round(bal).toLocaleString('es-CO')}
                                                      {!enough && amtStep2 > 0 ? ` · te faltan $${Math.ceil(need - bal).toLocaleString('es-CO')}` : ''}
                                                  </span>
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
                                              setSendSourceRail('COP');
                                          }
                                          setSendStep(3);
                                      }}
                                      disabled={!sendMethodSel || !selOk}
                                      className="lincoin-btn-white transition-colors"
                                      style={{ flex: 1.5, fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 10, border: 'none', opacity: (sendMethodSel && selOk) ? 1 : 0.45, cursor: (sendMethodSel && selOk) ? 'pointer' : 'not-allowed' }}>
                                      Continuar
                                  </button>
                              </div>
                          </div>
                          );
                      })()}

                      {/* STEP 3 BANK: beneficiarios inscritos como tarjetas (diseño) */}
                      {sendStep === 3 && sendMode === 'bank' && (() => {
                          const all: any[] = ((currentUser as any)?.raw_data?.mouvContacts) ?? ((currentUser as any)?.mouvContacts) ?? [];
                          const railKind = sendSourceRail === 'COP_ACH' ? 'ach' : 'breb';
                          // Solo Colombia y del riel elegido en el paso 2.
                          const myContacts = all.filter((c: any) => c.accountKind !== 'wallet' && (c.country ?? 'Colombia') === 'Colombia' && ((c.destKind ?? 'ach') === railKind));
                          const q = contactSearch.trim().toLowerCase();
                          const list = myContacts.filter((c: any) => !q || `${c.name} ${c.bank} ${c.docNumber} ${c.accountNumber} ${c.brebKey ?? ''}`.toLowerCase().includes(q));
                          const goContacts = () => { closeSendModal(); setActiveView('contactos'); };
                          const maskAcc = (a: string) => (a?.length > 4 ? `···${a.slice(-4)}` : a);
                          // El veredicto de antecedentes de cada beneficiario.
                          // El bloqueo real vive en el servidor y ahí se corta
                          // el envío igual; pero dejar elegir a alguien que va a
                          // rebotar es hacerle recorrer tres pasos y cobrarle el
                          // viaje para nada. Se dice acá, antes de empezar.
                          // Lo del servidor manda; la copia local es el respaldo
                          // mientras la consulta viaja.
                          const amlBenefs: Record<string, any> = amlSrv ?? ((currentUser as any)?.raw_data?.tusdatos?.beneficiarios) ?? {};
                          const amlDe = (c: any) => {
                              const doc = String(c?.docNumber ?? '').replace(/\D/g, '');
                              return doc ? amlBenefs[doc] : null;
                          };
                          // Solo un veredicto EXPLÍCITO frena. Sin consulta, en
                          // curso o sin resultado, se deja pasar: el servidor
                          // tiene la última palabra y no se acusa a nadie por
                          // falta de información.
                          // Mismo criterio que la lista de beneficiarios y que
                          // el servidor: riesgo alto y fallas de identidad
                          // frenan siempre, no solo cuando quedó guardado un
                          // 'operable: false'.
                          const amlFrena = (c: any) => {
                              const k = amlDe(c);
                              if (!k) return false;
                              // SIN RESULTADO NO SE ENVÍA. Mientras la consulta
                              // corre no se deja elegir: si el veredicto llega
                              // negativo con la plata ya enviada, el control no
                              // sirvió de nada. Tarda cerca de un minuto.
                              if (k.estado !== 'finalizado') return true;
                              return k.operable === false || k.categoria === 'alto'
                                  || k.nombreCoincide === false || k.documentoVigente === false;
                          };
                          const amlEsperando = (c: any) => {
                              const k = amlDe(c);
                              return !!k && k.estado !== 'finalizado';
                          };
                          // El resultado de antecedentes de cada beneficiario,
                          // con el mismo lenguaje que la lista de
                          // beneficiarios. Se muestra SIEMPRE que haya
                          // veredicto, no solo cuando es malo: antes un
                          // beneficiario de riesgo bajo y uno sin consultar se
                          // veían idénticos, los dos con "VERIFICADA" en verde
                          // —que además habla del banco, no del AML.
                          type Aml = { t: string; tono: 'rojo' | 'ambar' | 'verde' | 'gris' } | null;
                          const amlEtiqueta = (c: any): Aml => {
                              const k = amlDe(c);
                              if (!k) return null;
                              const est = String(k.estado ?? '');
                              // Mientras no haya resultado no se puede enviar, así
                              // que la etiqueta lo dice: "consultando" a secas
                              // parecía un detalle informativo y no la razón por
                              // la que la fila está deshabilitada.
                              if (est === 'procesando' || !est) return { t: 'AML · CONSULTANDO · ESPERA', tono: 'gris' };
                              if (est !== 'finalizado') return { t: 'AML · SIN RESULTADO · ESPERA', tono: 'gris' };
                              const frena = amlFrena(c);
                              const fin = (s: string) => frena ? `${s} · BLOQUEADO` : s;
                              if (k.nombreCoincide === false) return { t: `AML · ${fin('NOMBRE INCORRECTO')}`, tono: 'rojo' };
                              if (k.documentoVigente === false) return { t: `AML · ${fin('DOCUMENTO NO VIGENTE')}`, tono: 'rojo' };
                              if (k.categoria === 'alto') return { t: `AML · ${fin('RIESGO ALTO')}`, tono: 'rojo' };
                              if (k.categoria === 'medio') return { t: `AML · ${frena ? 'RIESGO MEDIO · EN REVISIÓN' : 'RIESGO MEDIO'}`, tono: 'ambar' };
                              if (k.categoria === 'bajo') return { t: 'AML · RIESGO BAJO', tono: 'verde' };
                              if (k.categoria === 'ninguno' || k.categoria === 'informativo') return { t: 'AML · SIN HALLAZGOS', tono: 'verde' };
                              if (k.categoria === 'sin_validar') return { t: 'AML · SIN VALIDAR', tono: 'gris' };
                              return { t: 'AML · SIN RESULTADO', tono: 'gris' };
                          };
                          const AML_TONO = {
                              rojo: { b: 'rgba(248,113,113,0.32)', c: '#F87171' },
                              ambar: { b: 'rgba(251,191,36,0.32)', c: '#FBBF24' },
                              verde: { b: 'rgba(74,222,128,0.3)', c: '#4ADE80' },
                              gris: { b: 'rgba(255,255,255,0.14)', c: '#878E88' },
                          } as const;
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
                                  {myContacts.length > 0 && (
                                      <div className="relative">
                                          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#878E88' }} />
                                          <input value={contactSearch} onChange={e => setContactSearch(e.target.value)} placeholder="Buscar por nombre, banco o cuenta…"
                                              style={{ width: '100%', height: 40, paddingLeft: 36, paddingRight: 12, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 9, color: '#F4F4F2', fontSize: 13, outline: 'none' }} />
                                      </div>
                                  )}
                                  <div className="space-y-2" style={{ maxHeight: 300, overflowY: 'auto' }}>
                                      {list.map((c: any) => {
                                          const st = contactStatus(c);
                                          const aml = amlEtiqueta(c);
                                          const selectable = st === 'aprobada' && !amlFrena(c);
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
                                                  {/* Dos cosas distintas que antes competían por el
                                                      mismo espacio: el estado de la CUENTA (banco) y
                                                      el de la PERSONA (antecedentes). Van una debajo
                                                      de la otra, y el AML abajo porque es el que
                                                      decide si el envío sale. */}
                                                  <span className="flex flex-col items-end shrink-0" style={{ gap: 4 }}>
                                                      {st === 'aprobada'
                                                          ? <span style={{ border: '1px solid rgba(74,222,128,0.3)', color: '#4ADE80', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>VERIFICADA</span>
                                                          : <span style={{ border: '1px solid rgba(255,255,255,0.14)', color: '#878E88', fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{st === 'rechazada' ? 'RECHAZADA' : 'EN VALIDACIÓN'}</span>}
                                                      {aml && (
                                                          <span style={{ border: `1px solid ${AML_TONO[aml.tono].b}`, color: AML_TONO[aml.tono].c, fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{aml.t}</span>
                                                      )}
                                                  </span>
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
                          const goContacts = () => { closeSendModal(); setActiveView('contactos'); };
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
                                                      // También el contacto: si no, sobrevive el
                                                      // beneficiario bancario elegido antes y
                                                      // `destinatario` sigue describiéndolo a él.
                                                      setSendContact(c);
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
                          // Todo de `destinatario`: con un beneficiario inscrito, la
                          // pantalla no puede mostrar la llave de uno y el nombre de otro.
                          const d = destinatario;
                          const destLine = isBrebM
                              ? `Bre-B · ${d.brebKey ? `···${String(d.brebKey).slice(-4)}` : ''}${d.bank && !String(d.bank).startsWith('Bre-B') ? ` · ${d.bank}` : ''}`
                              : `${d.bank} · ${d.accountType === 'checking' ? 'Corriente' : 'Ahorros'} ···${String(d.accountNumber || '').slice(-4)}`;
                          return (
                          <div className="space-y-4">
                              {/* Destinatario + Editar — con los datos COMPLETOS que
                                  identifican el destino (llave/cuenta y cédula), para
                                  confirmar que la plata va a la persona correcta. */}
                              <div style={{ padding: '13px 15px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.025)' }}>
                                  <div className="flex items-center gap-3">
                                      <span style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(140deg, #2E3330, #1A1D1B)', border: '1px solid rgba(255,255,255,0.12)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                                          <span style={{ color: '#878E88', fontWeight: 800, fontSize: 13 }}>{initials(d.name)}</span>
                                      </span>
                                      <div className="flex-1 min-w-0">
                                          <p style={{ fontSize: 14, fontWeight: 700, color: '#F4F4F2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</p>
                                          <p style={{ fontSize: 11.5, color: '#878E88', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{destLine}</p>
                                      </div>
                                      <button onClick={() => setSendStep(3)} style={{ fontSize: 12.5, fontWeight: 600, color: '#F4F4F2', textDecoration: 'underline', flexShrink: 0 }}>Editar</button>
                                  </div>
                                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 11, paddingTop: 10 }} className="space-y-1.5">
                                      {isBrebM ? (
                                          <>
                                              <div className="flex items-center justify-between gap-3">
                                                  <span style={{ fontSize: 11.5, color: '#878E88' }}>Llave Bre-B{d.brebKeyType ? ` (${d.brebKeyType})` : ''}</span>
                                                  <span style={{ fontSize: 12, fontWeight: 700, color: '#F4F4F2', fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'right' }}>{d.brebKey ?? '—'}</span>
                                              </div>
                                          </>
                                      ) : (
                                          <>
                                              <div className="flex items-center justify-between gap-3">
                                                  <span style={{ fontSize: 11.5, color: '#878E88' }}>Banco</span>
                                                  <span style={{ fontSize: 12, fontWeight: 700, color: '#F4F4F2' }}>{d.bank || '—'} · {d.accountType === 'checking' ? 'Corriente' : 'Ahorros'}</span>
                                              </div>
                                              <div className="flex items-center justify-between gap-3">
                                                  <span style={{ fontSize: 11.5, color: '#878E88' }}>Cuenta</span>
                                                  <span style={{ fontSize: 12, fontWeight: 700, color: '#F4F4F2', fontFamily: 'monospace' }}>{d.accountNumber || '—'}</span>
                                              </div>
                                          </>
                                      )}
                                      <div className="flex items-center justify-between gap-3">
                                          <span style={{ fontSize: 11.5, color: '#878E88' }}>Documento</span>
                                          <span style={{ fontSize: 12, fontWeight: 700, color: '#F4F4F2', fontFamily: 'monospace' }}>{(d.docType || 'CC')} {d.docNumber || '—'}</span>
                                      </div>
                                  </div>
                              </div>
                              {/* RECIBE */}
                              <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 13, padding: '15px 16px', background: 'rgba(255,255,255,0.025)' }}>
                                  <span style={{ color: '#878E88', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px' }}>RECIBE</span>
                                  <p style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-1.2px', color: '#F4F4F2', marginTop: 4 }}>{formatMoney(amt, 'COP')} <span style={{ fontSize: 15, color: '#878E88', fontWeight: 700 }}>COP</span></p>
                              </div>
                              {/* Desglose — la comisión del proveedor se cobra al cliente */}
                              <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 13, overflow: 'hidden' }}>
                                  {[
                                      { l: 'Sale de', v: `${sendSourceRail === 'COP' ? 'Saldo Lincoin' : sendSourceRail === 'COP_BREB' ? 'Bre-B' : 'ACH'} · COP` },
                                      { l: `Comisión fija ${railLbl} · sin variable`, v: payoutQuote?.loading ? 'cotizando…'
                                          : payoutQuote?.error ? '—'
                                          : payoutQuote?.feeCop != null ? `${formatMoney(payoutQuote.feeCop, 'COP')} COP`
                                          : 'Precio fijo · al confirmar' },
                                      { l: 'Llega', v: isBrebM ? 'En segundos' : achEta() },
                                  ].map((row, i) => (
                                      <div key={row.l} className="flex items-center justify-between" style={{ padding: '11px 16px', fontSize: 13, borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
                                          <span style={{ color: '#878E88' }}>{row.l}</span>
                                          <span style={{ color: '#F4F4F2', fontWeight: 700 }}>{row.v}</span>
                                      </div>
                                  ))}
                                  <div className="flex items-center justify-between" style={{ padding: '11px 16px', fontSize: 13, borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
                                      <span style={{ color: '#878E88' }}>Total que sale</span>
                                      <span style={{ color: '#4ADE80', fontWeight: 700 }}>{formatMoney(amt + (payoutQuote?.feeCop ?? 0), 'COP')} COP{payoutQuote?.feeCop == null && !isBrebM ? ' + comisión' : ''}</span>
                                  </div>
                              </div>
                              {payoutQuote?.error && <p style={{ fontSize: 11.5, color: '#878E88' }}>No se pudo cotizar la comisión ({payoutQuote.error}) — se calculará al confirmar.</p>}
                              {/* MOTIVO DEL ENVÍO. Obligatorio: se le manda a
                                  Finity con la orden y decide qué documento
                                  sale en Siigo (Contabilidad → Configuración). */}
                              <div style={{ border: `1px solid ${sendForm.motivo ? 'rgba(255,255,255,0.1)' : 'rgba(251,191,36,0.4)'}`, borderRadius: 13, padding: '13px 16px', background: 'rgba(255,255,255,0.025)' }}>
                                  <span style={{ color: '#878E88', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px' }}>MOTIVO DEL ENVÍO</span>
                                  <select value={sendForm.motivo} onChange={e => setSendForm(f => ({ ...f, motivo: e.target.value }))}
                                      style={{ width: '100%', marginTop: 8, fontSize: 13.5, color: sendForm.motivo ? '#F4F4F2' : '#878E88', background: '#121413', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 9, padding: '10px 12px', outline: 'none', appearance: 'auto' }}>
                                      <option value="">Elige el motivo…</option>
                                      {MOTIVOS_ENVIO.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                                  </select>
                                  <p style={{ fontSize: 11, color: '#6b716c', marginTop: 6, lineHeight: 1.45 }}>Va con la orden al banco y define qué documento se emite en tu contabilidad.</p>
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
                                      <button onClick={requestSendConfirm} disabled={isSending || !sendForm.motivo} title={!sendForm.motivo ? 'Elige el motivo del envío' : undefined} className="lincoin-btn-white transition-colors flex items-center justify-center gap-2" style={{ flex: 1.5, fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 10, border: 'none', opacity: (isSending || !sendForm.motivo) ? 0.45 : 1 }}>
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
                                      <button onClick={requestSendConfirm} disabled={isSending} style={{ color: '#FFFFFF' }} className="flex-1 py-3 bg-[#0C0E0D] font-bold rounded-xl hover:bg-[#161A17] shadow-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">{isSending ? <><Loader2 className="animate-spin" size={18} /> Procesando… no cierres</> : <><Send size={18}/> Confirmar</>}</button>
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

                      {/* STEP 5: Resultado del envío — "Envío en camino" (o fallo).
                          Diseño: cabecera con check de BORDE (verde puntual, nunca
                          relleno grande), monto, tarjeta del destinatario con pill
                          de estado, filas de detalle (referencia/fecha/costo) y
                          botonera Comprobante + Finalizar. Todos los datos son de
                          la transacción real (sendResult + sendForm). */}
                      {sendStep === 5 && sendMode !== 'cash' && (() => {
                          const ok = sendResult?.ok !== false;
                          const isCop = sendForm.destinationCurrency === 'COP';
                          const isBrebS = (sendResult?.rail ?? sendSourceRail) === 'COP_BREB';
                          const amt = getRawAmount(sendForm.amount);
                          const isWalletSend = sendMode === 'wallet' || sendResult?.rail === 'USDT';
                          // El comprobante es lo que el cliente guarda como soporte:
                          // tiene que decir lo mismo que la confirmación y que el
                          // pago. Salía de `sendForm` con `sendContact` de respaldo,
                          // o sea la misma mezcla de dos fuentes.
                          const dR = destinatario;
                          const name = (dR.name || (isWalletSend ? 'Wallet externa' : 'Destinatario')).trim();
                          const initials = name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'LN';
                          const acctRaw = String((isBrebS ? (dR.brebKey ?? dR.accountNumber) : dR.accountNumber) ?? '');
                          const last4 = acctRaw.slice(-4);
                          const methodLine = isWalletSend ? `Wallet ···${last4} · TRC-20`
                              : !isCop ? `Cuenta ···${last4}`
                              : isBrebS ? `Llave ···${last4} · Bre-B`
                              : `${dR.bank ?? 'Banco'} ···${last4} · ACH`;
                          const subOk = isWalletSend
                              ? 'Tu envío ya salió de tu billetera. Te avisamos cuando la red lo confirme.'
                              : !isCop
                              ? 'Tu envío está en proceso. Te avisamos cuando el banco confirme.'
                              : isBrebS
                              ? 'Bre-B acredita en segundos. Te avisamos cuando el banco confirme.'
                              : `ACH ${achEtaShort()}. Te avisamos cuando el banco confirme.`;
                          const ref = sendResult?.providerRef ? String(sendResult.providerRef) : '';
                          const feeCop = Number(sendResult?.feeCop ?? (isCop ? (isBrebS ? 1200 : 2500) : 0));
                          const at = sendResult?.at ? new Date(sendResult.at) : new Date();
                          const dateLabel = `Hoy, ${at.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} · ${at.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`;
                          const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 2px', borderTop: '1px solid rgba(255,255,255,0.06)' };
                          return (
                          <div className="animate-in zoom-in-95 duration-300">
                              {/* 1. Cabecera de éxito/fallo */}
                              <div className="text-center" style={{ padding: '32px 28px 24px', margin: '0 -22px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: ok ? 'radial-gradient(circle at 50% 0%, rgba(74,222,128,0.1), transparent 60%)' : 'none' }}>
                                  <div style={{ width: 52, height: 52, margin: '0 auto 14px', borderRadius: '50%', border: ok ? '1.5px solid rgba(74,222,128,0.4)' : '1.5px solid rgba(255,255,255,0.14)', background: ok ? 'rgba(74,222,128,0.08)' : 'transparent', display: 'grid', placeItems: 'center' }}>
                                      {ok
                                          ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="#4ADE80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                          : <X size={22} style={{ color: '#F4F4F2' }} strokeWidth={2} />}
                                  </div>
                                  <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px', color: '#F4F4F2' }}>{ok ? 'Envío en camino' : 'No pudimos completar el envío'}</h2>
                                  <p style={{ fontSize: 13.5, color: '#878E88', marginTop: 6, lineHeight: 1.45 }}>
                                      {ok ? subOk : (sendResult?.message || 'El envío no se pudo completar y tu saldo fue devuelto.')}
                                  </p>
                              </div>
                              {/* 2. Monto */}
                              <div className="text-center" style={{ padding: '22px 0 18px' }}>
                                  <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-1.2px', color: '#F4F4F2' }}>
                                      {isCop && !isWalletSend ? formatMoney(amt, 'COP') : Number(amt || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                  <span style={{ fontSize: 22, fontWeight: 800, color: '#878E88', marginLeft: 8 }}>{isCop && !isWalletSend ? 'COP' : displayCurrency(sendForm.destinationCurrency)}</span>
                              </div>
                              {/* 3. Tarjeta del destinatario */}
                              <div className="flex items-center" style={{ gap: 11, border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, background: 'rgba(255,255,255,0.02)', padding: '12px 14px' }}>
                                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(140deg, #2E3330, #1A1D1B)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800, color: '#878E88', flexShrink: 0 }}>{initials}</div>
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                      <p style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</p>
                                      <p className="flex items-center" style={{ gap: 6, fontSize: 11.5, color: '#878E88', marginTop: 2 }}>
                                          {isCop && !isWalletSend && (
                                              <span style={{ width: 13, height: 13, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, display: 'block', background: '#2E3330' }}>
                                                  <img src={flagUrl('co')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                              </span>
                                          )}
                                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{methodLine}</span>
                                      </p>
                                  </div>
                                  <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.8px', padding: '4px 9px', borderRadius: 999, flexShrink: 0, border: ok ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(255,255,255,0.14)', color: ok ? '#4ADE80' : '#878E88' }}>{ok ? 'EN CAMINO' : 'FALLIDO'}</span>
                              </div>
                              {/* 4. Filas de detalle */}
                              <div style={{ marginTop: 14 }}>
                                  {ref && (
                                      <div style={{ ...rowStyle, borderTop: 'none' }}>
                                          <span style={{ fontSize: 12.5, color: '#878E88' }}>Referencia</span>
                                          <button onClick={() => { navigator.clipboard?.writeText(ref).then(() => showToast('Referencia copiada')).catch(() => {}); }} className="flex items-center" style={{ gap: 6, fontSize: 12.5, fontWeight: 600, color: '#F4F4F2', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                                              {ref.length > 16 ? `${ref.slice(0, 8)}…${ref.slice(-6)}` : ref}
                                              <Copy size={12} style={{ color: '#878E88' }} strokeWidth={1.7} />
                                          </button>
                                      </div>
                                  )}
                                  <div style={ref ? rowStyle : { ...rowStyle, borderTop: 'none' }}>
                                      <span style={{ fontSize: 12.5, color: '#878E88' }}>Fecha</span>
                                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#F4F4F2' }}>{dateLabel}</span>
                                  </div>
                                  <div style={rowStyle}>
                                      <span style={{ fontSize: 12.5, color: '#878E88' }}>Costo del envío</span>
                                      {feeCop > 0
                                          ? <span style={{ fontSize: 12.5, fontWeight: 600, color: '#F4F4F2' }}>{formatMoney(feeCop, 'COP')} COP</span>
                                          : <span style={{ fontSize: 12.5, fontWeight: 700, color: '#4ADE80' }}>Gratis</span>}
                                  </div>
                              </div>
                              {/* 5. Botonera */}
                              <div className="flex" style={{ gap: 9, marginTop: 16 }}>
                                  {ok ? (
                                      <>
                                      <button onClick={() => {
                                          // Abrir el detalle real del envío (con descarga de comprobante
                                          // funcional) en vez de cerrar y mandar a Movimientos.
                                          // Estado REAL para el comprobante: se busca el movimiento real
                                          // por su referencia del proveedor; si aún no sincroniza, se usa
                                          // el estado por riel (USDT y Bre-B confirman al instante; ACH
                                          // queda "Procesando" hasta que el banco liquide). Antes se ponía
                                          // 'Completado' fijo — el comprobante decía Completado con el pago
                                          // aún en proceso.
                                          const realMov: any = sendResult?.providerRef
                                              ? movements.find((m: any) => m?.providerRef === sendResult.providerRef || m?.raw_data?.providerRef === sendResult.providerRef)
                                              : null;
                                          // NUNCA 'Completado' por defecto. Acá seguía puesto para
                                          // wallet y Bre-B, y es falso: el servidor deja toda
                                          // dispersión en 'Procesando' al enviar, justamente porque
                                          // el 200 del proveedor sólo significa "aceptada" y puede
                                          // terminar DEVUELTA minutos después.
                                          //
                                          // Un comprobante que dice Completado sin que nadie lo
                                          // haya confirmado es lo peor que puede emitir esto: el
                                          // cliente se lo manda al beneficiario como prueba de un
                                          // pago que quizá no ocurrió. Si todavía no encontramos el
                                          // movimiento real, lo cierto es 'Procesando'.
                                          const receiptStatus = realMov?.status || 'Procesando';
                                          const receiptTx = {
                                              id: sendResult?.providerRef || `TX-${Date.now()}`,
                                              type: isWalletSend ? 'send' : 'dispersion',
                                              amount: amt,
                                              currency: isWalletSend ? 'USDT_TRON' : (isBrebS ? 'COP_BREB' : (isCop ? 'COP_ACH' : sendForm.destinationCurrency)),
                                              status: receiptStatus,
                                              createdAt: sendResult?.at || new Date().toISOString(),
                                              beneficiary: name,
                                              bank: sendContact?.bank || sendForm.bankName || (isBrebS ? 'Bre-B' : 'ACH'),
                                              account: acctRaw,
                                              documentType: dR.docType,
                                              documentNumber: dR.docNumber,
                                              providerRef: sendResult?.providerRef || '',
                                              reason: sendForm.reason,
                                              feeCop,
                                              recipient: { holderName: name, key: isBrebS ? acctRaw : undefined, accountNumber: !isBrebS ? acctRaw : undefined, keyType: dR.brebKeyType, documentType: dR.docType, documentNumber: dR.docNumber, accountType: dR.accountType },
                                          };
                                          closeSendModal();
                                          setSelectedTx(receiptTx as any);
                                      }} className="flex items-center justify-center transition-colors hover:bg-white/[0.09]" style={{ flex: 1, gap: 7, padding: '12px 0', borderRadius: 10, fontSize: 13.5, fontWeight: 700, color: '#F4F4F2', background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)' }}>
                                          <Download size={14} strokeWidth={1.7} /> Comprobante
                                      </button>
                                      {/* lincoin-btn-white (con !important) — un hover:bg-[#E…] aquí
                                          activa la regla global [class*="bg-[#E"] y pinta el botón
                                          oscuro sobre oscuro (invisible). */}
                                      <button onClick={closeSendModal} className="lincoin-btn-white transition-colors" style={{ flex: 1.3, padding: '12px 0', borderRadius: 10, fontSize: 13.5, fontWeight: 700, border: '1px solid rgba(255,255,255,0.25)', background: '#F4F4F2', color: '#0A0A0A' }}>Finalizar</button>
                                      </>
                                  ) : (
                                      <>
                                      <button onClick={closeSendModal} className="transition-colors hover:bg-white/[0.09]" style={{ flex: 1, padding: '12px 0', borderRadius: 10, fontSize: 13.5, fontWeight: 700, color: '#F4F4F2', background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)' }}>Cerrar</button>
                                      <button onClick={() => { setSendResult(null); setSendStep(4); }} className="lincoin-btn-white transition-colors" style={{ flex: 1.3, padding: '12px 0', borderRadius: 10, fontSize: 13.5, fontWeight: 700, border: '1px solid rgba(255,255,255,0.25)', background: '#F4F4F2', color: '#0A0A0A' }}>Reintentar</button>
                                      </>
                                  )}
                              </div>
                          </div>
                          );
                      })()}

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
                              <button onClick={closeSendModal} style={{ color: '#FFFFFF' }} className="w-full bg-[#0C0E0D] font-bold py-3 rounded-xl hover:bg-[#161A17] transition-colors">Finalizar</button>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}
      {showPayVerify && (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden p-6">
                  <div className="flex items-center justify-between mb-5">
                      <h3 className="font-bold text-slate-800 text-lg">Verificación 2FA</h3>
                      <button type="button" onClick={() => setShowPayVerify(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100"><X size={20}/></button>
                  </div>
                  <p className="text-sm text-slate-500 mb-4 text-center">Ingresa el código de 6 dígitos de tu app autenticadora para confirmar el pago.</p>
                  {payVerifyError && <p className="text-red-500 text-sm text-center mb-3">{payVerifyError}</p>}
                  <div className="mb-4">
                      <CodeInput
                          value={payVerifyCode}
                          onChange={setPayVerifyCode}
                          onComplete={() => { if (!payVerifyLoading) handlePayVerifyAndSend(); }}
                          status={payVerifyLoading ? 'verifying' : payVerifyError ? 'error' : 'idle'}
                          tone="light"
                          autoFocus
                          disabled={payVerifyLoading}
                          aria="Código de tu app autenticadora"
                      />
                  </div>
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
    </>
  );
});
