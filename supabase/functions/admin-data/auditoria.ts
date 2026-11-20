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
  dispersion: 'Envío a banco', send: 'Retiro', transfer: 'Envío', pay_sent: 'Pago enviado', pay_received: 'Pago recibido',
  load: 'Cargue / depósito', convert: 'Conversión OTC', otc_deposit: 'Depósito OTC', otc_withdraw: 'Retiro OTC',
  referral_payout: 'Pago de referido', withdraw: 'Retiro', deposit: 'Depósito', deposito: 'Depósito',
}
export const ESTADOS_OK = ['Completado', 'Liquidado', 'Aprobado']
export const ESTADOS_MAL = ['Rechazado', 'Fallido', 'Devuelto', 'Anulado', 'Cancelado']
// Las llaves de raw_data que decide canalDe: el resumen las pide solas, sin
// traer el raw_data entero de miles de filas.
export const CLAVES_CANAL = ['rail', 'riel', 'otcCloseId', 'otc_close_id', 'ajuste', 'ajusteSaldo', 'adjustment', 'esAjuste', 'adminId', 'admin_id', 'cargadoPor', 'cargueAdmin', 'manualAdmin', 'porAdmin', 'source', 'origen', 'txHash']

// ¿Lo hizo el admin (cargue manual, ajuste de saldo, retiro registrado)?
function esDelAdmin(rd: Record<string, unknown>): boolean {
  return !!(rd.ajuste || rd.ajusteSaldo || rd.adjustment || rd.esAjuste || rd.adminId || rd.admin_id || rd.cargadoPor || rd.cargueAdmin || rd.manualAdmin || rd.porAdmin
    || String(rd.source ?? rd.origen ?? '').toLowerCase().includes('admin'))
}

// Por dónde pasó la plata. La moneda dice la cuenta (cada cuenta es de un
// proveedor: Cuenta 1 · Bre-B = Mouv, Cuenta 2 · ACH = Finity — también el
// Bre-B por la Cuenta 2, que se paga con el saldo ACH —, Cuenta 3 = Coinsenda
// Jero, Cuenta 4 = Coinsenda Kaupaloki); el tipo y las marcas dicen si fue
// la mesa OTC, el admin o un pago entre cuentas Lincoin.
export function canalDe(tx: Record<string, unknown>): CanalAudit {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  const tipo = String(tx.type ?? '')
  const cur = String(tx.currency ?? '').toUpperCase()
  const rail = String(rd.rail ?? rd.riel ?? '').toUpperCase()
  const riel = rail === 'BREB' || rail === 'BRE-B' ? 'Bre-B' : rail === 'ACH' ? 'ACH' : rail === 'TRON' || rail === 'TRC20' ? 'TRON' : null
  const cuentaDe = (): { proveedor: string; cuenta: string; clave: string } | null => {
    if (cur === 'COP_BREB') return { clave: 'mouv', proveedor: 'Mouv', cuenta: 'Cuenta 1' }
    if (cur === 'COP_ACH') return { clave: 'finity', proveedor: 'Finity', cuenta: 'Cuenta 2' }
    if (cur === 'COP_C3') return { clave: 'coinsenda_jero', proveedor: 'Coinsenda Jero', cuenta: 'Cuenta 3' }
    if (cur === 'COP_C4') return { clave: 'coinsenda_kaupaloki', proveedor: 'Coinsenda Kaupaloki', cuenta: 'Cuenta 4' }
    return null
  }
  const c = cuentaDe()
  if (TIPOS_OTC.has(tipo) || rd.otcCloseId || rd.otc_close_id) {
    const dest = c ? ` → ${c.cuenta} (${c.proveedor})` : ''
    return { clave: 'otc', proveedor: 'Mesa OTC', cuenta: c?.cuenta ?? null, riel: null, etiqueta: `Mesa OTC${dest}` }
  }
  if (esDelAdmin(rd)) {
    return { clave: 'admin', proveedor: 'Admin Lincoin', cuenta: c?.cuenta ?? (cur === 'COP' ? 'Saldo Lincoin' : cur || null), riel: null, etiqueta: `Cargue o ajuste del admin${c ? ` · ${c.cuenta}` : ''}` }
  }
  if (c) {
    const r = c.clave === 'mouv' ? 'Bre-B' : (riel ?? (c.clave === 'finity' ? 'ACH' : null))
    return { clave: c.clave, proveedor: c.proveedor, cuenta: c.cuenta, riel: r, etiqueta: `${c.proveedor} · ${c.cuenta}${r ? ` · ${r}` : ''}` }
  }
  if (cur.startsWith('USD') || rd.txHash || riel === 'TRON') return { clave: 'usdt', proveedor: 'USDT (TRON)', cuenta: cur || null, riel: 'TRON', etiqueta: 'USDT (TRON)' }
  if (tipo === 'pay_sent' || tipo === 'pay_received' || tipo === 'referral_payout') return { clave: 'interno', proveedor: 'Lincoin', cuenta: cur === 'COP' ? 'Saldo Lincoin' : cur || null, riel: null, etiqueta: 'Entre cuentas Lincoin' }
  return { clave: 'otro', proveedor: cur || '—', cuenta: null, riel, etiqueta: cur || 'Otro' }
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
    proveedor: primero(o, ['providerRef', 'provider_ref', 'providerTraceId', 'providerId', 'provider_id', 'providerTxId', 'mouvId', 'mouv_id', 'finityId', 'finity_id', 'coinsendaId', 'coinsenda_id', 'externalId', 'external_id', 'traceId', 'payoutId', 'transferId', 'respuestaProveedor.id', 'provider.id']),
    nuestra: primero(o, ['providerReference', 'provider_reference', 'referenciaProveedor', 'reference', 'referencia', 'idempotencyKey', 'clientReference']),
    e2e: primero(o, ['endToEndId', 'end_to_end_id', 'e2e', 'e2eId', 'cus', 'CUS', 'trazabilidad', 'trackingKey']),
    otc: primero(o, ['otcCloseId', 'otc_close_id', 'otcId']),
    hash: primero(o, ['txHash', 'tx_hash', 'hash']),
  }
}

