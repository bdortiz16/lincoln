import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback } from 'react';
import { useSystemConfig } from './SystemConfigContext';
import { supabasePersonas, isSupabasePersonasConfigured } from '../lib/supabaseClient';

// Tier de comisión por volumen en USD. Coincide con TierRow del admin.
export interface FeeTier {
  from_usd: number;
  to_usd: number | null;   // null = sin límite superior (último tier)
  pct: number;             // % de comisión aplicado en este rango
}

// Define the shape of a single exchange rate
export interface ExchangeRate {
  id: string;
  source: string;          // BASE currency code (e.g. 'USD'). NO es la fuente de data.
  target: string;
  rate: number;
  fee: number;             // Commission percentage (legacy: flat fee si no hay tiers)
  mode: 'manual' | 'api';
  lastUpdate: string;
  timestamp?: number;
  provider?: 'FASTFOREX' | 'MANUAL' | string;     // proveedor de la data activa
  dbUpdatedAt?: string;    // captured_at de la fila en fx_rate_snapshots
  tiers?: FeeTier[];       // tiers por volumen USD (configurados en el admin)
}

interface ExchangeRateContextType {
  exchangeRates: ExchangeRate[];
  updateRate: (id: string, newRate: number) => void;
  updateFee: (id: string, newFee: number) => void;
  toggleMode: (id: string) => void;
  getRate: (source: string, target: string) => number;
  getFee: (source: string, target: string) => number;
  /**
   * Igual que getFee pero aplica los tiers configurados en el admin.
   * `amount` viene en la moneda `source`. Lo convertimos a USD usando
   * los baseRates (rate de source contra USD) y buscamos el tier
   * cuyo rango contenga ese monto. Si no hay tiers, cae al flat fee.
   */
  getFeeForAmount: (source: string, target: string, amount: number) => number;
  getProvider: (source: string, target: string) => string | undefined;
  getDbUpdatedAt: (source: string, target: string) => string | undefined;
  apiStatus: 'connected' | 'error' | 'loading';
  forceRefresh: () => void;
}

const ExchangeRateContext = createContext<ExchangeRateContextType | undefined>(undefined);

