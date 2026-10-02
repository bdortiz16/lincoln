// ── Escritura ATÓMICA de raw_data ──────────────────────────────────────
// raw_data guarda cosas de dueños distintos (beneficiarios del cliente,
// antecedentes de TusDatos, AML de Kumplo, notificaciones…). Leer el blob,
// cambiar una parte y volver a guardarlo ENTERO pisaba lo que otro proceso
// escribió en el medio: así desaparecían beneficiarios recién inscritos.
// Estas dos funciones cambian solo su clave / su ruta, en la base y bajo
// bloqueo de fila (migración 2026_raw_data_atomico.sql). Si la migración
// todavía no se corrió, caen a releer justo antes de escribir.
// deno-lint-ignore-file no-explicit-any

const sinFuncion = (m: string) => /function .*does not exist|PGRST202|Could not find the function|schema cache/i.test(m)

export async function mergeRaw(db: any, userId: string, patch: Record<string, unknown>): Promise<string | null> {
  if (!userId) return 'sin_usuario'
  const { error } = await db.rpc('raw_data_merge', { p_user: userId, p_patch: patch })
  if (!error) return null
  if (!sinFuncion(String(error.message ?? ''))) return String(error.message)
  const { data } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
  const raw = { ...((data as any)?.raw_data ?? {}), ...patch }
  const r = await db.from('users').update({ raw_data: raw }).eq('id', userId)
  return r.error ? String(r.error.message) : null
}

export async function setRawPath(db: any, userId: string, path: string[], value: unknown, merge = true): Promise<string | null> {
  if (!userId || !path.length) return 'sin_ruta'
  const { error } = await db.rpc('raw_data_set_path', { p_user: userId, p_path: path, p_value: value, p_merge: merge })
  if (!error) return null
  if (!sinFuncion(String(error.message ?? ''))) return String(error.message)
  // Respaldo: lectura fresca, se arma la ruta y se guarda solo la clave raíz.
  const { data } = await db.from('users').select('raw_data').eq('id', userId).maybeSingle()
  const raw = { ...((data as any)?.raw_data ?? {}) }
  const raiz = path[0]
  const copia: any = JSON.parse(JSON.stringify(raw[raiz] ?? {}))
  if (path.length === 1) {
    const nuevo = merge && copia && typeof copia === 'object' && value && typeof value === 'object' && !Array.isArray(value) ? { ...copia, ...(value as any) } : value
    return mergeRaw(db, userId, { [raiz]: nuevo })
  }
  let nodo = copia
  for (let i = 1; i < path.length - 1; i++) {
    if (!nodo[path[i]] || typeof nodo[path[i]] !== 'object') nodo[path[i]] = {}
    nodo = nodo[path[i]]
  }
  const ult = path[path.length - 1]
  nodo[ult] = merge && nodo[ult] && typeof nodo[ult] === 'object' && value && typeof value === 'object' && !Array.isArray(value) ? { ...nodo[ult], ...(value as any) } : value
  return mergeRaw(db, userId, { [raiz]: copia })
}
