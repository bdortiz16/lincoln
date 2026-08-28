import React from 'react';

/**
 * Ícono oficial de Lincoin ("L.").
 *
 * SVG inline (crisp a cualquier tamaño, sin request HTTP extra).
 * Composición:
 *  - Fondo: rounded-square oscuro (#0a0a0a) estilo iOS
 *  - "L" blanca + punto verde (#4ADE80) a la derecha — la marca de Lincoin
 *
 * Props:
 *  - size: tamaño en px (default 32)
 *  - withBackground: si false, dibuja solo la "L." (sin el cuadro). Default true.
 *  - bgColor / markColor: override de colores (markColor = color del punto)
 */
export const LincoinIcon: React.FC<{
    size?: number;
    withBackground?: boolean;
    bgColor?: string;
    markColor?: string;
    className?: string;
    title?: string;
}> = ({
    size = 32,
    withBackground = true,
    bgColor = '#0a0a0a',
    markColor = '#4ADE80',
    className,
    title = 'Lincoin',
}) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className={className}
        role="img"
        aria-label={title}
    >
        <title>{title}</title>

        {withBackground && (
            <rect x="2" y="2" width="96" height="96" rx="24" fill={bgColor} />
        )}

        {/* "L" blanca (blocky) */}
        <path d="M34 30 H47 V58 H58 V71 H34 Z" fill={withBackground ? '#F4F4F2' : markColor} />

        {/* Punto verde — la clase lincoin-dot lo hace caer con rebote al cargar. */}
        <circle cx="68" cy="67" r="12" fill={markColor} className="lincoin-dot" />
    </svg>
);

// Variante compacta sin fondo — solo la "L." sobre un container ya oscuro.
export const LincoinMark: React.FC<{
    size?: number;
    color?: string;
    className?: string;
}> = ({ size = 24, color = '#4ADE80', className }) => (
    <LincoinIcon size={size} withBackground={false} markColor={color} className={className} />
);
