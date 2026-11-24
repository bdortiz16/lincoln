// ── SIREL (UIAF): lo que se reporta de las operaciones con activos virtuales
//
// Pedido del dueño (2026-11): un panel en Cumplimiento que arme la información
// para reportar a la UIAF por SIREL — primero las empresas (clientes) y luego
// todas las transacciones con activos virtuales hechas a través de Lincoin —,
// y que el oficial la descargue y la suba él mismo en SIREL.
//
// Acá van las reglas puras (sin base de datos), para poder probarlas:
//   · qué movimiento es una operación con activos virtuales y de qué tipo;
//   · los datos de cada cliente y lo que le falta para el reporte.
//
// No se inventa nada: si un dato no está guardado (el hash de un envío por
// GasFree, la wallet de origen de un USDT vendido en la mesa, el CIIU), la
// celda va vacía y la fila dice qué falta. Un reporte a la UIAF con un dato
// supuesto es peor que uno que dice "falta".
//
// En Lincoin el saldo "USD" ES USDT (los depósitos por GasFree se acreditan
// como USD): por eso USD cuenta como activo virtual.

import type { VigenciaTcrm } from '../_shared/tcrm.ts'

export type TipoOperacionAv = 'deposito' | 'retiro' | 'venta' | 'compra'

export const ETIQUETA_TIPO: Record<TipoOperacionAv, string> = {
  deposito: 'Depósito de activo virtual',
  retiro: 'Retiro / envío de activo virtual',
  venta: 'Venta de activo virtual (recibe COP)',
  compra: 'Compra de activo virtual (paga COP)',
}

export type OperacionAv = {
  id: string
  fecha: string
  userId: string
  tipo: TipoOperacionAv
  activo: string            // USDT, USDC, EURC
  red: string | null
  cantidad: number          // en el activo
  valorUsd: number | null   // USDT/USDC 1:1; EURC sin tasa → null
  valorCop: number | null   // solo cuando hubo conversión con COP
  tasaCop: number | null
  walletCliente: string | null
  walletContraparte: string | null
  hash: string | null
  traza: string | null      // referencia del proveedor (no es el hash)
  referencia: string | null // ref. de la mesa OTC u otra
  cierreOtcId: string | null // el cierre de la mesa (otc_closes), para traer la wallet de origen
  origen: string            // de dónde sale el registro
  // Lo que escribió a mano el oficial o el operador del cargue (raw_data.sirel).
  manual: { campos: string[]; por: string | null; at: string | null } | null
  faltan: string[]
}

// ── Datos de la cadena escritos a mano (raw_data.sirel) ────────────────
// 24 nov: las 126 operaciones de octubre eran cargues de USDT y el cargue no
// guardaba la wallet del cliente, el hash ni la wallet que recibió: el
// archivo de la UIAF salía incompleto y SIREL lo rechaza. El oficial (o el
// operador al hacer el cargue) los escribe; aquí se validan para que un
// campo cruzado (la wallet en el hash, una dirección TRON en una red EVM)
// no llegue al reporte.
export const REDES_SIREL = ['TRON (TRC-20)', 'Ethereum (ERC-20)', 'BNB Smart Chain (BEP-20)', 'Polygon', 'Base', 'Arbitrum', 'Solana', 'Bitcoin', 'TON'] as const
export type DatosCripto = { red?: string; walletCliente?: string; hash?: string; walletContraparte?: string }
export const CAMPOS_CRIPTO = ['red', 'walletCliente', 'hash', 'walletContraparte'] as const

const esTron = (red: string) => /TRON|TRC/i.test(red)
const esEvm = (red: string) => /ETH|ERC|BNB|BSC|BEP|POLYGON|MATIC|BASE|ARBITRUM/i.test(red)

