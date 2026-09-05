import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback, useRef } from 'react';
import { useSystemConfig } from './SystemConfigContext';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { generateTOTPSecret, getTOTPQRCode, verifyTOTP } from '../lib/totp';

// --- TYPES ---

export interface UserDocuments {
  repId?: string;
  constitution?: string;
  rut?: string;
  affidavit?: string;
  frontId?: string;
  backId?: string;
  selfie?: string;
  proofAddress?: string;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'Soporte L1' | 'Tesorero' | 'Auditor' | 'Super Admin';
  status: 'Activo' | 'Inactivo';
  lastAccess?: string;
}

export interface BankDetail {
  id: string;
  name: string;
  type: 'bank' | 'qr' | 'crypto';
  accountNumber: string;
  accountType: string;
  beneficiary: string;
  taxId: string;
  taxIdType: string;
  logoColor?: string;
  logoText?: string;
  qrImageUrl?: string;
}

export interface TreasuryAccount {
  id: string;
  country: string;
  flag: string;
  currency: string;
  amount: number;
  bank: string;
}

export interface Transaction {
  id: number; userId: string; userName: string; userRole?: string; type: string; initials: string; title: string; date: string; amount: number; currency: string; status: 'Completado' | 'Pendiente' | 'Procesando' | 'Rechazado'; [key: string]: any;
}

export interface User {
  id: string;
  email: string;
  password?: string;
  role: 'admin' | 'business' | 'personal';
  name: string;
  balances: Record<string, number>;
  kycStatus?: string;
  documents?: UserDocuments;
  [key: string]: any;
}

interface DatabaseContextType {
  currentUser: User | null;
  isAuthLoading: boolean;
  users: User[];
  transactions: Transaction[];
  registerUser: (data: any) => Promise<{ error?: string }>;
  updateUserProfile: (id: string, data: any) => Promise<void>;
  updateUserRawData: (id: string, patch: Record<string, any>) => Promise<boolean>;
  loginUser: (email: string, pass?: string, captchaToken?: string) => Promise<User | null | 'MFA_REQUIRED'>;
  loginWithGoogle: (role?: 'personal' | 'business') => Promise<void>;
  logoutUser: () => void;
  getBalance: (curr: string) => number;
  bumpLocalBalance: (currency: string, delta: number) => void;
  addLocalTx: (tx: Record<string, any>) => void;
  getPersonalMovements: () => Transaction[];
  getUserNotifications: () => any[];
  markNotificationsRead: () => void;
  mergeNotifications: (news: Array<{ id: string; type?: string; title: string; message: string }>) => number;
  deleteNotification: (id: string | number) => void;
  clearNotifications: () => void;
  requestDeposit: (amount: number, curr: string, method: string, proof?: string) => Promise<void>;
  requestWithdrawal: (amount: number, curr: string, bank: string, acc: string, ben: string, reason: string, docType?: string, docNumber?: string, debitKey?: string) => Promise<void>;
  performConversion: (src: string, tgt: string, amtS: number, amtT: number, fee: number, coup?: string) => Promise<{ error?: string }>;
  approveDeposit: (id: number) => Promise<void>;
  rejectDeposit: (id: number) => Promise<void>;
  completeWithdrawal: (id: number) => Promise<void>;
  rejectWithdrawal: (id: number, reason: string) => Promise<void>;
  verifyUser: (id: string, status: string) => Promise<void>;
  toggleUserBlock: (id: string, blocked: boolean, reason?: string) => Promise<void>;
  isOnline: boolean;
  dataReady: boolean;
  refreshData: () => Promise<void>;
  bankingOptions: Record<string, BankDetail[]>;
  treasuryAccounts: TreasuryAccount[];
  getAllUsers: () => User[];
  getAllTransactions: () => Transaction[];
  updateTxStatus: (id: number, updates: Partial<Transaction>) => Promise<void>;
  getAllPendingDeposits: () => Transaction[];
  getAllPendingWithdrawals: () => Transaction[];
  getTransactionHistory: () => Transaction[];
  getAdminTeam: () => AdminUser[];
  addAdminUser: (u: Partial<AdminUser>) => void;
  updateAdminUser: (id: string, d: Partial<AdminUser>) => void;
  deleteAdminUser: (id: string) => void;
  deleteUser: (id: string) => Promise<{ error?: string }>;
  registerInternalMovement: (amt: number, curr: string, type: 'credit' | 'debit', reason: string, accId: string, refId?: string, proof?: string) => Promise<void>;
  updateBankList: (country: string, banks: BankDetail[]) => void;
  restoreDatabase: (json: any) => boolean;
  sendPasswordReset: (email: string, captchaToken?: string) => Promise<void>;
  isPasswordRecovery: boolean;
  setNewPassword: (newPassword: string) => Promise<string | null>;
  sendCuypayPayment: (recipientCode: string, amount: number, currency: string) => Promise<{ error?: string }>;
  mfaPending: boolean;
  mfaErrorDetail: string | null;
  loginErrorDetail: string | null;
  getLoginError: () => string | null;
  getMfaError: () => string | null;
  completeMFALogin: (code: string) => Promise<User | null>;
  emailStepPending: boolean;
  completeEmailLogin: (code: string) => Promise<User | null>;
  resendEmailCode: () => Promise<boolean>;
  startEmailStep: (userId: string) => Promise<boolean>;
  cancelMFALogin: () => void;
  enrollMFA: () => Promise<{ qrCode: string; secret: string; factorId: string } | null>;
  verifyMFAEnrollment: (factorId: string, code: string, secret?: string) => Promise<{ ok: boolean; error?: string; backupCodes?: string[] }>;
  unenrollMFA: (factorId: string) => Promise<boolean>;
  getMFAStatus: () => Promise<{ enrolled: boolean; factorId?: string; totpSecret?: string }>;
  verifyMfaCode: (code: string) => Promise<boolean>;
}

// --- LOCALSTORAGE HELPERS (fallback sin Supabase) ---

const LS_USERS = 'cuypay_users';
const LS_TRANSACTIONS = 'cuypay_transactions';
const LS_TX_SEQ = 'cuypay_tx_seq';

const SEED_ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL as string) || 'admin@cuypay.com';
// SEGURIDAD: el "admin bypass" fue ELIMINADO. Ya NO se lee VITE_ADMIN_PASSWORD
// (viajaba en el bundle público y cualquiera podía extraerla para tomar control
// total). Queda en '' → todas las rutas de bypass (guardas `SEED_ADMIN_PASSWORD
// && …`) quedan inertes. El admin entra con su cuenta REAL de Supabase (JWT +
// role='admin'), que el servidor exige.
const SEED_ADMIN_PASSWORD = '';
const SUPABASE_URL_FOR_FN = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SUPABASE_ANON_FOR_FN = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

function lsGetUsers(): User[] {
  try { return JSON.parse(localStorage.getItem(LS_USERS) || '[]'); } catch { return []; }
}
function lsSaveUsers(users: User[]) {
  localStorage.setItem(LS_USERS, JSON.stringify(users));
}
function lsGetTransactions(): Transaction[] {
  try { return JSON.parse(localStorage.getItem(LS_TRANSACTIONS) || '[]'); } catch { return []; }
}
function lsSaveTransactions(txs: Transaction[]) {
  localStorage.setItem(LS_TRANSACTIONS, JSON.stringify(txs));
}
function lsNextTxId(): number {
  const next = parseInt(localStorage.getItem(LS_TX_SEQ) || '0') + 1;
  localStorage.setItem(LS_TX_SEQ, String(next));
  return next;
}
function lsUpsertUser(user: User) {
  const users = lsGetUsers();
  const idx = users.findIndex(u => u.id === user.id);
  if (idx >= 0) users[idx] = user;
  else users.push(user);
  lsSaveUsers(users);
}
function lsInsertTx(tx: Omit<Transaction, 'id'>): Transaction {
  const newTx = { ...tx, id: lsNextTxId() } as Transaction;
  const txs = lsGetTransactions();
  txs.push(newTx);
  lsSaveTransactions(txs);
  return newTx;
}
function lsUpdateTx(id: number, updates: Partial<Transaction>) {
  const txs = lsGetTransactions();
  const idx = txs.findIndex(t => t.id === id);
  if (idx >= 0) { txs[idx] = { ...txs[idx], ...updates }; lsSaveTransactions(txs); }
}
function lsSeedAdmin() {
  const users = lsGetUsers();
  if (users.find(u => u.role === 'admin')) return;
  lsSaveUsers([...users, {
    id: 'usr_admin', email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD,
    role: 'admin', name: 'Administrador', balances: {}, kycStatus: 'approved', notifications: [],
  }]);
}

// --- SUPABASE HELPER ---

const mapSupabaseUser = (data: any): User => {
  const fromCols: Record<string, any> = {};
  if (data.first_name != null)        fromCols.firstName      = data.first_name;
  if (data.last_name != null)         fromCols.lastName       = data.last_name;
  if (data.birth_date != null)        fromCols.birthDate      = data.birth_date;
  if (data.nationality != null)       fromCols.nationality    = data.nationality;
  if (data.profession != null)        fromCols.profession     = data.profession;
  if (data.doc_type != null)          fromCols.docType        = data.doc_type;
  if (data.doc_number != null)        fromCols.docNumber      = data.doc_number;
  if (data.doc_country != null)       fromCols.countryOfIssue = data.doc_country;
  if (data.residence_country != null) fromCols.country        = data.residence_country;
  if (data.city != null)              fromCols.city           = data.city;
  if (data.address != null)           fromCols.address        = data.address;
  if (data.zip_code != null)          fromCols.zipCode        = data.zip_code;
  if (data.company_name != null)      fromCols.companyName    = data.company_name;
  if (data.company_country != null)   fromCols.companyCountry = data.company_country;
  if (data.company_city != null)      fromCols.companyCity    = data.company_city;
  if (data.company_address != null)   fromCols.companyAddress = data.company_address;
  if (data.tax_id != null)            fromCols.taxId          = data.tax_id;
  if (data.tax_id_type != null)       fromCols.taxIdType      = data.tax_id_type;
  if (data.rep_legal_name != null)    fromCols.repLegalName   = data.rep_legal_name;
  if (data.rep_first_name != null)    fromCols.repFirstName   = data.rep_first_name;
  if (data.rep_last_name != null)     fromCols.repLastName    = data.rep_last_name;
  if (data.rep_dob != null)           fromCols.repDob         = data.rep_dob;
  if (data.rep_nationality != null)   fromCols.repNationality = data.rep_nationality;
  if (data.rep_doc_type != null)      fromCols.repDocType     = data.rep_doc_type;
  if (data.rep_doc_number != null)    fromCols.repDocNumber   = data.rep_doc_number;
  if (data.rep_doc_country != null)   fromCols.repDocCountry  = data.rep_doc_country;
  if (data.is_pep != null)            fromCols.isPep          = data.is_pep;
  if (data.documents != null)         fromCols.documents      = data.documents;

  // Merge fiat (balances col) + crypto (crypto_balances col) into one unified object in memory
  const mergedBalances = { ...(data.balances || {}), ...(data.crypto_balances || {}) };

  return {
    ...(data.raw_data || {}),
    ...fromCols,
    id: data.id,
    email: data.email,
    role: data.role,
    name: data.full_name,
    balances: mergedBalances,
    kycStatus: data.kyc_status,
  };
};

// Currencies stored in crypto_balances column (separate from fiat balances)
const CRYPTO_CURRENCIES = new Set(['USDT', 'USDC', 'ETH', 'BNB', 'TRX', 'USDT_BSC', 'USDT_TRON', 'USDC_BSC', 'USDC_BASE', 'USDC_MATIC']);

// --- CONTEXT ---

const DatabaseContext = createContext<DatabaseContextType | undefined>(undefined);

