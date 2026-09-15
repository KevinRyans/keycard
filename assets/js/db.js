// ============================================================================
//  Datalag – all kontakt med databasen går gjennom denne filen.
//
//  Ingen av funksjonene her er sikkerhetskontroller. Rollesjekkene i
//  grensesnittet skjuler knapper, men det er tilgangsreglene i databasen
//  som faktisk stopper en uautorisert forespørsel.
// ============================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Oversetter databasefeil til noe en vaktmester kan forstå. */
export function feilmelding(error) {
  if (!error) return 'Ukjent feil.';
  const m = String(error.message || error);

  if (m.includes('loans_one_open_per_card'))
    return 'Kortet er allerede utlånt. Oppdater siden og prøv igjen.';
  if (m.includes('cards_card_number_key'))
    return 'Det finnes allerede et kort med dette nummeret.';
  if (m.includes('kan ikke lånes ut'))
    return 'Kortet er sperret eller ute av drift og kan ikke lånes ut.';
  if (m.includes('gjenåpnes'))
    return 'Et utlån som er levert inn kan ikke gjenåpnes.';
  if (m.includes('Invalid login credentials'))
    return 'Feil e-post eller passord.';
  if (m.includes('Email not confirmed'))
    return 'E-postadressen er ikke bekreftet ennå.';
  if (m.toLowerCase().includes('failed to fetch'))
    return 'Får ikke kontakt med databasen. Sjekk nettforbindelsen.';
  if (m.includes('violates row-level security') || m.includes('permission denied'))
    return 'Du har ikke tilgang til å gjøre dette.';
  return m;
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Innlogging
// ---------------------------------------------------------------------------

export const auth = {
  async session() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  async signIn(email, password) {
    return unwrap(
      await supabase.auth.signInWithPassword({ email: email.trim(), password })
    );
  },

  async signOut() {
    await supabase.auth.signOut();
  },

  async sendPasswordReset(email) {
    return unwrap(
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin + window.location.pathname,
      })
    );
  },

  async updatePassword(password) {
    return unwrap(await supabase.auth.updateUser({ password }));
  },

  onChange(fn) {
    return supabase.auth.onAuthStateChange(fn);
  },
};

/** Profilen til den innloggede brukeren – rolle og om kontoen er aktivert. */
export async function minProfil() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, active')
    .eq('id', (await auth.session())?.user?.id ?? '')
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Kort
// ---------------------------------------------------------------------------

export const kort = {
  /** Alle kort med utledet tilgjengelighet og eventuelt åpent utlån. */
  async oversikt() {
    return unwrap(
      await supabase
        .from('v_cards_overview')
        .select('*')
        .order('card_number', { ascending: true })
    );
  },

  async tilgjengelige() {
    return unwrap(
      await supabase
        .from('v_cards_overview')
        .select('*')
        .eq('availability', 'tilgjengelig')
        .order('card_number', { ascending: true })
    );
  },

  async opprett({ card_number, label, notes }) {
    return unwrap(
      await supabase
        .from('cards')
        .insert({
          card_number: card_number.trim(),
          label: label?.trim() || null,
          notes: notes?.trim() || null,
        })
        .select()
        .single()
    );
  },

  async settStatus(id, status, notes) {
    const patch = { status };
    if (notes !== undefined) patch.notes = notes?.trim() || null;
    return unwrap(
      await supabase.from('cards').update(patch).eq('id', id).select().single()
    );
  },

  async oppdater(id, { label, notes }) {
    return unwrap(
      await supabase
        .from('cards')
        .update({ label: label?.trim() || null, notes: notes?.trim() || null })
        .eq('id', id)
        .select()
        .single()
    );
  },

  async historikk(cardId) {
    return unwrap(
      await supabase
        .from('v_loans_full')
        .select('*')
        .eq('card_id', cardId)
        .order('borrowed_at', { ascending: false })
    );
  },
};

// ---------------------------------------------------------------------------
// Utlån
// ---------------------------------------------------------------------------

export const utlan = {
  /** Registrerer et nytt utlån. Databasen avviser kort som ikke er ledige. */
  async registrer({ card_id, borrower_name, borrower_workplace, purpose, expected_return_at, notes }) {
    return unwrap(
      await supabase
        .from('loans')
        .insert({
          card_id,
          borrower_name: borrower_name.trim(),
          borrower_workplace: borrower_workplace?.trim() || null,
          purpose: purpose?.trim() || null,
          expected_return_at: expected_return_at || null,
          notes: notes?.trim() || null,
        })
        .select()
        .single()
    );
  },

  /** Lukker et utlån. condition er 'levert' eller 'tapt'. */
  async leverInn(loanId, condition = 'levert', note) {
    const patch = {
      returned_at: new Date().toISOString(),
      return_condition: condition,
    };
    if (note?.trim()) patch.notes = note.trim();
    return unwrap(
      await supabase
        .from('loans')
        .update(patch)
        .eq('id', loanId)
        .is('returned_at', null) // hindrer dobbel innlevering
        .select()
        .single()
    );
  },

  async aktive() {
    return unwrap(
      await supabase
        .from('v_loans_full')
        .select('*')
        .is('returned_at', null)
        .order('borrowed_at', { ascending: true })
    );
  },

  /**
   * Historikk med filtrering.
   * @param {{sok?:string, cardId?:string, fra?:string, til?:string, status?:string, limit?:number}} f
   */
  async historikk(f = {}) {
    let q = supabase.from('v_loans_full').select('*');

    if (f.sok?.trim()) {
      const s = `%${f.sok.trim()}%`;
      q = q.or(
        `borrower_name.ilike.${s},borrower_workplace.ilike.${s},card_number.ilike.${s}`
      );
    }
    if (f.cardId) q = q.eq('card_id', f.cardId);
    if (f.fra) q = q.gte('borrowed_at', f.fra);
    if (f.til) q = q.lte('borrowed_at', f.til);
    if (f.status === 'ute') q = q.is('returned_at', null);
    if (f.status === 'levert') q = q.not('returned_at', 'is', null);

    return unwrap(
      await q.order('borrowed_at', { ascending: false }).limit(f.limit ?? 500)
    );
  },
};

// ---------------------------------------------------------------------------
// Nøkkeltall til forsiden
// ---------------------------------------------------------------------------

export async function nokkeltall(oversikt) {
  const rader = oversikt ?? (await kort.oversikt());
  return {
    totalt: rader.length,
    tilgjengelig: rader.filter((r) => r.availability === 'tilgjengelig').length,
    utlant: rader.filter((r) => r.availability === 'utlant').length,
    tapt: rader.filter((r) => r.availability === 'tapt').length,
    uteAvDrift: rader.filter((r) => r.availability === 'ute_av_drift').length,
  };
}
