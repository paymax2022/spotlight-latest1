# Film Academy — production migration set (review package)

**Status:** fault 2 **APPLIED to production 2026-11-11** (scoped lane, run
42983104867 — verified in §5) · fault 1 **root-caused, awaiting an operator on
the host** (§1.1) · **Prepared:** 2026-11-11
**Owner:** DevOps/DBA · **Scope:** the four academy migrations the public Film
Academy catalogue and its application pricing depend on and that **were absent
from production**.

> This is a *subset* review package, not a reconciliation of the whole pending
> backlog. Execute it with the staged flow in
> [`cloud-migration-reconciliation-runbook.md`](cloud-migration-reconciliation-runbook.md)
> — **staging first → validate → prod**, one migration at a time.

---

## 1. Why this set exists

`https://www.spotlightng.com/service-details/film-academy` renders its
`#areas` section and all tuition from live rows, per request
(`frontend-web/app/service-details/film-academy/page.tsx`, `dynamic =
'force-dynamic'`). It currently shows the degraded branch.

Two independent faults were found on 2026-11-11:

1. **Host runtime Supabase access is broken** — every server-side admin-client
   read on `spotlightng.com` fails (`/api/v1/contests/categories` 500s on a
   single `select` from `contests`, which exists and returns rows to the
   project's publishable key). This is an environment fault, **not** a
   migration, and it must be fixed first: applying this set while it persists
   changes nothing a visitor can see.
2. **Production schema is missing the composite-pricing chain** — verified by
   probing the prod project directly (see §3). This document covers fault 2.

### 1.1 Fault 1 remediation (host access required) — ROOT CAUSE FOUND 2026-11-11

The project itself is healthy and reachable: the publishable key in the page's
own bundle reads `academy_batches` (200 + real rows) and
`academy_area_pricing_options` (200, `[]` to the publishable key because RLS
denies it — the admin client sees the 40 seeded rows) from the internet. Only
the **server-side** path fails, so this was never a schema, RLS or code defect.

**It is the host's app environment, and it points at a retired project.** The
`Probe prod Supabase runtime env (read-only)` step of
`deploy-cpanel.yml` in the shipping repo (`paymax2022/spotlight-latest`) ran on
the box during run **42924134372** (2026-11-10T23:32Z) and measured:

| where the value lives | URL | service key |
|---|---|---|
| **app process env** — wins | `ptczqwfokydsdafpscex` (retired 2026, see [`docs/supabase-go-live.md`](../supabase-go-live.md)) | len 219, legacy JWT |
| `.env.production.local` on the host | `nmseefdlliejmdbxytej` ✓ | len 41, `sb_secret_…` ✓ |
| CI repo vars → the shipped bundle | `nmseefdlliejmdbxytej` ✓ | (never baked) |

`@next/env` refuses to overwrite a key already in `process.env`, so the correct
file — which Finalize rewrites from the reviewed vars on **every** deploy —
loses, and the correct build loses with it. The stale trio is *not* dead
either: the same probe read `academy_batches` and `academy_settings` as rows
against `ptcz…` with those keys, and got `PGRST205` for the three pricing
tables. That is exactly what `ptcz…` should contain — the 2026-07-06 push of
273 migrations went to **that** project, not prod
([`docs/e2e/results/prod-schema-drift-2026-10-05.md`](../e2e/results/prod-schema-drift-2026-10-05.md)),
so it is an unrelated July snapshot, **not** a copy or backup of production.
The server is sending those retired credentials, which is why all four catalogue
reads, `/api/v1/contests` and `GET /api/academy/apply` fail together.

**Where it is injected:** the app process is spawned by the web server (ppid 1,
`lsnode:/home/specenpo/public_html/spotlightng_v2/frontend-web/`), not by the
SSH session or a shell profile (`none` of `.bashrc`/`.profile`/`.bash_profile`
name these vars), and the only config-shaped file under `$HOME` naming the
retired ref is `~/.cl.selector/node-selector.json` — cPanel's **Setup Node.js
App** definition. The `.htaccess` Passenger block holds only `PassengerAppRoot`
/`BaseURI`/`Nodejs`/`AppType`/`StartupFile`, no env, so there is nothing to
edit there and **no restart or redeploy can clear the injected values.**

Steps, in order:

1. Confirm before changing anything (values stay masked; a `219`-char service
   key here is the stale one):

   ```bash
   APP_DIR=/home/specenpo/public_html/spotlightng_v2/frontend-web
   PID=$(pgrep -f lsnode | head -1)
   tr '\0' '\n' < /proc/$PID/environ | grep -E '^(NEXT_PUBLIC_SUPABASE|SUPABASE_SERVICE_ROLE)' \
     | awk -F= '{ v=substr($0,index($0,"=")+1); print $1" [len "length(v)"]" }'
   grep -o 'ptczqwfokydsdafpscex' ~/.cl.selector/node-selector.json | head -1
   ```

2. In **cPanel → Setup Node.js App**, open the application rooted at
   `public_html/spotlightng_v2/frontend-web` and **delete** these three
   environment variables (or set them to the `nmseefdlliejmdbxytej` values from
   Supabase → Settings → API, matching that screen): `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Save.
3. Reload the app — the cPanel save usually does it; otherwise
   `touch "$APP_DIR/tmp/restart.txt"` **and** make one request
   (`curl -o /dev/null https://www.spotlightng.com/login`), then re-run step 1:
   those names must now be absent from the process env, which is what lets
   `.env.production.local` supply them.
4. Run the §6 post-checks. Expected: no banner, `area-tab-0` and `₦` present,
   `/api/v1/contests` 200, `GET /api/academy/apply` returning batches.

Do **not** spend time on these — each was checked and ruled out:

- `set -a; . ./.env.production` then a `curl` to prove the credential. The file
  that exists is `.env.production.local`, its values are already correct, and
  such a probe returns **200** while the app still fails. It is a false pass.
- Replacing `SUPABASE_SERVICE_ROLE_KEY` in GitHub secrets, or rebuilding. Both
  are already correct; the deploy re-pins them and the injected env still wins.
- More migrations. The pricing chain landed on prod on 2026-11-11 (§3, §5) and
  `nmseefdlliejmdbxytej` answers every read in this document.
- A "legacy keys got revoked" theory — the stale keys work fine, just for the
  wrong project.

Housekeeping once prod is green: the retired project's legacy JWT anon and
service-role keys are still live credentials for `ptcz…`. Rotate or revoke them
so nothing can pick them up again.

---

## 2. The set (apply in this order)

| # | Migration | Adds | Depends on |
|---|-----------|------|------------|
| 1 | `20271060000000_academy_area_pricing_options.sql` | `academy_area_pricing_options` table (one row per area × 5 formats), its index, a 5-format seed for every existing area, and `academy_applications.pricing_option_key` | `academy_interest_areas`, `academy_applications` (both present) |
| 2 | `20271095000000_academy_pricing_option_labels.sql` | Operator's long-form labels (UPDATE only) | #1 |
| 3 | `20271095000001_academy_pricing_option_labels_v2.sql` | Operator's short-form labels, superseding #2 (UPDATE only) | #1 |
| 4 | `20271095000002_academy_pricing_selections.sql` | `academy_applications.pricing_selections jsonb` (per-area format map) | `academy_applications` (present) |

Seed prices written by #1, identical for every area:

| key | label (after #3) | ₦ |
|---|---|---|
| `weekend_day` | Weekend (No Boarding) | 50,000 |
| `weekend_boarding` | Weekend (With Boarding) | 80,000 |
| `weekday_day` | Week days (No Boarding) | 100,000 |
| `weekday_boarding` | Week days (Boarding) | 150,000 |
| `full_time_boarding` | 1 month - Boarding | 200,000 |

### Safety of each file

- **#1** — `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
  `INSERT … ON CONFLICT (area_id, key) DO NOTHING`, `ALTER TABLE … ADD COLUMN
  IF NOT EXISTS`, then `ENABLE ROW LEVEL SECURITY` **with no policies** (same
  deny-all posture as `academy_interest_areas`; the BFF reads with the service
  role, which bypasses RLS). No `CREATE POLICY`, so the collision mode that
  aborted the 2026-08-01 `db push` cannot occur here.
- **#2 / #3** — plain `UPDATE`s keyed on `key`; idempotent, no-op on an empty
  table.
- **#4** — `ADD COLUMN IF NOT EXISTS` only.
- None of the four opens a transaction itself, so
  `reconcile-pending.sh --apply-one` (which runs the file under `psql -1`) is
  clean.

---

## 3. Evidence — prod probe, 2026-11-11

Read-only, via the project's public publishable key
(`https://nmseefdlliejmdbxytej.supabase.co`). `PGRST205` = absent from the
schema cache; `42703` = column absent; `42501` = present but not readable by
`anon`.

| Object | Prod result | Verdict |
|---|---|---|
| `academy_area_pricing_options` | `404 PGRST205` | **absent** → #1 |
| `academy_applications.pricing_option_key` | `400 42703` | **absent** → #1 |
| `academy_applications.pricing_selections` | `400 42703` | **absent** → #4 |
| `academy_batches` | `200` + row | present |
| `academy_settings` | `200` + row (`registration_type=paid`, fee 5000) | present |
| `academy_interest_areas` | `200 []` | present; rows hidden from `anon` by RLS |
| `academy_batch_interest_areas` | exists, no `id` column (composite key) | present |
| `academy_applications.tuition_total_ngn` | `200` | present (20261220000000 applied) |
| `academy_application_fee_intents` | `401 42501` | present, locked down (20270330000000 applied) |
| `academy_installment_payments` | `200` | present |

**Ledger caveat:** prod's `schema_migrations` may still *record* one of these as
applied while the object is absent (the drift this repo has hit before). If
`supabase migration list` shows a version as applied but the §3 probe says
absent, mark history back first, then apply:

```bash
supabase migration repair --status reverted <version> --db-url "$DBURL"
```

`--apply-one` then runs the SQL and repairs history to `applied`.

---

## 4. Explicitly out of scope

| Item | Why |
|---|---|
| `20271095000003_academy_area_options.sql` | Creates a legacy `academy_area_options` table that **no code references** (checked `frontend-web`, `mobile-app/reactnative`, `backend`). Additive but unnecessary for this feature; leave for the general backlog. |
| `20261218000000`, `20261219000000`, `20261220000000`, `20261222000000`, `20270330000000` | Already applied in prod (§3). |
| `20271085000000`, `20271089000000`, `20271090000000`, `20271098000000`, `20271099*` | Assessment/curriculum plane, not read by the marketing page or the pricing flow. |
| The remaining pending backlog | Separate reconciliation; this package must not trigger a bare `db push`. |

---

## 5. Execution

### 5.1 Pre-flight (session-mode connection, not the 6543 txn pooler)

```bash
# backup / snapshot per runbook §3, then:
psql "$DBURL" -tAc "select count(*) filter (where is_active) from public.academy_interest_areas;"
```

**Record this number.** #1's seed is a `CROSS JOIN` over existing areas, so:

- `> 0` → expect `5 × active_areas` pricing rows after #1.
- `0` → the seed writes nothing and the page will still show no areas. Stop:
  the interest-area rows (published by admin, seeded by `20261218000000`) must
  exist first.

Also confirm the four versions are pending (or repair-reverted per §3):

```bash
supabase migration list --db-url "$DBURL" | grep -E '20271060000000|20271095000000|20271095000001|20271095000002'
```

### 5.2 Staging first

```bash
scripts/db/reconcile-pending.sh --db-url "$STAGING_URL" --apply-one 20271060000000 --yes
scripts/db/reconcile-pending.sh --db-url "$STAGING_URL" --apply-one 20271095000000 --yes
scripts/db/reconcile-pending.sh --db-url "$STAGING_URL" --apply-one 20271095000001 --yes
scripts/db/reconcile-pending.sh --db-url "$STAGING_URL" --apply-one 20271095000002 --yes
```

Gate: the page renders area tabs and ₦ prices on staging, and §6 checks pass.

### 5.3 Production (low-traffic window, DBA watching)

Same four commands with `--db-url "$PROD_URL"`, in order, stopping on the first
failure (`apply-one` already halts and rolls that file back).

---

## 6. Post-checks

```sql
select to_regclass('public.academy_area_pricing_options') is not null;                    -- t
select exists(select 1 from information_schema.columns
              where table_name='academy_applications' and column_name='pricing_option_key');-- t
select exists(select 1 from information_schema.columns
              where table_name='academy_applications' and column_name='pricing_selections');-- t
select count(*) from public.academy_area_pricing_options;                                 -- 5 × active areas
select key, min(label) as label, min(price_ngn) as price_ngn
  from public.academy_area_pricing_options group by key order by min(sort_order);          -- 5 rows, v2 labels
```

App smoke (only meaningful once fault 1 is fixed):

```bash
curl -s https://www.spotlightng.com/service-details/film-academy > /tmp/fa.html
grep -c 'area-tab-0' /tmp/fa.html          # expect >= 1
grep -c 'Some catalogue details' /tmp/fa.html  # expect 0
grep -c '₦' /tmp/fa.html                   # expect > 0
curl -s https://www.spotlightng.com/api/academy/apply | head -c 80   # expect a batch list, not 500
```

## 7. Rollback

- A failed `--apply-one` has already rolled back (single transaction).
- Reverse a wrong history edit with
  `supabase migration repair --status reverted <version> --db-url "$URL"`.
- #1–#4 are additive; leaving the objects in place is safe. Removing them would
  drop the pricing rows, which the code reads — do not drop while the page is
  live.

## 8. Reviewer checklist

- [ ] Scope agrees: four files, in order, no bare `db push`.
- [ ] §5.1 active-area count is non-zero and recorded.
- [ ] Ledger state confirmed (repair-reverted if it lies).
- [ ] Staging run green, staging page shows areas + ₦.
- [ ] Fault 1 (host runtime Supabase credential) resolved independently.
- [ ] Prod window scheduled; snapshot taken.
