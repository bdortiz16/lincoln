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
  loginUser: (email: string, pass?: string) => Promise<User | null>;
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
  sendPasswordReset: (email: string) => Promise<void>;
  sendCuypayPayment: (recipientCode: string, amount: number, currency: string) => Promise<{ error?: string }>;
  mfaPending: boolean;
  completeMFALogin: (code: string) => Promise<User | null>;
  cancelMFALogin: () => void;
  enrollMFA: () => Promise<{ qrCode: string; secret: string; factorId: string } | null>;
  verifyMFAEnrollment: (factorId: string, code: string, secret?: string) => Promise<{ ok: boolean; error?: string }>;
  unenrollMFA: (factorId: string) => Promise<boolean>;
  getMFAStatus: () => Promise<{ enrolled: boolean; factorId?: string; totpSecret?: string }>;
}

// --- LOCALSTORAGE HELPERS (fallback sin Supabase) ---

const LS_USERS = 'cuypay_users';
const LS_TRANSACTIONS = 'cuypay_transactions';
const LS_TX_SEQ = 'cuypay_tx_seq';

const SEED_ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL as string) || 'admin@cuypay.com';
// No hardcoded fallback — admin bypass requires VITE_ADMIN_PASSWORD to be explicitly set in .env
const SEED_ADMIN_PASSWORD = (import.meta.env.VITE_ADMIN_PASSWORD as string) || '';
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
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    // Restaurar la sesión de admin (bypass) de forma SÍNCRONA: así el panel
    // de Empresas NO parpadea "Verificando sesión…" en cada recarga (antes
    // se restauraba dentro de un useEffect, después del primer render, y se
    // veía un frame del loader aunque ya había sesión).
    try {
      const saved = sessionStorage.getItem('cuypay_admin_session');
      if (saved) return JSON.parse(saved);
    } catch { /* sessionStorage no disponible */ }
    return null;
  });
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
  const [pendingMFAProfile, setPendingMFAProfile] = useState<User | null>(null);
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

    // Restore admin bypass session on page load (sessionStorage — expires when tab closes)
    const savedAdmin = sessionStorage.getItem('cuypay_admin_session');
    if (savedAdmin) {
      try { setCurrentUser(JSON.parse(savedAdmin)); } catch {}
      setIsAuthLoading(false);
      // Still set up listener so Supabase regular users work on same browser
    }

    // Safety net: never stay stuck on loading screen more than 5 seconds
    const timeout = setTimeout(() => setIsAuthLoading(false), 5000);

    // Debounce SIGNED_OUT to avoid false logouts during token refresh
    let signOutTimer: ReturnType<typeof setTimeout> | null = null;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
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
      setTransactions(localTxs.sort((a, b) => b.id - a.id));
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
          const isAdminBypass = cu.id === 'admin-bypass';
          const authHeader = isAdminBypass
            ? `AdminBypass ${SEED_ADMIN_PASSWORD}`
            : `Bearer ${getStoredToken() ?? SKEY}`;
          console.log('[LINCOIN ADMIN] bypass=', isAdminBypass, '| pass set=', !!SEED_ADMIN_PASSWORD, '| url=', SURL.slice(0, 40));
          const abortCtl = new AbortController();
          const abortTimer = setTimeout(() => abortCtl.abort(), 20000);
          const fnResult = await fetch(`${SURL}/functions/v1/admin-data`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': authHeader },
            signal: abortCtl.signal,
          }).then(async r => {
            const text = await r.text().catch(() => '');
            console.log('[LINCOIN ADMIN] edge fn status=', r.status, '| body=', text.slice(0, 300));
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
              const sortedTx = mappedTx.sort((a: any, b: any) => b.id - a.id);
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

      // Non-admin (or edge function unavailable): use SECURITY DEFINER RPC functions,
      // falling back to direct SELECT if the functions don't exist yet.
      const [usersRpc, txRpc] = await Promise.all([
        supabase.rpc('cuypay_get_all_users'),
        supabase.rpc('cuypay_get_all_transactions'),
      ]);
      if (usersRpc.error) console.warn('[fetchData] cuypay_get_all_users RPC error:', usersRpc.error.code, usersRpc.error.message);
      if (txRpc.error) console.warn('[fetchData] cuypay_get_all_transactions RPC error:', txRpc.error.code, txRpc.error.message);
      const directUsers = await supabase.from('users').select('*');
      const directTx = await supabase.from('transactions').select('*');
      if (directUsers.error) console.warn('[fetchData] direct users SELECT error:', directUsers.error.code, directUsers.error.message);
      if (directTx.error) console.warn('[fetchData] direct tx SELECT error:', directTx.error.code, directTx.error.message);
      const usersData = (usersRpc.data?.length ? usersRpc.data : null) ?? directUsers.data;
      const txData = (txRpc.data?.length ? txRpc.data : null) ?? directTx.data;

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
      const mapTx = (arr: any[]) => (arr as any[]).map(t => ({
        id: t.id, userId: t.user_id, type: t.type,
        amount: Number(t.amount), currency: t.currency, status: t.status,
        createdAt: t.created_at ?? t.raw_data?.createdAt,
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
      const finalTxs = edgeTxs.length ? edgeTxs : rpcTxs;
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
            rpcErr: txRpc.error?.message ?? null, rpcCount: Array.isArray(txRpc.data) ? txRpc.data.length : null,
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
      try {
        // Con timeout: si esta consulta se cuelga (red móvil), el guardado
        // sigue igual — es solo un merge preventivo, no puede bloquear.
        const dbRes = await Promise.race([
          supabase.from('users').select('raw_data').eq('id', id).single(),
          new Promise<{ data: null }>(resolve => setTimeout(() => resolve({ data: null }), 4000)),
        ]) as any;
        if (dbRes?.data?.raw_data) {
          safeRest = { ...dbRes.data.raw_data, ...safeRest };
        }
      } catch { /* non-blocking */ }
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
          raw_data: safeRest,
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
          const isBypass = currentUserRef.current?.id === 'admin-bypass';
          const authHeader = isBypass ? `AdminBypass ${SEED_ADMIN_PASSWORD}` : `Bearer ${token ?? SKEY2}`;
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
                documents, raw_data: safeRest,
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
      // Merge contra la fila REAL para no pisar campos de otros flujos
      // (gasfreeAddresses, notificaciones...).
      const { data: cur } = await Promise.race([
        supabase.from('users').select('raw_data').eq('id', id).single(),
        new Promise<{ data: null }>(resolve => setTimeout(() => resolve({ data: null }), 5000)),
      ]) as any;
      const merged = { ...((cur?.raw_data && typeof cur.raw_data === 'object') ? cur.raw_data : {}), ...patch };
      // RLS bloquea updates EN SILENCIO (0 filas afectadas, sin error) — el
      // .select('id') obliga a devolver la fila tocada: sin fila = no escribió.
      let ok = false;
      const { data: updRows, error } = await supabase.from('users').update({ raw_data: merged }).eq('id', id).select('id');
      if (!error && Array.isArray(updRows) && updRows.length > 0) ok = true;
      if (!ok) {
        // Fallback: save_user del edge (service-role; upsert solo con las
        // columnas enviadas — id + raw_data — no toca nada más).
        const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
        const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
        const token = getStoredToken();
        const r = await fetch(`${SURL}/functions/v1/admin-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: token ? `Bearer ${token}` : `Bearer ${SKEY}` },
          body: JSON.stringify({ action: 'save_user', user: { id, raw_data: merged } }),
        }).then(x => x.json()).catch(() => null);
        ok = !!r?.success;
      }
      if (ok) {
        pendingWriteUntilRef.current = Date.now() + 10000;
        setUsers(prev => prev.map(x => x.id === id ? { ...x, ...patch, raw_data: merged } as any : x));
        if (currentUser?.id === id) setCurrentUser(prev => prev ? { ...prev, ...patch, raw_data: merged } as any : prev);
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

  const loginUser = async (email: string, pass?: string): Promise<User | null> => {
    // Admin bypass: authenticate via env vars, skip Supabase Auth entirely
    // Requires VITE_ADMIN_PASSWORD to be explicitly set — empty string disables the bypass
    if (SEED_ADMIN_PASSWORD && email === SEED_ADMIN_EMAIL && pass === SEED_ADMIN_PASSWORD) {
      const adminUser: User = {
        id: 'admin-bypass',
        email: SEED_ADMIN_EMAIL,
        role: 'admin',
        name: 'Administrador',
        balances: {},
        kycStatus: 'approved',
        notifications: [],
      };
      // sessionStorage expires when the tab is closed, reducing XSS session-theft window
      sessionStorage.setItem('cuypay_admin_session', JSON.stringify(adminUser));
      setCurrentUser(adminUser);
      return adminUser;
    }

    if (!isSupabaseConfigured) {
      const user = users.find(u => u.email === email && u.password === pass);
      if (user) { setCurrentUser(user); return user; }
      return null;
    }
    const authTimeout = new Promise<{ data: { user: null; session: null }; error: { message: string; status: number } }>(
      resolve => setTimeout(() => resolve({ data: { user: null, session: null }, error: { message: 'auth_timeout', status: 408 } }), 6000)
    );
    const { data, error } = await Promise.race([
      supabase.auth.signInWithPassword({ email, password: pass! }),
      authTimeout,
    ]);
    if (error) {
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
            if (!inputHash || inputHash !== storedHash) return null;
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
      return null;
    }
    if (!data.user) return null;

    const profileTimeout = new Promise<{ data: null }>(resolve => setTimeout(() => resolve({ data: null }), 6000));
    let { data: profile } = await Promise.race([
      supabase.from('users').select('*').eq('id', data.user.id).single(),
      profileTimeout,
    ]) as any;

    const isAdminEmail = data.user.email === SEED_ADMIN_EMAIL;

    if (!profile) {
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

    try {
      const mfaTimeout = new Promise<{ data: null }>(resolve => setTimeout(() => resolve({ data: null }), 3000));
      const { data: aalData } = await Promise.race([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        mfaTimeout,
      ]) as any;
      if (aalData?.nextLevel === 'aal2' && aalData?.currentLevel !== 'aal2') {
        setPendingMFAProfile(user);
        setMfaPending(true);
        return null;
      }
    } catch { /* MFA not available, continue normally */ }

    setCurrentUser(user);
    return user;
  };

  const completeMFALogin = async (code: string): Promise<User | null> => {
    if (!isSupabaseConfigured || !pendingMFAProfile) return null;
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
    setMfaPending(false);
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

  const verifyMFAEnrollment = async (factorId: string, code: string, secret?: string): Promise<{ ok: boolean; error?: string }> => {
    // If secret is provided, verify locally (no Supabase Auth required)
    if (secret) {
      const ok = verifyTOTP(secret, code);
      if (!ok) return { ok: false, error: 'Código incorrecto. Intenta nuevamente.' };
      // Persist via updateUserProfile (handles JWT auth, keepalive, pendingWriteBlock)
      if (currentUser) {
        const raw = (currentUser as any).raw_data ?? {};
        const newRaw = { ...raw, mfaEnabled: true, mfaFactorId: factorId, totpSecret: secret };
        // Update in-memory immediately
        setCurrentUser((prev: any) => prev ? { ...prev, raw_data: newRaw } : prev);
        // Persist to DB using the proper auth-aware path
        const updated = { ...currentUser, raw_data: newRaw } as any;
        saveUser(updated).catch?.(() => {});
      }
      return { ok: true };
    }
    // No secret: check raw_data first (for existing enrolled users)
    const storedSecret = (currentUser as any)?.raw_data?.totpSecret as string | undefined;
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

  const unenrollMFA = async (factorId: string): Promise<boolean> => {
    // Local TOTP factors don't exist in Supabase Auth — just succeed
    if (factorId === 'local' || (currentUser as any)?.raw_data?.totpSecret) return true;
    if (!isSupabaseConfigured) return true;
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      return !error;
    } catch { return true; }
  };

  const getMFAStatus = async (): Promise<{ enrolled: boolean; factorId?: string; totpSecret?: string }> => {
    // Always check raw_data first — most reliable without needing Supabase Auth session
    const raw = (currentUser as any)?.raw_data;
    if (raw?.mfaEnabled && raw?.mfaFactorId) {
      return { enrolled: true, factorId: raw.mfaFactorId, totpSecret: raw.totpSecret };
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
    const newBal = { ...currentUser.balances, [src]: getBalance(src) - amtS, [tgt]: (currentUser.balances[tgt] || 0) + amtT };
    pendingWriteUntilRef.current = Date.now() + 10000;
    // Update local state immediately so UI reflects change without waiting for DB
    setCurrentUser(prev => prev ? { ...prev, balances: newBal } : prev);
    setUsers(prev => prev.map(u => u.id === currentUser.id ? { ...u, balances: newBal } : u));
    // Fire DB writes in background — don't await (mobile networks can't be trusted)
    saveUser({ ...currentUser, balances: newBal }).catch(() => {});
    saveTx({ userId: currentUser.id, userName: currentUser.name, type: 'convert', initials: 'CV', title: `${src} a ${tgt}`, date: new Date().toLocaleDateString(), createdAt: new Date().toISOString(), amount: amtS, currency: src, status: 'Completado', fee, couponCode: coupon, targetAmount: amtT, targetCurrency: tgt }).catch(() => {});
    // Credit conversion fee to admin balance (fire-and-forget)
    if (fee > 0 && isSupabaseConfigured) {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      if (SURL) {
        fetch(`${SURL}/functions/v1/admin-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
          body: JSON.stringify({ action: 'credit_conversion_fee', currency: src, amount: fee, fromUserId: currentUser.id, note: `Comisión conversión ${src}→${tgt}` }),
        }).catch(() => {});
      }
    }
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
    const recipient = users.find(u => u.ownReferralCode?.toUpperCase() === recipientCode.toUpperCase() && u.id !== currentUser.id);
    if (!recipient) return { error: 'Usuario no encontrado' };

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
          setTransactions(mapped.sort((a: any, b: any) => b.id - a.id));
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

    // Use direct fetch so we can pass the bypass token for admin-bypass sessions.
    let edgeFnOk = false;
    try {
      const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
      const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
      const cu2 = currentUserRef.current;
      const authHeader2 = cu2?.id === 'admin-bypass'
        ? `AdminBypass ${SEED_ADMIN_PASSWORD}`
        : `Bearer ${getStoredToken() ?? SKEY}`;
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

  const sendPasswordReset = async (email: string) => {
    if (!isSupabaseConfigured) return;
    await supabase.auth.resetPasswordForEmail(email);
  };

  const markNotificationsRead = () => {
    if (!currentUser) return;
    const updated = (currentUser.notifications || []).map((n: any) => ({ ...n, read: true }));
    updateUserProfile(currentUser.id, { notifications: updated });
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
    updateUserProfile(currentUser.id, { notifications: updated });
    return toAdd.length;
  };

  const deleteNotification = (id: string | number) => {
    if (!currentUser) return;
    const updated = (currentUser.notifications || []).filter((n: any) => String(n.id) !== String(id));
    updateUserProfile(currentUser.id, { notifications: updated });
  };

  const clearNotifications = () => {
    if (!currentUser) return;
    updateUserProfile(currentUser.id, { notifications: [] });
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
      updateBankList, restoreDatabase, sendPasswordReset, sendCuypayPayment,
      mfaPending, completeMFALogin, cancelMFALogin,
      enrollMFA, verifyMFAEnrollment, unenrollMFA, getMFAStatus,
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
