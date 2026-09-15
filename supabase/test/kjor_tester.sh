#!/usr/bin/env bash
# ============================================================================
#  Kjører tilgangs- og forretningsreglene mot en lokal Postgres.
#
#  Testene bekrefter blant annet at:
#    * samme kort ikke kan lånes ut til to personer samtidig
#    * et sperret kort ikke kan lånes ut
#    * et innlevert utlån ikke kan gjenåpnes
#    * en leser ikke kan skrive, og ikke kan gjøre seg selv til admin
#    * en konto som ikke er aktivert ikke ser noe som helst
#
#  Bruk:  ./supabase/test/kjor_tester.sh
#  Krever: postgresql-16 (server + psql) installert lokalt.
#
#  Merk: dette tester SQL-en, ikke Supabase. auth-skjemaet er etterlignet
#  av 00_supabase_stub.sql.
# ============================================================================
set -euo pipefail

HER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROT="$(cd "$HER/../.." && pwd)"

PGPORT="${PGPORT:-55432}"
PGHOST="${PGHOST:-/tmp}"
DB="${DB:-keycard_test}"

psql -h "$PGHOST" -p "$PGPORT" -d postgres -q \
  -c "drop database if exists $DB" -c "create database $DB"

for f in "$HER/00_supabase_stub.sql" \
         "$ROT/supabase/01_schema.sql" \
         "$ROT/supabase/02_policies.sql"; do
  echo ">> $(basename "$f")"
  psql -h "$PGHOST" -p "$PGPORT" -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1 \
    | grep -i 'error' && exit 1 || true
done

echo ">> test.sql"
psql -h "$PGHOST" -p "$PGPORT" -d "$DB" --single-transaction -v ON_ERROR_STOP=1 -f "$HER/test.sql"
