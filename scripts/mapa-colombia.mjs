// ══════════════════════════════════════════════════════════════════
//  Genera components/risk/colombiaMapa.ts: los departamentos de Colombia
//  como trazos SVG ya proyectados y simplificados, y San Andrés y
//  Providencia en su recuadro.
//
//  Fuente: @john-guerra/geo-colombia 0.1.0 (MIT, John Alexis Guerra Gómez),
//  que empaqueta el Marco Geoestadístico Nacional 2018 del DANE. No se
//  agrega como dependencia (pesa 3,7 MB): se corre una vez y se guarda el
//  resultado (~30 KB).
//
//  Uso:
//    npm pack @john-guerra/geo-colombia@0.1.0 && tar xzf john-guerra-geo-colombia-0.1.0.tgz
//    node scripts/mapa-colombia.mjs package/data/colombia.topo.json package/src/sanAndresProvidencia.json
//
//  Las fronteras se simplifican sobre los ARCOS del TopoJSON (que comparten
//  los departamentos vecinos): así dos departamentos simplificados siguen
//  tocándose, sin huecos ni montes entre ellos.
// ══════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from 'node:fs'
import { geoTransverseMercator, geoPath } from 'd3-geo'
import * as topojson from 'topojson-client'

const [, , rutaTopo, rutaIslas] = process.argv
if (!rutaTopo || !rutaIslas) { console.error('Uso: node scripts/mapa-colombia.mjs <colombia.topo.json> <sanAndresProvidencia.json>'); process.exit(1) }
const topo = JSON.parse(readFileSync(rutaTopo, 'utf8'))
const islas = JSON.parse(readFileSync(rutaIslas, 'utf8'))

const ANCHO = 300, ALTO = 380, TOLERANCIA = 0.45, AREA_MINIMA = 0.8
const ISLAS_COD = '88'
const obj = topo.objects.MGN_ANM_DPTOS
const tierra = { type: 'FeatureCollection', features: topojson.feature(topo, obj).features.filter(f => f.properties.DPTO_CCDGO !== ISLAS_COD) }
const proy = geoTransverseMercator().rotate([74, -4.5]).fitExtent([[6, 6], [ANCHO - 6, ALTO - 6]], tierra)

// Arcos absolutos (el TopoJSON viene cuantizado: posiciones relativas).
const absolutos = topo.arcs.map(arco => {
  let x = 0, y = 0
  return arco.map(p => {
    if (!topo.transform) return p
    x += p[0]; y += p[1]
    return [x * topo.transform.scale[0] + topo.transform.translate[0], y * topo.transform.scale[1] + topo.transform.translate[1]]
  })
})
// Douglas-Peucker sobre el arco ya proyectado (conserva los extremos).
function simplificar(pts, tol) {
  if (pts.length <= 2) return pts
  const marca = new Uint8Array(pts.length); marca[0] = marca[pts.length - 1] = 1
  const pila = [[0, pts.length - 1]]
  while (pila.length) {
    const [a, b] = pila.pop()
    let max = -1, idx = -1
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L
      if (d > max) { max = d; idx = i }
    }
    if (max > tol) { marca[idx] = 1; pila.push([a, idx], [idx, b]) }
  }
  return pts.filter((_, i) => marca[i])
}
const arcos = absolutos.map(arco => {
  const p = arco.map(c => proy(c))
  const s = simplificar(p, TOLERANCIA)
  // Un anillo cerrado (una isla) necesita al menos 4 puntos.
  return (s.length < 4 && p.length >= 4 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) ? p : s
})
const plano = { type: 'Topology', arcs: arcos, objects: { d: { ...obj, geometries: obj.geometries.filter(g => g.properties.DPTO_CCDGO !== ISLAS_COD) } } }
const ruta = geoPath().digits(1)

const areaAnillo = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2) }
// Sin los islotes de menos de AREA_MINIMA px² (las islas del Rosario a esta escala son ruido).
function sinIslotes(geo) {
  if (geo.type === 'Polygon') return geo
  const polys = geo.coordinates.filter(p => areaAnillo(p[0]) >= AREA_MINIMA)
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys }
}

const ESPECIALES = { '11': 'Bogotá D.C.', '63': 'Quindío', '88': 'San Andrés y Providencia', '44': 'La Guajira', '54': 'Norte de Santander', '76': 'Valle del Cauca' }
const titulo = s => s.toLowerCase().split(' ').map((w, i) => i && ['de', 'del', 'y', 'la'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

const departamentos = topojson.feature(plano, plano.objects.d).features.map(f => {
  const cod = f.properties.DPTO_CCDGO
  const g = sinIslotes(f.geometry)
  const [cx, cy] = ruta.centroid({ type: 'Feature', geometry: g })
  return { cod, nombre: ESPECIALES[cod] ?? titulo(f.properties.DPTO_CNMBR), d: ruta(g), cx: Math.round(cx * 10) / 10, cy: Math.round(cy * 10) / 10 }
}).sort((a, b) => a.cod.localeCompare(b.cod))

// ── San Andrés y Providencia, en su recuadro (arriba a la izquierda, mar
//    Caribe). Las dos islas con la MISMA escala (la de San Andrés en su
//    casilla) para que se vea cuál es más grande.
const CAJA = { x: 10, y: 10, w: 58, h: 92 }
const san = islas.features.find(f => /san andr/i.test(f.properties.name))
const pro = islas.features.find(f => /providencia/i.test(f.properties.name))
const casillaSan = [[CAJA.x + 8, CAJA.y + 44], [CAJA.x + CAJA.w - 8, CAJA.y + CAJA.h - 16]]
const pSan = geoTransverseMercator().rotate([81.6, -12.9]).fitExtent(casillaSan, san)
const [[px0, py0], [px1, py1]] = geoPath(pSan).bounds(pro)
const pPro = geoTransverseMercator().rotate([81.6, -12.9]).scale(pSan.scale())
  .translate([pSan.translate()[0] + (CAJA.x + CAJA.w / 2 - (px0 + px1) / 2), pSan.translate()[1] + (CAJA.y + 24 - (py0 + py1) / 2)])
const rIslas = (p, f) => geoPath(p).digits(1)(f)
const islasSalida = { cod: ISLAS_COD, caja: CAJA, trazos: [{ nombre: 'Providencia', d: rIslas(pPro, pro) }, { nombre: 'San Andrés', d: rIslas(pSan, san) }] }

const ts = `// GENERADO por scripts/mapa-colombia.mjs — no editar a mano.
// Departamentos de Colombia (Marco Geoestadístico Nacional 2018 del DANE,
// vía @john-guerra/geo-colombia 0.1.0, licencia MIT, © John Alexis Guerra
// Gómez), proyectados en Transversa de Mercator y simplificados para un
// lienzo de ${ANCHO}×${ALTO}. San Andrés y Providencia van en su recuadro.
export const MAPA_ANCHO = ${ANCHO};
export const MAPA_ALTO = ${ALTO};
export type Departamento = { cod: string; nombre: string; d: string; cx: number; cy: number };
export const DEPARTAMENTOS: Departamento[] = ${JSON.stringify(departamentos)};
export const ISLAS: { cod: string; caja: { x: number; y: number; w: number; h: number }; trazos: { nombre: string; d: string }[] } = ${JSON.stringify(islasSalida)};
`
writeFileSync(new URL('../components/risk/colombiaMapa.ts', import.meta.url), ts)
console.log('departamentos', departamentos.length, 'bytes', ts.length)
