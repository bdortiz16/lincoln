// A qué puerta del panel se manda una cuenta 'admin' que entró por la app de
// clientes. El dueño y el equipo comparten el rol 'admin' en `users`; lo que
// los distingue es la marca `colaborador` que pone la invitación
// (equipo_invitar / equipo_reenviar en admin-data). Antes todo admin iba a
// /admin-empresas y la colaboradora caía en el ingreso "Admin Empresas" en vez
// del suyo (visto el 2026-11-05).
//
// Es solo la puerta: los permisos los decide el servidor (`mi_acceso`), y el
// panel corrige la dirección si el rol real no coincide con la marca.
export const RUTA_COLABORADORES = '/colaboradores';
export const RUTA_ADMIN = '/admin-empresas';

export const esCuentaColaborador = (perfil: any): boolean =>
  !!(perfil?.colaborador || perfil?.raw_data?.colaborador);

export const rutaDelPanel = (perfil: any): string =>
  esCuentaColaborador(perfil) ? RUTA_COLABORADORES : RUTA_ADMIN;
