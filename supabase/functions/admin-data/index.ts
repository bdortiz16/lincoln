import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ADMIN_EMAIL   = Deno.env.get('ADMIN_EMAIL')               ?? 'admin@lincoin.com'

// Service-role client: bypasses RLS on all queries
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Los comprobantes de depósito viajan como imágenes base64 dentro de
// raw_data (varios MB cada uno). Mandarlos en el listado hacía que el
// admin tardara/agotara el timeout. Se reemplazan por un marcador y el
// panel los pide uno a uno con action=get_tx_proof al abrir el detalle.
const PROOF_MARKER = '__stored__'
function slimRawData(rd: unknown, limit = 2000): unknown {
  if (!rd || typeof rd !== 'object') return rd
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rd as Record<string, unknown>)) {
    out[k] = (typeof v === 'string' && (v.startsWith('data:') || v.length > limit)) ? PROOF_MARKER : v
  }
  return out
}

// ── Cifrado de campos sensibles a nivel de APLICACIÓN (además del AES-256
//    en reposo de la base). AES-256-GCM con llave derivada de FIELD_ENC_KEY
//    (secret del servidor, nunca en la base ni en el cliente). Prefijo
//    'enc:v1:' distingue cifrado de texto plano legacy. Sin la llave, no
//    cifra (no rompe) y descifrar plano devuelve el mismo texto.
const FIELD_ENC_KEY = Deno.env.get('FIELD_ENC_KEY') ?? ''
let _encKeyPromise: Promise<CryptoKey> | null = null
function fieldKey(): Promise<CryptoKey> {
  if (!_encKeyPromise) {
    _encKeyPromise = crypto.subtle.digest('SHA-256', new TextEncoder().encode(FIELD_ENC_KEY))
      .then(raw => crypto.subtle.importKey('raw', new Uint8Array(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']))
  }
  return _encKeyPromise
}
async function encField(plain: string): Promise<string> {
  if (!FIELD_ENC_KEY || !plain) return plain
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await fieldKey(), new TextEncoder().encode(plain)))
  const buf = new Uint8Array(iv.length + ct.length); buf.set(iv); buf.set(ct, iv.length)
  return 'enc:v1:' + btoa(String.fromCharCode(...buf))
}
async function decField(v: string): Promise<string> {
  if (typeof v !== 'string' || !v.startsWith('enc:v1:')) return v   // texto plano legacy
  if (!FIELD_ENC_KEY) throw new Error('FIELD_ENC_KEY missing')
  const bytes = Uint8Array.from(atob(v.slice(7)), c => c.charCodeAt(0))
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await fieldKey(), bytes.slice(12))
  return new TextDecoder().decode(pt)
}

// TOTP nativo (SHA1/6/30, ventana ±2) — para verificar el 2FA en el servidor.
function base32Decode(s: string): Uint8Array {
  const alph = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = String(s ?? '').replace(/=+$/, '').toUpperCase().replace(/\s/g, '')
  let bits = 0, value = 0; const out: number[] = []
  for (const ch of clean) {
    const idx = alph.indexOf(ch); if (idx < 0) continue
    value = (value << 5) | idx; bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return new Uint8Array(out)
}
async function verifyTOTPServer(secret: string, token: string): Promise<boolean> {
  const code = String(token ?? '').replace(/\D/g, '')
  if (code.length !== 6) return false
  const key = base32Decode(secret); if (!key.length) return false
  const ck = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const now = Math.floor(Date.now() / 1000)
  for (let w = -2; w <= 2; w++) {
    const counter = Math.floor(now / 30) + w
    const b = new ArrayBuffer(8); const dv = new DataView(b)
    dv.setUint32(0, Math.floor(counter / 0x100000000)); dv.setUint32(4, counter >>> 0)
    const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', ck, b))
    const off = hmac[hmac.length - 1] & 0x0f
    const bin = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3]
    if ((bin % 1000000).toString().padStart(6, '0') === code) return true
  }
  return false
}

async function verifyAdmin(req: Request): Promise<{ ok: boolean; error?: string }> {
  const authHeader = req.headers.get('Authorization') ?? ''

  // Admin bypass: frontend sends "AdminBypass <password>" when using the local bypass session.
  // Requires ADMIN_PASS secret in Supabase Edge Function settings (same value as VITE_ADMIN_PASSWORD).
  const ADMIN_PASS = Deno.env.get('ADMIN_PASS') ?? ''
  if (ADMIN_PASS && authHeader === `AdminBypass ${ADMIN_PASS}`) return { ok: true }

  const jwt = authHeader.replace('Bearer ', '').trim()
  if (!jwt) return { ok: false, error: 'No authorization token' }

  try {
    const authResult = await Promise.race([
      db.auth.getUser(jwt),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('auth_timeout')), 3000)),
    ])
    const { data: { user }, error: authErr } = authResult as any
    if (authErr || !user) return { ok: false, error: 'Invalid or expired token' }
    const isAdminEmail = user.email === ADMIN_EMAIL
    const { data: profile } = await db.from('users').select('role').eq('id', user.id).single()
    if (!profile?.role && !isAdminEmail) return { ok: false, error: 'Forbidden: admin only' }
    if (profile?.role !== 'admin' && !isAdminEmail) return { ok: false, error: 'Forbidden: admin only' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Auth check failed' }
  }
}

