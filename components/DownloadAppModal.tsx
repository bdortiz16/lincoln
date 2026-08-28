import React from 'react';
import { X, Smartphone, Download } from 'lucide-react';

interface DownloadAppModalProps {
  onClose: () => void;
}

export const DownloadAppModal: React.FC<DownloadAppModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 animate-in fade-in duration-300">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/80 backdrop-blur-md"
        onClick={onClose}
      ></div>

      {/* Modal */}
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 md:p-10 animate-in zoom-in-95 duration-300">

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-800 transition-colors p-1 hover:bg-slate-50 rounded-full"
        >
          <X size={22} />
        </button>

        {/* Logo + Phone Icon */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <div
              style={{ background: 'linear-gradient(135deg, #0F172A, #1E293B)' }}
              className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-xl"
            >
              <Smartphone size={40} style={{ color: '#2DD4BF' }} strokeWidth={1.5} />
            </div>
            <div
              style={{ backgroundColor: '#2DD4BF' }}
              className="absolute -top-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center shadow-lg"
            >
              <Download size={16} style={{ color: '#0F172A' }} strokeWidth={3} />
            </div>
          </div>
        </div>

        {/* Title */}
        <h2 style={{ color: '#0F172A' }} className="text-2xl md:text-3xl font-bold text-center mb-2">
          Descarga CUYPAY
        </h2>
        <p style={{ color: '#64748B' }} className="text-center text-sm mb-8 leading-relaxed">
          Tu cuenta personal vive en la app móvil.<br />
          Descárgala gratis y empieza ahora.
        </p>

        {/* Download buttons */}
        <div className="space-y-3 mb-6">

          {/* Google Play */}
          <button
            style={{ backgroundColor: '#0F172A' }}
            className="w-full hover:opacity-90 transition-all duration-300 rounded-2xl p-4 flex items-center gap-3"
          >
            <div className="w-10 h-10 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none">
                <path d="M3.609 1.814L13.792 12 3.609 22.186a.996.996 0 01-.609-.92V2.734a1 1 0 01.609-.92z" fill="#2DD4BF"/>
                <path d="M16.81 15.012L6.05 21.2l8.99-8.99 1.77 2.802z" fill="#2DD4BF" opacity="0.7"/>
                <path d="M20.16 10.81c.5.31.5 1.06 0 1.38l-3.34 1.93-2.04-2.62 2.04-2.62 3.34 1.93z" fill="#2DD4BF"/>
                <path d="M6.05 2.79l10.76 6.19-1.77 2.8L6.05 2.79z" fill="#2DD4BF" opacity="0.85"/>
              </svg>
            </div>
            <div className="flex-1 text-left">
              <div style={{ color: '#CBD5E1', fontSize: '10px', lineHeight: '1.2' }}>Descarga en</div>
              <div style={{ color: '#FFFFFF', fontSize: '16px', fontWeight: 700, lineHeight: '1.2' }}>Google Play</div>
            </div>
            <span style={{ backgroundColor: '#FBBF24', color: '#0F172A', fontSize: '9px', fontWeight: 700 }} className="px-2 py-1 rounded-full">
              PRÓXIMAMENTE
            </span>
          </button>

          {/* App Store */}
          <button
            style={{ backgroundColor: '#0F172A' }}
            className="w-full hover:opacity-90 transition-all duration-300 rounded-2xl p-4 flex items-center gap-3"
          >
            <div className="w-10 h-10 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" className="w-8 h-8" fill="#2DD4BF">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
              </svg>
            </div>
            <div className="flex-1 text-left">
              <div style={{ color: '#CBD5E1', fontSize: '10px', lineHeight: '1.2' }}>Descarga en</div>
              <div style={{ color: '#FFFFFF', fontSize: '16px', fontWeight: 700, lineHeight: '1.2' }}>App Store</div>
            </div>
            <span style={{ backgroundColor: '#FBBF24', color: '#0F172A', fontSize: '9px', fontWeight: 700 }} className="px-2 py-1 rounded-full">
              PRÓXIMAMENTE
            </span>
          </button>

        </div>

        {/* Notify me */}
        <div
          style={{ backgroundColor: 'rgba(45, 212, 191, 0.1)', borderColor: 'rgba(45, 212, 191, 0.2)' }}
          className="border rounded-2xl p-4 text-center"
        >
          <p style={{ color: '#0F172A' }} className="text-xs mb-2 font-medium">
            🔔 ¿Quieres ser de los primeros en saber cuándo esté lista?
          </p>
          <button style={{ color: '#0F172A' }} className="text-xs font-bold underline hover:opacity-70 transition-opacity">
            Notifícame por correo
          </button>
        </div>

      </div>
    </div>
  );
};
