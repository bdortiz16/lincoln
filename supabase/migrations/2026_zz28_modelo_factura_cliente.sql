-- ════════════════════════════════════════════════════════
--  Modelo de facturación de Lincoin por cliente.
--
--  Dos modelos:
--    · colombia → una factura por cliente y por DÍA (día vencido), con todo
--                 lo que movió ese día. La emite sola facturacion.
--    · exterior → una factura por MOVIMIENTO (empresas de Perú, Brasil…,
--                 que no facturan en Colombia).
--  Por defecto sale del país con que se registró la empresa (Colombia →
--  colombia; otro país → exterior). Esta tabla guarda solo el ajuste a mano
--  desde la ficha del cliente, cuando el país no basta.
--
--  Fuera del alcance del navegador (RLS sin políticas): la escribe y la lee
--  admin-data con la llave de servicio, con los permisos de Contabilidad.
--  Un cliente no puede cambiarse de modelo.
--
--  Idempotente.
-- ════════════════════════════════════════════════════════

create table if not exists public.lincoin_modelo_cliente (
  user_id text primary key,
  modelo text not null check (modelo in ('colombia', 'exterior')),
  por text,
  updated_at timestamptz not null default now()
);

alter table public.lincoin_modelo_cliente enable row level security;
revoke all on public.lincoin_modelo_cliente from anon, authenticated;

create index if not exists facturas_lincoin_tipo_idx on public.facturas_lincoin (tipo, operacion_at desc);

notify pgrst, 'reload schema';