// Solo valida los campos que vienen (un campo vacío = borrarlo). `redActual`
// es la red que ya tiene la operación, para revisar el formato contra ella.
export function limpiarDatosCripto(input: any, redActual?: string | null): { ok: true; datos: DatosCripto; borrar: string[] } | { ok: false; error: string } {
  const datos: DatosCripto = {}
  const borrar: string[] = []
  if (!input || typeof input !== 'object') return { ok: true, datos, borrar }
  const tiene = (k: string) => Object.prototype.hasOwnProperty.call(input, k)
  for (const k of CAMPOS_CRIPTO) {
    if (!tiene(k)) continue
    const v = String(input[k] ?? '').trim()
    if (!v) { borrar.push(k); continue }
    if (k === 'red') {
      if (v.length > 40 || !/^[\p{L}\p{N} ()\-.]+$/u.test(v)) return { ok: false, error: 'La red no es válida.' }
    } else if (k === 'hash') {
      if (!/^(0x)?[A-Za-z0-9]{32,140}$/.test(v)) return { ok: false, error: 'El hash no tiene un formato válido (solo letras y números, sin espacios).' }
    } else if (!/^[A-Za-z0-9]{20,128}$/.test(v)) {
      return { ok: false, error: `${k === 'walletCliente' ? 'La wallet del cliente' : 'La wallet que recibió'} no tiene un formato válido.` }
    }
    ;(datos as any)[k] = v
  }
  const red = datos.red ?? (borrar.includes('red') ? '' : String(redActual ?? ''))
  const wallets: [string, string | undefined][] = [['La wallet del cliente', datos.walletCliente], ['La wallet que recibió', datos.walletContraparte]]
  if (esTron(red)) {
    for (const [n, w] of wallets) if (w && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(w)) return { ok: false, error: `${n} no es una dirección TRON (empieza por T y tiene 34 caracteres).` }
    if (datos.hash && !/^[0-9a-fA-F]{64}$/.test(datos.hash)) return { ok: false, error: 'El hash de TRON tiene 64 caracteres hexadecimales.' }
  } else if (esEvm(red)) {
    for (const [n, w] of wallets) if (w && !/^0x[0-9a-fA-F]{40}$/.test(w)) return { ok: false, error: `${n} no es una dirección de ${red} (0x y 40 caracteres).` }
    if (datos.hash && !/^0x[0-9a-fA-F]{64}$/.test(datos.hash)) return { ok: false, error: `El hash de ${red} empieza por 0x y tiene 64 caracteres más.` }
  }
  if (datos.walletCliente && datos.walletContraparte && datos.walletCliente === datos.walletContraparte) return { ok: false, error: 'La wallet del cliente y la que recibió no pueden ser la misma.' }
  return { ok: true, datos, borrar }
}

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const texto = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return s ? s : null
}

// USD (que en Lincoin es USDT), USDT, USDT_TRON, USDC_BSC, EURC…
export function activoDe(moneda: unknown): string | null {
  const m = String(moneda ?? '').toUpperCase()
  if (m === 'USD' || m.startsWith('USDT')) return 'USDT'
  if (m.startsWith('USDC')) return 'USDC'
  if (m.startsWith('EURC') || m.startsWith('EURT')) return m.startsWith('EURT') ? 'EURT' : 'EURC'
  return null
}
const esCop = (moneda: unknown) => String(moneda ?? '').toUpperCase().startsWith('COP')

export function redDe(moneda: unknown, rd: any): string | null {
  const dicha = texto(rd?.network ?? rd?.extra?.network ?? rd?.red)
  if (dicha) return dicha
  const m = String(moneda ?? '').toUpperCase()
  if (m.includes('TRON')) return 'TRON (TRC-20)'
  if (m.includes('BSC')) return 'BNB Smart Chain (BEP-20)'
  if (m.includes('BASE')) return 'Base'
  if (rd?.gasfree === true || String(rd?.source ?? '').toLowerCase() === 'gasfree') return 'TRON (TRC-20)'
  return null
}

// Una dirección de wallet (TRON T…, EVM 0x…): para no tomar una cuenta de
// banco por wallet en un envío en USD.
export const pareceWallet = (v: unknown): boolean => {
  const s = String(v ?? '').trim()
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s) || /^0x[0-9a-fA-F]{40}$/.test(s)
}

const hashDe = (rd: any): string | null => texto(rd?.txId ?? rd?.txHash ?? rd?.hash ?? rd?.txid)

