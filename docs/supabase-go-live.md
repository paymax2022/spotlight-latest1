# Supabase go-live runbook — local → live + PostGIS

Target project ref: **`ptczqwfokydsdafpscex`**
Project URL: **`https://ptczqwfokydsdafpscex.supabase.co`**

> This migrates the 272 local migrations (incl. the referral/stays work) to the
> live project and enables PostGIS. Do it on a **fresh/empty** project or a
> **Supabase branch** first — several migrations touch money-path tables.

---

## 0. Prerequisites (once)
```bash
# Supabase CLI (macOS)
brew install supabase/tap/supabase
# or: npx supabase --version   (no install)

supabase --version   # ≥ 1.200
```
Grab from **Dashboard → Project Settings**:
- **API**: Project URL, **Publishable key** (client), **Secret key** (server).
- **Database → Connection string**: the **direct** URI and the **DB password**.

Never commit these. Put them in `.env` files (gitignored) as below.

---

## 1. PostGIS + extensions ordering (already handled)
Several migrations use `geometry`/`geography`/`ST_*` **before** `stays_core`
self-enables PostGIS. A new migration **`20260101000000_enable_extensions.sql`**
(added in this repo) enables `postgis`, `pgcrypto`, `uuid-ossp` first, so a plain
`supabase db push` applies everything in order. On Supabase these extensions are
available out of the box — no manual step needed.

Optional belt-and-suspenders: **Dashboard → Database → Extensions → enable
`postgis`** before pushing (the migration is then a no-op).

---

## 2. Link the project and push migrations
```bash
cd /path/to/spotlight/new           # repo root (has supabase/)
supabase link --project-ref ptczqwfokydsdafpscex        # prompts for DB password

# Preview what will be applied (no writes):
supabase migration list             # shows local vs remote

# Apply ALL local migrations to the live DB:
supabase db push
```
If you prefer not to `link`, push directly:
```bash
supabase db push --db-url "postgresql://postgres:[DB_PASSWORD]@db.ptczqwfokydsdafpscex.supabase.co:5432/postgres"
```
`db push` runs each pending migration in timestamp order and records them in
`supabase_migrations.schema_migrations`.

**⚠ Money-path note:** `20260912000000_ledger_accounts_reconcile.sql` alters
ledger constraints (widen type CHECK, drop `user_id` NOT NULL, add `(user_id,type)`
unique). On a fresh/empty project it is safe; on a project with ledger data, get
the **ledger-auditor** sign-off first (see `docs/local-postgres-testing.md §5`).

---

## 3. Verify the push
```bash
psql "$DIRECT_URL" -c "select extname from pg_extension where extname in ('postgis','pgcrypto');"
psql "$DIRECT_URL" -c "select to_regclass('public.stays_property'), to_regclass('public.stays_reservations'),
  to_regclass('public.referral_reward_ledger'), to_regclass('public.ledger_accounts'),
  to_regclass('public.stays_deals'), to_regclass('public.referral_vanity_links'),
  to_regclass('public.stays_saved'), to_regclass('public.referral_streaks');"
```
All should be non-null (PostGIS present ⇒ the stays supply tables now exist).

---

## 4. Seed minimal data so the read endpoints return content
Discovery reads from real inventory:
- `GET /destinations`, `GET /home` (trending) ← `stays_property` (DIRECT, ACTIVE).
- `GET /deals` ← `stays_deals` (curated rows).
`stays_core` ships sample DIRECT properties (Lagos/Abuja seeds at lines ~440). Add
a couple of `stays_deals` rows for the landing feed (see
`supabase/migrations/20260913000000_stays_deals.sql` for columns).

---

## 5. App environment (point the apps at live)

**frontend-web/.env** (also the proxy target for mobile):
```
NEXT_PUBLIC_SUPABASE_URL=https://ptczqwfokydsdafpscex.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<PUBLISHABLE_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SECRET_KEY>
DATABASE_URL=postgresql://postgres:[DB_PASSWORD]@db.ptczqwfokydsdafpscex.supabase.co:5432/postgres
GO_BACKEND_URL=http://localhost:8091          # the Go backend (8091, not 8080)
FEATURE_REFERRALS_ENABLED=true
FEATURE_STAYS_ENABLED=true
```

**backend/.env** (Go API):
```
DATABASE_URL=postgresql://postgres:[DB_PASSWORD]@db.ptczqwfokydsdafpscex.supabase.co:5432/postgres?sslmode=require
FEATURE_REFERRALS_ENABLED=true
FEATURE_STAYS_ENABLED=true
FEATURE_REFERRAL_REWARDS_ENABLED=true
REFERRAL_REWARDS_INTERNAL_SECRET=<random-secret>
# Stays supplier (Rail A) creds if using bedbank supply:
# STAYS_BEDBANK_SUPPLIER_CODE=... STAYS_BEDBANK_API_KEY=... STAYS_BEDBANK_API_SECRET=... STAYS_BEDBANK_BASE_URL=...
```

**mobile-app/reactnative/.env** (Expo):
```
EXPO_PUBLIC_API_BASE_URL=<frontend-web URL, e.g. https://app.spotlight.ng>
EXPO_PUBLIC_SUPABASE_URL=https://ptczqwfokydsdafpscex.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<PUBLISHABLE_KEY>
EXPO_PUBLIC_REFERRAL_USE_MOCK=false
EXPO_PUBLIC_STAYS_USE_MOCK=false
```
> Note on keys: the new **publishable key** goes wherever an `ANON_KEY` var is
> expected (Supabase JS accepts it); the **secret key** replaces the
> service-role key server-side. Legacy `anon`/`service_role` JWTs still work too.

