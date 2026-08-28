import React from 'react';

/**
 * El toggle de tema fue desactivado — Lincoin opera SOLO en dark mode.
 * Este componente queda como no-op para no romper los lugares donde
 * todavía está renderizado (LandingPage header, etc.). Se puede borrar
 * cuando ya no quede ninguna referencia.
 */
export const ThemeToggle: React.FC<{ className?: string }> = () => null;
