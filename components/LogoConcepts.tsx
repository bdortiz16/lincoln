import React, { useState } from 'react';

const NAVY  = '#0F172A';
const TEAL  = '#2DD4BF';
const WHITE = '#FFFFFF';

/* Subtle professional animations — single global style block */
const CORP_CSS = `
  @keyframes cpBreath   { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }
  @keyframes cpGlowSoft { 0%,100%{opacity:.9} 50%{opacity:1;filter:drop-shadow(0 0 6px ${TEAL}88)} }
  @keyframes cpRotateSlow { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes cpSlideBar { 0%,100%{transform:translateX(0)} 50%{transform:translateX(6px)} }
  @keyframes cpSlideBar2 { 0%,100%{transform:translateX(0)} 50%{transform:translateX(-6px)} }
  @keyframes cpFadeShift { 0%,100%{opacity:.5;transform:scale(.97)} 50%{opacity:1;transform:scale(1)} }
  @keyframes cpPulseRing { 0%,100%{transform:scale(1);opacity:.6} 50%{transform:scale(1.12);opacity:1} }
  @keyframes cpShine { 0%{transform:translateX(-60px) rotate(30deg)} 100%{transform:translateX(120px) rotate(30deg)} }
  .cp-breath   { animation: cpBreath 3s ease-in-out infinite; transform-box:fill-box; transform-origin:center; }
  .cp-glow     { animation: cpGlowSoft 2.5s ease-in-out infinite; transform-box:fill-box; transform-origin:center; }
  .cp-rotate   { animation: cpRotateSlow 12s linear infinite; transform-box:fill-box; transform-origin:center; }
  .cp-bar1     { animation: cpSlideBar 2.5s ease-in-out infinite; transform-box:fill-box; transform-origin:center; }
  .cp-bar2     { animation: cpSlideBar2 2.5s ease-in-out infinite; transform-box:fill-box; transform-origin:center; }
  .cp-fade     { animation: cpFadeShift 3s ease-in-out infinite; transform-box:fill-box; transform-origin:center; }
  .cp-ring     { animation: cpPulseRing 2.5s ease-in-out infinite; transform-box:fill-box; transform-origin:center; }
  .cp-shine    { animation: cpShine 3s ease-in-out infinite 1s; }
`;

/* ─────────────────────────────────────────────
   CORPORATE MARKS — inspired by Stripe, Wise,
   Nubank, Revolut, Mercury, Brex, Monzo
───────────────────────────────────────────── */

/* C1: Hexagon split — subtle breath on teal half */
const C1 = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <style>{CORP_CSS}</style>
    <path d="M50 4 L92 27 L92 73 L50 96 L8 73 L8 27 Z" fill={NAVY}/>
    <path className="cp-fade" d="M50 4 L92 27 L92 73 L50 96 Z" fill={TEAL}/>
    <path d="M50 30 L50 70" stroke={WHITE} strokeWidth="8" strokeLinecap="round"/>
    <path d="M34 39 L50 30 L66 39" stroke={WHITE} strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M34 61 L50 70 L66 61" stroke={WHITE} strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/* C2: Bold C arc — shine sweep */
const C2 = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <style>{CORP_CSS}</style>
    <defs><clipPath id="c2clip"><rect width="100" height="100" rx="24"/></clipPath></defs>
    <rect width="100" height="100" rx="24" fill={TEAL}/>
    <path d="M72 28 Q40 12 22 38 Q10 52 22 66 Q40 88 72 72" stroke={NAVY} strokeWidth="16" fill="none" strokeLinecap="round"/>
    <rect className="cp-shine" x="-20" y="-10" width="28" height="120" fill={WHITE} opacity=".12" clipPath="url(#c2clip)" transform="rotate(20)"/>
  </svg>
);

/* C3: Two overlapping squares — continuous counter-rotation */
const C3_CSS = CORP_CSS + `
  @keyframes c3sq1 { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes c3sq2 { from{transform:rotate(0deg)} to{transform:rotate(-360deg)} }
  .c3-sq1 { animation:c3sq1 8s linear infinite; transform-box:fill-box; transform-origin:43px 43px; }
  .c3-sq2 { animation:c3sq2 8s linear infinite; transform-box:fill-box; transform-origin:57px 57px; }
`;
const C3 = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <style>{C3_CSS}</style>
    <rect width="100" height="100" rx="24" fill={NAVY}/>
    <rect className="c3-sq1" x="20" y="20" width="46" height="46" rx="8" fill={TEAL}/>
    <rect className="c3-sq2" x="34" y="34" width="46" height="46" rx="8" fill="none" stroke={WHITE} strokeWidth="4" opacity=".85"/>
  </svg>
);

/* C4: Diagonal slash — glow pulse */
const C4 = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <style>{CORP_CSS}</style>
    <rect width="100" height="100" rx="24" fill={TEAL}/>
    <path className="cp-glow" d="M30 78 L70 22" stroke={NAVY} strokeWidth="18" strokeLinecap="round"/>
    <circle cx="30" cy="78" r="8" fill={NAVY}/>
    <circle cx="70" cy="22" r="8" fill={NAVY}/>
  </svg>
);

