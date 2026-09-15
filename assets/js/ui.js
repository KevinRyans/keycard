// ============================================================================
//  Grensesnitt-hjelpere: formatering, varsler, dialoger.
// ============================================================================

import { APP } from './config.js';

// ---------------------------------------------------------------------------
// Sikker utskrift
//
// Navn og arbeidssted skrives inn av mennesker og settes inn i HTML. Alt
// slikt må escapes, ellers kan et navn inneholde kode som kjører i nettleseren.
// ---------------------------------------------------------------------------
export function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------------------
// Dato og tid (norsk)
// ---------------------------------------------------------------------------

const fmtDato = new Intl.DateTimeFormat('nb-NO', {
  day: '2-digit', month: '2-digit', year: 'numeric',
});
const fmtDatoTid = new Intl.DateTimeFormat('nb-NO', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

export function dato(v) {
  return v ? fmtDato.format(new Date(v)) : '–';
}

export function datoTid(v) {
  return v ? fmtDatoTid.format(new Date(v)) : '–';
}

/** «i dag», «i går», «3 dager», «1 md. 4 dager» */
export function varighet(dager) {
  if (dager === null || dager === undefined) return '–';
  if (dager <= 0) return 'i dag';
  if (dager === 1) return '1 dag';
  if (dager < 31) return `${dager} dager`;
  const md = Math.floor(dager / 30);
  const rest = dager % 30;
  return rest ? `${md} md. ${rest} d.` : `${md} md.`;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const STATUS = {
  tilgjengelig: { tekst: 'Tilgjengelig', klasse: 'ok' },
  utlant:       { tekst: 'Utlånt',       klasse: 'warn' },
  tapt:         { tekst: 'Tapt / sperret', klasse: 'bad' },
  ute_av_drift: { tekst: 'Ute av drift', klasse: 'muted' },
  i_omlop:      { tekst: 'I omløp',      klasse: 'ok' },
};

export function merke(status) {
  const s = STATUS[status] ?? { tekst: status, klasse: 'muted' };
  return `<span class="badge badge--${s.klasse}">${esc(s.tekst)}</span>`;
}

/** Er utlånet så gammelt at det bør følges opp? */
export function erLengeUte(dager) {
  return typeof dager === 'number' && dager >= APP.longLoanWarningDays;
}

// ---------------------------------------------------------------------------
// Varsler
// ---------------------------------------------------------------------------

let varselTimer;

export function varsle(melding, type = 'info') {
  const el = $('#varsel');
  if (!el) return;
  el.className = `varsel varsel--${type} vises`;
  el.textContent = melding;
  clearTimeout(varselTimer);
  varselTimer = setTimeout(() => el.classList.remove('vises'), 6000);
}

export const varsleOk = (m) => varsle(m, 'ok');
export const varsleFeil = (m) => varsle(m, 'feil');

// ---------------------------------------------------------------------------
// Dialog
//
// Returnerer et løfte som resolver med skjemadataene, eller null ved avbrytelse.
// ---------------------------------------------------------------------------

export function dialog({ tittel, innhold, bekreftTekst = 'Lagre', variant = '' }) {
  return new Promise((resolve) => {
    const bak = document.createElement('div');
    bak.className = 'dialog-bak';
    bak.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(tittel)}">
        <div class="dialog__topp">
          <h2>${esc(tittel)}</h2>
          <button type="button" class="ikonknapp" data-lukk aria-label="Lukk">&times;</button>
        </div>
        <form class="dialog__form">
          <div class="dialog__innhold">${innhold}</div>
          <div class="dialog__bunn">
            <button type="button" class="knapp knapp--stille" data-lukk>Avbryt</button>
            <button type="submit" class="knapp ${variant}">${esc(bekreftTekst)}</button>
          </div>
        </form>
      </div>`;

    const lukk = (verdi) => {
      document.removeEventListener('keydown', vedTast);
      bak.remove();
      resolve(verdi);
    };
    const vedTast = (e) => { if (e.key === 'Escape') lukk(null); };

    bak.addEventListener('click', (e) => {
      if (e.target === bak || e.target.closest('[data-lukk]')) lukk(null);
    });
    bak.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      lukk(Object.fromEntries(new FormData(e.target)));
    });
    document.addEventListener('keydown', vedTast);

    document.body.appendChild(bak);
    const forste = bak.querySelector('input, select, textarea, button[type="submit"]');
    forste?.focus();
  });
}

export async function bekreft({ tittel, tekst, bekreftTekst = 'Ja', variant = 'knapp--fare' }) {
  const svar = await dialog({
    tittel,
    innhold: `<p class="dialog__tekst">${esc(tekst)}</p>`,
    bekreftTekst,
    variant,
  });
  return svar !== null;
}

// ---------------------------------------------------------------------------
// Tabell-hjelper
// ---------------------------------------------------------------------------

export function tomTilstand(ikon, tittel, tekst) {
  return `
    <div class="tom">
      <div class="tom__ikon" aria-hidden="true">${ikon}</div>
      <p class="tom__tittel">${esc(tittel)}</p>
      <p class="tom__tekst">${esc(tekst)}</p>
    </div>`;
}

/** Enkel CSV-eksport – brukes på historikk. Semikolon fordi norsk Excel. */
export function lastNedCsv(filnavn, rader) {
  if (!rader.length) return varsleFeil('Ingen rader å eksportere.');
  const kolonner = Object.keys(rader[0]);
  const celle = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const csv =
    '﻿' +
    [kolonner.join(';'), ...rader.map((r) => kolonner.map((k) => celle(r[k])).join(';'))].join('\r\n');

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filnavn;
  a.click();
  URL.revokeObjectURL(url);
}
