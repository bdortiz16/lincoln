// ════════════════════════════════════════════════════════
// delete-self — RETIRADA.
//
// Borraba la propia cuenta con solo un ingreso reciente (contraseña), sin el
// segundo factor: con la contraseña de una empresa con 2FA se le borraba el
// perfil y la cuenta de acceso. La app ya no la usa: borrar la propia cuenta
// va por admin-data `delete_self`, que exige el 2FA en el servidor y no borra
// una cuenta con saldo.
//
// Se deja respondiendo 410 (como admin-login) en vez de borrarla del
// despliegue: una función que ya no está en FUNCTIONS seguiría desplegada con
// su código viejo, y esta no puede quedar viva.
// ════════════════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  return new Response(JSON.stringify({ error: 'retirada', message: 'Esta función ya no se usa. Para borrar tu cuenta, hazlo desde Ajustes.' }), {
    status: 410, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
