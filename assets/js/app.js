// ============================================================================
//  Nøkkelkortsystem – applikasjonslogikk
// ============================================================================

import { APP, isConfigured } from './config.js';
import { auth, minProfil, kort, utlan, feilmelding } from './db.js';
import {
  $, $$, esc, dato, datoTid, varighet, merke, erLengeUte,
  varsle, varsleOk, varsleFeil, dialog, tomTilstand, lastNedCsv,
} from './ui.js';

const state = {
  profil: null,
  oversikt: [],
  visning: 'oversikt',
  valgtKort: null,
  filter: { sok: '', status: '', fra: '', til: '' },
};

const kanSkrive = () => ['admin', 'vaktmester'].includes(state.profil?.role);

// ============================================================================
//  Oppstart
// ============================================================================

async function start() {
  $('#org-navn').textContent = APP.orgName;
  $('#retensjon').textContent = APP.retentionMonths;
  document.title = `${APP.systemName} – ${APP.orgName}`;

  if (!isConfigured()) return visSkjerm('oppsett');

  koblePermanenteLyttere();

  auth.onChange((event) => {
    if (event === 'SIGNED_OUT') {
      state.profil = null;
      visSkjerm('innlogging');
    }
  });

  await avgjorSkjerm();
}

async function avgjorSkjerm() {
  const sesjon = await auth.session();
  if (!sesjon) return visSkjerm('innlogging');

  try {
    state.profil = await minProfil();
  } catch (e) {
    varsleFeil(feilmelding(e));
    return visSkjerm('innlogging');
  }

  // Ny konto er alltid inaktiv. En admin må aktivere den.
  if (!state.profil || !state.profil.active) {
    $('#venter-epost').textContent = sesjon.user.email;
    return visSkjerm('venter');
  }

  visSkjerm('app');
  await klargjorApp();
}

function visSkjerm(navn) {
  for (const el of $$('[data-skjerm]')) el.hidden = el.dataset.skjerm !== navn;
}

// ============================================================================
//  Innlogging
// ============================================================================

function koblePermanenteLyttere() {
  $('#skjema-innlogging').addEventListener('submit', async (e) => {
    e.preventDefault();
    const knapp = $('#knapp-logg-inn');
    const f = new FormData(e.target);
    knapp.disabled = true;
    knapp.textContent = 'Logger inn …';
    try {
      await auth.signIn(f.get('epost'), f.get('passord'));
      await avgjorSkjerm();
    } catch (err) {
      varsleFeil(feilmelding(err));
    } finally {
      knapp.disabled = false;
      knapp.textContent = 'Logg inn';
    }
  });

  $('#lenke-glemt').addEventListener('click', async (e) => {
    e.preventDefault();
    const epost = $('#felt-epost').value.trim();
    if (!epost) return varsleFeil('Skriv inn e-postadressen din først.');
    try {
      await auth.sendPasswordReset(epost);
      varsleOk('Hvis adressen finnes, er det sendt en lenke for nytt passord.');
    } catch (err) {
      varsleFeil(feilmelding(err));
    }
  });

  for (const b of $$('[data-logg-ut]')) {
    b.addEventListener('click', async () => {
      await auth.signOut();
      visSkjerm('innlogging');
    });
  }

  // Navigasjon
  $('#nav').addEventListener('click', (e) => {
    const knapp = e.target.closest('[data-visning]');
    if (knapp) byttVisning(knapp.dataset.visning);
  });

  $('#meny-knapp').addEventListener('click', () => {
    document.body.classList.toggle('meny-apen');
  });

  // Alle handlinger i innholdsområdet fanges opp her
  $('#innhold').addEventListener('click', handterHandling);
}

// ============================================================================
//  Applikasjonen
// ============================================================================

async function klargjorApp() {
  $('#bruker-navn').textContent = state.profil.full_name || 'Innlogget';
  $('#bruker-rolle').textContent =
    { admin: 'Administrator', vaktmester: 'Vaktmester', leder: 'Leser' }[state.profil.role];

  // En leser skal ikke se knapper hen ikke kan bruke.
  document.body.classList.toggle('kun-lesing', !kanSkrive());
  $('[data-visning="nytt-utlan"]').hidden = !kanSkrive();

  await lastData();
  byttVisning('oversikt');
}

