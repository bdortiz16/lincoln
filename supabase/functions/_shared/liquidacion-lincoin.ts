// ══════════════════════════════════════════════════════════════════
//  La parte de Lincoin en un cargue o una conversión.
//
//  La factura de Lincoin es de MANDATO: por el valor de la operación, con
//  dos líneas. Lo que es del cliente (ingresos recibidos para terceros, sin
//  IVA) y lo que gana Lincoin (la comisión, IVA incluido). Total = terceros
//  + utilidad. Lo usan el panel de Contabilidad (admin-data) y la emisión
//  (facturacion), para que el número del tablero y el de la factura sean
//  el mismo.
//
//  NADA SE INVENTA
//    La utilidad sale de lo que la operación guardó al hacerse:
//    · cargue con contabilidad (acct.utilityCop: venta real − acreditado),
//    · cargue Bre-B sin USDT (la comisión por recepción, feeCop),
//    · conversión GasFree (utilityCop),
//    · conversión de la app (lincoin.utilidadCop, calculada con la tasa).
//    Un cierre de la mesa OTC no la guarda: se ESTIMA con la referencia del
//    proveedor que quedó en el cierre, y queda marcada como estimada para
//    que alguien la confirme antes de facturar. Si no hay de dónde sacarla,
//    es 'sin_dato' y no se factura sola.
// ══════════════════════════════════════════════════════════════════

export type Liquidacion = {
  tipo: 'cargue' | 'conversion'
  // Valor de la operación en pesos (terceros + utilidad) = lo que se recibió
  // por la venta.
  totalCop: number | null
  // Lo que es del cliente (lo que se le acreditó).
  tercerosCop: number | null
  // Lo de Lincoin, IVA incluido.
  utilidadCop: number | null
  fuente: 'registrada' | 'estimada' | 'sin_dato'
  // USDT/USD que entregó o recibió el cliente, si aplica.
  usd: number | null
  // USDT que de verdad llegaron (después del costo de red), si se sabe.
  usdLlego: number | null
  // Tasa a la que vendió Lincoin (o la referencia del proveedor) y tasa que
  // se le pagó/cobró al cliente, en COP por USD.
  tasaLincoin: number | null
  tasaCliente: number | null
  // Comisión Bre-B por recepción ya incluida en la utilidad.
  comisionBrebCop: number | null
  // Reverso con un ajuste: cuánto se debitó, si anuló el cargue entero, y los
  // valores antes del reverso para mostrarlos.
  reversadoCop: number | null
  anulado: boolean
  original: { totalCop: number | null; tercerosCop: number | null; utilidadCop: number | null; usd: number | null } | null
  // false = no lleva factura (registro histórico, anulado, otra moneda…).
  facturable: boolean
  // Qué valor de la operación es fijo cuando se corrige la utilidad a mano:
  // lo que recibió el cliente ('terceros', p. ej. un cargue) o lo que pagó
  // ('total', p. ej. cuando compra USDT con pesos).
  fijo: 'terceros' | 'total'
  nota: string
}

// El cierre de la mesa, con lo necesario para estimar.
export type CierreOtc = { id: string; side?: string | null; from_amount?: number | string | null; to_amount?: number | string | null; rate_final?: number | string | null; rate_fuente?: string | null }

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const esCop = (m: unknown) => /^COP/i.test(String(m ?? ''))
const fmt = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 0 })

