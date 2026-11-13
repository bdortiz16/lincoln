import React from 'react';
import { banderaExterior, paisDeCliente } from '../lib/banderaPais';

// Bandera del país de un cliente del exterior, ANTES de su nombre: en las
// listas el nombre largo se corta con "…" y una bandera puesta después se
// perdía. Nada para Colombia o sin país (ver lib/banderaPais.ts). El país
// completo va en el title: al pasar el mouse se lee "Brasil".
export const BanderaPais: React.FC<{ cliente: any; style?: React.CSSProperties }> = ({ cliente, style }) => {
  const pais = paisDeCliente(cliente);
  const b = banderaExterior(pais);
  if (!b) return null;
  return (
    <span title={pais ?? undefined} aria-label={pais ?? undefined} role="img"
      style={{ marginRight: 7, fontSize: '1.05em', lineHeight: 1, verticalAlign: '-0.08em', ...style }}>
      {b}
    </span>
  );
};
