// ── Lectura y armado de la respuesta de la API de empresas ───────────────
// Los clientes de una empresa son sus operadores aprobados
// (raw_data.personasAutorizadas), igual que en `autorizaciones`.
import { leerPorPaginas } from '../_shared/paginas.ts'
import { inicioMesBogota } from '../_shared/cupos.ts'

// Mismas definiciones que autorizaciones/index.ts.
export const nombreEmpresa = (f: any): string => String(f?.company_name || f?.full_name || f?.email || '')
export const codigoDe = (f: any): string => String(f?.raw_data?.ownReferralCode || String(f?.id ?? '').slice(-6)).toUpperCase()

export type Operador = { id: string; balances: any; ref: string | null }

export type Cliente = {
  id_lincoin: string; nombre: string; tipo: 'persona' | 'empresa'
  documento: { tipo: string; numero: string }
  saldos: Record<string, number>
  tope_mensual: number | null; usado_mes: number; vinculado_at: string | null
}
export type DetalleEmpresa = {
  empresa: { id: string; nombre: string; saldos: Record<string, number>; total_cop: number }
  generado_at: string
  clientes: Cliente[]
  totales_clientes: { COP: number; por_cuenta: Record<string, number> }
}

// Las cuentas en pesos de un cliente, como en la Billetera del panel:
// COP = Saldo Lincoin, COP_BREB = Bre-B, COP_ACH = ACH, COP_C3 = Cuenta 3,
// COP_C4 = Cuenta 4. Siempre van las cinco (0 si no tiene), para que quien
// consume la API reciba siempre la misma forma.
export const CUENTAS_COP = ['COP', 'COP_BREB', 'COP_ACH', 'COP_C3', 'COP_C4'] as const

export function saldosEmpresa(balances: Record<string, unknown> | null | undefined): Record<string, number> {
  const s = saldosCop(balances)
  const out: Record<string, number> = {}
  for (const k of CUENTAS_COP) out[k] = s[k] ?? 0
  for (const [k, v] of Object.entries(s)) if (!(k in out)) out[k] = v
  return out
}
const sumar = (s: Record<string, number>) => Object.values(s).reduce((a, v) => a + v, 0)

export function saldosCop(balances: Record<string, unknown> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(balances ?? {})) {
    if (!k.startsWith('COP')) continue
    out[k] = Number(v) || 0
  }
  return out
}

const autorizadas = (empresa: any): any[] =>
  Array.isArray(empresa?.raw_data?.personasAutorizadas) ? empresa.raw_data.personasAutorizadas.filter((x: any) => x && x.id) : []

export function armarDetalle(empresa: any, operadores: Map<string, Operador>, usado: Record<string, number>, ahora: Date): DetalleEmpresa {
  const clientes: Cliente[] = []
  const porCuenta: Record<string, number> = {}
  for (const a of autorizadas(empresa)) {
    const op = operadores.get(String(a.id))
    if (!op) continue
    const saldos = saldosCop(op.balances)
    for (const [k, v] of Object.entries(saldos)) porCuenta[k] = (porCuenta[k] ?? 0) + v
    clientes.push({
      id_lincoin: codigoDe({ id: op.id, raw_data: { ownReferralCode: op.ref } }),
      nombre: String(a.nombre ?? ''),
      tipo: a.tipoOperador === 'empresa' ? 'empresa' : 'persona',
      documento: { tipo: String(a.docType ?? ''), numero: String(a.docNumber ?? '') },
      saldos,
      tope_mensual: a.topeMensual == null ? null : Number(a.topeMensual),
      usado_mes: Number(usado[String(a.id)] ?? 0),
      vinculado_at: a.at ?? null,
    })
  }
  const COP = Object.values(porCuenta).reduce((s, v) => s + v, 0)
  const saldos = saldosEmpresa(empresa?.balances)
  return {
    empresa: { id: codigoDe(empresa), nombre: nombreEmpresa(empresa), saldos, total_cop: sumar(saldos) },
    generado_at: ahora.toISOString(),
    clientes,
    totales_clientes: { COP, por_cuenta: porCuenta },
  }
}

export function armarResumen(empresa: any, operadores: Map<string, Operador>) {
  let clientes = 0, total = 0
  for (const a of autorizadas(empresa)) {
    const op = operadores.get(String(a.id))
    if (!op) continue
    clientes++
    total += Object.values(saldosCop(op.balances)).reduce((s, v) => s + v, 0)
  }
  const saldos = saldosEmpresa(empresa?.balances)
  return { id: codigoDe(empresa), nombre: nombreEmpresa(empresa), saldos, total_cop: sumar(saldos), clientes, total_clientes_cop: total }
}

export const idsAutorizados = (empresa: any): string[] => autorizadas(empresa).map(a => String(a.id))

// De a 150 ids: con muchos, un .in() enorme arma una URL que se rechaza.
export async function leerOperadores(db: any, ids: string[]): Promise<Map<string, Operador>> {
  const m = new Map<string, Operador>()
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await db.from('users').select('id, balances, ref:raw_data->>ownReferralCode').in('id', ids.slice(i, i + 150))
    for (const f of (data ?? []) as any[]) m.set(String(f.id), { id: String(f.id), balances: f.balances ?? {}, ref: f.ref ?? null })
  }
  return m
}

// Lo que lleva cada cliente contra su tope este mes: la misma regla que
// `autorizaciones` (dispersiones del mes de Colombia en curso o hechas).
export async function usadoMes(db: any, ids: string[]): Promise<Record<string, number>> {
  const usado: Record<string, number> = {}
  const ini = inicioMesBogota()
  for (let i = 0; i < ids.length; i += 150) {
    await leerPorPaginas(() => db.from('transactions').select('id, user_id, amount, status').in('user_id', ids.slice(i, i + 150)).eq('type', 'dispersion').gte('created_at', ini), {
      alLote: (lote) => {
        for (const t of lote) {
          if (!['Completado', 'Procesando', 'Pendiente'].includes(String(t.status))) continue
          usado[String(t.user_id)] = (usado[String(t.user_id)] ?? 0) + (Number(t.amount) || 0)
        }
      },
    })
  }
  return usado
}

export async function leerEmpresas(db: any): Promise<any[]> {
  const out: any[] = []
  await leerPorPaginas(() => db.from('users').select('id, email, full_name, company_name, balances, raw_data->ownReferralCode, raw_data->personasAutorizadas').eq('role', 'business'), {
    alLote: (lote) => {
      for (const f of lote) out.push({ id: f.id, email: f.email, full_name: f.full_name, company_name: f.company_name, balances: f.balances ?? {}, raw_data: { ownReferralCode: f.ownReferralCode, personasAutorizadas: f.personasAutorizadas } })
    },
  })
  return out
}