export function contraparteDe(tx: Record<string, unknown>) {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  const o = { ...rd, ...tx } as Record<string, unknown>
  const banco = primero(o, ['bank', 'bankName', 'recipient.bankName', 'recipient.bank', 'senderBank', 'payerBank'])
  return {
    nombre: primero(o, ['beneficiary', 'beneficiaryName', 'recipientName', 'recipient.holderName', 'recipient.name', 'counterpartyName', 'senderName', 'pagador', 'payerName', 'remitente', 'ordenante.nombre', 'recipient.ordenante.nombre']),
    doc: primero(o, ['benefDoc', 'documentNumber', 'recipient.documentNumber', 'recipient.docNumber', 'senderDocument', 'payerDocument', 'remitenteDoc']),
    docTipo: primero(o, ['documentType', 'recipient.documentType', 'recipient.docType', 'senderDocumentType']),
    banco: banco ? banco.replace(/^Bre-B\s*·\s*/i, '') : null,
    cuenta: primero(o, ['account', 'accountNumber', 'recipient.accountNumber', 'recipient.key', 'llave', 'key', 'address', 'senderAccount', 'payerAccount']),
    tipoCuenta: primero(o, ['accountType', 'recipient.accountType', 'tipoCuenta']),
  }
}

export function motivoRechazoDe(tx: Record<string, unknown>): string | null {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  const e = rd.error
  const m = primero({ ...rd, e: typeof e === 'string' ? e : (e as any)?.message ?? (e as any)?.body?.message } as Record<string, unknown>,
    ['rejectReason', 'providerError', 'errorMessage', 'returnReason', 'motivoRechazo', 'e', 'failureReason'])
  return m ? m.slice(0, 400) : null
}

export function marcasDe(tx: Record<string, unknown>): string[] {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  const out: string[] = []
  if (rd.anulacionOtc) out.push('cierre OTC anulado')
  if (rd.reversado || rd.refunded) out.push('reversado: la plata volvió')
  if (rd.reembolsoExterno) out.push('reembolso externo')
  if (rd.ajuste || rd.ajusteSaldo || rd.adjustment || rd.esAjuste) out.push('ajuste de saldo')
  if (rd.desenlaceDesconocido) out.push('resultado incierto con el proveedor')
  return out
}

// La revisión de riesgo que quedó en la fila, si quedó alguna.
export function riesgoDe(tx: Record<string, unknown>): { nivel: string | null; detalle: string | null } | null {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  const nivel = primero(rd, ['riesgo.nivel', 'risk.level', 'risk.nivel', 'aml.nivel', 'aml.level', 'aml.riesgo', 'sarblock.nivel', 'sarblock.level', 'kyt.riesgo', 'kyt.nivel', 'amlNivel', 'riskLevel', 'nivelRiesgo'])
  const detalle = primero(rd, ['riesgo.resumen', 'risk.summary', 'aml.resumen', 'aml.detalle', 'sarblock.resumen', 'kyt.resumen', 'amlDetalle', 'riskSummary'])
  if (!nivel && !detalle) {
    const ok = rd.amlOk ?? (rd.aml as any)?.ok
    if (ok === true) return { nivel: 'Sin hallazgos', detalle: null }
    if (ok === false) return { nivel: 'Con hallazgos', detalle: null }
    return null
  }
  return { nivel, detalle }
}

// Quién lo hizo: el operador de la empresa o el admin, cuando quedó guardado.
export function iniciadorDe(tx: Record<string, unknown>): { id: string | null; nombre: string | null; email: string | null; via: string | null } | null {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  const id = primero(rd, ['operadorId', 'operador.id', 'operatorId', 'createdBy', 'created_by', 'actorId', 'adminId', 'admin_id', 'admin.id', 'por.id'])
  const nombre = primero(rd, ['operadorNombre', 'operador.nombre', 'operatorName', 'createdByName', 'adminNombre', 'admin.nombre', 'por.nombre'])
  const email = primero(rd, ['operadorEmail', 'operador.email', 'operatorEmail', 'createdByEmail', 'adminEmail', 'admin.email', 'por.email'])
  const via = primero(rd, ['canalOrigen', 'via', 'origen', 'source'])
  if (!id && !nombre && !email) return null
  return { id, nombre, email, via }
}

export function costosDe(tx: Record<string, unknown>) {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  return {
    costo: num(rd.feeCop ?? rd.fee ?? rd.comision),
    costoProveedor: num(rd.costoProveedorCop ?? rd.providerFee ?? rd.costoProveedor),
  }
}

export function motivoDe(tx: Record<string, unknown>): string | null {
  const rd = (tx.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {}) as Record<string, unknown>
  return primero(rd, ['motivo', 'reason', 'concepto', 'description', 'note', 'descripcion'])
}
