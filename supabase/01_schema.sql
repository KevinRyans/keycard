-- ============================================================================
--  Nøkkelkortsystem – databaseskjema
--  Kjøres i Supabase: SQL Editor -> New query -> lim inn -> Run
--  Kjør filene i rekkefølge: 01_schema.sql, 02_policies.sql, 03_seed_example.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Forhåndskontroll
--
-- "create table if not exists" hopper stille over en tabell som allerede
-- finnes med samme navn, og etterlater da et halvferdig system. Derfor
-- stoppes kjøringen her, med en forklaring, hvis prosjektet allerede har en
-- tabell med et av navnene våre som ikke hører til dette systemet.
--
-- public.profiles er unntaket: den finnes i mange Supabase-maler, og lenger
-- nede legges kolonnene våre til i den i stedet for å avbryte.
-- ----------------------------------------------------------------------------
do $$
declare
  kollisjon text;
begin
  select string_agg('public.' || f.t, ', ' order by f.t)
    into kollisjon
  from (values
    ('cards', 'card_number'),
    ('loans', 'borrower_name'),
    ('card_events', 'event')
  ) as f(t, signatur)
  where exists (
    select 1 from information_schema.tables it
     where it.table_schema = 'public' and it.table_name = f.t
  )
  and not exists (
    select 1 from information_schema.columns ic
     where ic.table_schema = 'public' and ic.table_name = f.t and ic.column_name = f.signatur
  );

  if kollisjon is not null then
    raise exception
      'Prosjektet har allerede tabellen(e) % med et annet innhold enn dette '
      'systemet forventer. Ingenting er endret. Velg et tomt Supabase-prosjekt, '
      'eller gi de eksisterende tabellene nye navn først. '
      'Se avsnittet "Tabellen finnes fra før" i docs/OPPSETT.md.', kollisjon;
  end if;
end $$;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ----------------------------------------------------------------------------
-- Typer
-- ----------------------------------------------------------------------------

-- admin      = kan administrere brukere, slette og anonymisere
-- vaktmester = kan låne ut, ta imot og vedlikeholde kortbeholdningen
-- leder      = kan kun lese oversikt og historikk
do $$ begin
  create type public.app_role as enum ('admin', 'vaktmester', 'leder');
exception when duplicate_object then null; end $$;

-- Administrativ tilstand for selve kortet. Merk at "utlånt" IKKE er en status
-- her: om et kort er utlånt utledes av om det finnes et åpent utlån. Det gjør
-- det umulig for statusfeltet og virkeligheten å komme ut av synk.
do $$ begin
  create type public.card_status as enum ('i_omlop', 'tapt', 'ute_av_drift');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.return_condition as enum ('levert', 'tapt');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- profiles – systembrukere (vaktmestere og ledere), ikke ansatte som låner
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text            not null default '',
  role        public.app_role not null default 'leder',
  active      boolean         not null default false,
  created_at  timestamptz     not null default now()
);

-- Mange Supabase-prosjekter har allerede en public.profiles fra en av malene
-- (typisk "User Management"). Da hopper "create table if not exists" stille
-- over tabellen over, og systemet blir stående halvferdig. Derfor legges
-- kolonnene våre til eksplisitt. Setningene er trygge å kjøre om igjen, og
-- gjør ingenting hvis kolonnen allerede finnes.
alter table public.profiles add column if not exists full_name  text            not null default '';
alter table public.profiles add column if not exists role       public.app_role not null default 'leder';
alter table public.profiles add column if not exists active     boolean         not null default false;
alter table public.profiles add column if not exists created_at timestamptz     not null default now();

comment on table  public.profiles is
  'Personer som logger inn i systemet. Nye kontoer opprettes inaktive med lavest rettighet og må aktiveres manuelt av en admin.';
comment on column public.profiles.active is
  'Inaktiv konto gir null tilgang. Dette er den viktigste bryteren ved oppsigelse eller rollebytte.';

-- ----------------------------------------------------------------------------
-- cards – selve kortbeholdningen
-- ----------------------------------------------------------------------------
create table if not exists public.cards (
  id          uuid primary key default gen_random_uuid(),
  card_number text             not null,
  label       text,                        -- f.eks. "Rådhuset – generell adgang"
  status      public.card_status not null default 'i_omlop',
  notes       text,
  created_at  timestamptz      not null default now(),
  updated_at  timestamptz      not null default now(),
  constraint cards_card_number_not_blank check (length(btrim(card_number)) > 0)
);

-- Kortnummer må være unikt uavhengig av store/små bokstaver
create unique index if not exists cards_card_number_key
  on public.cards (lower(btrim(card_number)));

comment on column public.cards.card_number is
  'Nummeret som står fysisk på kortet, og som brukes i selve nøkkelkortsystemet.';

