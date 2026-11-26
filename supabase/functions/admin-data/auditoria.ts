// ─────────────────────────────────────────────────────────────
// Auditoría de movimientos (Reportes → Auditoría del panel).
//
// Pedido del dueño (20 nov): la auditoría era la lista de los últimos 200
// movimientos que el panel tenía en memoria, sin fecha, sin cliente, sin el
// canal por donde salió la plata ni el id del proveedor. Para auditar (o
// contestar un requerimiento) hace falta, por cada movimiento: por dónde pasó
// (Mouv, Finity, Coinsenda Jero o Kaupaloki, mesa OTC, ajuste del admin…),
// los ids del proveedor y de Lincoin, la contraparte, quién lo hizo y lo que
// dijo la revisión de riesgo.
//
// Acá solo se LEE y se normaliza lo que cada flujo dejó guardado en la fila
// (columnas y raw_data). Cada flujo guardó las cosas con nombres distintos
// a lo largo del tiempo, así que se prueban los nombres conocidos en orden y
// se toma el primero que tenga valor. Nunca se inventa: lo que no quedó
// guardado sale vacío.
// ─────────────────────────────────────────────────────────────

export type CanalAudit = { clave: string; proveedor: string; cuenta: string | null; riel: string | null; etiqueta: string }

const txt = (v: unknown): string | null => {
  if (v == null) return null
  if (typeof v === 'string') { const s = v.trim(); return s ? s : null }
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  return null
}
const num = (v: unknown): number | null => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null }
// El primer valor con texto entre varias rutas ("a.b.c") de un objeto.
export function primero(o: Record<string, unknown>, rutas: string[]): string | null {
  for (const r of rutas) {
    let v: unknown = o
    for (const k of r.split('.')) { v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined }
    const t = txt(v)
    if (t) return t
  }
  return null
}

export const TIPOS_ENTRADA = new Set(['load', 'pay_received', 'referral_payout', 'otc_deposit', 'deposit', 'deposito', 'receive', 'recarga'])
export const TIPOS_SALIDA = new Set(['dispersion', 'send', 'transfer', 'pay_sent', 'otc_withdraw', 'withdraw', 'retiro'])
export const TIPOS_OTC = new Set(['convert', 'otc_deposit', 'otc_withdraw'])
export const TIPO_TXT: Record<string, string> = {
  dispersion: 'Envío a banco', send: 'Retiro', transfer: 'Envío', pay_sent: 'Pago a otra cuenta Lincoin', pay_received: 'Pago de otra cuenta Lincoin',
  load: 'Entrada / cargue', convert: 'Conversión', otc_deposit: 'Depósito OTC', otc_withdraw: 'Retiro OTC',
  referral_payout: 'Pago de referido', withdraw: 'Retiro', deposit: 'Depósito', deposito: 'Depósito',
  adjustment: 'Ajuste de saldo (débito)', rail_move: 'Movimiento entre cuentas propias',
}
export const ESTADOS_OK = ['Completado', 'Liquidado', 'Aprobado']
export const ESTADOS_MAL = ['Rechazado', 'Fallido', 'Devuelto', 'Anulado', 'Cancelado']
// Las llaves de raw_data que decide canalDe: el resumen las pide solas, sin
// traer el raw_data entero de miles de filas.
export const CLAVES_CANAL = ['rail', 'proveedor', 'source', 'cuentaBreb', 'cuentaAch', 'otcCloseId', 'otcRef', 'gasfree', 'providerName', 'psp', 'method', 'direction']

// ¿Lo hizo el admin? Los cargues y débitos manuales (admin_credit_balance)
// guardan source 'admin_cargue' / 'admin_backfill' y quién en `por`; los de
// cripto, 'admin_manual'. Un ajuste negativo se guarda con type 'adjustment'.
function esDelAdmin(tx: Record<string, unknown>, rd: Record<string, unknown>): boolean {
  const src = String(rd.source ?? '').toLowerCase()
  return String(tx.type ?? '') === 'adjustment' || src.startsWith('admin_')
}