// Movimientos internos de Lincoin que no son operaciones de un cliente.
const FUENTES_INTERNAS = new Set(['USDT_CONSOLIDATION'])

// El movimiento (fila de `transactions`, ya Completado) como operación con
// activos virtuales, o null si no lo es.
export function operacionAv(t: any): OperacionAv | null {
  const rd = (t?.raw_data && typeof t.raw_data === 'object') ? t.raw_data : {}
  const tipoMov = String(t?.type ?? '')
  const moneda = String(t?.currency ?? '')
  const fuente = String(rd.source ?? '')
  if (FUENTES_INTERNAS.has(fuente) || tipoMov === 'admin_hot_withdrawal') return null
  if (rd?.reverso?.anulado === true || rd?.oculto === true) return null
  const base = {
    id: String(t.id), fecha: String(t.created_at), userId: String(t.user_id),
    red: redDe(moneda, rd), valorCop: null as number | null, tasaCop: null as number | null,
    walletCliente: null as string | null, walletContraparte: null as string | null,
    hash: hashDe(rd), traza: texto(rd.traceId ?? rd.providerTraceId), referencia: texto(rd.otcRef),
    cierreOtcId: texto(rd.otcCloseId),
  }
  let op: Omit<OperacionAv, 'valorUsd' | 'faltan' | 'manual'> | null = null

  // Depósito de USDT por GasFree, o depósito cripto acreditado a mano.
  if (tipoMov === 'load' && fuente === 'GASFREE') {
    op = { ...base, tipo: 'deposito', activo: 'USDT', cantidad: num(t.amount) ?? 0,
      walletCliente: texto(rd.toAddress), walletContraparte: texto(rd.fromAddress), origen: 'Depósito GasFree' }
  } else if (tipoMov === 'otc_deposit' && activoDe(moneda)) {
    op = { ...base, tipo: 'deposito', activo: activoDe(moneda)!, cantidad: num(t.amount) ?? 0,
      walletContraparte: texto(rd.fromAddress), origen: 'Depósito acreditado a mano' }
  // Cargue: el cliente entregó USDT y se le acreditaron pesos (venta). Los
  // USDT salen de la wallet del cliente (fromAddress) hacia la que recibe.
  } else if (tipoMov === 'load' && (fuente === 'admin_cargue' || fuente === 'admin_backfill') && Number(rd?.acct?.usdtGross) > 0) {
    op = { ...base, tipo: 'venta', activo: 'USDT', cantidad: Number(rd.acct.usdtGross),
      valorCop: num(rd.acct.creditedCop) ?? num(t.amount), tasaCop: num(rd.acct.clientRate) ?? num(rd.acct.sellRate),
      walletCliente: texto(rd.fromAddress ?? rd.acct?.fromAddress), walletContraparte: texto(rd.toAddress ?? rd.acct?.toAddress),
      origen: fuente === 'admin_backfill' ? 'Cargue (registro histórico)' : 'Cargue de USDT' }
  // Envío de cripto a una wallet.
  } else if (tipoMov === 'send' && activoDe(moneda)) {
    const destino = texto(rd.account ?? rd.beneficiary ?? rd.toAddress)
    const esCripto = String(moneda).toUpperCase() !== 'USD' || pareceWallet(destino) || rd.gasfree === true || fuente.toLowerCase() === 'gasfree'
    if (!esCripto) return null
    op = { ...base, tipo: 'retiro', activo: activoDe(moneda)!, cantidad: num(t.amount) ?? 0,
      walletCliente: texto(rd.fromWallet ?? rd.fromAddress), walletContraparte: destino, origen: 'Envío a wallet' }
  // Conversión entre cripto y pesos (GasFree → Mouv, mesa OTC, conversión en la app).
  } else if (tipoMov === 'convert') {
    const desde = String(rd.fromCurrency ?? '')
    const hacia = String(rd.targetCurrency ?? moneda)
    if (activoDe(desde) && esCop(moneda)) {
      // Vende cripto, recibe pesos: el monto del movimiento son los pesos.
      // En la conversión por GasFree el USDT sale de la wallet del cliente a
      // la del proveedor de liquidez: esa es la contraparte.
      op = { ...base, tipo: 'venta', activo: activoDe(desde)!, cantidad: num(rd.usdtOut) ?? num(rd.fromAmount) ?? 0,
        valorCop: num(rd.destAmount) ?? num(t.amount), tasaCop: num(rd.mouvRate),
        walletContraparte: texto(rd.providerAddress),
        origen: fuente === 'OTC_MANUAL' ? 'Mesa OTC' : fuente === 'MOUV' ? 'Conversión USDT → COP' : 'Conversión' }
    } else if (esCop(desde) && activoDe(moneda)) {
      // Paga pesos, recibe cripto: el monto del movimiento es la cripto.
      op = { ...base, tipo: 'compra', activo: activoDe(moneda)!, cantidad: num(t.amount) ?? num(rd.destAmount) ?? 0,
        valorCop: num(rd.fromAmount), tasaCop: num(rd.mouvRate),
        walletContraparte: texto(rd.payoutWallet ?? rd.wallet), origen: fuente === 'OTC_MANUAL' ? 'Mesa OTC' : 'Conversión' }
    } else if (!desde && activoDe(moneda) && esCop(hacia)) {
      // Conversión en la app (apply_conversion): el movimiento va en la moneda de origen.
      op = { ...base, tipo: 'venta', activo: activoDe(moneda)!, cantidad: num(t.amount) ?? 0,
        valorCop: num(rd.targetAmount) ?? num(rd?.lincoin?.totalCop), tasaCop: null, origen: 'Conversión en la app' }
    } else if (!desde && esCop(moneda) && activoDe(hacia)) {
      op = { ...base, tipo: 'compra', activo: activoDe(hacia)!, cantidad: num(rd.targetAmount) ?? 0,
        valorCop: num(t.amount), tasaCop: null, origen: 'Conversión en la app' }
    }
  }
  if (!op || !(op.cantidad > 0)) return null
  // Lo escrito a mano manda sobre lo que se dedujo del movimiento.
  const s = (rd.sirel && typeof rd.sirel === 'object') ? rd.sirel : {}
  const camposManual = CAMPOS_CRIPTO.filter(k => texto(s[k]))
  for (const k of camposManual) (op as any)[k] = texto(s[k])
  const manual = camposManual.length ? { campos: [...camposManual], por: texto(s.por?.nombre ?? s.por?.email), at: texto(s.at) } : null
  // USDT y USDC valen un dólar; EURC no tiene tasa guardada (no se supone).
  const valorUsd = op.activo === 'USDT' || op.activo === 'USDC' ? Math.round(op.cantidad * 100) / 100 : null
  if (op.tasaCop == null && op.valorCop && op.cantidad) op.tasaCop = Math.round((op.valorCop / op.cantidad) * 100) / 100
  const faltan: string[] = []
  if (!op.hash && (op.tipo === 'deposito' || op.tipo === 'retiro')) faltan.push(op.traza ? 'hash (hay traza del proveedor)' : 'hash')
  if (!op.walletContraparte) faltan.push('wallet contraparte')
  if (!op.red) faltan.push('red')
  if (valorUsd == null) faltan.push('valor en USD')
  return { ...op, valorUsd, manual, faltan }
}

