# Notat om personopplysninger

**Til:** IT-avdelingen og personvernombudet
**Gjelder:** Digital oversikt over utlån av nøkkelkort
**Status:** Til vurdering før systemet tas i bruk med reelle opplysninger

Dette notatet er skrevet av den som har satt opp løsningen, og beskriver hva
systemet faktisk gjør. Det er ikke en juridisk vurdering. Punktene under
overskriften *«Spørsmål kommunen må ta stilling til»* er bevisst stående åpne
fordi de ikke er en vaktmesters å avgjøre.

---

## 1. Hvorfor systemet finnes

Lånekort til kommunale bygg registreres i dag som «utlån» i nøkkelkortsystemet
uten at det dokumenteres hvem som har fått kortet. Ved et avvik – innbrudd,
skade, uvedkommende i bygget – finnes det ingen måte å slå opp hvem som hadde
fysisk adgang på et gitt tidspunkt.

Systemet lukker dette hullet ved å knytte hvert utlån til en navngitt person og
et tidsrom.

---

## 2. Hvilke opplysninger lagres

**Om den som låner et kort:**

| Opplysning | Påkrevd | Merknad |
|---|---|---|
| Navn | Ja | Fritekst skrevet inn av vaktmester |
| Arbeidssted / avdeling | Nei | Valgfritt |
| Tidspunkt for utlån | Ja | Settes automatisk |
| Tidspunkt for innlevering | Ja, ved innlevering | Settes automatisk |
| Forventet innlevering | Nei | Valgfritt |
| Merknad | Nei | Fritekst |

**Om den som betjener systemet:** e-postadresse, navn, rolle, samt hvilken
bruker som registrerte hvert utlån og hver innlevering.

**Det lagres ikke:** fødselsnummer, ansattnummer, telefonnummer, adresse,
lønns- eller personalopplysninger, og ingen logg over hvor eller når kortet
faktisk er brukt. Systemet vet hvem som har et kort – ikke hvilke dører
personen har åpnet.

Ingen særlige kategorier av personopplysninger behandles.

---

## 3. Hvor opplysningene ligger

| | |
|---|---|
| **Databaseleverandør** | Supabase, PostgreSQL |
| **Fysisk plassering** | EU – Frankfurt, Tyskland |
| **Overføring utenfor EØS** | Ingen i normal drift |
| **Nettsiden** | Statiske filer på GitHub Pages. Inneholder ingen persondata – alt hentes fra databasen etter innlogging |
| **Kryptering** | Kryptert i overføring (HTTPS) og lagret kryptert hos leverandør |
| **Sikkerhetskopi** | Leverandørens automatiske sikkerhetskopiering |

Databehandleravtale med Supabase må inngås av kommunen før systemet tas i bruk.
Det er ikke gjort.

---

## 4. Hvem har tilgang

| Rolle | Tilgang |
|---|---|
| Vaktmester | Registrere utlån og innlevering, vedlikeholde kortbeholdning, lese all historikk |
| Leder | Kun lese oversikt og historikk |
| Administrator | I tillegg gi og fjerne tilgang, samt anonymisere historikk |

Tilgangen er teknisk håndhevet i databasen med *Row Level Security* – regler som
gjelder uavhengig av nettsiden, og som ikke kan omgås ved å manipulere
nettleseren eller ved feil i frontend-koden.

**Kontoer opprettes uten tilgang.** En ny konto ser ingenting før en
administrator uttrykkelig har tildelt den en rolle. Selvregistrering er slått av
i leverandørens innstillinger; kontoer kan kun opprettes av administrator.

Ingen kan endre sin egen rolle. Dette er testet, se punkt 8.

---

## 5. Sporbarhet

Systemet registrerer hvilken innlogget bruker som utførte hvert utlån og hver
innlevering, og logger endringer av kortstatus i en egen tabell som ikke kan
redigeres fra grensesnittet.

Utlånshistorikk kan ikke endres eller gjenåpnes etter innlevering. Sletting av
enkeltrader er teknisk begrenset til administratorrollen, og er ikke tilgjengelig
fra grensesnittet.

