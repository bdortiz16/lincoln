// ══════════════════════════════════════════════════════════════════
//  EQUIPO: QUÉ PUEDE HACER CADA MIEMBRO Y SOBRE QUÉ PAÍSES
//
//  Vivía solo en admin-data. Las demás funciones (gasfree, mouv-proxy,
//  finity-proxy, sarblock, kumplo…) miraban únicamente users.role = 'admin':
//  un miembro de "Solo lectura" podía acreditar COP llamando a gasfree, o
//  leer los veredictos AML desde sarblock, aunque admin-data se lo negara.
//  Un permiso que solo se exige en una de las puertas no es un permiso.
//
//  Por eso la regla vive acá y la usan todas. admin-data la importa; no hay
//  dos copias que se desincronicen.
// ══════════════════════════════════════════════════════════════════

export type Rol = 'dueno' | 'operaciones' | 'cumplimiento' | 'lectura' | 'tesoreria' | 'colaborador'

export interface Acceso {
  rol: Rol
  paises: string[]      // códigos ISO; para 'dueno' no se miran
  todosLosPaises: boolean
  // Miembro dado de baja: no opera NADA, ni consulta. Antes quedaba en
  // 'lectura' y seguía viendo clientes y saldos.
  desactivado?: boolean
  // Solo para 'colaborador': las secciones del panel que puede usar. Los
  // demás roles no la miran (su alcance sale del rol).
  funciones?: string[]
}

export const ROLES_VALIDOS: Rol[] = ['dueno', 'operaciones', 'cumplimiento', 'lectura', 'tesoreria', 'colaborador']

// Los permisos son gruesos a propósito: pocos roles que alguien puede
// explicar en una frase valen más que veinte casillas que nadie revisa.
//
// 'tesoreria' es la persona a la que se le delega Tesorería y Clientes. No
// lleva 'plata.mover' porque ese permiso también abre OTC, contabilidad y
// facturación: lleva 'tesoreria', que solo abre las acciones de esa pestaña.
// 'operaciones' lo tiene también, para no quitarle nada de lo que ya hacía.
export const PERMISOS_POR_ROL: Record<Rol, Set<string>> = {
  dueno:        new Set(['*']),
  operaciones:  new Set(['clientes.ver', 'clientes.editar', 'plata.ver', 'plata.mover', 'tesoreria']),
  cumplimiento: new Set(['clientes.ver', 'plata.ver', 'cumplimiento']),
  lectura:      new Set(['clientes.ver', 'plata.ver']),
  tesoreria:    new Set(['clientes.ver', 'clientes.editar', 'tesoreria']),
  // El colaborador arranca solo con ver clientes (sin eso el panel ni carga:
  // la lista de clientes la usan casi todas las secciones). Lo demás lo
  // suman sus funciones, ver permisosDe.
  colaborador:  new Set(['clientes.ver']),
}

// ── COLABORADORES: FUNCIONES POR SECCIÓN ──────────────────────────────
//
// Los roles de arriba son gruesos a propósito. El colaborador es la
// excepción pedida: el dueño marca casillas por sección del panel. Cada
// casilla da un permiso PROPIO de esa sección ('fn.<seccion>'), no uno de
// los gruesos: 'plata.mover' o 'tesoreria' abren acciones de varias
// pestañas a la vez, y marcar "Billetera" no puede regalar Cierres OTC.
// Cada acción del servidor declara qué 'fn.*' la abre (PERMISO_DE_ACCION en
// admin-data y los equipoPermite de las demás funciones).
//
// Seguridad y Configuración no son casillas: siguen siendo del dueño.
export const FUNCIONES_VALIDAS = [
  'dashboard', 'clientes', 'billetera', 'tesoreria', 'lincoin', 'otc',
  'coinsenda', 'fallos', 'reportes', 'contabilidad', 'cumplimiento',
] as const
export type Funcion = typeof FUNCIONES_VALIDAS[number]