async function lastData() {
  try {
    state.oversikt = await kort.oversikt();
  } catch (e) {
    varsleFeil(feilmelding(e));
    state.oversikt = [];
  }
}

function byttVisning(navn) {
  state.visning = navn;
  document.body.classList.remove('meny-apen');
  for (const b of $$('#nav [data-visning]')) {
    b.classList.toggle('aktiv', b.dataset.visning === navn);
    b.setAttribute('aria-current', b.dataset.visning === navn ? 'page' : 'false');
  }
  tegn();
}

async function tegn() {
  const el = $('#innhold');
  el.scrollTop = 0;
  if (state.visning === 'oversikt') el.innerHTML = tegnOversikt();
  else if (state.visning === 'nytt-utlan') el.innerHTML = tegnNyttUtlan();
  else if (state.visning === 'kort') el.innerHTML = tegnKort();
  else if (state.visning === 'historikk') { el.innerHTML = tegnHistorikkRamme(); await lastHistorikk(); }
  etterTegning();
}

function etterTegning() {
  // Skjemaer og felter som trenger egne lyttere etter hver opptegning
  $('#skjema-utlan')?.addEventListener('submit', registrerUtlan);
  $('#kortsok')?.addEventListener('input', (e) => filtrerKortvalg(e.target.value));
  $('#skjema-filter')?.addEventListener('submit', (e) => { e.preventDefault(); lastHistorikk(); });
  $('#knapp-nullstill-filter')?.addEventListener('click', () => {
    state.filter = { sok: '', status: '', fra: '', til: '' };
    tegn();
  });
}

// ============================================================================
//  Visning: Oversikt
// ============================================================================

function tegnOversikt() {
  const t = {
    totalt: state.oversikt.length,
    tilgjengelig: state.oversikt.filter((r) => r.availability === 'tilgjengelig').length,
    utlant: state.oversikt.filter((r) => r.availability === 'utlant').length,
    tapt: state.oversikt.filter((r) => r.availability === 'tapt').length,
    uteAvDrift: state.oversikt.filter((r) => r.availability === 'ute_av_drift').length,
  };

  const ute = state.oversikt
    .filter((r) => r.availability === 'utlant')
    .sort((a, b) => (b.days_out ?? 0) - (a.days_out ?? 0));

  const forfalt = ute.filter((r) => erLengeUte(r.days_out)).length;

  return `
    <header class="side-topp">
      <div>
        <h1>Oversikt</h1>
        <p class="undertittel">Hvem har hvilket kort akkurat nå.</p>
      </div>
      ${kanSkrive() ? `<button class="knapp knapp--primar" data-handling="ga-til-utlan">+ Nytt utlån</button>` : ''}
    </header>

    <div class="tall">
      ${tall('Tilgjengelig', t.tilgjengelig, 'ok')}
      ${tall('Utlånt nå', t.utlant, 'warn')}
      ${tall('Tapt / sperret', t.tapt, 'bad')}
      ${tall('Ute av drift', t.uteAvDrift, 'muted')}
    </div>

    ${forfalt ? `<div class="notis notis--warn">
        <strong>${forfalt} ${forfalt === 1 ? 'kort har' : 'kort har'} vært utlånt i mer enn
        ${APP.longLoanWarningDays} dager.</strong> Verdt å ta en runde på om de fortsatt er i bruk.
      </div>` : ''}

    <section class="kort-panel">
      <h2>Utlånte kort <span class="antall">${ute.length}</span></h2>
      ${ute.length === 0
        ? tomTilstand('🔑', 'Alle kort er inne', 'Ingen lånekort er ute nå.')
        : `<div class="tabell-skall"><table class="tabell tabell--responsiv">
            <thead><tr>
              <th>Kort</th><th>Lånt av</th><th>Arbeidssted</th>
              <th>Utlånt</th><th>Varighet</th><th>Frist</th>
              ${kanSkrive() ? '<th class="h">Handling</th>' : ''}
            </tr></thead>
            <tbody>${ute.map(radUtlant).join('')}</tbody>
          </table></div>`}
    </section>`;
}

