import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  textoAFirmar, firmar, horaValida, generarSecreto, generarLlaveId, cifrar, descifrar,
  evaluarGeneracion, GRACIA_MS, VIDA_MS, type Gen,
} from './firma.ts'

// Vector calculado con Node (crypto.createHmac) — el mismo que trae la guía.
const SECRETO = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA'
const FIRMA = '2f322d5c5aab4ca8e4e7342cac88a7900021e879d8d95328a7c1749b7b03f1ad'

Deno.test('firma: coincide con el vector calculado en Node', async () => {
  const texto = await textoAFirmar('GET', '/functions/v1/api-empresas', new URLSearchParams('id=JERO123'), '2026-11-12T22:10:00Z', 'n0nce-0000-1111', '')
  assertEquals(texto, 'GET\n/functions/v1/api-empresas\nid=JERO123\n2026-11-12T22:10:00Z\nn0nce-0000-1111\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assertEquals(await firmar(SECRETO, texto), FIRMA)
})

Deno.test('firma: el orden de la query no importa', async () => {
  const a = await textoAFirmar('GET', '/x', new URLSearchParams('b=2&a=1'), 'h', 'n', '')
  const b = await textoAFirmar('GET', '/x', new URLSearchParams('a=1&b=2'), 'h', 'n', '')
  assertEquals(a, b)
})

Deno.test('hora: ±5 minutos', () => {
  const ahora = Date.parse('2026-11-12T22:10:00Z')
  assert(horaValida('2026-11-12T22:06:00Z', ahora))
  assert(horaValida('2026-11-12T22:14:00Z', ahora))
  assertEquals(horaValida('2026-11-12T22:04:00Z', ahora), false)
  assertEquals(horaValida('basura', ahora), false)
})

Deno.test('secreto y llave: formato', () => {
  const s = generarSecreto()
  assertEquals(s.length, 43)
  assert(/^[A-Za-z0-9_-]+$/.test(s))
  assert(/^lk_[0-9a-f]{12}$/.test(generarLlaveId()))
  assert(generarSecreto() !== s)
})

const CLAVE = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))

Deno.test('cifrado: ida y vuelta, y un byte cambiado falla', async () => {
  const c = await cifrar(CLAVE, 'mi-secreto')
  assertEquals(await descifrar(CLAVE, c), 'mi-secreto')
  const [iv, ct] = c.split('.')
  const roto = ct.slice(0, -2) + (ct.slice(-2) === 'AA' ? 'AB' : 'AA')
  await assertRejects(() => descifrar(CLAVE, `${iv}.${roto}`))
})

Deno.test('generación: vigente, gracia, reuso, vencida, desconocida', () => {
  const ahora = Date.parse('2026-11-12T22:00:00Z')
  const iso = (ms: number) => new Date(ms).toISOString()
  const gens: Gen[] = [
    { generacion: 1, expira_at: iso(ahora + VIDA_MS), reemplazado_at: iso(ahora - 2 * 60e3) },
    { generacion: 2, expira_at: iso(ahora + VIDA_MS), reemplazado_at: iso(ahora - GRACIA_MS - 60e3) },
    { generacion: 3, expira_at: iso(ahora - 1), reemplazado_at: null },
    { generacion: 4, expira_at: iso(ahora + VIDA_MS), reemplazado_at: null },
  ]
  assertEquals(evaluarGeneracion(gens, 1, ahora), 'ok')
  assertEquals(evaluarGeneracion(gens, 2, ahora), 'reuso')
  assertEquals(evaluarGeneracion(gens, 3, ahora), 'vencida')
  assertEquals(evaluarGeneracion(gens, 4, ahora), 'ok')
  assertEquals(evaluarGeneracion(gens, 9, ahora), 'desconocida')
})
