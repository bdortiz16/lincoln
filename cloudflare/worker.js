// Worker de Cloudflare: reenvía los webhooks a Supabase (como los rewrites de
// vercel.json) y deja todo lo demás a los archivos estáticos de ./dist.
// El cuerpo va sin tocar: el proveedor firma sobre el cuerpo crudo.
const SUPABASE = 'https://wqleypebmfiaygrurnrc.supabase.co/functions/v1/';
const WEBHOOKS = { '/webhooks/gowd': 'gowd-webhook', '/webhooks/resend': 'resend-webhook' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Un /assets/ que no existe (de otra versión) NO puede responder con la
    // página: el navegador la guardaba un año como si fuera el código de la
    // app y la página quedaba rota en ese celular aunque se recargara.
    if (url.pathname.startsWith('/assets/')) {
      const res = await env.ASSETS.fetch(request);
      const tipo = res.headers.get('content-type') || '';
      if (res.status === 200 && tipo.includes('text/html')) {
        return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
      }
      if (!res.ok && res.status !== 304) {
        const h = new Headers(res.headers);
        h.set('cache-control', 'no-store');
        return new Response(res.body, { status: res.status, headers: h });
      }
      return res;
    }
    const funcion = WEBHOOKS[url.pathname];
    if (!funcion) return env.ASSETS.fetch(request);
    const headers = new Headers(request.headers);
    headers.delete('host');
    const init = { method: request.method, headers, redirect: 'manual' };
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
    return fetch(SUPABASE + funcion + url.search, init);
  },
};
