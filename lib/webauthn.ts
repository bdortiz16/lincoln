// ─────────────────────────────────────────────────────────────
// Passkey (WebAuthn) — el lado del navegador.
//
// La llave se crea y se guarda DENTRO del dispositivo: el chip del teléfono,
// el llavero del sistema, o una llave USB. Nunca sale de ahí. Lo único que
// viaja es una firma, y esa firma está atada al dominio: una copia de
// lincoin.me montada por un atacante no consigue que el dispositivo firme.
// Por eso un passkey no se puede fotografiar, ni leer del portapapeles, ni
// sacar con una pantalla falsa — que es justo como se pierden una contraseña,
// un código de 6 dígitos y unos códigos de respaldo.
//
// Aquí no hay criptografía propia: solo la traducción entre el JSON que manda
// el servidor (base64url) y los ArrayBuffer que exige la API del navegador.
// Se hace a mano para no arrastrar otra dependencia al bundle.
// ─────────────────────────────────────────────────────────────

export const soportaPasskey = (): boolean =>
  typeof window !== 'undefined' &&
  !!window.PublicKeyCredential &&
  !!navigator.credentials?.create;

/** ¿El dispositivo tiene un autenticador propio (Face ID, huella, Windows Hello)? */
export const tienePasskeyDelDispositivo = async (): Promise<boolean> => {
  try {
    if (!soportaPasskey()) return false;
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
};

const b64uABuf = (s: string): ArrayBuffer => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

const bufAB64u = (b: ArrayBuffer | null | undefined): string => {
  if (!b) return '';
  const bytes = new Uint8Array(b);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Crea la llave en este dispositivo. Devuelve lo que el servidor tiene que verificar. */
export const crearPasskey = async (options: any): Promise<any> => {
  const pub: any = {
    ...options,
    challenge: b64uABuf(options.challenge),
    user: { ...options.user, id: b64uABuf(options.user.id) },
    excludeCredentials: (options.excludeCredentials ?? []).map((c: any) => ({ ...c, id: b64uABuf(c.id) })),
  };
  const cred = await navigator.credentials.create({ publicKey: pub }) as any;
  if (!cred) throw new Error('El dispositivo no devolvió ninguna llave.');
  return {
    id: cred.id,
    rawId: bufAB64u(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufAB64u(cred.response.clientDataJSON),
      attestationObject: bufAB64u(cred.response.attestationObject),
      transports: cred.response.getTransports?.() ?? [],
    },
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
  };
};

/** Pide al dispositivo que firme el desafío. Es el "entrar con la llave". */
export const firmarConPasskey = async (options: any): Promise<any> => {
  const pub: any = {
    ...options,
    challenge: b64uABuf(options.challenge),
    allowCredentials: (options.allowCredentials ?? []).map((c: any) => ({ ...c, id: b64uABuf(c.id) })),
  };
  const cred = await navigator.credentials.get({ publicKey: pub }) as any;
  if (!cred) throw new Error('El dispositivo no firmó.');
  return {
    id: cred.id,
    rawId: bufAB64u(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufAB64u(cred.response.clientDataJSON),
      authenticatorData: bufAB64u(cred.response.authenticatorData),
      signature: bufAB64u(cred.response.signature),
      userHandle: cred.response.userHandle ? bufAB64u(cred.response.userHandle) : undefined,
    },
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
  };
};

/** Traduce los errores del navegador a algo que se pueda leer sin ser experto. */
export const explicarErrorPasskey = (e: any): string => {
  const n = String(e?.name ?? '');
  if (n === 'NotAllowedError') return 'Se canceló o se agotó el tiempo. Vuelve a intentarlo.';
  if (n === 'InvalidStateError') return 'Este dispositivo ya tiene una llave registrada en esta cuenta.';
  if (n === 'SecurityError') return 'El navegador no aceptó el dominio. Entra por lincoin.me, no por una dirección de vista previa.';
  if (n === 'NotSupportedError') return 'Este dispositivo no puede crear llaves de este tipo.';
  if (n === 'AbortError') return 'La operación se canceló.';
  return e?.message ? String(e.message) : 'No se pudo completar la operación con la llave.';
};
