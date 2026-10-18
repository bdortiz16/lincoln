// ══════════════════════════════════════════════════════════════════
//  admin-login — RETIRADO
//
//  Verificaba la contraseña del panel por fuera de Supabase Auth, contra un
//  hash SHA-256 con sal fija guardado en raw_data. Un intento fallido no
//  sumaba al freno de fuerza bruta, y al acertar devolvía el perfil entero con
//  raw_data (hash del código del correo, material del 2FA). La pantalla ya no
//  lo usa: el panel entra con la cuenta real de Supabase Auth y el 2FA lo
//  verifica admin-data.
//
//  Se deja respondiendo 410 (en vez de borrar la carpeta) porque el deploy
//  publica las funciones que existen y no da de baja las que faltan: sin este
//  archivo seguiría corriendo la versión vieja.
// ══════════════════════════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  return new Response(JSON.stringify({ error: 'gone', message: 'Este ingreso ya no está disponible. Entra con tu cuenta desde la pantalla de inicio.' }), {
    status: 410, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