function tall(etikett, verdi, klasse) {
  return `<div class="tall__boks tall__boks--${klasse}">
      <span class="tall__verdi">${verdi}</span>
      <span class="tall__etikett">${esc(etikett)}</span>
    </div>`;
}

function radUtlant(r) {
  const sent = erLengeUte(r.days_out);
  const frist = r.expected_return_at;
  const overFrist = frist && new Date(frist) < new Date();
  return `
    <tr${sent ? ' class="rad--advarsel"' : ''}>
      <td data-etikett="Kort"><span class="kortnr">${esc(r.card_number)}</span>
          ${r.label ? `<span class="hint">${esc(r.label)}</span>` : ''}</td>
      <td data-etikett="Lånt av" class="sterk">${esc(r.borrower_name)}</td>
      <td data-etikett="Arbeidssted">${r.borrower_workplace ? esc(r.borrower_workplace) : '<span class="hint">–</span>'}</td>
      <td data-etikett="Utlånt">${datoTid(r.borrowed_at)}</td>
      <td data-etikett="Varighet">${sent ? `<span class="badge badge--warn">${varighet(r.days_out)}</span>` : varighet(r.days_out)}</td>
      <td data-etikett="Frist">${frist ? (overFrist ? `<span class="badge badge--bad">${dato(frist)}</span>` : dato(frist)) : '<span class="hint">–</span>'}</td>
      ${kanSkrive() ? `<td class="h">
        <button class="knapp knapp--liten" data-handling="lever-inn" data-loan="${esc(r.open_loan_id)}"
                data-kort="${esc(r.card_number)}" data-navn="${esc(r.borrower_name)}">Lever inn</button>
      </td>` : ''}
    </tr>`;
}

// ============================================================================
//  Visning: Nytt utlån
// ============================================================================

function tegnNyttUtlan() {
  const ledige = state.oversikt.filter((r) => r.availability === 'tilgjengelig');

  if (!ledige.length) {
    return `
      <header class="side-topp"><div>
        <h1>Nytt utlån</h1>
        <p class="undertittel">Registrer hvem som låner hvilket kort.</p>
      </div></header>
      ${tomTilstand('📦', 'Ingen ledige kort',
        'Alle kort er utlånt, tapt eller ute av drift. Ta imot et kort, eller legg inn nye kort under Kortbeholdning.')}`;
  }

  return `
    <header class="side-topp"><div>
      <h1>Nytt utlån</h1>
      <p class="undertittel">Velg et ledig kort, skriv inn hvem som låner det.</p>
    </div></header>

    <form id="skjema-utlan" class="skjema" autocomplete="off">
      <section class="kort-panel">
        <h2>1. Velg kort <span class="antall">${ledige.length} ledige</span></h2>
        <input type="search" id="kortsok" class="felt" placeholder="Søk på kortnummer eller bygg …"
               aria-label="Søk etter kort">
        <div class="kortvalg" id="kortvalg" role="radiogroup" aria-label="Ledige kort">
          ${ledige.map((k) => `
            <label class="kortbrikke" data-sok="${esc((k.card_number + ' ' + (k.label ?? '')).toLowerCase())}">
              <input type="radio" name="card_id" value="${esc(k.id)}" required>
              <span class="kortbrikke__nr">${esc(k.card_number)}</span>
              <span class="kortbrikke__merke">${esc(k.label ?? 'Uten merking')}</span>
            </label>`).join('')}
        </div>
        <p class="hint" id="ingen-treff" hidden>Ingen ledige kort passer søket.</p>
      </section>

      <section class="kort-panel">
        <h2>2. Hvem låner</h2>
        <div class="rutenett">
          <label class="etikett"><span>Navn på låntaker <span class="pakrevd">*</span></span>
            <input type="text" name="borrower_name" class="felt" required maxlength="120"
                   placeholder="Fornavn Etternavn">
            <span class="hint">Skriv fullt navn. Dette er det som gjør systemet nyttig ved et avvik.</span>
          </label>
          <label class="etikett">Arbeidssted / avdeling
            <input type="text" name="borrower_workplace" class="felt" maxlength="120"
                   placeholder="Valgfritt – f.eks. Teknisk drift">
          </label>
          <label class="etikett">Forventet levert tilbake
            <input type="date" name="expected_return_at" class="felt">
            <span class="hint">Valgfritt. Gir deg en frist å purre på.</span>
          </label>
          <label class="etikett">Merknad
            <input type="text" name="notes" class="felt" maxlength="300"
                   placeholder="Valgfritt – f.eks. årsak til lånet">
          </label>
        </div>
      </section>

      <div class="skjema__bunn">
        <button type="submit" class="knapp knapp--primar knapp--stor">Registrer utlån</button>
        <button type="button" class="knapp knapp--stille" data-handling="avbryt-utlan">Avbryt</button>
      </div>
    </form>`;
}

