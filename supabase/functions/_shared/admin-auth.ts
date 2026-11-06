// ══════════════════════════════════════════════════════════════════
//  ADMIN CON SEGUNDO FACTOR — para las funciones fuera de admin-data
//
//  admin-data ya exige, en sus acciones sensibles, que la SESIÓN que llama
//  haya pasado el 2FA (raw_data.mfaSessions, anotada al verificar el código).
//  Las demás funciones con acciones de admin (tusdatos, kumplo, gowd…) solo
//  miraban users.role === 'admin': con la contraseña de un admin, sin el
//  código de la app, se podía aprobar un caso bloqueado por AML o leer datos
//  de cumplimiento. Esto replica la MISMA regla de admin-data, para que el
//  segundo factor valga igual en todo el sistema:
//
//    · Cuenta sin 2FA activo → pasa (como en admin-data: no se le puede
//      exigir a quien todavía no lo tiene; el 2FA se activa desde el panel).
//    · Token sin claim de sesión (GoTrue antiguo) → pasa (no es forjable y
//      bloquear dejaría al admin sin panel).
//    · Si no, la sesión tiene que estar anotada en 'full' y no vencida (24 h).
//    · Si no se pudo comprobar → NO pasa.
// ══════════════════════════════════════════════════════════════════

export const MFA_SESSION_TTL_MS = 24 * 3600 * 1000

export function sessionIdOf(req: Request): string | null {
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    const part = jwt.split('.')[1]
    if (!part) return null
    const pad = part.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(pad + '='.repeat((4 - pad.length % 4) % 4)))
    return payload?.session_id ?? null
  } catch { return null }
}

// Mensaje de error si la sesión que llama NO pasó el 2FA; null = puede seguir.
export async function requireMfaSession(db: any, req: Request, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return 'No se pudo identificar al administrador.'
  try {
    const { data: u } = await db.from('users').select('raw_data').eq('id', userId).single()
    const raw = (u as any)?.raw_data ?? {}
    if (!raw.mfaEnabled) return null
    const sid = sessionIdOf(req)
    if (!sid) return null
    const list: any[] = Array.isArray(raw.mfaSessions) ? raw.mfaSessions : []
    const hit = list.find((x: any) => x?.sid === sid && (x?.stage ?? 'full') === 'full')
    if (!hit) return 'Esta sesión no verificó el segundo factor. Vuelve a iniciar sesión e ingresa tu código.'
    if (Date.now() - new Date(hit.at).getTime() > MFA_SESSION_TTL_MS) {
      return 'La verificación en dos pasos de esta sesión venció. Vuelve a iniciar sesión.'
    }
    return null
  } catch {
    return 'No pudimos comprobar la verificación en dos pasos. Intenta de nuevo.'
  }
}

export type AdminVerificado =
  | { ok: true; userId: string; email: string }
  | { ok: false; status: number; error: string }

// JWT real de Supabase + users.role === 'admin' + sesión con 2FA. El rol
// sale SOLO de la tabla; el correo, del token (Auth), nunca de users.email.
export async function verificarAdminConMfa(db: any, req: Request): Promise<AdminVerificado> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return { ok: false, status: 401, error: 'No autorizado' }
  try {
    const { data: { user } } = await db.auth.getUser(jwt)
    if (!user) return { ok: false, status: 401, error: 'No autorizado' }
    const { data: p } = await db.from('users').select('role').eq('id', user.id).maybeSingle()
    if ((p as any)?.role !== 'admin') return { ok: false, status: 403, error: 'Solo administradores.' }
    const mfa = await requireMfaSession(db, req, user.id)
    if (mfa) return { ok: false, status: 403, error: mfa }
    return { ok: true, userId: String(user.id), email: String(user.email ?? '') }
  } catch {
    return { ok: false, status: 401, error: 'No autorizado' }
  }
}

// Comparación de secretos en tiempo constante (cron, webhooks, llave de
// servicio). Con === la respuesta tarda distinto según cuántos caracteres
// coinciden.
export function igualSeguro(a: string, b: string): boolean {
  const x = new TextEncoder().encode(String(a ?? ''))
  const y = new TextEncoder().encode(String(b ?? ''))
  let d = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return d === 0
}
