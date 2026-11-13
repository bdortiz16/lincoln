// ════════════════════════════════════════════════════════
// Bandera del país de una empresa, para reconocer de un vistazo a los
// clientes del exterior en las listas del panel (Billetera, Clientes).
//
// El país se toma en el mismo orden que el servidor usa para el modelo de
// facturación (_shared/modelo-factura.ts): el de la empresa y, si no hay, el
// del registro. Colombia y "sin país" no llevan bandera: la marca es para lo
// que NO es de aquí.
//
// Es un emoji de bandera (dos letras regionales), sin imágenes externas. En
// Windows algunos navegadores lo pintan como las dos letras ("BR"), que igual
// dice el país.
// ════════════════════════════════════════════════════════

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

const CODIGO_POR_NOMBRE: Record<string, string> = {
  colombia: 'CO', 'republica de colombia': 'CO',
  peru: 'PE', brasil: 'BR', brazil: 'BR', chile: 'CL', ecuador: 'EC',
  mexico: 'MX', panama: 'PA', argentina: 'AR', venezuela: 'VE', bolivia: 'BO',
  paraguay: 'PY', uruguay: 'UY', 'costa rica': 'CR', guatemala: 'GT',
  honduras: 'HN', 'el salvador': 'SV', nicaragua: 'NI',
  'republica dominicana': 'DO', 'puerto rico': 'PR', cuba: 'CU',
  'estados unidos': 'US', eeuu: 'US', 'ee.uu.': 'US', usa: 'US', 'united states': 'US',
  canada: 'CA', espana: 'ES', spain: 'ES', portugal: 'PT', francia: 'FR',
  alemania: 'DE', italia: 'IT', 'reino unido': 'GB', china: 'CN',
};

// Código ISO de dos letras del país, o null si no se reconoce.
export function codigoPais(pais: unknown): string | null {
  const s = sinTildes(String(pais ?? '')).trim().toLowerCase();
  if (!s) return null;
  if (/^[a-z]{2}$/.test(s)) return s.toUpperCase();
  return CODIGO_POR_NOMBRE[s] ?? null;
}

// País de un cliente tal como lo guarda el registro.
export function paisDeCliente(u: any): string | null {
  const c = [u?.companyCountry, u?.raw_data?.companyCountry, u?.company_country, u?.country, u?.raw_data?.country]
    .map(x => String(x ?? '').trim()).find(Boolean);
  return c || null;
}

// Emoji de la bandera de un país del exterior; null para Colombia, para un
// cliente sin país o para un país que no se reconoce.
export function banderaExterior(pais: unknown): string | null {
  const cod = codigoPais(pais);
  if (!cod || cod === 'CO') return null;
  return String.fromCodePoint(...[...cod].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}