function filtrerKortvalg(sok) {
  const s = sok.trim().toLowerCase();
  let treff = 0;
  for (const el of $$('#kortvalg .kortbrikke')) {
    const vis = !s || el.dataset.sok.includes(s);
    el.hidden = !vis;
    if (vis) treff++;
  }
  $('#ingen-treff').hidden = treff > 0;
}

async function registrerUtlan(e) {
  e.preventDefault();
  const skjema = e.target;
  const knapp = skjema.querySelector('button[type="submit"]');
  const f = Object.fromEntries(new FormData(skjema));

  if (!f.borrower_name?.trim()) return varsleFeil('Navn på låntaker må fylles ut.');

  knapp.disabled = true;
  knapp.textContent = 'Registrerer …';
  try {
    const k = state.oversikt.find((x) => x.id === f.card_id);
    await utlan.registrer({
      card_id: f.card_id,
      borrower_name: f.borrower_name,
      borrower_workplace: f.borrower_workplace,
      expected_return_at: f.expected_return_at || null,
      notes: f.notes,
    });
    await lastData();
    varsleOk(`Kort ${k?.card_number ?? ''} er registrert utlånt til ${f.borrower_name.trim()}.`);
    byttVisning('oversikt');
  } catch (err) {
    varsleFeil(feilmelding(err));
    // Kortet kan ha blitt tatt av en kollega i mellomtiden – hent friske data.
    await lastData();
  } finally {
    knapp.disabled = false;
    knapp.textContent = 'Registrer utlån';
  }
}

// ============================================================================
//  Visning: Kortbeholdning
// ============================================================================

function tegnKort() {
  return `
    <header class="side-topp">
      <div>
        <h1>Kortbeholdning</h1>
        <p class="undertittel">Alle lånekort og tilstanden deres.</p>
      </div>
      ${kanSkrive() ? `<button class="knapp knapp--primar" data-handling="nytt-kort">+ Nytt kort</button>` : ''}
    </header>

    ${state.oversikt.length === 0
      ? tomTilstand('🗂️', 'Ingen kort registrert',
          kanSkrive() ? 'Legg inn lånekortene deres for å komme i gang.' : 'Ingen kort er lagt inn ennå.')
      : `<div class="tabell-skall"><table class="tabell tabell--responsiv">
          <thead><tr>
            <th>Kort</th><th>Merking</th><th>Status</th><th>Hos</th><th>Merknad</th>
            ${kanSkrive() ? '<th class="h">Handling</th>' : ''}
          </tr></thead>
          <tbody>${state.oversikt.map(radKort).join('')}</tbody>
        </table></div>`}`;
}

function radKort(r) {
  return `
    <tr>
      <td data-etikett="Kort"><span class="kortnr">${esc(r.card_number)}</span></td>
      <td data-etikett="Merking">${r.label ? esc(r.label) : '<span class="hint">–</span>'}</td>
      <td data-etikett="Status">${merke(r.availability)}</td>
      <td data-etikett="Hos">${r.borrower_name
            ? `${esc(r.borrower_name)}<span class="hint">${varighet(r.days_out)}</span>`
            : '<span class="hint">–</span>'}</td>
      <td data-etikett="Merknad">${r.notes ? esc(r.notes) : '<span class="hint">–</span>'}</td>
      ${kanSkrive() ? `<td class="h handlinger">
        <button class="knapp knapp--liten knapp--stille" data-handling="kort-historikk"
                data-id="${esc(r.id)}" data-kort="${esc(r.card_number)}">Historikk</button>
        <button class="knapp knapp--liten knapp--stille" data-handling="kort-status"
                data-id="${esc(r.id)}" data-kort="${esc(r.card_number)}"
                data-status="${esc(r.status)}">Endre</button>
      </td>` : ''}
    </tr>`;
}

