// Mapa de calor de Colombia por departamento, con la forma real de cada uno
// (Marco Geoestadístico del DANE; ver scripts/mapa-colombia.mjs) y San
// Andrés y Providencia en su recuadro. Antes era un mosaico de casillas: se
// leía, pero no parecía Colombia (pedido del dueño, 2026-11).
//
// Más intensidad, más casos. El que tiene datos se puede señalar: muestra
// el nombre y el detalle. Los trazos ya vienen proyectados: no hace falta
// d3 en el navegador.
import React, { useId, useMemo, useState } from 'react';
import { DEPARTAMENTOS, ISLAS, MAPA_ANCHO, MAPA_ALTO } from './colombiaMapa';

type Dato = { valor: number; nombre: string; detalle?: string };

export const MapaColombia: React.FC<{
  datos: Record<string, Dato>;
  color?: string;          // "r,g,b"
  tam?: number;            // escala: el ancho es tam × 8,5 px
}> = ({ datos, color = '74,222,128', tam = 30 }) => {
  const [foco, setFoco] = useState<{ cod: string; x: number; y: number } | null>(null);
  // Dos mapas en la misma página (el general y el de una consulta) no
  // pueden compartir el id del filtro.
  const brillo = `mc-brillo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const max = Math.max(1, ...(Object.values(datos) as Dato[]).map(d => d.valor));
  const ancho = Math.round(tam * 8.5);
  const relleno = (cod: string) => {
    const d = datos[cod];
    if (!d) return 'rgba(255,255,255,0.045)';
    const k = 0.28 + 0.72 * (d.valor / max);
    return `rgba(${color},${k.toFixed(2)})`;
  };
  const nombreDe = useMemo<Record<string, string>>(() => Object.fromEntries([...DEPARTAMENTOS.map(x => [x.cod, x.nombre]), [ISLAS.cod, 'San Andrés y Providencia']]), []);
  const mover = (cod: string) => (e: React.MouseEvent<SVGElement>) => {
    const caja = (e.currentTarget.ownerSVGElement ?? (e.currentTarget as unknown as SVGSVGElement)).getBoundingClientRect();
    setFoco({ cod, x: e.clientX - caja.left, y: e.clientY - caja.top });
  };
  const trazo = (cod: string) => foco?.cod === cod ? '#F4F4F2' : datos[cod] ? `rgba(${color},0.9)` : 'rgba(255,255,255,0.13)';
  const d = foco ? datos[foco.cod] : null;
  // Los que tienen datos se dibujan al final: su borde queda encima del de
  // los vecinos.
  const orden = [...DEPARTAMENTOS].sort((a, b) => Number(!!datos[a.cod]) - Number(!!datos[b.cod]) || Number(foco?.cod === a.cod) - Number(foco?.cod === b.cod));
  return (
    <div style={{ position: 'relative', width: ancho, maxWidth: '100%' }} onMouseLeave={() => setFoco(null)}>
      <svg viewBox={`0 0 ${MAPA_ANCHO} ${MAPA_ALTO}`} width="100%" role="img" aria-label="Mapa de Colombia por departamento" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <filter id={brillo} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {orden.map(dep => (
          <path key={dep.cod} d={dep.d} fill={relleno(dep.cod)} stroke={trazo(dep.cod)} strokeWidth={foco?.cod === dep.cod ? 1.4 : 0.6} strokeLinejoin="round"
            filter={datos[dep.cod] ? `url(#${brillo})` : undefined}
            onMouseMove={mover(dep.cod)} style={{ cursor: 'default', transition: 'fill .3s' }}>
            <title>{datos[dep.cod] ? `${datos[dep.cod].nombre}: ${datos[dep.cod].detalle ?? datos[dep.cod].valor}` : dep.nombre}</title>
          </path>
        ))}
        {/* San Andrés y Providencia, en su recuadro sobre el Caribe. */}
        <g onMouseMove={mover(ISLAS.cod)}>
          <rect x={ISLAS.caja.x} y={ISLAS.caja.y} width={ISLAS.caja.w} height={ISLAS.caja.h} rx={8} fill="rgba(255,255,255,0.02)" stroke={foco?.cod === ISLAS.cod ? '#F4F4F2' : 'rgba(255,255,255,0.14)'} strokeWidth={0.8} />
          {ISLAS.trazos.map(t => (
            <path key={t.nombre} d={t.d} fill={relleno(ISLAS.cod)} stroke={trazo(ISLAS.cod)} strokeWidth={0.6} filter={datos[ISLAS.cod] ? `url(#${brillo})` : undefined}>
              <title>{datos[ISLAS.cod] ? `${datos[ISLAS.cod].nombre}: ${datos[ISLAS.cod].detalle ?? datos[ISLAS.cod].valor}` : t.nombre}</title>
            </path>
          ))}
          <text x={ISLAS.caja.x + ISLAS.caja.w / 2} y={ISLAS.caja.y + ISLAS.caja.h - 12} textAnchor="middle" fontSize="6" fontWeight={600} fill="rgba(244,244,242,0.5)" style={{ fontFamily: 'Archivo, system-ui, sans-serif' }}>
            <tspan x={ISLAS.caja.x + ISLAS.caja.w / 2}>San Andrés</tspan>
            <tspan x={ISLAS.caja.x + ISLAS.caja.w / 2} dy="7">y Providencia</tspan>
          </text>
        </g>
        {/* Un punto que late en cada departamento con registros: Bogotá o
            el Atlántico, pequeños a esta escala, no se perdían de vista. */}
        <style>{'@keyframes mc-late { 0% { transform: scale(1); opacity: .55 } 100% { transform: scale(2.6); opacity: 0 } } .mc-late { transform-box: fill-box; transform-origin: center; animation: mc-late 2.2s ease-out infinite } @media (prefers-reduced-motion: reduce) { .mc-late { animation: none; opacity: 0 } }'}</style>
        {DEPARTAMENTOS.filter(dep => datos[dep.cod]).map(dep => {
          const r = 2.2 + 2.6 * (datos[dep.cod].valor / max);
          return (
            <g key={`p${dep.cod}`} pointerEvents="none">
              <circle className="mc-late" cx={dep.cx} cy={dep.cy} r={r} fill={`rgb(${color})`} />
              <circle cx={dep.cx} cy={dep.cy} r={r} fill="#F4F4F2" stroke={`rgb(${color})`} strokeWidth={1.4} />
            </g>
          );
        })}
      </svg>
      {/* Leyenda: de menos a más. */}
      {Object.keys(datos).length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 10.5, color: 'rgba(244,244,242,0.5)', fontFamily: 'Archivo, system-ui, sans-serif' }}>
          <span>Menos</span>
          <span style={{ flex: 1, maxWidth: 120, height: 6, borderRadius: 999, background: `linear-gradient(90deg, rgba(${color},0.28), rgba(${color},1))` }} />
          <span>Más</span>
        </div>
      )}
      {foco && (
        <div style={{ position: 'absolute', left: Math.min(foco.x + 12, ancho - 150), top: Math.max(0, foco.y - 44), pointerEvents: 'none', background: '#121413', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, padding: '6px 9px', boxShadow: '0 6px 18px rgba(0,0,0,0.45)', minWidth: 120, maxWidth: 200, zIndex: 2 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#F4F4F2' }}>{d?.nombre ?? nombreDe[foco.cod]}</span>
          <span style={{ display: 'block', fontSize: 11, color: d ? `rgb(${color})` : 'rgba(244,244,242,0.45)', marginTop: 1 }}>{d ? (d.detalle ?? String(d.valor)) : 'Sin registros'}</span>
        </div>
      )}
    </div>
  );
};
