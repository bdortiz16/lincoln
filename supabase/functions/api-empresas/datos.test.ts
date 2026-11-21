import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { saldosCop, saldosEmpresa, armarDetalle, armarResumen } from './datos.ts'

Deno.test('saldosCop: solo COP y numéricos', () => {
  assertEquals(saldosCop({ COP_ACH: 10, USDT: 5, COP_C3: '7', COP_X: 'nada' }), { COP_ACH: 10, COP_C3: 7, COP_X: 0 })
  assertEquals(saldosCop(null), {})
})

Deno.test('saldosEmpresa: siempre las cinco cuentas', () => {
  assertEquals(saldosEmpresa({ COP_C3: 155578292, COP_ACH: 1922593, USDT: 9 }), { COP: 0, COP_BREB: 0, COP_ACH: 1922593, COP_C3: 155578292, COP_C4: 0 })
})

const empresa = {
  id: 'emp-1', company_name: 'Empresa Prueba SAS', balances: { COP_ACH: 1922593, COP_C3: 155578292, COP_C4: 5158592 },
  raw_data: {
    ownReferralCode: 'jero123',
    personasAutorizadas: [
      { id: 'op-1', nombre: 'Ana Uno', docType: 'CC', docNumber: '111', tipoOperador: 'persona', topeMensual: 5000000, at: '2026-11-01T00:00:00Z' },
      { id: 'op-sin-fila', nombre: 'Fantasma', docType: 'CC', docNumber: '999', at: '2026-11-02T00:00:00Z' },
    ],
  },
}
const operadores = new Map([
  ['op-1', { id: 'op-1', balances: { COP_ACH: 100, COP_C3: 50, USDT: 3 }, ref: 'ana001' }],
])

Deno.test('armarDetalle: omite al operador sin fila y suma por cuenta', () => {
  const d = armarDetalle(empresa, operadores, { 'op-1': 1200 }, new Date('2026-11-12T22:00:00Z'))
  assertEquals(d.empresa, { id: 'JERO123', nombre: 'Empresa Prueba SAS', saldos: { COP: 0, COP_BREB: 0, COP_ACH: 1922593, COP_C3: 155578292, COP_C4: 5158592 }, total_cop: 162659477 })
  assertEquals(d.generado_at, '2026-11-12T22:00:00.000Z')
  assertEquals(d.clientes.length, 1)
  assertEquals(d.clientes[0], {
    id_lincoin: 'ANA001', nombre: 'Ana Uno', tipo: 'persona',
    documento: { tipo: 'CC', numero: '111' },
    saldos: { COP_ACH: 100, COP_C3: 50 },
    tope_mensual: 5000000, usado_mes: 1200, vinculado_at: '2026-11-01T00:00:00Z',
  })
  assertEquals(d.totales_clientes, { COP: 150, por_cuenta: { COP_ACH: 100, COP_C3: 50 } })
})

Deno.test('armarDetalle: empresa sin clientes', () => {
  const d = armarDetalle({ id: 'e2', full_name: 'Sola', raw_data: { ownReferralCode: 'SOLA1' } }, new Map(), {}, new Date(0))
  assertEquals(d.clientes, [])
  assertEquals(d.totales_clientes, { COP: 0, por_cuenta: {} })
  assertEquals(d.empresa.total_cop, 0)
})

Deno.test('armarResumen: id, nombre, clientes y total', () => {
  assertEquals(armarResumen(empresa, operadores), {
    id: 'JERO123', nombre: 'Empresa Prueba SAS',
    saldos: { COP: 0, COP_BREB: 0, COP_ACH: 1922593, COP_C3: 155578292, COP_C4: 5158592 }, total_cop: 162659477,
    clientes: 1, total_clientes_cop: 150,
  })
})