export const PERMISOS_POR_FUNCION: Record<Funcion, string[]> = {
  dashboard:    ['fn.dashboard'],
  // Editar clientes es justo esta sección (perfil, datos, incidencias de
  // correo); el permiso grueso ya era solo de clientes.
  clientes:     ['fn.clientes', 'clientes.editar'],
  billetera:    ['fn.billetera'],
  tesoreria:    ['fn.tesoreria'],
  lincoin:      ['fn.lincoin'],
  otc:          ['fn.otc'],
  coinsenda:    ['fn.coinsenda'],
  fallos:       ['fn.fallos'],
  reportes:     ['fn.reportes'],
  contabilidad: ['fn.contabilidad'],
  // 'cumplimiento' ya era exactamente lo de esta sección (KYC, cupos,
  // límites, auditoría, monitoreo).
  cumplimiento: ['fn.cumplimiento', 'cumplimiento'],
}

// Lo que llega del navegador se limpia: solo funciones conocidas, sin
// repetir. Una casilla que este código no conoce no da nada.
export function normalizarFunciones(v: unknown): Funcion[] {
  const lista = Array.isArray(v) ? v.map(x => String(x).trim().toLowerCase()) : []
  return FUNCIONES_VALIDAS.filter(f => lista.includes(f))
}

// Los permisos efectivos de una cuenta: los de su rol y, si es
// colaborador, los de cada función marcada. TODAS las puertas usan esto
// (no PERMISOS_POR_ROL directo), si no el colaborador quedaría con solo
// "ver clientes" en unas funciones y con sus casillas en otras.
export function permisosDe(acceso: Acceso): Set<string> {
  const base = PERMISOS_POR_ROL[acceso.rol] ?? new Set<string>()
  if (acceso.rol !== 'colaborador') return base
  const s = new Set(base)
  for (const f of normalizarFunciones(acceso.funciones)) for (const p of PERMISOS_POR_FUNCION[f]) s.add(p)
  return s
}

// Una acción puede pedir uno de varios permisos (p. ej. ver un comprobante lo
// necesitan Tesorería y quien audita).
export function permite(permisos: Set<string>, necesita: string | string[] | undefined): boolean {
  if (permisos.has('*')) return true
  if (!necesita) return false
  return (Array.isArray(necesita) ? necesita : [necesita]).some(p => permisos.has(p))
}

// LO QUE NO TIENE PAÍS NO DESAPARECE.
//
// Hoy muchos clientes vienen sin país y el panel asumía "Colombia" cuando
// faltaba. Si filtrara a secas, esas personas se volverían invisibles en
// TODAS las vistas y nadie notaría que existen: ni para atenderlas, ni para
// detectar algo raro en su cuenta. Un dato que falta no es permiso para
// esconder a alguien.
//
// Así que lo no atribuible se muestra a cualquiera que tenga al menos un
// país, marcado aparte, para que alguien lo asigne. El día que opere más de
// un país de verdad, esto se endurece — y cuando eso pase habrá que decidirlo
// a propósito, no descubrirlo.
export function visibleEnPais(paisDelDato: string | null, acceso: Acceso): boolean {
  if (acceso.todosLosPaises) return true
  if (!acceso.paises.length) return false
  if (!paisDelDato) return true
  return acceso.paises.includes(paisDelDato)
}

