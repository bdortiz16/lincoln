import React from 'react';
import { useSystemConfig } from '../context/SystemConfigContext';

const PALETTES = [
  { id: 1,  name: 'Estonia ★',   theme: '#0F172A', accent: '#2DD4BF', mid: '#0F172A', end: '#0F172A' },
  { id: 2,  name: 'Midnight',    theme: '#050A14', accent: '#2DD4BF', mid: '#081428', end: '#0A1C3E' },
  { id: 3,  name: 'Ocean',       theme: '#011627', accent: '#2DD4BF', mid: '#021E35', end: '#042540' },
  { id: 4,  name: 'Navy Classic',theme: '#0D1B2A', accent: '#2DD4BF', mid: '#0F2038', end: '#122440' },
  { id: 5,  name: 'Cobalt',      theme: '#020617', accent: '#2DD4BF', mid: '#040C28', end: '#060F35' },
  { id: 6,  name: 'Sapphire',    theme: '#0A0E27', accent: '#2DD4BF', mid: '#0C1130', end: '#0F1438' },
  { id: 7,  name: 'Steel',       theme: '#0D1B2A', accent: '#2DD4BF', mid: '#0F2236', end: '#102840' },
  { id: 8,  name: 'Glacier',     theme: '#0C1A26', accent: '#2DD4BF', mid: '#0E2030', end: '#102638' },
  { id: 9,  name: 'Cyan Tech',   theme: '#040D1A', accent: '#2DD4BF', mid: '#061222', end: '#081628' },
  { id: 10, name: 'Dusk',        theme: '#0F1923', accent: '#2DD4BF', mid: '#111E2E', end: '#132238' },
];

const MiniPreview: React.FC<{ palette: typeof PALETTES[0]; onApply: () => void }> = ({ palette, onApply }) => (
  <div
    className="rounded-2xl overflow-hidden shadow-xl cursor-pointer hover:scale-105 transition-transform duration-200 border-2 border-white/10"
    style={{ background: `linear-gradient(160deg, ${palette.theme} 0%, ${palette.mid} 55%, ${palette.end} 100%)` }}
    onClick={onApply}
  >
    {/* Mini nav */}
    <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: palette.accent }}>
          <svg width="14" height="14" viewBox="0 0 100 100" fill="none">
            <rect x="34" y="34" width="46" height="46" rx="10" fill="none" stroke="white" strokeWidth="8" transform="rotate(18 57 57)" />
            <rect x="20" y="20" width="46" height="46" rx="10" fill="white" transform="rotate(-18 43 43)" />
          </svg>
        </div>
        <span className="font-black text-white text-xs tracking-tight">CUY<span style={{ color: palette.accent }}>PAY</span></span>
      </div>
      <div
        className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
        style={{ background: palette.accent }}
      >
        Registrarse
      </div>
    </div>

    {/* Mini hero */}
    <div className="px-4 py-5 relative overflow-hidden">
      <div className="absolute -top-8 -left-8 w-32 h-32 rounded-full opacity-20 blur-2xl" style={{ background: palette.accent }} />
      <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: palette.accent }}>Fintech</p>
      <h2 className="text-white font-black text-base leading-tight mb-3">
        Transferencias<br />internacionales
      </h2>
      <div
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
        style={{ background: palette.accent, color: 'white' }}
      >
        Empezar ahora →
      </div>
    </div>

    {/* Mini stat row */}
    <div className="flex border-t border-white/10">
      {['COP', 'PEN', 'MXN'].map((cur) => (
        <div key={cur} className="flex-1 py-2 text-center border-r border-white/10 last:border-r-0">
          <p className="text-white/40 text-[9px] uppercase">{cur}</p>
          <p className="text-white font-bold text-xs" style={{ color: palette.accent }}>4,150</p>
        </div>
      ))}
    </div>

    {/* Label */}
    <div className="py-2 text-center" style={{ background: palette.accent + '22' }}>
      <span className="text-white font-bold text-xs">{palette.id}. {palette.name}</span>
    </div>
  </div>
);

export const PaletteChooser: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { updateConfig } = useSystemConfig();

  const apply = (p: typeof PALETTES[0]) => {
    updateConfig({
      themeColor: p.theme,
      accentColor: p.accent,
      heroGradientMid: p.mid,
      heroGradientEnd: p.end,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }}>
      <div className="bg-[#0F172A] rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-6 border border-white/10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-white font-black text-2xl">Elige tu paleta de azules</h2>
            <p className="text-white/50 text-sm mt-1">Haz clic en cualquier tarjeta para aplicarla al instante</p>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white transition-colors text-2xl font-light">✕</button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {PALETTES.map((p) => (
            <MiniPreview key={p.id} palette={p} onApply={() => apply(p)} />
          ))}
        </div>
      </div>
    </div>
  );
};
