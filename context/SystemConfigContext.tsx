import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { BankDetail, TreasuryAccount, AdminUser } from './DatabaseContext';

export interface Coupon {
    code: string;
    discount: number;
    active: boolean;
}

export interface MarketingModalConfig {
    isActive: boolean;
    imageUrl: string;
    linkUrl: string;
}

// Bump this string whenever the palette changes — forces all clients to reset colors
const PALETTE_VERSION = 'v8-green-2026-04';

const PALETTE_DEFAULTS = {
  themeColor: '#0F172A',
  accentColor: '#4ADE80',
  heroGradientMid: '#0F172A',
  heroGradientEnd: '#0F172A',
  paletteVersion: PALETTE_VERSION,
};

const DEFAULT_CONFIG = {
  maintenanceMode: false,
  allowNewRegistrations: true,
  globalFee: 4.0,
  minWithdrawal: 10,
  volumeLimit: 10000,
  kycProvider: 'Jumio',
  referralCommission: 0.4,
  coupons: [
      { code: 'WELCOME20', discount: 20, active: true },
      { code: 'LINCOIN50', discount: 50, active: true }
  ],
  ...PALETTE_DEFAULTS,
  marketingModal: {
      isActive: false,
      imageUrl: 'https://images.unsplash.com/photo-1607083206869-4c7672e72a8a?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80',
      linkUrl: '#'
  },
  seasonEmojis: [],
  treasuryAccounts: [],
  bankingOptions: {
    'Colombia': [
      { id: 'col_1', name: 'Bancolombia', type: 'bank', accountNumber: '69812345678', accountType: 'Ahorros', beneficiary: 'LINCOIN SAS', taxId: '900123456-1', taxIdType: 'NIT', logoColor: 'bg-yellow-400 text-yellow-900', logoText: 'BC' },
      { id: 'col_2', name: 'Nequi', type: 'bank', accountNumber: '3001234567', accountType: 'Nequi', beneficiary: 'LINCOIN SAS', taxId: '900123456-1', taxIdType: 'NIT', logoColor: 'bg-purple-600 text-white', logoText: 'NQ' },
    ],
    'Perú': [
      { id: 'per_1', name: 'BCP', type: 'bank', accountNumber: '19412345678901', accountType: 'Ahorros', beneficiary: 'LINCOIN SAC', taxId: '20123456789', taxIdType: 'RUC', logoColor: 'bg-blue-700 text-white', logoText: 'BCP' },
    ],
    'Chile': [
      { id: 'chl_1', name: 'Banco Estado', type: 'bank', accountNumber: '123456789', accountType: 'Vista', beneficiary: 'LINCOIN SpA', taxId: '76.123.456-7', taxIdType: 'RUT', logoColor: 'bg-red-600 text-white', logoText: 'BE' },
    ],
    'México': [
      { id: 'mex_1', name: 'BBVA México', type: 'bank', accountNumber: '012345678901234567', accountType: 'CLABE', beneficiary: 'LINCOIN SA de CV', taxId: 'CUY123456ABC', taxIdType: 'RFC', logoColor: 'bg-blue-500 text-white', logoText: 'BB' },
    ],
  },
  adminTeam: [],
  otcUsdtRate: 0.995,
  otcUsdcRate: 0.998,
  otcUsdtAddress: '',
  otcUsdcAddress: '',
  otcFiatPairs: [
    { pair: 'USDT_COP', label: 'USDT → COP', rate: 4150, enabled: true },
    { pair: 'USDT_PEN', label: 'USDT → PEN', rate: 3.82, enabled: true },
    { pair: 'USDT_VES', label: 'USDT → VES', rate: 36.50, enabled: true },
    { pair: 'USDT_CLP', label: 'USDT → CLP', rate: 930, enabled: true },
    { pair: 'USDT_MXN', label: 'USDT → MXN', rate: 17.20, enabled: true },
    { pair: 'USDC_COP', label: 'USDC → COP', rate: 4160, enabled: true },
    { pair: 'USDC_PEN', label: 'USDC → PEN', rate: 3.83, enabled: true },
  ],
  recaptchaSiteKey: '6Lf5AMIsAAAAAHTdgN4bySEWMGg5CF1JWmYJv4Dq',
  treasuryBalance: { USDT: 0, USDC: 0, ETH: 0, BNB: 0, TRX: 0 } as Record<string, number>,
  treasuryHistory: [] as Array<{ date: string; currency: string; amount: number; type: 'in' | 'out'; note: string }>,
};

