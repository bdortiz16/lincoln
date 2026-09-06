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
// Se aceptan los dos nombres: WEBHOOK_KEY ya existe en este proyecto
// (didit-aml-monitor lo usa), así que no hace falta crear otro secreto.
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
export async function exigirWebhook(
  req: Request, fuente: string, db: any,
): Promise<Response | null> {
  const r = autorizarWebhook(req)
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
