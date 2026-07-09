# Local Postgres for DB-backed Go tests (cowork sandbox)

A rootless Postgres for running the backend's live-DB integration tests inside the
cowork sandbox. Verified 2026-07-06 running the referral **withdraw** money-path
integration test green.

## 1. Install (rootless)
```bash
pip install --break-system-packages pgserver      # bundles relocatable Postgres 16
PGBIN=$(python3 -c "import pgserver,os;print(os.path.join(os.path.dirname(pgserver.__file__),'pginstall','bin'))")
```
`initdb`/`pg_ctl`/`psql`/`postgres` live in `$PGBIN`.

## 2. Init + start (per bash call — the sandbox kills bg procs at call end, but
`$HOME/pgdata` persists, so just restart each call)
```bash
export PGDATA=$HOME/pgdata PATH=$PGBIN:$PATH
[ -d "$PGDATA/base" ] || initdb -D "$PGDATA" -U postgres --auth=trust
rm -f $PGDATA/postmaster.pid
pg_ctl -D "$PGDATA" -o "-p 5432 -h 127.0.0.1 -k /tmp/pgsock" -l $HOME/pg.log -w start
export DATABASE_URL="postgresql://postgres@127.0.0.1:5432/postgres"
```

## 3. Supabase-compat shim (the 266 migrations assume Supabase)
pgserver is *vanilla* Postgres. Two prerequisites:

**(a) Stub the `pgcrypto` / `uuid-ossp` extensions** (not bundled; `gen_random_uuid()`
is core in PG16). Write control+SQL files into `$PGBIN/../share/postgresql/extension/`:
`pgcrypto.control` (`default_version='1.3'`) + `pgcrypto--1.3.sql` (stub `digest`,
`gen_random_bytes`); `uuid-ossp.control` (`default_version='1.1'`) +
`uuid-ossp--1.1.sql` (`uuid_generate_v4()` → `gen_random_uuid()`). Without these,
`CREATE EXTENSION pgcrypto` aborts every transactional migration.

**(b) Auth shim** (run once):
```sql
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;  -- guard w/ DO/EXCEPTION
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
-- drop the handle_new_user trigger so explicit seeding controls user_profiles:
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tgname FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND NOT tgisinternal
  LOOP EXECUTE format('DROP TRIGGER %I ON auth.users', r.tgname); END LOOP; END $$;
```

## 4. Apply migrations (continue-on-error; everything is `IF NOT EXISTS`)
```bash
for f in $(ls supabase/migrations/*.sql | sort); do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -q -f "$f" 2>>/tmp/mig_err.log; done
```
Superuser bypasses RLS, so RLS policies referencing `auth.uid()` don't block tests.

## 5. Ledger schema/code drift — now fixed by a real migration
Investigation confirmed the base `ledger_accounts` migration is genuinely
incompatible with `internal/finance/ledger` (CHECK `type IN ('wallet')` only,
`user_id NOT NULL`, and `UNIQUE (user_id, type, currency)` — but the code creates
many types, standing accounts with NULL user_id, and upserts `ON CONFLICT
(user_id, type)`). A fresh `db reset` + the ledger code would fail on every
account creation. This is a **real bug**, not just a sandbox artifact.

Fix shipped as **`supabase/migrations/20260912000000_ledger_accounts_reconcile.sql`**
(additive: widen the type CHECK, drop `user_id` NOT NULL, add
`(user_id, type)` unique + a `(type) WHERE user_id IS NULL AND group_id IS NULL`
standing unique that's scoped to not disturb group wallets). **Validated:** with
only that migration's constraints/indexes in place (ad-hoc fixups removed), the
referral withdraw integration test passes (`go test -count=1`). Still needs a
human ledger-auditor pass before merge (money-path constraint change) and a check
that the other ledger consumers reset cleanly.

## 6. Run tests
```bash
source ~/goenv.sh   # Go 1.25 env (see go-toolchain notes)
cd backend
DATABASE_URL="$DATABASE_URL" go test -buildvcs=false -run Integration ./internal/referral/ledger/... -v
```
Result (2026-07-06): `TestWithdrawEligible_Integration` + `TestWithdrawEligible_KYCGate_Integration` → **PASS**.
Proves: eligible→wallet sweep, balanced double-entry (wallet credited == swept),
idempotent replay (no double-credit), fail-closed KYC gate.
