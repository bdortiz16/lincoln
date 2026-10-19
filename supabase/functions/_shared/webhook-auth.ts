// ════════════════════════════════════════════════════════
// webhook-auth — quién puede hacer que Lincoin mande correos.
//
// EL PROBLEMA QUE CIERRA
//   Las funciones que mandan correo (notify-transaction, notify-account-events,
//   notify-limit-increase, send-compliance-email) están pensadas para que las
//   llame un Database Webhook de Supabase, y se despliegan con --no-verify-jwt.
//   Pero NINGUNA comprobaba quién llamaba: bastaba conocer la URL —que viaja
//   en el bundle del navegador— y postear un `record` inventado para que
//   Lincoin le mandara a un cliente real un correo que parece nuestro:
//
//     · "Tu cuenta fue suspendida"      · "Tu PIN fue reseteado"
//     · "Se desactivó tu 2FA"           · "Tu envío fue rechazado"
//
//   Eso no roba plata por sí solo. Es peor de otra forma: es el material
//   perfecto para una estafa telefónica —el cliente recibe la alerta REAL de
//   nuestro dominio y después "soporte" lo llama—, sirve para enterrar una
//   alerta verdadera entre ruido, quema la cuota de envío, y permite
//   averiguar qué ids de usuario existen.
//
// CÓMO SE CIERRA
//   Se exige credencial, igual que finity-webhook (que ya lo hacía bien y es
//   el precedente que se sigue acá). Vale cualquiera de estas:
//     · Authorization: Bearer <SERVICE_ROLE_KEY>   ← lo que manda un Database
//       Webhook creado desde el panel de Supabase, y las llamadas internas.
//     · x-webhook-secret: <WEBHOOK_SECRET>  · o  ?secret=… en la URL.
//
//   FALLA CERRADO. Si no hay credencial válida, no se manda nada. Y cada
//   rechazo queda en auditoría con lo que llegó, para que un webhook legítimo
//   mal configurado se vea de inmediato en vez de convertirse en "los correos
//   dejaron de llegar y nadie sabe por qué".
// ════════════════════════════════════════════════════════

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// Se aceptan los dos nombres: WEBHOOK_KEY ya existe en este proyecto,
// así que no hace falta crear otro secreto.
const SECRETO = (Deno.env.get('WEBHOOK_SECRET') ?? Deno.env.get('WEBHOOK_KEY') ?? '').trim()

/** Comparación en tiempo constante: no filtra el secreto por lo que tarda. */
function igual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let dif = 0
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return dif === 0
}

export type ResultadoAuth = { ok: boolean; via: string; motivo?: string }

export function autorizarWebhook(req: Request): ResultadoAuth {
  const auth = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (SERVICE_KEY && igual(auth, SERVICE_KEY)) return { ok: true, via: 'service_role' }

  if (SECRETO) {
    // ?secret= en la URL se sigue aceptando porque los Database Webhooks del
    // panel pueden estar configurados así; preferir x-webhook-secret (la URL
    // queda en los logs de la plataforma). La comparación es en tiempo
    // constante en los tres casos.
    let enUrl = ''
    try { enUrl = new URL(req.url).searchParams.get('secret') ?? '' } catch { /* url rara */ }
    const candidatos = [enUrl, req.headers.get('x-webhook-secret') ?? '', auth]
      .map(v => v.trim()).filter(Boolean)
    if (candidatos.some(v => igual(v, SECRETO))) return { ok: true, via: 'webhook_secret' }
  }

  if (!SERVICE_KEY && !SECRETO) {
    return { ok: false, via: 'ninguna', motivo: 'no hay credencial configurada en el servidor' }
  }
  return { ok: false, via: 'ninguna', motivo: 'sin credencial válida' }
}

/**
 * Envuelve el chequeo: devuelve null si puede seguir, o la Response de rechazo.
 * Deja constancia del rechazo — un webhook legítimo mal configurado tiene que
 * verse, no desaparecer.
 */
// ¿Supabase acepta este token como llave de servicio? Se le pregunta a la
// API de administración de Auth, que solo responde a una llave de servicio
// (el JWT service_role de siempre o la nueva sb_secret_…). Así un webhook
// que manda la llave en el otro formato del que tiene la función no deja a
// los clientes sin correos, y nadie sin esa llave pasa: la valida Supabase.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const validadas = new Map<string, number>()
async function esLlaveDeServicio(token: string): Promise<boolean> {
  if (!token || token.length < 20 || !SUPABASE_URL) return false
  const hit = validadas.get(token)
  if (hit && Date.now() - hit < 10 * 60_000) return true
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { apikey: token, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    await r.body?.cancel()
    if (r.ok) { validadas.set(token, Date.now()); return true }
  } catch { /* sin respuesta: no se da por válida */ }
  return false
}

// Clave que genera la PROPIA base (private_config 'aviso_secret') y que
// mandan sus triggers y crons en x-webhook-secret. Así nadie tiene que copiar
// una llave a mano: la base la crea, la base la manda y la función la lee de
// la misma tabla (cerrada a anon y authenticated) para compararla.
let secretoBase: { v: string; at: number } | null = null
export async function secretoDeLaBase(db: any): Promise<string> {
  if (secretoBase && Date.now() - secretoBase.at < 5 * 60_000) return secretoBase.v
  try {
    const { data, error } = await db.from('private_config').select('value').eq('key', 'aviso_secret').maybeSingle()
    const v = String((data as any)?.value ?? '').trim()
    // Solo se guarda una lectura buena: un fallo pasajero de la base dejaba
    // la clave vacía en memoria y se rechazaban todos los avisos 5 minutos.
    if (!error && v) secretoBase = { v, at: Date.now() }
    return v
  } catch { return '' }
}
export async function traeSecretoDeLaBase(req: Request, db: any): Promise<boolean> {
  const enviado = (req.headers.get('x-webhook-secret') ?? '').trim()
  if (enviado.length < 32) return false
  const v = await secretoDeLaBase(db)
  return v.length >= 32 && igual(enviado, v)
}

export async function exigirWebhook(
  req: Request, fuente: string, db: any,
): Promise<Response | null> {
  let r = autorizarWebhook(req)
  if (!r.ok && await traeSecretoDeLaBase(req, db)) r = { ok: true, via: 'secreto_de_la_base' }
  if (!r.ok) {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
      || (req.headers.get('apikey') ?? '').trim()
    if (await esLlaveDeServicio(token)) r = { ok: true, via: 'service_key_validada' }
  }
  if (r.ok) return null
  try {
    await db.from('audit_log').insert({
      action: 'webhook.rechazado',
      metadata: {
        fuente, motivo: r.motivo ?? 'sin credencial',
        ip: (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null,
        userAgent: (req.headers.get('user-agent') ?? '').slice(0, 120),
        // Solo los NOMBRES de los encabezados: sirve para depurar la
        // configuración sin copiar credenciales a la auditoría.
        encabezados: [...req.headers.keys()].slice(0, 25),
      },
    })
  } catch { /* la auditoría nunca decide si se rechaza */ }
  return new Response(JSON.stringify({ error: 'unauthorized', message: 'Este endpoint requiere credencial de webhook.' }), {
    status: 401, headers: { 'Content-Type': 'application/json' },
  })
}
