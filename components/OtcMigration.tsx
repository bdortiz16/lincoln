import React from 'react';

/**
 * Puente de migración OTC/dispersión: Finity fue eliminado. La conversión
 * (USD/USDT ↔ COP) y la dispersión Colombia (BreB/ACH) se están migrando a
 * Mouv. Este módulo reemplaza los símbolos que antes exportaba FinitySection
 * con stubs inertes + un placeholder, para que la app compile y las pantallas
 * degraden con elegancia hasta que Mouv esté cableado.
 */

// Stubs inertes (antes llamaban a la edge function finity-proxy, ya eliminada).
export async function callFinity(..._args: any[]): Promise<any> { return null; }
export async function fetchFinityBalance(..._args: any[]): Promise<any> { return null; }
export async function fetchFinityRateValue(..._args: any[]): Promise<number | null> { return null; }
export async function fetchFinityUsdCopConfig(..._args: any[]): Promise<any> { return null; }
export function extractRate(..._args: any[]): number | null { return null; }

// Placeholder que se muestra donde antes iba el convertidor/dispersión OTC.
export const FinitySection: React.FC<any> = () => (
  <div
    style={{
      background: '#0C0E0D',
      border: '1px solid rgba(255,255,255,0.10)',
      borderRadius: 20,
      padding: '40px 28px',
      textAlign: 'center',
      fontFamily: "'Archivo', system-ui, sans-serif",
      maxWidth: 560,
      margin: '24px auto',
    }}
  >
    <div
      style={{
        width: 56, height: 56, margin: '0 auto 16px', borderRadius: 16,
        background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.30)',
        display: 'grid', placeItems: 'center', fontSize: 24,
      }}
    >
      🔄
    </div>
    <h3 style={{ color: '#F4F4F2', fontWeight: 800, fontSize: 22, letterSpacing: '-0.5px', margin: '0 0 8px' }}>
      Conversión y dispersión — en migración a Mouv
    </h3>
    <p style={{ color: '#8F8F8A', fontSize: 14.5, lineHeight: 1.55, margin: 0 }}>
      Estamos moviendo el motor de conversión (USD/USDT ↔ COP) y la dispersión
      en Colombia (BreB · ACH) a <span style={{ color: '#4ADE80', fontWeight: 700 }}>Mouv</span>.
      Esta función estará disponible muy pronto.
    </p>
  </div>
);
