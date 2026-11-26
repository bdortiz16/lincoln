-- ════════════════════════════════════════════════════════
--  API externa de saldos por empresa (función api-empresas)
--
--  Antes de correrla: leer _LEEME_ANTES_DE_CORRER.md (comprobar la base).
--
--  Un sistema externo lee los saldos de los clientes de todas las empresas.
--  Se autentica con firma HMAC por consulta y un secreto que rota cada hora
--  (ver docs/superpowers/specs/2026-11-12-api-empresas-design.md).
--
--  Las cuatro tablas son SOLO del servidor: RLS activo y sin políticas, así
--  que ni anon ni authenticated las pueden leer o escribir. La función usa
--  la service role.
--
--  Idempotente.
-- ════════════════════════════════════════════════════════

create table if not exists public.api_credenciales (
  id uuid primary key default gen_random_uuid(),
  llave_id text not null unique,
  etiqueta text not null,
  -- null = todas las empresas
  empresa_id uuid null references public.users(id) on delete cascade,
  ips_permitidas text[] null,
  estado text not null default 'activa' check (estado in ('activa', 'revocada')),
  motivo_revocacion text null,
  creada_por uuid null,
  creada_at timestamptz not null default now(),
  revocada_at timestamptz null
);

create table if not exists public.api_secretos (
  credencial_id uuid not null references public.api_credenciales(id) on delete cascade,
  generacion int not null,
  -- AES-GCM con API_SECRETOS_KEY; nunca en claro
  secreto_cifrado text not null,
  creado_at timestamptz not null default now(),
  expira_at timestamptz not null,
  reemplazado_at timestamptz null,
  primary key (credencial_id, generacion)
);

create table if not exists public.api_nonces (
  credencial_id uuid not null references public.api_credenciales(id) on delete cascade,
  nonce text not null,
  at timestamptz not null default now(),
  primary key (credencial_id, nonce)
);
create index if not exists api_nonces_at on public.api_nonces (at);

create table if not exists public.api_consultas (
  id bigserial primary key,
  at timestamptz not null default now(),
  credencial_id uuid null references public.api_credenciales(id) on delete set null,
  generacion int null,
  accion text null,
  id_consultado text null,
  ip text null,
  pais text null,
  user_agent text null,
  dispositivo text null,
  resultado text not null,
  clientes int null,
  duracion_ms int null
);
create index if not exists api_consultas_credencial_at on public.api_consultas (credencial_id, at desc);
create index if not exists api_consultas_ip_at on public.api_consultas (ip, at desc);

alter table public.api_credenciales enable row level security;
alter table public.api_secretos enable row level security;
alter table public.api_nonces enable row level security;
alter table public.api_consultas enable row level security;

revoke all on public.api_credenciales, public.api_secretos, public.api_nonces, public.api_consultas from anon, authenticated;
revoke all on sequence public.api_consultas_id_seq from anon, authenticated;
