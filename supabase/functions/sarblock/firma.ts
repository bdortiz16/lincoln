// ════════════════════════════════════════════════════════
// Verificación de los callbacks de Sarblock.
//
//   firma    = HMAC_SHA256(secreto, timestamp + "." + cuerpoCrudo)
//   cabecera = x-sarblock-signature: "v1=" + firma en hex
//
// El timestamp va DENTRO de lo firmado: sin eso, capturar una entrega
// bastaría para repetirla con la firma intacta. Y quien decide si es
// demasiado vieja somos nosotros (tolerancia de 5 minutos).
//
// Se firma el cuerpo CRUDO, los bytes que llegaron: parsear el JSON y volver
// a serializarlo da otra firma.
//
// Durante una rotación el secreto anterior sigue firmando 24 h, así que se
// aceptan los dos.
// ════════════════════════════════════════════════════════

export const TOLERANCIA_SEGUNDOS = 300;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

export async function firmar(secreto: string, timestamp: string, cuerpoCrudo: string): Promise<string> {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(`${timestamp}.${cuerpoCrudo}`));
  return `v1=${hex(mac)}`;
}

// Comparación en tiempo constante: con === se filtra el prefijo correcto
// byte a byte.
function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function verificarCallback(
  cuerpoCrudo: string,
  firma: string | null,
  timestamp: string | null,
  secretos: string[],
  ahora = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!firma || !timestamp || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(ahora - Number(timestamp)) > TOLERANCIA_SEGUNDOS) return false;
  for (const s of secretos.filter(Boolean)) {
    if (igual(await firmar(s, timestamp, cuerpoCrudo), firma)) return true;
  }
  return false;
}
