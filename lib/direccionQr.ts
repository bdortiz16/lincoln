// Saca la dirección de una wallet del texto de un QR (23 nov: escanear la
// wallet en la Mesa OTC en vez de copiarla a mano).
//
// Un QR de wallet no siempre es la dirección sola. Las apps lo arman como URI:
//   "TQn9Y2…"                                    → la dirección tal cual
//   "tron:TQn9Y2…?amount=10"                     → con esquema y monto
//   "ethereum:0xAbc…@56"                         → EVM con la red (56 = BNB Chain)
//   "ethereum:0xdAC17F…@1/transfer?address=0xDe…" → ERC-681 de un token: la
//      primera dirección es el CONTRATO del token (USDT) y la wallet es la de
//      `address=`. Tomar la primera mandaría a revisar el contrato de Tether.
// Lo que no se reconoce no se adivina: se devuelve null y la pantalla lo dice.
export type RedQr = 'TRX' | 'ETH' | 'BNB';

const TRON = /T[1-9A-HJ-NP-Za-km-z]{33}/;
const EVM = /0x[0-9a-fA-F]{40}/;

export function direccionDeQr(texto: string): { direccion: string; red: RedQr | null } | null {
  const t = String(texto ?? '').trim();
  if (!t) return null;

  // ERC-681 de transferencia de token: la wallet va en `address=`.
  const param = t.match(/[?&]address=(0x[0-9a-fA-F]{40})\b/);
  const cadena = t.match(/@(\d+)/);
  // La red EVM solo si el QR la dice (cadena 56 = BNB Chain, 1 = Ethereum, o
  // un esquema bnb/bsc). Un 0x pelado sirve en las dos: decide el cliente.
  const redEvm = (): RedQr | null => (cadena && cadena[1] === '56' ? 'BNB' : cadena && cadena[1] === '1' ? 'ETH' : /^(bnb|bsc|binance)/i.test(t) ? 'BNB' : null);
  if (param) return { direccion: param[1], red: redEvm() };

  const tron = t.match(TRON);
  const evm = t.match(EVM);
  // Si trae las dos, manda la que va primero (la del esquema).
  if (tron && (!evm || (tron.index ?? 0) < (evm.index ?? 0))) {
    // Una dirección TRON tiene exactamente 34 caracteres: si a continuación
    // viene otro carácter base58, no era una dirección sino un texto más largo.
    const despues = t.charAt((tron.index ?? 0) + 34);
    if (despues && /[1-9A-HJ-NP-Za-km-z]/.test(despues)) return null;
    return { direccion: tron[0], red: 'TRX' };
  }
  if (evm) {
    const despues = t.charAt((evm.index ?? 0) + 42);
    if (despues && /[0-9a-fA-F]/.test(despues)) return null;
    return { direccion: evm[0], red: redEvm() };
  }
  return null;
}