// ============================================================================
//  Visning: Historikk
// ============================================================================

function tegnHistorikkRamme() {
  const f = state.filter;
  return `
    <header class="side-topp"><div>
      <h1>Historikk</h1>
      <p class="undertittel">Alle utlån, også de som er levert inn.</p>
    </div></header>

    <form id="skjema-filter" class="filter">
      <label class="etikett">Søk
        <input type="search" name="sok" class="felt" value="${esc(f.sok)}"
               placeholder="Navn, arbeidssted eller kortnummer">
      </label>
      <label class="etikett">Status
        <select name="status" class="felt">
          <option value="">Alle</option>
          <option value="ute"${f.status === 'ute' ? ' selected' : ''}>Ute nå</option>
          <option value="levert"${f.status === 'levert' ? ' selected' : ''}>Levert inn</option>
        </select>
      </label>
      <label class="etikett">Fra dato
        <input type="date" name="fra" class="felt" value="${esc(f.fra)}">
      </label>
      <label class="etikett">Til dato
        <input type="date" name="til" class="felt" value="${esc(f.til)}">
      </label>
      <div class="filter__knapper">
        <button type="submit" class="knapp knapp--primar">Søk</button>
        <button type="button" class="knapp knapp--stille" id="knapp-nullstill-filter">Nullstill</button>
      </div>
    </form>

    <section class="kort-panel">
      <div class="panel-topp">
        <h2>Resultat <span class="antall" id="historikk-antall">…</span></h2>
        <button class="knapp knapp--liten knapp--stille" data-handling="eksporter">Last ned som CSV</button>
      </div>
      <div id="historikk-resultat"><p class="hint">Henter …</p></div>
    </section>`;
}

let sisteHistorikk = [];

async function lastHistorikk() {
  const skjema = $('#skjema-filter');
  if (skjema) {
    const f = Object.fromEntries(new FormData(skjema));
    state.filter = { sok: f.sok ?? '', status: f.status ?? '', fra: f.fra ?? '', til: f.til ?? '' };
  }
  const f = state.filter;

  const mal = $('#historikk-resultat');
  mal.innerHTML = '<p class="hint">Henter …</p>';

  try {
    sisteHistorikk = await utlan.historikk({
      sok: f.sok,
      status: f.status,
      fra: f.fra ? `${f.fra}T00:00:00` : null,
      // «til og med» valgt dato
      til: f.til ? `${f.til}T23:59:59` : null,
    });
  } catch (e) {
    mal.innerHTML = `<p class="hint">${esc(feilmelding(e))}</p>`;
    return;
  }

  $('#historikk-antall').textContent = sisteHistorikk.length;

  if (!sisteHistorikk.length) {
    mal.innerHTML = tomTilstand('🔍', 'Ingen treff', 'Prøv et bredere søk eller nullstill filteret.');
    return;
  }

  mal.innerHTML = `<div class="tabell-skall"><table class="tabell tabell--responsiv">
      <thead><tr>
        <th>Kort</th><th>Lånt av</th><th>Arbeidssted</th>
        <th>Utlånt</th><th>Innlevert</th><th>Varighet</th><th>Registrert av</th>
      </tr></thead>
      <tbody>${sisteHistorikk.map(radHistorikk).join('')}</tbody>
    </table></div>
    ${sisteHistorikk.length >= 500
      ? '<p class="hint">Viser de 500 nyeste treffene. Snevre inn søket for å se eldre utlån.</p>' : ''}`;
}

function radHistorikk(r) {
  const apen = !r.returned_at;
  const tapt = r.return_condition === 'tapt';
  return `
    <tr${apen ? ' class="rad--apen"' : ''}>
      <td data-etikett="Kort"><span class="kortnr">${esc(r.card_number)}</span></td>
      <td data-etikett="Lånt av" class="sterk">${r.anonymized_at
          ? '<span class="hint">Anonymisert</span>' : esc(r.borrower_name)}</td>
      <td data-etikett="Arbeidssted">${r.borrower_workplace ? esc(r.borrower_workplace) : '<span class="hint">–</span>'}</td>
      <td data-etikett="Utlånt">${datoTid(r.borrowed_at)}</td>
      <td data-etikett="Innlevert">${apen
          ? '<span class="badge badge--warn">Ute nå</span>'
          : tapt
            ? `<span class="badge badge--bad">Meldt tapt ${dato(r.returned_at)}</span>`
            : datoTid(r.returned_at)}</td>
      <td data-etikett="Varighet">${varighet(r.duration_days)}</td>
      <td data-etikett="Registrert av">${r.issued_by_name ? esc(r.issued_by_name) : '<span class="hint">–</span>'}</td>
    </tr>`;
}