-- ----------------------------------------------------------------------------
-- loans – ett utlån = én rad. Raden lukkes, den overskrives aldri.
-- ----------------------------------------------------------------------------
create table if not exists public.loans (
  id                 uuid primary key default gen_random_uuid(),
  card_id            uuid        not null references public.cards (id) on delete restrict,
  borrower_name      text        not null,
  borrower_workplace text,                    -- valgfritt: avdeling / arbeidssted
  purpose            text,                    -- valgfritt: årsak til lånet
  borrowed_at        timestamptz not null default now(),
  expected_return_at timestamptz,
  returned_at        timestamptz,
  return_condition   public.return_condition,
  issued_by          uuid references public.profiles (id) on delete set null,
  returned_by        uuid references public.profiles (id) on delete set null,
  notes              text,
  anonymized_at      timestamptz,             -- settes av oppbevaringsrutinen
  created_at         timestamptz not null default now(),

  -- Innlevert tidspunkt og innleveringstilstand må følges ad
  constraint loans_return_logic check (
    (returned_at is null     and return_condition is null)
    or (returned_at is not null and return_condition is not null)
  ),
  constraint loans_return_after_borrow check (
    returned_at is null or returned_at >= borrowed_at
  ),
  constraint loans_borrower_name_not_blank check (
    anonymized_at is not null or length(btrim(borrower_name)) > 0
  )
);

-- Hele poenget med systemet: ett kort kan ikke være utlånt til to personer.
-- Dette håndheves av databasen, ikke av brukergrensesnittet.
create unique index if not exists loans_one_open_per_card
  on public.loans (card_id) where returned_at is null;

create index if not exists loans_card_id_idx     on public.loans (card_id);
create index if not exists loans_borrowed_at_idx on public.loans (borrowed_at desc);
create index if not exists loans_open_idx        on public.loans (returned_at) where returned_at is null;
create index if not exists loans_name_trgm_idx   on public.loans using gin (borrower_name gin_trgm_ops);

comment on table public.loans is
  'Full lånehistorikk. Hver rad er ett utlån av ett kort til én person i ett tidsrom. Rader slettes ikke – gammel historikk anonymiseres i stedet.';

