// Reloj de inactividad.
//
// Un setTimeout no sirve para esto. El navegador congela los temporizadores de
// las pestañas de fondo —en el móvil, apenas se bloquea la pantalla—, así que
// el que iba a cerrar la sesión a los cinco minutos no dispara nunca. Y si se
// cierra la pestaña, ni siquiera existe: al volver, Supabase restaura la sesión
// y se entra como si nada hubiera pasado.
//
// Lo que sí funciona es guardar CUÁNDO fue la última actividad y comparar
// contra el reloj de verdad cada vez que hay ocasión: al abrir, al volver a la
// pestaña, y cada tanto. Es el mismo enfoque del panel de administración.
//
// La marca va ATADA a la sesión que la escribió. Sin eso, salir a las 10 y
// volver a entrar a las 12 encontraría una marca vieja de dos horas y cerraría
// la sesión recién abierta — imposible entrar.

const tokenOf = (): string | null => {
  try {
    const k = Object.keys(localStorage).find(x => x.startsWith('sb-') && x.endsWith('-auth-token'));
    if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) return d.access_token as string; }
  } catch { /* localStorage bloqueado */ }
  return null;
};

export const sesionActual = (): string => {
  try {
    const t = tokenOf();
    const p = t?.split('.')[1];
    if (!p) return '';
    const pad = p.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(pad + '='.repeat((4 - pad.length % 4) % 4)))?.session_id ?? '';
  } catch { return ''; }
};

export const leerVisto = (clave: string): number => {
  try {
    const d = JSON.parse(localStorage.getItem(clave) || '{}');
    if (!d?.t) return 0;
    if (String(d.s ?? '') !== sesionActual()) return 0;   // es de otra sesión: no cuenta
    return Number(d.t);
  } catch { return 0; }
};

export const guardarVisto = (clave: string, t: number) => {
  try { localStorage.setItem(clave, JSON.stringify({ s: sesionActual(), t })); } catch { /* */ }
};

export const olvidarVisto = (clave: string) => {
  try { localStorage.removeItem(clave); } catch { /* */ }
};
