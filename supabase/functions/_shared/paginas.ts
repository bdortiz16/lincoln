// ── Leer muchas filas sin perder ninguna ──────────────────────────────────
// PostgREST devuelve como mucho 1.000 filas por consulta y NO avisa cuando
// corta: un `select` sobre todos los usuarios "funcionaba" hasta que hubo
// más de 1.000 cuentas, y desde ahí el resto quedaba fuera en silencio (de
// una cola de cumplimiento, de un chequeo antes de borrar algo, de una suma).
//
// Esto lee de a 1.000, avanzando por id (no por OFFSET: saltar 90.000 filas
// para leer las 1.000 siguientes se vuelve lento justo cuando hay muchas).
// `armar` devuelve la consulta YA filtrada y sin orden ni rango; el orden por
// id lo pone esta función. Con `alLote`, cada página se procesa y se suelta:
// así una revisión de 100.000 cuentas no tiene que caber entera en memoria.
// `tope` corta un filtro demasiado amplio y lo dice (truncado).

export async function leerPorPaginas(
  armar: () => any,
  opciones: { tope?: number; alLote?: (lote: any[]) => void | Promise<void> } = {},
): Promise<{ filas: any[]; leidas: number; truncado: boolean }> {
  const tope = opciones.tope ?? 200_000
  const filas: any[] = []
  let leidas = 0
  let ultimo: string | null = null
  while (leidas < tope) {
    let q = armar().order('id', { ascending: true }).limit(1000)
    if (ultimo) q = q.gt('id', ultimo)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const lote = (data ?? []) as any[]
    leidas += lote.length
    if (opciones.alLote) await opciones.alLote(lote)
    else filas.push(...lote)
    if (lote.length < 1000) return { filas, leidas, truncado: false }
    ultimo = String(lote[lote.length - 1].id)
  }
  return { filas, leidas, truncado: true }
}
