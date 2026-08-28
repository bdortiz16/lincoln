import React, { createContext, useContext, ReactNode, useEffect } from 'react';

/**
 * CuyPay opera SOLO en modo oscuro.
 *
 * Eliminamos el toggle por decisión de producto: el modo claro generaba
 * inconsistencias visuales y bugs en varias secciones. El Provider sigue
 * existiendo para no romper la cadena de consumers (useTheme) — pero
 * isDarkMode siempre devuelve true y toggleDarkMode es no-op.
 */

interface ThemeContextType {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Garantizar que el HTML tenga la clase `dark` siempre (para Tailwind dark:)
  useEffect(() => {
    document.documentElement.classList.add('dark');
    // Limpiar cualquier valor viejo del localStorage que pudiera dejar el
    // tema en light si el user había cambiado antes
    try { localStorage.removeItem('cuypay_dark_mode'); } catch {}
  }, []);

  return (
    <ThemeContext.Provider value={{ isDarkMode: true, toggleDarkMode: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};
