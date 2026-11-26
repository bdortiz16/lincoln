// ── TCRM: la tasa de cambio representativa del mercado certificada ─────────
// La UIAF pide el valor en pesos de cada operación con activos virtuales "a
// la TCRM" del día (Anexo 3, Resolución 314 de 2021). Lincoin no la guarda:
// se lee de la fuente oficial, el conjunto de datos abiertos de la
// Superintendencia Financiera (datos.gov.co, recurso 32sa-8pi3), que trae una
// fila por vigencia (un fin de semana es una sola fila, de viernes a lunes).
//
// Si la consulta falla, se dice: nunca se pone una tasa de otro día ni una
// supuesta, porque ese valor va en un reporte a la UIAF.

export type VigenciaTcrm = { desde: string; hasta: string; valor: number }

const RECURSO = 'https://www.datos.gov.co/resource/32sa-8pi3.json'

export async function tcrmVigencias(desde: string, hasta: string): Promise<{ ok: true; vigencias: VigenciaTcrm[] } | { ok: false; error: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return { ok: false, error: 'rango inválido' }
  const donde = `vigenciahasta >= '${desde}T00:00:00.000' AND vigenciadesde <= '${hasta}T00:00:00.000'`
  const url = `${RECURSO}?$where=${encodeURIComponent(donde)}&$order=vigenciadesde&$limit=400`
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
    if (!r.ok) return { ok: false, error: `datos.gov.co respondió ${r.status}` }
    const filas = await r.json()
    if (!Array.isArray(filas)) return { ok: false, error: 'respuesta inesperada de datos.gov.co' }
    const vigencias: VigenciaTcrm[] = []
    for (const f of filas as any[]) {
      const valor = Number(f?.valor)
      const d = String(f?.vigenciadesde ?? '').slice(0, 10)
      const h = String(f?.vigenciahasta ?? '').slice(0, 10)
      if (String(f?.unidad ?? 'COP').toUpperCase() !== 'COP') continue
      if (!(valor > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{4}-\d{2}-\d{2}$/.test(h)) continue
      vigencias.push({ desde: d, hasta: h, valor })
    }
    return { ok: true, vigencias }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 120) }
  }
}
