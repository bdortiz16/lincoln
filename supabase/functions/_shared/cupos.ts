// ══════════════════════════════════════════════════════════════════
//  CUPO MENSUAL POR BENEFICIARIO (normativa de Cumplimiento)
//
//  Cada cliente puede enviarle a UN beneficiario, en el mes calendario (hora
//  de Colombia), hasta:
//    · persona: 80.000.000 COP
//    · empresa: 800.000.000 COP
//  (los valores generales los cambia Cumplimiento: system_config
//  'cupos_beneficiario' = { persona, empresa }).
//
//  Para enviar más, el cliente pide un aumento desde Beneficiarios con el RUT
//  (obligatorio) y, si quiere, cámara de comercio y origen de fondos. La
//  solicitud queda "en proceso de aumento" (cupo_solicitudes) y el oficial de
//  cumplimiento decide el cupo nuevo (cupos_beneficiario). Mientras tanto
//  rige el general.
//
//  QUIÉN ES "EL MISMO BENEFICIARIO": el documento (cédula o NIT, con o sin
//  dígito de verificación). Sin documento, el destino (cuenta o llave). Un
//  beneficiario con llave Bre-B y cuenta ACH es UNO solo: suman juntos.
//
//  Lo usan mouv-proxy (corta el envío antes de debitar) y admin-data (lo que
//  ve el cliente y lo que revisa Cumplimiento): la misma cuenta en los dos.
// ══════════════════════════════════════════════════════════════════

export const CUPO_DEF = { persona: 80_000_000, empresa: 800_000_000 }
export const TIPOS_DOC_CUPO: Record<string, { nombre: string; obligatorio: boolean }> = {
  rut: { nombre: 'RUT', obligatorio: true },
  camara: { nombre: 'Cámara de comercio', obligatorio: false },
  fondos: { nombre: 'Origen de fondos', obligatorio: false },
}

const soloDig = (v: unknown) => String(v ?? '').replace(/\D/g, '')

function dvNit(base: string): number {
  const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]
  let suma = 0
  for (let i = 0; i < base.length && i < pesos.length; i++) suma += Number(base[base.length - 1 - i]) * pesos[i]
  const r = suma % 11
  return r > 1 ? 11 - r : r
}

// El documento sin ceros a la izquierda y, si es un NIT con su dígito de
// verificación pegado (10 dígitos, el último es el DV de los 9), sin el DV.
export function normDoc(v: unknown): string {
  let d = soloDig(v).replace(/^0+/, '')
  if (d.length === 10 && dvNit(d.slice(0, 9)) === Number(d[9])) d = d.slice(0, 9)
  return d
}

// La cuenta o la llave: celulares sin +57 ni espacios, cuentas solo dígitos.
export function normDestino(v: unknown): string {
  const t = String(v ?? '').trim().toLowerCase()
  if (!t) return ''
  const d = t.replace(/\D/g, '')
  if (d && d.length >= 6 && /^[+\d\s().-]+$/.test(t)) return d.length >= 12 ? d.replace(/^57(?=\d{10}$)/, '') : d
  return t.replace(/\s+/g, '')
}

export function claveBeneficiario(doc: unknown, destino: unknown): string {
  const d = normDoc(doc)
  if (d) return `doc:${d}`
  const x = normDestino(destino)
  return x ? `dest:${x}` : ''
}

// Primer instante del mes en Bogotá (UTC−5), en ISO.
export function inicioMesBogota(ahora = Date.now()): string {
  const bog = new Date(ahora - 5 * 3600_000)
  return new Date(Date.UTC(bog.getUTCFullYear(), bog.getUTCMonth(), 1, 5)).toISOString()
}

export async function cupoGeneral(db: any): Promise<{ persona: number; empresa: number }> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', 'cupos_beneficiario').maybeSingle()
    const v = (data as any)?.value ? JSON.parse((data as any).value) : {}
    const n = (x: any, def: number) => { const k = Number(x); return Number.isFinite(k) && k > 0 ? k : def }
    return { persona: n(v.persona, CUPO_DEF.persona), empresa: n(v.empresa, CUPO_DEF.empresa) }
  } catch { return { ...CUPO_DEF } }
}

export async function idsMismaPersona(db: any, userId: string): Promise<string[]> {
  try {
    const { data: u } = await db.from('users').select('email').eq('id', userId).maybeSingle()
    if (!(u as any)?.email) return [userId]
    const { data: h } = await db.from('users').select('id').eq('email', (u as any).email)
    return Array.from(new Set([userId, ...((h ?? []) as any[]).map(x => String(x.id))]))
  } catch { return [userId] }
}

export type EnvioMes = { id: string; amount: number; doc: string; destino: string; created_at: string; status: string }

// Los envíos del mes que cuentan para el cupo: dispersiones que salieron o
// están saliendo. Lo rechazado o devuelto no cuenta.
export async function enviosDelMes(db: any, ids: string[], desde = inicioMesBogota()): Promise<EnvioMes[]> {
  const out: EnvioMes[] = []
  for (let off = 0; off < 20000; off += 1000) {
    const { data, error } = await db.from('transactions')
      .select('id, amount, status, created_at, benefDoc:raw_data->>benefDoc, documentNumber:raw_data->>documentNumber, recDoc:raw_data->recipient->>documentNumber, account:raw_data->>account, recKey:raw_data->recipient->>key, recCuenta:raw_data->recipient->>accountNumber, refunded:raw_data->refunded')
      .in('user_id', ids).eq('type', 'dispersion').gte('created_at', desde)
      .order('created_at', { ascending: true }).range(off, off + 999)
    if (error) throw new Error(error.message)
    for (const t of (data ?? []) as any[]) {
      if (['Fallido', 'Rechazado'].includes(String(t.status)) || t.refunded === true) continue
      out.push({
        id: String(t.id), amount: Number(t.amount) || 0, status: String(t.status), created_at: String(t.created_at),
        doc: normDoc(t.benefDoc ?? t.documentNumber ?? t.recDoc),
        destino: normDestino(t.account ?? t.recKey ?? t.recCuenta),
      })
    }
    if (!data || data.length < 1000) break
  }
  return out
}

// Lo enviado a un beneficiario: por documento o por cualquiera de sus destinos.
export function usadoPara(envios: EnvioMes[], doc: unknown, destinos: unknown[]): number {
  const d = normDoc(doc)
  const ds = new Set(destinos.map(normDestino).filter(Boolean))
  let s = 0
  for (const e of envios) if ((d && e.doc === d) || (e.destino && ds.has(e.destino))) s += e.amount
  return s
}

export async function cupoAprobado(db: any, userId: string, clave: string): Promise<number | null> {
  if (!clave) return null
  try {
    const { data } = await db.from('cupos_beneficiario').select('cupo_mensual').eq('user_id', userId).eq('beneficiario_clave', clave).maybeSingle()
    const n = Number((data as any)?.cupo_mensual)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch { return null }
}

export async function solicitudEnProceso(db: any, userId: string, clave: string): Promise<boolean> {
  if (!clave) return false
  try {
    const { data } = await db.from('cupo_solicitudes').select('id').eq('user_id', userId).eq('beneficiario_clave', clave).eq('estado', 'en_proceso').limit(1)
    return Array.isArray(data) && data.length > 0
  } catch { return false }
}
