// ══════════════════════════════════════════════════════════════════
//  Tarifa fija por envío: una para Bre-B y otra para ACH.
//
//  Antes cada cuenta cobraba lo suyo (Bre-B Cuenta 1 y 2: $1.200; Cuentas 3
//  y 4: $2.500; ACH: $2.500) y nada cubría la consulta AML del beneficiario,
//  que Lincoin le paga a Sarblock. El dueño pidió (2026-11) un precio FIJO
//  por riel, igual en todas las cuentas, que cubra lo peor que pueda costar:
//
//      tarifa del riel = el costo más alto de los proveedores de ese riel
//                      + el costo de una consulta AML
//                      + la utilidad que se quiera ganar (0 si no)
//
//  La tarifa se GUARDA ya calculada (con el código 2FA del dueño): si
//  después cambia el costo de la consulta en Sarblock, los envíos no cambian
//  de precio solos; el panel avisa que hay que recalcular.
//
//  Vive en system_config (solo el servidor la lee). Sin tarifa guardada, o
//  apagada, cada cuenta cobra lo de antes: nada cambia hasta que el dueño la
//  activa.
//
//  topeReembolso: el MÁXIMO histórico de las tarifas guardadas. Un reembolso
//  devuelve la comisión de la fila, con ese tope; si se usara la tarifa
//  vigente y el dueño la bajara, un envío viejo cobrado más caro se
//  devolvería incompleto.
// ══════════════════════════════════════════════════════════════════

export const CLAVE_TARIFAS_ENVIO = 'tarifas_envio'

// Los proveedores de cada riel. La clave es la que guarda la base del
// cálculo; la etiqueta solo la ve el admin.
export const PROVEEDORES_RIEL: Record<'breb' | 'ach', ReadonlyArray<readonly [string, string]>> = {
  breb: [['mouv', 'Mouv · Cuenta 1'], ['finity', 'Finity · Cuenta 2'], ['coinsenda', 'Coinsenda · Cuentas 3 y 4']],
  ach: [['finity', 'Finity · ACH'], ['coinsenda', 'Coinsenda · Cuentas 3 y 4']],
}

export type BaseTarifa = {
  costos: { breb: Record<string, number>; ach: Record<string, number> }
  costoAml: number
  utilidad: { breb: number; ach: number }
}
export type TarifasEnvio = {
  activo: boolean
  breb: number
  ach: number
  topeReembolso: number
  base: BaseTarifa | null
  at: string | null
  por: string | null
}

const n0 = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? Math.round(x) : 0 }

// Lo que valen las tarifas con una base dada.
export function calcularTarifas(base: BaseTarifa): { breb: number; ach: number; masAlto: { breb: number; ach: number } } {
  const mx = (o: Record<string, number>) => Math.max(0, ...Object.values(o ?? {}).map(n0))
  const masAlto = { breb: mx(base.costos.breb), ach: mx(base.costos.ach) }
  return {
    breb: masAlto.breb + n0(base.costoAml) + n0(base.utilidad?.breb),
    ach: masAlto.ach + n0(base.costoAml) + n0(base.utilidad?.ach),
    masAlto,
  }
}

// Una base escrita por el admin, limpia: solo los proveedores conocidos y
// números enteros no negativos.
export function normalizarBase(b: any): BaseTarifa {
  const costos = { breb: {} as Record<string, number>, ach: {} as Record<string, number> }
  for (const riel of ['breb', 'ach'] as const) for (const [k] of PROVEEDORES_RIEL[riel]) costos[riel][k] = n0(b?.costos?.[riel]?.[k])
  return { costos, costoAml: n0(b?.costoAml), utilidad: { breb: n0(b?.utilidad?.breb), ach: n0(b?.utilidad?.ach) } }
}

// Leída de la base, con un minuto de memoria: la cotización y el envío la
// piden en cada operación. Un cambio del dueño se ve a más tardar en 60 s
// (la cotización y el cobro leen la misma copia).
let enMemoria: { t: TarifasEnvio | null; at: number } | null = null
export async function leerTarifasEnvio(db: any, fresca = false): Promise<TarifasEnvio | null> {
  if (!fresca && enMemoria && Date.now() - enMemoria.at < 60_000) return enMemoria.t
  let t: TarifasEnvio | null = null
  try {
    const { data } = await db.from('system_config').select('value').eq('key', CLAVE_TARIFAS_ENVIO).maybeSingle()
    const v = data?.value ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) : null
    if (v && typeof v === 'object') {
      t = {
        activo: v.activo === true, breb: n0(v.breb), ach: n0(v.ach),
        topeReembolso: Math.max(n0(v.topeReembolso), n0(v.breb), n0(v.ach)),
        base: v.base ? normalizarBase(v.base) : null, at: v.at ?? null, por: v.por ?? null,
      }
    }
  } catch { t = enMemoria?.t ?? null }
  enMemoria = { t, at: Date.now() }
  return t
}

// La tarifa vigente de un riel, o null si no hay tarifa fija activa (se
// cobra la de cada cuenta, como antes). Una tarifa en 0 no se aplica: sería
// regalar los envíos por un error de digitación.
export function tarifaFija(t: TarifasEnvio | null, riel: 'BREB' | 'ACH'): number | null {
  if (!t?.activo) return null
  const v = riel === 'BREB' ? t.breb : t.ach
  return v > 0 ? v : null
}
