import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

// Maps currency codes (and ISO-2 country codes) to flagcdn.com country codes
const FLAG_MAP: Record<string, string> = {
  // Currency codes
  USD: 'us', COP: 'co', CLP: 'cl', PEN: 'pe', MXN: 'mx',
  BRL: 'br', VES: 've', EUR: 'eu', CNY: 'cn', ARS: 'ar',
  // ISO-2 country codes
  US: 'us', CO: 'co', CL: 'cl', PE: 'pe', MX: 'mx',
  BR: 'br', VE: 've', EU: 'eu', CN: 'cn', AR: 'ar',
};

export const flagUrl = (code: string) => {
  const key = code.toUpperCase();
  const country = FLAG_MAP[key] ?? code.substring(0, 2).toLowerCase();
  return `https://flagcdn.com/w40/${country}.png`;
};

interface FlagImgProps {
  code: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const SIZE_CLASS: Record<string, string> = {
  sm: 'w-5 h-3.5',
  md: 'w-6 h-4',
  lg: 'w-8 h-5',
  xl: 'w-12 h-8',
};

export const FlagImg: React.FC<FlagImgProps> = ({ code, className, size = 'md' }) => (
  <img
    src={flagUrl(code)}
    alt={code}
    className={className ?? `${SIZE_CLASS[size]} object-cover rounded-sm`}
  />
);

interface FlagSelectItem { code: string; name: string; }

interface FlagSelectProps {
  items: FlagSelectItem[];
  value: string;
  onChange: (code: string) => void;
  className?: string;
}

export const FlagSelect: React.FC<FlagSelectProps> = ({ items, value, onChange, className }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = items.find(i => i.code === value) ?? items[0];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg py-1.5 pl-2 pr-3 font-bold text-slate-800 cursor-pointer text-sm"
      >
        <FlagImg code={selected.code} size="sm" />
        <span>{selected.code}</span>
        <ChevronDown size={12} className="text-slate-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden py-1 z-50">
          {items.map(item => (
            <button
              key={item.code}
              type="button"
              onClick={() => { onChange(item.code); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 transition-colors text-left ${value === item.code ? 'bg-slate-50 text-[#0C0E0D] font-bold' : 'text-slate-800'}`}
            >
              <FlagImg code={item.code} size="sm" />
              <span className="text-sm font-bold">{item.code}</span>
              <span className="text-xs text-slate-400 truncate">{item.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
