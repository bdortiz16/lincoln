// ══════════════════════════════════════════════════════════════════
//  Cuánto movió un movimiento en UN bolsillo de un cliente.
//
//  Para el detalle de un bolsillo en la Billetera (24 nov, el dueño: "al
//  seleccionar la empresa debe salir los cargues para verificar que sí estén
//  bien… siento que no se está sumando el cargue de 69 millones"). Con esto
//  se arma, fila por fila, el saldo de un cliente en un bolsillo (COP_BREB,
//  COP_ACH, COP_C3, COP_C4…) y se compara con el guardado.
//
//  LAS REGLAS SON LAS DE QUIEN MOVIÓ LA PLATA (revisadas el 24 nov contra el
//  código que escribe cada tipo), no una suposición:
//   · Todo cambio de saldo pasa por adjust_balances, y una devolución o un
//     reverso cambia la MISMA fila (status + refunded/refundCop/reversado);
//     no se inserta una fila que compense. La única excepción son las
//     correcciones de un cargue manual: un 'adjustment' aparte.
//   · Lo que un cliente inserta desde el navegador queda 'Pendiente' con
//     insertadoPorCliente y no mueve plata por sí solo.
//  Lo que no se sabe con certeza (créditos o devoluciones "inciertos") se
//  marca: la suma lo toma como quedó registrado y la pantalla lo avisa.
// ══════════════════════════════════════════════════════════════════

export type Clase = 'cargue' | 'otc' | 'recaudo' | 'ajuste' | 'envio' | 'conversion' | 'traslado' | 'otro'
export type Efecto = {
  efecto: number            // + entra al bolsillo, − sale; 0 si no lo movió
  clase: Clase
  titulo: string
  detalle: string | null
  ref: string | null
  nota: string | null       // por qué no movió saldo, o qué revisar
  incierto: boolean
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const r2 = (n: number) => Math.round(n * 100) / 100
const may = (v: unknown) => String(v ?? '').toUpperCase()
const txt = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s ? s : null }
const unir = (...p: unknown[]) => { const s = p.map(txt).filter(Boolean).join(' · '); return s || null }

// Marcas de "el monto de la fila puede no ser lo que de verdad pasó".
const MARCAS_INCIERTAS: [string, string][] = [
  ['creditoIncierto', 'crédito incierto'], ['reembolsoIncierto', 'devolución incierta'], ['abonoIncierto', 'abono incierto'],
  ['reembolsoPendiente', 'devolución pendiente'], ['revisionManual', 'en revisión manual'],
]
function incertidumbre(rd: Record<string, any>): string | null {
  const m = MARCAS_INCIERTAS.filter(([k]) => rd[k] === true).map(([, l]) => l)
  return m.length ? `Marcado: ${m.join(', ')}. El saldo pudo no moverse así; revísalo.` : null
}

const sinEfecto = (clase: Clase, titulo: string, nota: string, extra: Partial<Efecto> = {}): Efecto =>
  ({ efecto: 0, clase, titulo, detalle: null, ref: null, nota, incierto: false, ...extra })

