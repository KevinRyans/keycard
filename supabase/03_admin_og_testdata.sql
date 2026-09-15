-- ============================================================================
--  Nøkkelkortsystem – administrasjon og testdata
--
--  Denne filen kjøres IKKE i sin helhet. Den er en oppskriftsbok.
--  Kjør de enkelte blokkene du trenger, én av gangen.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. GJØR DEG SELV TIL ADMIN  (gjøres én gang, rett etter første innlogging)
--
--    Opprett først brukeren din under Authentication -> Users -> Add user,
--    logg inn i appen én gang, og kjør så denne. Bytt ut e-postadressen.
-- ----------------------------------------------------------------------------

update public.profiles p
   set role = 'admin', active = true, full_name = 'Ditt Navn'
  from auth.users u
 where u.id = p.id
   and u.email = 'din.epost@kommune.no';


-- ----------------------------------------------------------------------------
-- 2. AKTIVER EN KOLLEGA
--
--    Nye kontoer er alltid inaktive med lavest rettighet. Det er meningen.
--    En konto som ikke er aktivert kommer ingen vei, selv med riktig passord.
--
--    role = 'vaktmester'  -> kan låne ut, ta imot, og vedlikeholde kort
--    role = 'leder'       -> kan kun lese oversikt og historikk
-- ----------------------------------------------------------------------------

update public.profiles p
   set role = 'vaktmester', active = true, full_name = 'Kari Nordmann'
  from auth.users u
 where u.id = p.id
   and u.email = 'kari.nordmann@kommune.no';


-- ----------------------------------------------------------------------------
-- 3. STENG UTE EN KONTO  (ved oppsigelse, permisjon eller rollebytte)
--
--    Dette er den viktigste kommandoen i filen. Den virker umiddelbart.
-- ----------------------------------------------------------------------------

update public.profiles p
   set active = false
  from auth.users u
 where u.id = p.id
   and u.email = 'sluttet@kommune.no';


-- ----------------------------------------------------------------------------
-- 4. SE HVEM SOM HAR TILGANG  (kjør denne jevnlig – minst hvert halvår)
-- ----------------------------------------------------------------------------

select u.email, p.full_name, p.role, p.active, p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
 order by p.active desc, p.role, u.email;


-- ----------------------------------------------------------------------------
-- 5. ANONYMISER GAMMEL HISTORIKK  (oppbevaringsrutine)
--
--    Fjerner navn og arbeidssted fra avsluttede utlån eldre enn X måneder.
--    Radene beholdes, så du ser fortsatt at kortet var i bruk i perioden.
--    Tallet skal være det kommunen har bestemt, ikke det jeg har foreslått.
-- ----------------------------------------------------------------------------

select public.anonymize_old_loans(24);   -- returnerer antall anonymiserte rader


-- ----------------------------------------------------------------------------
-- 6. TESTDATA – kortbeholdning
--
--    Inneholder bevisst ingen personopplysninger. Bytt ut med de faktiske
--    kortnumrene deres. Utlån registreres i appen, ikke her.
-- ----------------------------------------------------------------------------

insert into public.cards (card_number, label, status, notes) values
  ('L-001', 'Rådhuset – generell adgang',        'i_omlop',      null),
  ('L-002', 'Rådhuset – generell adgang',        'i_omlop',      null),
  ('L-003', 'Rådhuset – generell adgang',        'i_omlop',      null),
  ('L-004', 'Driftsbygg og lager',               'i_omlop',      null),
  ('L-005', 'Driftsbygg og lager',               'i_omlop',      null),
  ('L-006', 'Skole – hovedinngang',              'i_omlop',      null),
  ('L-007', 'Skole – hovedinngang',              'i_omlop',      null),
  ('L-008', 'Helsebygg',                         'i_omlop',      null),
  ('L-009', 'Helsebygg',                         'ute_av_drift', 'Defekt brikke, sendt til utskifting'),
  ('L-010', 'Midlertidig / håndverkere',         'i_omlop',      null)
on conflict do nothing;


-- ----------------------------------------------------------------------------
-- 7. NYTTIGE SPØRRINGER
-- ----------------------------------------------------------------------------

-- Hvem har kortene ute akkurat nå, og hvor lenge har de hatt dem?
select card_number, borrower_name, borrower_workplace, borrowed_at, days_out
  from public.v_cards_overview
 where availability = 'utlant'
 order by days_out desc;

-- Hvem hadde et bestemt kort på et bestemt tidspunkt?
-- (spørsmålet du en dag kommer til å måtte svare på)
select borrower_name, borrower_workplace, borrowed_at, returned_at, issued_by_name
  from public.v_loans_full
 where card_number = 'L-004'
   and borrowed_at <= '2026-03-14 22:00+01'
   and (returned_at is null or returned_at >= '2026-03-14 22:00+01');

-- Kort som har vært ute lenge uten å bli levert
select card_number, borrower_name, borrower_workplace, borrowed_at, days_out
  from public.v_cards_overview
 where availability = 'utlant' and days_out > 30
 order by days_out desc;
