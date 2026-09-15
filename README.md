# Nøkkelkort – utlånsoversikt

Et lite system for å holde orden på hvem som har lånt hvilket nøkkelkort, og når.

Det løser ett konkret problem: i dag står lånekort registrert som «utlån» i
nøkkelkortsystemet uten at noen vet hvem som faktisk har dem. Her registreres
hvert utlån med navn, tidspunkt og hvem som lånte det ut – slik at spørsmålet
*«hvem hadde kort L-004 natt til lørdag?»* har et svar.

---

## Slik brukes det

**Låne ut** → Nytt utlån → velg et ledig kort → skriv navn (og eventuelt
arbeidssted) → Registrer.

**Ta imot** → Oversikt → Lever inn på riktig rad → velg om kortet er levert
tilbake eller meldt tapt.

**Slå opp** → Historikk → søk på navn, arbeidssted eller kortnummer, eventuelt
med datofilter. Kan lastes ned som CSV.

---

## Roller

| Rolle | Kan |
|---|---|
| **Vaktmester** | Låne ut, ta imot, legge inn og sperre kort, se all historikk |
| **Leder** | Kun lese oversikt og historikk |
| **Administrator** | I tillegg: gi og fjerne tilgang, anonymisere gammel historikk |

Nye kontoer opprettes **uten tilgang**. En administrator må tildele rolle før
brukeren ser noe som helst. Det er med vilje.

---

## Hvordan det er satt sammen

```
Nettleser  ──►  GitHub Pages          statiske filer, ingen server
                (HTML, CSS, JS)
                     │
                     ▼
                Supabase (EU, Frankfurt)
                 ├── PostgreSQL        data
                 ├── Auth              innlogging
                 └── Row Level Security  ◄── HER LIGGER SIKKERHETEN
```

**Det viktigste å forstå:** API-nøkkelen som ligger i `assets/js/config.js` er
offentlig med vilje. Den er ikke et passord. Sikkerheten ligger i
tilgangsreglene inne i databasen (`supabase/02_policies.sql`), som gjelder
uansett hvor forespørselen kommer fra. Noen som leser all koden på GitHub
kommer likevel ingen vei uten en aktivert brukerkonto.

Derfor er reglene som betyr noe skrevet i SQL, ikke i JavaScript. Knappene som
skjules for en leser er høflighet – databasen er det som faktisk sier nei.

---

## Regler som håndheves av databasen

Disse kan ikke omgås fra nettsiden, fra et skript eller ved en feil i koden:

- Ett kort kan ikke være utlånt til to personer samtidig.
- Et kort som er tapt eller ute av drift kan ikke lånes ut.
- Et utlån som er levert inn kan ikke gjenåpnes eller endres.
- Meldes et kort tapt ved innlevering, sperres kortet automatisk.
- En bruker kan ikke endre sin egen rolle eller aktivere seg selv.
- En konto som ikke er aktivert ser ingenting.

Alle punktene er dekket av testene i `supabase/test/`.

---

## Kom i gang

Full framgangsmåte: **[docs/OPPSETT.md](docs/OPPSETT.md)**

Kort fortalt:

1. Opprett et Supabase-prosjekt i region **EU (Frankfurt)**.
2. Kjør `supabase/01_schema.sql` og `supabase/02_policies.sql` i SQL-editoren.
3. **Slå av selvregistrering** i Supabase (Authentication → Sign In / Providers).
4. Lim inn prosjekt-URL og `anon public`-nøkkel i `assets/js/config.js`.
5. Slå på GitHub Pages: Settings → Pages → Deploy from a branch → `main` / `/ (root)`.
6. Opprett din egen bruker, logg inn én gang, og gjør deg til admin med blokk 1
   i `supabase/03_admin_og_testdata.sql`.

---

## Før dette tas i bruk med ekte navn

Systemet lagrer personopplysninger om ansatte. Kommunen er behandlingsansvarlig.
Les og send **[docs/PERSONVERN.md](docs/PERSONVERN.md)** til IT og
personvernombud før første ekte registrering. Notatet beskriver hva som lagres,
hvor, hvor lenge, og hvem som har tilgang.

---

## Filer

```
index.html                        hele grensesnittet
assets/css/styles.css             utseende, lys og mørk modus
assets/js/config.js               ← den eneste filen du må fylle ut
assets/js/db.js                   all kontakt med databasen
assets/js/ui.js                   formatering, varsler, dialoger
assets/js/app.js                  applikasjonslogikk

supabase/01_schema.sql            tabeller, regler, visninger
supabase/02_policies.sql          tilgangsregler – sikkerheten
supabase/03_admin_og_testdata.sql oppskrifter: gi tilgang, stenge ute, rydde
supabase/test/                    testene som beviser at reglene virker

docs/OPPSETT.md                   steg for steg
docs/PERSONVERN.md                notat til IT og personvernombud
```

---

## Kjøre testene

Krever PostgreSQL 16 lokalt. Testene kjører mot en etterligning av Supabase sitt
`auth`-skjema, så de tester SQL-en, ikke Supabase selv.

```bash
./supabase/test/kjor_tester.sh
```
