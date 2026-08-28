import React from 'react';
import { useSystemConfig } from '../context/SystemConfigContext';
import { useTheme } from '../context/ThemeContext';

// Logo oficial de Lincoin: mark cuadrado verde con "L" + wordmark "Lincoin."
// El punto final va en el verde de marca (config.accentColor, #4ade80).
const LincoinMark: React.FC<{ size?: number; green: string }> = ({ size = 34, green }) => {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: green,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      <span style={{ fontWeight: 900, fontSize: Math.round(size * 0.56), color: '#0a0a0a', lineHeight: 1 }}>L</span>
    </div>
  );
};

export const Logo: React.FC<{ collapsed?: boolean; variant?: 'default' | 'white'; business?: boolean }> = ({
  collapsed,
  variant = 'default',
  business = false,
}) => {
  const { config } = useSystemConfig();
  const { isDarkMode } = useTheme();
  const green = config.accentColor || '#4ade80';

  let textColor: string;
  if (variant === 'white') {
    textColor = '#FFFFFF';
  } else if (isDarkMode) {
    textColor = '#FFFFFF';
  } else {
    textColor = '#0a0a0a';
  }

  return (
    <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'}`}>
      <LincoinMark size={collapsed ? 36 : 34} green={green} />
      {!collapsed && (
        <div className="flex flex-col justify-center leading-none">
          <span className="font-black tracking-tight" style={{ fontSize: 21, letterSpacing: '-0.5px', color: textColor }}>
            Lincoin<span style={{ color: green }}>.</span>
          </span>
          {business && (
            <span className="font-semibold uppercase tracking-widest" style={{
              fontSize: 9,
              color: variant === 'white' ? 'rgba(255,255,255,0.7)' : 'rgba(10,10,10,0.55)',
              marginTop: 2,
            }}>
              Business
            </span>
          )}
        </div>
      )}
    </div>
  );
};
