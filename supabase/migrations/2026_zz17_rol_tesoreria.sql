-- ════════════════════════════════════════════════════════
--  Rol 'tesoreria' — Tesorería y clientes, nada más.
--
--  POR QUE UN ROL NUEVO
--    Se le delega a una persona la operación de Tesorería (aprobar cargues y
--    retiros, traslados a ACH, cargues manuales en las billeteras) y la
--    atención de Clientes. 'operaciones' no sirve: además abre OTC, tasas,
--    contabilidad y facturación. Este rol no ve Cumplimiento, Seguridad,
--    Equipo ni Configuración.
--
--  Solo cambia la lista de roles admitidos. Los permisos de cada rol viven en
--  el servidor (admin-data, PERMISOS_POR_ROL).
-- ════════════════════════════════════════════════════════

ALTER TABLE public.admin_miembros DROP CONSTRAINT IF EXISTS admin_miembros_rol_check;
ALTER TABLE public.admin_miembros ADD CONSTRAINT admin_miembros_rol_check
  CHECK (rol IN ('dueno', 'operaciones', 'cumplimiento', 'lectura', 'tesoreria'));
