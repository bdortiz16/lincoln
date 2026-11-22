// Excel con los movimientos de UN cliente, para el panel admin.
//
// Hojas (pedido del dueño, 22 nov: separar entradas, salidas y cargues, y
// poder consultar sumas sin armar fórmulas a mano):
//   · Resumen — totales por cuenta, por mes y por estado, con fórmulas sobre
//     la hoja Movimientos (si se corrige una fila, el resumen se actualiza).
//   · Consulta — se escriben filtros (fechas, dirección, estado, cuenta,
//     beneficiario, documento…) y suma sola: cuántos, entradas, salidas,
//     comisiones y neto.
//   · Movimientos — todo el historial, lo más reciente primero. Arriba, una
//     fila que suma SOLO lo que se ve: al filtrar, la suma cambia.
//   · Entradas / Salidas — lo mismo separado, cada una con su suma.
//   · Cargues — los cargues y ajustes manuales con su contabilidad (USDT,
//     tasas, utilidad), como la tabla de Cargues.
//   · Por beneficiario — cuánto se le envió a cada uno.
// Entrada y Salida solo llevan valor cuando el movimiento quedó Completado:
// un envío rechazado o en proceso no movió plata y no se suma (su monto
// sigue en la columna Monto). Fechas y montos van como fecha y número reales.
// Sin nombres de aliados: este archivo se le puede pasar al cliente.
import { descargarXlsx, refCelda, type Celda, type CeldaX } from '../lib/xlsx';

export const fechaDe = (t: any): Date | null => {
  const v = t?.creditedAt ?? t?.createdAt ?? t?.created_at ?? t?.date;
  const s = String(v ?? '').trim(); if (!s) return null;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const d = dmy ? new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])) : new Date(s);
  return isNaN(d.getTime()) ? null : d;
};
const num = (v: any): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const txt = (v: any): string => (v == null ? '' : String(v));

export const TIPOS: Record<string, string> = {
  load: 'Cargue / depósito', deposit: 'Depósito', otc_deposit: 'Depósito OTC',
  dispersion: 'Dispersión', send: 'Envío', withdraw: 'Retiro', otc_withdraw: 'Retiro OTC',
  pay_sent: 'Pago enviado', pay_received: 'Pago recibido', referral_payout: 'Pago por referido',
  convert: 'Conversión', adjustment: 'Ajuste', rail_move: 'Movimiento entre rieles', breb_move: 'Movimiento entre rieles',
};
const ENTRA = new Set(['load', 'deposit', 'otc_deposit', 'pay_received', 'referral_payout']);
const SALE = new Set(['dispersion', 'send', 'withdraw', 'otc_withdraw', 'pay_sent']);

export const monedaDe = (t: any): string => {
  const c = txt(t?.currency);
  if (c === 'COP_BREB') return t?.rail === 'ACH' ? 'COP · Bre-B (ACH Cuenta 1)' : 'COP · Bre-B';
  if (c === 'COP_ACH') return t?.rail === 'BREB' ? 'COP · ACH (Bre-B Cuenta 2)' : 'COP · ACH';
  if (c === 'COP') return 'COP · Saldo Lincoin';
  return c;
};
export const direccionDe = (t: any): string => {
  const ty = txt(t?.type);
  if (ty === 'adjustment' || t?.direction) return (t?.direction ?? 'debit') === 'credit' ? 'Entrada' : 'Salida';
  if (ENTRA.has(ty)) return 'Entrada';
  if (SALE.has(ty)) return 'Salida';
  if (ty === 'convert') return 'Conversión';
  return '';
};
export const esCargueManual = (t: any) =>
  t?.source === 'admin_cargue' || t?.source === 'admin_backfill' || t?.type === 'adjustment' || (t?.type === 'load' && !!t?.rail);

