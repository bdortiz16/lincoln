// ════════════════════════════════════════════════════════
// Lincoin Risk como servicio prepago.
//
// Lincoin (el admin) compra consultas a Sarblock: esa es la CAJA
// (risk_caja). A cada empresa le vende paquetes (mínimo configurable) y las
// consultas quedan en SU bolsillo (risk_saldos). Cada consulta manual
// descuenta 1, salga de Sarblock o del padrón. La AML de beneficiarios no
// pasa por aquí: no descuenta.
//
// Nada va fijo en el código: precio, mínimo, IVA, medios de pago, vigencia
// y umbrales de aviso salen de system_config.risk_venta_config, que edita el
// admin. Sin precio definido no se puede comprar.
//
// Dos avisos:
//   · al cliente, cuando le quedan pocas consultas;
//   · al admin, cuando la caja no alcanza para cubrir lo que los clientes
//     ya pagaron (nadie que compró se puede quedar sin consultas).
//
// El historial no se borra: las tablas lo impiden con triggers.
// ════════════════════════════════════════════════════════
import { PASIVA } from './traductor.ts'

export type ConfigRisk = {
  activo: boolean
  precioPorConsulta: number       // COP, sin IVA
  minimoCompra: number            // consultas
  ivaPct: number                  // 0 = sin IVA
  bolsillos: Record<string, { etiqueta: string; activo: boolean }>
  avisoClienteConsultas: number   // avisar al cliente con N o menos
  avisoCajaCoberturaPct: number   // avisar al admin si la caja cubre menos de este % de lo vendido pendiente
  vigenciaDias: number            // cuánto vale una consulta guardada antes de vencer
}

export const CONFIG_KEY_RISK = 'risk_venta_config'
export const CONFIG_INICIAL: ConfigRisk = {
  activo: true,
  precioPorConsulta: 0,
  minimoCompra: 300,
  ivaPct: 0,
  bolsillos: {
    COP_ACH: { etiqueta: 'Pesos · ACH (Finity)', activo: true },
    COP_BREB: { etiqueta: 'Pesos · Bre-B (Mouv)', activo: true },
    // Bolsillo futuro: se deja listo y apagado.
    COP_COINCENDA: { etiqueta: 'Pesos · Coincenda', activo: false },
  },
  avisoClienteConsultas: 30,
  avisoCajaCoberturaPct: 120,
  vigenciaDias: 90,
}

export async function leerConfigRisk(db: any): Promise<ConfigRisk> {
  try {
    const { data } = await db.from('system_config').select('value').eq('key', CONFIG_KEY_RISK).maybeSingle()
    const c = data?.value ? JSON.parse(data.value) : {}
    // Una configuración guardada antes de una regla nueva la toma con su
    // valor por defecto; los bolsillos nuevos entran apagados si no estaban.
    return { ...CONFIG_INICIAL, ...c, bolsillos: { ...CONFIG_INICIAL.bolsillos, ...(c.bolsillos ?? {}) } }
  } catch { return CONFIG_INICIAL }
}

// Solo lo que el admin puede cambiar, con números válidos.
export function normalizarConfig(actual: ConfigRisk, c: any): ConfigRisk {
  const num = (v: unknown, def: number) => (v !== '' && v !== null && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : def)
  return {
    ...actual,
    activo: typeof c?.activo === 'boolean' ? c.activo : actual.activo,
    precioPorConsulta: num(c?.precioPorConsulta, actual.precioPorConsulta),
    minimoCompra: Math.max(1, Math.floor(num(c?.minimoCompra, actual.minimoCompra))),
    ivaPct: Math.min(100, num(c?.ivaPct, actual.ivaPct)),
    avisoClienteConsultas: Math.floor(num(c?.avisoClienteConsultas, actual.avisoClienteConsultas)),
    avisoCajaCoberturaPct: num(c?.avisoCajaCoberturaPct, actual.avisoCajaCoberturaPct),
    vigenciaDias: Math.max(1, Math.floor(num(c?.vigenciaDias, actual.vigenciaDias))),
    bolsillos: Object.fromEntries(Object.entries(actual.bolsillos).map(([k, v]) => [k, { ...v, activo: typeof c?.bolsillos?.[k]?.activo === 'boolean' ? c.bolsillos[k].activo : v.activo }])),
  }
}

