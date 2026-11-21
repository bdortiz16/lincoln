// ════════════════════════════════════════════════════════
// Celdas de CSV a salvo de fórmulas.
//
// Excel y Google Sheets ejecutan como FÓRMULA cualquier celda que empiece por
// =, +, - o @ (también por tabulador o retorno de carro). Los CSV que se
// exportan llevan texto escrito por clientes: el nombre de un beneficiario,
// una referencia, un motivo. Un beneficiario llamado
// =HYPERLINK("http://…";"Ver soporte") salía como un enlace en el reporte de
// cumplimiento que abre el oficial, y otras fórmulas pueden leer celdas de la
// hoja o pedir datos afuera. Se antepone un apóstrofo: la hoja lo muestra como
// texto y no lo ejecuta.
//
// Los NÚMEROS no se tocan —tampoco los negativos ("-2500")—, para que la hoja
// los siga sumando.
// ════════════════════════════════════════════════════════

export function sinFormula(v: unknown): string {
  const s = String(v ?? '');
  if (typeof v === 'number') return s;
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(?:[.,]\d+)*$/.test(s)) return `'${s}`;
  return s;
}

// Celda entre comillas (las comillas internas, dobladas), a salvo de fórmulas.
export const celdaCsv = (v: unknown): string => `"${sinFormula(v).replace(/"/g, '""')}"`;