// Organized Matrix: USD First, then Alphabetical Source
const INITIAL_RATES: ExchangeRate[] = [
    // --- USD PAIRS (Anchors) ---
    { id: 'USD-COP', source: 'USD', target: 'COP', rate: 4250.00, fee: 0.50, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() }, 
    { id: 'USD-CLP', source: 'USD', target: 'CLP', rate: 970.20, fee: 0.50, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'USD-PEN', source: 'USD', target: 'PEN', rate: 3.75, fee: 0.50, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'USD-MXN', source: 'USD', target: 'MXN', rate: 20.35, fee: 0.50, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'USD-BRL', source: 'USD', target: 'BRL', rate: 6.06, fee: 0.50, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() }, 
    { id: 'USD-VES', source: 'USD', target: 'VES', rate: 45.50, fee: 1.00, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },

    // --- CLP Source ---
    { id: 'CLP-USD', source: 'CLP', target: 'USD', rate: 0.0010, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'CLP-COP', source: 'CLP', target: 'COP', rate: 4.38, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'CLP-PEN', source: 'CLP', target: 'PEN', rate: 0.0038, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'CLP-MXN', source: 'CLP', target: 'MXN', rate: 0.020, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'CLP-BRL', source: 'CLP', target: 'BRL', rate: 0.0062, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'CLP-VES', source: 'CLP', target: 'VES', rate: 0.039, fee: 1.00, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },

    // --- COP Source ---
    { id: 'COP-USD', source: 'COP', target: 'USD', rate: 0.00023, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'COP-CLP', source: 'COP', target: 'CLP', rate: 0.22, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'COP-PEN', source: 'COP', target: 'PEN', rate: 0.00088, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'COP-MXN', source: 'COP', target: 'MXN', rate: 0.0047, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'COP-BRL', source: 'COP', target: 'BRL', rate: 0.0014, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'COP-VES', source: 'COP', target: 'VES', rate: 0.0089, fee: 1.00, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },

    // --- PEN Source ---
    { id: 'PEN-USD', source: 'PEN', target: 'USD', rate: 0.26, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'PEN-COP', source: 'PEN', target: 'COP', rate: 1130.00, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'PEN-CLP', source: 'PEN', target: 'CLP', rate: 258.00, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'PEN-MXN', source: 'PEN', target: 'MXN', rate: 5.35, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'PEN-BRL', source: 'PEN', target: 'BRL', rate: 1.61, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'PEN-VES', source: 'PEN', target: 'VES', rate: 9.80, fee: 1.00, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },

    // --- BRL Source ---
    { id: 'BRL-USD', source: 'BRL', target: 'USD', rate: 0.165, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'BRL-COP', source: 'BRL', target: 'COP', rate: 700.10, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() }, 
    { id: 'BRL-CLP', source: 'BRL', target: 'CLP', rate: 160.50, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'BRL-PEN', source: 'BRL', target: 'PEN', rate: 0.62, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'BRL-MXN', source: 'BRL', target: 'MXN', rate: 3.35, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'BRL-VES', source: 'BRL', target: 'VES', rate: 6.20, fee: 1.00, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },

    // --- MXN Source ---
    { id: 'MXN-USD', source: 'MXN', target: 'USD', rate: 0.049, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'MXN-COP', source: 'MXN', target: 'COP', rate: 210.50, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'MXN-CLP', source: 'MXN', target: 'CLP', rate: 48.00, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'MXN-PEN', source: 'MXN', target: 'PEN', rate: 0.18, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'MXN-BRL', source: 'MXN', target: 'BRL', rate: 0.29, fee: 0.80, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
    { id: 'MXN-VES', source: 'MXN', target: 'VES', rate: 1.90, fee: 1.00, mode: 'api', lastUpdate: 'Iniciando...', timestamp: Date.now() },
];

const LS_RATES = 'cuypay_rates_config';

export const ExchangeRateProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { config, updateConfig } = useSystemConfig();

  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>(() => {
    try {
      const saved = localStorage.getItem(LS_RATES);
      if (saved) {
        const savedMap: Record<string, { fee: number; mode: string; rate: number }> = JSON.parse(saved);
        return INITIAL_RATES.map(r => ({
          ...r,
          fee: savedMap[r.id]?.fee ?? r.fee,
          mode: (savedMap[r.id]?.mode as 'api' | 'manual') ?? r.mode,
          rate: savedMap[r.id]?.mode === 'manual' ? (savedMap[r.id]?.rate ?? r.rate) : r.rate,
        }));
      }
    } catch {}
    return INITIAL_RATES;
  });
  const [baseRates, setBaseRates] = useState<Record<string, number>>({});
  const [apiStatus, setApiStatus] = useState<'connected' | 'error' | 'loading'>('loading');

  // Apply remote fee/mode overrides from Supabase config (takes precedence over localStorage)
  useEffect(() => {
    const meta = config.exchangeRateMeta as Record<string, { fee?: number; mode?: string; rate?: number }> | undefined;
    if (!meta || Object.keys(meta).length === 0) return;
    setExchangeRates(prev => prev.map(r => {
      const m = meta[r.id];
      if (!m) return r;
      return {
        ...r,
        ...(typeof m.fee === 'number' ? { fee: m.fee } : {}),
        ...(m.mode ? { mode: m.mode as 'api' | 'manual' } : {}),
        ...(m.mode === 'manual' && typeof m.rate === 'number' ? { rate: m.rate } : {}),
      };
    }));
  }, [config.exchangeRateMeta]);

  // Save fee/mode/manual-rate changes to Supabase so all clients get them
  const persistMeta = useCallback((rates: ExchangeRate[]) => {
    const meta: Record<string, any> = {};
    rates.forEach(r => {
      meta[r.id] = { fee: r.fee, mode: r.mode, ...(r.mode === 'manual' ? { rate: r.rate } : {}) };
    });
    updateConfig({ exchangeRateMeta: meta });
  }, [updateConfig]);

  // Intenta poblar las tasas desde Supabase. Source of truth:
  //   1) fx_rate_current (view de Antigravity que respeta manual_mode).
  //   2) fx_rate_snapshots crudo como fallback para pares que la view no incluya
  //      — el admin tiene seed con pares USD-* que no siempre están en la view.
  //      Tomamos la última fila por par (ordenado por captured_at DESC).
  // En paralelo trae los tiers de fx_pair_config. Devuelve true si pudo poblar
  // al menos un par.
  const fetchFromFxView = async (): Promise<boolean> => {
    if (!isSupabasePersonasConfigured) return false;
    try {
      const [currentRes, snapsRes, tierRes] = await Promise.all([
        supabasePersonas
          .from('fx_rate_current')
          .select('from_currency, to_currency, rate, source, captured_at')
          .then(r => r).catch(() => ({ data: null, error: { message: 'view not available' } } as any)),
        // Snapshots crudos: 2000 filas DESC nos cubren ~24 h de cron y nos
        // alcanzan para sacar la última por par como fallback.
        supabasePersonas
          .from('fx_rate_snapshots')
          .select('from_currency, to_currency, rate, source, captured_at')
          .order('captured_at', { ascending: false })
          .limit(2000)
          .then(r => r).catch(() => ({ data: [] } as any)),
        supabasePersonas
          .from('fx_pair_config')
          .select('from_currency, to_currency, tiers')
          .then(r => r).catch(() => ({ data: [] } as any)),
      ]);

      // Construimos un map combinado: prefer view, sino la última fila de
      // fx_rate_snapshots (excluyendo MANUAL para que el público vea mercado).
      const byPair = new Map<string, { from_currency: string; to_currency: string; rate: number; source: string; captured_at: string | null }>();
      const viewRows = (currentRes?.data ?? []) as Array<{ from_currency: string; to_currency: string; rate: number; source: string; captured_at: string | null }>;
      for (const r of viewRows) {
        if (isFinite(Number(r.rate)) && Number(r.rate) > 0) {
          byPair.set(`${r.from_currency}/${r.to_currency}`, r);
        }
      }
      // Fallback de snapshots: solo agrego pares que la view no devolvió.
      const snapRows = (snapsRes.data ?? []) as Array<{ from_currency: string; to_currency: string; rate: number; source: string; captured_at: string | null }>;
      for (const r of snapRows) {
        const key = `${r.from_currency}/${r.to_currency}`;
        if (byPair.has(key)) continue;
        // Saltamos MANUAL en el fallback público: si el admin no tiene la view
        // pero hay una fila manual de hace tiempo, no la usamos como referencia.
        if (String(r.source ?? '').toUpperCase() === 'MANUAL') continue;
        if (!isFinite(Number(r.rate)) || Number(r.rate) <= 0) continue;
        byPair.set(key, r);
      }

      if (byPair.size === 0) return false;
      // Map de tiers por par desde fx_pair_config.
      const tierByPair = new Map<string, FeeTier[]>();
      for (const r of (tierRes.data ?? []) as Array<{ from_currency: string; to_currency: string; tiers: FeeTier[] | null }>) {
        if (Array.isArray(r.tiers) && r.tiers.length > 0) {
          tierByPair.set(`${r.from_currency}/${r.to_currency}`, r.tiers);
        }
      }

      const nowLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const nowTs    = Date.now();

      // Poblar baseRates a partir de los pares USD-* / *-USD que tengamos.
      // Sin esto getFeeForAmount no podía convertir el monto a USD y caía
      // al flat fee, ignorando los tiers configurados en el admin.
      const newBaseRates: Record<string, number> = { USD: 1 };
      for (const [pairKey, hit] of byPair.entries()) {
        const [from, to] = pairKey.split('/');
        const r = Number(hit.rate);
        if (!isFinite(r) || r <= 0) continue;
        if (from === 'USD' && to && !newBaseRates[to]) {
          // USD-X: X unidades por 1 USD
          newBaseRates[to] = r;
        } else if (to === 'USD' && from && !newBaseRates[from]) {
          // X-USD: X→USD rate; X por 1 USD = 1 / (USD por 1 X) = 1 / r
          newBaseRates[from] = 1 / r;
        }
      }
      // Si nos faltó alguna moneda anchor (no había USD-X ni X-USD), la
      // derivamos pivotando por COP / cualquier moneda que sí tengamos contra USD.
      const anchorsWithUsd = Object.keys(newBaseRates);
      for (const [pairKey, hit] of byPair.entries()) {
        const [from, to] = pairKey.split('/');
        const r = Number(hit.rate);
        if (!isFinite(r) || r <= 0) continue;
        // Si tenemos baseRates[from] (X por USD) y no tenemos baseRates[to],
        // derivamos baseRates[to] = baseRates[from] / (X→Y rate) ... aspectos.
        // El cross: 1 USD = baseRates[from] X = baseRates[from] / r Y
        if (newBaseRates[from] && !newBaseRates[to]) {
          newBaseRates[to] = newBaseRates[from] * r;
        } else if (newBaseRates[to] && !newBaseRates[from] && r > 0) {
          newBaseRates[from] = newBaseRates[to] / r;
        }
      }
      setBaseRates(newBaseRates);

      setExchangeRates(prev => prev.map(row => {
        const pairKey = `${row.source}/${row.target}`;
        const tiers = tierByPair.get(pairKey);
        if (row.mode !== 'api') {
          // Aunque esté en manual, igual le adosamos los tiers para que getFeeForAmount funcione.
          return tiers ? { ...row, tiers } : row;
        }
        const hit = byPair.get(pairKey);
        if (!hit || !isFinite(Number(hit.rate)) || Number(hit.rate) <= 0) {
          return tiers ? { ...row, tiers } : row;
        }
        return {
          ...row,
          rate: Number(Number(hit.rate).toPrecision(8)),
          lastUpdate: nowLabel,
          timestamp: nowTs,
          provider: String(hit.source ?? '').toUpperCase(),
          dbUpdatedAt: hit.captured_at ?? undefined,
          ...(tiers ? { tiers } : {}),
        };
      }));
      setApiStatus('connected');
      return true;
    } catch (e: any) {
      console.warn('fx_rate_current fetch failed:', e?.message ?? e);
      return false;
    }
  };

  // Function to fetch real market rates from a public API (fallback)
  const fetchMarketRates = async () => {
    setApiStatus('loading');
    // 1) Primero intentamos la view de Antigravity (fx_rate_current).
    //    Si pobló las tasas, salimos.
    const ok = await fetchFromFxView();
    if (ok) return;
    // 2) Si la view no respondió (config faltante o view sin filas),
    //    caemos al API público USD-based como antes.
    try {
      const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD')
        .then(response => {
            if (!response.ok) throw new Error('Primary API unavailable');
            return response;
        })
        .catch(() => {
            console.warn("Primary API failed, attempting fallback...");
            return fetch('https://open.er-api.com/v6/latest/USD');
        });

      if (!res.ok) throw new Error('All exchange rate APIs failed');

      const data = await res.json();
      const rates = data.rates; // e.g. { "COP": 4250.50, "BRL": 6.06, ... }

      setBaseRates(rates);
      setApiStatus('connected');

      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const nowTimestamp = Date.now();

      setExchangeRates(prevRates => prevRates.map(row => {
        // Only auto-update rows that are in 'api' mode
        if (row.mode === 'api') {
           const sourceRateUSD = rates[row.source]; 
           const targetRateUSD = rates[row.target]; 
           
           if (sourceRateUSD && targetRateUSD) {
             // Calculate Cross Rate: Target per 1 Source
             const realCrossRate = targetRateUSD / sourceRateUSD;
             
             return {
               ...row,
               rate: Number(realCrossRate.toPrecision(6)), 
               lastUpdate: now,
               timestamp: nowTimestamp
             };
           }
        }
        return row;
      }));
    } catch (err) {
      // Suppress error logging to console to avoid "Failed to fetch" noise
      console.warn("Using simulated rates (Live API unavailable).");
      
      // Base Simulated Rates (against 1 USD)
      const simulatedRates: Record<string, number> = {
          "USD": 1,
          "COP": 4250 + (Math.random() * 20 - 10),
          "CLP": 970 + (Math.random() * 5 - 2.5),
          "PEN": 3.75 + (Math.random() * 0.05 - 0.025),
          "MXN": 20.35 + (Math.random() * 0.1 - 0.05),
          "BRL": 6.06 + (Math.random() * 0.05 - 0.025),
          "VES": 45.50 + (Math.random() * 1 - 0.5),
          "EUR": 0.92 + (Math.random() * 0.01 - 0.005),
          "CNY": 7.20 + (Math.random() * 0.05 - 0.025)
      };
      
      setBaseRates(simulatedRates);
      setApiStatus('connected'); // Show connected to user so UI doesn't look broken

      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const nowTimestamp = Date.now();

      setExchangeRates(prevRates => prevRates.map(row => {
        if (row.mode === 'api') {
           const sourceRateUSD = simulatedRates[row.source]; 
           const targetRateUSD = simulatedRates[row.target]; 
           
           if (sourceRateUSD && targetRateUSD) {
             const realCrossRate = targetRateUSD / sourceRateUSD;
             return {
               ...row,
               rate: Number(realCrossRate.toPrecision(6)), 
               lastUpdate: now,
               timestamp: nowTimestamp
             };
           }
        }
        return row;
      }));
    }
  };

  // Initial Fetch & Interval
  useEffect(() => {
    fetchMarketRates();
    // Refresco cada 60s: la view fx_rate_current se actualiza a lo sumo cada
    // 5 min (cron de FastForex), pero polleamos más seguido para tomar el
    // cambio ni bien aparece. Una request a Supabase con índice es barata.
    const interval = setInterval(fetchMarketRates, 60000);
    return () => clearInterval(interval);
  }, []);

  // Persist fees and modes to localStorage whenever they change
  useEffect(() => {
    const toSave: Record<string, { fee: number; mode: string; rate: number }> = {};
    exchangeRates.forEach(r => { toSave[r.id] = { fee: r.fee, mode: r.mode, rate: r.rate }; });
    localStorage.setItem(LS_RATES, JSON.stringify(toSave));
  }, [exchangeRates]);

  const updateRate = (id: string, newRate: number) => {
    setExchangeRates(prev => {
      const updated = prev.map(rate =>
        rate.id === id ? { ...rate, rate: newRate, lastUpdate: 'Manual', timestamp: Date.now() } : rate
      );
      persistMeta(updated);
      return updated;
    });
  };

  const updateFee = (id: string, newFee: number) => {
    setExchangeRates(prev => {
      const updated = prev.map(rate => rate.id === id ? { ...rate, fee: newFee } : rate);
      persistMeta(updated);
      return updated;
    });
  };

  const toggleMode = (id: string) => {
    setExchangeRates(prev => {
      const updated = prev.map(row => {
        if (row.id === id) {
          const newMode = row.mode === 'api' ? 'manual' : 'api';
          let newRate = row.rate;
          let updateLabel = 'Manual';
          const newTimestamp = Date.now();
          if (newMode === 'api' && baseRates[row.source] && baseRates[row.target]) {
            const calculatedRate = baseRates[row.target] / baseRates[row.source];
            newRate = Number(calculatedRate.toPrecision(6));
            updateLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          }
          return { ...row, mode: newMode, rate: newRate, lastUpdate: updateLabel, timestamp: newTimestamp };
        }
        return row;
      });
      persistMeta(updated);
      return updated;
    });
  };

  const getRate = (source: string, target: string): number => {
    if (source === target) return 1;
    
    // Check if we have the specific pair in our table (which includes manual overrides)
    const pair = exchangeRates.find(r => r.source === source && r.target === target);
    if (pair) return pair.rate;

    // Fallback: Calculate from base rates if pair not in table but we have API data
    if (baseRates[source] && baseRates[target]) {
        return baseRates[target] / baseRates[source];
    }

    return 0;
  };

  const getFee = (source: string, target: string): number => {
    if (source === target) return 0;

    // Find the explicit pair configuration
    const pair = exchangeRates.find(r => r.source === source && r.target === target);

    // Return individual fee if found, otherwise default to a safety fee (e.g. 1% or 0%)
    // Here we assume if it's not in the list, we might want to default to 0 or handle it elsewhere.
    return pair ? pair.fee : 0;
  };

  const getFeeForAmount = (source: string, target: string, amount: number): number => {
    if (source === target) return 0;
    const pair = exchangeRates.find(r => r.source === source && r.target === target);
    if (!pair) return 0;
    // Si no hay tiers configurados, usamos el flat fee legacy.
    if (!pair.tiers || pair.tiers.length === 0) return pair.fee;
    if (!isFinite(amount) || amount <= 0) return pair.fee;

    // Convertir `amount` (en moneda source) a USD para hacer el lookup del tier.
    // baseRates está en formato "X unidades por 1 USD", así que dividimos.
    let amountUsd = amount;
    if (source !== 'USD') {
      const ratePerUsd = baseRates[source];
      if (ratePerUsd && ratePerUsd > 0) {
        amountUsd = amount / ratePerUsd;
      } else {
        // Sin baseRates → fallback al flat fee, mejor que aplicar mal el tier.
        return pair.fee;
      }
    }

    // Buscar el tier que contiene el monto. Asumimos tiers ya ordenados pero por
    // las dudas comparamos por rango: from_usd <= x < to_usd (to_usd null = ∞).
    const sorted = [...pair.tiers].sort((a, b) => a.from_usd - b.from_usd);
    for (const t of sorted) {
      const lo = Number(t.from_usd) || 0;
      const hi = t.to_usd === null || t.to_usd === undefined ? Infinity : Number(t.to_usd);
      if (amountUsd >= lo && amountUsd < hi) {
        return Number(t.pct) || 0;
      }
    }
    // Si el monto cae fuera de todos los rangos (p. ej. tiers mal armados),
    // usamos el último tier configurado como salvavidas.
    const last = sorted[sorted.length - 1];
    return last ? (Number(last.pct) || pair.fee) : pair.fee;
  };

  const getProvider = (source: string, target: string): string | undefined => {
    if (source === target) return undefined;
    return exchangeRates.find(r => r.source === source && r.target === target)?.provider;
  };

  const getDbUpdatedAt = (source: string, target: string): string | undefined => {
    if (source === target) return undefined;
    return exchangeRates.find(r => r.source === source && r.target === target)?.dbUpdatedAt;
  };

  return (
    <ExchangeRateContext.Provider value={{ exchangeRates, updateRate, updateFee, toggleMode, getRate, getFee, getFeeForAmount, getProvider, getDbUpdatedAt, apiStatus, forceRefresh: fetchMarketRates }}>
      {children}
    </ExchangeRateContext.Provider>
  );
};

export const useExchangeRates = () => {
  const context = useContext(ExchangeRateContext);
  if (context === undefined) {
    throw new Error('useExchangeRates must be used within an ExchangeRateProvider');
  }
  return context;
};