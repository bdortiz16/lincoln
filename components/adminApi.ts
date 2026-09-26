// Llamada a admin-data con la sesión real del admin.
//
// Vive en su propio archivo porque la usan varias secciones del panel y
// repetir el armado del encabezado en cada una es cómo terminan algunas
// mandando la llave pública en vez de la sesión — y fallando con un error que
// no explica nada.
export async function pedirAdmin(body: any): Promise<any> {
  const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
  const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
  let jwt: string | null = null;
  try {
    const k = Object.keys(localStorage).find((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
    if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) jwt = d.access_token; }
  } catch { /* sin sesión, va con la anon y el servidor la rechaza, que es lo correcto */ }
  const r = await fetch(`${SURL}/functions/v1/admin-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: jwt ? `Bearer ${jwt}` : `Bearer ${SKEY}` },
    body: JSON.stringify(body),
  });
  return r.json();
}

export const ROLES: { id: string; nombre: string; que: string }[] = [
  { id: 'dueno',        nombre: 'Dueño',        que: 'Todo, en todos los países. Es el único que administra el equipo, la configuración y la seguridad.' },
  { id: 'operaciones',  nombre: 'Operaciones',  que: 'Cargues, mesa OTC, tesorería, movimientos, fallos y tasas. Mueve plata.' },
  { id: 'cumplimiento', nombre: 'Cumplimiento', que: 'KYC, riesgo, monitoreo y auditoría. Ve la plata, no la mueve.' },
  { id: 'lectura',      nombre: 'Solo lectura', que: 'Mira y no escribe nada, en ningún lado.' },
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