export const DatabaseProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { config, updateConfig } = useSystemConfig();
  const [users, setUsers] = useState<User[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  // ⚠️ SEGURIDAD: NO se restaura ninguna sesión desde sessionStorage.
  // Antes se leía 'cuypay_admin_session' y se confiaba en ese JSON tal cual,
  // rol incluido. Cualquiera que pudiera escribir en sessionStorage (un XSS,
  // una extensión, o la propia consola del navegador) se volvía admin en la
  // interfaz sin contraseña, sin 2FA y sin CAPTCHA. El bypass que lo escribía
  // ya estaba desactivado, así que esto era superficie de ataque muerta.
  // La identidad SIEMPRE sale del JWT de Supabase.
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  // Recuperación de contraseña: cuando el usuario abre el enlace del correo
  // de "olvidé mi contraseña", Supabase dispara PASSWORD_RECOVERY. La app
  // muestra una pantalla para fijar la nueva clave.
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() => {
    // Se detecta desde la URL, no solo desde el evento: el orden en que
    // Supabase dispara PASSWORD_RECOVERY y SIGNED_IN no está garantizado, y si
    // llega primero el segundo la sesión de recuperación entraba al panel.
    try { return /type=recovery/.test(window.location.hash || window.location.search); } catch { return false; }
  });
  // Ref para poder consultarlo dentro del listener sin depender del render.
  const recoveryRef = useRef<boolean>(false);
  useEffect(() => { recoveryRef.current = isPasswordRecovery; }, [isPasswordRecovery]);
  // Start online immediately if Supabase is configured — avoids a flash of "Modo Offline"
  // while the first fetchData() is still in flight.
  const [isOnline, setIsOnline] = useState(isSupabaseConfigured);
  // A diferencia de isOnline (optimista, para no parpadear "Modo Offline"),
  // dataReady solo se pone en true cuando el primer fetchData() ya terminó
  // (con éxito o error) — así el panel puede mostrar "cargando" en vez de
  // "0" mientras la función de Supabase todavía está respondiendo.
  const [dataReady, setDataReady] = useState(!isSupabaseConfigured);

  // Only show loading spinner if there's actually a stored session to restore.
  // La sesión de admin (bypass) NO cuenta aquí: se restaura de forma síncrona
  // en el initializer de currentUser, así que no necesita el loader — si se
  // incluyera, se mostraría "Verificando sesión" pese a tener ya al admin
  // cargado (AdminEmpresasInner revisa isAuthLoading ANTES que currentUser).
  const hasStoredSession = isSupabaseConfigured && (() => {
    try {
      const hasSupabase = Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
      // Detect OAuth redirect — code= (PKCE) or access_token= (implicit) in URL
      const href = window.location.href;
      const hasOAuthRedirect = (href.includes('code=') && href.includes('state=')) || href.includes('access_token=');
      return hasSupabase || hasOAuthRedirect;
    } catch { return false; }
  })();
  const [isAuthLoading, setIsAuthLoading] = useState(hasStoredSession);
  const [mfaPending, setMfaPending] = useState(false);
  // Paso 2 del ingreso: código enviado al correo del titular.
  const [emailStepPending, setEmailStepPending] = useState(false);
  const [pendingMFAProfile, setPendingMFAProfile] = useState<User | null>(null);
  // 'custom' = TOTP nuestro (raw_data.mfaEnabled, verifica vía mfa_verify);
  // 'native' = MFA de Supabase Auth (challenge/verify). Decide cómo verificar
  // el código en completeMFALogin.
  const [pendingMFAMode, setPendingMFAMode] = useState<'custom' | 'native'>('native');
  // Motivo real del fallo de verificación 2FA (para no mostrar siempre
  // "código incorrecto" cuando en realidad falló otra cosa).
  const [mfaErrorDetail, setMfaErrorDetail] = useState<string | null>(null);
  // Motivo REAL del fallo de ingreso. "Credenciales incorrectas" se mostraba
  // para todo — CAPTCHA rechazado, cuenta sin confirmar, red caída — y no
  // había forma de saber qué arreglar.
  const [loginErrorDetail, setLoginErrorDetail] = useState<string | null>(null);
  // El ref se lee AL INSTANTE. Con solo estado, quien llama leía el valor del
  // render anterior y el motivo salía un intento tarde — o no salía.
  const loginErrorRef = useRef<string | null>(null);
  const mfaErrorRef = useRef<string | null>(null);
  const setLoginError = (v: string | null) => { loginErrorRef.current = v; setLoginErrorDetail(v); };
  const setLoginError2 = (wrap: (t: string) => string, v: string) => setLoginError(wrap(v));
  const setMfaError2 = (v: string | null) => { mfaErrorRef.current = v; setMfaErrorDetail(v); };
  // Tracks when a local write is in progress so fetchData doesn't overwrite optimistic state
  const pendingWriteUntilRef = useRef<number>(0);
  // Ids de usuario que comparten el correo del usuario actual (por si hay
  // filas duplicadas con id distinto). Se llena desde el respaldo
  // gasfree/my_transactions y hace que los movimientos se muestren aunque
  // currentUser.id sea el id "equivocado" del duplicado.
  const emailUserIdsRef = useRef<string[]>([]);
  // Incremented on each explicit logout so any in-flight SIGNED_IN handler can abort
  const logoutCounterRef = useRef<number>(0);
  // Mirror of currentUser kept in a ref so fetchData can read the latest value
  // without being listed as a dependency (which would recreate the realtime channel)
  const currentUserRef = useRef<User | null>(null);
  currentUserRef.current = currentUser;
  // Unique per-session channel name avoids StrictMode double-invoke conflicts where
  // React tears down and re-creates the effect before Supabase finishes closing the channel.
  const channelNameRef = useRef(`db_sync_${Math.random().toString(36).slice(2, 8)}`);

  // Seed admin on first run (offline mode)
  useEffect(() => {
    if (!isSupabaseConfigured) lsSeedAdmin();
  }, []);

  // Handle Supabase Auth state changes (Google OAuth redirect + session restore)
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    // Se retiró la restauración de 'cuypay_admin_session' (ver arriba): la
    // sesión de admin sale del JWT, nunca de un JSON del navegador. Por si
    // quedó escrita de una versión anterior, se borra.
    try { sessionStorage.removeItem('cuypay_admin_session'); } catch { /* */ }

    // Safety net: never stay stuck on loading screen more than 5 seconds
    const timeout = setTimeout(() => setIsAuthLoading(false), 5000);

    // Debounce SIGNED_OUT to avoid false logouts during token refresh
    let signOutTimer: ReturnType<typeof setTimeout> | null = null;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        // Enlace de recuperación de contraseña abierto → mostrar la pantalla
        // para fijar la nueva clave (no entrar directo al dashboard).
        if (event === 'PASSWORD_RECOVERY') { recoveryRef.current = true; setIsPasswordRecovery(true); return; }
        // ⚠️ SEGURIDAD: el enlace de "recuperar contraseña" crea una sesión
        // válida. Sin este corte, esa sesión entraba DIRECTO al panel — sin
        // contraseña, sin 2FA y sin código de correo. Quien tuviera acceso al
        // buzón entraba como admin. Una sesión de recuperación solo sirve para
        // fijar la clave nueva; después hay que iniciar sesión de verdad.
        if (recoveryRef.current && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
          setIsPasswordRecovery(true);
          return;
        }
        if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') && session?.user) {
          // Cancel any pending sign-out
          if (signOutTimer) { clearTimeout(signOutTimer); signOutTimer = null; }

          // TOKEN_REFRESHED se dispara periódicamente (y al recuperar foco la
          // pestaña). NO cambia el perfil: si ya tenemos cargado a este mismo
          // usuario, no re-consultamos ni re-seteamos currentUser — eso evita
          // que la sección se "recargue/parpadee cada rato" (crear un nuevo
          // objeto currentUser re-renderiza todo el panel y re-dispara fetches).
          if (event === 'TOKEN_REFRESHED' && currentUserRef.current?.id === session.user.id) return;

          // Capture logout counter before any await — if it changes while we're async, a
          // logoutUser() was called intentionally and we must not re-set the user.
          const snapshotLogoutCount = logoutCounterRef.current;

          const { data: profileData } = await Promise.race([
            supabase.from('users').select('*').eq('id', session.user.id).single(),
            new Promise<{ data: null }>((resolve) => setTimeout(() => resolve({ data: null }), 5000)),
          ]) as any;

          // Abort if a logout happened while we were awaiting
          if (logoutCounterRef.current !== snapshotLogoutCount) return;

          let profile = profileData;

          if (profile) {
            // ⚠️ SECURITY: el auto-promote a role='admin' + kyc_status='approved'
            // se removió porque combinado con RLS abierta permitía que cualquier
            // usuario se autopromueva (security audit, finding #10). El admin
            // ahora se siembra UNA VEZ vía SQL/seed_admin_user.sql + el trigger
            // BEFORE UPDATE en 2026_security_hardening_rls.sql bloquea cambios
            // a role/kyc_status desde el cliente. Si el seed admin perdió su
            // rol, se restaura desde Supabase Dashboard, no desde el frontend.
            //
            // Si user_metadata.role viene del signUp y difiere, sincronizamos
            // SOLO si es business/personal (NO admin — admin solo por seed).
            const metaRoleOnFound = session.user.user_metadata?.role as string | undefined;
            if ((metaRoleOnFound === 'business' || metaRoleOnFound === 'personal') && metaRoleOnFound !== profile.role) {
              await supabase.from('users').update({ role: metaRoleOnFound }).eq('id', profile.id);
              if (logoutCounterRef.current !== snapshotLogoutCount) return;
              profile = { ...profile, role: metaRoleOnFound };
            }
            // GATE 2FA: si la cuenta tiene 2FA custom activo y aún no se verificó
            // el código EN ESTA sesión, NO se entra — se deja pendiente el código.
            // (Antes este listener seteaba currentUser directo y saltaba el 2FA.)
            // La marca 'mfa_ok' vive en sessionStorage: sobrevive un refresco de la
            // pestaña pero NO una pestaña/navegador nuevo → ahí sí re-pide 2FA.
            const mfaOn2 = !!(profile as any)?.raw_data?.mfaEnabled;
            let mfaOk = false; try { mfaOk = sessionStorage.getItem('mfa_ok') === '1'; } catch { /* */ }
            // La marca local no basta: la confirma el servidor contra la
            // sesión del JWT. Si dice que no, se vuelve a pedir el código.
            if (mfaOn2 && mfaOk) mfaOk = await serverSaysMfaVerified((profile as any).id);
            if (mfaOn2 && !mfaOk && event !== 'TOKEN_REFRESHED') {
              beginMfaFlow(mapSupabaseUser(profile), 'custom');
              return;
            }
            setCurrentUser(mapSupabaseUser(profile));
          } else {
            // Check if a profile already exists with this email (e.g. email/password account)
            // ⚠️ CRÍTICO: distinguir "no existe" de "no pude confirmar (timeout)".
            // Antes, un timeout se trataba como "usuario nuevo" y creaba un
            // perfil con un id DISTINTO (el del auth) al de la fila real
            // (matcheada por correo) → los movimientos, que están bajo el id
            // real, quedaban filtrados fuera y "desaparecían" (típico en 4G).
            let existingByEmail: any = null;
            let lookupCompleted = false;
            try {
              const res: any = await Promise.race([
                supabase.from('users').select('*').eq('email', session.user.email!).single(),
                new Promise((resolve) => setTimeout(() => resolve('__timeout__'), 8000)),
              ]);
              if (res !== '__timeout__') { lookupCompleted = true; existingByEmail = res?.data ?? null; }
            } catch { lookupCompleted = false; }

            if (logoutCounterRef.current !== snapshotLogoutCount) return;

            if (existingByEmail) {
              // ⚠️ SECURITY: el auto-promote a role='admin' / kyc_status='approved'
              // se removió (security audit finding #10). Admin seed se hace UNA VEZ
              // por SQL; el trigger guard_users_sensitive_cols bloquea el cambio.
              const mfaOnE = !!(existingByEmail as any)?.raw_data?.mfaEnabled;
              let mfaOkE = false; try { mfaOkE = sessionStorage.getItem('mfa_ok') === '1'; } catch { /* */ }
              if (mfaOnE && mfaOkE) mfaOkE = await serverSaysMfaVerified((existingByEmail as any).id);
              if (mfaOnE && !mfaOkE && event !== 'TOKEN_REFRESHED') {
                beginMfaFlow(mapSupabaseUser(existingByEmail), 'custom');
                return;
              }
              setCurrentUser(mapSupabaseUser(existingByEmail));
            } else if (!lookupCompleted) {
              // No se confirmó si existe (timeout/red). NO crear perfil nuevo
              // (id distinto = movimientos "desaparecidos"). Se resuelve en el
              // próximo ciclo de auth o en el poll de fetchData.
              console.warn('[auth] lookup de perfil por correo no confirmó — no se crea perfil (evita duplicado con id distinto)');
              return;
            } else {
              // Truly new user — create profile
              const id = session.user.id;
              const isAdminOAuth = session.user.email === SEED_ADMIN_EMAIL;
              // Esta web es EXCLUSIVAMENTE el producto EMPRESAS (el personal
              // vive en la app móvil, en otra base). Toda cuenta nueva que se
              // cree aquí es business — salvo el admin semilla.
              //
              // Antes se deducía el rol de user_metadata y de "pistas" en
              // localStorage (cuypay_oauth_role / cuypay_register_role). Con
              // Google (OAuth) Google NO manda nuestro rol, así que se caía a
              // esas pistas, y una pista VIEJA de 'personal' (de haber tocado
              // antes el flujo de la app personal) creaba la cuenta como
              // 'personal' aunque el registro fuera por Empresas — luego no
              // salía en el admin y mostraba KYC. Se ignoran esas pistas y se
              // fuerza business para que no vuelva a pasar.
              const pendingRole = isAdminOAuth ? 'admin' : 'business';
              localStorage.removeItem('cuypay_oauth_role');
              localStorage.removeItem('cuypay_register_role');
              const newProfile = {
                id,
                email: session.user.email!,
                full_name: session.user.user_metadata?.full_name
                  || session.user.email!.split('@')[0],
                role: pendingRole,
                balances: { USD: 0, COP: 0, CLP: 0, MXN: 0, PEN: 0 },
                kyc_status: isAdminOAuth ? 'approved' : 'pending',
                raw_data: { notifications: [], ownReferralCode: id.slice(-6).toUpperCase() },
              };
              await supabase.from('users').insert(newProfile);
              if (logoutCounterRef.current !== snapshotLogoutCount) return;
              setCurrentUser(mapSupabaseUser(newProfile));
            }
          }
        } else if (event === 'SIGNED_OUT') {
          // Debounce: wait before logging out — token refresh fires SIGNED_OUT then SIGNED_IN
          signOutTimer = setTimeout(() => {
            sessionStorage.removeItem('cuypay_admin_session');
            setCurrentUser(null);
          }, 500);
        }
      } catch (e) {
        console.error('Auth state change error:', e);
      } finally {
        clearTimeout(timeout);
        setIsAuthLoading(false);
      }
    });

    return () => {
      clearTimeout(timeout);
      if (signOutTimer) clearTimeout(signOutTimer);
      subscription.unsubscribe();
    };
  }, []);

  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured) {
      const localUsers = lsGetUsers();
      const localTxs = lsGetTransactions();
      setUsers(localUsers);
      setTransactions(localTxs.sort(((a:any,b:any)=> (new Date(b.createdAt??b.created_at??b.date??0).getTime()||0) - (new Date(a.createdAt??a.created_at??a.date??0).getTime()||0)) as any));
      const cu = currentUserRef.current;
      if (cu) {
        const fresh = localUsers.find(x => x.id === cu.id);
        if (fresh && JSON.stringify(fresh) !== JSON.stringify(cu)) setCurrentUser(fresh);
      }
      return;
    }

    setIsOnline(true);
    try {
      const cu = currentUserRef.current;

      // Admin path: call the 'admin-data' edge function which uses the service-role key
      // server-side — this bypasses RLS without any SQL migration required.
      // Admin-bypass sessions (no real Supabase JWT) use a shared secret header instead.
      if (cu?.role === 'admin') {
        try {
          const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
          const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
          const authHeader = `Bearer ${getStoredToken() ?? SKEY}`;
          const abortCtl = new AbortController();
          const abortTimer = setTimeout(() => abortCtl.abort(), 20000);
          const fnResult = await fetch(`${SURL}/functions/v1/admin-data`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': authHeader },
            signal: abortCtl.signal,
          }).then(async r => {
            const text = await r.text().catch(() => '');
            try { const data = JSON.parse(text); return r.ok ? { data, error: null } : { data: null, error: data }; }
            catch { return { data: null, error: text }; }
          }).finally(() => clearTimeout(abortTimer)) as any;
          const { data: fnData, error: fnErr } = fnResult;
          if (!fnErr && Array.isArray(fnData?.users)) {
            const mappedUsers = (fnData.users as any[]).map(mapSupabaseUser);
            // Si hay un guardado optimista reciente (ej. admin activando OTC de OTRO
            // cliente vía updateUserProfile), este poll puede llegar ANTES de que ese
            // guardado se refleje en la DB y pisarlo con el valor viejo — el toggle
            // "se revierte solo" aunque sí se guardó bien. Mientras el guard esté
            // activo, conservamos la versión optimista ya en memoria para cualquier
            // usuario que la tenga, en vez de reemplazar todo el arreglo a ciegas.
            if (Date.now() > pendingWriteUntilRef.current) {
              setUsers(mappedUsers);
            } else {
              setUsers(prevUsers => mappedUsers.map((mu: any) => {
                const optimistic = prevUsers.find(p => p.id === mu.id);
                return optimistic ?? mu;
              }));
            }
            if (Date.now() > pendingWriteUntilRef.current) {
              const fresh = mappedUsers.find((x: any) => x.id === cu.id);
              if (fresh && JSON.stringify(fresh) !== JSON.stringify(cu)) setCurrentUser(fresh);
            }
            let mappedTxForCache: any[] | null = null;
            if (Array.isArray(fnData.transactions) && fnData.transactions.length) {
              const mappedTx = (fnData.transactions as any[]).map((t: any) => ({
                id: t.id, userId: t.user_id, type: t.type,
                amount: Number(t.amount), currency: t.currency, status: t.status,
                ...t.raw_data,
              }));
              const sortedTx = mappedTx.sort(((a:any,b:any)=> (new Date(b.createdAt??b.created_at??b.date??0).getTime()||0) - (new Date(a.createdAt??a.created_at??a.date??0).getTime()||0)));
              setTransactions(sortedTx);
              mappedTxForCache = sortedTx;
            }
            // Caché del admin: guardar los últimos datos para HIDRATAR AL
            // INSTANTE en la próxima carga. Tras cada deploy la edge function
            // arranca en frío y tarda varios segundos; sin caché el panel se
            // quedaba en 0 ("no carga nada") hasta que respondía. Con esto se
            // muestran los últimos datos conocidos y se refresca en segundo
            // plano. Escrituras protegidas por si se pasa la cuota.
            try { localStorage.setItem('cuypay_admin_users', JSON.stringify(mappedUsers)); } catch { /* quota */ }
            try { if (mappedTxForCache) localStorage.setItem('cuypay_admin_tx', JSON.stringify(mappedTxForCache.slice(0, 200))); } catch { /* quota */ }
            return; // Edge function succeeded — no need for fallback
          }
          if (fnErr) console.warn('[fetchData] admin-data edge fn error:', fnErr);
        } catch (fnEx: any) {
          if (fnEx?.message !== 'fn_timeout') console.warn('[fetchData] admin-data edge fn threw:', fnEx?.message);
          // Fall through to RPC / direct SELECT fallback below
        }
      }

      // SEGURIDAD: el cliente NO admin ya NO descarga toda la base (eso fugaba
      // totpSecret/PII de todos y alimentaba varios ataques). Lee SOLO su
      // propia fila y sus propias transacciones. Los admins sí traen todo, pero
      // por la vía del edge admin-data (service-role) de más arriba; si esa
      // falla, este respaldo directo depende de la RLS (is_any_admin les da
      // acceso total; a un cliente, solo lo suyo).
      const isAdminCaller = (cu as any)?.role === 'admin';
      let directUsers: any, directTx: any;
      if (isAdminCaller) {
        directUsers = await supabase.from('users').select('*');
        directTx = await supabase.from('transactions').select('*');
      } else {
        directUsers = await supabase.from('users').select('*').eq('id', cu?.id ?? '');
        directTx = await supabase.from('transactions').select('*').eq('user_id', cu?.id ?? '');
      }
      if (directUsers.error) console.warn('[fetchData] direct users SELECT error:', directUsers.error.code, directUsers.error.message);
      if (directTx.error) console.warn('[fetchData] direct tx SELECT error:', directTx.error.code, directTx.error.message);
      const usersData = directUsers.data;
      const txData = directTx.data;

      if (usersData) {
        const mapped = (usersData as any[]).map(mapSupabaseUser);
        setUsers(mapped);
        if (cu && Date.now() > pendingWriteUntilRef.current) {
          const fresh = mapped.find(x => x.id === cu.id);
          if (fresh && JSON.stringify(fresh) !== JSON.stringify(cu)) setCurrentUser(fresh);
        }
      }
      // Orden por fecha, no por id: los ids de transactions son uuid — la
      // resta b.id - a.id da NaN y el sort no ordenaba nada.
      const txTime = (t: any) => new Date(t.createdAt ?? t.created_at ?? t.date ?? 0).getTime() || 0;
      // Normaliza estados a los canónicos de la app. El panel Personas escribe
      // 'approved'/'rejected' (y variantes en inglés) que ninguna vista del
      // cliente entiende → se mapean a Completado/Rechazado; los demás se
      // dejan tal cual (Completado, Procesando, Pendiente, Rechazado, Fallido).
      const normStatus = (s: any): string => {
        const v = String(s ?? '').toLowerCase();
        if (['approved', 'completed', 'success', 'confirmed', 'paid', 'settled', 'aprobada', 'aprobado'].includes(v)) return 'Completado';
        if (['rejected', 'cancelled', 'canceled', 'failed', 'denied', 'rechazada'].includes(v)) return 'Rechazado';
        if (['processing', 'procesando'].includes(v)) return 'Procesando';
        if (['pending', 'pendiente'].includes(v)) return 'Pendiente';
        return String(s ?? '');
      };
      const mapTx = (arr: any[]) => (arr as any[]).map(t => ({
        id: t.id, userId: t.user_id, type: t.type,
        amount: Number(t.amount), currency: t.currency, status: normStatus(t.status),
        createdAt: t.created_at ?? t.raw_data?.createdAt,
        // raw_data se aplana para acceso plano, PERO se conserva bajo su clave
        // para las vistas que lo leen anidado (motivo de fallo, explorer…).
        raw_data: t.raw_data ?? {},
        ...t.raw_data,
      })).sort((a: any, b: any) => txTime(b) - txTime(a));

      // ── Lectura de movimientos del propio usuario vía la edge 'gasfree'
      //    (service role) — no depende del RPC, del caché de PostgREST, ni
      //    de la RLS/sesión. Se guarda aparte y solo se USA si trae datos:
      //    NUNCA pisa con vacío lo que sí trajo el RPC/SELECT.
      //    Se REINTENTA hasta 3 veces con timeout: en 4G la petición a veces
      //    no conecta y sin reintento los movimientos quedaban vacíos aunque
      //    existan. ────────────────────────────────────────────────────────
      let edgeTxs: any[] = [];
      let edgeDebug: any = null;
      if (cu?.id) {
        const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
        const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
        const tok = getStoredToken();
        for (let attempt = 0; attempt < 3 && edgeTxs.length === 0; attempt++) {
          try {
            const ctl = new AbortController();
            const t = setTimeout(() => ctl.abort(), 12000);
            const r = await fetch(`${SURL}/functions/v1/gasfree`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${tok ?? SKEY}` },
              body: JSON.stringify({ action: 'my_transactions', userId: cu.id }),
              signal: ctl.signal,
            }).then(res => res.json()).catch((e) => ({ fetchError: String(e?.message ?? e) }));
            clearTimeout(t);
            edgeDebug = { count: Array.isArray(r?.transactions) ? r.transactions.length : null, ids: r?.ids ?? null, error: r?.error ?? r?.queryError ?? r?.fetchError ?? null };
            if (Array.isArray(r?.ids) && r.ids.length) emailUserIdsRef.current = r.ids;
            if (Array.isArray(r?.transactions) && r.transactions.length) { edgeTxs = mapTx(r.transactions); break; }
          } catch { /* reintenta */ }
          if (edgeTxs.length === 0 && attempt < 2) await new Promise(res => setTimeout(res, 800));
        }
      }

      // Se usa la fuente que SÍ trajo datos (edge preferida, si no el RPC/SELECT).
      // Solo se escribe si hay algo — así una lectura vacía nunca borra la lista.
      const rpcTxs = txData?.length ? mapTx(txData) : [];
      // Orden por FECHA (desc), no por id: los ids son uuid aleatorios, así que
      // sin esto "Movimientos recientes" mostraba cualquier orden y un depósito
      // nuevo podía no salir arriba (o parecer que "no está").
      const finalTxs = (edgeTxs.length ? edgeTxs : rpcTxs)
        .slice()
        .sort((a: any, b: any) => txTime(b) - txTime(a));
      if (finalTxs.length) {
        setTransactions(finalTxs);
        // Caché local por usuario: la próxima vez los movimientos se ven al
        // instante aunque la red falle (se refrescan en segundo plano).
        if (cu?.id) { try { localStorage.setItem(`cuypay_tx_${cu.id}`, JSON.stringify(finalTxs.slice(0, 200))); } catch { /* quota */ } }
      } else if (cu?.id) {
        // Diagnóstico visible: si TODAS las fuentes vinieron vacías, guardar
        // el porqué para mostrarlo en la pantalla de Movimientos (en móvil no
        // hay consola). count=0 sin error ⇒ la base de verdad no tiene filas
        // para este usuario (los inserts fallaron o fueron a otro id).
        try {
          localStorage.setItem('lincoin_tx_debug', JSON.stringify({
            at: new Date().toISOString(), userId: cu.id,
            edge: edgeDebug,
            // 'txRpc' ya no existe (esa vía se reemplazó por el SELECT directo);
            // referenciarlo lanzaba un ReferenceError que el catch de abajo se
            // tragaba, así que el diagnóstico NUNCA se guardaba.
            directErr: directTx.error?.message ?? null, directCount: Array.isArray(directTx.data) ? directTx.data.length : null,
          }));
        } catch { /* quota */ }
      }
    } catch (e) { console.error('DB Fetch Error', e); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apenas se identifica el usuario (o cambia): (1) hidratar movimientos del
  // caché local para que se vean AL INSTANTE aunque la red falle, y (2)
  // refrescar de inmediato desde el servidor (sin esperar el poll de 10s).
  useEffect(() => {
    if (!currentUser?.id) return;
    try {
      if (currentUser.role === 'admin') {
        // Admin: hidratar usuarios + movimientos desde el caché para que el
        // panel NO se quede en 0 mientras la edge function (fría tras deploy)
        // responde. Solo se usa como puente: el fetchData de abajo lo refresca.
        const cu = localStorage.getItem('cuypay_admin_users');
        if (cu) { const arr = JSON.parse(cu); if (Array.isArray(arr) && arr.length) setUsers(prev => prev.length ? prev : arr); }
        const ct = localStorage.getItem('cuypay_admin_tx');
        if (ct) { const arr = JSON.parse(ct); if (Array.isArray(arr) && arr.length) setTransactions(prev => prev.length ? prev : arr); }
      } else {
        const cached = localStorage.getItem(`cuypay_tx_${currentUser.id}`);
        if (cached) {
          const arr = JSON.parse(cached);
          if (Array.isArray(arr) && arr.length) {
            setTransactions(prev => prev.length ? prev : arr);
          }
        }
      }
    } catch { /* sin caché */ }
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  useEffect(() => {
    fetchData().finally(() => setDataReady(true));
    // Salvavidas: si fetchData se cuelga (una consulta que nunca resuelve por
    // red intermitente), el panel se quedaba en "Conectando…" para siempre.
    // A los 9 s se libera la UI igual (mostrará lo que haya cargado y seguirá
    // reintentando con el poll/realtime).
    const readyGuard = setTimeout(() => setDataReady(true), 9000);
    if (!isSupabaseConfigured) { clearTimeout(readyGuard); return; }

    // Realtime handles live updates; poll as a fallback for missed events (10s)
    const interval = setInterval(fetchData, 10000);
    // Debounce realtime: coalesce rapid-fire events into a single fetchData call (500ms)
    // This prevents web+mobile sessions from conflicting when both receive the same event burst
    let realtimeTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (realtimeTimer) clearTimeout(realtimeTimer);
      realtimeTimer = setTimeout(() => { realtimeTimer = null; fetchData(); }, 500);
    };
    const channel = supabase.channel(channelNameRef.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, debouncedFetch)
      .subscribe();

    return () => { clearTimeout(readyGuard); clearInterval(interval); if (realtimeTimer) clearTimeout(realtimeTimer); supabase.removeChannel(channel); };
  }, [fetchData]);

  // --- STORAGE HELPERS ---

  // Returns stored Supabase JWT from localStorage, or null if no session.
  // Never returns the anon key — the apikey header handles anon auth separately.
  const getStoredToken = (): string | null => {
    try {
      const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
      if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) return d.access_token; }
    } catch {}
    return null;
  };

  // Registra un INGRESO de admin (durable, con IP server-side) tras un login
  // exitoso. Best-effort: nunca bloquea ni rompe el login si falla.
  const logAdminLogin = (u: any) => {
    try {
      if (!u || u.role !== 'admin' || !SUPABASE_URL_FOR_FN) return;
      const token = getStoredToken();
      fetch(`${SUPABASE_URL_FOR_FN}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_FOR_FN, Authorization: token ? `Bearer ${token}` : `Bearer ${SUPABASE_ANON_FOR_FN}` },
        body: JSON.stringify({ action: 'log_login' }),
      }).catch(() => {});
    } catch { /* nunca rompe el login */ }
  };

  // ¿El SERVIDOR reconoce esta sesión como verificada con 2FA? La marca
  // 'mfa_ok' de sessionStorage se puede escribir a mano desde la consola del
  // navegador, así que sirve para evitar un parpadeo, no para decidir. Ante
  // la duda (red caída, respuesta rara) se responde NO: se vuelve a pedir el
  // código, que es el lado seguro del error.
  const serverSaysMfaVerified = async (userId: string): Promise<boolean> => {
    try {
      if (!SUPABASE_URL_FOR_FN) return false;
      const token = getStoredToken();
      if (!token) return false;
      const r = await Promise.race([
        fetch(`${SUPABASE_URL_FOR_FN}/functions/v1/admin-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_FOR_FN, Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'mfa_session_ok', userId }),
        }).then(x => x.json()),
        new Promise<any>(resolve => setTimeout(() => resolve(null), 5000)),
      ]);
      return r?.ok === true && r?.verified === true;
    } catch { return false; }
  };

  // Deja constancia de un intento de ingreso FALLIDO. El servidor le pone la
  // IP y la ubicación aproximada, cuenta los fallos de esa IP y la bloquea al
  // tercero en una hora. Nunca rompe ni demora el login: es fire-and-forget.
  const logFailedLogin = (email: string, reason: string) => {
    try {
      if (!SUPABASE_URL_FOR_FN) return;
      fetch(`${SUPABASE_URL_FOR_FN}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_FOR_FN, Authorization: `Bearer ${SUPABASE_ANON_FOR_FN}` },
        body: JSON.stringify({ action: 'log_failed_login', email, reason }),
      }).catch(() => {});
    } catch { /* nunca rompe el login */ }
  };

  // PBKDF2 password hash using Web Crypto — fallback when Supabase Auth is misconfigured
  const hashPassword = async (password: string, salt: string): Promise<string> => {
    try {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
        keyMaterial, 256
      );
      return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch { return ''; }
  };

  const saveUser = async (u: User) => {
    if (!isSupabaseConfigured) { lsUpsertUser(u); fetchData(); return; }
    const {
      id, email, role, name, balances, kycStatus, password: _pw,
      firstName, lastName, birthDate, nationality, profession,
      docType, docNumber, countryOfIssue,
      country, city, address, zipCode,
      companyName, companyCountry, companyCity, companyAddress,
      taxId, taxIdType,
      repLegalName, repFirstName, repLastName, repDob, repNationality,
      repDocType, repDocNumber, repDocCountry, isPep,
      documents,
      ...rest
    } = u;

    // Keepalive PATCH — fires immediately and survives page reload / tab close on mobile
    // Uses token from localStorage (synchronous) so it never hangs
    const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
    const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
    const token = getStoredToken();
    fetch(`${SURL}/rest/v1/users?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SKEY,
        // Only send Authorization if we have a real JWT; anon key is NOT a valid Bearer token
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ balances }),
    }).catch(() => {});

    // Split balances into fiat (balances col) and crypto (crypto_balances col)
    const fiatBalances: Record<string, number> = {};
    const cryptoBalances: Record<string, number> = {};
    for (const [k, v] of Object.entries(balances)) {
      if (CRYPTO_CURRENCIES.has(k)) cryptoBalances[k] = v as number;
      else fiatBalances[k] = v as number;
    }

    const timeout = new Promise<{ data: null; error: Error }>((_, reject) =>
      setTimeout(() => reject(new Error('Supabase timeout after 8s')), 8000)
    );
    try {
      // Fetch current raw_data from DB first so we never lose gasfree wallet fields
      // (e.g. gasfreeAddresses, gasfreeHdIndex) that may not be in stale in-memory state
      //
      // ⚠️ Normalización crítica: mapSupabaseUser APLANA raw_data al nivel
      // superior del usuario, pero updateUserProfile puede traer un raw_data
      // ANIDADO con los datos más frescos (ej. mouvContacts recién
      // agregado). Sin esto, el guardado creaba raw_data.raw_data y el valor
      // viejo aplanado pisaba al nuevo — los contactos "desaparecían" al
      // recargar.
      const { raw_data: nestedRaw, ...restFlat } = rest as any;
      let safeRest: Record<string, any> = { ...restFlat, ...((nestedRaw && typeof nestedRaw === 'object') ? nestedRaw : {}) };
      // admin-data reemplaza blobs pesados (comprobantes/base64) por el
      // marcador '__stored__' para no pesar megas. Esos marcadores NUNCA
      // deben escribirse de vuelta: se quitan y el merge con la fila real
      // de la base conserva el valor original.
      for (const k of Object.keys(safeRest)) {
        if (safeRest[k] === '__stored__') delete safeRest[k];
      }
      // Campos que administra EXCLUSIVAMENTE el servidor: la wallet GasFree
      // (índice/dirección/contador), el 2FA (TOTP) y el OTP. saveUser NUNCA
      // debe escribirlos desde memoria — la memoria puede estar vieja y los
      // BORRABA/CAMBIABA (la wallet "cambiaba sola", el 2FA "se deshabilitaba").
      // Siempre se dejan como están en la BASE; y si no pudimos leer la base,
      // se OMITE raw_data por completo para no pisar nada.
      const SERVER_OWNED = ['gasfreeIndex', 'gasfreeHdIndex', 'gasfreeAddress', 'gasfreeEoa', 'gasfreeAddresses', 'gasfreeCredited', 'gasfreeCreditedTxs', 'gasfreeCreditedCount', 'mfaEnabled', 'totpSecret', 'totpSecretEnc', 'mfaBackupHashes', 'mfaSessions', 'mfaLastCounter', 'otp', 'subWallets'];
      // COLECCIONES del cliente que tienen su PROPIO escritor seguro
      // (updateUserRawData, merge dirigido): contactos, wallets inscritas,
      // notificaciones. saveUser NUNCA debe reescribirlas desde memoria — una
      // copia vieja (p. ej. de otro dispositivo, o de un poll que pisó el
      // estado) BORRABA los contactos/wallets recién inscritos. La BASE MANDA
      // para estas claves; solo cambian por su escritor dirigido.
      const CLIENT_COLLECTIONS = ['mouvContacts', 'walletContacts', 'notifications', 'notifiedEvents'];
      const PREFER_DB = [...SERVER_OWNED, ...CLIENT_COLLECTIONS];
      let haveDbRaw = false;
      try {
        // Con timeout: si esta consulta se cuelga (red móvil), el guardado
        // sigue igual — es solo un merge preventivo, no puede bloquear.
        const dbRes = await Promise.race([
          supabase.from('users').select('raw_data').eq('id', id).single(),
          new Promise<{ data: null }>(resolve => setTimeout(() => resolve({ data: null }), 4000)),
        ]) as any;
        if (dbRes?.data?.raw_data) {
          haveDbRaw = true;
          const dbRaw = dbRes.data.raw_data as Record<string, any>;
          safeRest = { ...dbRaw, ...safeRest };
          // Los campos del servidor y las colecciones del cliente SIEMPRE
          // reflejan la base, nunca la memoria (que puede estar vieja).
          for (const k of PREFER_DB) {
            if (k in dbRaw) safeRest[k] = dbRaw[k];
            else delete safeRest[k];
          }
        }
      } catch { /* non-blocking */ }
      // Solo se escribe raw_data si pudimos hacer el merge seguro contra la
      // base. Si no, se omite (el upsert deja la columna intacta en un UPDATE).
      const rawDataField = haveDbRaw ? { raw_data: safeRest } : {};
      const result = await Promise.race([
        supabase.from('users').upsert({
          id, email, role,
          full_name: name,
          balances: fiatBalances,
          crypto_balances: cryptoBalances,
          kyc_status: kycStatus,
          // Personal KYC
          first_name: firstName,
          last_name: lastName,
          birth_date: birthDate,
          nationality,
          profession,
          doc_type: docType,
          doc_number: docNumber,
          doc_country: countryOfIssue,
          residence_country: country,
          city,
          address,
          zip_code: zipCode,
          // Business
          company_name: companyName,
          company_country: companyCountry,
          company_city: companyCity,
          company_address: companyAddress,
          tax_id: taxId,
          tax_id_type: taxIdType,
          // Legal representative
          rep_legal_name: repLegalName,
          rep_first_name: repFirstName,
          rep_last_name: repLastName,
          rep_dob: repDob,
          rep_nationality: repNationality,
          rep_doc_type: repDocType,
          rep_doc_number: repDocNumber,
          rep_doc_country: repDocCountry,
          is_pep: isPep,
          documents,
          ...rawDataField,
        }),
        timeout,
      ]);
      const { error } = result as { data: any; error: any };
      if (error) {
        console.error('[saveUser] UPSERT failed:', error.message, error.hint, error.code, { id, balances });
        // Fallback GENERAL (no solo admin): la RLS endurecida de public.users
        // solo deja escribir a 'authenticated' con auth.uid()=id o
        // is_any_admin() — una sesión SIN JWT real (AdminBypass, o un login
        // de cliente que cayó al respaldo user-login) no tiene ninguna, así
        // que el upsert de arriba SIEMPRE falla para ella. Sin este
        // fallback, CUALQUIER usuario (no solo admins) "guardaba" (optimista
        // en su propia pantalla) y el cambio nunca llegaba a la fila real —
        // el saldo se veía descontado un momento y volvía a subir solo. No
        // agrega ningún permiso nuevo: admin-data valida adentro que quien
        // llama sea admin O el dueño real de esa fila (mismo id).
        try {
          const SURL2 = (import.meta.env.VITE_SUPABASE_URL as string) || '';
          const SKEY2 = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
          const authHeader = `Bearer ${token ?? SKEY2}`;
          const r = await fetch(`${SURL2}/functions/v1/admin-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SKEY2, Authorization: authHeader },
            body: JSON.stringify({
              action: 'save_user',
              user: {
                id, email, role, full_name: name,
                balances: fiatBalances, crypto_balances: cryptoBalances,
                kyc_status: kycStatus,
                first_name: firstName, last_name: lastName, birth_date: birthDate,
                nationality, profession, doc_type: docType, doc_number: docNumber,
                doc_country: countryOfIssue, residence_country: country, city, address, zip_code: zipCode,
                company_name: companyName, company_country: companyCountry, company_city: companyCity, company_address: companyAddress,
                tax_id: taxId, tax_id_type: taxIdType,
                rep_legal_name: repLegalName, rep_first_name: repFirstName, rep_last_name: repLastName,
                rep_dob: repDob, rep_nationality: repNationality, rep_doc_type: repDocType,
                rep_doc_number: repDocNumber, rep_doc_country: repDocCountry, is_pep: isPep,
                documents, ...rawDataField,
              },
            }),
          }).then(r2 => r2.json()).catch((e2: any) => ({ error: String(e2?.message ?? e2) }));
          if (r?.error) console.error('[saveUser] fallback admin-data también falló:', r.error);
          else pendingWriteUntilRef.current = 0;
        } catch (e2) {
          console.error('[saveUser] fallback admin-data threw:', e2);
        }
      } else {
        // Write confirmed — allow fetchData to sync currentUser again
        pendingWriteUntilRef.current = 0;
      }
    } catch (e) {
      console.error('[saveUser] threw:', e);
      pendingWriteUntilRef.current = 0;
    }
  };

  // Guardado DIRIGIDO de raw_data (contactos, preferencias...): escribe SOLO
  // la columna raw_data — nunca balances/role/kyc. updateUserProfile escribe
  // el perfil completo y el candado users_sensitive_cols_guard rechaza TODO
  // el update si una columna sensible difiere de la base (p. ej. saldos en
  // memoria desactualizados tras un cargue del admin) — así se "perdían" los
  // contactos al recargar. Devuelve true solo si la base CONFIRMÓ el write.
  const updateUserRawData = async (id: string, patch: Record<string, any>): Promise<boolean> => {
    if (!isSupabaseConfigured) {
      const u = users.find(x => x.id === id);
      if (!u) return false;
      lsUpsertUser({ ...u, ...patch });
      setUsers(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
      if (currentUser?.id === id) setCurrentUser(prev => prev ? { ...prev, ...patch } : prev);
      return true;
    }
    try {
      // Merge contra la fila REAL para no pisar campos de otros flujos.
      const { data: cur } = await Promise.race([
        supabase.from('users').select('raw_data').eq('id', id).single(),
        new Promise<{ data: null }>(resolve => setTimeout(() => resolve({ data: null }), 5000)),
      ]) as any;
      // ⚠️ SEGURIDAD (2FA): si la pre-lectura FALLA (timeout en red móvil, error
      // transitorio) NO se hace el update directo con un merge PARCIAL — eso
      // escribía `{...patch}` a secas y BORRABA el 2FA/wallet del raw_data. Solo
      // se hace el update directo cuando la lectura vino OK; si no, se va al
      // fallback service-role que re-lee FRESCO y hace merge sobre la fila real.
      const readOk = !!(cur && cur.raw_data != null && typeof cur.raw_data === 'object');
      const merged = readOk ? { ...cur.raw_data, ...patch } : { ...patch };
      // RLS bloquea updates EN SILENCIO (0 filas afectadas, sin error) — el
      // .select('id') obliga a devolver la fila tocada: sin fila = no escribió.
      let ok = false;
      if (readOk) {
        const { data: updRows, error } = await supabase.from('users').update({ raw_data: merged }).eq('id', id).select('id');
        if (!error && Array.isArray(updRows) && updRows.length > 0) ok = true;
      }
      if (!ok) {
        // Fallback: save_user del edge (service-role). Se manda SOLO el patch —
        // admin-data lo mezcla sobre el raw_data FRESCO de la base y fuerza los
        // campos del servidor (2FA/wallet), así jamás se pierden aunque la
        // pre-lectura del cliente hubiera fallado.
        const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
        const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
        const token = getStoredToken();
        const r = await fetch(`${SURL}/functions/v1/admin-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: token ? `Bearer ${token}` : `Bearer ${SKEY}` },
          body: JSON.stringify({ action: 'save_user', user: { id, raw_data: patch } }),
        }).then(x => x.json()).catch(() => null);
        ok = !!r?.success;
      }
      if (ok) {
        pendingWriteUntilRef.current = Date.now() + 10000;
        setUsers(prev => prev.map(x => x.id === id ? { ...x, ...patch } as any : x));
        if (currentUser?.id === id) setCurrentUser(prev => prev ? { ...prev, ...patch } as any : prev);
      }
      return ok;
    } catch (e) {
      console.error('[updateUserRawData] threw:', e);
      return false;
    }
  };

  const saveTx = async (tx: any) => {
    const { userId, type, amount, currency, status, ...rest } = tx;

    // Optimistic local update — movement appears immediately
    const tempId = Date.now();
    const localTx: Transaction = { id: tempId, userId, type, amount, currency, status, ...rest };
    setTransactions(prev => [localTx, ...prev]);

    if (!isSupabaseConfigured) { lsInsertTx(tx); return; }

    const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
    const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
    const txToken = getStoredToken();

    // ⚠️ Antes había, ADEMÁS de este insert, un "keepalive insert" separado
    // (fetch directo a /rest/v1/transactions) que se disparaba SIEMPRE, sin
    // esperar a ver si este insert fallaba. Los dos se ejecutaban en
    // paralelo y AMBOS insertaban la fila si la RLS lo permitía — cada envío
    // quedaba duplicado en la DB por diseño, no por una condición de
    // carrera. Se quitó: este insert (con su fallback a admin-data abajo)
    // es suficiente y es el único que corre.
    //
    // Insertar vía supabase client para que la fila quede en DB de forma
    // confiable. Al tener éxito, se cambia el ID temporal (timestamp) por el
    // ID real de la DB para que fetchData no cree un duplicado al sincronizar.
    try {
      const { data: inserted, error } = await supabase
        .from('transactions')
        .insert({ user_id: userId, type, amount, currency, status, raw_data: rest })
        .select('id')
        .single();
      if (inserted?.id) {
        setTransactions(prev => prev.map(t => t.id === tempId ? { ...t, id: inserted.id } : t));
        return;
      }
      // ⚠️ La RLS de public.transactions solo dejaba insertar a admins — un
      // cliente normal (con JWT real o no) nunca podía crear su propio
      // registro de envío/depósito/conversión: esto fallaba en silencio
      // (ni siquiera lanzaba, `inserted` quedaba null) y la fila optimista
      // se quedaba en memoria del navegador PARA SIEMPRE, sin existir de
      // verdad en la DB — desaparecía sola al recargar. Fallback: insertar
      // vía admin-data con service-role, verificando self-o-admin adentro.
      if (error) {
        console.error('[saveTx] insert falló:', error.message, { userId, type });
        const authHeader = txToken ? `Bearer ${txToken}` : `Bearer ${SKEY}`;
        const r = await fetch(`${SURL}/functions/v1/admin-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: authHeader },
          body: JSON.stringify({ action: 'insert_transaction', tx: { user_id: userId, type, amount, currency, status, raw_data: rest } }),
        }).then(r2 => r2.json()).catch((e2: any) => ({ error: String(e2?.message ?? e2) }));
        if (r?.id != null) {
          setTransactions(prev => prev.map(t => t.id === tempId ? { ...t, id: r.id } : t));
        } else {
          console.error('[saveTx] fallback admin-data también falló:', r?.error);
        }
      }
    } catch (e) {
      console.error('[saveTx] threw:', e);
      /* optimistic row stays visible locally even though nothing landed in DB */
    }
  };

  const updateTxStatus = async (id: number, updates: Partial<Transaction>) => {
    if (!isSupabaseConfigured) { lsUpdateTx(id, updates); fetchData(); return; }
    const { error } = await supabase.from('transactions').update(updates).eq('id', id);
    if (error) console.error('[updateTxStatus] UPDATE failed:', error.message, error.hint, { id, updates });
    fetchData();
  };

  // --- AUTH ---

  const loginUser = async (email: string, pass?: string, captchaToken?: string): Promise<User | null | 'MFA_REQUIRED'> => {
    const isSeedAdminEmail = !!SEED_ADMIN_EMAIL && email === SEED_ADMIN_EMAIL;
    // Cada login EXPLÍCITO vuelve a exigir 2FA: se borra la marca 'mfa_ok' (que
    // solo debe durar mientras la sesión ya verificada se refresca). Sin esto,
    // un logout+login en la MISMA pestaña se saltaba el 2FA.
    try { sessionStorage.removeItem('mfa_ok'); } catch { /* */ }
    setLoginError(null);
    // Opciones de auth con el token del CAPTCHA (si Turnstile está activo).
    const authOpts = captchaToken ? { captchaToken } : undefined;

    // ── SEGURIDAD (migración del login admin) ──────────────────────────────
    // Para el correo de admin se intenta PRIMERO una cuenta REAL de Supabase
    // (sesión con JWT y role='admin' en la tabla users). Si existe, ese es el
    // camino seguro y se usa. El AdminBypass local de abajo queda solo como
    // RED DE SEGURIDAD por si la cuenta real aún no está creada — así nunca
    // te quedas fuera del panel durante la transición. Cuando confirmes que
    // entras con la cuenta real, se retira el bypass (Fase 2).
    if (isSupabaseConfigured && isSeedAdminEmail && pass) {
      try {
        const { data, error } = await Promise.race([
          supabase.auth.signInWithPassword({ email, password: pass, options: authOpts }),
          new Promise<any>(resolve => setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), 6000)),
        ]) as any;
        if (!error && data?.user) {
          const { data: profile } = await supabase.from('users').select('*').eq('id', data.user.id).single();
          if ((profile as any)?.role === 'admin') {
            const u = mapSupabaseUser(profile);
            // 2FA en el login del admin: si tiene el 2FA custom activo, NO se
            // entra directo — se pide el código de 6 dígitos antes de dar acceso.
            if ((u as any)?.mfaEnabled || (profile as any)?.raw_data?.mfaEnabled) {
              beginMfaFlow(u, 'custom');
              return 'MFA_REQUIRED';
            }
            setCurrentUser(u);
            logAdminLogin(u);
            return u;
          }
          // La cuenta existe pero todavía NO es admin en la tabla users → no
          // dejamos una sesión no-admin colgando; cerramos y caemos al bypass.
          try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* noop */ }
        }
      } catch { /* cae al AdminBypass local */ }
    }

    // (Se eliminó el "admin bypass" por contraseña de entorno: fabricaba una
    //  sesión de admin sin JWT, sin 2FA y sin registro. El admin entra con su
    //  cuenta real de Supabase.)

    if (!isSupabaseConfigured) {
      const user = users.find(u => u.email === email && u.password === pass);
      if (user) { setCurrentUser(user); return user; }
      return null;
    }
    const authTimeout = new Promise<{ data: { user: null; session: null }; error: { message: string; status: number } }>(
      resolve => setTimeout(() => resolve({ data: { user: null, session: null }, error: { message: 'auth_timeout', status: 408 } }), 6000)
    );
    const { data, error } = await Promise.race([
      supabase.auth.signInWithPassword({ email, password: pass!, options: authOpts }),
      authTimeout,
    ]);
    if (error) {
      // Traducir el motivo REAL antes de caer a los respaldos. Un CAPTCHA
      // rechazado y una contraseña mala no se arreglan igual, y hasta ahora
      // los dos decían lo mismo.
      {
        const cruda = String((error as any)?.message ?? 'sin mensaje');
        const m = cruda.toLowerCase();
        // Se ADJUNTA el error crudo de Supabase entre corchetes. Traducirlo a
        // un texto amable ayuda a quien lo lee, pero esconder el original hace
        // imposible diagnosticar: llevamos varias rondas sin poder distinguir
        // "clave mala" de "cuenta inexistente" de "CAPTCHA rechazado".
        const conCruda = (txt: string) => `${txt} [${cruda}]`;
        setLoginError2(conCruda,
          m.includes('captcha')
            ? 'La verificación anti-bot (CAPTCHA) rechazó el intento. Recarga la página y vuelve a marcarla — el código del CAPTCHA sirve una sola vez.'
          : m.includes('email not confirmed') || m.includes('not confirmed')
            ? 'La cuenta existe pero el correo no está confirmado. Confírmalo en Authentication → Users.'
          : m.includes('invalid login credentials')
            ? 'Correo o contraseña incorrectos.'
          : m.includes('timeout') || m.includes('fetch')
            ? 'No hubo respuesta del servidor de autenticación. Revisa tu conexión.'
          : m.includes('rate') || m.includes('too many')
            ? 'Demasiados intentos. Espera unos minutos.'
          : 'No se pudo iniciar sesión.'
        );
      }
      // Any Supabase Auth error → fall back to DB lookup (covers 400 invalid creds, 500 server, timeout, site URL issues)
      {
        console.warn('[loginUser] Supabase Auth error, trying DB fallback:', error.message);

        // Try user-login edge function (uses service role key, bypasses RLS for all users)
        if (SUPABASE_URL_FOR_FN && SUPABASE_ANON_FOR_FN) {
          try {
            const fnRes = await Promise.race([
              fetch(`${SUPABASE_URL_FOR_FN}/functions/v1/user-login`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': SUPABASE_ANON_FOR_FN,
                  'Authorization': `Bearer ${SUPABASE_ANON_FOR_FN}`,
                },
                body: JSON.stringify({ email, password: pass }),
              }),
              new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
            ]);
            if (fnRes.ok) {
              const { user: fnUser, authSynced } = await fnRes.json();
              if (fnUser) {
                const mapped = mapSupabaseUser(fnUser);
                // ⚠️ SEGURIDAD: este camino de respaldo NO puede saltarse el
                // 2FA. Si la cuenta lo tiene activo se exige el código igual
                // que en el login normal. Primero se ESPERA la sesión real
                // (el fn de servicio ya sincronizó la contraseña) para que la
                // verificación del código tenga un JWT con el cual
                // autorizarse; sin sesión, se deniega — nunca se entra.
                if ((mapped as any)?.mfaEnabled || (fnUser as any)?.raw_data?.mfaEnabled) {
                  if (authSynced) {
                    try { await supabase.auth.signInWithPassword({ email, password: pass! }); } catch { /* */ }
                  }
                  beginMfaFlow(mapped, 'custom');
                  return 'MFA_REQUIRED';
                }
                setCurrentUser(mapped);
                // user-login (service-role) acaba de sincronizar/crear el
                // usuario de Auth con esta contraseña — reintentar el login
                // REAL en segundo plano para que esta sesión termine con un
                // JWT de verdad. Sin esto, el cliente queda "medio
                // autenticado" para siempre: ve sus datos (las lecturas
                // pasan por RPCs que no exigen JWT) pero CUALQUIER guardado
                // (saldos, envíos, conversiones) falla en silencio porque la
                // RLS de public.users exige auth.uid()=id. No se espera esta
                // llamada — no debe demorar el login que el usuario ya ve.
                if (authSynced) {
                  supabase.auth.signInWithPassword({ email, password: pass! }).catch(() => {});
                }
                return mapped;
              }
            }
          } catch (fnErr) {
            console.warn('[loginUser] user-login fn failed (non-fatal):', fnErr);
          }
        }

        // Fallback: direct DB query (works if RLS allows anon reads)
        const dbTimeout = new Promise<{ data: null; error: any }>(resolve =>
          setTimeout(() => resolve({ data: null, error: 'db_timeout' }), 5000)
        );
        const { data: fbProfile } = await Promise.race([
          supabase.from('users').select('*').eq('email', email).single(),
          dbTimeout,
        ]) as any;
        if (fbProfile) {
          const storedHash = fbProfile.raw_data?.passwordHash as string | undefined;
          if (storedHash) {
            const inputHash = await hashPassword(pass!, email);
            if (!inputHash || inputHash !== storedHash) {
              setLoginError('Correo o contraseña incorrectos. [respaldo: hash local no coincide]');
              logFailedLogin(email, 'contraseña incorrecta'); return null;
            }
          } else {
            // First fallback login — store hash for future use
            const hash = await hashPassword(pass!, email);
            if (hash) {
              try {
                await supabase.from('users').update({
                  raw_data: { ...(fbProfile.raw_data || {}), passwordHash: hash },
                }).eq('id', fbProfile.id);
              } catch {}
            }
          }
          const user = mapSupabaseUser(fbProfile);
          // ⚠️ SEGURIDAD: igual que arriba — una cuenta con 2FA activo jamás
          // entra por el respaldo directo a la base. Aquí no hay sesión de
          // Auth (justo falló), así que la verificación del código no podrá
          // autorizarse y el acceso queda denegado: es el comportamiento
          // correcto (fallar cerrado), no un atajo.
          if ((user as any)?.mfaEnabled || fbProfile.raw_data?.mfaEnabled) {
            beginMfaFlow(user, 'custom');
            return 'MFA_REQUIRED';
          }
          setCurrentUser(user);
          return user;
        }
        // Not found in Supabase DB — user may have been created in offline/localStorage mode
        const localUsers = lsGetUsers();
        const localMatch = localUsers.find(u => u.email === email && u.password === pass);
        if (localMatch) {
          setCurrentUser(localMatch);
          return localMatch;
        }
      }
      // Ninguna vía reconoció las credenciales → queda registrado con IP.
      if (!loginErrorRef.current) setLoginError('Correo o contraseña incorrectos. [ninguna vía reconoció las credenciales]');
      logFailedLogin(email, 'credenciales incorrectas');
      return null;
    }
    if (!data.user) { setLoginError('El servidor aceptó la petición pero no devolvió la cuenta. Reintenta.'); return null; }

    const profileTimeout = new Promise<{ data: null }>(resolve => setTimeout(() => resolve({ data: null }), 6000));
    let { data: profile } = await Promise.race([
      supabase.from('users').select('*').eq('id', data.user.id).single(),
      profileTimeout,
    ]) as any;

    const isAdminEmail = data.user.email === SEED_ADMIN_EMAIL;

    if (!profile) {
      // ⚠️ Antes se creaba un perfil NUEVO de una vez. Si ya existía una fila
      // con ese correo pero con OTRO id (pasa al recrear la cuenta de acceso),
      // quedaban DOS filas para la misma persona: el login leía una y el panel
      // otra, y arreglarlo después chocaba contra la clave primaria. Primero se
      // busca por CORREO y, si aparece, se reusa esa fila en vez de duplicarla.
      try {
        const { data: porCorreo } = await Promise.race([
          supabase.from('users').select('*').eq('email', data.user.email!).maybeSingle(),
          new Promise<{ data: null }>(resolve => setTimeout(() => resolve({ data: null }), 5000)),
        ]) as any;
        if (porCorreo) {
          setLoginError(`Tu cuenta de acceso es nueva y todavía no está unida a tu perfil. Un administrador debe igualar el id del perfil (${String(porCorreo.id).slice(0, 8)}…) al de la cuenta (${String(data.user.id).slice(0, 8)}…).`);
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
          return null;
        }
      } catch { /* si la consulta falla, se sigue al alta normal */ }
      const id = data.user.id;
      const newProfile = {
        id,
        email: data.user.email!,
        full_name: data.user.email!.split('@')[0],
        role: isAdminEmail ? 'admin' : 'personal',
        balances: { USD: 0, COP: 0, CLP: 0, MXN: 0, PEN: 0 },
        kyc_status: isAdminEmail ? 'approved' : 'pending',
        raw_data: { notifications: [], ownReferralCode: id.slice(-6).toUpperCase() },
      };
      supabase.from('users').insert(newProfile);
      profile = newProfile;
    }
    // ⚠️ SECURITY: removido el auto-promote a admin desde el cliente.
    // El trigger guard_users_sensitive_cols en DB ahora bloquea estos
    // UPDATEs igual; los dejábamos pendientes silenciando errores. Admin
    // seed se hace por SQL (seed_admin_user.sql) o desde el Dashboard.

    const user = mapSupabaseUser(profile);

    // 2FA custom (TOTP nuestro): si la cuenta lo tiene activo, se pide el código
    // en el login antes de dar acceso. Cubre admin y clientes por igual.
    if ((user as any)?.mfaEnabled || (profile as any)?.raw_data?.mfaEnabled) {
      beginMfaFlow(user, 'custom');
      return 'MFA_REQUIRED';
    }

    try {
      const mfaTimeout = new Promise<{ data: null }>(resolve => setTimeout(() => resolve({ data: null }), 3000));
      const { data: aalData } = await Promise.race([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        mfaTimeout,
      ]) as any;
      if (aalData?.nextLevel === 'aal2' && aalData?.currentLevel !== 'aal2') {
        beginMfaFlow(user, 'native');
        return 'MFA_REQUIRED';
      }
    } catch { /* MFA not available, continue normally */ }

    setCurrentUser(user);
    return user;
  };

  // Segundo paso del ingreso: el código que llega al correo.
  // Arranca el ingreso mandando el código al correo. Es el PRIMER paso.
  const startEmailStep = async (userId: string): Promise<boolean> => {
    try {
      const SURL = SUPABASE_URL_FOR_FN, SKEY = SUPABASE_ANON_FOR_FN, token = getStoredToken();
      const r = await fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: token ? `Bearer ${token}` : `Bearer ${SKEY}` },
        body: JSON.stringify({ action: 'mfa_start_login', userId }),
      }).then(x => x.json()).catch(() => null);
      if (!r?.ok) { setMfaError2(r?.message ?? 'No se pudo enviar el código al correo.'); return false; }
      return true;
    } catch { setMfaError2('No se pudo enviar el código al correo.'); return false; }
  };

  // Punto ÚNICO por el que pasa cualquier ingreso que exija segundo factor.
  // Existe porque el arranque estaba repetido en cinco sitios y en dos se
  // olvidó: la pantalla saltaba al código de la app sin haber mandado el del
  // correo, y el servidor —con razón— lo rechazaba.
  const beginMfaFlow = (profile: any, mode: 'custom' | 'native') => {
    setPendingMFAProfile(profile);
    setPendingMFAMode(mode);
    setMfaPending(true);
    setMfaError2(null);
    if (mode === 'custom') {
      setEmailStepPending(true);      // PRIMER paso: el correo
      startEmailStep(profile.id);
    }
  };

  const completeEmailLogin = async (code: string): Promise<User | null> => {
    if (!pendingMFAProfile) return null;
    try {
      const SURL = SUPABASE_URL_FOR_FN, SKEY = SUPABASE_ANON_FOR_FN, token = getStoredToken();
      const r = await fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: token ? `Bearer ${token}` : `Bearer ${SKEY}` },
        body: JSON.stringify({ action: 'mfa_verify_email', userId: pendingMFAProfile.id, code }),
      }).then(x => x.json()).catch(() => null);
      if (!r?.ok) { setMfaError2(r?.message ?? 'Código de correo incorrecto o vencido.'); return null; }
      // Correo validado. Falta el código de la app: NO se entra todavía.
      setEmailStepPending(false);
      setMfaError2(null);
      return null;
    } catch { setMfaError2('No se pudo verificar el código del correo.'); return null; }
  };

  const resendEmailCode = async (): Promise<boolean> => {
    if (!pendingMFAProfile) return false;
    try {
      const SURL = SUPABASE_URL_FOR_FN, SKEY = SUPABASE_ANON_FOR_FN, token = getStoredToken();
      const r = await fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: token ? `Bearer ${token}` : `Bearer ${SKEY}` },
        body: JSON.stringify({ action: 'mfa_resend_email', userId: pendingMFAProfile.id }),
      }).then(x => x.json()).catch(() => null);
      return !!r?.ok;
    } catch { return false; }
  };

  const completeMFALogin = async (code: string): Promise<User | null> => {
    if (!pendingMFAProfile) return null;
    // 2FA CUSTOM: verifica el código contra el secreto CIFRADO en el servidor
    // (mfa_verify en admin-data descifra y valida). Es el esquema que activa la
    // tarjeta de Seguridad del admin y protege el cambio de proveedor.
    if (pendingMFAMode === 'custom') {
      try {
        const SURL = SUPABASE_URL_FOR_FN, SKEY = SUPABASE_ANON_FOR_FN, token = getStoredToken();
        const r = await fetch(`${SURL}/functions/v1/admin-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: token ? `Bearer ${token}` : `Bearer ${SKEY}` },
          body: JSON.stringify({ action: 'mfa_verify', userId: pendingMFAProfile.id, code, stage: 'login' }),
        }).then(x => x.json()).catch(() => null);
        if (!r?.ok) {
          // Diagnóstico: sin esto, un fallo de AUTORIZACIÓN o un secreto que no
          // se pudo leer se mostraban igual que "código incorrecto", y no había
          // forma de saber por qué no entra con un código válido.
          // El servidor manda un mensaje YA redactado para los casos que el
          // usuario puede resolver (límite de intentos, código repetido). Se
          // usa tal cual: mostrar el código interno ("too_many_attempts") no
          // le dice nada a quien está tratando de entrar.
          const why = r?.message ? String(r.message)
            : r?.error === 'code_reused'
            ? 'Ese código ya se usó. Espera al siguiente que muestre tu app.'
            : r?.error === 'secret_unreadable'
            ? (r?.hasBackupCodes
                ? 'El 2FA está activo pero su secreto quedó ilegible para el servidor. Usa uno de tus códigos de respaldo para entrar.'
                : 'El 2FA está activo pero su secreto quedó ilegible para el servidor (se guardó con otra llave). Hay que desactivar y volver a activar el 2FA.')
            : r?.error === 'backup_invalid'
            ? 'Ese código de respaldo no es válido o ya se usó. Cada código sirve una sola vez.'
            : r?.error === 'no_secret'
            ? 'La cuenta tiene el 2FA activo pero no hay ningún secreto guardado. Hay que reactivar el 2FA.'
            : r?.error === 'No autorizado'
              ? 'La sesión no autorizó la verificación. Vuelve a intentar el inicio de sesión.'
              : r?.error ? `Verificación rechazada: ${r.error}` : null;
          setMfaError2(why);
          // Un código de 2FA rechazado también es un intento fallido: es la
          // señal más clara de que alguien ya tiene la contraseña. PERO un
          // rechazo por límite de intentos NO es un código malo — contarlo
          // otra vez inflaba el conteo que bloquea la IP y castigaba dos
          // veces por lo mismo.
          if (r?.error !== 'too_many_attempts') {
            logFailedLogin(pendingMFAProfile.email ?? '', r?.error === 'backup_invalid' ? 'código de respaldo inválido' : 'código 2FA incorrecto');
          }
          return null;
        }
        const user = pendingMFAProfile;
        try { sessionStorage.setItem('mfa_ok', '1'); } catch { /* */ }
        setCurrentUser(user);
        setMfaPending(false);
        setPendingMFAProfile(null);
        logAdminLogin(user);
        return user;
      } catch { return null; }
    }
    // 2FA NATIVO de Supabase Auth.
    if (!isSupabaseConfigured) return null;
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const factorId = factors?.totp?.[0]?.id;
      if (!factorId) return null;
      const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeErr || !challenge) return null;
      const { error: verifyErr } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
      if (verifyErr) return null;
      const user = pendingMFAProfile;
      setCurrentUser(user);
      setMfaPending(false);
      setPendingMFAProfile(null);
      return user;
    } catch { return null; }
  };

  const cancelMFALogin = () => {
    if (isSupabaseConfigured) supabase.auth.signOut();
    try { sessionStorage.removeItem('mfa_ok'); } catch { /* */ }
    setMfaPending(false);
    setEmailStepPending(false);
    setPendingMFAProfile(null);
  };

  const enrollMFA = async (): Promise<{ qrCode: string; secret: string; factorId: string } | null> => {
    const email = currentUser?.email || 'usuario@cuypay.com';
    // Local TOTP first (works without Supabase Auth session)
    try {
      const secret = generateTOTPSecret();
      const qrCode = await getTOTPQRCode(secret, email);
      return { qrCode, secret, factorId: 'local' };
    } catch (e) {
      console.error('[enrollMFA] local TOTP failed, trying Supabase Auth:', e);
    }
    // Fallback: Supabase Auth MFA (requires valid session)
    if (!isSupabaseConfigured) return null;
    try {
      const { data: existing } = await supabase.auth.mfa.listFactors();
      const unverified = existing?.totp?.filter((f: any) => f.status === 'unverified') ?? [];
      for (const f of unverified) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'LINCOIN' });
      if (error || !data) return null;
      return { qrCode: data.totp.qr_code, secret: data.totp.secret, factorId: data.id };
    } catch { return null; }
  };

  const verifyMFAEnrollment = async (factorId: string, code: string, secret?: string): Promise<{ ok: boolean; error?: string; backupCodes?: string[] }> => {
    // If secret is provided, verify locally (no Supabase Auth required)
    if (secret) {
      const ok = verifyTOTP(secret, code);
      if (!ok) return { ok: false, error: 'Código incorrecto. Intenta nuevamente.' };
      // Persistencia ROBUSTA vía updateUserRawData: escribe SOLO la columna
      // raw_data (no dispara el candado de columnas sensibles como saveUser),
      // verifica que la fila realmente se tocó (.select('id')) y, si la RLS lo
      // bloquea en silencio, cae al edge admin-data con service-role. Actualiza
      // el estado en memoria con los campos aplanados Y anidados, así el 2FA
      // queda activo al instante y sigue activo tras recargar la página.
      if (currentUser) {
        // Optimista: marcar activo sin conservar el secreto en claro en estado.
        setCurrentUser((prev: any) => prev ? { ...prev, mfaEnabled: true, mfaFactorId: factorId } : prev);
        // Guardar el secreto CIFRADO en el servidor (mfa_set). Así nunca queda
        // en texto plano en la base. Si el endpoint no está desplegado, cae al
        // guardado legacy (texto plano) para no romper la activación.
        try {
          const SURL = SUPABASE_URL_FOR_FN; const SKEY = SUPABASE_ANON_FOR_FN; const token = getStoredToken();
          const r = await fetch(`${SURL}/functions/v1/admin-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: token ? `Bearer ${token}` : `Bearer ${SKEY}` },
            body: JSON.stringify({ action: 'mfa_set', userId: currentUser.id, secret, factorId }),
          }).then(x => x.json()).catch(() => null);
          // Los códigos de respaldo se devuelven UNA sola vez: aquí. La tarjeta
          // de Seguridad los muestra para que el titular los guarde. Después ya
          // no se pueden volver a leer (en la base solo queda su hash).
          if (r?.success) return { ok: true, backupCodes: r.backupCodes as string[] | undefined };
          // Se ELIMINÓ el guardado "legacy" que caía aquí y escribía el
          // secreto en TEXTO PLANO desde el navegador. Hacía dos daños: dejaba
          // la llave del 2FA legible en la fila, y como la base ahora blinda
          // esas claves contra escrituras del navegador, el guardado se
          // descartaba en silencio y la pantalla decía "activado" con el 2FA
          // apagado. Si el servidor no pudo guardarlo, se dice y no se activa.
          setCurrentUser((prev: any) => prev ? { ...prev, mfaEnabled: false, mfaFactorId: undefined } : prev);
          return { ok: false, error: r?.error ? String(r.error) : 'No pudimos guardar la verificación en dos pasos. No quedó activada — reintenta.' };
        } catch {
          setCurrentUser((prev: any) => prev ? { ...prev, mfaEnabled: false, mfaFactorId: undefined } : prev);
          return { ok: false, error: 'No pudimos contactar al servidor para guardar el 2FA. No quedó activada — reintenta.' };
        }
      }
      return { ok: true };
    }
    // No secret: check stored secret first (for existing enrolled users).
    // raw_data está aplanado tras recargar, anidado justo tras activar → ambos.
    const cu = currentUser as any;
    const storedSecret = (cu?.totpSecret ?? cu?.raw_data?.totpSecret) as string | undefined;
    if (storedSecret) {
      const ok = verifyTOTP(storedSecret, code);
      return ok ? { ok: true } : { ok: false, error: 'Código incorrecto. Intenta nuevamente.' };
    }
    // Last resort: Supabase Auth challenge/verify (requires valid session)
    if (!isSupabaseConfigured) return { ok: false, error: 'No hay secreto disponible para verificar' };
    const withTimeout = (p: Promise<any>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 9000))]);
    try {
      const { data: challenge, error: challengeErr } = await withTimeout(supabase.auth.mfa.challenge({ factorId }));
      if (challengeErr) return { ok: false, error: challengeErr.message };
      if (!challenge) return { ok: false, error: 'No se pudo crear el desafío' };
      const { error: verifyErr } = await withTimeout(supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code }));
      if (verifyErr) return { ok: false, error: verifyErr.message };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message === 'timeout' ? 'Sin respuesta del servidor. Revisa tu conexión.' : (e?.message || 'Error desconocido') };
    }
  };

  // Verifica un código 2FA. Si el secreto está en memoria (recién activado o
  // legacy en claro) valida local; si no (secreto cifrado en la base), lo
  // valida el SERVIDOR con mfa_verify. Devuelve true/false.
  const verifyMfaCode = async (code: string): Promise<boolean> => {
    const cu = currentUser as any;
    const localSecret = (cu?.totpSecret ?? cu?.raw_data?.totpSecret) as string | undefined;
    if (localSecret) { try { return verifyTOTP(localSecret, code); } catch { return false; } }
    if (!currentUser) return false;
    try {
      const SURL = SUPABASE_URL_FOR_FN; const SKEY = SUPABASE_ANON_FOR_FN; const token = getStoredToken();
      const r = await fetch(`${SURL}/functions/v1/admin-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: token ? `Bearer ${token}` : `Bearer ${SKEY}` },
        body: JSON.stringify({ action: 'mfa_verify', userId: currentUser.id, code }),
      }).then(x => x.json()).catch(() => null);
      return !!r?.ok;
    } catch { return false; }
  };

  const unenrollMFA = async (factorId: string): Promise<boolean> => {
    // Local TOTP factors don't exist in Supabase Auth — just succeed
    const cuu = currentUser as any;
    if (factorId === 'local' || cuu?.totpSecret || cuu?.raw_data?.totpSecret) return true;
    if (!isSupabaseConfigured) return true;
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      return !error;
    } catch { return true; }
  };

  const getMFAStatus = async (): Promise<{ enrolled: boolean; factorId?: string; totpSecret?: string }> => {
    // Always check raw_data first — most reliable without needing Supabase Auth session.
    // ⚠️ mapSupabaseUser APLANA raw_data al nivel superior del usuario, así que
    // tras recargar la página los campos viven en currentUser.mfaEnabled (no en
    // currentUser.raw_data). Justo después de activar el 2FA sí están anidados
    // en raw_data. Leemos de AMBOS para que persista en los dos casos.
    const u = currentUser as any;
    const raw = u?.raw_data ?? {};
    const mfaEnabled  = u?.mfaEnabled  ?? raw?.mfaEnabled;
    const mfaFactorId = u?.mfaFactorId ?? raw?.mfaFactorId;
    const totpSecret  = u?.totpSecret  ?? raw?.totpSecret;
    if (mfaEnabled && mfaFactorId) {
      return { enrolled: true, factorId: mfaFactorId, totpSecret };
    }
    // Try Supabase Auth as secondary (only works with a valid session)
    if (isSupabaseConfigured) {
      try {
        const { data } = await Promise.race([
          supabase.auth.mfa.listFactors(),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('mfa_timeout')), 3000)),
        ]) as any;
        const verified = data?.totp?.find((f: any) => f.status === 'verified');
        if (verified) return { enrolled: true, factorId: verified.id };
      } catch { /* no session or Auth down */ }
    }
    return { enrolled: false };
  };

  const loginWithGoogle = async (role: 'personal' | 'business' = 'business') => {
    if (!isSupabaseConfigured) return;
    // Persist role so it survives the OAuth redirect
    localStorage.setItem('cuypay_oauth_role', role);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  };

  const logoutUser = async () => {
    // Increment before any await so in-flight SIGNED_IN handlers abort instead of re-setting the user
    logoutCounterRef.current++;
    sessionStorage.removeItem('cuypay_admin_session');
    try { sessionStorage.removeItem('mfa_ok'); } catch { /* */ }
    localStorage.removeItem('cuypay_config');
    // Purga proactiva del token de Supabase: si el signOut de red se cuelga,
    // igual NO queda una sesión "fantasma" en localStorage que dispare
    // "Verificando sesión" en la próxima visita sin haber iniciado sesión.
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
        .forEach(k => localStorage.removeItem(k));
    } catch { /* localStorage no disponible */ }
    setCurrentUser(null);
    setIsAuthLoading(false);
    // NO bloquear la UI esperando la red: el cierre local ya ocurrió arriba
    // (estado limpio + token purgado). El signOut se dispara en segundo plano
    // con un timeout de respaldo, para que "Cerrar sesión" sea instantáneo y
    // no se quede "Cerrando…" cuando la red está lenta.
    if (isSupabaseConfigured) {
      Promise.race([
        supabase.auth.signOut({ scope: 'local' }),
        new Promise<void>(res => setTimeout(res, 1500)),
      ]).catch(() => { /* señal de red flaky: el estado local ya está limpio */ });
    }
  };

  const registerUser = async (data: any): Promise<{ error?: string }> => {
    if (!isSupabaseConfigured) {
      const id = `usr_${Math.random().toString(36).substr(2, 9)}`;
      const newUser: User = {
        id, balances: { USD: 0, COP: 0, CLP: 0, MXN: 0, PEN: 0 },
        kycStatus: 'pending', notifications: [], ...data,
        ownReferralCode: id.toUpperCase().slice(-6),
      };
      lsUpsertUser(newUser);
      setCurrentUser(newUser);
      fetchData();
      return {};
    }

    // Embed role in user_metadata so onAuthStateChange can read it reliably without
    // relying on localStorage (which is prone to race conditions with hashPassword async gap).
    // Keep localStorage as a secondary fallback for email-confirmation redirects.
    localStorage.setItem('cuypay_register_role', data.role || 'business');

    const { data: authData, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          role: data.role || 'business',
          full_name: data.name || 'Usuario',
        },
        ...(data.captchaToken ? { captchaToken: data.captchaToken } : {}),
      },
    });
    if (error) return { error: error.message };
    if (!authData.user) return { error: 'No se pudo crear la cuenta.' };

    const id = authData.user.id;
    const intendedRole = data.role || 'business';

    // Build profile WITHOUT hash first — insert IMMEDIATELY before hashPassword's async gap
    // so onAuthStateChange's profile fetch finds our row with the correct role.
    const newProfile: any = {
      id,
      email: data.email,
      full_name: data.name || 'Usuario',
      role: intendedRole,
      balances: { USD: 0, COP: 0, CLP: 0, MXN: 0, PEN: 0 },
      kyc_status: 'pending',
      raw_data: {
        notifications: [],
        ownReferralCode: id.slice(-6).toUpperCase(),
        referralCode: data.referralCode,
      },
    };

    const { error: insertError } = await supabase.from('users').insert(newProfile);
    if (insertError) {
      // Duplicate key — onAuthStateChange beat us to creating the profile.
      // Force-update the role and name to what was actually intended at registration.
      try {
        await supabase.from('users')
          .update({ role: intendedRole, full_name: data.name || 'Usuario' })
          .eq('id', id);
      } catch {}
    } else {
      localStorage.removeItem('cuypay_register_role');
    }

    // Compute hash after INSERT (non-blocking for login) and patch raw_data
    const passwordHash = await hashPassword(data.password, data.email);
    if (passwordHash) {
      supabase.from('users').update({
        raw_data: { ...newProfile.raw_data, passwordHash },
      }).eq('id', id).then(null, () => {});
      newProfile.raw_data = { ...newProfile.raw_data, passwordHash };
    }

    if (authData.session) setCurrentUser(mapSupabaseUser(newProfile));
    return {};
  };

  // --- ACTIONS ---

  const getBalance = (c: string) => currentUser?.balances[c] || 0;
  // Actualización OPTIMISTA del saldo local (la escritura autoritativa ya la
  // hizo el edge). Sirve para que la vista refleje al instante un cambio de
  // saldo sin depender de que fetchData relea a tiempo (que en sesiones
  // half-auth puede tardar/leer una fila distinta).
  const bumpLocalBalance = (currency: string, delta: number) => {
    setCurrentUser(prev => prev ? { ...prev, balances: { ...prev.balances, [currency]: (prev.balances?.[currency] || 0) + delta } } : prev);
  };
  // Agrega un movimiento a la lista AL INSTANTE (optimista). El movimiento real
  // ya lo escribió el edge; esto evita que la lista se vea "atrasada" mientras
  // fetchData relee (que en half-auth puede tardar). Al próximo fetch la lista
  // se reemplaza por la real (con su id definitivo), sin duplicar de forma
  // permanente. Se coalesce por `dedupKey` (ej. traceId) si se repite.
  const addLocalTx = (tx: Record<string, any>) => {
    const local = { id: Date.now(), createdAt: new Date().toISOString(), ...tx };
    setTransactions(prev => {
      const k = tx.dedupKey;
      const base = k ? prev.filter((t: any) => (t as any).dedupKey !== k) : prev;
      return [local as any, ...base];
    });
  };
  const getPersonalMovements = () => transactions.filter(t =>
    t.userId === currentUser?.id || emailUserIdsRef.current.includes(t.userId));
  const getUserNotifications = () => currentUser?.notifications || [];

  const updateUserProfile = async (id: string, data: any) => {
    if (!currentUser) return;
    if (currentUser.role !== 'admin' && currentUser.id !== id) return;
    const base = id === currentUser.id ? currentUser : users.find(u => u.id === id);
    if (!base) return;
    const updated = { ...base, ...data };
    // Always MERGE balances — never replace — so fiat ops don't wipe crypto and vice versa
    if (data.balances) {
      updated.balances = { ...base.balances, ...data.balances };
    }
    // Igual que performConversion/requestWithdrawal: sin esto, si fetchData()
    // (poll cada 10s o un evento realtime) llega ANTES de que el upsert de
    // abajo termine, pisa este cambio optimista con el valor viejo de la DB
    // — se ve "revertirse" solo aunque sí se guardó bien (fue solo que el
    // poll ganó la carrera). Antes esto SOLO protegía currentUser — cuando
    // un admin editaba a OTRO usuario (ej. activar OTC de un cliente),
    // fetchData() pisaba el arreglo `users` sin ningún guard (ver más abajo,
    // el setUsers(mappedUsers) del poll admin no chequeaba este ref), y el
    // toggle volvía solo a "Inactivo" aunque el guardado real sí funcionara.
    pendingWriteUntilRef.current = Date.now() + 10000;
    // Update in-memory state immediately so UI doesn't get stuck even if DB save fails
    if (id === currentUser.id) setCurrentUser(updated);
    setUsers(prev => prev.map(u => u.id === id ? updated : u));
    try {
      await saveUser(updated);
    } catch (e) {
      console.error('saveUser failed, in-memory state is updated:', e);
    }
  };

  const requestDeposit = async (amount: number, currency: string, method: string, proofUrl?: string) => {
    if (!currentUser) return;
    saveTx({
      userId: currentUser.id,
      userName: currentUser.name,
      userRole: currentUser.role,
      type: 'load',
      initials: 'DP',
      title: `Carga ${currency}`,
      date: new Date().toLocaleDateString(), createdAt: new Date().toISOString(),
      amount, currency, status: 'Pendiente', method, proofUrl,
    }).catch(() => {});
  };

  const requestWithdrawal = async (amount: number, currency: string, bank: string, account: string, beneficiary: string, reason: string, docType?: string, docNumber?: string, debitKey?: string) => {
    // El saldo puede salir de un riel distinto al de la moneda mostrada:
    // COP tiene 3 billeteras separadas (COP / COP_BREB / COP_ACH). `debitKey`
    // dice de cuál se debita; el registro guarda `currency` para el display.
    const key = debitKey || currency;
    if (!currentUser || getBalance(key) < amount) return;
    const newBal = { ...currentUser.balances, [key]: getBalance(key) - amount };
    pendingWriteUntilRef.current = Date.now() + 10000;
    setCurrentUser(prev => prev ? { ...prev, balances: newBal } : prev);
    setUsers(prev => prev.map(u => u.id === currentUser.id ? { ...u, balances: newBal } : u));
    saveUser({ ...currentUser, balances: newBal }).catch(() => {});
    saveTx({
      userId: currentUser.id,
      userName: currentUser.name,
      userRole: currentUser.role,
      type: 'send',
      initials: 'EN',
      title: `Envío ${currency}`,
      date: new Date().toLocaleDateString(), createdAt: new Date().toISOString(),
      amount, currency, status: 'Pendiente', bank, account, beneficiary, reason,
      ...(docType ? { documentType: docType } : {}),
      ...(docNumber ? { documentNumber: docNumber } : {}),
    }).catch(() => {});
  };

  const performConversion = async (src: string, tgt: string, amtS: number, amtT: number, fee: number, coupon?: string): Promise<{ error?: string }> => {
    if (!currentUser) return { error: 'No autenticado' };
    if (getBalance(src) < amtS) return { error: 'Saldo insuficiente' };
    const prevBalances = currentUser.balances;
    const newBal = { ...currentUser.balances, [src]: getBalance(src) - amtS, [tgt]: (currentUser.balances[tgt] || 0) + amtT };
    pendingWriteUntilRef.current = Date.now() + 10000;
    // Update local state immediately so UI reflects change without waiting for DB
    setCurrentUser(prev => prev ? { ...prev, balances: newBal } : prev);
    setUsers(prev => prev.map(u => u.id === currentUser.id ? { ...u, balances: newBal } : u));

    const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
    const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
    const creditFee = () => {
      if (fee > 0 && isSupabaseConfigured && SURL) {
        fetch(`${SURL}/functions/v1/admin-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
          body: JSON.stringify({ action: 'credit_conversion_fee', currency: src, amount: fee, fromUserId: currentUser.id, note: `Comisión conversión ${src}→${tgt}` }),
        }).catch(() => {});
      }
    };

    // ── Vía SEGURA: el SERVIDOR valida saldo y que el monto recibido cuadre
    //    con la tasa real, y aplica los deltas (no acepta saldos absolutos del
    //    cliente). Evita que alguien se auto-acredite saldo. Si el endpoint
    //    aún no está desplegado (o hay red mala) se cae al camino legacy. ────
    if (isSupabaseConfigured && SURL) {
      try {
        const token = getStoredToken();
        const r = await fetch(`${SURL}/functions/v1/admin-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: token ? `Bearer ${token}` : `Bearer ${SKEY}` },
          body: JSON.stringify({ action: 'apply_conversion', userId: currentUser.id, src, tgt, amtS, amtT, fee, coupon }),
        }).then(x => x.json()).catch(() => null);
        if (r?.success) { creditFee(); return {}; }
        // Rechazo de negocio del servidor (tasa/saldo/parámetros) → revertir y avisar.
        const HARD = ['Saldo insuficiente', 'El monto de la conversión no coincide con la tasa vigente.', 'Parámetros de conversión inválidos'];
        if (r?.error && HARD.includes(String(r.error))) {
          setCurrentUser(prev => prev ? { ...prev, balances: prevBalances } : prev);
          setUsers(prev => prev.map(u => u.id === currentUser.id ? { ...u, balances: prevBalances } : u));
          return { error: String(r.error) };
        }
        // Cualquier otra cosa (endpoint viejo / null) → camino legacy abajo.
      } catch { /* red → legacy */ }
    }

    // ── LEGACY (respaldo si apply_conversion no está desplegado) ──
    saveUser({ ...currentUser, balances: newBal }).catch(() => {});
    saveTx({ userId: currentUser.id, userName: currentUser.name, type: 'convert', initials: 'CV', title: `${src} a ${tgt}`, date: new Date().toLocaleDateString(), createdAt: new Date().toISOString(), amount: amtS, currency: src, status: 'Completado', fee, couponCode: coupon, targetAmount: amtT, targetCurrency: tgt }).catch(() => {});
    creditFee();
    return {};
  };

  const approveDeposit = async (txId: number) => {
    // Vía preferida: RPC SECURITY DEFINER (2026_admin_treasury_rpcs.sql) —
    // los updates directos a filas de OTROS usuarios los bloquea RLS en
    // silencio. Si el RPC no está deployado, cae al camino directo viejo.
    if (isSupabaseConfigured) {
      try {
        const { data: rpc, error: rpcErr } = await supabase.rpc('admin_approve_deposit', { p_tx_id: txId });
        if (!rpcErr && (rpc as any)?.ok) { await fetchData(); return; }
        if (!rpcErr && (rpc as any)?.error) console.error('[approveDeposit] RPC error:', (rpc as any).error);
      } catch { /* fallback directo */ }
    }
    const tx = transactions.find(t => t.id === txId);
    if (!tx) return;
    const user = users.find(u => u.id === tx.userId);
    if (!user) return;
    const newBal = { ...user.balances, [tx.currency]: (user.balances[tx.currency] || 0) + tx.amount };
    if (isSupabaseConfigured) {
      // Route balance update to the correct DB column to avoid fiat/crypto conflict
      const isCrypto = CRYPTO_CURRENCIES.has(tx.currency);
      // user.balances is merged fiat+crypto in memory — split when writing back to DB
      const fiatEntries   = Object.entries(newBal).filter(([k]) => !CRYPTO_CURRENCIES.has(k));
      const cryptoEntries = Object.entries(newBal).filter(([k]) =>  CRYPTO_CURRENCIES.has(k));
      const colUpdate = isCrypto
        ? { crypto_balances: Object.fromEntries(cryptoEntries) }
        : { balances: Object.fromEntries(fiatEntries) };
      const { error } = await supabase.from('users').update(colUpdate).eq('id', user.id);
      if (error) {
        console.error('[approveDeposit] Balance update failed:', error.message, error.hint, error.code, { userId: user.id, newBal });
      } else {
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, balances: newBal } : u));
        if (currentUser?.id === user.id) setCurrentUser(prev => prev ? { ...prev, balances: newBal } : prev);
      }
    } else {
      lsUpsertUser({ ...user, balances: newBal });
    }
    await updateTxStatus(txId, { status: 'Completado' });
    // Auto-credit the matching treasury account so the balance stays in sync
    const currentTreasury: TreasuryAccount[] = config.treasuryAccounts || [];
    const matchingAcc = currentTreasury.find((a: any) => a.currency === tx.currency);
    if (matchingAcc) {
      const updatedTreasury = currentTreasury.map((a: any) =>
        a.id === matchingAcc.id ? { ...a, amount: (a.amount || 0) + tx.amount } : a
      );
      updateConfig({ treasuryAccounts: updatedTreasury });
    }
    fetchData();
  };

  const rejectDeposit = async (id: number) => {
    if (isSupabaseConfigured) {
      try {
        const { data: rpc, error: rpcErr } = await supabase.rpc('admin_reject_deposit', { p_tx_id: id });
        if (!rpcErr && (rpc as any)?.ok) { await fetchData(); return; }
      } catch { /* fallback directo */ }
    }
    await updateTxStatus(id, { status: 'Rechazado' });
  };

  const completeWithdrawal = async (id: number) => {
    const tx = transactions.find(t => t.id === id);
    if (isSupabaseConfigured) {
      try {
        const { data: rpc, error: rpcErr } = await supabase.rpc('admin_complete_withdrawal', { p_tx_id: id });
        if (!rpcErr && (rpc as any)?.ok) {
          await fetchData();
          // Sync de la cuenta de tesorería (igual que el camino directo)
          if (tx) {
            const t0: TreasuryAccount[] = config.treasuryAccounts || [];
            const acc = t0.find((a: any) => a.currency === tx.currency);
            if (acc) updateConfig({ treasuryAccounts: t0.map((a: any) => a.id === acc.id ? { ...a, amount: (a.amount || 0) - tx.amount } : a) });
          }
          return;
        }
      } catch { /* fallback directo */ }
    }
    await updateTxStatus(id, { status: 'Completado' });
    // Auto-debit the matching treasury account so the balance stays in sync
    if (tx) {
      const currentTreasury: TreasuryAccount[] = config.treasuryAccounts || [];
      const matchingAcc = currentTreasury.find((a: any) => a.currency === tx.currency);
      if (matchingAcc) {
        const updatedTreasury = currentTreasury.map((a: any) =>
          a.id === matchingAcc.id ? { ...a, amount: (a.amount || 0) - tx.amount } : a
        );
        updateConfig({ treasuryAccounts: updatedTreasury });
      }
    }
  };

  const rejectWithdrawal = async (id: number, reason: string) => {
    if (isSupabaseConfigured) {
      try {
        const { data: rpc, error: rpcErr } = await supabase.rpc('admin_reject_withdrawal', { p_tx_id: id, p_reason: reason || null });
        if (!rpcErr && (rpc as any)?.ok) { await fetchData(); return; }
      } catch { /* fallback directo */ }
    }
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;
    const user = users.find(u => u.id === tx.userId);
    if (user) {
      const newBal = { ...user.balances, [tx.currency]: (user.balances[tx.currency] || 0) + tx.amount };
      await saveUser({ ...user, balances: newBal });
      await updateTxStatus(id, { status: 'Rechazado', reason } as any);
    }
  };

  const verifyUser = async (id: string, s: string) => { await updateUserProfile(id, { kycStatus: s }); };
  const toggleUserBlock = async (id: string, b: boolean, r?: string) => { await updateUserProfile(id, { isBlocked: b, blockReason: r }); };

  // --- ADMIN ---
  const bankingOptions = config.bankingOptions || {};
  const treasuryAccounts = config.treasuryAccounts || [];
  const getAllUsers = () => users;
  const getAllTransactions = () => transactions;
  const getAllPendingDeposits = () => transactions.filter(t => t.type === 'load' && t.status === 'Pendiente');
  const getAllPendingWithdrawals = () => transactions.filter(t => t.type === 'send' && t.status === 'Pendiente');
  const getTransactionHistory = () => transactions.filter(t => t.status !== 'Pendiente');
  const getAdminTeam = () => config.adminTeam || [];
  const addAdminUser = (u: any) => updateConfig({ adminTeam: [...getAdminTeam(), { ...u, id: Date.now().toString() }] });
  const updateAdminUser = (id: string, d: any) => updateConfig({ adminTeam: getAdminTeam().map((x: any) => x.id === id ? { ...x, ...d } : x) });
  const deleteAdminUser = (id: string) => updateConfig({ adminTeam: getAdminTeam().filter((x: any) => x.id !== id) });

  const registerInternalMovement = async (amt: number, curr: string, type: 'credit' | 'debit', reason: string, accId: string) => {
    const newTreasury = treasuryAccounts.map((a: any) => {
      if (a.id === accId) return { ...a, amount: type === 'credit' ? a.amount + amt : a.amount - amt };
      return a;
    });
    updateConfig({ treasuryAccounts: newTreasury });
    await saveTx({ userId: 'admin', userName: 'Tesorería', type: 'internal', initials: 'TS', title: reason, date: new Date().toLocaleDateString(), amount: amt, currency: curr, status: 'Completado' });
  };

  const updateBankList = (country: string, banks: BankDetail[]) => {
    updateConfig({ bankingOptions: { ...bankingOptions, [country]: banks } });
  };

  const restoreDatabase = (json: any): boolean => {
    try {
      if (!json || typeof json !== 'object') return false;
      if (json.users) lsSaveUsers(json.users);
      if (json.transactions) lsSaveTransactions(json.transactions);
      if (json.config) updateConfig(json.config);
      fetchData();
      return true;
    } catch { return false; }
  };

  const sendCuypayPayment = async (recipientCode: string, amount: number, currency: string): Promise<{ error?: string }> => {
    if (!currentUser) return { error: 'No autenticado' };
    if (!amount || !isFinite(amount) || amount <= 0) return { error: 'Monto inválido' };
    if (!recipientCode || typeof recipientCode !== 'string') return { error: 'Código de destinatario inválido' };
    const VALID_CURRENCIES = ['USD', 'COP', 'CLP', 'MXN', 'PEN'];
    if (!VALID_CURRENCIES.includes(currency)) return { error: 'Moneda no soportada' };

    if (!isSupabaseConfigured) {
      const recipient = users.find(u => u.ownReferralCode?.toUpperCase() === recipientCode.toUpperCase() && u.id !== currentUser.id);
      if (!recipient) return { error: 'Usuario no encontrado' };
      const senderBal = currentUser.balances[currency] || 0;
      if (senderBal < amount) return { error: 'Saldo insuficiente' };
      const senderNewBal = { ...currentUser.balances, [currency]: senderBal - amount };
      const recipientNewBal = { ...recipient.balances, [currency]: (recipient.balances[currency] || 0) + amount };
      lsUpsertUser({ ...currentUser, balances: senderNewBal });
      lsUpsertUser({ ...recipient, balances: recipientNewBal });
      lsInsertTx({ userId: currentUser.id, userName: currentUser.name, type: 'pay_sent', initials: 'PA', title: `PAY a ${recipient.name}`, date: new Date().toLocaleDateString(), amount, currency, status: 'Completado', recipientName: recipient.name });
      lsInsertTx({ userId: recipient.id, userName: recipient.name, type: 'pay_received', initials: 'PR', title: `PAY de ${currentUser.name}`, date: new Date().toLocaleDateString(), amount, currency, status: 'Completado', senderName: currentUser.name });
      setCurrentUser(prev => prev ? { ...prev, balances: senderNewBal } : prev);
      fetchData();
      return {};
    }

    // Verify session — warn only; fallback-logged users (no Supabase session) still proceed via anon writes
    // getSession can hang indefinitely when Supabase Auth is misconfigured — hard timeout at 3s
    const { data: { session } } = await Promise.race([
      supabase.auth.getSession(),
      new Promise<any>((_, rej) => setTimeout(() => rej(new Error('getSession_timeout')), 3000)),
    ]).catch(() => ({ data: { session: null } }));
    if (!session) {
      console.warn('[sendCuypayPayment] No Supabase session — using anon writes (RPC will be skipped)');
    }

    // Look up recipient from local users state (populated by fetchData from Supabase)
    let recipient: any = users.find(u => u.ownReferralCode?.toUpperCase() === recipientCode.toUpperCase() && u.id !== currentUser.id);
    if (!recipient) {
      // Con RLS estricta el cliente ya no ve a otros usuarios: se resuelve el
      // destinatario en el servidor (solo id + nombre). El RPC cuypay_transfer
      // igual re-valida el destino por código, así que esto es solo para la UI.
      try {
        const SURL = SUPABASE_URL_FOR_FN; const SKEY = SUPABASE_ANON_FOR_FN; const token = getStoredToken();
        const r = await fetch(`${SURL}/functions/v1/admin-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: token ? `Bearer ${token}` : `Bearer ${SKEY}` },
          body: JSON.stringify({ action: 'lookup_recipient', code: recipientCode.toUpperCase() }),
        }).then(x => x.json()).catch(() => null);
        if (r?.found && r.id && r.id !== currentUser.id) recipient = { id: r.id, name: r.name, balances: {} };
      } catch { /* red → cae al 'no encontrado' */ }
    }
    if (!recipient) return { error: 'Usuario no encontrado' };
    if (!recipient.balances) recipient.balances = {};

    const senderBal = currentUser.balances[currency] || 0;
    if (senderBal < amount) return { error: 'Saldo insuficiente' };

    const senderNewBal = { ...currentUser.balances, [currency]: senderBal - amount };
    const recipientNewBal = { ...recipient.balances, [currency]: (recipient.balances[currency] || 0) + amount };

    // Capture IDs before any async work (closure safety)
    const snapSenderId = currentUser.id;
    const snapSenderName = currentUser.name || '';
    const snapRecipientId = recipient.id;
    const snapRecipientName = recipient.name || recipient.companyName || '';
    const now = new Date().toLocaleDateString();

    // Apply optimistic UI immediately
    const optimisticTxId = Date.now();
    setCurrentUser(prev => prev ? { ...prev, balances: senderNewBal } : prev);
    setUsers(prev => prev.map(u =>
      u.id === snapRecipientId ? { ...u, balances: recipientNewBal } : u
    ));
    setTransactions(prev => [{
      id: optimisticTxId, userId: snapSenderId, userName: snapSenderName,
      type: 'pay_sent', initials: 'PA', title: `PAY a ${snapRecipientName}`,
      date: now, amount, currency, status: 'Completado', recipientName: snapRecipientName,
    } as any, ...prev]);

    // Re-fetch real balances and transactions from Supabase after writes
    const refreshAll = async () => {
      try {
        const [{ data: uData }, { data: tData }] = await Promise.all([
          supabase.from('users').select('*'),
          supabase.from('transactions').select('*'),
        ]);
        if (uData) {
          const mapped = (uData as any[]).map(mapSupabaseUser);
          setUsers(mapped);
          const freshSender = mapped.find((u: User) => u.id === snapSenderId);
          if (freshSender) setCurrentUser(prev => prev ? { ...prev, balances: freshSender.balances } : prev);
        }
        if (tData?.length) {
          const mapped = tData.map((t: any) => ({
            id: t.id, userId: t.user_id, type: t.type,
            amount: Number(t.amount), currency: t.currency, status: t.status,
            ...t.raw_data,
          }));
          setTransactions(mapped.sort(((a:any,b:any)=> (new Date(b.createdAt??b.created_at??b.date??0).getTime()||0) - (new Date(a.createdAt??a.created_at??a.date??0).getTime()||0))));
        }
      } catch { /* ignore */ }
    };

    // cuypay_transfer (SECURITY DEFINER) does everything atomically server-side:
    // debits sender, credits recipient, inserts pay_sent + pay_received tx records.
    try {
      const rpcResult = await Promise.race([
        supabase.rpc('cuypay_transfer', {
          p_sender_id: snapSenderId,
          p_recipient_code: recipientCode.toUpperCase(),
          p_amount: amount,
          p_currency: currency,
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('rpc_timeout')), 10000)),
      ]);
      const { data: rpcData, error: rpcError } = rpcResult as any;
      if (rpcError) {
        // Any infrastructure error (function not found 42883, permission 42501, network, etc.)
        // → fall through to direct writes. Only business-logic errors inside rpcData block us.
        console.warn('[pay] RPC infrastructure error, falling back to direct writes:', rpcError.code, rpcError.message);
      } else if (rpcData?.error) {
        const MSG: Record<string, string> = {
          no_recipient: 'Destinatario no encontrado',
          no_funds: 'Saldo insuficiente',
        };
        // Revert optimistic update on business error
        setCurrentUser(prev => prev ? { ...prev, balances: currentUser.balances } : prev);
        setUsers(prev => prev.map(u => u.id === snapRecipientId ? { ...u, balances: recipient.balances } : u));
        setTransactions(prev => prev.filter((t: any) => t.id !== optimisticTxId));
        return { error: MSG[rpcData.error] || rpcData.error };
      } else if (rpcData?.success) {
        await refreshAll();
        return {};
      }
    } catch (e: any) {
      const msg = (e?.message || '') as string;
      if (msg !== 'rpc_timeout') {
        console.warn('[pay] RPC exception, falling back to direct writes:', msg);
        // Don't return error — fall through to direct writes
      }
    }

    // RPC timed out or not deployed — fallback: direct writes for sender only.
    // Recipient cannot receive without the SECURITY DEFINER function.
    const withWriteTimeout = (p: Promise<any>) =>
      Promise.race([p, new Promise<{ data: null; error: Error }>((_, rej) => setTimeout(() => rej(new Error('write_timeout')), 8000))]);
    const [balRes, txRes] = await Promise.allSettled([
      withWriteTimeout(supabase.from('users').update({ balances: senderNewBal }).eq('id', snapSenderId)),
      withWriteTimeout(supabase.from('transactions').insert({
        user_id: snapSenderId,
        type: 'pay_sent', amount, currency, status: 'Completado',
        raw_data: { initials: 'PA', title: `PAY a ${snapRecipientName}`, recipientName: snapRecipientName, date: now, createdAt: new Date().toISOString(), userName: snapSenderName },
      })),
    ]);
    const balErr = balRes.status === 'fulfilled' ? (balRes.value as any)?.error : balRes.reason;
    const txErr = txRes.status === 'fulfilled' ? (txRes.value as any)?.error : txRes.reason;
    if (balErr) console.error('[pay] balance update failed:', balErr?.message || balErr);
    if (txErr) console.error('[pay] tx insert failed:', txErr?.message || txErr);
    try { await Promise.race([refreshAll(), new Promise<void>((_, rej) => setTimeout(() => rej(), 5000))]); } catch { /* ignore refresh timeout */ }
    return {};
  };

  const deleteUser = async (id: string): Promise<{ error?: string }> => {
    if (!id) return { error: 'ID requerido' };
    setUsers(prev => prev.filter(u => u.id !== id));
    setTransactions(prev => prev.filter(t => t.userId !== id));
    if (!isSupabaseConfigured) {
      const ls = lsGetUsers().filter(u => u.id !== id);
      lsSaveUsers(ls);
      return {};
    }
    // Helper: run promise with a hard timeout; never throws.
    const safe = (p: Promise<any>, ms = 4000) =>
      Promise.race([p, new Promise(r => setTimeout(r, ms))]).catch(() => {});

    const isSelf = currentUserRef.current?.id === id;
    const action = isSelf ? 'delete_self' : 'delete_user';
    const body = isSelf ? { action } : { action, userId: id };

    // Fetch directo para poder mandar el JWT del admin en el header.
    let edgeFnOk = false;
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      const authHeader2 = `Bearer ${getStoredToken() ?? SKEY}`;
      const result = await safe(
        fetch(`${SURL}/functions/v1/admin-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': authHeader2 },
          body: JSON.stringify(body),
        }).then(async r => {
          const d = await r.json().catch(() => ({}));
          return r.ok ? { data: d, error: null } : { data: null, error: d };
        }), 6000,
      ) as { data: unknown; error: unknown } | undefined;
      edgeFnOk = !!result && !result.error;
    } catch { /* never */ }

    if (!edgeFnOk) {
      // Edge function unavailable — delete directly from public tables.
      // Clearing user_metadata.role ensures next Google OAuth uses the role
      // chosen on the Register page, not the old stale value.
      await safe(supabase.from('transactions').delete().eq('user_id', id));
      await safe(supabase.from('users').delete().eq('id', id));
      if (isSelf) await safe(supabase.auth.updateUser({ data: { role: null, full_name: null } }));
    }
    return {};
  };

  const sendPasswordReset = async (email: string, captchaToken?: string) => {
    if (!isSupabaseConfigured) return;
    // redirectTo: el enlace del correo debe regresar a ESTA app para que el
    // usuario fije su nueva contraseña (si no, cae en el sitio por defecto).
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin, ...(captchaToken ? { captchaToken } : {}) });
  };

  // Fijar la nueva contraseña tras abrir el enlace de recuperación.
  const setNewPassword = async (newPassword: string): Promise<string | null> => {
    if (!isSupabaseConfigured) return 'Sin conexión';
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return error.message;
    setIsPasswordRecovery(false);
    recoveryRef.current = false;
    // Se CIERRA la sesión de recuperación: obliga a iniciar sesión de verdad,
    // con contraseña + 2FA + código de correo. Si se dejara abierta, el enlace
    // del correo seguiría siendo una entrada al panel sin segundo factor.
    try { await supabase.auth.signOut(); } catch { /* */ }
    setCurrentUser(null);
    return null;
  };

  const markNotificationsRead = () => {
    if (!currentUser) return;
    const updated = (currentUser.notifications || []).map((n: any) => ({ ...n, read: true }));
    // Las notificaciones viven en raw_data. Persistir con updateUserRawData
    // (escribe SOLO raw_data, confirma la fila y cae al edge si la RLS/candado
    // de columnas sensibles bloquea) — con updateUserProfile/saveUser el
    // candado rechazaba TODO el update si el saldo en memoria estaba viejo, y
    // el "leído" no se guardaba: al recargar volvían a salir sin leer.
    updateUserRawData(currentUser.id, { notifications: updated }).catch(() => {});
  };

  // Agrega varias notificaciones de una (dedup por id estable). Devuelve
  // cuántas NUEVAS se agregaron — la UI lo usa para sonar/animar solo cuando
  // realmente llega algo nuevo. Ids estables (ej. 'txdone-123') evitan que
  // el poll cada 10s vuelva a crear la misma notificación.
  const mergeNotifications = (news: Array<{ id: string; type?: string; title: string; message: string }>): number => {
    if (!currentUser || !news?.length) return 0;
    const existing = (currentUser.notifications || []) as any[];
    const existingIds = new Set(existing.map(x => String(x.id)));
    const toAdd = news.filter(n => !existingIds.has(String(n.id)));
    if (!toAdd.length) return 0;
    const stamped = toAdd.map(n => ({
      type: 'success', read: false,
      date: new Date().toLocaleDateString('es-CO'),
      ...n,
    }));
    const updated = [...stamped, ...existing].slice(0, 50);
    updateUserRawData(currentUser.id, { notifications: updated }).catch(() => {});
    return toAdd.length;
  };

  const deleteNotification = (id: string | number) => {
    if (!currentUser) return;
    const updated = (currentUser.notifications || []).filter((n: any) => String(n.id) !== String(id));
    updateUserRawData(currentUser.id, { notifications: updated }).catch(() => {});
  };

  const clearNotifications = () => {
    if (!currentUser) return;
    updateUserRawData(currentUser.id, { notifications: [] }).catch(() => {});
  };

  return (
    <DatabaseContext.Provider value={{
      currentUser, isAuthLoading, users, transactions, registerUser, updateUserProfile, updateUserRawData, loginUser, loginWithGoogle, logoutUser,
      getBalance, bumpLocalBalance, addLocalTx, getPersonalMovements, getUserNotifications, markNotificationsRead,
      mergeNotifications, deleteNotification, clearNotifications,
      requestDeposit, requestWithdrawal, performConversion, approveDeposit, rejectDeposit,
      completeWithdrawal, rejectWithdrawal, verifyUser, toggleUserBlock, isOnline, dataReady, refreshData: fetchData,
      bankingOptions, treasuryAccounts, getAllUsers, getAllTransactions, updateTxStatus, getAllPendingDeposits, getAllPendingWithdrawals,
      getTransactionHistory, getAdminTeam, addAdminUser, updateAdminUser, deleteAdminUser, deleteUser, registerInternalMovement,
      updateBankList, restoreDatabase, sendPasswordReset, isPasswordRecovery, setNewPassword, sendCuypayPayment,
      mfaPending, mfaErrorDetail, loginErrorDetail, completeMFALogin, cancelMFALogin,
      getLoginError: () => loginErrorRef.current, getMfaError: () => mfaErrorRef.current,
      emailStepPending, completeEmailLogin, resendEmailCode, startEmailStep,
      enrollMFA, verifyMFAEnrollment, unenrollMFA, getMFAStatus, verifyMfaCode,
    }}>
      {children}
    </DatabaseContext.Provider>
  );
};

export const useDatabase = () => {
  const context = useContext(DatabaseContext);
  if (!context) throw new Error('useDatabase must be used within DatabaseProvider');
  return context;
};