// ============================================================================
//  Handlinger
// ============================================================================

async function handterHandling(e) {
  const knapp = e.target.closest('[data-handling]');
  if (!knapp) return;
  const h = knapp.dataset.handling;

  if (h === 'ga-til-utlan') return byttVisning('nytt-utlan');
  if (h === 'avbryt-utlan') return byttVisning('oversikt');
  if (h === 'lever-inn') return leverInn(knapp.dataset);
  if (h === 'nytt-kort') return nyttKort();
  if (h === 'kort-status') return endreKortstatus(knapp.dataset);
  if (h === 'kort-historikk') return visKortHistorikk(knapp.dataset);
  if (h === 'eksporter') return eksporter();
}

async function leverInn({ loan, kort: kortnr, navn }) {
  const svar = await dialog({
    tittel: `Lever inn kort ${kortnr}`,
    bekreftTekst: 'Registrer innlevering',
    innhold: `
      <p class="dialog__tekst">Utlånt til <strong>${esc(navn)}</strong>.</p>
      <fieldset class="valg">
        <legend>Hva skjedde med kortet?</legend>
        <label class="valg__rad">
          <input type="radio" name="tilstand" value="levert" checked>
          <span><strong>Levert tilbake</strong><br>
          <span class="hint">Kortet er fysisk tilbake og blir ledig igjen.</span></span>
        </label>
        <label class="valg__rad">
          <input type="radio" name="tilstand" value="tapt">
          <span><strong>Meldt tapt</strong><br>
          <span class="hint">Kortet sperres og kan ikke lånes ut igjen. Husk å sperre det i
          selve nøkkelkortsystemet også.</span></span>
        </label>
      </fieldset>
      <label class="etikett">Merknad
        <input type="text" name="notat" class="felt" maxlength="300" placeholder="Valgfritt">
      </label>`,
  });
  if (!svar) return;

  try {
    await utlan.leverInn(loan, svar.tilstand, svar.notat);
    await lastData();
    varsleOk(
      svar.tilstand === 'tapt'
        ? `Kort ${kortnr} er registrert tapt og sperret.`
        : `Kort ${kortnr} er registrert innlevert.`
    );
    tegn();
  } catch (err) {
    varsleFeil(feilmelding(err));
    await lastData();
    tegn();
  }
}

async function nyttKort() {
  const svar = await dialog({
    tittel: 'Nytt lånekort',
    bekreftTekst: 'Legg til',
    innhold: `
      <label class="etikett"><span>Kortnummer <span class="pakrevd">*</span></span>
        <input type="text" name="card_number" class="felt" required maxlength="60"
               placeholder="f.eks. L-011">
        <span class="hint">Bruk nøyaktig samme nummer som står på kortet og i nøkkelkortsystemet.</span>
      </label>
      <label class="etikett">Merking
        <input type="text" name="label" class="felt" maxlength="120"
               placeholder="Valgfritt – f.eks. Rådhuset, generell adgang">
      </label>
      <label class="etikett">Merknad
        <input type="text" name="notes" class="felt" maxlength="300" placeholder="Valgfritt">
      </label>`,
  });
  if (!svar) return;

  try {
    await kort.opprett(svar);
    await lastData();
    varsleOk(`Kort ${svar.card_number.trim()} er lagt til.`);
    tegn();
  } catch (err) {
    varsleFeil(feilmelding(err));
  }
}

