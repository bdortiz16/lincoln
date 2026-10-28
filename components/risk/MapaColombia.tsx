// Mapa de calor de Colombia por departamento, en mosaico (cada departamento
// es una casilla en su posición aproximada). No necesita datos geográficos
// externos y se lee de un vistazo: más intensidad, más casos.
import React from 'react';

// [código DANE del departamento, sigla, columna, fila]
const CASILLAS: [string, string, number, number][] = [
  ['88', 'SAI', 0, 0], ['44', 'LAG', 4, 0],
  ['08', 'ATL', 2, 1], ['47', 'MAG', 3, 1], ['20', 'CES', 4, 1],
  ['23', 'COR', 1, 2], ['70', 'SUC', 2, 2], ['13', 'BOL', 3, 2], ['54', 'NSA', 4, 2],
  ['27', 'CHO', 0, 3], ['05', 'ANT', 1, 3], ['68', 'SAN', 2, 3], ['15', 'BOY', 3, 3], ['81', 'ARA', 4, 3],
  ['66', 'RIS', 0, 4], ['17', 'CAL', 1, 4], ['25', 'CUN', 2, 4], ['11', 'BOG', 3, 4], ['85', 'CAS', 4, 4], ['99', 'VIC', 5, 4],
  ['76', 'VAL', 0, 5], ['63', 'QUI', 1, 5], ['73', 'TOL', 2, 5], ['50', 'MET', 3, 5], ['94', 'GUA', 5, 5],
  ['19', 'CAU', 0, 6], ['41', 'HUI', 1, 6], ['95', 'GUV', 3, 6], ['97', 'VAU', 4, 6],
  ['52', 'NAR', 0, 7], ['86', 'PUT', 1, 7], ['18', 'CAQ', 2, 7],
  ['91', 'AMA', 3, 8],
];

export const MapaColombia: React.FC<{
  datos: Record<string, { valor: number; nombre: string; detalle?: string }>;
  color?: string;
  tam?: number;
}> = ({ datos, color = '74,222,128', tam = 30 }) => {
  const max = Math.max(1, ...Object.values(datos).map(d => (d as { valor: number }).valor));
  const gap = Math.round(tam * 0.13);
  return (
    <div style={{ position: 'relative', width: 6 * (tam + gap), height: 9 * (tam + gap) }}>
      {CASILLAS.map(([cod, sigla, c, r]) => {
        const d = datos[cod];
        const k = d ? 0.25 + 0.75 * (d.valor / max) : 0;
        return (
          <div key={cod} title={d ? `${d.nombre}: ${d.detalle ?? d.valor}` : sigla}
            style={{
              position: 'absolute', left: c * (tam + gap), top: r * (tam + gap), width: tam, height: tam, borderRadius: Math.round(tam * 0.22),
              display: 'grid', placeItems: 'center', fontSize: Math.max(8, Math.round(tam * 0.3)), fontWeight: 700, letterSpacing: '0.3px',
              background: d ? `rgba(${color},${k.toFixed(2)})` : 'rgba(255,255,255,0.04)',
              color: d ? (k > 0.55 ? '#0A0B0A' : '#F4F4F2') : 'rgba(244,244,242,0.32)',
              border: `1px solid ${d ? `rgba(${color},0.55)` : 'rgba(255,255,255,0.06)'}`,
              transition: 'background .3s',
            }}>
            {sigla}
          </div>
        );
      })}
    </div>
  );
};
