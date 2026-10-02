// Reenvía el webhook tal cual a la función de Supabase: mismo método,
// encabezados y cuerpo sin tocar (la firma del proveedor se verifica sobre
// el cuerpo crudo). Equivale a los rewrites de vercel.json.
const SUPABASE = 'https://wqleypebmfiaygrurnrc.supabase.co/functions/v1/';

export async function reenviar(request, funcion) {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.delete('host');
  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
  return fetch(SUPABASE + funcion + url.search, init);
}