// Qué débitos revierten qué cargues (lo vincula Contabilidad: el cargue guarda
// reverso = { ajustes, montoCop, anulado } y el débito reversaDe = id del
// cargue). Un cargue ANULADO y su reversa se cancelan: se muestran juntos y se
// cuentan UNA vez — antes el cargue anulado se dejaba fuera y su débito se
// restaba además como un descuento suelto.
export type InfoReverso = { cargueRevertido: Map<string, { montoCop: number; anulado: boolean }>; reversaDe: Map<string, string> };
export function reversosDe(movimientos: any[]): InfoReverso {
  const cargueRevertido = new Map<string, { montoCop: number; anulado: boolean }>();
  const reversaDe = new Map<string, string>();
  for (const t of movimientos ?? []) {
    const rev = t?.reverso;
    if (t?.type === 'load' && rev && typeof rev === 'object') {
      const monto = Number(rev.montoCop) || 0;
      const credito = Number(t?.acct?.creditedCop ?? t?.amount) || 0;
      if (monto > 0) cargueRevertido.set(String(t.id), { montoCop: monto, anulado: rev.anulado === true || (credito > 0 && monto >= credito - 1) });
      for (const a of Array.isArray(rev.ajustes) ? rev.ajustes : []) if (a?.id != null) reversaDe.set(String(a.id), String(t.id));
    }
    if (t?.type === 'adjustment' && t?.reversaDe) reversaDe.set(String(t.id), String(t.reversaDe));
  }
  return { cargueRevertido, reversaDe };
}

const ESTADOS_OK = new Set(['Completado', 'Liquidado', 'Aprobado']);
// La cuenta por donde pasó, con los nombres que ve el cliente: el saldo
// Bre-B es la Cuenta 1 y el ACH la Cuenta 2. Cada una paga los dos rieles: el
// Bre-B que sale de la Cuenta 2 y, desde el 22 nov, el ACH de la Cuenta 1.
export const cuentaRielDe = (t: any): string => {
  const c = txt(t?.currency).toUpperCase();
  const rail = txt(t?.rail).toUpperCase();
  const riel = rail === 'BREB' ? ' · Bre-B' : rail === 'ACH' ? ' · ACH' : '';
  if (c === 'COP_BREB') return rail === 'ACH' ? 'Cuenta 1 · ACH' : 'Cuenta 1 · Bre-B';
  if (c === 'COP_ACH') return rail === 'BREB' || Number(t?.cuentaBreb) === 2 ? 'Cuenta 2 · Bre-B' : 'Cuenta 2 · ACH';
  if (c === 'COP_C3') return `Cuenta 3 · Jero${riel}`;
  if (c === 'COP_C4') return `Cuenta 4 · Kaupaloki${riel}`;
  if (c === 'COP') return 'Saldo Lincoin';
  return c;
};
const monedaCorta = (t: any): string => { const c = txt(t?.currency).toUpperCase(); return c.startsWith('COP') ? 'COP' : c; };
// Entrada o salida de plata de la cuenta. Una conversión OTC o de USDT que
// acredita pesos es una entrada; la que debita la moneda de origen, salida.
// Un movimiento entre cuentas propias no entra ni sale.
const sentidoDe = (t: any): 'Entrada' | 'Salida' | 'Entre cuentas propias' | '' => {
  const ty = txt(t?.type);
  if (ty === 'rail_move' || ty === 'breb_move') return 'Entre cuentas propias';
  if (ty === 'convert') {
    const acreditaPesos = /^COP/i.test(txt(t?.currency)) && !!(t?.otcCloseId || t?.direccion === 'in' || t?.gasfree || t?.creditRail || t?.source === 'OTC_MANUAL');
    return acreditaPesos ? 'Entrada' : 'Salida';
  }
  const d = direccionDe(t);
  return d === 'Entrada' || d === 'Salida' ? d : '';
};
const contraparteDe = (t: any, entra: boolean): string => txt(entra
  ? (t.pagador ?? t.senderName ?? t.counterpartyName ?? t.beneficiary ?? '')
  : (t.beneficiary ?? t.recipient?.holderName ?? t.recipientName ?? t.counterpartyName ?? t.counterparty ?? ''));
const documentoDe = (t: any, entra: boolean): string => txt(entra ? (t.pagadorDocumento ?? t.documentNumber) : (t.benefDoc ?? t.documentNumber ?? t.recipient?.documentNumber));
const bancoDe = (t: any): string => txt(t.pagadorBanco ?? t.bank ?? t.method).replace(/^Bre-B\s*·\s*/i, 'Bre-B · ');