export function efectoEnBolsillo(t: any, bolsilloIn: string): Efecto | null {
  if (!t) return null
  const P = may(bolsilloIn)
  const rd = (t.raw_data && typeof t.raw_data === 'object' ? t.raw_data : {}) as Record<string, any>
  const tipo = String(t.type ?? '')
  const st = String(t.status ?? '')
  const cur = may(t.currency)
  const monto = num(t.amount) ?? 0
  const dudosa = incertidumbre(rd)
  const conDuda = (e: Efecto): Efecto => dudosa ? { ...e, incierto: true, nota: e.nota ? `${e.nota} ${dudosa}` : dudosa } : e
  const delNavegador = rd.insertadoPorCliente === true

  // ── Envío a un banco (Bre-B / ACH) ──
  // Se descuenta monto + comisión ANTES de crear la fila. Una devolución
  // (Fallido, Rechazado, devolución tardía) deja refunded:true y, salvo en
  // el fallo inmediato, refundCop. reembolsoExterno: el sistema no devolvió
  // nada (se devolvió por otro lado).
  if (tipo === 'dispersion') {
    if (cur !== P) return null
    const titulo = txt(rd.title) ?? 'Envío'
    const detalle = unir(rd.beneficiary ?? rd.recipient?.holderName, rd.bank, rd.account)
    const ref = txt(rd.providerRef ?? rd.providerTransferId ?? rd.reference)
    if (delNavegador) return sinEfecto('envio', titulo, 'Registro del navegador: no movió saldo.', { detalle, ref })
    const fee = num(rd.feeCop) ?? 0
    const salio = r2(monto + fee)
    let volvio = 0
    let nota: string | null = fee > 0 ? `Monto ${monto.toLocaleString('es-CO')} + comisión ${fee.toLocaleString('es-CO')}.` : null
    if (rd.refunded === true) {
      const rc = num(rd.refundCop)
      volvio = rd.reembolsoExterno === true ? (rc ?? 0) : (rc ?? salio)
      nota = rd.reembolsoExterno === true
        ? 'Devuelto por fuera del sistema (otro movimiento): aquí no se devolvió nada.'
        : `${st || 'Devuelto'}: se le devolvieron ${volvio.toLocaleString('es-CO')}.`
    }
    return conDuda({ efecto: r2(volvio - salio), clase: 'envio', titulo, detalle, ref, nota, incierto: false })
  }

  // ── Retiro / envío de saldo ('send') ──
  // El retiro que pide el cliente descuenta 'amount' del bolsillo que dice
  // debitadoCol (la moneda puede decir COP y salir de COP_ACH). Rechazado:
  // se le devuelve. Una fila insertada desde el navegador sin débito no
  // movió nada. Los envíos de USDT van a USD/USDT_*, no a un bolsillo COP.
  if (tipo === 'send') {
    const col = may(rd.debitadoCol ?? t.currency)
    if (col !== P) return null
    const titulo = txt(rd.title) ?? 'Retiro'
    const detalle = unir(rd.beneficiary, rd.bank, rd.account)
    const debitado = rd.debitado === true || !delNavegador
    if (!debitado) return sinEfecto('envio', titulo, 'Solicitud sin débito: no movió saldo.', { detalle })
    if (st === 'Rechazado' && rd.reembolsado !== false) return conDuda(sinEfecto('envio', titulo, 'Rechazado: se le devolvió.', { detalle }))
    return conDuda({ efecto: -r2(monto), clase: 'envio', titulo, detalle, ref: txt(rd.providerRef ?? rd.reference), nota: null, incierto: false })
  }

  // ── Cargues y recaudos ──
  if (tipo === 'load') {
    if (cur !== P) return null
    const fuente = String(rd.source ?? '')
    const clase: Clase = fuente === 'mouv_breb_recaudo' || fuente === 'finity_payment_link' || fuente === 'mouv_payin_pse' ? 'recaudo' : 'cargue'
    const titulo = fuente === 'admin_cargue' ? (txt(rd.note) ?? 'Cargue manual')
      : fuente === 'admin_backfill' ? 'Registro histórico'
      : fuente === 'mouv_breb_recaudo' ? 'Recaudo Bre-B'
      : fuente === 'finity_payment_link' ? 'Link de pago'
      : fuente === 'mouv_payin_pse' ? 'Pago PSE'
      : (txt(rd.title) ?? txt(rd.method) ?? 'Cargue')
    const detalle = unir(rd.pagador ?? rd.senderName, rd.pagadorBanco, fuente === 'admin_cargue' && num(rd.feeCop) ? `bruto ${num(rd.grossCop)?.toLocaleString('es-CO')} − comisión ${num(rd.feeCop)?.toLocaleString('es-CO')}` : null)
    const ref = txt(rd.providerRef ?? rd.reference ?? rd.endToEndId)
    if (fuente === 'admin_backfill' || rd.recordOnly === true) return sinEfecto(clase, titulo, 'Solo registro histórico: no movió saldo.', { detalle, ref })
    if (st === 'Completado') return conDuda({ efecto: r2(monto), clase, titulo, detalle, ref, nota: null, incierto: false })
    if (st === 'Devuelto' || st === 'Rechazado') {
      // Un recaudo devuelto: si se le había acreditado y se le descontó una
      // parte (debitadoCop), lo que quedó es la diferencia.
      const deb = num(rd.debitadoCop)
      if (deb != null && rd.reversadoSinDebito !== true) return conDuda({ efecto: r2(monto - deb), clase, titulo, detalle, ref, nota: `Devuelto: se le descontaron ${deb.toLocaleString('es-CO')} de lo acreditado.`, incierto: false })
      return conDuda(sinEfecto(clase, titulo, `${st}: no quedó acreditado.`, { detalle, ref }))
    }
    return conDuda(sinEfecto(clase, titulo, `${st || 'Pendiente'}: todavía no acreditado.`, { detalle, ref }))
  }

  // ── Ajuste manual (descuento) ──
  if (tipo === 'adjustment') {
    if (cur !== P) return null
    const titulo = rd.reversaDe ? 'Reversa de un cargue' : (txt(rd.note) ?? 'Ajuste manual')
    if (rd.recordOnly === true || rd.source === 'admin_backfill') return sinEfecto('ajuste', titulo, 'Solo registro histórico: no movió saldo.')
    if (st !== 'Completado') return sinEfecto('ajuste', titulo, `${st || 'Pendiente'}: no se aplicó.`)
    const signo = String(rd.direction ?? 'debit') === 'credit' ? 1 : -1
    return conDuda({ efecto: r2(signo * monto), clase: 'ajuste', titulo, detalle: rd.reversaDe ? txt(rd.note) : null, ref: null, nota: null, incierto: false })
  }

  // ── Conversiones ──
  if (tipo === 'convert') {
    if (delNavegador) return cur === P ? sinEfecto('conversion', txt(rd.title) ?? 'Conversión', 'Registro del navegador: no movió saldo.') : null
    // Cierre de la mesa OTC: acredita 'amount' en 'currency'. Anulado: la fila
    // queda Rechazado y se descontó lo mismo (neto 0).
    if (String(rd.source ?? '') === 'OTC_MANUAL') {
      if (cur !== P) return null
      const titulo = `Cierre OTC${rd.otcRef ? ` ${rd.otcRef}` : ''}`
      const detalle = unir(num(rd.fromAmount) != null ? `${num(rd.fromAmount)!.toLocaleString('es-CO')} ${rd.fromCurrency ?? 'USDT'}` : null, num(rd.mouvRate) ? `tasa ${num(rd.mouvRate)!.toLocaleString('es-CO')}` : null, rd.completadaPor ? `mesa · ${rd.completadaPor}` : null)
      if (st === 'Completado') return conDuda({ efecto: r2(monto), clase: 'otc', titulo, detalle, ref: null, nota: null, incierto: false })
      return conDuda(sinEfecto('otc', titulo, st === 'Rechazado' ? 'Cierre anulado por la mesa: se descontó lo acreditado.' : `${st}: no acreditado.`, { detalle }))
    }
    // GasFree (USDT → pesos): descuenta USD al empezar y acredita los pesos
    // solo al completarse; si un admin lo liquidó a mano, el crédito fue
    // settledCop en settledRail.
    if (rd.gasfree === true || String(rd.source ?? '') === 'MOUV') {
      const destino = rd.adminSettled ? may(rd.settledRail) : cur
      if (destino !== P) return null
      const acredita = rd.adminSettled ? (num(rd.settledCop) ?? 0) : monto
      const titulo = txt(rd.title) ?? 'Conversión USDT → COP'
      const detalle = num(rd.fromAmount) != null ? `${num(rd.fromAmount)!.toLocaleString('es-CO')} USDT` : null
      if (st === 'Completado') return conDuda({ efecto: r2(acredita), clase: 'conversion', titulo, detalle, ref: null, nota: rd.adminSettled ? 'Liquidada a mano por un admin.' : null, incierto: false })
      return conDuda(sinEfecto('conversion', titulo, `${st || 'Pendiente'}: los pesos no se han acreditado.`, { detalle }))
    }
    // Conversión de la app: sale 'amount' de 'currency' y entra targetAmount
    // en targetCurrency.
    const destino = may(rd.targetCurrency ?? rd.destCurrency)
    if (cur !== P && destino !== P) return null
    const titulo = txt(rd.title) ?? `Conversión ${cur} → ${destino || '—'}`
    if (st !== 'Completado') return sinEfecto('conversion', titulo, `${st || 'Pendiente'}: no se aplicó.`)
    const efecto = cur === P ? -monto : (num(rd.targetAmount) ?? num(rd.destAmount) ?? 0)
    return conDuda({ efecto: r2(efecto), clase: 'conversion', titulo, detalle: null, ref: null, nota: null, incierto: false })
  }

  // ── Traslado Saldo Lincoin → ACH (lo aprueba Tesorería) ──
  // Al pedirlo sale de fromRail; aprobado, entra en toRail; rechazado, vuelve.
  if (tipo === 'rail_move') {
    const de = may(rd.fromRail ?? 'COP'), a = may(rd.toRail ?? 'COP_ACH')
    if (de !== P && a !== P) return null
    const titulo = `Traslado ${de === 'COP' ? 'Saldo Lincoin' : de} → ${a === 'COP_ACH' ? 'ACH' : a}`
    if (a === P) {
      if (st === 'Completado') return conDuda({ efecto: r2(monto), clase: 'traslado', titulo, detalle: null, ref: null, nota: null, incierto: false })
      return conDuda(sinEfecto('traslado', titulo, st === 'Pendiente' ? 'Pendiente de aprobar: todavía no entra.' : `${st}: no entró.`))
    }
    if (st === 'Rechazado' || rd.debitado !== true && delNavegador) return conDuda(sinEfecto('traslado', titulo, st === 'Rechazado' ? 'Rechazado: se le devolvió.' : 'Sin débito: no movió saldo.'))
    return conDuda({ efecto: -r2(monto), clase: 'traslado', titulo, detalle: null, ref: null, nota: st === 'Pendiente' ? 'Pendiente de aprobar: ya salió de aquí.' : null, incierto: false })
  }

  // ── Traslado viejo entre Saldo Lincoin y Bre-B (sin uso desde el 6 nov) ──
  // La dirección solo está en el título. Solo los del servidor movieron plata.
  if (tipo === 'breb_move') {
    const titulo = txt(rd.title) ?? 'Traslado Bre-B'
    const haciaBreb = /→\s*BreB/i.test(titulo)
    const desdeBreb = /BreB\s+Lincoin\s*→/i.test(titulo)
    const toca = P === 'COP_BREB' ? (haciaBreb || desdeBreb) : P === 'COP' ? (haciaBreb || desdeBreb) : false
    if (!toca) return null
    if (rd.servidor !== true || st !== 'Completado') return sinEfecto('traslado', titulo, 'Registro del navegador o sin completar: no movió saldo.')
    const entraABreb = haciaBreb ? 1 : -1
    return { efecto: r2((P === 'COP_BREB' ? entraABreb : -entraABreb) * monto), clase: 'traslado', titulo, detalle: null, ref: null, nota: null, incierto: false }
  }

  // ── Pagos entre cuentas de Lincoin ──
  // Cargar a un operador (psp): el débito se reparte entre COP, COP_BREB y
  // COP_ACH según raw_data.rieles. Entre clientes (cuypay_transfer): sale y
  // entra en la misma moneda.
  if (tipo === 'pay_sent' || tipo === 'pay_received') {
    const titulo = txt(rd.title) ?? (tipo === 'pay_sent' ? 'Pago a otra cuenta Lincoin' : 'Pago recibido de otra cuenta Lincoin')
    const detalle = unir(rd.recipientName ?? rd.beneficiary ?? rd.counterpartyName ?? rd.senderName)
    if (tipo === 'pay_sent' && rd.rieles && typeof rd.rieles === 'object') {
      const parte = num(rd.rieles[P])
      if (!parte) return null
      if (st !== 'Completado') return sinEfecto('traslado', titulo, `${st}: no se aplicó.`, { detalle })
      return conDuda({ efecto: -r2(parte), clase: 'traslado', titulo, detalle, ref: null, nota: null, incierto: false })
    }
    if (cur !== P) return null
    if (st !== 'Completado') return sinEfecto('traslado', titulo, `${st || 'Pendiente'}: no se aplicó.`, { detalle })
    return conDuda({ efecto: r2(tipo === 'pay_sent' ? -monto : monto), clase: 'traslado', titulo, detalle, ref: null, nota: null, incierto: false })
  }

  // ── Cualquier otro tipo en esta moneda ──
  // No hay código en el repositorio que lo escriba (o no mueve saldos COP):
  // se muestra sin sumar, para que se vea si explica una diferencia.
  if (cur === P) {
    return sinEfecto('otro', txt(rd.title) ?? tipo, `Tipo «${tipo}» sin regla conocida: no se suma. Si explica la diferencia, revísalo.`, { incierto: true })
  }
  return null
}
