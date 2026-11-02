// ══════════════════════════════════════════════════════════════════
//  Cómo se le factura a cada cliente (la factura de Lincoin, de mandato).
//
//  · 'colombia' → UNA factura por cliente y por día, al día siguiente (día
//    vencido), con todo lo que movió ese día: terceros + comisión sumados.
//  · 'exterior' → una factura por MOVIMIENTO. Son empresas de otros países
//    (Perú, Brasil…) que no facturan en Colombia: cada operación lleva la
//    suya.
//
//  Por defecto lo decide el país con que se registró la empresa; si el país
//  no basta, se ajusta a mano en la ficha del cliente (tabla
//  lincoin_modelo_cliente, 2026_zz28). Lo usan facturacion (qué emitir) y
//  admin-data (Contabilidad, el Excel para la contadora).
// ══════════════════════════════════════════════════════════════════

export type ModeloFactura = 'colombia' | 'exterior'
export type ModeloCliente = { modelo: ModeloFactura; pais: string | null; manual: boolean }

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

// Colombia (o sin país: lo normal es que sea de acá) → 'colombia'.
// Cualquier otro país → 'exterior'.
export function modeloPorPais(pais: unknown): ModeloFactura {
  const p = sinTildes(String(pais ?? '')).trim().toLowerCase()
  if (!p) return 'colombia'
  return ['colombia', 'co', 'col', 'republica de colombia'].includes(p) ? 'colombia' : 'exterior'
}

export const NOMBRE_MODELO: Record<ModeloFactura, string> = {
  colombia: 'Colombia · factura diaria',
  exterior: 'Exterior · por movimiento',
}

// El modelo de varios clientes a la vez. Sin la tabla (falta la migración),
// manda el país.
export async function modelosDe(db: any, ids: string[]): Promise<Map<string, ModeloCliente>> {
  const out = new Map<string, ModeloCliente>()
  const unicos = Array.from(new Set(ids.map(String).filter(Boolean)))
  if (!unicos.length) return out
  const manuales = new Map<string, ModeloFactura>()
  for (let i = 0; i < unicos.length; i += 150) {
    const parte = unicos.slice(i, i + 150)
    const [{ data: us }, man] = await Promise.all([
      db.from('users').select('id, country, pais:raw_data->>companyCountry').in('id', parte),
      db.from('lincoin_modelo_cliente').select('user_id, modelo').in('user_id', parte),
    ])
    for (const m of ((man?.data ?? []) as any[])) if (m?.modelo === 'colombia' || m?.modelo === 'exterior') manuales.set(String(m.user_id), m.modelo)
    for (const u of (us ?? []) as any[]) {
      const pais = String(u.country ?? u.pais ?? '').trim() || null
      const manual = manuales.get(String(u.id))
      out.set(String(u.id), { modelo: manual ?? modeloPorPais(pais), pais, manual: !!manual })
    }
  }
  for (const id of unicos) if (!out.has(id)) out.set(id, { modelo: manuales.get(id) ?? 'colombia', pais: null, manual: manuales.has(id) })
  return out
}

// Día en Colombia (UTC−5) de un instante: "2026-11-01".
export const diaBogota = (iso: string) => new Date(Date.parse(iso) - 5 * 3600_000).toISOString().slice(0, 10)
// Inicio y fin (exclusivo) de un día de Colombia, en UTC.
export const rangoDiaBogota = (dia: string) => {
  const ini = new Date(`${dia}T05:00:00.000Z`)
  return { desde: ini.toISOString(), hasta: new Date(ini.getTime() + 86400000).toISOString() }
}
// Clave de la factura diaria en facturas_lincoin.transaction_id. La primera
// del día es "dia:<cliente>:<día>"; si después del envío aparece una
// operación tardía de ese mismo día, va en una complementaria ":2", ":3"…
export const claveDiaria = (userId: string, dia: string, n = 1) => `dia:${userId}:${dia}${n > 1 ? `:${n}` : ''}`
export function leerClaveDiaria(clave: string): { userId: string; dia: string; n: number } | null {
  const m = /^dia:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})(?::(\d+))?$/i.exec(String(clave ?? ''))
  return m ? { userId: m[1], dia: m[2], n: m[3] ? Number(m[3]) : 1 } : null
}
