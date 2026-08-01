# Cloud DB Migration Reconciliation Runbook

**Status:** ready to execute · **Owner:** DevOps/DBA · **Created:** 2026-08-01
**Scope:** the 64 migrations pending on the production Supabase project whose
migration *history* is out of sync with the actual *schema*.

> ⚠️ Production, hard-to-reverse. Do **not** run a bare `supabase db push` — it
> failed exactly this way already (see §1). Follow the staged flow below:
> **staging first → validate → prod**, one migration at a time.

---

## 1. Background — why a plain `db push` fails

The remote records **266 of 332** local migrations in
`supabase_migrations.schema_migrations`. The other **66** were "pending". On
2026-08-01 an attempted `supabase db push --include-all` **aborted on the first
migration and rolled back** (remote unchanged) with:

```
ERROR: policy "estate_dues_invoices_select" for table "estate_dues_invoices" already exists (SQLSTATE 42710)
```

Root cause: the schema and the history table have **drifted**. The 66 were a mix —
some already applied (history lost the row), some never applied — so:

- Re-running an **already-applied** migration collides on non-idempotent
  statements (`CREATE POLICY` has no `IF NOT EXISTS`).
- A blind `migration repair --status applied` on all 66 would **skip real DDL**
  for the never-applied ones.

**2 of the 66** (the insurance seed `20261031000100` + display-meta
`20261031000200`) were already reconciled surgically on 2026-08-01 (applied +
`repair`ed). **64 remain** — this runbook covers those.

---

## 2. Classification of the 64 (as of 2026-08-01)

Produced read-only by [`scripts/db/classify-pending-migrations.sh`](../../scripts/db/classify-pending-migrations.sh)
(picks a table/column/index/type *sentinel* per migration and probes the remote):

| Bucket | Count | Meaning | Action |
|--------|-------|---------|--------|
| **APPLIED** | 8 | sentinel object already on remote → history just lost the row | `migration repair --status applied` (run **no** DDL) |
| **MISSING** | 37 | sentinel absent on remote → genuinely not applied | apply the migration, then repair |
| **REVIEW** | 19 | no simple sentinel (ALTER-only / DO-blocks / **12 are pure seed/data**) | inspect by hand; most are idempotent seeds → apply then repair |

**Key nuance — a schema-diff alone is not enough.** 12 of the REVIEW migrations
are pure `INSERT/UPDATE` seed/RBAC/commission data (no DDL), which `supabase db
diff` would silently omit. The plan is therefore **hybrid**: schema-diff for DDL
truth **and** run-the-migration for seed/data.