// ── Lo que pide el archivo plano de la UIAF y no está en el movimiento ────
// (24 nov, el dueño: "en la UIAF es un solo archivo… busca el formato de la
// UIAF"). El Anexo 3 de la Resolución 314 pide, por operación, el valor en
// pesos a la TCRM del día y el saldo del activo virtual que le quedó al
// cliente después. Ninguno de los dos se guarda con el movimiento: la TCRM
// sale de la fuente oficial y el saldo se reconstruye solo cuando se puede
// afirmar (ver saldoDespues). Si no, la fila dice que falta.

// Día de la operación en Colombia (la TCRM y la fecha del reporte son de Bogotá).
export const diaBogota = (iso: unknown): string | null => {
  const t = Date.parse(String(iso ?? ''))
  return Number.isFinite(t) ? new Date(t - 5 * 3600_000).toISOString().slice(0, 10) : null
}

// La TCRM certificada que rige un día: cada fila de la Superfinanciera
// (datos.gov.co 32sa-8pi3) cubre de vigenciadesde a vigenciahasta (un fin de
// semana es una sola fila).
export function tcrmDelDia(dia: string | null, tabla: VigenciaTcrm[]): number | null {
  if (!dia) return null
  const f = tabla.find(v => v.desde <= dia && dia <= v.hasta)
  return f ? f.valor : null
}

