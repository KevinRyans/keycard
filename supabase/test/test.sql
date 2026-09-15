\set ON_ERROR_STOP on
\pset pager off

-- Etterlign Supabase sine standardrettigheter
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
-- 02_policies.sql fjerner anon-tilgangen igjen
revoke all on public.profiles, public.cards, public.loans, public.card_events from anon;

-- Tre testbrukere
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'vaktmester@test.no'),
  ('22222222-2222-2222-2222-222222222222', 'leder@test.no'),
  ('33333333-3333-3333-3333-333333333333', 'ikkeaktivert@test.no');

update public.profiles set role='vaktmester', active=true, full_name='Vakt Mester'
 where id='11111111-1111-1111-1111-111111111111';
update public.profiles set role='leder', active=true, full_name='Le Der'
 where id='22222222-2222-2222-2222-222222222222';
-- den tredje forblir inaktiv med vilje

insert into public.cards (card_number, label) values
  ('L-001','Rådhuset'), ('L-002','Rådhuset'), ('L-003','Driftsbygg');

\echo '--- 1. Trigger opprettet profiler automatisk (forventer 3) ---'
select count(*) as profiler from public.profiles;

\echo '--- 2. Nye kontoer er inaktive med lavest rettighet (forventer leder/f) ---'
select role, active from public.profiles where id='33333333-3333-3333-3333-333333333333';

-- ===========================================================================
--  Som VAKTMESTER
-- ===========================================================================
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo '--- 3. Vaktmester ser kortene (forventer 3) ---'
select count(*) as synlige_kort from public.v_cards_overview;

\echo '--- 4. Registrer utlån ---'
insert into public.loans (card_id, borrower_name, borrower_workplace)
select id, 'Ola Nordmann', 'Teknisk drift' from public.cards where card_number='L-001';

\echo '--- 5. issued_by ble satt automatisk (forventer Vakt Mester) ---'
select issued_by_name from public.v_loans_full where card_number='L-001';

\echo '--- 6. Kortet vises nå som utlånt ---'
select card_number, availability, borrower_name from public.v_cards_overview order by card_number;

\echo '--- 7. SAMME KORT TIL TO PERSONER SKAL FEILE ---'
savepoint s1;
do $$ begin
  insert into public.loans (card_id, borrower_name)
  select id, 'Kari Dobbel' from public.cards where card_number='L-001';
  raise exception 'TEST FEILET: dobbelt utlån ble tillatt';
exception when unique_violation then
  raise notice 'OK: databasen avviste dobbelt utlån';
end $$;
rollback to s1;

\echo '--- 8. UTLÅN AV SPERRET KORT SKAL FEILE ---'
update public.cards set status='tapt' where card_number='L-003';
savepoint s2;
do $$ begin
  insert into public.loans (card_id, borrower_name)
  select id, 'Per Sperret' from public.cards where card_number='L-003';
  raise exception 'TEST FEILET: sperret kort ble lånt ut';
exception when others then
  raise notice 'OK: avvist med "%"', sqlerrm;
end $$;
rollback to s2;

\echo '--- 9. Innlevering frigjør kortet ---'
update public.loans
   set returned_at = now(), return_condition = 'levert'
 where card_id = (select id from public.cards where card_number='L-001')
   and returned_at is null;
select card_number, availability from public.v_cards_overview where card_number='L-001';

\echo '--- 10. Samme kort kan lånes ut på nytt, og historikken består ---'
insert into public.loans (card_id, borrower_name, borrower_workplace)
select id, 'Kari Nordmann', 'Helse' from public.cards where card_number='L-001';
select borrower_name, returned_at is null as ute_na, duration_days
  from public.v_loans_full where card_number='L-001' order by borrowed_at;

\echo '--- 11. GJENÅPNING AV AVSLUTTET UTLÅN SKAL FEILE ---'
savepoint s3;
do $$ begin
  update public.loans set returned_at=null, return_condition=null
   where returned_at is not null;
  raise exception 'TEST FEILET: avsluttet utlån ble gjenåpnet';