Full per-migration table in the [Appendix](#appendix--full-64-migration-classification).
Re-generate anytime:

```bash
DBURL="$(grep -hoE 'postgres[^ ]*pooler[^ ]*' .env | head -1)"
scripts/db/classify-pending-migrations.sh "$DBURL" supabase/migrations
```

---

## 3. Pre-flight

1. **Backup prod** (point-in-time restore is on by default on Supabase, but take
   an explicit snapshot / `pg_dump --schema-only` + a data dump of critical
   tables before touching anything).
2. Confirm the connection string is the **session** pooler (port 5432) or a
   direct connection — migrations need session mode, not the 6543 txn pooler.
3. Ensure `supabase` CLI ≥ 2.98 and `psql` are on PATH.
4. Freeze other writers to the migration set (no concurrent deploys).

---

## 4. Stage 1 — build the "desired" schema on a throwaway DB

Goal: a database with **all 332** local migrations applied cleanly = the target
state, and a schema-diff source.

```bash
# Option A: local shadow
supabase db reset            # replays every local migration into the local DB (:54322)

# Option B: a dedicated staging Supabase project (preferred — matches prod extensions/RLS)
supabase link --project-ref <STAGING_REF>
supabase db push             # applies all pending to a CLEAN staging project
```

**Gate:** `supabase db reset` / `db push` must finish **green**. If any migration
fails on a clean DB, fix the migration first — that is a real bug, not drift.

---

## 5. Stage 2 — validate the reconciliation ON STAGING

Make staging look like prod's drift, then rehearse the exact prod steps.

1. Point the executor at **staging** and dry-run:
   ```bash
   scripts/db/reconcile-pending.sh --db-url "$STAGING_URL" --dry-run
   ```
2. PHASE R (repair the APPLIED bucket — history only, no DDL):
   ```bash
   scripts/db/reconcile-pending.sh --db-url "$STAGING_URL" --repair --yes
   ```
3. PHASE A (apply MISSING one at a time; halts on first error):
   ```bash
   scripts/db/reconcile-pending.sh --db-url "$STAGING_URL" --apply --yes
   ```
4. Work the **REVIEW** bucket by hand (§6).
5. **Gate:** `--verify` shows `pending: 0`, and a `supabase db diff` between
   staging and the desired DB shows **no schema delta**.

Only proceed to prod once staging reconciles to **0 pending** with an empty diff.

---

## 6. Handling the REVIEW bucket (19)

For each REVIEW migration, decide applied-vs-missing with a real sentinel, then
route it:

```bash
# inspect what the migration introduces
less supabase/migrations/<version>_*.sql

# probe the specific object it adds (examples)
psql "$DBURL" -tAc "select to_regclass('public.<table>') is not null;"                       # table
psql "$DBURL" -tAc "select exists(select 1 from information_schema.columns
                    where table_name='<t>' and column_name='<c>');"                          # column
psql "$DBURL" -tAc "select exists(select 1 from pg_policies
                    where tablename='<t>' and policyname='<p>');"                             # policy
psql "$DBURL" -tAc "select exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
                    where t.typname='<enum>' and e.enumlabel='<value>');"                     # enum value
```

- **Object present** → `reconcile-pending.sh --db-url "$URL" --apply-one <version> --yes`
  will still no-op-then-repair *if* the migration is idempotent; otherwise just
  `supabase migration repair --status applied <version> --db-url "$URL"`.
- **Object absent** → `--apply-one <version> --yes` (runs SQL in a txn, then repairs).
- **Seed/data (12 of these)** → almost all use `ON CONFLICT DO NOTHING`; safe to
  `--apply-one`. Verify row counts after.

The 12 seed/data REVIEW files: academy-fees RBAC, estate/restaurant/nutrition
admin RBAC, `rbac_seed_gaps` ×2, utility convenience fee, commission boost /
reconcile / RBAC seed, connect payments refund perm, open-food onboarding.

---

## 7. Stage 3 — execute on PRODUCTION

Same commands, `--db-url "$PROD_URL"`, during a low-traffic window, with a DBA
watching:

```bash
PROD_URL="$(grep -hoE 'postgres[^ ]*pooler[^ ]*' .env | head -1)"   # or export directly

scripts/db/reconcile-pending.sh --db-url "$PROD_URL" --dry-run          # 1. review plan
scripts/db/reconcile-pending.sh --db-url "$PROD_URL" --repair --yes     # 2. PHASE R (8)
scripts/db/reconcile-pending.sh --db-url "$PROD_URL" --apply  --yes     # 3. PHASE A (37, halts on error)
# 4. work REVIEW (19) per §6, --apply-one each
scripts/db/reconcile-pending.sh --db-url "$PROD_URL" --verify           # 5. expect pending: 0
```

Each `--apply` step is a **single transaction per migration** with
`ON_ERROR_STOP=1`; on any error it rolls that migration back and **halts** so you
fix one file, not a half-applied database.

---

## 8. Post-checks & rollback

**Verify:**
- `reconcile-pending.sh --verify` → `pending: 0`.
- `supabase migration list --db-url "$PROD_URL"` → every local version has a
  remote row.
- App smoke: feature-flagged modules that gained tables still start; regression
  suite green; spot-check seed counts (RBAC perms, commission rates).

**Rollback:**
- A failed `--apply` migration already rolled back (transactional) — no undo
  needed; fix the file and re-run `--apply-one`.
- `migration repair` only edits the history table. To undo a wrong repair:
  `supabase migration repair --status reverted <version> --db-url "$URL"`.
- Catastrophic: Supabase point-in-time restore to the pre-flight snapshot.

---

## 9. Prevent recurrence

- **Never** apply migrations to cloud out-of-band (direct psql / `db reset` on a
  shared DB) without `db push` recording history — that is what caused this drift.
- **[`.github/workflows/db-migrate.yml`](../../.github/workflows/db-migrate.yml)**
  applies `supabase/migrations/**` on merge to `main` so the remote never falls
  behind again. It is **dormant until you enable it** (it would fail against the
  current drift): after this runbook reaches `pending: 0`, add the secrets
  (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`) and set
  the repo variable `DB_MIGRATE_ENABLED=true`. Until then it skips on push; use
  `workflow_dispatch` (dry-run) to test the credentials/link first.
- Keep migrations **idempotent** (`IF NOT EXISTS`, guarded `DO` blocks, `ON
  CONFLICT`) so replay is always safe — most already are; the estate `CREATE
  POLICY` blocks are the notable exception to fix.

---

## Appendix — full 64-migration classification

| # | Migration | Bucket | Sentinel | Type |
|---|-----------|--------|----------|------|
| 1 | `20260622010001_estate_modules.sql` | **APPLIED** | table:estate_dues_invoices | schema |
| 2 | `20260622020001_estate_modules_38_46.sql` | **APPLIED** | table:estate_ai_notes | schema |
| 3 | `20260622030001_estate_indexes.sql` | **APPLIED** | index:idx_meeting_minutes_meeting | schema |
| 4 | `20260705000001_investai_assistant.sql` | **APPLIED** | table:investai_sessions | schema |
| 5 | `20260707000001_referral_trust.sql` | **APPLIED** | table:referral_risk_rules | schema |
| 6 | `20260710000001_voting_phase_visibility.sql` | **APPLIED** | table:voting_phases | schema |
| 7 | `20260830000001_transport_mode_idempotency_default.sql` | **REVIEW** | — | schema |
| 8 | `20260912000001_ledger_accounts_reconcile.sql` | **APPLIED** | index:ledger_accounts_user_type_key | schema |
| 9 | `20260913000001_stays_deals.sql` | **APPLIED** | table:stays_deals | schema |
| 10 | `20260914000001_super_admin_admin_credentials.sql` | **REVIEW** | — | schema |
| 11 | `20260918000000_academy_fees_edtech.sql` | **MISSING** | table:academy_sessions | schema |
| 12 | `20260918000100_academy_fees_integration.sql` | **MISSING** | table:academy_hardship_requests | schema |
| 13 | `20260918000200_academy_fees_intents.sql` | **MISSING** | table:academy_payment_intents | schema |
| 14 | `20260918000300_academy_fees_rbac_reconcile.sql` | **REVIEW** | — | seed/data |
| 15 | `20260919000000_estate_admin_rbac.sql` | **REVIEW** | — | seed/data |
| 16 | `20260919000200_restaurant_admin_rbac.sql` | **REVIEW** | — | seed/data |
| 17 | `20260919000300_nutrition_admin_rbac.sql` | **REVIEW** | — | seed/data |
| 18 | `20260919000400_restaurant_payouts.sql` | **MISSING** | table:restaurant_payout_runs | schema |
| 19 | `20260919000500_crypto_onchain_balances.sql` | **MISSING** | table:crypto_onchain_balances | schema |
| 20 | `20260920000000_crypto_schema.sql` | **REVIEW** | — | schema |
| 21 | `20260920000100_rbac_seed_gaps.sql` | **REVIEW** | — | seed/data |
| 22 | `20260920000300_fx_convert_idempotency.sql` | **MISSING** | index:ux_fx_conversions_idempotency_key | schema |
| 23 | `20260920000400_rbac_seed_gaps_round2.sql` | **REVIEW** | — | seed/data |
| 24 | `20260920000500_academy_scholarship_awards_pledge_fix.sql` | **MISSING** | column:academy_scholarship_awards.pledge_id | schema |
| 25 | `20260921000000_arena_quiz_bank.sql` | **MISSING** | table:arena_quiz_question | schema |
| 26 | `20260922000100_connect_network_jobs.sql` | **MISSING** | table:connect_company_pages | schema |
| 27 | `20260922000200_connect_network_feed.sql` | **MISSING** | table:connect_posts | schema |
| 28 | `20260922000300_connect_network_profile.sql` | **MISSING** | table:connect_experience | schema |
| 29 | `20260922000400_connect_network_assessments.sql` | **MISSING** | table:connect_skill_assessments | schema |
| 30 | `20260922000500_connect_network_mentorship.sql` | **MISSING** | table:connect_mentorship_profiles | schema |
| 31 | `20260922001000_arena_quiz_question_image.sql` | **MISSING** | column:arena_quiz_question.image_url | schema |
| 32 | `20260922002000_naija_driver_frsc_supplement.sql` | **REVIEW** | — | schema |
| 33 | `20260923000000_utility_convenience_fee_cabletv_electricity.sql` | **REVIEW** | — | seed/data |
| 34 | `20260924000000_academy_feature_flags.sql` | **MISSING** | table:academy_feature_flags | schema |
| 35 | `20260925000000_academy_moderation_state_widen.sql` | **REVIEW** | — | schema |
| 36 | `20260926000000_commission_management.sql` | **MISSING** | table:commission_config | schema |
| 37 | `20260927000000_commission_marketplace_boost.sql` | **REVIEW** | — | seed/data |
| 38 | `20260928000000_commission_reconcile_actual_rates.sql` | **REVIEW** | — | seed/data |
| 39 | `20260929000000_commission_rbac_seed.sql` | **REVIEW** | — | seed/data |
| 40 | `20260930000000_business_registry.sql` | **MISSING** | table:business_profiles | schema |
| 41 | `20261001000000_business_certificate.sql` | **MISSING** | column:business_profiles.certificate_url | schema |
| 42 | `20261002000000_onboarding_requires_business.sql` | **MISSING** | column:onb_merchant_type.requires_business | schema |
| 43 | `20261003000000_fx_cards_collections.sql` | **MISSING** | table:orch_fx_cards | schema |
| 44 | `20261004000000_fx_cards_provider_card_id.sql` | **MISSING** | column:orch_fx_cards.provider_card_id | schema |
| 45 | `20261005000000_bus_departure_templates.sql` | **MISSING** | table:bus_departure_templates | schema |
| 46 | `20261006000000_marketplace_messaging.sql` | **MISSING** | table:mkt_threads | schema |
| 47 | `20261007000000_marketplace_deal_reviews.sql` | **MISSING** | table:mkt_deal_reviews | schema |
| 48 | `20261008000000_fx_customer_verification.sql` | **MISSING** | table:orch_fx_customer_verifications | schema |
| 49 | `20261009000000_ledger_edtech_fees_vault_type.sql` | **REVIEW** | — | schema |
| 50 | `20261010000000_health_triage_content_created_by.sql` | **MISSING** | column:health_triage_content_items.created_by | schema |
| 51 | `20261011000000_health_lab_result_amendment.sql` | **MISSING** | column:lab_results.version | schema |
| 52 | `20261012000000_connect_account_restrictions.sql` | **MISSING** | table:connect_account_restrictions | schema |
| 53 | `20261012000100_connect_profile_deleted_at.sql` | **MISSING** | column:connect_profiles.deleted_at | schema |
| 54 | `20261012000200_connect_payments_refund_perm.sql` | **REVIEW** | — | seed/data |
| 55 | `20261012000300_connect_entitlement_billing_cycle.sql` | **MISSING** | column:connect_entitlements.auto_renew | schema |
| 56 | `20261012000400_connect_credits.sql` | **MISSING** | table:connect_credits | schema |
| 57 | `20261030000000_health_rx_refills.sql` | **MISSING** | column:health_prescriptions.refills_authorized | schema |
| 58 | `20261030000100_health_consult_recording_consent.sql` | **MISSING** | table:health_consult_recording_consents | schema |
| 59 | `20261030000200_health_clinical_notes_immutable.sql` | **REVIEW** | — | schema |
| 60 | `20261030000300_health_consult_referrals.sql` | **MISSING** | table:health_consult_referrals | schema |
| 61 | `20261030000400_health_consult_followup.sql` | **MISSING** | column:health_consults.parent_consult_id | schema |
| 62 | `20261030000500_user_profiles_phone_backfill.sql` | **MISSING** | index:idx_user_profiles_phone | schema |
| 63 | `20261031000000_health_rx_item_dose_mg.sql` | **MISSING** | column:health_prescription_items.dose_mg | schema |
| 64 | `20261101000000_open_food_merchant_onboarding.sql` | **REVIEW** | — | seed/data |

_Generated by `scripts/db/classify-pending-migrations.sh` on 2026-08-01. Buckets are heuristic (sentinel-based) — the REVIEW rows and any APPLIED you're unsure of must be confirmed per §6 before prod._