// Qué activo es cada bolsillo del saldo: USD es USDT en Lincoin (ver arriba).
export function activoDeBolsillo(clave: unknown): string | null {
  const k = String(clave ?? '').toUpperCase()
  if (k === 'USD' || k.startsWith('USDT')) return 'USDT'
  if (k.startsWith('USDC')) return 'USDC'
  if (k.startsWith('EURC')) return 'EURC'
  return null
}

// Lo que el cliente tiene hoy de un activo, sumando sus bolsillos (USD + USDT_TRON…).
export function saldoDelActivo(balances: unknown, activo: string): number | null {
  if (!balances || typeof balances !== 'object') return 0
  let s = 0
  for (const [k, v] of Object.entries(balances as Record<string, unknown>)) {
    if (activoDeBolsillo(k) !== activo) continue
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    s += n
  }
  return Math.round(s * 1e8) / 1e8
}

// ¿Este movimiento pudo cambiar el bolsillo del activo? Basta con que alguna
// de sus monedas (la de la fila, la de origen o destino de una conversión, el
// riel liquidado, el bolsillo debitado) sea de ese activo.
export function tocaActivo(t: any, activo: string): boolean {
  const rd = (t?.raw_data && typeof t.raw_data === 'object') ? t.raw_data : {}
  // Un cierre de la mesa OTC solo acredita los pesos: los USDT salen de la
  // wallet propia del cliente, no de su saldo en Lincoin (efecto-saldo.ts).
  if (String(t?.source ?? rd.source ?? '') === 'OTC_MANUAL') return activoDeBolsillo(t?.currency) === activo
  const monedas = [t?.currency, t?.fromCurrency ?? rd.fromCurrency, t?.targetCurrency ?? rd.targetCurrency, t?.destCurrency ?? rd.destCurrency,
    t?.settledRail ?? rd.settledRail, t?.debitadoCol ?? rd.debitadoCol, t?.fromRail ?? rd.fromRail, t?.toRail ?? rd.toRail]
  return monedas.some(m => activoDeBolsillo(m) === activo)
}

// El saldo del activo que le quedó al cliente después de la operación.
// Se afirma solo si desde entonces NINGÚN otro movimiento del cliente tocó
// ese activo (ni uno nuevo ni uno viejo que cambió de estado: una devolución
// reescribe la misma fila y se ve en updated_at). En ese caso el saldo de
// después es exactamente el de hoy. Si alguno lo tocó, no se adivina.
export function saldoDespues(
  op: { id: string; fecha: string; activo: string },
  saldoHoy: number | null,
  movsCliente: { id: string; created_at: string; updated_at?: string | null }[],
): { saldo: number | null; motivo: string | null } {
  if (saldoHoy == null) return { saldo: null, motivo: `el saldo de ${op.activo} guardado no es un número` }
  const t0 = Date.parse(op.fecha)
  const toca = movsCliente.filter(m => m.id !== op.id && tocaActivo(m, op.activo))
  const despues = toca.filter(m => Date.parse(m.created_at) > t0 || Date.parse(String(m.updated_at ?? '')) > t0)
  if (despues.length) return { saldo: null, motivo: `${despues.length} movimiento(s) en ${op.activo} después de esta operación` }
  // updated_at de `transactions` no lo mueve un trigger: una devolución que
  // reescribió una fila anterior después de la operación no se ve ahí. Si en
  // la semana previa hubo un movimiento del activo devuelto, rechazado o sin
  // cerrar, pudo cambiar el saldo después: no se afirma.
  const abiertos = toca.filter(m => {
    const c = Date.parse(m.created_at)
    const x = m as any
    return c <= t0 && c > t0 - 7 * 86400_000 && (String(x.status ?? 'Completado') !== 'Completado' || x.refunded === true || x.refunded === 'true')
  })
  if (abiertos.length) return { saldo: null, motivo: `${abiertos.length} movimiento(s) en ${op.activo} de la semana anterior devueltos o sin cerrar` }
  if (saldoHoy < 0) return { saldo: null, motivo: `el saldo de ${op.activo} guardado es negativo` }
  return { saldo: saldoHoy, motivo: null }
}

