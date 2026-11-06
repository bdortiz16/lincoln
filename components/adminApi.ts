import { conCodigo2fa } from '../lib/codigo2fa';

// Llamada a admin-data con la sesión real del admin.
//
// Vive en su propio archivo porque la usan varias secciones del panel y
// repetir el armado del encabezado en cada una es cómo terminan algunas
// mandando la llave pública en vez de la sesión — y fallando con un error que
// no explica nada.
//
// Si el servidor exige el código 2FA para ESTA operación (pideCodigo), se le
// pide a la persona y se repite la misma llamada con él (lib/codigo2fa.ts).
export function pedirAdmin(body: any): Promise<any> {
  return conCodigo2fa((otp) => pedirAdminUnaVez(otp ? { ...body, otp } : body));
}

async function pedirAdminUnaVez(body: any): Promise<any> {
  const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
  const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
  let jwt: string | null = null;
  try {
    const k = Object.keys(localStorage).find((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
    if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; }
  } catch { /* sin sesión, va con la anon y el servidor la rechaza, que es lo correcto */ }
  // El motivo no se puede perder en el camino: si la respuesta no es JSON (la
  // plataforma cortó, la función no arrancó) se devuelve un `error` legible,
  // y si el servidor mandó el motivo en `message`/`msg` se copia a `error`,
  // que es lo que leen las pantallas.
  let r: Response;
  try {
    r = await fetch(`${SURL}/functions/v1/admin-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}` },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    return { ok: false, error: 'No se pudo contactar el servidor. Revisa la conexión.' };
  }
  const t = await r.text().catch(() => '');
  let d: any = null;
  try { d = t ? JSON.parse(t) : null; } catch { d = null; }
  if (!d || typeof d !== 'object') return { ok: false, error: `El servidor respondió sin detalle (HTTP ${r.status}).` };
  if (!r.ok && !d.error && (d.message || d.msg)) d.error = d.message || d.msg;
  return d;
}

// Llamada a la función `autorizaciones` (operadores: los clientes de
// nuestros clientes) con la sesión del admin.
export async function pedirAutorizaciones(body: Record<string, unknown>): Promise<any> {
  const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
  const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
  let jwt: string | null = null;
  try {
    const k = Object.keys(localStorage).find((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
    if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; }
  } catch { /* sin sesión */ }
  try {
    const r = await fetch(`${SURL}/functions/v1/autorizaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    const t = await r.text();
    if (!t) return { ok: false, error: `El servicio no respondió (HTTP ${r.status}).` };
    try { return JSON.parse(t); } catch { return { ok: false, error: `Respuesta no válida (HTTP ${r.status}).` }; }
  } catch (e: any) {
    return { ok: false, error: e?.name === 'TimeoutError' ? 'El servicio tardó demasiado en responder.' : 'No se pudo contactar el servicio.' };
  }
}

// Llamada a la función `gowd` (cuentas en Brasil) con la sesión del admin.
export async function pedirGowd(body: Record<string, unknown>): Promise<any> {
  const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
  const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
  let jwt: string | null = null;
  try {
    const k = Object.keys(localStorage).find((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
    if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; }
  } catch { /* sin sesión */ }
  try {
    const r = await fetch(`${SURL}/functions/v1/gowd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    const t = await r.text();
    if (!t) return { ok: false, error: `El servicio no respondió (HTTP ${r.status}).` };
    try { return JSON.parse(t); } catch { return { ok: false, error: r.status === 404 ? 'La función de Brasil todavía no está desplegada.' : `Respuesta no válida (HTTP ${r.status}).` }; }
  } catch (e: any) {
    return { ok: false, error: e?.name === 'TimeoutError' ? 'El servicio tardó demasiado en responder.' : 'No se pudo contactar el servicio.' };
  }
}

export const ROLES: { id: string; nombre: string; que: string }[] = [
  { id: 'dueno',        nombre: 'Dueño',        que: 'Todo, en todos los países. Es el único que administra el equipo, la configuración y la seguridad.' },
  { id: 'operaciones',  nombre: 'Operaciones',  que: 'Cargues, mesa OTC, tesorería, movimientos, fallos y tasas. Mueve plata.' },
  { id: 'cumplimiento', nombre: 'Cumplimiento', que: 'KYC, riesgo, monitoreo y auditoría. Ve la plata, no la mueve.' },
  { id: 'lectura',      nombre: 'Solo lectura', que: 'Mira y no escribe nada, en ningún lado.' },
  { id: 'tesoreria',    nombre: 'Tesorería y clientes', que: 'Solo Tesorería (aprobar cargues y retiros, traslados a ACH, Billeteras COP) y Clientes. Nada de OTC, tasas, cumplimiento ni configuración.' },
  { id: 'colaborador',  nombre: 'Colaborador', que: 'Solo las secciones que marques. Entra por lincoin.me/colaboradores con 2FA obligatorio.' },
];

// Las casillas del colaborador: una por sección del panel. Tienen que ser
// las mismas de FUNCIONES_VALIDAS en supabase/functions/_shared/equipo.ts
// (el servidor ignora cualquier otra). Seguridad y Configuración no están:
// siguen siendo del dueño.
export const FUNCIONES: { id: string; nombre: string; que: string }[] = [
  { id: 'dashboard',    nombre: 'Dashboard',    que: 'La vista general: cifras y movimientos del día.' },
  { id: 'clientes',     nombre: 'Clientes',     que: 'Ver y editar clientes.' },
  { id: 'billetera',    nombre: 'Billetera',    que: 'Registrar cargues y descuentos en los saldos de los clientes.' },
  { id: 'tesoreria',    nombre: 'Tesorería',    que: 'Aprobar cargues y retiros, traslados y la caja.' },
  { id: 'lincoin',      nombre: 'Lincoin',      que: 'Utilidades y movimientos de Lincoin.' },
  { id: 'otc',          nombre: 'Cierres OTC',  que: 'La mesa OTC: cierres con los clientes.' },
  { id: 'coinsenda',    nombre: 'Coinsenda',    que: 'Tablero y envíos de las cuentas 3 y 4. La conexión la sigue manejando el dueño.' },
  { id: 'fallos',       nombre: 'Fallos',       que: 'Envíos con problema y su conciliación.' },
  { id: 'reportes',     nombre: 'Reportes',     que: 'Reportes y descargas.' },
  { id: 'contabilidad', nombre: 'Contabilidad', que: 'Tablero contable y facturación.' },
  { id: 'cumplimiento', nombre: 'Cumplimiento', que: 'KYC, operadores, cupos y riesgo.' },
];

export const PAISES: { code: string; nombre: string }[] = [
  { code: 'CO', nombre: 'Colombia' },
  { code: 'US', nombre: 'Estados Unidos' },
  { code: 'MX', nombre: 'México' },
  { code: 'BR', nombre: 'Brasil' },
];

// Llamada a mouv-proxy. Con timeout y sin promesas sueltas: un corte de red
// dejaba el botón en gris para siempre y sin un mensaje que dijera qué pasó.
export async function pedirMouv(cuerpo: Record<string, unknown>): Promise<any> {
  const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
  const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
  let jwt: string | null = null;
  try {
    const k = Object.keys(localStorage).find((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
    if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; }
  } catch { /* sin sesión */ }
  try {
    const r = await fetch(`${SURL}/functions/v1/mouv-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}` },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(90000),
    });
    const t = await r.text();
    if (!t) return { ok: false, message: 'El servicio no respondió.' };
    try { return JSON.parse(t); } catch { return { ok: false, message: `Respuesta no válida (HTTP ${r.status}).` }; }
  } catch (e: any) {
    return {
      ok: false,
      message: e?.name === 'TimeoutError'
        ? 'El proveedor tardó demasiado. No se cambió nada.'
        : `No se pudo conectar: ${String(e?.message ?? e)}`,
    };
  }
}
