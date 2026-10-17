// ════════════════════════════════════════════════════════
// push — notificaciones al teléfono, con la app cerrada.
//
// Existe por la mesa: cuando entra un cierre OTC, cada minuto que pasa hasta
// que alguien lo ve es un minuto de tasa corriendo. La campana del panel solo
// suena si el panel está abierto; esto suena igual con el teléfono en el
// bolsillo.
//
// EN iOS SOLO FUNCIONA CON LA APP EN LA PANTALLA DE INICIO
//   Safari no entrega pushes a una pestaña. Hace falta Compartir → "Añadir a
//   pantalla de inicio" (iOS 16.4+). Además iOS suelta la suscripción sin
//   avisar si la app no se abre por semanas, y borrar el ícono la mata. Por
//   eso esto COMPLEMENTA al correo de aviso, no lo reemplaza: para plata, el
//   push no es una garantía de entrega.
//
// SIN LIBRERÍAS
//   El cifrado (RFC 8291, aes128gcm) y el VAPID (RFC 8292) están escritos acá
//   con Web Crypto. Es más código, pero es código que corre igual en Deno hoy
//   y mañana; las librerías de npm para esto arrastran módulos de Node y
//   fallan recién en producción, que es donde no se puede fallar.
//
// Secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY
//          VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (opcional)
// ════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const VAPID_PUB  = (Deno.env.get('VAPID_PUBLIC_KEY') ?? '').trim()
const VAPID_PRIV = (Deno.env.get('VAPID_PRIVATE_KEY') ?? '').trim()
// El "sub" del VAPID es a quién contactar si el servicio del navegador tiene
// un problema con nuestros envíos. Tiene que ser un contacto real.
const VAPID_SUB  = (Deno.env.get('VAPID_SUBJECT') ?? 'mailto:soporte@lincoin.me').trim()

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const PROJECT_REF = (() => { try { return new URL(SUPABASE_URL).hostname.split('.')[0] } catch { return '' } })()

// ─── Bytes y base64url ──────────────────────────────────
const utf8 = (s: string) => new TextEncoder().encode(s)

function b64url(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function desdeB64url(s: string): Uint8Array {
  const limpio = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = limpio + '='.repeat((4 - (limpio.length % 4)) % 4)
  const bin = atob(pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function unir(...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let i = 0
  for (const p of partes) { out.set(p, i); i += p.length }
  return out
}

async function hmac(clave: Uint8Array, dato: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', clave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, dato))
}

// HKDF con un solo bloque de salida: alcanza porque nada de acá pide más de 32
// bytes.
const derivar = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, largo: number) =>
  (await hmac(await hmac(salt, ikm), unir(info, new Uint8Array([1])))).slice(0, largo)

// ─── Cifrado del cuerpo (RFC 8291, aes128gcm) ───────────
async function cifrar(payload: string, p256dh: string, authSecret: string): Promise<Uint8Array> {
  const uaPub = desdeB64url(p256dh)          // 65 bytes, punto P-256 sin comprimir
  const uaAuth = desdeB64url(authSecret)     // 16 bytes

  const efimero = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', efimero.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const compartido = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, efimero.privateKey, 256))

  // El secreto compartido se mezcla con el "auth" del navegador antes de
  // derivar nada: sin ese paso, cualquiera que consiguiera el endpoint podría
  // armar un aviso válido.
  const ikm = await derivar(uaAuth, compartido, unir(utf8('WebPush: info'), new Uint8Array([0]), uaPub, asPub), 32)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek   = await derivar(salt, ikm, unir(utf8('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16)
  const nonce = await derivar(salt, ikm, unir(utf8('Content-Encoding: nonce'), new Uint8Array([0])), 12)

  // 0x02 = fin del último registro (delimitador de relleno del RFC 8188).
  const claro = unir(utf8(payload), new Uint8Array([2]))
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, claro))

  const rs = new Uint8Array(4)
  new DataView(rs.buffer).setUint32(0, 4096)
  return unir(salt, rs, new Uint8Array([asPub.length]), asPub, cifrado)
}

// ─── VAPID (RFC 8292) ───────────────────────────────────
let _firmante: CryptoKey | null = null

async function firmante(): Promise<CryptoKey> {
  if (_firmante) return _firmante
  const pub = desdeB64url(VAPID_PUB)
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY no es una clave P-256 sin comprimir')
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    d: VAPID_PRIV.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    x: b64url(pub.slice(1, 33)),
    y: b64url(pub.slice(33, 65)),
  }
  _firmante = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  return _firmante
}

async function autorizacion(endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin
  const cab = b64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  // 12 horas: el tope que aceptan los servicios de push es 24.
  const cuerpo = b64url(utf8(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUB })))
  const firma = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, await firmante(), utf8(`${cab}.${cuerpo}`)))
  return `vapid t=${cab}.${cuerpo}.${b64url(firma)}, k=${VAPID_PUB}`
}

