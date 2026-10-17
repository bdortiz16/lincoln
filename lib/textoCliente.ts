// Lo que el CLIENTE (o su contador) puede leer en un comprobante.
//
// Vive en un solo lugar porque cada pantalla tenía su propio filtro y cada una
// dejaba pasar algo distinto: "Bad request to Kamin API" llegó a la pantalla
// de un cliente, y una empresa salía como "CC 890932739".

// ¿Este texto sirve como motivo de un fallo? Solo si es un motivo que el
// cliente entiende ("NUMERO CUENTA NO EXISTE"): ni jerga técnica, ni inglés,
// ni nombres de aliados, ni el saldo de nuestra cuenta con el proveedor.
// Mismo criterio que el servidor (motivoParaCliente en mouv-proxy).
export const motivoLegibleCliente = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t || t.length < 3 || t.length > 240) return null;
  if (/[{}[\]<>]|https?:|http\s*\d|status\s*code|\b(api|request|bad|internal|server|gateway|timeout|exception|null|undefined|token|unauthori[sz]ed|forbidden|payload|json|paso)\b/i.test(t)) return null;
  if (/\b(kamin|finity|mouv|gowd|kumplo|tusdatos|sumsub|fireblocks|tatum|gasfree|saldo|fondos)\b/i.test(t)) return null;
  if (/\b(the|to|of|is|was|not|could|cannot|unable|failed|invalid|please|your|with|from)\b/i.test(t)) return null;
  if (!/\b(de|del|la|el|los|las|no|en|por|para|con|sin|al|es|se|y|cuenta|banco|titular|documento|llave|existe|corresponde[n]?|v[aá]lid[ao]|inv[aá]lid[ao]|rechazad[ao]|bloquead[ao])\b/i.test(t)) return null;
  return t;
};

// El tipo de documento que se muestra. Una empresa tiene NIT, no cédula: las
// llaves Bre-B devuelven el número sin el tipo y se asumía CC. Si el titular
// es una razón social, o el número tiene la forma de un NIT (9 dígitos que
// empiezan por 8 o 9) y nadie dijo el tipo, es NIT.
export const tipoDocumentoMostrado = (tipo: unknown, numero: unknown, titular: unknown): string => {
  const nombre = String(titular ?? '').trim();
  const esRazonSocial = /\b(S\.?\s?A\.?\s?S\.?|S\.?\s?A\.?|LTDA\.?|S\.?\s?EN\s?C\.?|E\.?\s?U\.?|CIA\.?|CORP\.?|INC\.?|FUNDACI[OÓ]N|COOPERATIVA|ASOCIACI[OÓ]N|CORPORACI[OÓ]N)$|\b(SAS|LTDA|SOCIEDAD|COMPA[ÑN][IÍ]A|EMPRESA|INVERSIONES|GRUPO)\b/i.test(nombre);
  if (esRazonSocial) return 'NIT';
  const t = String(tipo ?? '').trim();
  if (t) return t;
  return /^[89]\d{8}$/.test(String(numero ?? '').replace(/\D/g, '')) ? 'NIT' : 'CC';
};
