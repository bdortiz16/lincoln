// Worker de Cloudflare: reenvía los webhooks a Supabase (como los rewrites de
// vercel.json) y deja todo lo demás a los archivos estáticos de ./dist.
// El cuerpo va sin tocar: el proveedor firma sobre el cuerpo crudo.
const SUPABASE = 'https://wqleypebmfiaygrurnrc.supabase.co/functions/v1/';
const WEBHOOKS = { '/webhooks/gowd': 'gowd-webhook', '/webhooks/resend': 'resend-webhook' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const funcion = WEBHOOKS[url.pathname];
    if (!funcion) return env.ASSETS.fetch(request);
    const headers = new Headers(request.headers);
    headers.delete('host');
    const init = { method: request.method, headers, redirect: 'manual' };
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
    return fetch(SUPABASE + funcion + url.search, init);
  },
};
