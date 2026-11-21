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

// Panel: el nombre de la bolsa para mostrar.
export const NOMBRE_BOLSA: Record<string, string> = { Coinsenda: 'Coinsenda Jero', 'Coinsenda 2': 'Coinsenda Kaupaloki' };
export const nombreBolsa = (p: string): string => NOMBRE_BOLSA[p] ?? p;
