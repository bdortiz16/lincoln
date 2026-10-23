// Excel con los movimientos de UN cliente, para el panel admin.
//
// Tres hojas:
//   · Movimientos — todo el historial de la cuenta (envíos, cargues,
//     conversiones, pagos…), lo más reciente primero.
//   · Cargues — solo los cargues y ajustes manuales, con su contabilidad
//     (USDT, tasas, utilidad) tal como los muestra la tabla de Cargues.
//   · Resumen — totales.
// Fechas y montos van como fecha y número reales, para que Excel sume y filtre.
import { descargarXlsx, type Celda } from '../lib/xlsx';

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
  if (c === 'COP_BREB') return 'COP · Bre-B';
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

export function descargarMovimientosCliente(nombreCliente: string, movimientos: any[]) {
  const ordenados = [...(movimientos ?? [])]
    .map(t => ({ t, d: fechaDe(t) }))
    .sort((a, b) => (b.d?.getTime() ?? 0) - (a.d?.getTime() ?? 0));

  const hojaMovs: Celda[][] = [[
    'Fecha', 'Tipo', 'Dirección', 'Descripción', 'Estado', 'Moneda / riel', 'Monto', 'Comisión',
    'Beneficiario / contraparte', 'Documento', 'Banco / método', 'Cuenta / llave', 'Motivo del envío',
    'Motivo del rechazo', 'Referencia del proveedor', 'Id',
  ]];
  for (const { t, d } of ordenados) {
    hojaMovs.push([
      d, TIPOS[txt(t.type)] ?? txt(t.type), direccionDe(t), txt(t.title), txt(t.status), monedaDe(t),
      num(t.amount), num(t.feeCop ?? t.fee),
      txt(t.beneficiary ?? t.recipient?.holderName ?? t.recipientName ?? t.counterparty),
      txt(t.documentNumber ?? t.recipient?.documentNumber),
      txt(t.bank), txt(t.account ?? t.recipient?.key ?? t.recipient?.accountNumber),
      txt(t.motivoTexto ?? t.reason), txt(t.providerError ?? t.errorMessage),
      txt(t.providerRef ?? t.reference ?? t.txHash), txt(t.id),
    ]);
  }

  const cargues = ordenados.filter(({ t }) => esCargueManual(t));
  const rev = reversosDe(movimientos ?? []);
  const fechaPorId = new Map<string, Date | null>(ordenados.map(({ t, d }) => [String(t.id), d]));
  // Lo acreditado que SIGUE vigente (cargue menos lo que se le revirtió), los
  // anulados aparte, y los descuentos que NO revierten un cargue. El neto es
  // el mismo de siempre, pero un cargue anulado y su reversa ya no aparecen
  // como un acreditado más un descuento adicional.
  let vigente = 0, descontadoSuelto = 0, corregido = 0, anuladoCop = 0, nAnulados = 0;
  const hojaCargues: Celda[][] = [[
    'Fecha', 'Riel', 'Movimiento', 'Neto COP', 'Bruto COP', 'Comisión COP',
    'USDT', 'Tasa de venta', 'Tasa al cliente', 'Utilidad COP', 'Nota', 'Id',
  ]];
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
      d, monedaDe({ ...t, currency: t.rail ?? t.currency }),
      movimiento,
      credito ? monto : -monto, num(t.grossCop), num(t.feeCop),
      num(a.usdtGross), num(a.sellRate), num(a.clientRate), num(a.utilityCop),
      txt(t.note), txt(t.id),
    ]);
  }

  const hojaResumen: Celda[][] = [
    ['Concepto', 'Valor'],
    ['Cliente', nombreCliente],
    ['Movimientos en total', ordenados.length],
    ['Cargues y ajustes manuales', cargues.length],
    ['Acreditado por cargues vigentes (COP)', vigente],
    ['Corregido en cargues (débitos vinculados, COP)', corregido],
    ['Cargues anulados (se cancelan con su reversa)', nAnulados],
    ['Monto de los cargues anulados (COP)', anuladoCop],
    ['Descontado por ajustes que no revierten un cargue (COP)', descontadoSuelto],
    ['Neto de cargues (COP)', vigente - descontadoSuelto],
    ['Generado', new Date()],
  ];

  const slug = String(nombreCliente || 'cliente').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'cliente';
  descargarXlsx(`lincoin-movimientos-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`, [
    { nombre: 'Movimientos', filas: hojaMovs, anchos: [18, 20, 11, 30, 12, 24, 16, 12, 32, 16, 22, 22, 24, 30, 30, 38] },
    { nombre: 'Cargues', filas: hojaCargues, anchos: [18, 22, 14, 16, 16, 14, 12, 14, 14, 14, 40, 38] },
    { nombre: 'Resumen', filas: hojaResumen, anchos: [32, 40] },
  ]);
}