// ── Precio ──────────────────────────────────────────────────────────────
export function cotizar(c: ConfigRisk, cantidad: number) {
  const n = Math.floor(Number(cantidad) || 0)
  const subtotal = Math.round(n * c.precioPorConsulta)
  const iva = Math.round(subtotal * (c.ivaPct / 100))
  return { cantidad: n, precioUnit: c.precioPorConsulta, subtotal, iva, total: subtotal + iva }
}

export function validarCompra(c: ConfigRisk, cantidad: number, bolsillo: string, saldoPesos: number): string | null {
  if (!c.activo) return 'La compra de consultas no está disponible en este momento.'
  if (!(c.precioPorConsulta > 0)) return 'El precio de las consultas todavía no está definido.'
  if (!Number.isInteger(cantidad) || cantidad < c.minimoCompra) return `La compra mínima es de ${c.minimoCompra.toLocaleString('es-CO')} consultas.`
  if (!c.bolsillos[bolsillo]?.activo) return 'Ese medio de pago no está disponible.'
  if (saldoPesos < cotizar(c, cantidad).total) return 'No tienes saldo suficiente en ese bolsillo.'
  return null
}

// ── Vencimiento ─────────────────────────────────────────────────────────
// Una consulta guardada vale `vigenciaDias` (3 meses por defecto). Después
// hay que consultar de nuevo, y eso sí usa 1 consulta.
export function vencimiento(c: ConfigRisk, at: string) {
  const vence = Date.parse(at) + c.vigenciaDias * 86400_000
  const dias = Math.ceil((vence - Date.now()) / 86400_000)
  const estado = dias <= 0 ? 'vencida' : dias <= 7 ? 'critico' : dias <= 30 ? 'pronto' : 'vigente'
  return { venceAt: new Date(vence).toISOString(), dias: Math.max(0, dias), estado }
}

// ── Tipos de riesgo (para filtrar) ──────────────────────────────────────
export const TIPOS_RIESGO: Record<string, string> = {
  sanciones: 'Listas restrictivas', judicial: 'Procesos judiciales', antecedentes: 'Antecedentes',
  pep: 'PEP', prensa: 'Prensa adversa', identidad: 'Identidad', ninguno: 'Sin hallazgos',
}
export function tiposDeRiesgo(ficha: any): string[] {
  const t = new Set<string>()
  for (const h of ficha?.hallazgos ?? []) {
    const r = String(h?.regla ?? h?.codigo ?? '')
    if (r === 'lista_restrictiva') t.add('sanciones')
    else if (r.startsWith('rama')) t.add('judicial')
    else if (r === 'antecedentes') t.add('antecedentes')
    else if (r === 'pep') t.add('pep')
    else if (r.startsWith('prensa')) t.add('prensa')
    else if (r === 'identidad') t.add('identidad')
  }
  if (ficha?.nombreCoincide === false) t.add('identidad')
  if (!t.size) t.add('ninguno')
  return [...t]
}

// Los despachos de los procesos donde la persona es PARTE PASIVA: los mismos
// que salen como hallazgo. El mapa se pinta con estos (antes contaba también
// los procesos donde la persona demandó, y no cuadraba con la lista).
export function despachos(ficha: any): string[] {
  const out: string[] = []
  for (const e of ficha?.sarblock?.catalog ?? []) {
    if (String(e?.code ?? '') !== 'co_rama_judicial') continue
    for (const h of Array.isArray(e?.hits) ? e.hits : []) if (PASIVA(h) && h?.judicial?.court) out.push(String(h.judicial.court))
  }
  return out
}

export const grupoDe = (c: { operable: boolean | null; categoria: string | null }) =>
  c.operable === false || c.categoria === 'alto' ? 'alto' : c.categoria === 'medio' ? 'medio' : 'bajo'

