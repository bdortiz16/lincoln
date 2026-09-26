// Llamador a las edge functions.
//
// Vivía copiado dentro de ContactsSection y, al volver a escribirlo en el
// dashboard, se me olvidó lo importante: mandar el TOKEN DE SESIÓN. Con solo
// la llave anónima el servidor no sabe quién llama y rechaza todo lo que es
// de un usuario — la consulta de antecedentes volvía vacía y un beneficiario
// bloqueado aparecía en verde. Por eso ahora está en un solo lugar.
export async function llamarFuncion(nombre: string, cuerpo: Record<string, unknown>, msTimeout = 45000): Promise<any> {
  const SURL = (import.meta as any).env?.VITE_SUPABASE_URL || '';
  const SKEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';
  let auth = `Bearer ${SKEY}`;
  try {
    const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
    if (k) { const d = JSON.parse(localStorage.getItem(k) || '{}'); if (d.access_token) auth = `Bearer ${d.access_token}`; }
  } catch { /* sin sesión */ }
  try {
    const r = await fetch(`${SURL}/functions/v1/${nombre}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: auth },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(msTimeout),
    });
    return await r.json();
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}
