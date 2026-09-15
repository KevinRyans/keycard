-- Minimal etterligning av Supabase sitt auth-oppsett, kun for testing
create extension if not exists pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
-- Supabase gir authenticated tilgang til auth-skjemaet; stubben må gjøre det samme
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