// ── Base de datos ───────────────────────────────────────────────────────
// Columnas livianas de una consulta (sin la ficha).
export const COLS = 'id, at, por, tipo_persona, tipo_documento, documento, nombre_escrito, nombre_oficial, categoria, operable, de_cache, estado, check_id, riesgos, despachos'

// La fila como la ve la pantalla.
export const fila = (r: any) => ({
  id: r.id, at: r.at, por: r.por, tipoPersona: r.tipo_persona, tipoDocumento: r.tipo_documento, documento: r.documento,
  nombreEscrito: r.nombre_escrito, nombreOficial: r.nombre_oficial, categoria: r.categoria, operable: r.operable,
  deCache: r.de_cache, estado: r.estado, riesgos: r.riesgos ?? [], despachos: r.despachos ?? [],
  ...(r.ficha ? { ficha: r.ficha } : {}),
})

export async function saldoDe(db: any, uid: string): Promise<number> {
  const { data } = await db.from('risk_saldos').select('saldo').eq('user_id', uid).maybeSingle()
  return Number(data?.saldo ?? 0)
}

export async function mover(db: any, uid: string, tipo: string, cantidad: number, detalle: string, por: string | null, ref: string | null) {
  const { data, error } = await db.rpc('risk_mover', { p_user_id: uid, p_tipo: tipo, p_cantidad: cantidad, p_detalle: detalle, p_por: por, p_ref: ref })
  if (error) throw new Error(error.message)
  return data as { ok?: boolean; error?: string; saldo: number }
}

// Personas registradas: la consulta lista más reciente de cada documento.
export async function registradas(db: any, uid: string, cfg: ConfigRisk) {
  const { data } = await db.from('risk_consultas').select(COLS).eq('user_id', uid).eq('estado', 'lista')
    .order('at', { ascending: false }).limit(5000)
  const por = new Map<string, any>()
  for (const r of (data ?? []) as any[]) {
    const k = `${r.tipo_documento}:${r.documento}`
    if (!por.has(k)) por.set(k, r)
  }
  return [...por.values()].map(r => ({ ...fila(r), grupo: grupoDe(r), vence: vencimiento(cfg, r.at) }))
}

export function filtrarRegistradas(todas: any[], f: { q?: string; nivel?: string; riesgo?: string; vence?: string; pagina?: number }, porPagina = 20) {
  const texto = String(f.q ?? '').trim().toLowerCase()
  const conteo: Record<string, number> = { todos: todas.length, bajo: 0, medio: 0, alto: 0 }
  const riesgos: Record<string, number> = {}
  for (const c of todas) { conteo[c.grupo]++; for (const t of c.riesgos) riesgos[t] = (riesgos[t] ?? 0) + 1 }
  const lista = todas
    .filter(c => !texto || [c.documento, c.nombreOficial, c.nombreEscrito].some(v => String(v ?? '').toLowerCase().includes(texto)))
    .filter(c => !f.nivel || f.nivel === 'todos' || c.grupo === f.nivel)
    .filter(c => !f.riesgo || c.riesgos.includes(f.riesgo))
    .filter(c => !f.vence || (f.vence === 'vencidas' ? c.vence.estado === 'vencida' : f.vence === 'por_vencer' ? (c.vence.estado === 'pronto' || c.vence.estado === 'critico') : true))
  const pagina = Math.max(1, Number(f.pagina) || 1), inicio = (pagina - 1) * porPagina
  return { total: lista.length, conteo, riesgos, pagina, paginas: Math.max(1, Math.ceil(lista.length / porPagina)), filas: lista.slice(inicio, inicio + porPagina) }
}

export async function anotarBusqueda(db: any, uid: string, b: { por: string | null; tipoDocumento: string; documento: string; nombre: string | null; resultado: string; consultaId?: string }) {
  try {
    await db.from('risk_busquedas').insert({ user_id: uid, por: b.por, tipo_documento: b.tipoDocumento, documento: b.documento, nombre: b.nombre, resultado: b.resultado, consulta_id: b.consultaId ?? null })
  } catch { /* que el seguimiento falle no frena la consulta */ }
}

