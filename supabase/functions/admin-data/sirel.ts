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
  origen: string            // de dónde sale el registro
  faltan: string[]
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
  }
  let op: Omit<OperacionAv, 'valorUsd' | 'faltan'> | null = null

  // Depósito de USDT por GasFree, o depósito cripto acreditado a mano.
  if (tipoMov === 'load' && fuente === 'GASFREE') {
    op = { ...base, tipo: 'deposito', activo: 'USDT', cantidad: num(t.amount) ?? 0,
      walletCliente: texto(rd.toAddress), walletContraparte: texto(rd.fromAddress), origen: 'Depósito GasFree' }
  } else if (tipoMov === 'otc_deposit' && activoDe(moneda)) {
    op = { ...base, tipo: 'deposito', activo: activoDe(moneda)!, cantidad: num(t.amount) ?? 0,
      walletContraparte: texto(rd.fromAddress), origen: 'Depósito acreditado a mano' }
  // Cargue: el cliente entregó USDT y se le acreditaron pesos (venta).
  } else if (tipoMov === 'load' && (fuente === 'admin_cargue' || fuente === 'admin_backfill') && Number(rd?.acct?.usdtGross) > 0) {
    op = { ...base, tipo: 'venta', activo: 'USDT', cantidad: Number(rd.acct.usdtGross),
      valorCop: num(rd.acct.creditedCop) ?? num(t.amount), tasaCop: num(rd.acct.clientRate) ?? num(rd.acct.sellRate),
      walletContraparte: texto(rd.fromAddress ?? rd.acct?.fromAddress), origen: fuente === 'admin_backfill' ? 'Cargue (registro histórico)' : 'Cargue de USDT' }
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
  // USDT y USDC valen un dólar; EURC no tiene tasa guardada (no se supone).
  const valorUsd = op.activo === 'USDT' || op.activo === 'USDC' ? Math.round(op.cantidad * 100) / 100 : null
  if (op.tasaCop == null && op.valorCop && op.cantidad) op.tasaCop = Math.round((op.valorCop / op.cantidad) * 100) / 100
  const faltan: string[] = []
  if (!op.hash && (op.tipo === 'deposito' || op.tipo === 'retiro')) faltan.push(op.traza ? 'hash (hay traza del proveedor)' : 'hash')
  if (!op.walletContraparte) faltan.push('wallet contraparte')
  if (!op.red) faltan.push('red')
  if (valorUsd == null) faltan.push('valor en USD')
  return { ...op, valorUsd, faltan }
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
