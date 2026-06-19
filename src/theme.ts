/**
 * Lincoln design tokens — dark fintech theme inspired by dollar/crypto wallets
 * (Lemon Cash, Wenia, Dólar App, Monabit).
 */
export const colors = {
  // Backgrounds
  bg: "#0B0F14",
  surface: "#141A22",
  surfaceAlt: "#1C2530",
  border: "#26303C",

  // Brand — "Lincoln green" (a nod to the dollar)
  primary: "#27D17F",
  primaryDark: "#1FA968",
  primarySoft: "rgba(39, 209, 127, 0.12)",

  // Accents
  accent: "#3B82F6",
  warning: "#F5A623",
  danger: "#FF5A5F",

  // Text
  text: "#FFFFFF",
  textMuted: "#9AA7B5",
  textFaint: "#5E6B79",

  white: "#FFFFFF",
  black: "#000000",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

export const font = {
  size: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 22,
    xxl: 28,
    display: 36,
  },
  weight: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
  },
};