// Qué rol y qué países tiene esta cuenta.
//
// EL DUEÑO NO SE PUEDE QUEDAR AFUERA. Si no hay fila en admin_miembros y el
// correo es el de ADMIN_EMAIL, se trata como dueño con todos los países. Sin
// esa salvedad, el día que se aplique la migración nadie —ni el dueño— podría
// entrar a crear la primera fila: el arranque dependería de algo que todavía
// no existe.
//
// Una cuenta admin SIN fila y que NO es ADMIN_EMAIL queda en 'lectura' sin
// países: ve el panel, no ve datos. Es el lado seguro del error — alguien
// avisa que no ve nada, nadie avisa que ve de más.
export async function accesoDe(db: any, userId: string, email: string, adminEmail?: string | null): Promise<Acceso> {
  const TODO: Acceso = { rol: 'dueno', paises: [], todosLosPaises: true }

  // select('*') y no la lista de columnas: si la migración de colaboradores
  // (2026_zz24) todavía no corrió, pedir 'funciones' por nombre daría
  // "column does not exist", y ese error se confunde con "tabla ausente"
  // (abajo) y convertiría a TODO admin en dueño.
  const { data: m, error } = await db.from('admin_miembros')
    .select('*').eq('id', userId).maybeSingle()

  // La tabla todavía no existe (migración sin correr). Antes de esta función
  // TODO admin veía todo; una migración que no se corrió no puede quitarle el
  // acceso a nadie. CUALQUIER OTRO error de la base es distinto: antes también
  // daba dueño, y un tropiezo de la base convertía a cualquier admin en dueño.
  // Ahí se cae al lado seguro (solo lectura) hasta que la base responda.
  const tablaAusente = (e: any) => /does not exist|42P01|PGRST205|schema cache|could not find the table/i.test(`${e?.code ?? ''} ${e?.message ?? ''}`)
  const SOLO_LECTURA: Acceso = { rol: 'lectura', paises: [], todosLosPaises: false }
  if (error) return tablaAusente(error) ? TODO : SOLO_LECTURA

  if (m && (m as any).activo) {
    const rol = String((m as any).rol) as Rol
    // Un rol que este código no conoce no recibe nada: es el lado seguro.
    if (!ROLES_VALIDOS.includes(rol)) return SOLO_LECTURA
    return {
      rol,
      paises: Array.isArray((m as any).paises) ? (m as any).paises.map(String) : [],
      todosLosPaises: rol === 'dueno',
      ...(rol === 'colaborador' ? { funciones: normalizarFunciones((m as any).funciones) } : {}),
    }
  }

  // Fila desactivada: el acceso se le quitó a propósito. Sin respaldo — si lo
  // hubiera, desactivar a alguien no haría nada.
  if (m && !(m as any).activo) return { rol: 'lectura', paises: [], todosLosPaises: false, desactivado: true }

  // ── Sin fila. Acá se decide si la restricción está ENCENDIDA ──
  //
  // La regla: los permisos por miembro empiezan a regir cuando alguien
  // empieza a usarlos. Si la tabla está vacía, el sistema todavía no está
  // configurado y todos siguen como antes; en cuanto hay aunque sea un
  // miembro cargado, una cuenta sin fila es alguien a quien no se le dio
  // acceso todavía.
  //
  // Lo aprendí rompiéndolo: la primera versión dejaba en 'lectura' a
  // cualquiera sin fila, y como el respaldo dependía de un secreto
  // (ADMIN_EMAIL) cuyo valor por defecto es de OTRO dominio, el panel se
  // quedó sin datos apenas se desplegó la función. Un permiso nuevo no puede
  // depender de que alguien haya configurado algo que todavía no sabía que
  // existía.
  const { count, error: errCount } = await db.from('admin_miembros')
    .select('id', { count: 'exact', head: true })
  if (errCount) return tablaAusente(errCount) ? TODO : SOLO_LECTURA
  if (!count) return TODO

  const esDuenoPorCorreo = !!adminEmail && !!email && email.toLowerCase() === String(adminEmail).toLowerCase()
  if (esDuenoPorCorreo) return TODO
  return { rol: 'lectura', paises: [], todosLosPaises: false }
}

// Para las funciones que no son admin-data: ¿este admin, por su rol en el
// equipo, puede pedir esto? El correo se busca solo si hace falta (cuenta sin
// fila con el equipo ya configurado).
export async function equipoPermite(
  db: any, userId: string, necesita: string | string[] | undefined,
  opciones: { email?: string | null; pais?: string | null } = {},
): Promise<{ ok: boolean; acceso: Acceso }> {
  let email = opciones.email ?? ''
  if (!email) {
    try {
      const { data } = await db.from('users').select('email').eq('id', userId).maybeSingle()
      email = String((data as any)?.email ?? '')
    } catch { /* sin correo: no puede ser el dueño por correo */ }
  }
  const acceso = await accesoDe(db, userId, email, Deno.env.get('ADMIN_EMAIL') ?? null)
  if (acceso.desactivado) return { ok: false, acceso }
  if (!permite(permisosDe(acceso), necesita)) return { ok: false, acceso }
  // El colaborador sin 2FA activo no opera en ninguna puerta (en admin-data
  // tampoco: falta2faColaborador). La sesión con 2FA la sigue exigiendo cada
  // función con requireMfaSession, como para todo el equipo.
  if (acceso.rol === 'colaborador') {
    try {
      const { data } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
      if (!(data as any)?.raw_data?.mfaEnabled) return { ok: false, acceso }
    } catch { return { ok: false, acceso } }
  }
  if (opciones.pais !== undefined && !visibleEnPais(opciones.pais, acceso)) return { ok: false, acceso }
  return { ok: true, acceso }
}