---

## 6. Lagringstid

Utlån som er avsluttet anonymiseres etter **24 måneder** – dette er et
utgangspunkt satt av den som bygget systemet, ikke en vurdering kommunen har
gjort. Ved anonymisering fjernes navn, arbeidssted og merknader, mens raden
beholdes slik at kortets brukshistorikk og statistikk består.

Rutinen kjøres manuelt av administrator i dag (`anonymize_old_loans`). Den kan
settes opp som en automatisk jobb når kommunen har bestemt lagringstiden.

Løpende utlån anonymiseres aldri – kortet er fortsatt ute.

---

## 7. Informasjon til de registrerte

Ansatte som låner et kort må få vite at navnet deres registreres, hvorfor, og
hvor lenge det lagres. Forslag til oppslag ved utleveringspunktet:

> **Utlån av nøkkelkort registreres.**
> Vi noterer navn, eventuelt arbeidssted, og tidspunkt for utlån og
> innlevering. Formålet er å vite hvem som til enhver tid har adgangskort til
> kommunale bygg. Opplysningene lagres i [antall] måneder etter innlevering og
> er tilgjengelige for vaktmestertjenesten og ledelsen.
> Spørsmål rettes til [kontaktpunkt].

---

## 8. Hva som er testet

Følgende er verifisert med automatiske tester mot databasen
(`supabase/test/`) og kan kjøres på nytt:

- Samme kort kan ikke være utlånt til to personer samtidig.
- Et kort som er meldt tapt eller er ute av drift kan ikke lånes ut.
- Et utlån som er levert inn kan ikke gjenåpnes eller endres.
- En bruker med lesetilgang kan ikke registrere, endre eller slette noe.
- En bruker kan ikke gi seg selv utvidede rettigheter.
- En konto som ikke er aktivert får ingen data utlevert overhodet.
- Anonymiseringsrutinen fjerner navn og arbeidssted, men beholder historikken.

---

## 9. Kjente begrensninger

Disse er det ærlig å si høyt:

- **Navn skrives inn som fritekst.** Det finnes ingen kobling mot
  personalsystem eller AD. Skrivefeil og navnelikhet forekommer, og systemet
  kan ikke skille to ansatte med samme navn.
- **Systemet er avhengig av at rutinen følges.** Et kort som deles ut uten å
  registreres, er like usporbart som i dag.
- **Sperring skjer ikke automatisk.** Når et kort meldes tapt her, sperres det
  i denne oversikten. Selve kortet må sperres manuelt i nøkkelkortsystemet.
- **Ingen integrasjon mot nøkkelkortsystemet.** De to systemene kan komme ut av
  synk hvis ikke begge oppdateres.
- **Løsningen er bygget og driftes av én person.** Kommunen bør ta stilling til
  hvem som eier og vedlikeholder den over tid.
- **CSV-eksport av historikk inneholder personopplysninger** og må behandles
  som det av den som laster ned filen.

---

## Spørsmål kommunen må ta stilling til

1. **Behandlingsgrunnlag.** Hvilket grunnlag i GDPR artikkel 6 hviler
   behandlingen på?
2. **Lagringstid.** Er 24 måneder riktig, eller skal tallet endres?
3. **Databehandleravtale** med Supabase – hvem inngår den?
4. **Behandlingsprotokoll.** Skal behandlingen føres opp i kommunens protokoll
   etter artikkel 30?
5. **Vurdering av personvernkonsekvenser.** Er en DPIA nødvendig, gitt at
   behandlingen gjelder ansattes adgang til bygg?
6. **Eierskap og drift.** Hvem har ansvaret hvis den som satte opp løsningen
   slutter?
7. **Rutine ved tilgangsendring.** Hvordan sikres det at kontoer stenges samme
   dag en ansatt slutter eller bytter rolle?
8. **Godkjenning av skytjeneste.** Er Supabase akseptabelt etter kommunens
   egne retningslinjer for skytjenester, eller skal databasen ligge på
   kommunens egen infrastruktur?

Inntil disse er avklart bør systemet kun brukes med testdata.
