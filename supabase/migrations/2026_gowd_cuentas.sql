create table if not exists public.gowd_cuentas (
  id               bigserial primary key,
  idempotencia     text not null unique,
  solicitud_id     text unique,
  account_id       text unique,
  holder_type      text not null check (holder_type in ('INDIVIDUAL', 'ORGANIZATION')),
  titular          text not null,
  documento        text,
  alias            text,
  email            text,
  telefono         text,
  estado_solicitud text,
  paso             text,
  faltan           jsonb,
  motivo           text,
  estado_cuenta    text,
  ispb             text,
  banco            text,
  agencia          text,
  conta            text,
  conta_tipo       text,
  llaves           jsonb,
  user_id          uuid,
  asignada_at      timestamptz,
  asignada_por     uuid,
  datos_enviados   jsonb,
  ultima_respuesta jsonb,
  creada_por       uuid,
  creada_at        timestamptz not null default now(),
  actualizado_at   timestamptz not null default now()
);

create index if not exists gowd_cuentas_user_idx on public.gowd_cuentas (user_id);

alter table public.gowd_cuentas enable row level security;
revoke all on public.gowd_cuentas from anon, authenticated, public;
grant all on public.gowd_cuentas to service_role;
grant usage, select on sequence public.gowd_cuentas_id_seq to service_role;

create table if not exists public.gowd_operaciones (
  id             bigserial primary key,
  tipo           text not null check (tipo in ('cobro', 'qr_estatico', 'envio', 'reembolso', 'cierre', 'med')),
  idempotencia   text not null unique,
  external_id    text,
  gowd_id        text,
  gowd_cuenta_id bigint references public.gowd_cuentas (id) on delete set null,
  account_id     text,
  estado         text,
  monto          text,
  moneda         text,
  end_to_end     text,
  descripcion    text,
  datos_enviados jsonb,
  respuesta      jsonb,
  creada_por     uuid,
  creada_at      timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);

create index if not exists gowd_operaciones_gowd_idx on public.gowd_operaciones (gowd_id);
create index if not exists gowd_operaciones_ext_idx on public.gowd_operaciones (external_id);
create index if not exists gowd_operaciones_cuenta_idx on public.gowd_operaciones (gowd_cuenta_id, creada_at desc);

alter table public.gowd_operaciones enable row level security;
revoke all on public.gowd_operaciones from anon, authenticated, public;
grant all on public.gowd_operaciones to service_role;
grant usage, select on sequence public.gowd_operaciones_id_seq to service_role;

create table if not exists public.gowd_config (
  clave          text primary key,
  valor          text not null,
  actualizado_at timestamptz not null default now(),
  actualizado_por uuid
);

alter table public.gowd_config enable row level security;
revoke all on public.gowd_config from anon, authenticated, public;
grant all on public.gowd_config to service_role;
