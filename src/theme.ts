/**
 * Lincoln design tokens — dark fintech theme inspired by dollar/crypto wallets
 * (Lemon Cash, Wenia, Dólar App, Monabit).
 */
export const colors = {
  // Backgrounds — deep navy
  bg: "#091830",
  surface: "#0F2143",
  surfaceAlt: "#17315E",
  border: "#21407A",

  // Brand — navy & blue
  primary: "#3D7BFF",
  primaryDark: "#2C63DB",
  primarySoft: "rgba(61, 123, 255, 0.14)",
  navy: "#0B2350",

  // Accents
  accent: "#6EA0FF",
  warning: "#F5A623",
  danger: "#FF5A5F",

  // Text
  text: "#FFFFFF",
  textMuted: "#9FB2CE",
  textFaint: "#5C7299",

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
