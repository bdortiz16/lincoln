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
// el panel y en la app) y se repite la MISMA llamada con `otp`. Así ninguna
// pantalla tiene que saber qué acciones lo piden: si el servidor agrega una,
// ya sabe preguntar.
//
// La misma ventana pide también el código que llega al CORREO (tipo
// 'correo'): activar el 2FA por primera vez lo exige (`pideCodigoCorreo`).
// ════════════════════════════════════════════════════════

export type TipoCodigo = 'app' | 'correo';
type Prompt = (motivo: string | null, tipo: TipoCodigo) => Promise<string | null>;
// Una pila: la ventana montada más reciente es la que pregunta. Al
// desmontarse cada una quita SOLO la suya, así la que se va no deja sin
// ventana a la que se queda (p. ej. la de la entrada del panel y la del
// panel mismo).
const prompts: Prompt[] = [];

export function registrarPromptCodigo(p: Prompt) { prompts.push(p); }
export function quitarPromptCodigo(p: Prompt) { const i = prompts.lastIndexOf(p); if (i >= 0) prompts.splice(i, 1); }

export async function pedirCodigo2fa(motivo: string | null, tipo: TipoCodigo = 'app'): Promise<string | null> {
  const prompt = prompts[prompts.length - 1];
  if (prompt) return prompt(motivo, tipo);
  // Sin la ventana montada (otra pantalla): el diálogo del navegador. Feo,
  // pero mejor que una operación que falla sin decir por qué.
  const pregunta = tipo === 'correo'
    ? 'Escribe el código de 6 dígitos que te enviamos al correo:'
    : 'Escribe el código de 6 dígitos de tu app de verificación:';
  const v = typeof window !== 'undefined'
    ? window.prompt(`${motivo ? motivo + '\n\n' : ''}${pregunta}`)
    : null;
  const c = (v ?? '').replace(/\D/g, '').slice(0, 6);
  return c.length === 6 ? c : null;
}

// Hace la llamada y, si el servidor pide el código, lo pide y la repite.
// `llamar` recibe el código (o nada en el primer intento) y devuelve la
// respuesta ya leída como objeto. Tras 5 intentos fallidos se rinde: el
// servidor igual limita, esto solo evita un bucle en la pantalla.
export async function conCodigo2fa<T = any>(llamar: (otp?: string) => Promise<T>): Promise<T> {
  return conCodigoDe('pideCodigo', 'app', llamar);
}

// Igual, con el código que llega al correo (`pideCodigoCorreo`).
export async function conCodigoCorreo<T = any>(llamar: (codigo?: string) => Promise<T>): Promise<T> {
  return conCodigoDe('pideCodigoCorreo', 'correo', llamar);
}

async function conCodigoDe<T>(marca: string, tipo: TipoCodigo, llamar: (codigo?: string) => Promise<T>): Promise<T> {
  let r: any = await llamar();
  let intentos = 0;
  while (r && typeof r === 'object' && r[marca] && intentos < 5) {
    // La primera vez el servidor solo dice "falta tu código": no vale la pena
    // mostrarlo, salvo que avise algo (p. ej. que el correo no salió). En los
    // reintentos sí ("código incorrecto", "ya se usó").
    const aviso = intentos === 0 && r.enviado !== false ? null : String(r.error ?? '') || null;
    const codigo = await pedirCodigo2fa(aviso, tipo);
    if (!codigo) {
      return { ...r, ok: false, success: false, cancelado: true,
        error: tipo === 'correo' ? 'Operación cancelada: necesita el código que te enviamos al correo.' : 'Operación cancelada: necesita tu código 2FA.' };
    }
    r = await llamar(codigo);
    intentos++;
  }
  return r;
}
