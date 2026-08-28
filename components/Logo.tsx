import React from 'react';
import { useSystemConfig } from '../context/SystemConfigContext';

// Logo oficial de Lincoin: cuadro oscuro con "L" blanca + punto verde ("L.").
const LincoinMark: React.FC<{ size?: number; green: string }> = ({ size = 34, green }) => {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ flexShrink: 0 }} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="lincoinMarkBg" cx="0.8" cy="0.15" r="0.9">
          <stop offset="0" stopColor="#123524" />
          <stop offset="0.55" stopColor="#0a0a0a" />
          <stop offset="1" stopColor="#0a0a0a" />
        </radialGradient>
      </defs>
      <rect x="1" y="1" width="98" height="98" rx="26" fill="url(#lincoinMarkBg)" />
      {/* L blanca (blocky) */}
      <path d="M34 30 H47 V58 H58 V71 H34 Z" fill="#F4F4F2" />
      {/* punto verde */}
      <circle cx="68" cy="67" r="12" fill={green} />
    </svg>
  );
};

export const Logo: React.FC<{ collapsed?: boolean; variant?: 'default' | 'white'; business?: boolean }> = ({
  collapsed,
  variant = 'default',
  business = false,
}) => {
  const { config } = useSystemConfig();
  const green = config.accentColor || '#4ade80';

  // El app es tema oscuro Lincoin: el wordmark va en blanco hueso.
  const textColor = variant === 'white' ? '#FFFFFF' : '#F4F4F2';

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
