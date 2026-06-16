# Spotlight — Users Table Data Quality Profile
> Audit date: 2026-06-13

---

## Tables in Scope

Three parallel user-related tables exist. This is itself a data quality risk.

| Table | Source | Auth-linked | Verified fields | Used by |
|---|---|---|---|---|
| `auth.users` | Supabase managed | — (IS auth) | email_confirmed_at | Supabase Auth |
| `public.user_profiles` | App-managed | FK → auth.users | None explicit | Frontend, RLS, most features |
| `public.platform_users` | RBAC migration | Separate system | email_verified_at, phone_verified_at | Go backend RBAC only |

---

## `public.user_profiles` — Field Quality

| Column | Type | Nullable | Unique | Verified | Risk |
|---|---|---|---|---|---|
| id | uuid | NO | PK | — | Safe |
| email | text | NO | YES | NO | Email uniqueness enforced, but no email_verified_at column; no link to auth.users.email_confirmed_at |
| full_name | text | NO | NO | NO | DEFAULT ''; forms may submit empty string as valid |
| phone | text | YES | NO | NO | ⚠️ Not unique; not verified; multiple users could share a phone number |
| age | integer | YES | — | — | ⚠️ Nullable; could be null for all existing users |
| gender | text | YES | — | — | ⚠️ Nullable; free-form text (no enum) |
| talent_category | text | YES | — | — | ⚠️ Nullable; no controlled vocabulary |
| state | text | YES | — | — | ⚠️ Nullable; free-form (no state enum) |
| program | text | YES | — | — | ⚠️ Nullable; undefined semantics |
| bio | text | YES | — | — | Low risk |
| application_status | text | YES | — | — | ⚠️ No CHECK constraint; any string accepted (e.g. 'Under Review', 'Pending', typos) |
| payment_status | text | YES | — | — | ⚠️ No CHECK constraint; 'Pending' / 'Paid' not enforced; semantics overlap with payment records |
| reference_id | text | YES | — | — | ⚠️ Undefined semantics; no FK to any table; likely unused |
| paystack_reference | text | YES | — | — | ⚠️ Text only; no FK to vote_transactions; duplicates may exist |
| avatar_url | text | YES | — | — | Low risk |
| date_of_birth | date | YES | — | — | ⚠️ Nullable; needed for KYC age verification |
| lga | text | YES | — | — | Nullable; free-form |
| address | text | YES | — | — | Nullable; needed for KYC |
| preferences | jsonb | NO | — | — | DEFAULT '{}'; flexible but unschema'd |
| profile_completion | integer | NO | — | — | DEFAULT 0; computed, not validated |

---

## Data Quality Risks — Ranked

### CRITICAL

| Risk | Detail | Impact on Fintech |
|---|---|---|
| No identity verification fields | No kyc_status, no ID document reference, no face match, no BVN/NIN columns | Cannot implement KYC tiers without schema extension |
| No phone verification | phone column nullable and unverified; no phone_verified_at | Phone is Tier-1 KYC anchor; current data unusable |
| Three parallel user tables | user_profiles, platform_users, auth.users — unclear which is authoritative | Wallet must be created for exactly one user identity; ambiguity blocks |

### HIGH

| Risk | Detail | Impact on Fintech |
|---|---|---|
| phone not unique | Multiple users can share same phone number | KYC identity dedup impossible without phone uniqueness |
| email not verified at app level | auth.users.email_confirmed_at exists but not surfaced to app; user_profiles has no email_verified_at | Email-based voter identity and KYC verification unreliable |
| payment_status on user_profiles | 'Paid' / 'Pending' directly on user row, not linked to payment records | Creates stale payment state; will conflict with wallet/transaction model |
| Nullable required fields | age, gender, state, program, talent_category, date_of_birth, address all nullable | KYC address verification, age check for minors policy require these |
| paystack_reference on user_profiles | Single text field; cannot store multiple payment references per user | Multiple payments already happen; field is implicitly overwritten |

### MEDIUM

| Risk | Detail |
|---|---|
| reference_id semantics undefined | Appears in schema, not used in visible code; may be legacy artifact |
| application_status free-form text | No enum; inconsistent values expected in production data |
| full_name DEFAULT '' | Empty string passes NOT NULL constraint; invalid names in DB |
| No soft-delete | No deleted_at column; cannot deactivate a user without hard delete |
| No rate-limiting on profile updates | Rapid profile updates (including phone) undetected |

### LOW

| Risk | Detail |
|---|---|
| talent_category free-form | Cannot group/filter by category reliably |
| state free-form | 'Lagos' vs 'lagos' vs 'Lagos State' all different |
| gender free-form | No enum; inconsistent values |

---

## `public.platform_users` — Notes

This table has better verification fields but is a parallel identity system:

- `email_verified_at`, `phone_verified_at` columns present ✅
- `password_hash` column present ⚠️ — unclear if plaintext ever stored
- `referral_code`, `referred_by` FK — referral system already modeled here (not in user_profiles)
- `status` enum (active|pending|suspended|locked|deleted) with `locked_until` — better account state machine than user_profiles
- **DECISION REQUIRED:** Migrate useful fields from platform_users into user_profiles and deprecate platform_users, OR make platform_users the canonical record and deprecate user_profiles

---

## Recommendations Before Fintech Build

```sql
-- 1. Add phone uniqueness (after dedup campaign)
ALTER TABLE user_profiles ADD CONSTRAINT uq_user_profiles_phone UNIQUE (phone);

-- 2. Add verification timestamps
ALTER TABLE user_profiles
  ADD COLUMN phone_verified_at timestamptz,
  ADD COLUMN email_verified_at timestamptz;

-- 3. Add KYC fields (new table preferred — additive-only per PRD)
CREATE TABLE user_kyc_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES auth.users(id),
  kyc_tier    integer NOT NULL DEFAULT 0,
  kyc_status  text NOT NULL DEFAULT 'not_started'
              CHECK (kyc_status IN ('not_started','in_progress','pending_review','verified','rejected')),
  bvn_verified_at   timestamptz,
  nin_verified_at   timestamptz,
  id_doc_verified_at timestamptz,
  date_of_birth     date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 4. Remove payment_status from user_profiles (after migrating to payments table)
-- (deferred until payments table exists)

-- 5. Enforce enum-like values with CHECK constraints
ALTER TABLE user_profiles
  ADD CONSTRAINT chk_application_status
  CHECK (application_status IN ('Under Review','Approved','Rejected','Pending','Withdrawn'));
```

---

## Existing Data Migration Risk

| Scenario | Risk | Mitigation |
|---|---|---|
| Existing users with phone = '' (empty string) | Unique constraint on phone will fail | Normalize '' → NULL before adding constraint |
| Duplicate phone numbers (e.g. family shared) | Cannot add unique constraint | Dedup campaign first; flag duplicates for manual resolution |
| full_name = '' | Name validation downstream | Backfill prompt on next login |
| paystack_reference overwritten | Lost payment history | Create payment_references junction table; migrate existing single values |
