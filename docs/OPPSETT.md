# Oppsett steg for steg

Regn med 30–45 minutter første gang. Du trenger ingen programmeringskunnskaper,
men du må være nøyaktig med rekkefølgen.

---

## 1. Opprett databasen

1. Gå til [supabase.com](https://supabase.com) og lag en konto.
2. **New project.**
   - **Name:** `nokkelkort`
   - **Database Password:** la Supabase lage et sterkt passord. **Lagre det i
     kommunens passordhåndtering**, ikke i en tekstfil på skrivebordet.
   - **Region:** `Central EU (Frankfurt)` — **dette valget kan ikke endres
     senere**, og det er grunnlaget for at persondataene blir liggende i EU.
3. Vent til prosjektet er ferdig opprettet (et par minutter).

---

## 2. Lag tabellene og reglene

Gå til **SQL Editor** i menyen til venstre.

1. **New query** → åpne `supabase/01_schema.sql` fra dette kodelageret, kopier
   alt, lim inn, trykk **Run**.
   Du skal få `Success. No rows returned`. Noen gule `NOTICE`-meldinger om at
   triggere «does not exist, skipping» er normalt første gang.
2. **New query** → gjør det samme med `supabase/02_policies.sql`.

> Rekkefølgen er viktig. Fil 02 bygger på fil 01.

Sjekk at det gikk bra: gå til **Table Editor**. Du skal se tabellene
`profiles`, `cards`, `loans` og `card_events`, alle merket med et hengelås-ikon
(**RLS enabled**). Ser du ikke hengelåsen på alle fire, har noe gått galt – kjør
fil 02 på nytt.

---

## 3. Steng døra: slå av selvregistrering

**Dette steget er ikke valgfritt.**

Gå til **Authentication → Sign In / Providers → Email** og slå **av**
`Allow new users to sign up`.

Uten dette kan hvem som helst på internett opprette en konto. De ville riktignok
ikke fått se noe – nye kontoer er inaktive – men du vil ikke ha fremmede
kontoer i systemet i det hele tatt.

Mens du er her: la `Confirm email` stå **på**.

---

## 4. Koble nettsiden til databasen

1. Gå til **Project Settings → API**.
2. Kopier **Project URL** og **anon public**-nøkkelen.
3. Åpne `assets/js/config.js` i dette kodelageret og lim dem inn:

```js
export const SUPABASE_URL = 'https://abcdefghijk.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';   // den lange "anon public"
```

4. Rett samtidig opp `orgName` til navnet på kommunen, og `retentionMonths` til
   det antall måneder kommunen har bestemt at historikk skal beholdes.

> **Bruk aldri `service_role`-nøkkelen her.** Den omgår alle sikkerhetsregler og
> skal aldri forlate Supabase. `anon public` er den riktige, og den er ment å
> være offentlig.

Lagre og last opp endringen til GitHub.

---

## 5. Publiser nettsiden

I GitHub-kodelageret: **Settings → Pages**

- **Source:** `Deploy from a branch`
- **Branch:** `main`, mappe `/ (root)`
- **Save**

Etter et par minutter ligger siden på
`https://<brukernavn>.github.io/keycard/`.

> Vurder å sette kodelageret til **Private**. Siden fungerer da fortsatt hvis
> kontoen har GitHub Pages for private repoer, og koden blir ikke liggende
> åpent. Det er ikke nødvendig for sikkerheten – men det er ryddig.

---

## 6. Opprett deg selv som administrator

1. **Authentication → Users → Add user → Create new user.**
   Skriv inn din egen jobb-e-post og et passord. Huk av for
   `Auto Confirm User`.
2. Åpne nettsiden og logg inn én gang. Du får beskjed om at kontoen ikke er
   aktivert. **Det er riktig** – det beviser at sperren virker.
3. Gå til **SQL Editor**, og kjør blokk 1 fra
   `supabase/03_admin_og_testdata.sql` med din egen e-postadresse:

```sql
update public.profiles p
   set role = 'admin', active = true, full_name = 'Ditt Navn'
  from auth.users u
 where u.id = p.id
   and u.email = 'din.epost@kommune.no';
```

4. Last siden på nytt. Nå er du inne.

---

## 7. Legg inn kortene

Under **Kortbeholdning → + Nytt kort**, ett kort om gangen.

Har du mange kort, er det raskere å legge dem inn med SQL – se blokk 6 i
`supabase/03_admin_og_testdata.sql`.

**Bruk nøyaktig samme kortnummer som står på kortet og i nøkkelkortsystemet.**
Systemet er verdiløst hvis numrene ikke stemmer overens med virkeligheten.

---

## 8. Gi kollegaer tilgang

For hver person:

1. **Authentication → Users → Add user** med deres jobb-e-post.
2. Kjør blokk 2 i `supabase/03_admin_og_testdata.sql` med riktig rolle:
   - `vaktmester` – kan låne ut og ta imot
   - `leder` – kan kun lese

Be dem bytte passord ved første innlogging (**Glemt passord?** på
innloggingssiden sender dem en lenke).

---

## Vedlikehold

| Når | Hva |
|---|---|
| Ved oppsigelse eller rollebytte | Kjør blokk 3 – steng ute kontoen. Gjør det samme dag. |
| Hvert halvår | Kjør blokk 4 – gå gjennom hvem som har tilgang. |
| Årlig | Kjør blokk 5 – anonymiser historikk eldre enn oppbevaringstiden. |
| Ved tapt kort | Meld tapt i appen **og** sperr kortet i nøkkelkortsystemet. Appen sperrer bare i denne oversikten. |

---

## Når noe ikke virker

**«Oppsett gjenstår» vises fortsatt**
`config.js` er ikke fylt ut, eller endringen er ikke lastet opp til GitHub.
GitHub Pages kan bruke et par minutter på å oppdatere seg.

**«Feil e-post eller passord»**
Er brukeren opprettet under Authentication → Users? Er e-posten bekreftet?

**«Kontoen er ikke aktivert»**
Den er opprettet, men ingen har gitt den rolle ennå. Kjør blokk 2.

**«Du har ikke tilgang til å gjøre dette»**
Kontoen har rollen `leder`. Det er lesetilgang. Endre til `vaktmester` hvis
personen faktisk skal låne ut kort.

**«Kortet er allerede utlånt»**
En kollega registrerte kortet i samme øyeblikk. Last siden på nytt.
Dette er databasen som gjør jobben sin.

**Innlogging virker lokalt, men ikke på GitHub Pages**
Legg til nettadressen til siden under **Authentication → URL Configuration →
Redirect URLs** i Supabase.