async function endreKortstatus({ id, kort: kortnr, status }) {
  const rad = state.oversikt.find((r) => r.id === id);
  const erUtlant = rad?.availability === 'utlant';

  const svar = await dialog({
    tittel: `Kort ${kortnr}`,
    bekreftTekst: 'Lagre',
    innhold: `
      ${erUtlant ? `<div class="notis notis--warn">Kortet er utlånt til
        <strong>${esc(rad.borrower_name)}</strong>. Sperrer du det nå, blir utlånet
        stående åpent til du registrerer innlevering.</div>` : ''}
      <fieldset class="valg">
        <legend>Status</legend>
        <label class="valg__rad"><input type="radio" name="status" value="i_omlop"${status === 'i_omlop' ? ' checked' : ''}>
          <span><strong>I omløp</strong><br><span class="hint">Kortet er i bruk og kan lånes ut.</span></span></label>
        <label class="valg__rad"><input type="radio" name="status" value="tapt"${status === 'tapt' ? ' checked' : ''}>
          <span><strong>Tapt / sperret</strong><br><span class="hint">Kan ikke lånes ut. Sperr det i nøkkelkortsystemet også.</span></span></label>
        <label class="valg__rad"><input type="radio" name="status" value="ute_av_drift"${status === 'ute_av_drift' ? ' checked' : ''}>
          <span><strong>Ute av drift</strong><br><span class="hint">Defekt eller til reparasjon.</span></span></label>
      </fieldset>
      <label class="etikett">Merknad
        <input type="text" name="notes" class="felt" maxlength="300"
               value="${esc(rad?.notes ?? '')}" placeholder="Valgfritt">
      </label>`,
  });
  if (!svar) return;

  try {
    await kort.settStatus(id, svar.status, svar.notes);
    await lastData();
    varsleOk(`Kort ${kortnr} er oppdatert.`);
    tegn();
  } catch (err) {
    varsleFeil(feilmelding(err));
  }
}

async function visKortHistorikk({ id, kort: kortnr }) {
  let rader = [];
  try {
    rader = await kort.historikk(id);
  } catch (err) {
    return varsleFeil(feilmelding(err));
  }

  await dialog({
    tittel: `Historikk for kort ${kortnr}`,
    bekreftTekst: 'Lukk',
    innhold: rader.length === 0
      ? '<p class="dialog__tekst">Dette kortet har aldri vært utlånt.</p>'
      : `<div class="tabell-skall"><table class="tabell tabell--tett">
          <thead><tr><th>Lånt av</th><th>Fra</th><th>Til</th><th>Varighet</th></tr></thead>
          <tbody>${rader.map((r) => `<tr>
            <td class="sterk">${r.anonymized_at ? '<span class="hint">Anonymisert</span>' : esc(r.borrower_name)}
              ${r.borrower_workplace ? `<span class="hint">${esc(r.borrower_workplace)}</span>` : ''}</td>
            <td>${datoTid(r.borrowed_at)}</td>
            <td>${r.returned_at ? datoTid(r.returned_at) : '<span class="badge badge--warn">Ute nå</span>'}</td>
            <td>${varighet(r.duration_days)}</td></tr>`).join('')}</tbody>
        </table></div>`,
  });
}

function eksporter() {
  if (!sisteHistorikk.length) return varsleFeil('Ingen rader å eksportere.');

  // Eksporten inneholder personopplysninger. Den skal behandles deretter.
  const rader = sisteHistorikk.map((r) => ({
    Kortnummer: r.card_number,
    Merking: r.card_label ?? '',
    Laant_av: r.anonymized_at ? 'Anonymisert' : r.borrower_name,
    Arbeidssted: r.borrower_workplace ?? '',
    Utlaant: r.borrowed_at ? new Date(r.borrowed_at).toLocaleString('nb-NO') : '',
    Innlevert: r.returned_at ? new Date(r.returned_at).toLocaleString('nb-NO') : '',
    Tilstand: r.return_condition ?? 'ute',
    Varighet_dager: r.duration_days ?? '',
    Registrert_av: r.issued_by_name ?? '',
    Mottatt_av: r.returned_by_name ?? '',
  }));

  const stempel = new Date().toISOString().slice(0, 10);
  lastNedCsv(`nokkelkort-historikk-${stempel}.csv`, rader);
  varsle('Filen inneholder personopplysninger. Lagre den på kommunens område, ikke lokalt.', 'info');
}

// ---------------------------------------------------------------------------

start().catch((e) => {
  console.error(e);
  varsleFeil(feilmelding(e));
});