// ─── Envío ──────────────────────────────────────────────
type Aviso = { titulo: string; cuerpo: string; url?: string; tag?: string; insistir?: boolean }

async function enviarA(sub: any, aviso: Aviso): Promise<{ ok: boolean; muerta?: boolean; estado?: number; error?: string }> {
  try {
    const cuerpo = await cifrar(JSON.stringify(aviso), sub.p256dh, sub.auth)
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        TTL: '900',                 // 15 min: un cierre viejo no se avisa tarde
        Urgency: 'high',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: await autorizacion(sub.endpoint),
      },
      body: cuerpo,
      signal: AbortSignal.timeout(10000),
    })
    if (r.ok) return { ok: true }
    // 404/410 = el navegador ya soltó esta suscripción. No es un error que se
    // reintente: la fila hay que borrarla o la bandeja se llena de aparatos
    // fantasma que fallan para siempre.
    if (r.status === 404 || r.status === 410) return { ok: false, muerta: true, estado: r.status }
    const txt = await r.text().catch(() => '')
    return { ok: false, estado: r.status, error: txt.slice(0, 300) }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) }
  }
}

async function avisar(subs: any[], aviso: Aviso): Promise<{ enviados: number; fallidos: number; muertas: number; detalle: any[] }> {
  let enviados = 0, fallidos = 0, muertas = 0
  const detalle: any[] = []
  for (const s of subs) {
    const r = await enviarA(s, aviso)
    if (r.ok) {
      enviados++
      await db.from('push_subs').update({ last_ok_at: new Date().toISOString(), fallos: 0 }).eq('id', s.id)
    } else if (r.muerta) {
      muertas++
      await db.from('push_subs').delete().eq('id', s.id)
      detalle.push({ id: s.id, estado: r.estado, baja: true })
    } else {
      fallidos++
      await db.from('push_subs').update({ fallos: (Number(s.fallos) || 0) + 1 }).eq('id', s.id)
      detalle.push({ id: s.id, estado: r.estado, error: r.error })
    }
  }
  return { enviados, fallidos, muertas, detalle }
}

// ─── Validacion del caller ──────────────────────────────
// Mismo patrón que otc-mesa:
//   0) service_role  → llamada interna
//   a) JWT real de Supabase → identidad PROBADA; admin si users.role='admin'
//   b) anon key + user_id existente → medio-auth, solo acciones propias
function isProjectAnonKey(jwt: string): boolean {
  if (ANON_KEY && jwt === ANON_KEY) return true
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const p = JSON.parse(atob(b64))
    const ref = String(p.ref ?? '') || String(p.iss ?? '')
    return p.role === 'anon' && (!PROJECT_REF || ref.includes(PROJECT_REF))
  } catch { return false }
}

type Caller = { ok: boolean; userId?: string; admin?: boolean; interna?: boolean }

async function validCaller(req: Request, payload: Record<string, unknown>): Promise<Caller> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return { ok: false }

  if (SERVICE_KEY && jwt === SERVICE_KEY) {
    return { ok: true, userId: String(payload.user_id ?? '') || undefined, admin: true, interna: true }
  }

  const { data } = await db.auth.getUser(jwt)
  if (data?.user) {
    const { data: prof } = await db.from('users').select('role').eq('id', data.user.id).maybeSingle()
    return { ok: true, userId: data.user.id, admin: String((prof as any)?.role ?? '') === 'admin' }
  }

  if (isProjectAnonKey(jwt)) {
    const uid = String(payload.user_id ?? '')
    if (!uid) return { ok: false }
    const { data: u } = await db.from('users').select('id').eq('id', uid).maybeSingle()
    if (u) return { ok: true, userId: uid }
  }
  return { ok: false }
}

