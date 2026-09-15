// ============================================================================
//  Oppsett
//
//  Fyll inn de to verdiene under fra Supabase:
//    Project Settings -> API -> Project URL og anon public key
//
//  MERK: "anon public"-nøkkelen er ment å være offentlig. Den er ikke et
//  passord. Sikkerheten ligger i tilgangsreglene i databasen
//  (supabase/02_policies.sql). Bruk ALDRI "service_role"-nøkkelen her –
//  den omgår alle sikkerhetsregler og skal aldri forlate Supabase.
// ============================================================================

export const SUPABASE_URL = 'https://cnlinyavjdhsipbovtbf.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubGlueWF2amRoc2lwYm92dGJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NTY5NDIsImV4cCI6MjEwNTAzMjk0Mn0.Vv-IznWQXWqmpDPR9Z5PPM2Q33hspoFRbqZ5qK9Ayx4';

export const APP = {
  // Vises i toppen av appen
  orgName: 'Kommunen',
  systemName: 'Nøkkelkort',

  // Et utlån som har vart lenger enn dette markeres som «lenge ute».
  // Det er ikke en feil – det er en påminnelse om å følge opp.
  longLoanWarningDays: 30,

  // Vises i personvernteksten i appen. Skal stemme med det kommunen
  // faktisk har bestemt, og med rutinen i supabase/03_admin_og_testdata.sql.
  retentionMonths: 24,
};

export function isConfigured() {
  return (
    SUPABASE_URL.startsWith('http') &&
    SUPABASE_ANON_KEY.length > 40 &&
    !SUPABASE_ANON_KEY.startsWith('SETT_INN')
  );
}
