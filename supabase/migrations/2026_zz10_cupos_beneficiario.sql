create table if not exists public.cupo_solicitudes (
  id bigserial primary key,
  user_id text not null,
  beneficiario_clave text not null,
  contacto_id text,
  beneficiario_nombre text,
  beneficiario_doc text,
  beneficiario_tipo text,
  cupo_actual numeric,
  usado_mes numeric,
  monto_solicitado numeric,
  motivo text,
  documentos jsonb not null default '[]'::jsonb,
  estado text not null default 'en_proceso',
  cupo_aprobado numeric,
  nota_revision text,
  revisado_por text,
  revisado_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists cupo_solicitudes_estado_idx on public.cupo_solicitudes (estado, created_at desc);
create index if not exists cupo_solicitudes_user_idx on public.cupo_solicitudes (user_id, beneficiario_clave);
alter table public.cupo_solicitudes enable row level security;
revoke all on public.cupo_solicitudes from anon, authenticated;

create table if not exists public.cupos_beneficiario (
  user_id text not null,
  beneficiario_clave text not null,
  beneficiario_nombre text,
  beneficiario_doc text,
  beneficiario_tipo text,
  cupo_mensual numeric not null,
  solicitud_id bigint,
  aprobado_por text,
  aprobado_at timestamptz not null default now(),
  primary key (user_id, beneficiario_clave)
);

alter table public.cupos_beneficiario enable row level security;
revoke all on public.cupos_beneficiario from anon, authenticated;

insert into storage.buckets (id, name, public)
values ('cupo-documentos', 'cupo-documentos', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
