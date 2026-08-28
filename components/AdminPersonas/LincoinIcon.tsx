import React from 'react';

const ARCHIVO = "'Archivo', system-ui, sans-serif";

/**
 * Ícono oficial de Lincoin: la marca tipográfica corta "L." — la letra L en
 * Archivo 800 + un PUNTO verde (tamaño de punto normal) a su derecha.
 *
 * Según la guía de marca: sin cuadro, sin círculo grande, sin "app icon".
 * `size` controla el tamaño de fuente en px.
 */
export const LincoinIcon: React.FC<{
    size?: number;
    withBackground?: boolean; // conservado por compatibilidad; ya no dibuja cuadro
    bgColor?: string;
    markColor?: string;
    className?: string;
    title?: string;
    textColor?: string;
}> = ({
    size = 32,
    markColor = '#4ADE80',
    className,
    title = 'Lincoin',
    textColor = '#F4F4F2',
}) => (
    <span
        role="img"
        aria-label={title}
        className={className}
        style={{
            fontFamily: ARCHIVO,
            fontWeight: 800,
            fontSize: size,
            letterSpacing: '-0.5px',
            color: textColor,
            lineHeight: 1,
            display: 'inline-block',
        }}
    >
        L<span style={{ color: markColor }}>.</span>
    </span>
);

// Alias compacto — misma marca "L." tipográfica.
export const LincoinMark: React.FC<{
    size?: number;
    color?: string;
    className?: string;
}> = ({ size = 24, color = '#4ADE80', className }) => (
    <LincoinIcon size={size} markColor={color} className={className} />
);