// ── Clientes ─────────────────────────────────────────────────────────────
export type ClienteSirel = {
  userId: string
  tipoPersona: 'juridica' | 'natural'
  tipoDocumento: string
  documento: string | null
  dv: number | null
  nombre: string | null
  pais: string | null
  municipioCodigo: string | null
  municipio: string | null
  departamento: string | null
  direccion: string | null
  telefono: string | null
  correo: string | null
  repNombre: string | null
  repTipoDoc: string | null
  repDocumento: string | null
  vinculadoAt: string | null
  estado: 'activo' | 'bloqueado' | 'sin_verificar'
  kyc: string | null
  faltan: string[]
}

// DV del NIT (DIAN): pesos 3, 7, 13, 17… sobre los dígitos de derecha a izquierda.
export function dvNit(base: string): number | null {
  const d = String(base ?? '').replace(/\D/g, '')
  if (!d || d.length > 15) return null
  const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]
  let s = 0
  for (let i = 0; i < d.length; i++) s += Number(d[d.length - 1 - i]) * pesos[i]
  const r = s % 11
  return r > 1 ? 11 - r : r
}

export const VERIFICADO = new Set(['verified', 'approved'])

// La fila de `users` (con los alias rd_* de raw_data) como cliente del
// reporte. `municipioDe` resuelve el código DANE desde el texto de la ciudad.
export function clienteSirel(u: any, municipioDe: (t: string | null) => { codigo: string; nombre: string; deptoNombre: string } | null): ClienteSirel {
  const juridica = String(u.role ?? '') === 'business' || String(u.tax_id_type ?? u.rd_tipo_doc ?? '').toUpperCase() === 'NIT'
  const tipoDocumento = juridica ? 'NIT' : String(u.doc_type ?? u.rd_tipo_doc ?? 'CC').toUpperCase()
  const crudo = juridica ? (u.tax_id ?? u.rd_nit ?? u.rd_tax_id ?? u.rd_doc) : (u.doc_number ?? u.rd_doc ?? u.tax_id)
  let documento = texto(String(crudo ?? '').replace(/[^\dA-Za-z]/g, ''))
  // NIT: 9 dígitos de base; si vino con el DV pegado (10 dígitos que cuadran), se separa.
  if (juridica && documento && /^\d{10}$/.test(documento) && dvNit(documento.slice(0, 9)) === Number(documento[9])) documento = documento.slice(0, 9)
  const dv = juridica && documento && /^\d+$/.test(documento) ? dvNit(documento) : null
  const nombre = texto(juridica ? (u.company_name ?? u.rd_empresa ?? u.full_name ?? u.name) : (u.full_name ?? u.name ?? u.company_name))
  const ciudad = texto(juridica ? (u.company_city ?? u.city) : (u.city ?? u.company_city))
  const muni = municipioDe(ciudad)
  const repNombre = texto(u.rep_legal_name) ?? texto([u.rep_first_name, u.rep_last_name].filter(Boolean).join(' ')) ?? texto(u.rd_rep)
  const kyc = texto(u.kyc_status)
  const estado: ClienteSirel['estado'] = u.is_blocked ? 'bloqueado' : VERIFICADO.has(String(kyc)) ? 'activo' : 'sin_verificar'
  const c: ClienteSirel = {
    userId: String(u.id), tipoPersona: juridica ? 'juridica' : 'natural', tipoDocumento, documento, dv, nombre,
    pais: texto(juridica ? (u.company_country ?? u.country) : (u.country ?? u.company_country)),
    municipioCodigo: muni?.codigo ?? null, municipio: muni?.nombre ?? ciudad, departamento: muni?.deptoNombre ?? null,
    direccion: texto(juridica ? (u.company_address ?? u.address) : (u.address ?? u.company_address)),
    telefono: texto(u.phone), correo: texto(u.email),
    repNombre: juridica ? repNombre : null, repTipoDoc: juridica ? texto(u.rep_doc_type) : null, repDocumento: juridica ? texto(u.rep_doc_number) : null,
    vinculadoAt: texto(u.created_at), estado, kyc, faltan: [],
  }
  if (!c.documento) c.faltan.push(juridica ? 'NIT' : 'documento')
  if (!c.nombre) c.faltan.push(juridica ? 'razón social' : 'nombre')
  if (!c.direccion) c.faltan.push('dirección')
  if (!c.municipioCodigo) c.faltan.push(ciudad ? `municipio DANE (dice "${ciudad}")` : 'municipio')
  if (!c.telefono) c.faltan.push('teléfono')
  if (juridica && !c.repNombre) c.faltan.push('representante legal')
  if (juridica && !c.repDocumento) c.faltan.push('documento del representante')
  return c
}

