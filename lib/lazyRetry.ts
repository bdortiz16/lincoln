import React from 'react';

// Carga diferida de un panel con reintentos. Los paneles se descargan solo
// cuando se abren: el archivo único de 3 MB no alcanzaba a llegar en redes
// lentas (la conexión se cortaba a medias y la página quedaba en negro).
// Si un pedazo falla, se reintenta dos veces; si sigue fallando, se recarga
// la página una sola vez (puede ser un despliegue nuevo con otros nombres
// de archivo). Una segunda falla ya se muestra como error.
const MARCA = 'lc_chunk_reload';

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

async function conReintentos<T>(cargar: () => Promise<T>): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const m = await cargar();
      try { sessionStorage.removeItem(MARCA); } catch { /* */ }
      return m;
    } catch (e) {
      ultimo = e;
      await esperar(1200 * (i + 1));
    }
  }
  let yaRecargo = false;
  try { yaRecargo = sessionStorage.getItem(MARCA) === '1'; } catch { /* */ }
  if (!yaRecargo) {
    try { sessionStorage.setItem(MARCA, '1'); } catch { /* */ }
    window.location.reload();
    return new Promise<T>(() => { /* la página se está recargando */ });
  }
  throw ultimo;
}

export function lazyNamed<M extends Record<string, any>, K extends keyof M>(cargar: () => Promise<M>, nombre: K): React.LazyExoticComponent<M[K]> {
  return React.lazy(() => conReintentos(cargar).then(m => ({ default: m[nombre] })));
}