// ════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const payload = await req.json().catch(() => ({})) as Record<string, any>
    const action = String(payload.action ?? '')
    if (!action) return json(400, { ok: false, error: 'falta action' })

    const caller = await validCaller(req, payload)
    if (!caller.ok) return json(401, { ok: false, error: 'unauthorized' })

    const configurado = !!(VAPID_PUB && VAPID_PRIV)

    // ── La clave pública que el navegador necesita para suscribirse ──
    if (action === 'clave') {
      return json(200, { ok: true, configurado, clave: configurado ? VAPID_PUB : null })
    }

    if (!configurado) {
      // Se dice qué falta en vez de "no se pudo": sin esto, un push que nunca
      // llega parece un problema del teléfono y se busca en el lugar
      // equivocado durante una hora.
      return json(503, { ok: false, error: 'push_sin_configurar', message: 'Faltan VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en los secretos del proyecto.' })
    }

    // ── Registrar un aparato ─────────────────────────────
    if (action === 'suscribir') {
      const uid = String(payload.user_id ?? caller.userId ?? '')
      if (!uid) return json(400, { ok: false, error: 'falta el usuario' })
      if (!caller.admin && uid !== String(caller.userId)) return json(403, { ok: false, error: 'no' })

      const sub = payload.sub ?? {}
      const endpoint = String(sub.endpoint ?? '')
      const p256dh = String(sub.keys?.p256dh ?? '')
      const auth = String(sub.keys?.auth ?? '')
      if (!endpoint || !p256dh || !auth) return json(400, { ok: false, error: 'suscripcion incompleta' })

      // onConflict en endpoint: volver a suscribir el mismo aparato devuelve el
      // mismo endpoint. Sin esto, cada visita agregaría una fila y el mismo
      // teléfono recibiría el aviso cinco veces.
      //
      // El user_id se pisa a propósito: si el aparato cambió de dueño (una
      // tablet compartida de la mesa), los avisos tienen que seguir al que
      // está adentro ahora.
      const { error } = await db.from('push_subs').upsert({
        user_id: uid, endpoint, p256dh, auth,
        ua: String(payload.ua ?? '').slice(0, 300) || null,
        fallos: 0,
      }, { onConflict: 'endpoint' })
      if (error) return json(500, { ok: false, error: error.message })
      return json(200, { ok: true })
    }

    // ── Dar de baja un aparato ───────────────────────────
    if (action === 'desuscribir') {
      const endpoint = String(payload.endpoint ?? '')
      if (!endpoint) return json(400, { ok: false, error: 'falta endpoint' })
      let q = db.from('push_subs').delete().eq('endpoint', endpoint)
      if (!caller.admin) q = q.eq('user_id', String(caller.userId ?? ''))
      const { error } = await q
      if (error) return json(500, { ok: false, error: error.message })
      return json(200, { ok: true })
    }

    // ── Prueba: avisarse a uno mismo ─────────────────────
    if (action === 'probar') {
      const uid = String(payload.user_id ?? caller.userId ?? '')
      if (!uid) return json(400, { ok: false, error: 'falta el usuario' })
      if (!caller.admin && uid !== String(caller.userId)) return json(403, { ok: false, error: 'no' })
      const { data: subs } = await db.from('push_subs').select('*').eq('user_id', uid)
      if (!subs?.length) return json(200, { ok: false, error: 'sin_aparatos', message: 'Este usuario no tiene ningún aparato registrado.' })
      const r = await avisar(subs, {
        titulo: 'Lincoin',
        cuerpo: 'Prueba de notificación. Si ves esto, los avisos están funcionando.',
        url: '/', tag: 'prueba',
      })
      return json(200, { ok: r.enviados > 0, ...r })
    }

    // ── Enviar (solo interno) ────────────────────────────
    // Lo llama otc-mesa cuando entra un cierre. No se abre a la sesión de un
    // admin: mandar notificaciones al teléfono de otro no es algo que deba
    // poder dispararse desde una pantalla.
    if (action === 'enviar') {
      if (!caller.interna) return json(403, { ok: false, error: 'solo interno' })

      let ids: string[] = Array.isArray(payload.user_ids) ? payload.user_ids.map(String) : []
      if (String(payload.rol ?? '') === 'admin') {
        const { data: admins } = await db.from('users').select('id').eq('role', 'admin')
        ids = ids.concat((admins ?? []).map((u: any) => String(u.id)))
      }
      ids = [...new Set(ids.filter(Boolean))]
      if (!ids.length) return json(200, { ok: true, enviados: 0, fallidos: 0, muertas: 0, motivo: 'sin destinatarios' })

      const { data: subs } = await db.from('push_subs').select('*').in('user_id', ids)
      if (!subs?.length) return json(200, { ok: true, enviados: 0, fallidos: 0, muertas: 0, motivo: 'sin aparatos' })

      const r = await avisar(subs, {
        titulo: String(payload.titulo ?? 'Lincoin').slice(0, 120),
        cuerpo: String(payload.cuerpo ?? '').slice(0, 300),
        url: String(payload.url ?? '/'),
        tag: String(payload.tag ?? 'lincoin'),
        insistir: !!payload.insistir,
      })
      return json(200, { ok: true, ...r })
    }

    return json(400, { ok: false, error: `accion desconocida: ${action}` })
  } catch (e) {
    return json(500, { ok: false, error: String((e as Error)?.message ?? e) })
  }
})
