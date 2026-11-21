// El nombre de cada cuenta de envío para lo que ve el cliente: "Cuenta 3 ·
// Jero", "Cuenta 4 · Kaupaloki" (pedido del dueño, 2026-11). Misma lista
// que lib/nombreCuenta.ts (pantalla).
export const TITULAR_CUENTA: Record<number, string> = { 3: 'Jero', 4: 'Kaupaloki' }

export const nombreCuenta = (n: number | string | null | undefined): string => {
  const k = Number(n)
  return TITULAR_CUENTA[k] ? `Cuenta ${k} · ${TITULAR_CUENTA[k]}` : `Cuenta ${k}`
}