// true si quien llama es admin, O si su JWT resuelve al MISMO userId que
// pide la acción (para insert_transaction: cualquier cliente puede
// insertar SU PROPIA transacción, nunca la de otro).
async function verifySelfOrAdmin(req: Request, userId: string): Promise<boolean> {
  if ((await verifyAdmin(req)).ok) return true
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return false
  try {
    const { data: { user } } = await db.auth.getUser(jwt)
    return user?.id === userId
  } catch {
    return false
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // Ping SIN auth: para verificar qué versión está desplegada desde el
    // navegador. No expone ningún dato.
    const pingUrl = new URL(req.url)
    if (pingUrl.searchParams.get('action') === 'ping') {
      return json({ ok: true, version: 'admin-data v4 (slim + ping)' })
    }

    // ⚠️ El body se parsea ANTES del gate de admin — 'delete_self' e
    // 'insert_transaction' son deliberadamente self-service (cualquier
    // usuario autenticado puede borrar SU PROPIA cuenta o insertar SU
    // PROPIA transacción), y cada una hace su propia verificación interna
    // (self o admin). Antes el gate de admin corría primero e
    // incondicionalmente, así que un usuario normal (no-admin) que
    // llamara 'delete_self' recibía 401 sin llegar nunca a esa lógica —
    // quedaba efectivamente inalcanzable para quien de verdad la necesita.
    let selfServiceBody: any = null
    if (req.method === 'POST') {
      selfServiceBody = await req.json().catch(() => ({}))

      // Insertar la PROPIA transacción — la RLS de public.transactions solo
      // deja insertar a admins (tx_insert_admin), así que un cliente normal
      // nunca podía crear su registro de envío/depósito/conversión: el
      // insert fallaba en silencio y la fila optimista se quedaba en
      // memoria del navegador para siempre, sin existir de verdad en la DB.
      if (selfServiceBody.action === 'insert_transaction' && selfServiceBody.tx?.user_id) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.tx.user_id))) return json({ error: 'No autorizado' }, 401)
        let txRow = selfServiceBody.tx
        // Un no-admin NO puede forjar filas que OTROS procesos leen para mover
        // saldo: dispersion+providerRef dispara un reembolso vía reconcile, y
        // rail_move Pendiente lo aprueba el admin acreditando el riel. Se
        // BLOQUEAN esos tipos server-authored y se neutralizan los campos
        // sensibles del raw_data. Los tipos informativos del cliente (load,
        // send, convert, pay_*) siguen permitidos — la app los inserta así.
        if (!(await verifyAdmin(req)).ok) {
          const BLOCKED_TYPES = new Set(['dispersion', 'rail_move', 'breb_move', 'adjustment', 'referral_payout', 'admin_hot_withdrawal', 'fee_income', 'internal'])
          if (BLOCKED_TYPES.has(String(txRow.type))) return json({ error: 'Tipo de movimiento no permitido' }, 403)
          const rd = { ...(txRow.raw_data ?? {}) }
          for (const k of ['providerRef', 'refunded', 'fromRail', 'toRail', 'gasfreeCredited', 'convertPhase', 'needsReview']) delete (rd as any)[k]
          txRow = { ...txRow, raw_data: rd }
        }
        const { data: inserted, error: insErr } = await db.from('transactions').insert(txRow).select('id').single()
        if (insErr) return json({ error: insErr.message }, 500)
        return json({ success: true, id: inserted?.id })
      }

      // Guarda el PROPIO perfil (o el de otro, si quien llama es admin) con
      // el service-role key. Fallback de saveUser() en el cliente: pasa
      // exactamente lo mismo que con insert_transaction — si el upsert
      // directo falla (RLS, sesión sin JWT real, etc.), el saldo/perfil
      // solo quedaba en memoria de esa pestaña y nunca llegaba a la fila
      // real. No agrega ningún permiso nuevo: un usuario con JWT real ya
      // puede escribir su propia fila de todas formas vía RLS
      // (auth.uid()=id) — esto solo la deja llegar cuando ese camino falla.
      if (selfServiceBody.action === 'save_user' && selfServiceBody.user?.id) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.user.id))) return json({ error: 'No autorizado' }, 401)
        // El upsert corre con service-role (la RLS no aplica). Si el caller NO
        // es admin se SANEAN los valores de escalación: role solo puede ser
        // personal/business (nunca 'admin'), kyc_status nunca puede quedar
        // aprobado/verificado por el propio usuario (eso lo fija el flujo KYC
        // server-side), y se quitan flags de bloqueo/límites. El onboarding
        // legítimamente fija role=personal/business y kyc_status=pending/
        // in_review, así que esos SÍ pasan. Balances no se tocan: el flujo
        // legacy de retiro del cliente aún los persiste por esta vía.
        const userRow = { ...selfServiceBody.user }
        if (!(await verifyAdmin(req)).ok) {
          if (userRow.role != null && !['personal', 'business'].includes(String(userRow.role))) delete (userRow as any).role
          if (userRow.kyc_status != null && !['pending', 'in_review', 'not_started', 'incomplete', 'rejected'].includes(String(userRow.kyc_status))) delete (userRow as any).kyc_status
          for (const k of ['is_blocked', 'is_admin', 'limits', 'status']) delete (userRow as any)[k]

          // ── CANDADO ANTI AUTO-CRÉDITO (CRÍTICO 2) ──────────────────────────
          // Un usuario NO puede SUBIRSE el saldo por esta vía (sería inflar
          // dinero que no existe y luego retirarlo). Se permite BAJARLO (el
          // flujo legacy de retiro debita por aquí). Los aumentos legítimos
          // (conversiones) van por apply_conversion, que valida la tasa. Se
          // reconstruye cada columna de saldo tomando el valor de la base y
          // aplicando SOLO las bajadas del cliente; cualquier subida se ignora.
          if (userRow.balances != null || userRow.crypto_balances != null) {
            const { data: cur } = await db.from('users').select('balances, crypto_balances').eq('id', selfServiceBody.user.id).maybeSingle()
            const clampNoIncrease = (incoming: Record<string, any> | null | undefined, current: Record<string, any> | null | undefined) => {
              const base: Record<string, number> = { ...((current && typeof current === 'object') ? current : {}) }
              if (incoming && typeof incoming === 'object') {
                for (const [k, v] of Object.entries(incoming)) {
                  const nv = Number(v), cv = Number(base[k] ?? 0)
                  // Solo se acepta si NO aumenta (baja o igual). Subidas → se
                  // conserva el valor real de la base.
                  if (isFinite(nv) && nv <= cv + 1e-9) base[k] = nv
                }
              }
              return base
            }
            if (userRow.balances != null)        userRow.balances        = clampNoIncrease(userRow.balances, (cur as any)?.balances)
            if (userRow.crypto_balances != null) userRow.crypto_balances = clampNoIncrease(userRow.crypto_balances, (cur as any)?.crypto_balances)
          }
        }
        const { error: saveErr } = await db.from('users').upsert(userRow)
        if (saveErr) return json({ error: saveErr.message }, 500)
        return json({ success: true })
      }

      // ── Conversión SERVER-AUTORITATIVA (anti auto-crédito) ───────────────
      // Aplica DELTAS (nunca saldos absolutos del cliente), valida sin
      // sobregiro y que el monto recibido sea PLAUSIBLE según la tasa real
      // (fx_rate_snapshots). Así el cliente no puede pedir "convierte $1 →
      // $1.000.000" ni escribirse un saldo arbitrario. Enruta cripto vs fiat
      // a su columna correcta.
      if (selfServiceBody.action === 'apply_conversion' && selfServiceBody.userId) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.userId))) return json({ error: 'No autorizado' }, 401)
        const userId = String(selfServiceBody.userId)
        const src = String(selfServiceBody.src ?? '')
        const tgt = String(selfServiceBody.tgt ?? '')
        const amtS = Number(selfServiceBody.amtS)
        const amtT = Number(selfServiceBody.amtT)
        const fee  = Number(selfServiceBody.fee ?? 0)
        if (!/^[A-Z0-9_]+$/i.test(src) || !/^[A-Z0-9_]+$/i.test(tgt) || src === tgt ||
            !isFinite(amtS) || !isFinite(amtT) || amtS <= 0 || amtT <= 0) {
          return json({ error: 'Parámetros de conversión inválidos' }, 400)
        }
        const CRYPTO = new Set(['USDT', 'USDC', 'ETH', 'BNB', 'TRX', 'USDT_BSC', 'USDT_TRON', 'USDC_BSC', 'USDC_BASE', 'USDC_MATIC'])
        const { data: u } = await db.from('users').select('balances, crypto_balances').eq('id', userId).single()
        if (!u) return json({ error: 'Usuario no encontrado' }, 404)
        const fiat: Record<string, number> = { ...((u as any).balances ?? {}) }
        const cry:  Record<string, number> = { ...((u as any).crypto_balances ?? {}) }
        const bal = (k: string) => Number((CRYPTO.has(k) ? cry[k] : fiat[k]) ?? 0)
        const setBal = (k: string, v: number) => { if (CRYPTO.has(k)) cry[k] = v; else fiat[k] = v }
        if (bal(src) + 1e-9 < amtS) return json({ error: 'Saldo insuficiente' }, 400)

        // Plausibilidad del monto recibido según la tasa real.
        const baseOf = (k: string) => (/^USD/.test(k) || k === 'USD') ? 'USD' : /^COP/.test(k) ? 'COP' : /^EUR/.test(k) ? 'EUR' : k
        const bS = baseOf(src), bT = baseOf(tgt)
        let expected: number | null = null
        if (bS === bT) {
          expected = amtS // 1:1 (ej. dólar digital ↔ cuenta USD)
        } else {
          const { data: snaps } = await db.from('fx_rate_snapshots')
            .select('from_currency, to_currency, rate, captured_at')
            .or(`and(from_currency.eq.${bS},to_currency.eq.${bT}),and(from_currency.eq.${bT},to_currency.eq.${bS})`)
            .order('captured_at', { ascending: false }).limit(1)
          const row: any = (snaps ?? [])[0]
          if (row && Number(row.rate) > 0) {
            expected = row.from_currency === bS ? amtS * Number(row.rate) : amtS / Number(row.rate)
          }
        }
        // Con fx_rate_snapshots ya bloqueada a solo-admin, la tasa es de fiar.
        // Si NO hay tasa para el par (y no es 1:1 misma base), se RECHAZA — ya
        // no hay banda amplia de respaldo que se pudiera abusar.
        if (expected == null) {
          return json({ error: 'No hay tasa vigente para esa conversión. Intenta más tarde.' }, 400)
        }
        // El monto RECIBIDO nunca puede superar el justo (una conversión real
        // cobra comisión → recibes MENOS o igual). Antes el tope multiplicativo
        // (1.001×) dejaba una micro-ganancia que, en ida y vuelta, se componía
        // y acuñaba dinero. Ahora el tope es `expected` con un epsilon ABSOLUTO
        // mínimo (por redondeo de floats), así una conversión nunca deja más de
        // lo enviado a la tasa. El piso 0.60 permite comisiones de hasta ~40%.
        const absEps = Math.max(1, expected * 1e-6)
        if (!(amtT >= expected * 0.60 && amtT <= expected + absEps)) {
          return json({ error: 'El monto de la conversión no coincide con la tasa vigente.' }, 400)
        }

        // Aplicar los deltas de forma ATÓMICA (bloqueo de fila) para evitar la
        // carrera de duplicación con otra operación concurrente. Fallback a la
        // escritura del objeto completo si la RPC aún no está desplegada.
        const fiatD: Record<string, number> = {}; const cryD: Record<string, number> = {}
        const addD = (k: string, v: number) => { const o = CRYPTO.has(k) ? cryD : fiatD; o[k] = (o[k] ?? 0) + v }
        addD(src, -amtS); addD(tgt, amtT)
        const { data: adj, error: adjErr } = await db.rpc('adjust_balances', { p_user_id: userId, p_fiat: fiatD, p_crypto: cryD })
        if (!adjErr) {
          if ((adj as any)?.error) {
            return json({ error: (adj as any).error === 'insufficient' ? 'Saldo insuficiente' : 'No se pudo aplicar la conversión.' }, 400)
          }
        } else {
          setBal(src, Number((bal(src) - amtS).toFixed(8)))
          setBal(tgt, Number((bal(tgt) + amtT).toFixed(8)))
          const { error: upErr } = await db.from('users').update({ balances: fiat, crypto_balances: cry }).eq('id', userId)
          if (upErr) return json({ error: upErr.message }, 500)
        }

        let txId: number | null = null
        try {
          const { data: ins } = await db.from('transactions').insert({
            user_id: userId, type: 'convert', amount: amtS, currency: src, status: 'Completado',
            raw_data: { initials: 'CV', title: `${src} a ${tgt}`, targetAmount: amtT, targetCurrency: tgt, destCurrency: tgt, fee, couponCode: selfServiceBody.coupon ?? null, createdAt: new Date().toISOString() },
          }).select('id').single()
          txId = (ins as any)?.id ?? null
        } catch { /* best-effort */ }
        return json({ success: true, id: txId, balances: { ...fiat, ...cry } })
      }

      // ── Resolver un código de referido a { id, name } para un pago P2P.
      //    Lo puede pedir CUALQUIER usuario autenticado (no expone saldos ni
      //    PII). Reemplaza el escaneo cliente de toda la tabla users, que la
      //    RLS estricta deja de permitir a los no-admin. ─────────────────────
      if (selfServiceBody.action === 'lookup_recipient') {
        const authHeader = req.headers.get('Authorization') ?? ''
        const ADMIN_PASS = Deno.env.get('ADMIN_PASS') ?? ''
        let authed = ADMIN_PASS !== '' && authHeader === `AdminBypass ${ADMIN_PASS}`
        if (!authed) {
          const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
          if (jwt) { try { const { data } = await db.auth.getUser(jwt); authed = !!data?.user } catch { /* inválido */ } }
        }
        if (!authed) return json({ error: 'No autorizado' }, 401)
        const code = String(selfServiceBody.code ?? '').toUpperCase().trim()
        if (code.length < 4) return json({ found: false })
        const { data: u } = await db.from('users')
          .select('id, full_name')
          .eq('raw_data->>ownReferralCode', code)
          .neq('role', 'admin')
          .limit(1)
          .maybeSingle()
        if (!u) return json({ found: false })
        return json({ found: true, id: (u as any).id, name: (u as any).full_name ?? 'Usuario Lincoin' })
      }

      // ── 2FA: guardar el secreto TOTP CIFRADO (nunca en texto plano) ──────
      // El cliente verifica el primer código localmente (prueba que configuró
      // bien su app) y aquí solo se almacena el secreto cifrado con la llave
      // del servidor. Se borra cualquier totpSecret plano previo.
      if (selfServiceBody.action === 'mfa_set' && selfServiceBody.userId) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.userId))) return json({ error: 'No autorizado' }, 401)
        const secret = String(selfServiceBody.secret ?? '')
        if (!/^[A-Z2-7]{16,64}$/i.test(secret)) return json({ error: 'Secreto inválido' }, 400)
        const factorId = String(selfServiceBody.factorId ?? 'local')
        const { data: u } = await db.from('users').select('raw_data').eq('id', selfServiceBody.userId).single()
        const raw = { ...((u as any)?.raw_data ?? {}) }
        raw.totpSecretEnc = await encField(secret)
        raw.mfaEnabled = true
        raw.mfaFactorId = factorId
        delete raw.totpSecret   // nunca dejar el secreto en claro
        const { error } = await db.from('users').update({ raw_data: raw }).eq('id', selfServiceBody.userId)
        if (error) return json({ error: error.message }, 500)
        return json({ success: true })
      }

      // ── 2FA: verificar un código contra el secreto CIFRADO (server-side).
      // Reemplaza la verificación local del cliente (que ya no tiene el
      // secreto en claro). Acepta legacy en texto plano.
      if (selfServiceBody.action === 'mfa_verify' && selfServiceBody.userId) {
        if (!(await verifySelfOrAdmin(req, selfServiceBody.userId))) return json({ error: 'No autorizado' }, 401)
        const code = String(selfServiceBody.code ?? '')
        const { data: u } = await db.from('users').select('raw_data').eq('id', selfServiceBody.userId).single()
        const raw = ((u as any)?.raw_data ?? {}) as Record<string, any>
        let secret = ''
        try { secret = raw.totpSecretEnc ? await decField(String(raw.totpSecretEnc)) : String(raw.totpSecret ?? '') } catch { secret = '' }
        if (!secret) return json({ ok: false, error: 'no_secret' })
        const ok = await verifyTOTPServer(secret, code)
        return json({ ok })
      }

      // Self-delete: any authenticated user can delete their own account
      if (selfServiceBody.action === 'delete_self') {
        const jwt = req.headers.get('Authorization')?.replace('Bearer ', '').trim()
        const { data: { user: selfUser } } = await db.auth.getUser(jwt ?? '')
        if (!selfUser) return json({ error: 'Unauthorized' }, 401)
        const { data: selfProfile } = await db.from('users').select('raw_data').eq('id', selfUser.id).single()
        const selfIndex: number | undefined = selfProfile?.raw_data?.gasfreeHdIndex
        await db.from('transactions').delete().eq('user_id', selfUser.id)
        await db.from('users').delete().eq('id', selfUser.id)
        const { error: selfDelErr } = await db.auth.admin.deleteUser(selfUser.id)
        // ⚠️ Antes este error solo se logueaba y la función igual devolvía
        // success:true — la fila de public.users quedaba borrada pero el
        // usuario de Supabase Auth se quedaba huérfano con el mismo email,
        // así que un reintento de registro con ese correo fallaba sin que
        // nadie supiera por qué ("no se elimina de verdad"). Ahora se
        // reporta el error de verdad (el perfil ya se borró igual, pero al
        // menos se sabe que hay que limpiar el auth user a mano o con
        // force_delete_by_email).
        if (selfDelErr) {
          console.warn('[admin-data] delete_self auth error:', selfDelErr.message)
          return json({ error: `Perfil eliminado, pero la cuenta de acceso no se pudo borrar: ${selfDelErr.message}. Contacta soporte para liberar el correo.` }, 500)
        }
        if (typeof selfIndex === 'number') {
          const { data: blCfg } = await db.from('system_config').select('value').eq('key', 'gasfree_used_indices').single()
          const blacklist: number[] = JSON.parse(blCfg?.value ?? '[]')
          if (!blacklist.includes(selfIndex)) blacklist.push(selfIndex)
          blacklist.sort((a, b) => a - b)
          await db.from('system_config').upsert({ key: 'gasfree_used_indices', value: JSON.stringify(blacklist) })
          const { data: ctrCfg } = await db.from('system_config').select('value').eq('key', 'gasfree_hd_counter').single()
          const current = ctrCfg?.value ? parseInt(ctrCfg.value) : 0
          if (selfIndex > current) {
            await db.from('system_config').upsert({ key: 'gasfree_hd_counter', value: String(selfIndex) })
          }
        }
        return json({ success: true })
      }
    }

    // Todo lo que sigue de aquí en adelante SÍ es admin-only — se aplica
    // el gate ahora que las acciones self-service ya tuvieron su chance.
    const auth = await verifyAdmin(req)
    if (!auth.ok) return json({ error: auth.error }, 401)

    if (req.method === 'POST') {
      const body = selfServiceBody ?? {}

      if (body.action === 'save_config') {
        const { settings } = body
        if (!settings) return json({ error: 'Missing settings' }, 400)
        const { error } = await db.from('app_config').upsert({ id: 1, settings })
        if (error) return json({ error: error.message }, 500)
        return json({ ok: true })
      }


      // Admin: manually set kyc_status for a user
      if (body.action === 'set_kyc_status' && body.userId && body.kycStatus) {
        const allowed = ['verified', 'in_review', 'rejected', 'pending', 'in_progress']
        if (!allowed.includes(body.kycStatus)) return json({ error: 'Invalid kycStatus' }, 400)
        const { error: kycErr } = await db.from('users')
          .update({ kyc_status: body.kycStatus })
          .eq('id', body.userId)
        if (kycErr) return json({ error: kycErr.message }, 500)
        return json({ success: true })
      }

      if (body.action === 'delete_user' && body.userId) {
        const uid: string = body.userId

        // 0. Read gasfreeHdIndex BEFORE deleting so we can update the counter
        const { data: deletedUser } = await db.from('users').select('raw_data').eq('id', uid).single()
        const deletedIndex: number | undefined = deletedUser?.raw_data?.gasfreeHdIndex

        // 1. Delete all transactions for this user
        await db.from('transactions').delete().eq('user_id', uid)

        // 2. Delete from public.users
        await db.from('users').delete().eq('id', uid)

        // 3. Delete from Supabase Auth (service-role admin API)
        const { error: authDelErr } = await db.auth.admin.deleteUser(uid)
        if (authDelErr) {
          // No fallar la respuesta — el perfil ya se borró, así que no
          // puede iniciar sesión — pero SÍ avisar: si esto falla, el email
          // queda "huérfano" en Supabase Auth y bloquea un registro nuevo
          // con el mismo correo hasta que se borre con force_delete_by_email
          // o a mano en el Dashboard → Authentication → Users.
          console.warn('[admin-data] auth.admin.deleteUser error:', authDelErr.message)
          return json({ success: true, authWarning: `El perfil se borró, pero la cuenta de acceso (Supabase Auth) no: ${authDelErr.message}. El correo seguirá bloqueado para un registro nuevo hasta limpiarla.` })
        }

        // 4. Add the deleted user's gasfreeHdIndex to the permanent blacklist so it
        //    is never assigned to a new user, even after the user row is gone.
        if (typeof deletedIndex === 'number') {
          const { data: blCfg } = await db.from('system_config').select('value').eq('key', 'gasfree_used_indices').single()
          const blacklist: number[] = JSON.parse(blCfg?.value ?? '[]')
          if (!blacklist.includes(deletedIndex)) blacklist.push(deletedIndex)
          blacklist.sort((a, b) => a - b)
          await db.from('system_config').upsert({ key: 'gasfree_used_indices', value: JSON.stringify(blacklist) })
          // Also bump counter so getUserIndex starts above the deleted index
          const { data: ctrCfg } = await db.from('system_config').select('value').eq('key', 'gasfree_hd_counter').single()
          const current = ctrCfg?.value ? parseInt(ctrCfg.value) : 0
          if (deletedIndex > current) {
            await db.from('system_config').upsert({ key: 'gasfree_hd_counter', value: String(deletedIndex) })
          }
        }

        return json({ success: true })
      }

      // Libera un correo "huérfano": borra el usuario de Supabase Auth que
      // tenga ese email (y cualquier fila de public.users que haya quedado,
      // por si acaso) aunque ya no exista perfil — para cuando un delete
      // anterior (delete_self o delete_user) borró el perfil pero falló al
      // borrar la cuenta de Auth, y el correo quedó bloqueado para un
      // registro nuevo sin que nadie lo notara.
      if (body.action === 'force_delete_by_email' && body.email) {
        const email = String(body.email).trim().toLowerCase()
        await db.from('users').delete().eq('email', email)
        let found: any = null
        for (let page = 1; page <= 20 && !found; page++) {
          const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
          if (error) return json({ error: error.message }, 500)
          found = (data?.users ?? []).find((u: any) => (u.email ?? '').toLowerCase() === email)
          if (!data?.users || data.users.length < 200) break
        }
        if (!found) return json({ success: true, note: 'No había ningún usuario de Auth con ese correo — ya estaba libre para registrarse.' })
        const { error: delErr } = await db.auth.admin.deleteUser(found.id)
        if (delErr) return json({ error: delErr.message }, 500)
        return json({ success: true, deletedAuthUserId: found.id })
      }

      // Manually credit or debit a user's crypto balance
      if (body.action === 'admin_credit_crypto' && body.userId && body.currency && body.amount != null) {
        const { data: u } = await db.from('users').select('crypto_balances').eq('id', body.userId).single()
        const bals: Record<string, number> = (u?.crypto_balances as any) ?? {}
        const cur: string = body.currency
        const delta: number = parseFloat(body.amount)
        const newBal = parseFloat(Math.max(0, (bals[cur] ?? 0) + delta).toFixed(8))
        await db.from('users').update({ crypto_balances: { ...bals, [cur]: newBal } }).eq('id', body.userId)
        if (delta > 0) {
          await db.from('transactions').insert({
            user_id: body.userId, type: 'otc_deposit', amount: delta, currency: body.currency,
            status: 'Completado',
            raw_data: { source: 'admin_manual', note: body.note ?? 'Depósito acreditado manualmente por admin', creditedAt: new Date().toISOString() },
          })
        }
        return json({ success: true, newBalance: newBal })
      }

      // Cargues — acreditar (o descontar) manualmente el saldo FIAT de un
      // cliente en un riel específico: COP (Saldo Lincoin), COP_BREB (Bre-B)
      // o COP_ACH (ACH). Temporal, mientras Mouv apifica el conversor: el
      // admin recibe el pago por el grupo cerrado y aquí refleja el saldo.
      // body: { action:'admin_credit_balance', userId, currency, amount, note? }
      // Cargues Bre-B: al cliente se le cobra el 0,10% POR RECIBIR en su
      // cuenta Bre-B (override con el secret BREB_CARGUE_FEE_PCT, en %).
      // Ej: cargue de 40.000.000 → comisión 40.000 → se acreditan 39.960.000.
      if (body.action === 'admin_credit_balance' && body.userId && body.currency && body.amount != null) {
        const ALLOWED = ['COP', 'COP_BREB', 'COP_ACH']
        const cur: string = body.currency
        if (!ALLOWED.includes(cur)) return json({ success: false, error: `Riel no permitido: ${cur}` }, 400)
        const { data: u } = await db.from('users').select('balances').eq('id', body.userId).single()
        if (!u) return json({ success: false, error: 'Usuario no encontrado' }, 404)
        const bals: Record<string, number> = (u?.balances as any) ?? {}
        const delta: number = parseFloat(body.amount)
        if (!isFinite(delta) || delta === 0) return json({ success: false, error: 'Monto inválido' }, 400)
        const BREB_CARGUE_FEE_PCT = Number(Deno.env.get('BREB_CARGUE_FEE_PCT') ?? '0.10') || 0.10
        let feeCop = 0
        let credit = delta
        if (cur === 'COP_BREB' && delta > 0) {
          feeCop = Math.round(delta * BREB_CARGUE_FEE_PCT / 100)
          credit = delta - feeCop
        }
        // recordOnly=true → SOLO registra el movimiento histórico, sin tocar
        // el saldo (para cuadrar cargues viejos que se acreditaron sin fila
        // en transacciones y el resumen de Movimientos no los veía). En modo
        // registro no se aplica comisión: se anota el monto tal cual.
        const recordOnly = body.recordOnly === true
        if (recordOnly) { feeCop = 0; credit = delta }
        // ATÓMICO: primero el movimiento — si el registro falla, NO se toca
        // el saldo (un cargue sin rastro en el historial es un descuadre).
        const { error: txInsErr } = await db.from('transactions').insert({
          user_id: body.userId,
          type: delta > 0 ? 'load' : 'adjustment',
          // El movimiento del cliente muestra lo NETO acreditado.
          amount: Math.abs(credit),
          currency: cur,
          status: 'Completado',
          raw_data: {
            source: recordOnly ? 'admin_backfill' : 'admin_cargue',
            rail: cur,
            direction: delta > 0 ? 'credit' : 'debit',
            ...(recordOnly ? { recordOnly: true } : {}),
            ...(feeCop > 0 ? { grossCop: delta, feeCop, feePct: BREB_CARGUE_FEE_PCT, feeConcept: 'Comisión por recepción Bre-B' } : {}),
            note: body.note ?? (recordOnly ? 'Registro histórico (no afecta saldo)' : delta > 0
              ? (feeCop > 0 ? `Cargue Bre-B · comisión ${BREB_CARGUE_FEE_PCT}% por recepción` : 'Cargue manual (Mouv)')
              : 'Ajuste manual'),
            creditedAt: new Date().toISOString(),
          },
        })
        if (txInsErr) return json({ success: false, error: `No se registró el movimiento (${txInsErr.message}) — el saldo NO fue modificado.` }, 500)
        let newBal = parseFloat(Number(bals[cur] ?? 0).toFixed(2))
        if (!recordOnly) {
          newBal = parseFloat(Math.max(0, (bals[cur] ?? 0) + credit).toFixed(2))
          await db.from('users').update({ balances: { ...bals, [cur]: newBal } }).eq('id', body.userId)
        }
        return json({ success: true, newBalance: newBal, recordOnly, grossCop: Math.abs(delta), feeCop, netCop: Math.abs(credit), feePct: feeCop > 0 ? BREB_CARGUE_FEE_PCT : 0 })
      }

      // ── Solicitudes "Mover Saldo Lincoin → ACH" (aprobación manual) ──
      // El cliente pide mover COP (Saldo Lincoin) a su riel ACH; el COP ya
      // quedó DEBITADO al crear la solicitud. El admin manda el respaldo al
      // proveedor por fuera y aquí aprueba (acredita COP_ACH) o rechaza
      // (reembolsa al Saldo Lincoin). Idempotente por estado.
      if ((body.action === 'approve_rail_move' || body.action === 'reject_rail_move') && body.txId) {
        const { data: tx } = await db.from('transactions').select('*').eq('id', body.txId).single()
        if (!tx || tx.type !== 'rail_move') return json({ success: false, error: 'Solicitud no encontrada' }, 404)
        if (tx.status !== 'Pendiente') return json({ success: true, already: true, status: tx.status })
        const rd = (tx.raw_data ?? {}) as Record<string, any>
        const { data: u } = await db.from('users').select('balances').eq('id', tx.user_id).single()
        const bals: Record<string, number> = (u?.balances as any) ?? {}
        const amt = Number(tx.amount ?? 0)
        if (body.action === 'approve_rail_move') {
          const toRail = String(rd.toRail ?? 'COP_ACH')
          const newBal = parseFloat(((bals[toRail] ?? 0) + amt).toFixed(2))
          await db.from('users').update({ balances: { ...bals, [toRail]: newBal } }).eq('id', tx.user_id)
          await db.from('transactions').update({
            status: 'Completado',
            raw_data: { ...rd, approvedAt: new Date().toISOString(), title: 'Saldo Lincoin → ACH · aprobado' },
          }).eq('id', tx.id)
          return json({ success: true, newBalance: newBal })
        }
        const fromRail = String(rd.fromRail ?? 'COP')
        const refunded = parseFloat(((bals[fromRail] ?? 0) + amt).toFixed(2))
        await db.from('users').update({ balances: { ...bals, [fromRail]: refunded } }).eq('id', tx.user_id)
        await db.from('transactions').update({
          status: 'Rechazado',
          raw_data: { ...rd, rejectedAt: new Date().toISOString(), rejectReason: body.reason ?? 'Rechazado por administración', title: 'Saldo Lincoin → ACH · rechazado (reembolsado)' },
        }).eq('id', tx.id)
        return json({ success: true, refunded: true })
      }

      // Credit conversion fee to admin's balance (called by performConversion for all users)
      // body: { action: 'credit_conversion_fee', currency, amount, fromUserId, note? }
      if (body.action === 'credit_conversion_fee' && body.currency && body.amount != null) {
        const ADMIN_EMAIL = Deno.env.get('VITE_ADMIN_EMAIL') || 'admin@lincoin.com'
        const { data: adminUser } = await db.from('users').select('id, balances, crypto_balances').eq('email', ADMIN_EMAIL).single()
        if (!adminUser) return json({ success: false, reason: 'admin not found' })

        const fee: number  = parseFloat(body.amount)
        const cur: string  = body.currency
        const isCrypto     = ['USDT', 'USDC', 'ETH', 'BNB', 'TRX', 'USDT_BSC', 'USDT_TRON', 'USDC_BSC', 'USDC_MATIC', 'USDC_BASE'].includes(cur)

        if (isCrypto) {
          const bals: Record<string, number> = (adminUser.crypto_balances as any) ?? {}
          const newBal = parseFloat(((bals[cur] ?? 0) + fee).toFixed(8))
          await db.from('users').update({ crypto_balances: { ...bals, [cur]: newBal } }).eq('id', adminUser.id)
        } else {
          const bals: Record<string, number> = (adminUser.balances as any) ?? {}
          const newBal = parseFloat(((bals[cur] ?? 0) + fee).toFixed(4))
          await db.from('users').update({ balances: { ...bals, [cur]: newBal } }).eq('id', adminUser.id)
        }

        // Log fee transaction for audit trail
        await db.from('transactions').insert({
          user_id: adminUser.id, type: 'fee_income', amount: fee, currency: cur, status: 'Completado',
          raw_data: { source: 'conversion_fee', fromUserId: body.fromUserId ?? null, note: body.note ?? `Comisión de conversión`, creditedAt: new Date().toISOString() },
        })
        return json({ success: true })
      }

      // Comprobante de UNA transacción, bajo demanda (ver slimRawData)
      if (body.action === 'get_tx_proof' && body.txId != null) {
        const { data: tx } = await db.from('transactions').select('raw_data').eq('id', body.txId).single()
        return json({ raw_data: tx?.raw_data ?? {} })
      }

      // POST with no recognized action → fall through to data fetch (same as GET)
    }

    // GET (or POST without body) — fetch all users and recent transactions
    const [usersRes, txRes] = await Promise.all([
      db.from('users').select('*'),
      db.from('transactions').select('*').order('id', { ascending: false }).limit(200),
    ])

    const payload = {
      // Usuarios: solo se quitan blobs base64 gigantes (>20 KB) — los campos
      // normales (contactos, wallets, notificaciones) pasan intactos.
      users:        (usersRes.data ?? []).map((u: Record<string, unknown>) => ({ ...u, raw_data: slimRawData(u.raw_data, 20000) })),
      transactions: (txRes.data ?? []).map((t: Record<string, unknown>) => ({ ...t, raw_data: slimRawData(t.raw_data) })),
    }
    const body = JSON.stringify(payload)
    console.log(`[admin-data] respuesta: ${payload.users.length} usuarios, ${payload.transactions.length} tx, ${(body.length / 1024).toFixed(0)} KB`)
    return new Response(body, { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
