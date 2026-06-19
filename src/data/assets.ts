/**
 * Mock market data for the assets Lincoln supports.
 * Prices are illustrative — in production these come from a pricing API.
 */
export type AssetId = "USD" | "USDT" | "USDC" | "BTC" | "ETH" | "ARS" | "COP";

export interface Asset {
  id: AssetId;
  name: string;
  symbol: string;
  /** Price expressed in local currency (kept simple for the demo). */
  priceLocal: number;
  /** 24h change as a percentage. */
  change24h: number;
  /** Emoji used as a lightweight icon stand-in. */
  icon: string;
  kind: "fiat" | "stable" | "crypto";
}

export const ASSETS: Asset[] = [
  { id: "USD", name: "Dólar", symbol: "USD", priceLocal: 1, change24h: 0.0, icon: "💵", kind: "fiat" },
  { id: "USDT", name: "Tether", symbol: "USDT", priceLocal: 1, change24h: 0.01, icon: "🟢", kind: "stable" },
  { id: "USDC", name: "USD Coin", symbol: "USDC", priceLocal: 1, change24h: -0.02, icon: "🔵", kind: "stable" },
  { id: "BTC", name: "Bitcoin", symbol: "BTC", priceLocal: 67432.18, change24h: 2.34, icon: "🟠", kind: "crypto" },
  { id: "ETH", name: "Ethereum", symbol: "ETH", priceLocal: 3521.9, change24h: -1.12, icon: "🟣", kind: "crypto" },
];

export function getAsset(id: AssetId): Asset | undefined {
  return ASSETS.find((a) => a.id === id);
}