// ── El reporte de la EMPRESA cliente (Compliance → SIREL) ───────────────
// Pedido del dueño (2026-11): una empresa que también reporta a la UIAF
// (por ejemplo, es PSAV) ve en su Compliance sus transacciones hechas por
// Lincoin en el mes o el día, con sus contrapartes, para armar su reporte.
// Desde su lado: un cobro trae a quien pagó; un pago, al beneficiario; una
// conversión de USDT, a Lincoin. Nunca el nombre de un aliado de
// infraestructura (la regla de marca: el cliente no ve Mouv, Finity…).

export type TipoMovEmpresa = 'cobro' | 'pago' | 'recarga' | 'av_deposito' | 'av_retiro' | 'av_venta' | 'av_compra'

export const ETIQUETA_MOV_EMPRESA: Record<TipoMovEmpresa, string> = {
  cobro: 'Cobro recibido', pago: 'Pago enviado', recarga: 'Recarga de saldo',
  av_deposito: 'Depósito de activo virtual', av_retiro: 'Retiro de activo virtual',
  av_venta: 'Venta de activo virtual', av_compra: 'Compra de activo virtual',
}

export type MovEmpresa = {
  id: string
  fecha: string
  tipo: TipoMovEmpresa
  medio: string
  moneda: string
  monto: number
  montoCop: number | null
  contraparteNombre: string | null
  contraparteTipoDoc: string | null
  contraparteDoc: string | null
  contraparteBanco: string | null
  contraparteCuenta: string | null
  referencia: string | null
  // Solo en las operaciones con activos virtuales.
  activo: string | null
  red: string | null
  hash: string | null
  faltan: string[]
}

const medioPorMoneda = (moneda: string, rd: any): string => {
  const rail = String(rd?.rail ?? '').toUpperCase()
  if (rail === 'BREB') return 'Bre-B'
  if (rail === 'ACH') return 'ACH'
  const m = moneda.toUpperCase()
  if (m.includes('BREB')) return 'Bre-B'
  if (m.includes('ACH')) return 'ACH'
  return 'Saldo Lincoin'
}