// Celdas con estilo y fórmula.
const cop = (v: number | null): CeldaX => ({ v, s: 'cop' });
const fx = (f: string, s: 'totalCop' | 'totalEntero' | 'kpiCop' | 'kpiEntero' | 'cop' | 'entero' = 'totalCop'): CeldaX => ({ f, s });
const tt = (v: string): CeldaX => ({ v, s: 'totalTexto' });

export function descargarMovimientosCliente(nombreCliente: string, movimientos: any[]) {
  const ordenados = [...(movimientos ?? [])]
    .map(t => ({ t, d: fechaDe(t) }))
    .sort((a, b) => (b.d?.getTime() ?? 0) - (a.d?.getTime() ?? 0));

  // ── Movimientos ──────────────────────────────────────────────────
  // Fila 1: la suma de lo que se ve (SUBTOTAL ignora lo que esconde el
  // filtro). Fila 2: títulos. Desde la 3: los movimientos.
  const CAB_MOV = ['Fecha', 'Tipo', 'Dirección', 'Descripción', 'Estado', 'Cuenta / riel', 'Moneda', 'Monto', 'Entrada', 'Salida', 'Comisión',
    'Beneficiario / contraparte', 'Documento', 'Banco / método', 'Cuenta / llave', 'Motivo del envío', 'Motivo del rechazo', 'Referencia del proveedor', 'Id'];
  const nMov = ordenados.length;
  const ini = 3, fin = Math.max(ini, nMov + 2); // filas 1-based de los datos
  const rango = (col: number) => `${refCelda(col, ini - 1)}:${refCelda(col, fin - 1)}`.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
  const sub = (col: number, fn = 9) => `SUBTOTAL(${fn},${rango(col)})`;
  const hojaMovs: CeldaX[][] = [
    [tt('Suma de lo que se ve →'), fx(`${sub(18, 103)}`, 'totalEntero'), tt('movimientos'), tt(''), tt(''), tt(''), tt(''), tt(''), fx(sub(8)), fx(sub(9)), fx(sub(10))],
    CAB_MOV,
  ];
  const filasMov: { t: any; d: Date | null; sentido: string; ok: boolean }[] = [];
  for (const { t, d } of ordenados) {
    const sentido = sentidoDe(t);
    const ok = ESTADOS_OK.has(txt(t.status));
    const monto = Math.abs(num(t.amount) ?? 0);
    const entra = sentido === 'Entrada';
    filasMov.push({ t, d, sentido, ok });
    hojaMovs.push([
      d, TIPOS[txt(t.type)] ?? txt(t.type), sentido, txt(t.title), txt(t.status), cuentaRielDe(t), monedaCorta(t),
      // La comisión solo cuenta si se cobró: la de un envío fallido se devuelve.
      cop(monto), cop(ok && entra ? monto : null), cop(ok && sentido === 'Salida' ? monto : null), cop(ok ? num(t.feeCop ?? t.fee) : null),
      contraparteDe(t, entra), documentoDe(t, entra), bancoDe(t), txt(t.account ?? t.llave ?? t.recipient?.key ?? t.recipient?.accountNumber),
      txt(t.motivoTexto ?? t.reason), txt(t.providerError ?? t.errorMessage ?? t.rejectReason), txt(t.providerRef ?? t.providerTransferId ?? t.reference ?? t.txHash), txt(t.id),
    ]);
  }
  const otrasMonedas = filasMov.some(f => monedaCorta(f.t) !== 'COP');

  // ── Entradas y Salidas: lo mismo, separado, con su suma arriba ──
  const hojaDe = (lado: 'Entrada' | 'Salida') => {
    const entra = lado === 'Entrada';
    const cab = entra
      ? ['Fecha', 'Tipo', 'Estado', 'Cuenta / riel', 'Moneda', 'Monto', 'Acreditado (completado)', 'Comisión', 'Pagador / origen', 'Documento', 'Banco / método', 'Referencia del proveedor', 'Nota', 'Id']
      : ['Fecha', 'Tipo', 'Estado', 'Cuenta / riel', 'Moneda', 'Monto', 'Salió (completado)', 'Comisión', 'Beneficiario', 'Documento', 'Banco / método', 'Cuenta / llave', 'Motivo del envío', 'Motivo del rechazo', 'Referencia del proveedor', 'Id'];
    const filas = filasMov.filter(f => f.sentido === lado);
    const n = filas.length, a = 3, b = Math.max(a, n + 2);
    const r = (col: number) => `${refCelda(col, a - 1)}:${refCelda(col, b - 1)}`;
    const hoja: CeldaX[][] = [
      [tt('Suma de lo que se ve →'), fx(`SUBTOTAL(103,${r(cab.length - 1)})`, 'totalEntero'), tt(entra ? 'entradas' : 'salidas'), tt(''), tt(''), fx(`SUBTOTAL(9,${r(5)})`), fx(`SUBTOTAL(9,${r(6)})`), fx(`SUBTOTAL(9,${r(7)})`)],
      cab,
    ];
    for (const { t, d, ok } of filas) {
      const monto = Math.abs(num(t.amount) ?? 0);
      hoja.push(entra
        ? [d, TIPOS[txt(t.type)] ?? txt(t.type), txt(t.status), cuentaRielDe(t), monedaCorta(t), cop(monto), cop(ok ? monto : null), cop(ok ? num(t.feeCop ?? t.fee) : null),
          contraparteDe(t, true), documentoDe(t, true), bancoDe(t), txt(t.providerRef ?? t.providerTransferId ?? t.reference ?? t.txHash), txt(t.note ?? t.title), txt(t.id)]
        : [d, TIPOS[txt(t.type)] ?? txt(t.type), txt(t.status), cuentaRielDe(t), monedaCorta(t), cop(monto), cop(ok ? monto : null), cop(ok ? num(t.feeCop ?? t.fee) : null),
          contraparteDe(t, false), documentoDe(t, false), bancoDe(t), txt(t.account ?? t.recipient?.key ?? t.recipient?.accountNumber), txt(t.motivoTexto ?? t.reason),
          txt(t.providerError ?? t.errorMessage ?? t.rejectReason), txt(t.providerRef ?? t.reference ?? t.txHash), txt(t.id)]);
    }
    return { hoja, cab, n };
  };
  const ent = hojaDe('Entrada');
  const sal = hojaDe('Salida');

  // ── Cargues (con su contabilidad) ──
  const cargues = ordenados.filter(({ t }) => esCargueManual(t));
  const rev = reversosDe(movimientos ?? []);
  const fechaPorId = new Map<string, Date | null>(ordenados.map(({ t, d }) => [String(t.id), d]));
  // Lo acreditado que SIGUE vigente (cargue menos lo que se le revirtió), los
  // anulados aparte, y los descuentos que NO revierten un cargue. El neto es
  // el mismo de siempre, pero un cargue anulado y su reversa ya no aparecen
  // como un acreditado más un descuento adicional.
  let vigente = 0, descontadoSuelto = 0, corregido = 0, anuladoCop = 0, nAnulados = 0;
  const nCar = cargues.length, ca = 3, cb = Math.max(ca, nCar + 2);
  const rc = (col: number) => `${refCelda(col, ca - 1)}:${refCelda(col, cb - 1)}`;
  const hojaCargues: CeldaX[][] = [
    [tt('Suma de lo que se ve →'), fx(`SUBTOTAL(103,${rc(11)})`, 'totalEntero'), tt('cargues'), fx(`SUBTOTAL(9,${rc(3)})`), fx(`SUBTOTAL(9,${rc(4)})`), fx(`SUBTOTAL(9,${rc(5)})`), { f: `SUBTOTAL(9,${rc(6)})`, s: 'totalUsd' }, tt(''), tt(''), fx(`SUBTOTAL(9,${rc(9)})`)],
    ['Fecha', 'Cuenta', 'Movimiento', 'Neto COP', 'Bruto COP', 'Comisión COP', 'USDT', 'Tasa de venta', 'Tasa al cliente', 'Utilidad COP', 'Nota', 'Id'],
  ];
  for (const { t, d } of cargues) {
    const credito = (t.direction ?? (t.type === 'load' ? 'credit' : 'debit')) === 'credit';
    const soloRegistro = t.source === 'admin_backfill' || t.recordOnly === true;
    const monto = num(t.amount) ?? 0;
    const r = rev.cargueRevertido.get(String(t.id));
    const cargueDe = rev.reversaDe.get(String(t.id));
    let movimiento = soloRegistro ? 'Solo registro' : credito ? 'Acreditado' : 'Descontado';
    if (credito && r) movimiento = r.anulado ? 'Anulado (revertido completo)' : `Corregido (se revirtieron ${r.montoCop.toLocaleString('es-CO')})`;
    if (!credito && cargueDe) {
      const f = fechaPorId.get(cargueDe);
      movimiento = `Reversa del cargue${f ? ` del ${f.toLocaleDateString('es-CO')}` : ''}`;
    }
    if (!soloRegistro) {
      if (credito) {
        if (r?.anulado) { nAnulados++; anuladoCop += monto; }
        else { vigente += monto - (r?.montoCop ?? 0); corregido += r?.montoCop ?? 0; }
      } else if (!cargueDe) descontadoSuelto += monto;
    }
    const a = t.acct ?? {};
    hojaCargues.push([
      d, cuentaRielDe({ ...t, currency: t.rail ?? t.currency, rail: null }),
      movimiento,
      cop(credito ? monto : -monto), cop(num(t.grossCop)), cop(num(t.feeCop)),
      num(a.usdtGross), num(a.sellRate), num(a.clientRate), cop(num(a.utilityCop)),
      txt(t.note), txt(t.id),
    ]);
  }

  // ── Por beneficiario: lo que salió completado a cada uno ──
  const porBen = new Map<string, { nombre: string; doc: string; bancos: Set<string>; n: number; total: number; comision: number; primero: Date | null; ultimo: Date | null }>();
  for (const f of filasMov) {
    if (f.sentido !== 'Salida' || !f.ok) continue;
    const nombre = contraparteDe(f.t, false) || 'Sin nombre';
    const doc = documentoDe(f.t, false);
    const k = (doc || nombre).toUpperCase();
    const g = porBen.get(k) ?? { nombre, doc, bancos: new Set<string>(), n: 0, total: 0, comision: 0, primero: null, ultimo: null };
    g.n++; g.total += Math.abs(num(f.t.amount) ?? 0); g.comision += num(f.t.feeCop ?? f.t.fee) ?? 0;
    const b = bancoDe(f.t); if (b) g.bancos.add(b);
    if (f.d) { if (!g.primero || f.d < g.primero) g.primero = f.d; if (!g.ultimo || f.d > g.ultimo) g.ultimo = f.d; }
    porBen.set(k, g);
  }
  const bens = Array.from(porBen.values()).sort((a, b) => b.total - a.total);
  const nBen = bens.length, ba = 3, bb = Math.max(ba, nBen + 2);
  const rb = (col: number) => `${refCelda(col, ba - 1)}:${refCelda(col, bb - 1)}`;
  const hojaBen: CeldaX[][] = [
    [tt('Suma de lo que se ve →'), tt(''), tt(''), fx(`SUBTOTAL(9,${rb(3)})`, 'totalEntero'), fx(`SUBTOTAL(9,${rb(4)})`), fx(`SUBTOTAL(9,${rb(5)})`)],
    ['Beneficiario', 'Documento', 'Banco / método', 'Envíos completados', 'Total enviado', 'Comisiones', 'Primer envío', 'Último envío'],
    ...bens.map(g => [g.nombre, g.doc, Array.from(g.bancos).join(', '), g.n, cop(g.total), cop(g.comision), g.primero, g.ultimo] as CeldaX[]),
  ];

  // ── Resumen (fórmulas sobre Movimientos) ──
  const M = (col: number) => `Movimientos!${rango(col)}`;
  const COL = { fecha: 0, tipo: 1, dir: 2, estado: 4, cuenta: 5, moneda: 6, monto: 7, entrada: 8, salida: 9, comision: 10 };
  const soloCop = otrasMonedas ? `,${M(COL.moneda)},"COP"` : '';
  // SUMIFS exige al menos un criterio: sin otras monedas, una SUM simple.
  const sumaCop = (col: number) => otrasMonedas ? `SUMIFS(${M(col)},${M(COL.moneda)},"COP")` : `SUM(${M(col)})`;
  const hojaResumen: CeldaX[][] = [
    [{ v: 'Lincoin', marca: true }],
    [{ v: `Movimientos de ${nombreCliente}`, s: 'titulo' }],
    [{ v: `Generado el ${new Date().toLocaleString('es-CO', { hour12: false })}. Entradas y salidas cuentan solo lo completado${otrasMonedas ? ', en pesos' : ''}. Las cifras son fórmulas sobre la hoja Movimientos.`, s: 'nota' }],
    [],
    [{ v: 'TOTALES', s: 'seccion' }],
  ];
  const kpi = (et: string, f: string, s: 'kpiCop' | 'kpiEntero' = 'kpiCop') => hojaResumen.push([{ v: et, s: 'etiqueta' }, fx(f, s)]);
  kpi('Entradas completadas', sumaCop(COL.entrada));
  kpi('Salidas completadas', sumaCop(COL.salida));
  kpi('Comisiones de las salidas completadas', `SUMIFS(${M(COL.comision)},${M(COL.dir)},"Salida",${M(COL.estado)},"Completado"${soloCop})`);
  const fEnt = hojaResumen.length - 3, fSal = hojaResumen.length - 2, fCom = hojaResumen.length - 1;
  kpi('Neto (entradas − salidas − comisiones)', `${refCelda(1, fEnt)}-${refCelda(1, fSal)}-${refCelda(1, fCom)}`);
  kpi('Movimientos en total', `COUNTA(${M(18)})`, 'kpiEntero');
  kpi('Entradas (cantidad, todas)', `COUNTIFS(${M(COL.dir)},"Entrada")`, 'kpiEntero');
  kpi('Salidas (cantidad, todas)', `COUNTIFS(${M(COL.dir)},"Salida")`, 'kpiEntero');
  kpi('Rechazados, fallidos o devueltos', `COUNTIFS(${M(COL.estado)},"Rechazado")+COUNTIFS(${M(COL.estado)},"Fallido")+COUNTIFS(${M(COL.estado)},"Devuelto")`, 'kpiEntero');

  hojaResumen.push([], [{ v: 'POR CUENTA', s: 'seccion' }], ['Cuenta / riel', 'Entradas', 'Salidas', 'Comisiones', 'Movimientos']);
  const cuentas = Array.from(new Set(filasMov.map(f => cuentaRielDe(f.t)))).sort();
  for (const c of cuentas) {
    const r = hojaResumen.length;
    const ref = refCelda(0, r);
    hojaResumen.push([c,
      fx(`SUMIFS(${M(COL.entrada)},${M(COL.cuenta)},${ref})`, 'cop'), fx(`SUMIFS(${M(COL.salida)},${M(COL.cuenta)},${ref})`, 'cop'),
      fx(`SUMIFS(${M(COL.comision)},${M(COL.cuenta)},${ref},${M(COL.dir)},"Salida",${M(COL.estado)},"Completado")`, 'cop'), fx(`COUNTIFS(${M(COL.cuenta)},${ref})`, 'entero')]);
  }

  hojaResumen.push([], [{ v: 'POR MES', s: 'seccion' }], ['Mes', 'Entradas', 'Salidas', 'Comisiones', 'Movimientos']);
  const meses = Array.from(new Set(filasMov.filter(f => f.d).map(f => `${f.d!.getFullYear()}-${String(f.d!.getMonth() + 1).padStart(2, '0')}`))).sort().reverse();
  for (const m of meses) {
    const r = hojaResumen.length;
    const ref = refCelda(0, r);
    const rango_ = `${M(COL.fecha)},">="&${ref},${M(COL.fecha)},"<"&EDATE(${ref},1)`;
    hojaResumen.push([{ v: new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1), s: 'dia' },
      fx(`SUMIFS(${M(COL.entrada)},${rango_}${soloCop})`, 'cop'), fx(`SUMIFS(${M(COL.salida)},${rango_}${soloCop})`, 'cop'),
      fx(`SUMIFS(${M(COL.comision)},${rango_},${M(COL.dir)},"Salida",${M(COL.estado)},"Completado"${soloCop})`, 'cop'), fx(`COUNTIFS(${rango_})`, 'entero')]);
  }

  hojaResumen.push([], [{ v: 'POR ESTADO', s: 'seccion' }], ['Estado', 'Movimientos', 'Monto']);
  for (const e of Array.from(new Set(filasMov.map(f => txt(f.t.status)).filter(Boolean))).sort()) {
    const r = hojaResumen.length; const ref = refCelda(0, r);
    hojaResumen.push([e, fx(`COUNTIFS(${M(COL.estado)},${ref})`, 'entero'), fx(`SUMIFS(${M(COL.monto)},${M(COL.estado)},${ref}${soloCop})`, 'cop')]);
  }

  hojaResumen.push([], [{ v: 'CARGUES Y AJUSTES MANUALES', s: 'seccion' }]);
  const val = (et: string, v: number, s: 'kpiCop' | 'kpiEntero' = 'kpiCop') => hojaResumen.push([{ v: et, s: 'etiqueta' }, { v, s }]);
  val('Cargues y ajustes', nCar, 'kpiEntero');
  val('Acreditado por cargues vigentes', vigente);
  val('Corregido en cargues (débitos vinculados)', corregido);
  val('Cargues anulados (se cancelan con su reversa)', nAnulados, 'kpiEntero');
  val('Monto de los cargues anulados', anuladoCop);
  val('Descontado por ajustes que no revierten un cargue', descontadoSuelto);
  val('Neto de cargues', vigente - descontadoSuelto);

  // ── Consulta de sumatoria ──
  // Filtros en la columna B; vacío = no filtra. "Contiene" sin distinguir
  // mayúsculas (SEARCH). SUMPRODUCT en vez de SUMIFS: con SUMIFS un filtro
  // "*" deja por fuera las celdas vacías (un cargue sin beneficiario).
  const hojaConsulta: CeldaX[][] = [
    [{ v: 'Lincoin', marca: true }],
    [{ v: 'Consulta de sumatoria', s: 'titulo' }],
    [{ v: 'Escribí los filtros en la columna B y el resultado se calcula solo sobre la hoja Movimientos. Lo que dejes vacío no filtra. Los textos se buscan como "contiene" (sin importar mayúsculas).', s: 'nota' }],
    [],
    [{ v: 'FILTROS', s: 'seccion' }],
  ];
  const soloDia = (d: Date | null | undefined) => d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null;
  const filtros: [string, CeldaX][] = [
    ['Desde (fecha)', { v: soloDia(ordenados[ordenados.length - 1]?.d), s: 'dia' }],
    ['Hasta (fecha)', { v: soloDia(ordenados[0]?.d), s: 'dia' }],
    ['Dirección (Entrada / Salida)', ''],
    ['Estado', 'Completado'],
    ['Cuenta / riel', ''],
    ['Tipo', ''],
    ['Beneficiario o contraparte', ''],
    ['Documento', ''],
    ['Banco / método', ''],
    ['Motivo del envío', ''],
  ];
  const fila0 = hojaConsulta.length;
  for (const [et, v] of filtros) hojaConsulta.push([{ v: et, s: 'etiqueta' }, v]);
  const B = (i: number) => refCelda(1, fila0 + i).replace(/([A-Z]+)(\d+)/, '$$$1$$$2');
  // Filtro vacío = acepta todo, dicho explícito (no se confía en que
  // SEARCH("") dé 1 en todas las hojas de cálculo).
  const contiene = (i: number, col: number) => `((${B(i)}="")+ISNUMBER(SEARCH(${B(i)},${M(col)}))>0)`;
  const cond = [
    `(${M(COL.fecha)}>=IF(${B(0)}="",0,${B(0)}))`,
    `(${M(COL.fecha)}<IF(${B(1)}="",100000,${B(1)}+1))`,
    contiene(2, COL.dir), contiene(3, COL.estado), contiene(4, COL.cuenta), contiene(5, COL.tipo),
    contiene(6, 11), contiene(7, 12), contiene(8, 13), contiene(9, 15),
  ].join('*');
  hojaConsulta.push([], [{ v: 'RESULTADO', s: 'seccion' }]);
  const res0 = hojaConsulta.length;
  hojaConsulta.push([{ v: 'Movimientos que cumplen', s: 'etiqueta' }, fx(`SUMPRODUCT(${cond})`, 'kpiEntero')]);
  hojaConsulta.push([{ v: 'Suma de entradas (completadas)', s: 'etiqueta' }, fx(`SUMPRODUCT(${cond}*${M(COL.entrada)})`, 'kpiCop')]);
  hojaConsulta.push([{ v: 'Suma de salidas (completadas)', s: 'etiqueta' }, fx(`SUMPRODUCT(${cond}*${M(COL.salida)})`, 'kpiCop')]);
  hojaConsulta.push([{ v: 'Comisiones', s: 'etiqueta' }, fx(`SUMPRODUCT(${cond}*${M(COL.comision)})`, 'kpiCop')]);
  hojaConsulta.push([{ v: 'Neto (entradas − salidas − comisiones)', s: 'etiqueta' }, fx(`${refCelda(1, res0 + 1)}-${refCelda(1, res0 + 2)}-${refCelda(1, res0 + 3)}`, 'kpiCop')]);
  hojaConsulta.push([{ v: 'Suma de montos (cualquier estado)', s: 'etiqueta' }, fx(`SUMPRODUCT(${cond}*${M(COL.monto)})`, 'kpiCop')]);
  hojaConsulta.push([{ v: 'Promedio por movimiento', s: 'etiqueta' }, fx(`IF(${refCelda(1, res0)}=0,0,${refCelda(1, res0 + 5)}/${refCelda(1, res0)})`, 'kpiCop')]);
  hojaConsulta.push([], [{ v: 'Ejemplos: Estado = Rechazado para ver lo que no salió · Beneficiario = SANTIAGO para sumar lo enviado a esa persona · Cuenta / riel = Cuenta 2 para todo lo de ACH · borrá Estado para incluir todos los estados.', s: 'nota' }]);

  const slug = String(nombreCliente || 'cliente').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'cliente';
  const ultimaFila = (h: CeldaX[][], cols: number) => `A2:${refCelda(cols - 1, Math.max(1, h.length - 1))}`;
  descargarXlsx(`lincoin-movimientos-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`, [
    { nombre: 'Resumen', filas: hojaResumen, anchos: [46, 20, 20, 20, 14], cabecera: null, color: '22A35C' },
    { nombre: 'Consulta', filas: hojaConsulta, anchos: [42, 26], cabecera: null, color: '22A35C' },
    { nombre: 'Movimientos', filas: hojaMovs, cabecera: 1, fijar: 2, filtro: ultimaFila(hojaMovs, CAB_MOV.length), anchos: [18, 20, 12, 30, 12, 22, 8, 16, 16, 16, 12, 32, 16, 22, 22, 24, 30, 30, 38] },
    { nombre: 'Entradas', filas: ent.hoja, cabecera: 1, fijar: 2, filtro: ultimaFila(ent.hoja, ent.cab.length), anchos: [18, 20, 12, 22, 8, 16, 18, 12, 32, 16, 22, 30, 30, 38] },
    { nombre: 'Salidas', filas: sal.hoja, cabecera: 1, fijar: 2, filtro: ultimaFila(sal.hoja, sal.cab.length), anchos: [18, 20, 12, 22, 8, 16, 18, 12, 32, 16, 22, 22, 24, 30, 30, 38] },
    { nombre: 'Cargues', filas: hojaCargues, cabecera: 1, fijar: 2, filtro: ultimaFila(hojaCargues, 12), anchos: [18, 22, 26, 16, 16, 14, 12, 14, 14, 14, 40, 38] },
    { nombre: 'Por beneficiario', filas: hojaBen, cabecera: 1, fijar: 2, filtro: ultimaFila(hojaBen, 8), anchos: [36, 16, 26, 12, 18, 14, 18, 18] },
  ]);
}
