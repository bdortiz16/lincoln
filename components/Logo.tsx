import React from 'react';
import { useSystemConfig } from '../context/SystemConfigContext';
import { useTheme } from '../context/ThemeContext';

// Símbolo oficial de CuyPay: rounded-square outline + dot a la derecha.
// (Reemplaza al cube rotado anterior — branding oficial mayo 2026)
const CubeMark: React.FC<{ size?: number; teal: string; navy: string }> = ({ size = 40, teal, navy }) => {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="96" height="96" rx="22" fill={navy} />
      <rect
        x="22" y="22" width="56" height="56" rx="16"
        fill="none"
        stroke={teal}
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <circle cx="58" cy="56" r="8" fill={teal} className="cuypay-dot" />
    </svg>
  );
};

export const Logo: React.FC<{ collapsed?: boolean; variant?: 'default' | 'white'; business?: boolean }> = ({
  collapsed,
  variant = 'default',
  business = false,
}) => {
  const { config } = useSystemConfig();
  const { isDarkMode } = useTheme();
  const teal = config.accentColor || '#2DD4BF';
  const navy = config.themeColor  || '#0F172A';

  // In light mode, use dark text; in dark mode or when variant is white, use appropriate color
  let textColor: string;
  if (!isDarkMode) {
    textColor = navy; // Dark text in light mode
  } else if (variant === 'white') {
    textColor = '#FFFFFF';
  } else {
    textColor = navy;
  }

  return (
    <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
      <CubeMark size={collapsed ? 36 : 40} teal={teal} navy={navy} />
      {!collapsed && (
        <div className="flex flex-col justify-center leading-none">
          <span className="font-black tracking-tight" style={{ fontSize: 20, letterSpacing: '-0.5px', color: textColor }}>
            CUY<span style={{ color: teal }}>PAY</span>
          </span>
          {business && (
            <span className="font-semibold uppercase tracking-widest" style={{
              fontSize: 9,
              color: variant === 'white' ? 'rgba(255,255,255,0.7)' : 'rgba(11,27,50,0.7)',
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