// ── Resumen del admin: caja, ventas y cobertura ─────────────────────────
export async function resumen(db: any, cfg: ConfigRisk) {
  const [caja, compras, saldos, consultas] = await Promise.all([
    db.from('risk_caja').select('*').order('at', { ascending: false }).limit(500),
    db.from('risk_compras').select('user_id, at, cantidad, subtotal, total').limit(20000),
    db.from('risk_saldos').select('user_id, saldo').limit(20000),
    db.from('risk_consultas').select('user_id, de_cache, estado, check_id').limit(100000),
  ])
  const cajas = (caja.data ?? []) as any[], cps = (compras.data ?? []) as any[], sds = (saldos.data ?? []) as any[], cns = (consultas.data ?? []) as any[]
  const compradas = cajas.reduce((n, c) => n + Number(c.unidades), 0)
  const costoTotal = cajas.reduce((n, c) => n + Number(c.costo_total), 0)
  const costoUnit = compradas ? costoTotal / compradas : 0
  // Cada check creado en Sarblock gasta un crédito de la caja, aunque falle.
  const consumidas = cns.filter(c => c.check_id).length
  const disponibles = compradas - consumidas
  const vendidas = cps.reduce((n, c) => n + Number(c.cantidad), 0)
  const ingresos = cps.reduce((n, c) => n + Number(c.subtotal), 0)
  const pendientesClientes = sds.reduce((n, s) => n + Math.max(0, Number(s.saldo)), 0)
  const usadasClientes = cns.filter(c => c.estado !== 'fallida').length
  // Las que salieron del padrón no le costaron nada a Lincoin.
  const usadasConCosto = cns.filter(c => c.estado !== 'fallida' && !c.de_cache).length
  const costoVendidas = usadasConCosto * costoUnit
  const coberturaPct = pendientesClientes ? Math.round((disponibles / pendientesClientes) * 100) : null

  // Todas las empresas son clientes del admin, aunque nunca hayan comprado:
  // así se les puede ver el saldo y hacer un ajuste.
  const { data: empresasData } = await db.from('users').select('id').eq('role', 'business').limit(20000)
  const uids = [...new Set([...((empresasData ?? []) as any[]).map(u => u.id), ...sds.map(s => s.user_id), ...cps.map(c => c.user_id)])]
  const nombres: Record<string, string> = {}
  for (let i = 0; i < uids.length; i += 200) {
    const { data } = await db.from('users').select('id, company_name, full_name, name, email, rdEmpresa:raw_data->>companyName').in('id', uids.slice(i, i + 200))
    for (const u of (data ?? []) as any[]) nombres[u.id] = u.company_name || u.rdEmpresa || u.full_name || u.name || u.email || u.id
  }
  const clientes = uids.map(uid => {
    const suyas = cps.filter(c => c.user_id === uid)
    return {
      uid, nombre: nombres[uid] ?? uid, saldo: Number(sds.find(s => s.user_id === uid)?.saldo ?? 0),
      compradas: suyas.reduce((m, x) => m + Number(x.cantidad), 0),
      pagado: suyas.reduce((m, x) => m + Number(x.total), 0),
      usadas: cns.filter(c => c.user_id === uid && c.estado !== 'fallida').length,
      ultimaCompra: suyas.map(x => x.at).sort().reverse()[0] ?? null,
    }
  }).sort((a, b) => b.compradas - a.compradas || b.saldo - a.saldo || a.nombre.localeCompare(b.nombre))

  return {
    caja: { compradas, costoTotal, costoUnit, consumidas, disponibles },
    ventas: { vendidas, ingresos, usadasClientes, usadasConCosto, costoVendidas, ganancia: ingresos - costoVendidas },
    pendientesClientes, coberturaPct,
    reponer: pendientesClientes > 0 && (coberturaPct ?? 0) < cfg.avisoCajaCoberturaPct,
    clientes,
    comprasProveedor: cajas.map(c => ({ id: c.id, at: c.at, unidades: c.unidades, costoTotal: Number(c.costo_total), nota: c.nota, por: c.por })),
  }
}
