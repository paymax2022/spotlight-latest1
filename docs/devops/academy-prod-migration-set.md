# Film Academy — production migration set (review package)

**Status:** prepared, awaiting review · **Prepared:** 2026-11-11
**Owner:** DevOps/DBA · **Scope:** the four academy migrations the public Film
Academy catalogue and its application pricing depend on and that are **absent
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

### 1.1 Fault 1 remediation (host access required)

The project itself is healthy and reachable: the publishable key in the page's
own bundle reads `academy_batches` (200 + row), `academy_settings` (200) and
`contests` (200) from the internet. Only the **server-side** path fails, so the
defect is the runtime credential (or host egress), not the schema, not RLS, not
the code. In `/home/specenpo/public_html/spotlightng_v2/frontend-web`:

1. `NEXT_PUBLIC_SUPABASE_URL` must be `https://nmseefdlliejmdbxytej.supabase.co`.
   Any other ref is a different database, and every academy read 404s while the
   browser — built earlier with the right value baked in — looks fine.
2. `SUPABASE_SERVICE_ROLE_KEY` must be the **current** secret for that project.
   A legacy `service_role` JWT is rejected once the project disables legacy API
   keys or rotates its JWT secret; the browser is unaffected because it uses the
   publishable key. This is the most likely cause here.
3. Prove credential + egress from the host before touching anything else:

   ```bash
   set -a; . ./.env.production; set +a
   curl -s -o /dev/null -w '%{http_code}\n' -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
     "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/academy_batches?select=id&limit=1"
   # 200 → credential and network are fine; look elsewhere
   # 401 {"message":"Invalid API key"} → replace the key (step 2)
   # 000 / timeout → the host cannot reach supabase.co
   ```

4. `touch tmp/restart.txt` after any env change (Passenger holds the old
   process env otherwise), then run the §6 post-checks.

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