const CUENTA_DE_MONEDA: Record<string, { clave: string; proveedor: string; cuenta: string }> = {
  COP_BREB: { clave: 'mouv', proveedor: 'Mouv', cuenta: 'Cuenta 1' },
  COP_ACH: { clave: 'finity', proveedor: 'Finity', cuenta: 'Cuenta 2' },
  COP_C3: { clave: 'coinsenda_jero', proveedor: 'Coinsenda Jero', cuenta: 'Cuenta 3' },
  COP_C4: { clave: 'coinsenda_kaupaloki', proveedor: 'Coinsenda Kaupaloki', cuenta: 'Cuenta 4' },
}
const ETIQUETA_CLAVE: Record<string, string> = {
  mouv: 'Mouv · Cuenta 1', finity: 'Finity · Cuenta 2', coinsenda_jero: 'Coinsenda Jero · Cuenta 3', coinsenda_kaupaloki: 'Coinsenda Kaupaloki · Cuenta 4',
  otc: 'Mesa OTC', conversion: 'Conversión USDT', usdt: 'USDT (TRON)', admin: 'Cargues y ajustes del admin', interno: 'Entre cuentas Lincoin', otro: 'Otros',
}
export const etiquetaClave = (clave: string) => ETIQUETA_CLAVE[clave] ?? clave

// Por dónde pasó la plata. Cada saldo es de un proveedor: Cuenta 1 (COP_BREB)
// = Mouv, Cuenta 2 (COP_ACH) = Finity — su ACH y también el Bre-B por la
// Cuenta 2 —, Cuenta 3 (COP_C3) = Coinsenda Jero y Cuenta 4 (COP_C4) =
// Coinsenda Kaupaloki. Antes que la moneda mandan: la mesa OTC, el admin,
// los pagos entre cuentas Lincoin (van en la moneda de quien paga, también
// COP_BREB, y no pasan por Mouv) y las conversiones de USDT.
// Ojo: todo envío a banco guarda source 'mouv_payout' aunque haya salido por
// Finity o Coinsenda; el que dice el proveedor es `proveedor` o la moneda.
export function canalDe(tx: Record<string, unknown>): CanalAudit {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  const tipo = String(tx.type ?? '')
  const cur = String(tx.currency ?? '').toUpperCase()
  const src = String(rd.source ?? '').toLowerCase()
  const rail = String(rd.rail ?? '').toUpperCase()
  const prov = String(rd.proveedor ?? '').toLowerCase()
  const c = CUENTA_DE_MONEDA[cur] ?? null
  const armar = (clave: string, proveedor: string, cuenta: string | null, riel: string | null, etiqueta?: string): CanalAudit =>
    ({ clave, proveedor, cuenta, riel, etiqueta: etiqueta ?? [proveedor, cuenta, riel].filter(Boolean).join(' · ') })

  if (rd.otcCloseId || rd.otcRef || src === 'otc_manual') return armar('otc', 'Mesa OTC', c?.cuenta ?? null, null, `Mesa OTC${c ? ` → ${c.cuenta} (${c.proveedor})` : ''}`)
  if (esDelAdmin(tx, rd)) {
    const que = src === 'conciliacion' ? 'Reconstruido por conciliación' : 'Cargue o ajuste del admin'
    return armar('admin', 'Admin Lincoin', c?.cuenta ?? (cur === 'COP' ? 'Saldo Lincoin' : cur || null), null, `${que}${c ? ` · ${c.cuenta} (${c.proveedor})` : ''}`)
  }
  if (tipo === 'pay_sent' || tipo === 'pay_received' || tipo === 'referral_payout' || tipo === 'rail_move') {
    const que = tipo === 'rail_move' ? `Entre cuentas propias${rd.fromRail ? ` · ${rd.fromRail} → ${rd.toRail ?? '?'}` : ''}` : rd.psp ? 'Empresa ↔ operador (Lincoin)' : 'Entre cuentas Lincoin'
    return armar('interno', 'Lincoin', c?.cuenta ?? (cur === 'COP' ? 'Saldo Lincoin' : cur || null), null, que)
  }
  if (tipo === 'convert' || rd.gasfree) {
    const p = txt(rd.providerName) ?? (src === 'mouv' ? 'Mouv / Finity' : null)
    return armar('conversion', p ? `Conversión · ${p}` : 'Conversión', c?.cuenta ?? (cur || null), null, `Conversión USDT${p ? ` · ${p}` : ''}${c ? ` → ${c.cuenta}` : ''}`)
  }
  if (cur.startsWith('USD') || src === 'gasfree' || src === 'usdt_consolidation') return armar('usdt', 'USDT (TRON)', cur || null, 'TRON')
  // Entradas sin envío: PSE de Mouv (saldo COP) y link de pago de Finity.
  if (src === 'mouv_payin_pse') return armar('mouv', 'Mouv', 'Saldo Lincoin', 'PSE')
  if (src === 'finity_payment_link') return armar('finity', 'Finity', 'Cuenta 2', 'Link de pago')
  if (c) {
    // El proveedor guardado manda sobre la moneda (un Bre-B por la Cuenta 2
    // dice 'finity' y paga con COP_ACH: misma cuenta, otro riel).
    const proveedor = prov === 'mouv' ? 'Mouv' : prov === 'finity' ? 'Finity' : c.proveedor
    const riel = src === 'mouv_breb_recaudo' ? 'Bre-B (recaudo)' : rail === 'BREB' ? 'Bre-B' : rail === 'ACH' ? 'ACH' : c.clave === 'mouv' ? 'Bre-B' : null
    return armar(c.clave, proveedor, c.cuenta, riel)
  }
  return armar('otro', cur || '—', cur === 'COP' ? 'Saldo Lincoin' : null, null, cur === 'COP' ? 'Saldo Lincoin' : (cur || 'Otro'))
}

