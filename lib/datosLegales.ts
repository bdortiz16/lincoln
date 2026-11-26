// ════════════════════════════════════════════════════════
// Datos y rutas de los documentos legales públicos de Lincoin.
//
// La VERSIÓN se guarda con la aceptación de cada empresa al registrarse
// (raw_data.aceptacionLegal y los metadatos de la cuenta de acceso): ante un
// reclamo hay que poder mostrar QUÉ texto aceptó y CUÁNDO. Si se cambia el
// contenido de los términos, la privacidad o el SARLAFT, se sube la versión.
//
// Los datos de identificación de la sociedad (razón social, NIT, domicilio,
// teléfono) los exige la Ley 1581 en la política de datos y dan certeza en
// los términos. Mientras estén en null no se muestran: no se publica un dato
// inventado.
// ════════════════════════════════════════════════════════

export const VERSION_LEGAL = '2026-11-05';
export const FECHA_LEGAL = '5 de noviembre de 2026';

export const DATOS_LINCOIN: {
  marca: string;
  razonSocial: string | null;
  nit: string | null;
  domicilio: string | null;
  telefono: string | null;
  correo: string;
  sitio: string;
} = {
  marca: 'Lincoin',
  razonSocial: null,
  nit: null,
  domicilio: null,
  telefono: null,
  correo: 'soporte@lincoin.me',
  sitio: 'lincoin.me',
};

// "Lincoin" o "Lincoin, marca de X S.A.S., NIT …, con domicilio en …".
export function identificacionLincoin(): string {
  const d = DATOS_LINCOIN;
  const partes = [d.marca];
  if (d.razonSocial) partes.push(`marca de ${d.razonSocial}`);
  if (d.nit) partes.push(`NIT ${d.nit}`);
  if (d.domicilio) partes.push(`con domicilio en ${d.domicilio}`);
  return partes.join(', ');
}

// Dirección fija de cada página: se puede enlazar desde correos, contratos y
// el registro, y se abre directo al recargar.
export const RUTAS_LEGALES: Record<string, string> = {
  '/terminos': 'terms',
  '/privacidad': 'privacy',
  '/sarlaft': 'sagrilaft',
  '/reclamaciones': 'complaints',
  '/seguridad': 'security',
  '/estado': 'status',
  '/ayuda': 'support',
  '/marco-legal': 'licenses',
  '/nosotros': 'about',
};

export const rutaDePagina = (pageKey: string): string | null => {
  const alias: Record<string, string> = { sarlaft: 'sagrilaft', contact: 'support', reserves: 'licenses' };
  const k = alias[pageKey] ?? pageKey;
  const hallada = Object.entries(RUTAS_LEGALES).find(([, v]) => v === k);
  return hallada ? hallada[0] : null;
};

export const paginaDeRuta = (path: string): string | null => {
  const limpio = path.replace(/\/+$/, '') || '/';
  return RUTAS_LEGALES[limpio] ?? null;
};