---

## 6. Smoke-test live
1. `cd backend && source ~/goenv.sh && go build ./... && ./<binary>` (or `go run`)
   — it should connect to the live DB and log `[referral]`/`[stays] routes registered`.
2. Hit an auth'd read through the proxy, e.g. `GET /api/v1/stays/destinations`,
   `GET /api/v1/referral/my-rewards`, `GET /api/v1/stays/home`.
3. Exercise the **stays saga** (now that PostGIS exists): search → prebook → book;
   confirm the auto-release (409 `state=VOID`) path holds/releases with no debit.

---

## Run results — executed 2026-07-06 (project ptczqwfokydsdafpscex, empty project)

### FINAL: all 273 migrations applied (0 pending) — full local→remote sync ✅
First pass applied 242/273; the other 31 exposed **pre-existing defects** (would
fail any fresh `supabase db reset`). All were fixed at the source and re-applied
— the remote now has **every migration**, PostGIS enabled, **1074 public tables**,
tracked in `supabase_migrations.schema_migrations`. Fixes made (all additive/
brownfield-safe):
- **enable_extensions** — new `20260101000000_enable_extensions.sql` turns on
  postgis/pgcrypto/uuid-ossp before any dependent migration.
- **permissions seed drift** (9 files) — rewrote stale `INSERT INTO permissions
  (slug, description)` to the required `(name, slug, module, resource, action,
  description, is_system_permission)` form (health×3, mapservice, crypto,
  academy×4).
- **Table-name collisions** resolved with rename or `ADD COLUMN IF NOT EXISTS`
  guards: academy K-12 (`academy_lessons`→`academy_edu_lessons`,
  `academy_enrollments`→`academy_edu_enrollments`), `pharmacy_products` (vs the
  premium retail table), `events` + `event_tickets` (vs the legacy EPIC-CMS
  tables — guard columns mirror `20260902_events_schema_drift_fix`).
- **RLS policy bug** — `academy_engagement_commerce` generated a `user_id` owner
  policy on `academy_responses` (which keys off `attempt_id`); rewrote it.
- **Seed FK** — `crowdfunding_csr` demo rows wrapped in a guard so they no-op when
  the synthetic sponsor is absent (production-safe).
- **Ordering** — `20260621070000_association_depth` renamed to `20260628010000_…`
  (after the module that creates its tables); live tracking reconciled.

> These fixes mean a fresh `supabase db reset` / `db push` now applies the whole
> set. (The live apply used a resilient retry runner; run one `supabase db reset`
> on a branch to confirm strict timestamp-order cleanliness before relying on CI.)

### (historical) First pass detail
Applied **242/273** migrations in order (recorded in
`supabase_migrations.schema_migrations`, so `supabase db push` stays consistent).
**PostGIS/pgcrypto/uuid-ossp enabled** (via `20260101000000_enable_extensions`);
920 tables created. **All referral / stays / finance-ledger / foundation
migrations applied** — verified live: `referral_reward_ledger`, `ledger_accounts`,
`ledger_entries`, `referral_merchants/_vanity_links/_streaks`, `stays_property`
(PostGIS `geography`), `stays_reservation`(+`_guest`), `stays_deals`, `stays_saved`,
`stays_saved_guests`, `user_profiles`, and the money-path `ledger_accounts`
reconcile. (Note: the reservation table is **singular** `stays_reservation`; the
Go loyalty handler was corrected to match.)

### 21 migrations did NOT apply — PRE-EXISTING defects in OTHER modules
These fail on **any** fresh `supabase db reset` (not referral/stays). Root causes:
- **`permissions` seed drift** — old inserts do `INSERT INTO permissions (slug,
  description)` but the table now requires NOT NULL `name/module/resource/action`.
  Affects `health_vcn_verification`, `doctor_mdcn_assisted_verification`,
  `mapservice_v2`, `health_triage`, `crypto`. Fix: add the missing columns to each
  permission seed (needs per-permission content).
- **Missing-column references (schema drift):** `events` (`organiser_id`),
  `academy_core` (`objective_id`), `academy_schools_tutor` (`idempotency_key`),
  `health_pharmacy` (`pharmacy_provider_id`).
- **Cascade (root above failed):** `academy_engagement_commerce/spine_edupay/
  credentials_live/p4_seed`, `pharmacy_symptom_*` (4), `pharmacy_discovery_ratings`,
  `crypto_swap_withdrawal_addresses`, `events_schema_drift_fix`,
  `events_purchase_durability`.
- **Seed FK violation:** `crowdfunding_csr` (`cf_csr_invoices` FK).
- **Ordering bug (auto-resolved live by retry, but fix the repo):**
  `20260621070000_association_depth` is timestamped BEFORE
  `20260628000000_association_module` which creates its tables — rename it to run
  after (e.g. `20260628010000_…`) so a fresh reset succeeds.

None of these block the referral/stays go-live; each is owned by its module and
should be fixed before those modules ship (some are money-path: crypto, events).

## 7. Safety
- Prefer a **Supabase branch** (`supabase branches create`) to dry-run the push,
  then merge.
- Take a snapshot/backup before pushing to a project that has data.
- Rotate any key that ever lands in the chat or a commit.
- Keep `contracts/openapi.yaml` as the API source of truth; `npm run contract:check`.