/* C5: Mountain peaks — star pulses */
const C5 = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <style>{CORP_CSS}</style>
    <rect width="100" height="100" rx="24" fill={NAVY}/>
    <path d="M10 72 L38 30 L52 52 L64 36 L90 72 Z" fill={TEAL}/>
    <path d="M10 72 L38 30 L52 52 L64 36 L90 72" fill="none" stroke={WHITE} strokeWidth="3" strokeLinejoin="round" opacity=".2"/>
    <circle className="cp-ring" cx="64" cy="36" r="5" fill={WHITE}/>
  </svg>
);

/* C6: P lettermark — shine sweep */
const C6 = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <style>{CORP_CSS}</style>
    <defs><clipPath id="c6clip"><rect width="100" height="100" rx="24"/></clipPath></defs>
    <rect width="100" height="100" rx="24" fill={TEAL}/>
    <path d="M32 24 L32 76" stroke={NAVY} strokeWidth="14" strokeLinecap="round"/>
    <path d="M32 24 Q72 24 72 48 Q72 72 32 72" stroke={NAVY} strokeWidth="14" fill="none" strokeLinecap="round"/>
    <rect className="cp-shine" x="-20" y="-10" width="28" height="120" fill={WHITE} opacity=".15" clipPath="url(#c6clip)" transform="rotate(20)"/>
  </svg>
);

/* C7: Bars shifting — slide animation */
const C7 = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <style>{CORP_CSS}</style>
    <defs><clipPath id="c7clip"><rect width="100" height="100" rx="24"/></clipPath></defs>
    <rect width="100" height="100" rx="24" fill={NAVY}/>
    <rect className="cp-bar1" x="16" y="32" width="56" height="12" rx="6" fill={TEAL} clipPath="url(#c7clip)"/>
    <rect className="cp-bar2" x="28" y="56" width="56" height="12" rx="6" fill={WHITE} opacity=".9" clipPath="url(#c7clip)"/>
  </svg>
);

/* C8: Circle + arrow — ring pulses */
const C8 = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <style>{CORP_CSS}</style>
    <circle className="cp-ring" cx="50" cy="50" r="46" stroke={TEAL} strokeWidth="8" fill="none"/>
    <path d="M50 65 L50 35" stroke={TEAL} strokeWidth="9" strokeLinecap="round"/>
    <polyline points="36,48 50,34 64,48" fill="none" stroke={TEAL} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/* C9: CP monogram — C fades in/out subtly */
const C9 = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <style>{CORP_CSS}</style>
    <rect width="100" height="100" rx="24" fill={NAVY}/>
    <path className="cp-fade" d="M56 28 Q28 20 18 42 Q10 54 18 66 Q28 80 56 72" stroke={WHITE} strokeWidth="11" fill="none" strokeLinecap="round"/>
    <path d="M54 28 L54 72" stroke={TEAL} strokeWidth="11" strokeLinecap="round"/>
    <path d="M54 28 Q82 28 82 50 Q82 72 54 72" stroke={TEAL} strokeWidth="11" fill="none" strokeLinecap="round"/>
  </svg>
);

/* C10: Rhombus — breath on inner diamond */
const C10 = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <style>{CORP_CSS}</style>
    <rect width="100" height="100" rx="24" fill={TEAL}/>
    <path d="M50 12 L88 50 L50 88 L12 50 Z" fill="none" stroke={NAVY} strokeWidth="10" strokeLinejoin="round"/>
    <path className="cp-breath" d="M50 30 L70 50 L50 70 L30 50 Z" fill={NAVY}/>
  </svg>
);

const corporate = [
  { id:'C1',  M:C1,  name:'Hexágono partido',   ref:'Chainlink / Stripe',  bg:false },
  { id:'C2',  M:C2,  name:'C arco bold',         ref:'Monzo / Mercury',     bg:true  },
  { id:'C3',  M:C3,  name:'Cuadros superpuestos',ref:'Revolut / N26',       bg:true  },
  { id:'C4',  M:C4,  name:'Barra diagonal',       ref:'Cash App / Stripe',   bg:true  },
  { id:'C5',  M:C5,  name:'Picos Andes',          ref:'Exclusivo Lincoin',    bg:true  },
  { id:'C6',  M:C6,  name:'P lettermark',         ref:'Nubank style',        bg:true  },
  { id:'C7',  M:C7,  name:'Barras paralelas',     ref:'Brex / Linear',       bg:true  },
  { id:'C8',  M:C8,  name:'Círculo + flecha',     ref:'Clean / Universal',   bg:false },
  { id:'C9',  M:C9,  name:'CP monograma',         ref:'Exclusivo Lincoin',    bg:true  },
  { id:'C10', M:C10, name:'Rombo doble',          ref:'Precision fintech',   bg:true  },
];

