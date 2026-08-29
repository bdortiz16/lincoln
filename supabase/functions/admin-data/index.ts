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
        const { data: inserted, error: insErr } = await db.from('transactions').insert(selfServiceBody.tx).select('id').single()
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
        const { error: saveErr } = await db.from('users').upsert(selfServiceBody.user)
        if (saveErr) return json({ error: saveErr.message }, 500)
        return json({ success: true })
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
      if (body.action === 'admin_credit_balance' && body.userId && body.currency && body.amount != null) {
        const ALLOWED = ['COP', 'COP_BREB', 'COP_ACH']
        const cur: string = body.currency
        if (!ALLOWED.includes(cur)) return json({ success: false, error: `Riel no permitido: ${cur}` }, 400)
        const { data: u } = await db.from('users').select('balances').eq('id', body.userId).single()
        if (!u) return json({ success: false, error: 'Usuario no encontrado' }, 404)
        const bals: Record<string, number> = (u?.balances as any) ?? {}
        const delta: number = parseFloat(body.amount)
        if (!isFinite(delta) || delta === 0) return json({ success: false, error: 'Monto inválido' }, 400)
        const newBal = parseFloat(Math.max(0, (bals[cur] ?? 0) + delta).toFixed(2))
        await db.from('users').update({ balances: { ...bals, [cur]: newBal } }).eq('id', body.userId)
        await db.from('transactions').insert({
          user_id: body.userId,
          type: delta > 0 ? 'load' : 'adjustment',
          amount: Math.abs(delta),
          currency: cur,
          status: 'Completado',
          raw_data: {
            source: 'admin_cargue',
            rail: cur,
            direction: delta > 0 ? 'credit' : 'debit',
            note: body.note ?? (delta > 0 ? 'Cargue manual (Mouv)' : 'Ajuste manual'),
            creditedAt: new Date().toISOString(),
          },
        })
        return json({ success: true, newBalance: newBal })
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
