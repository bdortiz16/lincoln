// deno test supabase/functions/_shared/efecto-saldo.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { efectoEnBolsillo } from './efecto-saldo.ts'

const tx = (type: string, amount: number, currency: string, status: string, raw: Record<string, unknown> = {}) => ({ id: 'x', type, amount, currency, status, created_at: '2026-11-20T10:00:00Z', raw_data: raw })
const ef = (t: any, p: string) => efectoEnBolsillo(t, p)?.efecto ?? null

Deno.test('envío: monto + comisión; devuelto con refundCop vuelve a 0; Fallido sin refundCop también', () => {
  assertEquals(ef(tx('dispersion', 1_000_000, 'COP_ACH', 'Completado', { feeCop: 5000 }), 'COP_ACH'), -1_005_000)
  assertEquals(ef(tx('dispersion', 1_000_000, 'COP_ACH', 'Procesando', { feeCop: 5000 }), 'COP_ACH'), -1_005_000)
  assertEquals(ef(tx('dispersion', 1_000_000, 'COP_ACH', 'Rechazado', { feeCop: 5000, refunded: true, refundCop: 1_005_000 }), 'COP_ACH'), 0)
  assertEquals(ef(tx('dispersion', 1_000_000, 'COP_ACH', 'Fallido', { feeCop: 5000, refunded: true }), 'COP_ACH'), 0)
  // Pendiente de devolver: sigue afuera, y se marca.
  const p = efectoEnBolsillo(tx('dispersion', 1_000_000, 'COP_ACH', 'Rechazado', { feeCop: 5000, refunded: false, reembolsoPendiente: true }), 'COP_ACH')!
  assertEquals(p.efecto, -1_005_000); assertEquals(p.incierto, true)
  // Devuelto por fuera: el sistema no devolvió nada.
  assertEquals(ef(tx('dispersion', 1_000_000, 'COP_ACH', 'Rechazado', { feeCop: 5000, refunded: true, refundCop: 0, reembolsoExterno: true }), 'COP_ACH'), -1_005_000)
  // Otro bolsillo: no aplica.
  assertEquals(efectoEnBolsillo(tx('dispersion', 1_000_000, 'COP_BREB', 'Completado', { feeCop: 1200 }), 'COP_ACH'), null)
})

Deno.test('cargues: manual neto, histórico sin efecto, recaudo devuelto con descuento parcial', () => {
  assertEquals(ef(tx('load', 9_990_000, 'COP_BREB', 'Completado', { source: 'admin_cargue', grossCop: 10_000_000, feeCop: 10_000 }), 'COP_BREB'), 9_990_000)
  assertEquals(ef(tx('load', 5_000_000, 'COP_ACH', 'Completado', { source: 'admin_backfill', recordOnly: true }), 'COP_ACH'), 0)
  assertEquals(ef(tx('load', 800_000, 'COP_BREB', 'Devuelto', { source: 'mouv_breb_recaudo', reversado: true }), 'COP_BREB'), 0)
  assertEquals(ef(tx('load', 800_000, 'COP_BREB', 'Devuelto', { source: 'mouv_breb_recaudo', reversado: true, debitadoCop: 500_000 }), 'COP_BREB'), 300_000)
  assertEquals(ef(tx('load', 800_000, 'COP_BREB', 'Pendiente', { insertadoPorCliente: true }), 'COP_BREB'), 0)
})

Deno.test('ajuste y cierre OTC (completado y anulado)', () => {
  assertEquals(ef(tx('adjustment', 6_138_000, 'COP_ACH', 'Completado', { source: 'admin_cargue', direction: 'debit' }), 'COP_ACH'), -6_138_000)
  assertEquals(ef(tx('convert', 69_940_000, 'COP_ACH', 'Completado', { source: 'OTC_MANUAL', otcRef: 'OTC-942E79' }), 'COP_ACH'), 69_940_000)
  assertEquals(ef(tx('convert', 69_940_000, 'COP_ACH', 'Rechazado', { source: 'OTC_MANUAL', reversado: true }), 'COP_ACH'), 0)
  assertEquals(efectoEnBolsillo(tx('convert', 69_940_000, 'COP_ACH', 'Completado', { source: 'OTC_MANUAL' }), 'COP_BREB'), null)
})

Deno.test('conversiones GasFree y de la app; traslados', () => {
  assertEquals(ef(tx('convert', 4_000_000, 'COP_ACH', 'Completado', { gasfree: true, creditRail: 'ACH' }), 'COP_ACH'), 4_000_000)
  assertEquals(ef(tx('convert', 4_000_000, 'COP', 'Completado', { gasfree: true, adminSettled: true, settledRail: 'COP_ACH', settledCop: 3_990_000 }), 'COP_ACH'), 3_990_000)
  assertEquals(ef(tx('convert', 4_000_000, 'COP_ACH', 'Pendiente', { gasfree: true }), 'COP_ACH'), 0)
  assertEquals(ef(tx('convert', 1_000_000, 'COP_ACH', 'Completado', { targetCurrency: 'USD', targetAmount: 250 }), 'COP_ACH'), -1_000_000)
  assertEquals(ef(tx('convert', 250, 'USD', 'Completado', { targetCurrency: 'COP_BREB', targetAmount: 990_000 }), 'COP_BREB'), 990_000)
  // Saldo Lincoin → ACH: entra solo aprobado; en COP sale al pedirlo y vuelve si se rechaza.
  assertEquals(ef(tx('rail_move', 2_000_000, 'COP', 'Pendiente', { fromRail: 'COP', toRail: 'COP_ACH', debitado: true }), 'COP_ACH'), 0)
  assertEquals(ef(tx('rail_move', 2_000_000, 'COP', 'Completado', { fromRail: 'COP', toRail: 'COP_ACH', debitado: true }), 'COP_ACH'), 2_000_000)
  assertEquals(ef(tx('rail_move', 2_000_000, 'COP', 'Pendiente', { fromRail: 'COP', toRail: 'COP_ACH', debitado: true }), 'COP'), -2_000_000)
  assertEquals(ef(tx('rail_move', 2_000_000, 'COP', 'Rechazado', { fromRail: 'COP', toRail: 'COP_ACH', rejectedAt: 'x' }), 'COP'), 0)
  // Cargar a un operador: el débito se reparte por rieles.
  assertEquals(ef(tx('pay_sent', 3_000_000, 'COP', 'Completado', { psp: true, rieles: { COP: 1_000_000, COP_ACH: 2_000_000 } }), 'COP_ACH'), -2_000_000)
  assertEquals(efectoEnBolsillo(tx('pay_sent', 3_000_000, 'COP', 'Completado', { psp: true, rieles: { COP: 3_000_000 } }), 'COP_ACH'), null)
})

Deno.test('retiros y tipos sin regla', () => {
  assertEquals(ef(tx('send', 500_000, 'COP', 'Pendiente', { debitadoCol: 'COP_ACH', debitado: true }), 'COP_ACH'), -500_000)
  assertEquals(ef(tx('send', 500_000, 'COP', 'Rechazado', { debitadoCol: 'COP_ACH', debitado: true, reembolsado: true }), 'COP_ACH'), 0)
  assertEquals(ef(tx('send', 500_000, 'COP_ACH', 'Pendiente', { insertadoPorCliente: true }), 'COP_ACH'), 0)
  const raro = efectoEnBolsillo(tx('withdraw', 100, 'COP_ACH', 'Completado'), 'COP_ACH')!
  assertEquals(raro.efecto, 0); assertEquals(raro.incierto, true)
})