interface SystemConfigContextType {
  config: any;
  updateConfig: (newConfig: any) => void;
  setThemePreset: (preset: string) => void;
  addCoupon: (coupon: Coupon) => void;
  removeCoupon: (code: string) => void;
  toggleCoupon: (code: string) => void;
}

const LS_CONFIG = 'cuypay_config';

const SystemConfigContext = createContext<SystemConfigContextType | undefined>(undefined);

export const SystemConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<any>(() => {
    try {
      const saved = localStorage.getItem(LS_CONFIG);
      if (!saved) return DEFAULT_CONFIG;
      const parsed = JSON.parse(saved);
      const merged = { ...DEFAULT_CONFIG, ...parsed };
      // Don't let a previously empty saved value override a new non-empty default
      for (const key of Object.keys(DEFAULT_CONFIG) as string[]) {
        if ((parsed[key] === '' || parsed[key] === null || parsed[key] === undefined) && (DEFAULT_CONFIG as any)[key]) {
          merged[key] = (DEFAULT_CONFIG as any)[key];
        }
      }
      // Replace known bad/outdated reCAPTCHA v3 key with current v2 key
      const INVALID_RECAPTCHA_KEYS = ['6LdDS8EsAAAAAHUiP1jkhwzBWvD8baT5DwqiavZu', '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI'];
      if (INVALID_RECAPTCHA_KEYS.includes(merged.recaptchaSiteKey)) {
        merged.recaptchaSiteKey = DEFAULT_CONFIG.recaptchaSiteKey;
      }
      // ALWAYS apply palette defaults on startup — never use cached palette colors.
      // This prevents flash of old/wrong colors before Supabase config loads.
      // Custom palette (set by admin) will be applied moments later via fetchRemoteConfig.
      Object.assign(merged, PALETTE_DEFAULTS);
      return merged;
    } catch {
      return DEFAULT_CONFIG;
    }
  });

  const SURL = (import.meta as any).env?.VITE_SUPABASE_URL as string || '';
  const SKEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string || '';
  const TATUM_WALLET_URL  = SURL ? `${SURL}/functions/v1/tatum-wallet` : '';
  const GET_CONFIG_URL    = SURL ? `${SURL}/functions/v1/get-system-config` : '';
  const ADMIN_DATA_URL    = SURL ? `${SURL}/functions/v1/admin-data` : '';

  const applySettings = useCallback((settings: any) => {
    if (!settings) return;
    setConfig((prev: any) => {
      const merged = { ...DEFAULT_CONFIG, ...settings };
      for (const key of Object.keys(DEFAULT_CONFIG) as string[]) {
        if (merged[key] === null || merged[key] === undefined) {
          merged[key] = (DEFAULT_CONFIG as any)[key];
        }
      }
      const INVALID_RECAPTCHA_KEYS = ['6LdDS8EsAAAAAHUiP1jkhwzBWvD8baT5DwqiavZu', '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI'];
      if (!merged.recaptchaSiteKey || INVALID_RECAPTCHA_KEYS.includes(merged.recaptchaSiteKey)) {
        merged.recaptchaSiteKey = DEFAULT_CONFIG.recaptchaSiteKey;
      }
      // AGGRESSIVE: Block legacy blue values from Supabase — replace with teal ALWAYS
      const LEGACY_BLUES = ['#2563eb', '#1d4ed8', '#3b82f6', '#60a5fa', '#0ea5e9', '#06b6d4', '#7dd3fc'];
      const accentLower = (merged.accentColor || '').toLowerCase();
      const themeLower = (merged.themeColor || '').toLowerCase();

      if (LEGACY_BLUES.includes(accentLower)) {
        console.warn('[SystemConfig] Blocking legacy blue accentColor:', merged.accentColor, '→ #4ADE80');
        merged.accentColor = '#4ADE80';
      }
      if (LEGACY_BLUES.includes(themeLower)) {
        console.warn('[SystemConfig] Blocking legacy blue themeColor:', merged.themeColor, '→ #0F172A');
        merged.themeColor = '#0F172A';
      }
      // Force palette reset when Supabase has an outdated version
      if (merged.paletteVersion !== PALETTE_VERSION) {
        Object.assign(merged, PALETTE_DEFAULTS);
      }
      const newStr = JSON.stringify(merged);
      const prevStr = JSON.stringify(prev);
      return newStr !== prevStr ? merged : prev;
    });
  }, []);

  const fetchRemoteConfig = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    // Try get-system-config first (simple read-only function, no auth needed)
    if (GET_CONFIG_URL) {
      try {
        const res = await fetch(GET_CONFIG_URL, {
          headers: { 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
        });
        if (res.ok) {
          const { settings } = await res.json();
          if (settings) { applySettings(settings); return; }
        }
      } catch (e) {
        console.warn('[config] get-system-config failed', e);
      }
    }
    // Secondary: tatum-wallet get_config (once deployed)
    if (TATUM_WALLET_URL) {
      try {
        const res = await fetch(TATUM_WALLET_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` },
          body: JSON.stringify({ action: 'get_config' }),
        });
        if (res.ok) {
          const { settings } = await res.json();
          if (settings) { applySettings(settings); return; }
        }
      } catch (e) {
        console.warn('[config] tatum-wallet get_config failed', e);
      }
    }
    // Fallback: direct Supabase query (may be blocked by RLS for anon users)
    try {
      const { data } = await supabase.from('app_config').select('settings').eq('id', 1).single();
      applySettings(data?.settings);
    } catch (e) {
      console.error('Config Sync Error', e);
    }
  }, [GET_CONFIG_URL, TATUM_WALLET_URL, SKEY, applySettings]);

  // On first load, if palette version is outdated push correct colors to Supabase
  useEffect(() => {
    if (config.paletteVersion !== PALETTE_VERSION) {
      updateConfig(PALETTE_DEFAULTS);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured) {
      fetchRemoteConfig();

      // Poll every 10 minutes — Realtime handles instant updates
      const interval = setInterval(fetchRemoteConfig, 600000);

      // Realtime subscription handles config changes instantly without polling
      const channel = supabase.channel('system_config_all')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_config' }, () => {
          fetchRemoteConfig();
        })
        .subscribe();

      return () => {
        clearInterval(interval);
        supabase.removeChannel(channel);
      };
    }
  }, [fetchRemoteConfig]);

  const updateConfig = async (newPart: any) => {
    const newFull = { ...config, ...newPart, paletteVersion: PALETTE_VERSION };
    setConfig(newFull);
    // Strip palette keys from localStorage — they cause flash of wrong colors on next load.
    // Palette is always sourced from code defaults + Supabase, never from localStorage.
    const { themeColor: _t, accentColor: _a, heroGradientMid: _m, heroGradientEnd: _e, paletteVersion: _v, ...nonPalette } = newFull;
    localStorage.setItem(LS_CONFIG, JSON.stringify(nonPalette));
    if (!isSupabaseConfigured) return;

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token
      || localStorage.getItem('cuypay_admin_token')
      || SKEY;

    // Try tatum-wallet/save_config (service key, no auth required)
    if (TATUM_WALLET_URL) {
      try {
        const res = await fetch(TATUM_WALLET_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ action: 'save_config', settings: newFull }),
        });
        if (res.ok) return;
      } catch (e) {
        console.warn('[config] tatum-wallet save_config error', e);
      }
    }
    // Try admin-data/save_config (service key, requires admin token)
    if (ADMIN_DATA_URL) {
      try {
        const res = await fetch(ADMIN_DATA_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SKEY, 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ action: 'save_config', settings: newFull }),
        });
        if (res.ok) return;
      } catch (e) {
        console.warn('[config] admin-data save_config error', e);
      }
    }
    // Last resort: direct upsert (may be blocked by RLS)
    await supabase.from('app_config').upsert({ id: 1, settings: newFull });
  };

  const setThemePreset = (preset: string) => {
    let updates: any = {};
    switch (preset) {
      case 'christmas': updates = { themeColor: '#165B33', accentColor: '#BB2528', seasonEmojis: ['🎄', '🎅'] }; break;
      case 'halloween': updates = { themeColor: '#252525', accentColor: '#FF6B00', seasonEmojis: ['🎃', '👻'] }; break;
      default: updates = { themeColor: '#0F172A', accentColor: '#4ADE80', heroGradientMid: '#0F172A', heroGradientEnd: '#0F172A', seasonEmojis: [] }; break;
    }
    updateConfig(updates);
  };

  const addCoupon = (c: Coupon) => updateConfig({ coupons: [...config.coupons, c] });
  const removeCoupon = (code: string) => updateConfig({ coupons: config.coupons.filter((x: any) => x.code !== code) });
  const toggleCoupon = (code: string) => updateConfig({ coupons: config.coupons.map((x: any) => x.code === code ? {...x, active: !x.active} : x) });

  return (
    <SystemConfigContext.Provider value={{ config, updateConfig, setThemePreset, addCoupon, removeCoupon, toggleCoupon }}>
      {children}
    </SystemConfigContext.Provider>
  );
};

export const useSystemConfig = () => {
  const context = useContext(SystemConfigContext);
  if (!context) throw new Error('useSystemConfig must be used within SystemConfigProvider');
  return context;
};
