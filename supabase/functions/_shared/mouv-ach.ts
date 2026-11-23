// ─────────────────────────────────────────────────────────────
// ACH por Mouv = "ACH · Cuenta 1" (desde el 22 nov). Paga con el saldo de la
// Cuenta 1 del cliente (COP_BREB), el mismo que respalda la bolsa de Mouv.
//
// Doc oficial de POST /api/transfers/send, "Body ACH" (la pegó el dueño el
// 22 nov; developer.mouvlatam.com no se puede abrir desde el servidor):
//
//   amount                                  centavos
//   destination.bankAccount.bankId          número, de GET /dictionaries/banks/ach
//   destination.bankAccount.accountTypeId   20 Ahorros · 21 Corriente · 22 Depósito electrónico
//   destination.bankAccount.accountNumber   4–32 dígitos
//   destination.bankAccount.documentTypeId  1 CC · 4 CE · 5 Pasaporte · 8 NIT
//   destination.bankAccount.documentNumber  5–15 dígitos
//   destination.bankAccount.holderFirstName máx. 64
//   destination.bankAccount.holderLastName  máx. 64
//   reference                               idempotencia por 60 s (máx. 100)
//
// Debita la billetera ACH de Mouv, no la Bre-B: son dos bolsillos distintos
// del mismo proveedor (GET /wallets/balance trae los dos).
//
// Antes mouvPayout mandaba { bankCode, accountType, accountNumber } "como la
// forma más probable", sin documento ni titular: Mouv lo habría rechazado en
// cada envío. Por eso ACH nunca salió por Mouv.
//
// EL BANCO. Lincoin guarda el banco por NOMBRE ("Bancolombia") y Mouv lo pide
// por SU id. La forma de la respuesta del diccionario no está en la doc que
// tenemos, así que se lee sin suponer nombres de campo, y el banco se cruza
// primero por código ACH y después por nombre. Si no hay UN cruce claro no se
// adivina: el envío no arranca y no se toca el saldo. Mandar la plata a otro
// banco es peor que pedirle al cliente que use otra cuenta.
// ─────────────────────────────────────────────────────────────
import { partirNombre } from './coinsenda.ts'

export type BancoMouv = { id: number; nombre: string; codigo: string | null }

export type DestinoAchMouv = {
  bankId: number
  accountTypeId: 20 | 21 | 22
  accountNumber: string
  documentTypeId: 1 | 4 | 5 | 8
  documentNumber: string
  holderFirstName: string
  holderLastName: string
}

const sinTildes = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
// Mismo criterio que el catálogo de Coinsenda: sin "banco", "bank", "S.A.",
// "colombia" ni signos, para que "BANCO DAVIVIENDA S.A." y "Davivienda" sean
// lo mismo.
export const nombreBanco = (s: string) => sinTildes(s).replace(/\b(banco|bank|s\.?a\.?s?|colombia)\b/g, '').replace(/[^a-z0-9]/g, '')

// Códigos ACH de Colombia de los bancos que ofrece el registro de
// beneficiarios (misma tabla que BANK_CODES_CO en ContactsSection.tsx). Si el
// diccionario de Mouv trae el código, el cruce por código es exacto.
const CODIGO_ACH: Record<string, string> = {
  debogota: '1001', popular: '1002', itau: '1006', bancolombia: '1007', citibank: '1009',
  gnbsudameris: '1012', bbva: '1013', scotiabankcolpatria: '1019', deoccidente: '1023',
  cajasocial: '1032', agrario: '1040', davivienda: '1051', avvillas: '1052', pichincha: '1060',
  bancoomeva: '1061', falabella: '1062', coopcentral: '1066', lulo: '1070', nequi: '1507',
  daviplata: '1551', movii: '1801', nu: '1809',
}
/** Código ACH (el que pide Finity) del nombre de banco que guarda el
 *  beneficiario ("Davivienda", "Banco de Bogotá"…). null si no se conoce. */
export const codigoAchBanco = (banco: unknown): string | null => CODIGO_ACH[nombreBanco(String(banco ?? ''))] ?? null

// Otras formas en que esos bancos aparecen en los catálogos de los aliados.
const ALIAS_BANCO: Record<string, string[]> = {
  cajasocial: ['bcsc', 'cajasocialbcsc'],
  scotiabankcolpatria: ['colpatria', 'scotiabank'],
  itau: ['itaucorpbanca', 'corpbanca'],
  bancoomeva: ['coomeva'],
  nu: ['nubank', 'nufinanciera', 'nucompaniadefinanciamiento'],
  debogota: ['bogota'],
  deoccidente: ['occidente'],
}

/** Los bancos del diccionario de Mouv, sin suponer la forma de la respuesta. */
export function bancosDeDiccionario(d: any): BancoMouv[] {
  const arr: any[] | null = Array.isArray(d) ? d
    : Array.isArray(d?.data) ? d.data
    : Array.isArray(d?.items) ? d.items
    : Array.isArray(d?.banks) ? d.banks
    : Array.isArray(d?.results) ? d.results
    : Array.isArray(d?.data?.banks) ? d.data.banks
    : Array.isArray(d?.data?.items) ? d.data.items
    : null
  const out: BancoMouv[] = []
  const agregar = (idRaw: unknown, nombreRaw: unknown, codigoRaw: unknown) => {
    const id = Number(idRaw)
    if (!Number.isFinite(id) || id <= 0 || Math.round(id) !== id) return
    const nombre = String(nombreRaw ?? '').trim()
    if (!nombre) return
    const codigo = codigoRaw == null ? null : (String(codigoRaw).replace(/\D/g, '') || null)
    out.push({ id, nombre, codigo })
  }
  if (arr) {
    for (const b of arr) {
      if (!b || typeof b !== 'object') continue
      agregar(
        b.id ?? b.bankId ?? b.bank_id ?? b.value,
        b.name ?? b.nombre ?? b.label ?? b.bankName ?? b.bank_name ?? b.description ?? b.descripcion,
        b.achCode ?? b.ach_code ?? b.code ?? b.bankCode ?? b.bank_code ?? b.codigo ?? b.compensationCode ?? null,
      )
    }
    return out
  }
  // Un mapa { "7": "BANCOLOMBIA", ... }.
  if (d && typeof d === 'object') {
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === 'string') agregar(k, v, null)
      else if (v && typeof v === 'object') agregar((v as any).id ?? k, (v as any).name ?? (v as any).nombre, (v as any).code ?? (v as any).achCode ?? null)
    }
  }
  return out
}

