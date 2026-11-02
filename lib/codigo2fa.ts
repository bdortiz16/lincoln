// ════════════════════════════════════════════════════════
// Código 2FA por operación.
//
// Algunas acciones del panel (quitar una llave de Lincoin, cambiar el
// equipo, la lista de IPs, las cuentas de Coinsenda, la caja, borrar
// cuentas…) exigen en el SERVIDOR el código de la app en cada operación,
// no solo el 2FA con el que se entró (ACCIONES_CON_CODIGO en admin-data).
// Cuando falta o está mal, el servidor responde `pideCodigo: true`.
//
// Esto lo maneja en un solo lugar: se hace la llamada; si el servidor pide
// el código, se le pide a la persona (la ventana PromptCodigo2fa, montada en
// el panel) y se repite la MISMA llamada con `otp`. Así ninguna pantalla
// tiene que saber qué acciones lo piden: si el servidor agrega una, el panel
// ya sabe preguntar.
// ════════════════════════════════════════════════════════

type Prompt = (motivo: string | null) => Promise<string | null>;
let prompt: Prompt | null = null;

// La ventana del panel se registra al montarse (y se quita al desmontarse).
export function registrarPromptCodigo(p: Prompt | null) { prompt = p; }

export async function pedirCodigo2fa(motivo: string | null): Promise<string | null> {
  if (prompt) return prompt(motivo);
  // Sin la ventana montada (otra pantalla): el diálogo del navegador. Feo,
  // pero mejor que una operación que falla sin decir por qué.
  const v = typeof window !== 'undefined'
    ? window.prompt(`${motivo ? motivo + '\n\n' : ''}Escribe el código de 6 dígitos de tu app de verificación:`)
    : null;
  const c = (v ?? '').replace(/\D/g, '').slice(0, 6);
  return c.length === 6 ? c : null;
}

// Hace la llamada y, si el servidor pide el código, lo pide y la repite.
// `llamar` recibe el código (o nada en el primer intento) y devuelve la
// respuesta ya leída como objeto. Tras 5 intentos fallidos se rinde: el
// servidor igual limita, esto solo evita un bucle en la pantalla.
export async function conCodigo2fa<T = any>(llamar: (otp?: string) => Promise<T>): Promise<T> {
  let r: any = await llamar();
  let intentos = 0;
  while (r && typeof r === 'object' && r.pideCodigo && intentos < 5) {
    // La primera vez el servidor solo dice "falta tu código": no vale la pena
    // mostrarlo. En los reintentos sí ("código incorrecto", "ya se usó").
    const codigo = await pedirCodigo2fa(intentos === 0 ? null : String(r.error ?? ''));
    if (!codigo) return { ...r, ok: false, cancelado: true, error: 'Operación cancelada: necesita tu código 2FA.' };
    r = await llamar(codigo);
    intentos++;
  }
  return r;
}
