import React, { createContext, useContext, useMemo, useState } from "react";
import { ASSETS, AssetId, getAsset } from "@/data/assets";

export interface Holding {
  assetId: AssetId;
  amount: number;
}

export interface Transaction {
  id: string;
  type: "buy" | "sell" | "send" | "receive";
  assetId: AssetId;
  amount: number;
  /** Value in USD at time of transaction. */
  usdValue: number;
  counterparty?: string;
  date: string; // ISO
}

interface WalletState {
  holdings: Holding[];
  transactions: Transaction[];
  totalUsd: number;
  balanceOf: (assetId: AssetId) => number;
  buy: (assetId: AssetId, usdAmount: number) => void;
  sell: (assetId: AssetId, assetAmount: number) => void;
  send: (assetId: AssetId, amount: number, to: string) => void;
}

const WalletContext = createContext<WalletState | undefined>(undefined);

const INITIAL_HOLDINGS: Holding[] = [
  { assetId: "USD", amount: 250.0 },
  { assetId: "USDT", amount: 120.5 },
  { assetId: "BTC", amount: 0.0042 },
];

const INITIAL_TX: Transaction[] = [
  {
    id: "t1",
    type: "receive",
    assetId: "USDT",
    amount: 100,
    usdValue: 100,
    counterparty: "maria.lemon",
    date: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: "t2",
    type: "buy",
    assetId: "BTC",
    amount: 0.0042,
    usdValue: 283.21,
    date: new Date(Date.now() - 172800000).toISOString(),
  },
];

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [holdings, setHoldings] = useState<Holding[]>(INITIAL_HOLDINGS);
  const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_TX);

  function balanceOf(assetId: AssetId) {
    return holdings.find((h) => h.assetId === assetId)?.amount ?? 0;
  }

  function adjust(assetId: AssetId, delta: number) {
    setHoldings((prev) => {
      const existing = prev.find((h) => h.assetId === assetId);
      if (existing) {
        return prev.map((h) =>
          h.assetId === assetId ? { ...h, amount: Math.max(0, h.amount + delta) } : h
        );
      }
      return [...prev, { assetId, amount: Math.max(0, delta) }];
    });
  }

  function pushTx(tx: Transaction) {
    setTransactions((prev) => [tx, ...prev]);
  }

  function buy(assetId: AssetId, usdAmount: number) {
    const asset = getAsset(assetId);
    if (!asset || usdAmount <= 0) return;
    const units = usdAmount / asset.priceLocal;
    adjust("USD", -usdAmount);
    adjust(assetId, units);
    pushTx({
      id: "t_" + Date.now(),
      type: "buy",
      assetId,
      amount: units,
      usdValue: usdAmount,
      date: new Date().toISOString(),
    });
  }

  function sell(assetId: AssetId, assetAmount: number) {
    const asset = getAsset(assetId);
    if (!asset || assetAmount <= 0) return;
    const usd = assetAmount * asset.priceLocal;
    adjust(assetId, -assetAmount);
    adjust("USD", usd);
    pushTx({
      id: "t_" + Date.now(),
      type: "sell",
      assetId,
      amount: assetAmount,
      usdValue: usd,
      date: new Date().toISOString(),
    });
  }

  function send(assetId: AssetId, amount: number, to: string) {
    const asset = getAsset(assetId);
    if (!asset || amount <= 0) return;
    adjust(assetId, -amount);
    pushTx({
      id: "t_" + Date.now(),
      type: "send",
      assetId,
      amount,
      usdValue: amount * asset.priceLocal,
      counterparty: to,
      date: new Date().toISOString(),
    });
  }

  const totalUsd = useMemo(
    () =>
      holdings.reduce((sum, h) => {
        const asset = ASSETS.find((a) => a.id === h.assetId);
        return sum + h.amount * (asset?.priceLocal ?? 0);
      }, 0),
    [holdings]
  );

  return (
    <WalletContext.Provider
      value={{ holdings, transactions, totalUsd, balanceOf, buy, sell, send }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
