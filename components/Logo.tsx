import React from 'react';
import { useSystemConfig } from '../context/SystemConfigContext';

const ARCHIVO = "'Archivo', system-ui, sans-serif";

// Logo OFICIAL de Lincoin: wordmark tipográfico — la palabra "Lincoin" seguida
// de un PUNTO verde (el punto de la tipografía, mismo tamaño que un punto normal).
// Prohibido: cuadros, círculos, "app icons", isotipos, degradados sobre las letras.
// Variante corta (avatares/favicon muy pequeños): "L" + punto verde.
export const Logo: React.FC<{ collapsed?: boolean; variant?: 'default' | 'white'; business?: boolean }> = ({
  collapsed,
  variant = 'default',
  business = false,
}) => {
  const { config } = useSystemConfig();
  const green = config.accentColor || '#4ADE80';
  // App en tema oscuro → texto blanco hueso #F4F4F2 (sobre claro sería #15181A).
  const textColor = '#F4F4F2';

  // Variante corta: solo "L." — para sidebar colapsada / avatares pequeños.
  if (collapsed) {
    return (
      <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 26, letterSpacing: '-0.5px', color: textColor, lineHeight: 1 }}>
        L<span style={{ color: green }}>.</span>
      </span>
    );
  }

  return (
    <div className="flex flex-col justify-center leading-none">
      <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 22, letterSpacing: '-0.6px', color: textColor, lineHeight: 1 }}>
        Lincoin<span style={{ color: green }}>.</span>
      </span>
      {business && (
        <span className="uppercase" style={{ fontFamily: ARCHIVO, fontWeight: 600, fontSize: 9, letterSpacing: '2.5px', color: 'rgba(244,244,242,0.55)', marginTop: 3 }}>
          Empresas
        </span>
      )}
    </div>
  );
};
