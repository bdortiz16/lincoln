create table if not exists public.facturacion_lincoin (
  id smallint primary key default 1 check (id = 1),
  username text,
  access_key_enc text,
  partner_id text,
  activo boolean not null default false,
  desde timestamptz,
  operaciones text[] not null default array['cargue', 'conversion'],
  document_id bigint,
  seller_id bigint,
  payment_id bigint,
  item_terceros text,
  item_comision text,
  iva_tax_id bigint,
  desc_terceros text,
  desc_comision text,
  observaciones text,
  stamp boolean not null default true,
  mail boolean not null default true,
  catalogos jsonb,
  ultimo_test_at timestamptz,
  ultimo_test_ok boolean,
  ultimo_error text,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.facturacion_lincoin enable row level security;
revoke all on public.facturacion_lincoin from anon, authenticated;

create table if not exists public.facturas_lincoin (
  id bigserial primary key,
  transaction_id text not null unique,
  user_id text,
  tipo text not null,
  operacion_at timestamptz,
  moneda text not null default 'COP',
  total numeric,
  terceros numeric,
  utilidad numeric,
  base numeric,
  iva numeric,
  utilidad_fuente text,
  estado text not null default 'pendiente',
  numero text,
  siigo_id text,
  cufe text,
  url text,
  error text,
  detalle jsonb,
  intentos integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  emitida_at timestamptz
);

create index if not exists facturas_lincoin_user_idx on public.facturas_lincoin (user_id, created_at desc);
create index if not exists facturas_lincoin_estado_idx on public.facturas_lincoin (estado, updated_at);

alter table public.facturas_lincoin enable row level security;
revoke all on public.facturas_lincoin from anon, authenticated;

notify pgrst, 'reload schema';
