// ══════════════════════════════════════════════════════════════════
//  La cuenta destino tal como la inscribe Finity (ACH · Cuenta 2).
//
//  Vivía repetida: la tabla de bancos estaba en mouv-proxy y en la pantalla
//  de contactos, y el cuerpo de la inscripción solo en la pantalla. Desde el
//  23 nov el servidor también inscribe (las cuentas que quedaron pendientes
//  se reintentan solas, ver finity-proxy `inscribir_pendientes`), así que el
//  cuerpo tiene que ser el mismo en los dos lados.
//
//  Contrato (doc oficial, revisada el 23 nov, POST /v0/external-accounts):
//    { account: { geo, account_type: savings|checking, account_number,
//      financial_institution_code, account_holder_fullname,
//      account_holder_id_type: CC|CE|NIT|PASSPORT|PPT,
//      account_holder_id_number } }  → 201 { id: "ea_…", … }
// ══════════════════════════════════════════════════════════════════

// Códigos ACH de Colombia por nombre del banco (el que guarda el contacto).
// Misma tabla que BANK_CODES_CO en components/ContactsSection.tsx.
export const BANK_CODES_CO: Record<string, string> = {
  'Banco de Bogotá': '1001', 'Banco Popular': '1002', 'Itaú': '1006', 'Bancolombia': '1007',
  'Citibank': '1009', 'GNB Sudameris': '1012', 'BBVA Colombia': '1013', 'Scotiabank Colpatria': '1019',
  'Banco de Occidente': '1023', 'Banco Caja Social': '1032', 'Banco Agrario': '1040', 'Davivienda': '1051',
  'Banco AV Villas': '1052', 'Banco Pichincha': '1060', 'Bancoomeva': '1061', 'Banco Falabella': '1062',
  'Coopcentral': '1066', 'Lulo Bank': '1070', 'Nequi': '1507', 'Daviplata': '1551',
  'Movii': '1801', 'Nu Colombia': '1809', 'Nu': '1809',
}

// El código del banco: si ya viene el código (3-5 dígitos) se usa; si viene
// el nombre, se busca sin importar mayúsculas. Sin cruce: null (no se adivina).
export function codigoBancoCo(banco: unknown): string | null {
  const b = String(banco ?? '').trim()
  if (/^\d{3,5}$/.test(b)) return b
  const k = Object.keys(BANK_CODES_CO).find(x => x.toLowerCase() === b.toLowerCase())
  return k ? BANK_CODES_CO[k] : null
}

// Tipo de documento como lo acepta Finity. "PAS"/"PASAPORTE" es PASSPORT:
// antes se mandaba como CE y el banco no encontraba al titular.
export function tipoDocFinity(t: unknown): 'CC' | 'CE' | 'NIT' | 'PASSPORT' | 'PPT' {
  const d = String(t ?? 'CC').toUpperCase().trim()
  if (d === 'PAS' || d === 'PASAPORTE' || d === 'PASSPORT') return 'PASSPORT'
  return (['CC', 'CE', 'NIT', 'PPT'] as const).find(x => x === d) ?? 'CC'
}

// El número del documento: solo dígitos (un NIT con guion o puntos se
// rechaza), salvo el pasaporte, que lleva letras.
export function numeroDocFinity(tipo: string, numero: unknown): string {
  return tipo === 'PASSPORT'
    ? String(numero ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()
    : String(numero ?? '').replace(/\D/g, '')
}

// El cuerpo de la inscripción a partir de un contacto guardado
// (raw_data.mouvContacts). Devuelve el motivo si falta algo: con un hueco,
// Finity responde 400 y el reintento solo gasta llamadas.
export function cuerpoCuentaFinity(c: any): { ok: true; body: { account: Record<string, string> } } | { ok: false; motivo: string } {
  const numero = String(c?.accountNumber ?? '').replace(/\D/g, '')
  const codigo = codigoBancoCo(c?.bank)
  const tipo = tipoDocFinity(c?.docType)
  const doc = numeroDocFinity(tipo, c?.docNumber)
  const nombre = String(c?.name ?? '').trim()
  if (numero.length < 6 || numero.length > 20) return { ok: false, motivo: `el número de cuenta tiene ${numero.length} dígitos (van de 6 a 20)` }
  if (!codigo) return { ok: false, motivo: `el banco "${String(c?.bank ?? '') || 'sin banco'}" no tiene código ACH` }
  if (!nombre) return { ok: false, motivo: 'falta el nombre del titular' }
  if (!doc) return { ok: false, motivo: 'falta el documento del titular' }
  return {
    ok: true,
    body: {
      account: {
        geo: 'CO',
        account_type: ['checking', 'corriente', 'CORRIENTE'].includes(String(c?.accountType)) ? 'checking' : 'savings',
        account_number: numero,
        financial_institution_code: codigo,
        account_holder_fullname: nombre,
        account_holder_id_type: tipo,
        account_holder_id_number: doc,
      },
    },
  }
}

// ¿Es una cuenta que va por ACH · Cuenta 2 (Finity)? Bre-B y wallets no se
// inscriben; las cuentas del exterior tampoco.
export const esCuentaAchFinity = (c: any): boolean =>
  !!c && (c.country ?? 'Colombia') === 'Colombia' && c.destKind !== 'breb' && c.accountKind !== 'wallet'