export const LogoConcepts: React.FC = () => {
  const [sel, setSel] = useState<string | null>(null);
  const selItem = corporate.find(c => c.id === sel);

  return (
    <div style={{ minHeight:'100vh', background:'#0f172a', padding:'48px 16px 80px', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' }}>
      <div style={{ maxWidth:960, margin:'0 auto' }}>

        <div style={{ marginBottom:48 }}>
          <p style={{ color:TEAL, fontWeight:700, fontSize:12, letterSpacing:3, textTransform:'uppercase', marginBottom:8 }}>
            Identidad de Marca
          </p>
          <h1 style={{ fontSize:36, fontWeight:900, color:WHITE, margin:0, lineHeight:1.1 }}>
            LINCOIN — Isotipo
          </h1>
          <p style={{ color:'#64748b', fontSize:14, marginTop:8 }}>
            10 propuestas corporativas · Haz clic en la que te guste
          </p>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:16 }}>
          {corporate.map(({ id, M, name, ref }) => (
            <button key={id} onClick={() => setSel(id === sel ? null : id)} style={{
              background: sel === id ? '#0f2d25' : '#1e293b',
              border: `2px solid ${sel === id ? TEAL : 'transparent'}`,
              borderRadius:16, padding:'24px 20px', cursor:'pointer', textAlign:'left',
              transition:'all 0.15s', outline:'none',
              boxShadow: sel === id ? `0 0 0 1px ${TEAL}40, 0 8px 32px ${TEAL}20` : 'none',
            }}>
              {/* Dark preview — como se ve en sidebar */}
              <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:20 }}>
                <M size={52}/>
                <div>
                  <div style={{ color:WHITE, fontWeight:900, fontSize:22, letterSpacing:-0.5, lineHeight:1 }}>
                    CUY<span style={{ color:TEAL }}>PAY</span>
                  </div>
                  <div style={{ color:'rgba(255,255,255,0.3)', fontSize:9, letterSpacing:3, textTransform:'uppercase', marginTop:3 }}>
                    Business
                  </div>
                </div>
              </div>

              {/* Light preview — como se ve en header */}
              <div style={{ background:'#f8fafc', borderRadius:10, padding:'12px 14px', display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
                <M size={36}/>
                <div style={{ color:NAVY, fontWeight:900, fontSize:16, letterSpacing:-0.3 }}>
                  CUY<span style={{ color:TEAL }}>PAY</span>
                </div>
              </div>

              <div style={{ borderTop:'1px solid rgba(255,255,255,0.06)', paddingTop:14 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <p style={{ color:WHITE, fontWeight:700, fontSize:13, margin:'0 0 2px' }}>{name}</p>
                    <p style={{ color:'#475569', fontSize:11, margin:0 }}>Ref: {ref}</p>
                  </div>
                  {sel === id && (
                    <span style={{ background:TEAL, color:NAVY, fontWeight:800, fontSize:10, padding:'4px 10px', borderRadius:20, letterSpacing:.5 }}>
                      ELEGIDO
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>

        {sel && selItem && (
          <div style={{ marginTop:40, background:'#1e293b', border:`1px solid ${TEAL}40`, borderRadius:16, padding:28 }}>
            <p style={{ color:WHITE, fontWeight:700, fontSize:16, margin:'0 0 16px' }}>
              Vista previa — <span style={{ color:TEAL }}>{selItem.name}</span>
            </p>
            <div style={{ display:'flex', flexWrap:'wrap', gap:20 }}>
              {/* Solo isotipo */}
              <div style={{ background:'#0f172a', borderRadius:12, padding:20, display:'flex', alignItems:'center', gap:8 }}>
                <selItem.M size={40}/>
                <span style={{ color:'#475569', fontSize:11 }}>Solo isotipo</span>
              </div>
              {/* Navbar oscura */}
              <div style={{ background:NAVY, borderRadius:12, padding:'14px 20px', display:'flex', alignItems:'center', gap:12 }}>
                <selItem.M size={36}/>
                <span style={{ color:WHITE, fontWeight:900, fontSize:18, letterSpacing:-0.4 }}>CUY<span style={{color:TEAL}}>PAY</span></span>
              </div>
              {/* Navbar clara */}
              <div style={{ background:'white', borderRadius:12, padding:'14px 20px', display:'flex', alignItems:'center', gap:12 }}>
                <selItem.M size={36}/>
                <span style={{ color:NAVY, fontWeight:900, fontSize:18, letterSpacing:-0.4 }}>CUY<span style={{color:TEAL}}>PAY</span></span>
              </div>
              {/* Favicon */}
              <div style={{ background:'#0f172a', borderRadius:12, padding:20, display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
                <selItem.M size={24}/>
                <span style={{ color:'#475569', fontSize:11 }}>Favicon 24px</span>
              </div>
            </div>
            <p style={{ color:TEAL, fontWeight:700, fontSize:14, marginTop:20, marginBottom:0 }}>
              Dime "quiero el {sel}" y lo implemento en toda la app inmediatamente.
            </p>
          </div>
        )}

      </div>
    </div>
  );
};