-- ----------------------------------------------------------------------------
-- card_events – sporingslogg for endringer på kort (tapt, sperret, gjenfunnet)
-- ----------------------------------------------------------------------------
create table if not exists public.card_events (
  id          bigserial primary key,
  card_id     uuid not null references public.cards (id) on delete cascade,
  event       text not null,
  from_status public.card_status,
  to_status   public.card_status,
  actor       uuid references public.profiles (id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists card_events_card_idx on public.card_events (card_id, created_at desc);

-- ============================================================================
--  Triggere og forretningsregler
-- ============================================================================

-- Ny innlogget bruker får automatisk en profil – inaktiv og med lavest rettighet.
create or replace function public.tg_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    'leder',
    false
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_handle_new_user();

-- Hold updated_at oppdatert på cards
create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists cards_touch_updated_at on public.cards;
create trigger cards_touch_updated_at
  before update on public.cards
  for each row execute function public.tg_touch_updated_at();

-- Logg statusendringer på kort
create or replace function public.tg_log_card_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.card_events (card_id, event, to_status, actor, note)
    values (new.id, 'opprettet', new.status, auth.uid(), new.notes);
  elsif new.status is distinct from old.status then
    insert into public.card_events (card_id, event, from_status, to_status, actor, note)
    values (new.id, 'statusendring', old.status, new.status, auth.uid(), new.notes);
  end if;
  return new;
end $$;

drop trigger if exists cards_log_status on public.cards;
create trigger cards_log_status
  after insert or update on public.cards
  for each row execute function public.tg_log_card_status();

-- Validering av utlån.
--   * Et kort som er tapt eller ute av drift kan ikke lånes ut.
--   * Et innlevert utlån kan ikke gjenåpnes (historikken skal være til å stole på).
--   * Registrerer automatisk hvem som lånte ut og hvem som tok imot.
create or replace function public.tg_loans_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.card_status;
begin
  if tg_op = 'INSERT' then
    select status into s from public.cards where id = new.card_id;
    if s is null then
      raise exception 'Ukjent kort';
    end if;
    if s <> 'i_omlop' then
      raise exception 'Kortet kan ikke lånes ut. Status: %', s;
    end if;
    new.issued_by := coalesce(new.issued_by, auth.uid());

  elsif tg_op = 'UPDATE' then
    if old.returned_at is not null and new.returned_at is null then
      raise exception 'Et innlevert utlån kan ikke gjenåpnes';
    end if;
    if old.returned_at is not null and new.card_id is distinct from old.card_id then
      raise exception 'Kortet på et avsluttet utlån kan ikke endres';
    end if;
    if new.returned_at is not null and old.returned_at is null then
      new.returned_by := coalesce(new.returned_by, auth.uid());
    end if;
  end if;

  return new;
end $$;

drop trigger if exists loans_validate on public.loans;
create trigger loans_validate
  before insert or update on public.loans
  for each row execute function public.tg_loans_validate();

-- Meldes et kort tapt ved innlevering, sperres kortet automatisk.
create or replace function public.tg_loans_after_return()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.return_condition = 'tapt' and old.return_condition is distinct from 'tapt' then
    update public.cards set status = 'tapt' where id = new.card_id and status <> 'tapt';
  end if;
  return new;
end $$;

drop trigger if exists loans_after_return on public.loans;
create trigger loans_after_return
  after update on public.loans
  for each row execute function public.tg_loans_after_return();

-- ============================================================================
--  Visninger
-- ============================================================================

-- security_invoker = true gjør at RLS-reglene til den innloggede brukeren
-- gjelder for visningen. Uten dette ville visningen omgått sikkerheten.

create or replace view public.v_cards_overview
with (security_invoker = true) as
select
  c.id,
  c.card_number,
  c.label,
  c.status,
  c.notes,
  c.created_at,
  l.id                 as open_loan_id,
  l.borrower_name,
  l.borrower_workplace,
  l.borrowed_at,
  l.expected_return_at,
  case
    when c.status = 'tapt'         then 'tapt'
    when c.status = 'ute_av_drift' then 'ute_av_drift'
    when l.id is not null          then 'utlant'
    else 'tilgjengelig'
  end as availability,
  case
    when l.id is not null
    then floor(extract(epoch from (now() - l.borrowed_at)) / 86400)::int
  end as days_out
from public.cards c
left join public.loans l
  on l.card_id = c.id and l.returned_at is null;

create or replace view public.v_loans_full
with (security_invoker = true) as
select
  l.*,
  c.card_number,
  c.label as card_label,
  iss.full_name as issued_by_name,
  ret.full_name as returned_by_name,
  case
    when l.returned_at is null
    then floor(extract(epoch from (now() - l.borrowed_at)) / 86400)::int
    else floor(extract(epoch from (l.returned_at - l.borrowed_at)) / 86400)::int
  end as duration_days
from public.loans l
join public.cards c    on c.id = l.card_id
left join public.profiles iss on iss.id = l.issued_by
left join public.profiles ret on ret.id = l.returned_by;

-- ============================================================================
--  Oppbevaring / sletting av persondata
-- ============================================================================

-- Fjerner navn og arbeidssted fra avsluttede utlån eldre enn angitt antall
-- måneder, men beholder raden slik at statistikk og kortets brukshistorikk
-- fortsatt finnes. Kjøres av admin, eller settes opp som planlagt jobb.
create or replace function public.anonymize_old_loans(months int default 24)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if public.my_role() <> 'admin' then
    raise exception 'Kun administrator kan kjøre anonymisering';
  end if;

  update public.loans
     set borrower_name      = 'Anonymisert',
         borrower_workplace = null,
         purpose            = null,
         notes              = null,
         anonymized_at      = now()
   where returned_at is not null
     and returned_at < now() - make_interval(months => months)
     and anonymized_at is null;

  get diagnostics n = row_count;
  return n;
end $$;

-- ============================================================================
--  Sluttkontroll
--
--  "create table if not exists" hopper stille over en tabell som allerede
--  finnes med samme navn. Uten denne kontrollen kunne skjemaet blitt stående
--  halvferdig uten at noen merket det før systemet var i bruk. Her sjekkes det
--  at alt faktisk ble som forventet, og kjøringen stopper hvis ikke.
-- ============================================================================
do $$
declare
  mangler text;
begin
  select string_agg(f.t || '.' || f.c, ', ' order by f.t, f.c)
    into mangler
  from (values
    ('profiles', 'full_name'), ('profiles', 'role'), ('profiles', 'active'),
    ('cards', 'card_number'),  ('cards', 'status'),
    ('loans', 'card_id'),      ('loans', 'borrower_name'),
    ('loans', 'borrowed_at'),  ('loans', 'returned_at'),
    ('loans', 'return_condition'), ('loans', 'anonymized_at'),
    ('card_events', 'card_id'), ('card_events', 'event')
  ) as f(t, c)
  where not exists (
    select 1 from information_schema.columns ic
     where ic.table_schema = 'public'
       and ic.table_name   = f.t
       and ic.column_name  = f.c
  );

  if mangler is not null then
    raise exception
      'Skjemaet er ikke komplett. Disse kolonnene mangler: %. '
      'Årsaken er nesten alltid at en tabell med samme navn fantes i prosjektet '
      'fra før, slik at "create table if not exists" hoppet over den. '
      'Se avsnittet "Tabellen finnes fra før" i docs/OPPSETT.md.', mangler;
  end if;

  raise notice 'Skjema OK: alle tabeller og kolonner er på plass.';
end $$;
