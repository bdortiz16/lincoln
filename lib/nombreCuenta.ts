// ── El nombre de cada cuenta de envío ────────────────────────────────────
// Las cuentas 3 y 4 son dos cuentas COP distintas (cada una de una empresa
// titular). Pedido del dueño (2026-11): que se vean con el nombre del
// titular — "Cuenta 3 · Jero", "Cuenta 4 · Kaupaloki" — para que la empresa
// sepa desde cuál sale el pago (es el nombre que el beneficiario ve como
// ordenante). Se conserva el número que ya conocían.
//
// En el panel, las bolsas se llaman por la cuenta del aliado: "Coinsenda
// Jero" y "Coinsenda Kaupaloki". Solo cambia lo que se MUESTRA: los
// identificadores guardados ('Coinsenda', 'Coinsenda 2', COP_C3, COP_C4)
// siguen iguales.
//
// Misma lista en supabase/functions/_shared/nombre-cuenta.ts (servidor).
export const TITULAR_CUENTA: Record<number, string> = { 3: 'Jero', 4: 'Kaupaloki' };

export const nombreCuenta = (n: number | string | null | undefined): string => {
  const k = Number(n);
  return TITULAR_CUENTA[k] ? `Cuenta ${k} · ${TITULAR_CUENTA[k]}` : `Cuenta ${k}`;
};

// ¿Un envío salió por llave Bre-B o a una cuenta (ACH)? Manda el riel
// guardado en la fila. La moneda ya no alcanza: desde el 22 nov ACH · Cuenta
// 1 paga con el saldo Bre-B (COP_BREB), y Bre-B · Cuenta 2 con el ACH. La
// moneda queda solo para filas sin riel (cargues, movimientos viejos).
export const esBrebTx = (tx: any): boolean => {
  const rd = (tx?.raw_data ?? {}) as Record<string, any>;
  const rail = String(tx?.rail ?? rd.rail ?? '').toUpperCase();
  if (rail === 'BREB') return true;
  if (rail === 'ACH') return false;
  return String(tx?.currency ?? '') === 'COP_BREB';
};

// La cuenta ACH de un envío. Desde el 22 nov la fila la guarda (cuentaAch).
// Sin ella, el envío es de antes y salió por la que hoy se llama Cuenta 2
// (hasta ese día era "Cuenta 1"; la Cuenta 1 nueva no existía).
export const cuentaAchDe = (tx: any): number => {
  const rd = (tx?.raw_data ?? {}) as Record<string, any>;
  const n = Number(tx?.cuentaAch ?? rd.cuentaAch);
  return n >= 1 && n <= 4 ? n : 2;
};

// La cuenta de Lincoin de un movimiento, como la conoce la empresa (23 nov,
// el dueño en Contabilidad: "falta por qué cuenta salió el pago"). Un envío
// lleva el riel y la cuenta que se eligió al enviar ("Bre-B · Cuenta 2",
// "ACH · Cuenta 4 · Kaupaloki"). Lo demás (cargues, recaudos, ajustes) dice
// el saldo donde entró o de donde salió, por su moneda ("Cuenta 1 · Bre-B").
// Los nombres de los saldos son los del servidor (CUENTAS_FACTURABLES en la
// función facturacion), que también decide con la moneda qué empresa factura.
export const SALDO_CUENTA: Record<string, string> = {
  COP_BREB: 'Cuenta 1 · Bre-B', COP_ACH: 'Cuenta 2 · ACH', COP_C3: nombreCuenta(3), COP_C4: nombreCuenta(4), COP: 'Saldo Lincoin',
};
export const cuentaDeMovimiento = (tx: any): string | null => {
  const rd = (tx?.raw_data ?? {}) as Record<string, any>;
  const rail = String(tx?.rail ?? rd.rail ?? '').toUpperCase();
  const nB = Number(tx?.cuentaBreb ?? rd.cuentaBreb);
  const nA = Number(tx?.cuentaAch ?? rd.cuentaAch);
  const valida = (n: number) => n >= 1 && n <= 4;
  if (rail === 'BREB' || valida(nB)) return `Bre-B · ${nombreCuenta(valida(nB) ? nB : 1)}`;
  if (rail === 'ACH' || valida(nA)) return `ACH · ${nombreCuenta(cuentaAchDe(tx))}`;
  return SALDO_CUENTA[String(tx?.currency ?? '').toUpperCase()] ?? null;
};

// Panel: el nombre de la bolsa para mostrar.
export const NOMBRE_BOLSA: Record<string, string> = { Coinsenda: 'Coinsenda Jero', 'Coinsenda 2': 'Coinsenda Kaupaloki' };
export const nombreBolsa = (p: string): string => NOMBRE_BOLSA[p] ?? p;