export function movimientoEmpresa(t: any): MovEmpresa | null {
  const rd = (t?.raw_data && typeof t.raw_data === 'object') ? t.raw_data : {}
  if (rd.refunded === true || rd?.reverso?.anulado === true || rd?.oculto === true) return null
  const tipoMov = String(t?.type ?? '')
  const moneda = String(t?.currency ?? '')
  const fuente = String(rd.source ?? '')
  const base = { id: String(t.id), fecha: String(t.created_at), activo: null as string | null, red: null as string | null, hash: null as string | null }

  // Operaciones con activos virtuales (las mismas reglas del reporte de Lincoin).
  const av = operacionAv(t)
  if (av) {
    const conLincoin = av.tipo === 'venta' || av.tipo === 'compra'
    const m: MovEmpresa = {
      ...base, tipo: (`av_${av.tipo}`) as TipoMovEmpresa,
      medio: `${av.activo}${av.red ? ` · ${av.red}` : ''}`, moneda: av.activo, monto: av.cantidad, montoCop: av.valorCop,
      // En una venta o compra de USDT la contraparte de la empresa es Lincoin;
      // en un depósito o un retiro, la wallet del otro lado.
      contraparteNombre: conLincoin ? 'Lincoin' : null, contraparteTipoDoc: null, contraparteDoc: null,
      contraparteBanco: null, contraparteCuenta: conLincoin ? null : av.walletContraparte,
      referencia: av.referencia, activo: av.activo, red: av.red, hash: av.hash, faltan: [],
    }
    if (!conLincoin && !m.contraparteCuenta) m.faltan.push('wallet de la contraparte')
    if ((av.tipo === 'deposito' || av.tipo === 'retiro') && !av.hash) m.faltan.push('hash')
    return m
  }

  // Pago a un beneficiario (dispersión por Bre-B o ACH).
  if ((tipoMov === 'dispersion' || tipoMov === 'send') && String(moneda).toUpperCase().startsWith('COP')) {
    const r = rd.recipient ?? {}
    const m: MovEmpresa = {
      ...base, tipo: 'pago', medio: medioPorMoneda(moneda, rd), moneda: 'COP', monto: num(t.amount) ?? 0, montoCop: num(t.amount),
      contraparteNombre: texto(rd.beneficiary ?? r.holderName ?? r.name),
      contraparteTipoDoc: texto(rd.documentType ?? r.documentType),
      contraparteDoc: texto(rd.documentNumber ?? rd.benefDoc ?? r.documentNumber),
      contraparteBanco: texto(rd.bank ?? r.bankName ?? r.bankCode),
      contraparteCuenta: texto(rd.account ?? r.key ?? r.accountNumber),
      referencia: texto(rd.motivoTexto ?? rd.reason ?? rd.motivo ?? r.reference),
      faltan: [],
    }
    if (!m.contraparteDoc) m.faltan.push('documento del beneficiario')
    if (!m.contraparteNombre) m.faltan.push('nombre del beneficiario')
    return m.monto > 0 ? m : null
  }

  // Lo que entra en pesos: un cobro (Bre-B a la llave, link de pago) o una
  // recarga hecha por la propia empresa.
  if (tipoMov === 'load' && String(moneda).toUpperCase().startsWith('COP')) {
    const recarga = fuente === 'admin_cargue' || fuente === 'admin_backfill'
    const pagador = texto(rd.pagador ?? rd.payerName ?? rd.payer?.name)
    const m: MovEmpresa = {
      ...base, tipo: recarga ? 'recarga' : 'cobro',
      medio: fuente === 'finity_payment_link' || rd.method === 'LINK' ? 'Link de pago' : medioPorMoneda(moneda, rd),
      // El valor de la transacción es lo que pagó la contraparte (el bruto),
      // no lo que quedó después de la comisión. La llave es la de la empresa
      // (por dónde entró), no una cuenta de quien pagó.
      moneda: 'COP', monto: num(rd.brutoCop ?? rd.grossCop) ?? num(t.amount) ?? 0, montoCop: num(rd.brutoCop ?? rd.grossCop) ?? num(t.amount),
      contraparteNombre: pagador, contraparteTipoDoc: texto(rd.pagadorTipoDocumento ?? rd.payer?.documentType),
      contraparteDoc: texto(rd.pagadorDocumento ?? rd.payerDocument ?? rd.payer?.document),
      contraparteBanco: texto(rd.pagadorBanco ?? rd.payerBank), contraparteCuenta: null,
      referencia: texto(rd.reference ?? rd.note) ?? (texto(rd.llave) ? `Entró por la llave ${rd.llave}` : null), faltan: [],
    }
    if (!recarga && !m.contraparteDoc) m.faltan.push('documento de quien pagó')
    if (!recarga && !m.contraparteNombre) m.faltan.push('nombre de quien pagó')
    return m.monto > 0 ? m : null
  }
  return null
}
