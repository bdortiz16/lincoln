import React, { useState, useEffect, useRef } from 'react';
import { Wallet, Repeat, Send, Shield, TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react';

const FEATURES = [
  {
    icon: Wallet,
    title: 'Diez cuentas en diferentes divisas',
    desc: 'Puedes tener cuentas en USD, EUR, MXN, COP (entre otras) sin costo alguno.',
    color: 'bg-slate-50 text-[#4ADE80]',
  },
  {
    icon: Repeat,
    title: 'Compra y envía desde otras divisas',
    desc: 'En la sección Convertir, podrás comprar USD, EUR y otras 6 divisas para ahorrar y enviar.',
    color: 'bg-green-50 text-green-700',
  },
  {
    icon: Send,
    title: 'Envíos internacionales rápidos',
    desc: 'Transfiere dinero a cualquier país de Latinoamérica en minutos a la mejor tasa.',
    color: 'bg-purple-50 text-purple-700',
  },
  {
    icon: Shield,
    title: 'Seguridad y cumplimiento',
    desc: 'Verificación KYC/AML y controles antifraude para proteger tus operaciones.',
    color: 'bg-orange-50 text-orange-700',
  },
  {
    icon: TrendingUp,
    title: 'Mesa OTC para empresas',
    desc: 'Opera con USDT y USDC a tasas preferenciales exclusivas para cuentas empresariales.',
    color: 'bg-emerald-50 text-emerald-700',
  },
];

export const FeatureCarousel: React.FC = () => {
  const [current, setCurrent] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startXRef = useRef<number | null>(null);

  const go = (idx: number) => {
    setCurrent((idx + FEATURES.length) % FEATURES.length);
  };

  const resetTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setCurrent(c => (c + 1) % FEATURES.length), 4000);
  };

  useEffect(() => {
    resetTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const handlePrev = () => { go(current - 1); resetTimer(); };
  const handleNext = () => { go(current + 1); resetTimer(); };
  const handleDot = (i: number) => { go(i); resetTimer(); };

  const handleTouchStart = (e: React.TouchEvent) => { startXRef.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (startXRef.current === null) return;
    const diff = startXRef.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) { diff > 0 ? handleNext() : handlePrev(); }
    startXRef.current = null;
  };

  const { icon: Icon, title, desc, color } = FEATURES[current];

  return (
    <div
      className="relative select-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-start gap-4 min-h-[110px] transition-all duration-300">
        <div className={`p-3 ${color} rounded-lg shrink-0`}>
          <Icon size={24} />
        </div>
        <div>
          <h3 className="font-bold text-slate-800 mb-1">{title}</h3>
          <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
        </div>
      </div>

      {/* Prev / Next */}
      <button
        onClick={handlePrev}
        className="absolute left-[-12px] top-1/2 -translate-y-1/2 w-8 h-8 bg-[#0C0E0D] rounded-full flex items-center justify-center shadow-lg hover:bg-[#152e52] transition-colors"
      >
        <ChevronLeft size={16} />
      </button>
      <button
        onClick={handleNext}
        className="absolute right-[-12px] top-1/2 -translate-y-1/2 w-8 h-8 bg-[#0C0E0D] rounded-full flex items-center justify-center shadow-lg hover:bg-[#152e52] transition-colors"
      >
        <ChevronRight size={16} />
      </button>

      {/* Dots */}
      <div className="flex justify-center gap-2 mt-4">
        {FEATURES.map((_, i) => (
          <button
            key={i}
            onClick={() => handleDot(i)}
            className={`rounded-full transition-all duration-300 ${i === current ? 'w-4 h-2.5 bg-[#0C0E0D]' : 'w-2.5 h-2.5 bg-slate-200 hover:bg-green-300'}`}
          />
        ))}
      </div>
    </div>
  );
};