export function sentidoDe(tx: Record<string, unknown>): 'entra' | 'sale' | 'otro' {
  const t = String(tx.type ?? '')
  if (TIPOS_ENTRADA.has(t)) return 'entra'
  if (TIPOS_SALIDA.has(t)) return 'sale'
  const m = Number(tx.amount)
  return m > 0 ? 'entra' : m < 0 ? 'sale' : 'otro'
}

export function idsDe(tx: Record<string, unknown>) {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  const o = { ...rd, ...tx } as Record<string, unknown>
  return {
    // Envíos: providerRef (Mouv, Finity, Coinsenda). Recaudo Bre-B:
    // providerTransferId / depositId. Conversiones: providerTraceId, el id de
    // Finity de la conversión o el traceId de GasFree.
    proveedor: primero(o, ['providerRef', 'coinsenda.retiro', 'providerTransferId', 'depositId', 'providerTraceId', 'finityConvId', 'traceId']),
    // Lo que le mandamos al proveedor: solo Mouv recibe referencia en los
    // envíos (providerReference); el PSE guarda la suya en reference.
    nuestra: primero(o, ['providerReference', 'reference', 'otcRef', 'cashReference']),
    e2e: primero(o, ['endToEndId', 'end_to_end_id', 'cus', 'CUS']),
    otc: primero(o, ['otcCloseId']),
    hash: primero(o, ['txHash', 'txId']),
  }
}

export function contraparteDe(tx: Record<string, unknown>) {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  const o = { ...rd, ...tx } as Record<string, unknown>
  const entra = TIPOS_ENTRADA.has(String(tx.type ?? ''))
  // Bre-B recibido: quien pagó (pagador*). Envíos: el beneficiario y, si el
  // proveedor confirmó otro titular, también ese (titularProveedor).
  const banco = primero(o, ['pagadorBanco', 'bancoDestino', 'bank', 'recipient.bankName', 'recipient.bankCode'])
  const titular = primero(o, ['titularProveedor'])
  const nombre = primero(o, entra
    ? ['pagador', 'senderName', 'counterpartyName', 'fromAddress', 'beneficiary']
    : ['beneficiary', 'recipient.holderName', 'recipientName', 'counterpartyName', 'beneficiaryName', 'toAddress'])
  return {
    nombre: nombre && titular && titular.toUpperCase() !== nombre.toUpperCase() ? `${nombre} (titular según el proveedor: ${titular})` : (nombre ?? titular),
    doc: primero(o, entra ? ['pagadorDocumento', 'documentNumber'] : ['benefDoc', 'documentNumber', 'recipient.documentNumber']),
    docTipo: primero(o, ['documentType', 'recipient.documentType']),
    banco: banco ? banco.replace(/^Bre-B\s*·\s*/i, '') : null,
    cuenta: primero(o, entra ? ['llave', 'fromAddress', 'account'] : ['account', 'recipient.accountNumber', 'recipient.key', 'toAddress']),
    tipoCuenta: primero(o, ['recipient.accountType', 'accountType', 'recipient.keyType']),
  }
}

export function motivoRechazoDe(tx: Record<string, unknown>): string | null {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  const e = rd.error
  const m = primero({ ...rd, e: typeof e === 'string' ? e : (e as any)?.message ?? (e as any)?.body?.message } as Record<string, unknown>,
    ['rejectReason', 'anulacionOtc.motivo', 'providerError', 'errorMessage', 'returnReason', 'motivoDiag', 'e', 'pasoFallido'])
  return m ? m.slice(0, 400) : null
}