// "finity 4.123,45 menos 0.5%" → 4123.45 (lo escribe otc-mesa con es-CO).
export function referenciaDe(fuente: unknown): number | null {
  const m = /finity\s+([\d.,]+)/i.exec(String(fuente ?? ''))
  if (!m) return null
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

const VACIA = { usdLlego: null, tasaLincoin: null, tasaCliente: null, comisionBrebCop: null, reversadoCop: null, anulado: false, original: null }

// Las tasas que no quedaron guardadas salen de la propia operación: lo que se
// recibió y lo que se le dio al cliente, divididos por los USD. Si el cliente
// pagó en pesos (compra USDT), la de Lincoin es la de los terceros.
function conTasas(l: Liquidacion): Liquidacion {
  const usd = l.usd != null && l.usd > 0 ? l.usd : null
  if (!usd) return l
  const porUsd = (v: number | null) => v != null && v > 0 ? Math.round(v / usd * 100) / 100 : null
  return {
    ...l,
    tasaLincoin: l.tasaLincoin ?? porUsd(l.fijo === 'total' ? l.tercerosCop : l.totalCop),
    tasaCliente: l.tasaCliente ?? porUsd(l.fijo === 'total' ? l.totalCop : l.tercerosCop),
  }
}

// Un cargue revertido con un ajuste (débito). El ajuste se vincula al cargue
// (solo, si cuadra, o a mano desde Contabilidad) y queda en raw_data.reverso:
//   · si se debitó todo lo acreditado, el cargue fue un error (otro cliente,
//     duplicado): se ANULA — no suma, no deja utilidad, no se factura;
//   · si se debitó una parte, al cliente se le acreditó de más y se le
//     descontó el exceso: la venta (lo recibido) no cambia, lo acreditado
//     baja y la utilidad SUBE en lo mismo (utilidad = recibido − lo que
//     finalmente quedó acreditado). Es la misma definición del cargue.
function conReverso(l: Liquidacion, rd: Record<string, any>): Liquidacion {
  const rev = rd.reverso && typeof rd.reverso === 'object' ? rd.reverso : null
  const revCop = num(rev?.montoCop) ?? 0
  const acreditado = l.tercerosCop ?? 0
  if (!(revCop > 0) || !(acreditado > 0)) return l
  const original = { totalCop: l.totalCop, tercerosCop: l.tercerosCop, utilidadCop: l.utilidadCop, usd: l.usd }
  if (rev?.anulado === true || revCop >= acreditado - 1) {
    return { ...l, original, reversadoCop: r2(revCop), anulado: true, facturable: false, tercerosCop: 0, utilidadCop: 0, totalCop: 0, usd: 0, usdLlego: 0,
      nota: `Cargue anulado: se revirtió con un ajuste de $${fmt(revCop)}.` }
  }
  const terceros = r2(acreditado - revCop)
  const util = l.utilidadCop != null ? r2(l.utilidadCop + revCop) : null
  // La tasa que de verdad quedó para el cliente, con lo acreditado ya corregido.
  const tasaCliente = l.usd && l.usd > 0 && l.tasaCliente != null ? Math.round(l.tasaCliente * (terceros + (l.comisionBrebCop ?? 0)) / (acreditado + (l.comisionBrebCop ?? 0)) * 100) / 100 : l.tasaCliente
  return {
    ...l, original, reversadoCop: r2(revCop),
    tercerosCop: terceros, utilidadCop: util, totalCop: util != null ? r2(terceros + util) : l.totalCop, tasaCliente,
    nota: `Corregido: se le acreditó de más y se le descontaron $${fmt(revCop)}. Lo recibido por la venta no cambia; la utilidad es lo recibido menos lo que quedó acreditado.`,
  }
}

// Lo que se lee de raw_data. Acepta la fila completa o la versión liviana
// del panel (columnas sueltas con el mismo nombre).
export function liquidacionDe(tx: any, cierre?: CierreOtc | null): Liquidacion | null {
  if (!tx || String(tx.status ?? '') !== 'Completado') return null
  const rd = (tx.raw_data ?? tx) as Record<string, any>
  const tipoTx = String(tx.type ?? '')
  const monto = num(tx.amount) ?? 0

  if (tipoTx === 'load') {
    const fuenteTx = String(rd.source ?? '')
    if (fuenteTx !== 'admin_cargue' && fuenteTx !== 'admin_backfill') return null
    const base: Liquidacion = { tipo: 'cargue', totalCop: null, tercerosCop: null, utilidadCop: null, fuente: 'sin_dato', usd: null, ...VACIA, facturable: true, fijo: 'terceros', nota: '' }
    if (!esCop(tx.currency)) return { ...base, facturable: false, nota: `Cargue en ${tx.currency}: la factura va en pesos.` }
    if (fuenteTx === 'admin_backfill' || rd.recordOnly === true) {
      return conReverso({ ...base, tercerosCop: monto, facturable: false, nota: 'Registro histórico: no movió saldo, no se factura.' }, rd)
    }
    const acct = rd.acct && typeof rd.acct === 'object' ? rd.acct : null
    const acreditado = num(acct?.creditedCop) ?? monto
    if (acct && num(acct.utilityCop) != null) {
      const u = num(acct.utilityCop)!
      const breb = num(acct.feeCopBreb)
      return conReverso(conTasas({
        ...base, tercerosCop: r2(acreditado), utilidadCop: r2(u), totalCop: r2(acreditado + u), fuente: 'registrada',
        usd: num(acct.usdtGross), usdLlego: num(acct.usdtNet), tasaLincoin: num(acct.sellRate), tasaCliente: num(acct.clientRate),
        comisionBrebCop: breb != null && breb > 0 ? breb : null, nota: '',
      }), rd)
    }
    const fee = num(rd.feeCop)
    if (fee != null && fee > 0) {
      const bruto = num(rd.grossCop) ?? acreditado + fee
      return conReverso({ ...base, tercerosCop: r2(acreditado), utilidadCop: r2(fee), totalCop: r2(bruto), fuente: 'registrada', comisionBrebCop: fee, nota: 'Cargue en pesos por Bre-B: la utilidad es la comisión por recepción.' }, rd)
    }
    return conReverso({ ...base, tercerosCop: r2(acreditado), nota: 'El cargue no guardó la contabilidad (USDT, tasa de venta): no hay utilidad registrada.' }, rd)
  }

  if (tipoTx === 'convert') {
    const base: Liquidacion = { tipo: 'conversion', totalCop: null, tercerosCop: null, utilidadCop: null, fuente: 'sin_dato', usd: null, ...VACIA, facturable: true, fijo: 'terceros', nota: '' }
    // Conversión de la app (admin-data apply_conversion): la utilidad se
    // calcula en el servidor con la tasa vigente y queda guardada.
    const lc = rd.lincoin && typeof rd.lincoin === 'object' ? rd.lincoin : null
    if (lc && num(lc.utilidadCop) != null && num(lc.totalCop) != null) {
      const u = num(lc.utilidadCop)!, t = num(lc.totalCop)!
      return conTasas({ ...base, totalCop: r2(t), utilidadCop: r2(u), tercerosCop: r2(t - u), fuente: 'registrada', usd: num(lc.usd), fijo: esCop(tx.currency) ? 'total' : 'terceros', nota: '' })
    }
    // GasFree: el cliente vende USDT, recibe pesos.
    if (rd.gasfree === true || String(rd.source ?? '') === 'MOUV') {
      if (!esCop(tx.currency)) return { ...base, facturable: false, nota: `Conversión acreditada en ${tx.currency}.` }
      const u = num(rd.utilityCop)
      if (u == null) return conTasas({ ...base, tercerosCop: r2(monto), usd: num(rd.fromAmount), nota: 'La conversión no guardó la utilidad.' })
      return conTasas({ ...base, tercerosCop: r2(monto), utilidadCop: r2(u), totalCop: r2(monto + u), fuente: 'registrada', usd: num(rd.fromAmount), tasaLincoin: num(rd.mouvRate), nota: '' })
    }
    // Mesa OTC: se estima con la referencia del proveedor del cierre.
    if (String(rd.source ?? '') === 'OTC_MANUAL') {
      const ref = referenciaDe(cierre?.rate_fuente)
      const lado = String(cierre?.side ?? (String(rd.fromCurrency ?? '').toUpperCase().startsWith('USD') ? 'vende_usdt' : 'compra_usdt'))
      const desde = num(cierre?.from_amount) ?? num(rd.fromAmount)
      const hasta = num(cierre?.to_amount) ?? num(rd.destAmount) ?? monto
      const tasaFinal = num(cierre?.rate_final) ?? num(rd.mouvRate)
      if (lado === 'vende_usdt') {
        // Entrega USDT (desde), recibe pesos (hasta).
        if (!ref || desde == null || hasta == null) return conTasas({ ...base, tercerosCop: hasta != null ? r2(hasta) : null, usd: desde, tasaCliente: tasaFinal, nota: 'Cierre de mesa sin referencia del proveedor: falta la utilidad.' })
        const total = r2(desde * ref)
        return conTasas({ ...base, totalCop: total, tercerosCop: r2(hasta), utilidadCop: r2(total - hasta), fuente: 'estimada', usd: desde, tasaLincoin: ref, tasaCliente: tasaFinal, nota: `Estimada con la referencia del cierre (${ref.toLocaleString('es-CO')} COP/USD). Confirmala antes de facturar.` })
      }
      // Compra USDT: paga pesos (desde), recibe USDT (hasta).
      if (!ref || desde == null || hasta == null) return conTasas({ ...base, totalCop: desde != null ? r2(desde) : null, usd: hasta, tasaCliente: tasaFinal, fijo: 'total', nota: 'Cierre de mesa sin referencia del proveedor: falta la utilidad.' })
      const terceros = r2(hasta * ref)
      return conTasas({ ...base, totalCop: r2(desde), tercerosCop: terceros, utilidadCop: r2(desde - terceros), fuente: 'estimada', usd: hasta, tasaLincoin: ref, tasaCliente: tasaFinal, fijo: 'total', nota: `Estimada con la referencia del cierre (${ref.toLocaleString('es-CO')} COP/USD). Confirmala antes de facturar.` })
    }
    return { ...base, nota: 'La conversión no guardó la utilidad de Lincoin.' }
  }
  return null
}