/** El banco de Mouv que corresponde al nombre guardado en el beneficiario.
 *  Del cruce más seguro al menos seguro: código ACH, nombre igual, un alias
 *  conocido, o un nombre que contiene al otro. Cada paso exige UN solo banco:
 *  con dos posibles no se adivina. */
export function bancoMouv(lista: BancoMouv[], banco: string): BancoMouv | null {
  const objetivo = nombreBanco(banco)
  if (!objetivo || !lista.length) return null
  const unico = (xs: BancoMouv[]) => {
    const ids = new Set(xs.map(x => x.id))
    return ids.size === 1 ? xs[0] : null
  }
  const codigo = CODIGO_ACH[objetivo]
  if (codigo) {
    const porCodigo = lista.filter(b => b.codigo === codigo)
    if (porCodigo.length) return unico(porCodigo)
  }
  const exactos = lista.filter(b => nombreBanco(b.nombre) === objetivo)
  if (exactos.length) return unico(exactos)
  const alias = ALIAS_BANCO[objetivo] ?? []
  if (alias.length) {
    const porAlias = lista.filter(b => alias.includes(nombreBanco(b.nombre)))
    if (porAlias.length) return unico(porAlias)
  }
  if (objetivo.length < 4) return null
  const contiene = (x: string) => x.length >= 4 && (x.includes(objetivo) || objetivo.includes(x))
  return unico(lista.filter(b => contiene(nombreBanco(b.nombre))))
}

/** 20 Ahorros · 21 Corriente · 22 Depósito electrónico. */
export function tipoCuentaMouv(t: unknown): 20 | 21 | 22 | null {
  const s = sinTildes(String(t ?? ''))
  if (/ahorro|saving/.test(s)) return 20
  if (/corriente|checking|current/.test(s)) return 21
  if (/deposito|electron/.test(s)) return 22
  return null
}

/** 1 CC · 4 CE · 5 Pasaporte · 8 NIT. Otro tipo (TI, PPT, PEP) no lo acepta. */
export function tipoDocMouv(t: unknown): 1 | 4 | 5 | 8 | null {
  const s = String(t ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  if (s === 'CC') return 1
  if (s === 'CE') return 4
  if (s === 'PAS' || s === 'PA' || s === 'PP' || s === 'PASAPORTE') return 5
  if (s === 'NIT') return 8
  return null
}

/** Arma el destino ACH en la forma de la doc, o dice qué falta. El texto de
 *  `error` lo puede ver el cliente: sin nombres de aliados. */
export function destinoAchMouv(lista: BancoMouv[], d: {
  banco: string; tipoCuenta: string; numero: string; docTipo: string; docNumero: string; titular: string
}): { ok: true; destino: DestinoAchMouv; banco: BancoMouv } | { ok: false; error: string; motivo: string } {
  const banco = bancoMouv(lista, d.banco)
  if (!banco) return { ok: false, motivo: 'banco_sin_cruce', error: `ACH · Cuenta 1 todavía no tiene el banco «${String(d.banco ?? '').trim() || 'sin banco'}» en su lista.` }
  const accountTypeId = tipoCuentaMouv(d.tipoCuenta)
  if (!accountTypeId) return { ok: false, motivo: 'tipo_cuenta', error: 'El beneficiario no tiene el tipo de cuenta (ahorros o corriente).' }
  const accountNumber = String(d.numero ?? '').replace(/\D/g, '')
  if (accountNumber.length < 4 || accountNumber.length > 32) return { ok: false, motivo: 'numero_cuenta', error: 'El número de cuenta del beneficiario no es válido.' }
  const documentTypeId = tipoDocMouv(d.docTipo)
  if (!documentTypeId) return { ok: false, motivo: 'tipo_documento', error: `ACH · Cuenta 1 no acepta beneficiarios con documento ${String(d.docTipo ?? '').toUpperCase() || 'sin tipo'}.` }
  const documentNumber = String(d.docNumero ?? '').replace(/\D/g, '')
  if (documentNumber.length < 5 || documentNumber.length > 15) return { ok: false, motivo: 'numero_documento', error: 'El documento del beneficiario no es válido.' }
  const titular = String(d.titular ?? '').trim().replace(/\s+/g, ' ')
  if (!titular) return { ok: false, motivo: 'titular', error: 'El beneficiario no tiene nombre.' }
  // Empresa: la razón social en los dos campos, como en la Cuenta 3.
  const { name, surname } = partirNombre(titular, documentTypeId === 8)
  return {
    ok: true, banco,
    destino: {
      bankId: banco.id, accountTypeId, accountNumber, documentTypeId, documentNumber,
      holderFirstName: name.slice(0, 64), holderLastName: (surname || name).slice(0, 64),
    },
  }
}
