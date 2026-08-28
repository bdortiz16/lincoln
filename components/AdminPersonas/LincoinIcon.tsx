import React from 'react';

/**
 * Ícono oficial de Lincoin.
 *
 * Hecho como SVG inline para que sea crisp a cualquier tamaño y no
 * necesite request HTTP extra.
 *
 * Composición:
 *  - Fondo: rounded-square navy (#0F172A)
 *  - Símbolo: rounded-square outline teal (#2DD4BF) con dot teal
 *    a la derecha — la marca de Lincoin
 *
 * Props:
 *  - size: tamaño en px (default 32)
 *  - withBackground: si false, dibuja solo el símbolo teal (para
 *    cuando va sobre un fondo navy ya existente). Default true.
 *  - bgColor / markColor: override de colores
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
    bgColor = '#0F172A',
    markColor = '#2DD4BF',
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
            // Fondo: rounded-square navy con esquinas redondeadas estilo iOS
            <rect x="2" y="2" width="96" height="96" rx="22" fill={bgColor} />
        )}

        {/* Símbolo principal: rounded-square outline */}
        <rect
            x="22"
            y="22"
            width="56"
            height="56"
            rx="16"
            fill="none"
            stroke={markColor}
            strokeWidth="7"
            strokeLinejoin="round"
        />

        {/* Dot DENTRO del rounded-square — derecha-abajo.
            La clase cuypay-dot lo hace caer desde arriba con rebote al cargar
            y luego pulsa lento para mantenerse "vivo". */}
        <circle cx="58" cy="56" r="8" fill={markColor} className="cuypay-dot" />
    </svg>
);

// Variante compacta sin fondo — útil cuando ya hay un container con
// el color navy y solo queremos el símbolo teal encima.
export const LincoinMark: React.FC<{
    size?: number;
    color?: string;
    className?: string;
}> = ({ size = 24, color = '#2DD4BF', className }) => (
    <LincoinIcon size={size} withBackground={false} markColor={color} className={className} />
);