exception when others then
  raise notice 'OK: avvist med "%"', sqlerrm;
end $$;
rollback to s3;

\echo '--- 12. Meldt tapt ved innlevering sperrer kortet automatisk ---'
insert into public.loans (card_id, borrower_name)
select id, 'Glemsk Person' from public.cards where card_number='L-002';
update public.loans set returned_at=now(), return_condition='tapt'
 where card_id=(select id from public.cards where card_number='L-002') and returned_at is null;
select card_number, status, availability from public.v_cards_overview where card_number='L-002';

\echo '--- 13. Sporingsloggen fanget statusendringene ---'
select c.card_number, e.event, e.from_status, e.to_status
  from public.card_events e join public.cards c on c.id=e.card_id
 order by e.id;

-- ===========================================================================
--  Som LEDER (skal kun kunne lese)
-- ===========================================================================
reset role;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

\echo '--- 14. Leder ser all historikk (forventer 3 utlån) ---'
select count(*) as utlan_synlig from public.v_loans_full;

\echo '--- 15. LEDER SKAL IKKE KUNNE REGISTRERE UTLÅN ---'
savepoint s4;
do $$ begin
  insert into public.loans (card_id, borrower_name)
  select id, 'Skal Feile' from public.cards where card_number='L-001' limit 1;
  raise exception 'TEST FEILET: leder fikk registrere utlån';
exception when insufficient_privilege then
  raise notice 'OK: tilgangsreglene stoppet skriving';
end $$;
rollback to s4;

\echo '--- 16. LEDER SKAL IKKE KUNNE ENDRE KORT ---'
do $$
declare n int;
begin
  update public.cards set label='Kapret' where card_number='L-001';
  get diagnostics n = row_count;
  if n > 0 then raise exception 'TEST FEILET: leder endret % rad(er)', n; end if;
  raise notice 'OK: ingen rader endret';
end $$;

\echo '--- 17. LEDER SKAL IKKE KUNNE GJØRE SEG SELV TIL ADMIN ---'
do $$
declare n int;
begin
  update public.profiles set role='admin' where id=auth.uid();
  get diagnostics n = row_count;
  if n > 0 then raise exception 'TEST FEILET: rettighetseskalering mulig'; end if;
  raise notice 'OK: rolleendring blokkert';
end $$;

-- ===========================================================================
--  Som IKKE-AKTIVERT bruker (skal se absolutt ingenting)
-- ===========================================================================
reset role;
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

\echo '--- 18. IKKE-AKTIVERT KONTO SKAL IKKE SE NOE (forventer 0, 0) ---'
select (select count(*) from public.cards) as kort,
       (select count(*) from public.loans) as utlan;

-- ===========================================================================
--  Anonymisering
-- ===========================================================================
reset role;

\echo '--- 19. Anonymisering krever admin ---'
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  perform public.anonymize_old_loans(24);
  raise exception 'TEST FEILET: vaktmester fikk anonymisere';
exception when others then
  raise notice 'OK: avvist med "%"', sqlerrm;
end $$;

reset role;
update public.profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- Flytt et avsluttet utlån tre år tilbake i tid
reset role;
update public.loans set borrowed_at = now() - interval '3 years',
                        returned_at = now() - interval '3 years' + interval '2 days'
 where return_condition='levert';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo '--- 20. Admin anonymiserer gammel historikk (forventer 1) ---'
select public.anonymize_old_loans(24) as antall_anonymisert;

\echo '--- 21. Navnet er borte, men kortets brukshistorikk består ---'
select card_number, borrower_name, borrower_workplace,
       anonymized_at is not null as anonymisert, duration_days
  from public.v_loans_full order by borrowed_at;

reset role;
\echo ''
\echo '=== ALLE TESTER KJØRT ==='
