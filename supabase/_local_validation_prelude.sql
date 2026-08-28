-- ============================================================
-- LINCOIN — Prelude SOLO para validar el esquema en un Postgres local.
-- NO ejecutar en Supabase: Supabase ya provee auth.*, storage.*, cron.*,
-- net.*, roles y publicación supabase_realtime de forma nativa.
-- Uso: psql -f _local_validation_prelude.sql && psql -f _lincoln_full_schema.sql
-- ============================================================
-- Roles (idempotent)
do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role supabase_admin nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticator nologin; exception when duplicate_object then null; end $$;
-- Schemas Supabase provee
create schema if not exists auth; create schema if not exists extensions;
create schema if not exists storage; create schema if not exists cron; create schema if not exists net; create schema if not exists graphql;
-- Extensiones
create extension if not exists pgcrypto; create extension if not exists "uuid-ossp";
-- auth.* stubs
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'service_role' $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
-- storage stub
create table if not exists storage.buckets (id text primary key, name text, public boolean default false, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
-- storage helper stub
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
-- cron stub (pg_cron)
create table if not exists cron.job (jobid bigserial primary key, schedule text, command text, jobname text, active boolean default true);
create or replace function cron.schedule(text, text, text) returns bigint language sql as $$ select 1::bigint $$;
create or replace function cron.unschedule(text) returns boolean language sql as $$ select true $$;
-- net stub (pg_net)
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
-- realtime publication
do $$ begin if not exists (select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if; end $$;
