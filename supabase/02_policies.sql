-- ============================================================================
--  Nøkkelkortsystem – tilgangsregler (Row Level Security)
--
--  DETTE ER SIKKERHETEN I SYSTEMET.
--  Den offentlige API-nøkkelen i frontend-koden er ment å være offentlig.
--  Alt som faktisk beskytter dataene står i denne filen, inne i databasen.
--  Reglene gjelder uansett om forespørselen kommer fra nettsiden, fra curl
--  eller fra noen som har lest all koden på GitHub.
-- ============================================================================

alter table public.profiles    enable row level security;
alter table public.cards       enable row level security;
alter table public.loans       enable row level security;
alter table public.card_events enable row level security;

-- ----------------------------------------------------------------------------
-- Hjelpefunksjoner
--
-- security definer gjør at funksjonen leser profiles uten å utløse RLS på nytt.
-- Uten dette ville reglene på profiles kalt seg selv i det uendelige.
-- ----------------------------------------------------------------------------

create or replace function public.my_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- Har brukeren i det hele tatt tilgang? (aktiv konto med en rolle)
create or replace function public.can_read()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_role() is not null
$$;

-- Kan brukeren registrere utlån og vedlikeholde kortbeholdningen?
create or replace function public.can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_role() in ('admin', 'vaktmester')
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_role() = 'admin'
$$;

-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.can_read());

-- Ingen kan endre sin egen rolle eller aktivere seg selv. Kun admin.
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Bevisst ingen INSERT-regel: profiler opprettes av triggeren på auth.users.
-- Bevisst ingen DELETE-regel: kontoer deaktiveres, de slettes ikke.

-- ----------------------------------------------------------------------------
-- cards
-- ----------------------------------------------------------------------------

drop policy if exists cards_select on public.cards;
create policy cards_select on public.cards
  for select to authenticated
  using (public.can_read());

drop policy if exists cards_insert on public.cards;
create policy cards_insert on public.cards
  for insert to authenticated
  with check (public.can_write());

drop policy if exists cards_update on public.cards;
create policy cards_update on public.cards
  for update to authenticated
  using (public.can_write())
  with check (public.can_write());

drop policy if exists cards_delete on public.cards;
create policy cards_delete on public.cards
  for delete to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- loans
-- ----------------------------------------------------------------------------

drop policy if exists loans_select on public.loans;
create policy loans_select on public.loans
  for select to authenticated
  using (public.can_read());

drop policy if exists loans_insert on public.loans;
create policy loans_insert on public.loans
  for insert to authenticated
  with check (public.can_write());

drop policy if exists loans_update on public.loans;
create policy loans_update on public.loans
  for update to authenticated
  using (public.can_write())
  with check (public.can_write());

-- Kun admin kan slette. Sletting bryter sporbarheten – bruk anonymisering
-- (anonymize_old_loans) for å fjerne persondata og beholde historikken.
drop policy if exists loans_delete on public.loans;
create policy loans_delete on public.loans
  for delete to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- card_events
-- ----------------------------------------------------------------------------

drop policy if exists card_events_select on public.card_events;
create policy card_events_select on public.card_events
  for select to authenticated
  using (public.can_read());

-- Ingen skriveregler: loggen fylles kun av triggere. Den kan ikke redigeres
-- fra nettsiden, heller ikke av admin.

-- ----------------------------------------------------------------------------
-- Ingen tilgang for anonyme (ikke innloggede) brukere.
-- Alle reglene over er begrenset til rollen "authenticated".
-- ----------------------------------------------------------------------------

revoke all on public.profiles    from anon;
revoke all on public.cards       from anon;
revoke all on public.loans       from anon;
revoke all on public.card_events from anon;
