// ── Candado contra envíos duplicados ─────────────────────────────────────
//
// Dos toques seguidos al botón Confirmar (o dos pestañas, o un reintento
// mientras el primero sigue en vuelo) llegan al servidor como DOS pedidos
// casi al mismo tiempo. Los controles de "¿ya hay uno igual?" que leen la
// tabla de movimientos no alcanzan: los dos pedidos leen antes de que el
// primero escriba, los dos pasan, y la plata sale dos veces.
//
// Este candado lo resuelve en la base: el primer pedido INSERTA la clave y
// el segundo choca con la llave primaria. Es atómico; no hay ventana.
//
// La clave vence (ttlSeg): pasado ese tiempo otro pedido puede tomarla, con
// un update condicional que también es atómico (solo gana uno).
//
// Si la tabla todavía no existe (falta correr la migración), devuelve
// 'sin_tabla' y quien llama sigue como antes: el candado se suma a los
// controles que ya había, no los reemplaza.
export type ResultadoCandado = 'ok' | 'ocupado' | 'sin_tabla'

export async function reclamarCandado(db: any, clave: string, ttlSeg: number, userId: string | null, accion: string): Promise<ResultadoCandado> {
  const fila = { clave, user_id: userId, accion, creado_at: new Date().toISOString() }
  const { error } = await db.from('envio_candados').insert(fila)
  if (!error) return 'ok'
  const msg = String(error?.message ?? '')
  const code = String(error?.code ?? '')
  if (code === '23505' || /duplicate key|already exists/i.test(msg)) {
    // Ya hay alguien con esa clave. Solo se puede tomar si ya venció.
    const vencida = new Date(Date.now() - ttlSeg * 1000).toISOString()
    const { data } = await db.from('envio_candados')
      .update({ creado_at: new Date().toISOString(), user_id: userId, accion })
      .eq('clave', clave).lt('creado_at', vencida).select('clave')
    return Array.isArray(data) && data.length ? 'ok' : 'ocupado'
  }
  // Tabla ausente u otro error de la base: no se frena el envío por un
  // candado que no se pudo consultar (los demás controles siguen en pie).
  console.warn('[candado] no disponible:', code, msg.slice(0, 160))
  return 'sin_tabla'
}

// Se suelta cuando el envío NO salió (rechazo claro, saldo devuelto), para que
// un reintento legítimo no tenga que esperar a que venza.
export async function soltarCandado(db: any, clave: string): Promise<void> {
  try { await db.from('envio_candados').delete().eq('clave', clave) } catch { /* vence solo */ }
}