export function marcasDe(tx: Record<string, unknown>): string[] {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  const out: string[] = []
  if (rd.anulacionOtc) out.push('cierre OTC anulado')
  if (rd.reversado || rd.refunded) out.push('reversado: la plata volvió')
  if (rd.reembolsoExterno) out.push('reembolso externo')
  if (rd.reembolsoPendiente || rd.reembolsoIncierto || rd.reembolsoFallido) out.push('reembolso por resolver')
  if (rd.devueltoDespuesDeCompletado || rd.devolucionTardia) out.push('devuelto después de completado')
  if (rd.reversaDe) out.push('reversa de un cargue')
  if (rd.reverso && typeof rd.reverso === 'object') out.push('cargue reversado')
  if (rd.desenlaceDesconocido || rd.estadoDesconocido) out.push('resultado incierto con el proveedor')
  if (rd.revisionManual || rd.needsReview) out.push('en revisión manual')
  if (rd.confirmadaManualmente) out.push('confirmado a mano')
  if (rd.manualReturn) out.push('devuelto a mano')
  if (rd.reconstruido) out.push('reconstruido por conciliación')
  if (rd.creditoIncierto || rd.creditoFallido) out.push('crédito por revisar')
  if (rd.amountMismatch) out.push('monto distinto al del proveedor')
  if (rd.insertadoPorCliente) out.push('creado desde el navegador del cliente')
  const ref = txt(rd.providerRefOrigen)
  if (ref) out.push(`id del proveedor ${ref.startsWith('pegado') ? 'pegado a mano' : 'tomado de la conciliación'}`)
  if (rd.oculto) out.push('oculto en tesorería')
  return out
}

// La revisión de riesgo NO queda en el movimiento: vive en la ficha del
// beneficiario (users.raw_data.tusdatos.beneficiarios[doc]) y es la de HOY,
// no necesariamente la del día del envío. La trae el servidor aparte.
export function docRiesgoDe(tx: Record<string, unknown>): string | null {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  if (!['dispersion', 'send'].includes(String(tx.type ?? ''))) return null
  const d = (primero(rd, ['benefDoc', 'documentNumber', 'recipient.documentNumber']) ?? '').replace(/\D/g, '')
  return d.length >= 5 ? d : null
}

// Quién lo hizo. Los cargues del admin guardan `por`; los envíos solo
// guardan la cuenta (la sesión que pidió el envío es la del propio cliente).
export function iniciadorDe(tx: Record<string, unknown>): { id: string | null; nombre: string | null; email: string | null; via: string | null } | null {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  const id = primero(rd, ['por.id'])
  const nombre = primero(rd, ['por.nombre'])
  const email = primero(rd, ['por.email'])
  if (id || nombre || email) return { id, nombre, email, via: `admin${txt((rd.por as any)?.rol) ? ` (${(rd.por as any).rol})` : ''}` }
  return null
}
// Quién lo resolvió después: aprobó, rechazó, confirmó, devolvió o anuló.
export function resolvioDe(tx: Record<string, unknown>): string | null {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  const rp = rd.resueltoPor as any
  if (rp && typeof rp === 'object') return [txt(rp.nombre), txt(rp.email)].filter(Boolean).join(' · ') || txt(rp.id)
  const an = rd.anulacionOtc as any
  if (an && typeof an === 'object') return `Anuló: ${txt(an.porNombre) ?? txt(an.por) ?? '—'}`
  const otros: [string, string][] = [['confirmadaPor', 'Confirmó'], ['returnedBy', 'Devolvió'], ['completadaPor', 'Completó (mesa OTC)'], ['adminSettledBy', 'Liquidó']]
  for (const [k, t] of otros) { const v = txt(rd[k]); if (v) return `${t}: ${v}` }
  return null
}
// Los momentos del movimiento que quedaron guardados, en orden.
export function hitosDe(tx: Record<string, unknown>): { k: string; at: string }[] {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  const pares: [string, string[]][] = [
    ['Solicitado', ['requestedAt']],
    ['Aceptado por el proveedor', ['aceptadaAt', 'acceptedAt']],
    ['Pagado por el cliente', ['paidAt']],
    ['Confirmado por el proveedor', ['confirmadoAt']],
    ['Acreditado', ['acreditadoAt', 'creditedAt']],
    ['Convertido', ['convertedAt']],
    ['Liquidado', ['settledAt', 'adminSettledAt']],
    ['Conciliado', ['reconciledAt']],
    ['Fallido', ['failedAt']],
    ['Devuelto', ['returnedAt']],
    ['Reversado', ['reversadoAt']],
    ['Anulado', ['anulacionOtc.at']],
  ]
  const out: { k: string; at: string }[] = []
  for (const [k, rutas] of pares) { const v = primero(rd, rutas); if (v && !isNaN(Date.parse(v))) out.push({ k, at: v }) }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

export function costosDe(tx: Record<string, unknown>) {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  return {
    costo: num(rd.feeCop ?? rd.comisionCop ?? rd.fee),
    costoProveedor: num(rd.costoProveedorCop ?? rd.totalProveedorCop),
  }
}

export function motivoDe(tx: Record<string, unknown>): string | null {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  return primero(rd, ['motivoTexto', 'motivo', 'reason', 'note', 'description', 'feeConcept'])
}
