# Spotlight — Current Entity-Relationship Diagram
> Audit date: 2026-06-13 | Source: supabase/migrations/ (chronological read)

---

## Identity & Auth

### `auth.users` (Supabase managed)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | Supabase Auth user ID |
| email | text UNIQUE | |
| raw_user_meta_data | jsonb | full_name, role, etc. |
| app_metadata | jsonb | roles array |
| created_at, updated_at, last_sign_in_at | timestamptz | |

**Relationships:** 1:1 → user_profiles, 1:N → user_roles, 1:N → auth_sessions

---

### `public.user_profiles`
> Migration: 20260401004207_create_user_profiles.sql

| Column | Type | Nullable | Constraints |
|---|---|---|---|
| id | uuid | NO | PK, FK → auth.users(id) ON DELETE CASCADE |
| email | text | NO | UNIQUE |
| full_name | text | NO | DEFAULT '' |
| phone | text | YES | No unique constraint, no verification flag |
| age | integer | YES | |
| gender | text | YES | |
| talent_category | text | YES | |
| state | text | YES | |
| program | text | YES | |
| bio | text | YES | |
| application_status | text | YES | DEFAULT 'Under Review' — no CHECK constraint |
| payment_status | text | YES | DEFAULT 'Pending' — no CHECK constraint |
| reference_id | text | YES | Undefined semantics |
| paystack_reference | text | YES | Added: 20260401020000 |
| avatar_url | text | YES | |
| date_of_birth | date | YES | |
| lga | text | YES | Local Government Area |
| address | text | YES | |
| preferences | jsonb | NO | DEFAULT '{}' |
| profile_completion | integer | NO | DEFAULT 0, range 0–100 |
| created_at, updated_at | timestamptz | NO | |

**Indexes:** idx_user_profiles_email  
**Triggers:** Auto-created on auth.users INSERT; updated_at maintained  
**RLS:** Users manage own row only

---

### `public.platform_users` ⚠️ PARALLEL IDENTITY SYSTEM
> Migration: 20260527100000_enterprise_auth_rbac.sql

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| first_name, last_name | text NOT NULL | |
| email | text UNIQUE NOT NULL | |
| phone | text | |
| password_hash | text | ⚠️ Should never be plaintext |
| user_type | text | DEFAULT 'registered_user' |
| email_verified_at, phone_verified_at | timestamptz | |
| status | text | CHECK: active\|pending\|suspended\|locked\|deleted |
| profile_completed | boolean | DEFAULT false |
| last_login_at, failed_login_attempts | timestamptz/integer | |
| locked_until | timestamptz | |
| referral_code | text | |
| referred_by | uuid → platform_users(id) | |
| created_at, updated_at, deleted_at | timestamptz | soft delete |

**CRITICAL:** Parallel to auth.users — unclear which is authoritative. Referral code and phone verification fields here do not exist in user_profiles. Must resolve before fintech build.

---

### `public.profiles` (RBAC migration, alternate profile)
> Migration: 20260527100000_enterprise_auth_rbac.sql

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid | FK → auth.users |
| profile_type | text NOT NULL | |
| avatar_url, bio, country, state, city | text | |
| metadata | jsonb | DEFAULT '{}' |
| completion_score | integer | DEFAULT 0 |

**UNIQUE:** (user_id, profile_type)  
**WARNING:** Third parallel profile system — unclear relationship to user_profiles.

---

## RBAC

### `public.roles`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name, slug | text | slug UNIQUE |
| description | text | |
| role_type | text | system\|admin\|program\|contestant\|partner\|school\|public |
| is_system_role, is_active | boolean | |

**Seeded roles:** super-admin, system-admin, contest-manager, state-coordinator, judge, contestant, sponsor-representative, school-representative, registered-user, verified-user

### `public.permissions`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name, slug | text | slug UNIQUE |
| module, resource, action | text | e.g. 'contest','contest','create' |
| is_system_permission | boolean | |

**24 seeded permissions** across: users, roles, permissions, contest, contestant, judging, finance, payments, audit, votes

### `public.role_permissions`
- UNIQUE: (role_id, permission_id)

### `public.user_roles`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id, role_id | uuid FK | |
| scope_type | enum | global\|program\|contest\|state\|school\|cohort\|season |
| scope_id | text | nullable — e.g. contest UUID, state name |
| assigned_by | uuid → platform_users | |
| starts_at, expires_at | timestamptz | time-bound roles |
| is_active | boolean | DEFAULT true |

**UNIQUE:** (user_id, role_id, scope_type, COALESCE(scope_id,''))  
**Index:** (user_id, is_active, expires_at)

### `public.user_permissions` (direct overrides)
- Fields: user_id, permission_id, effect (allow|deny), scope_type, scope_id, reason, assigned_by, expires_at
- UNIQUE: (user_id, permission_id, effect, scope_type, COALESCE(scope_id,''))

### `public.auth_sessions`
- Fields: id, user_id, refresh_token_hash, device_info, ip_address, user_agent, expires_at, revoked_at

### `public.audit_logs`
- Fields: id, actor_user_id, target_user_id, action, module, resource_type, resource_id, severity (info|warn|error), old_values, new_values, ip_address, user_agent, created_at
- **RLS:** service_role only — append-only

### `public.login_activity`
- Fields: id, user_id (nullable), email, status (success|failed), failure_reason, ip_address, user_agent, location_metadata, created_at

---

## Contests & Contestants

### `public.contests`
> Migration: 20260404210000_create_contests.sql

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name, description, rules, prize_pool | text | |
| judges | text[] | array of names |
| status | enum | draft\|active\|upcoming\|ended |
| start_date, end_date | timestamptz | |
| category | text | |
| max_contestants | integer | |
| created_by | uuid → user_profiles | |

**Indexes:** status, created_at, created_by  
**RLS:** Public read; authenticated full CRUD ⚠️ No contest-level permission check

### `public.contestants`
> Migrations: 20260404220000, 20260404230000

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name, category, bio, photo_url, contest_link | text | |
| contest_id | uuid → contests(id) ON DELETE SET NULL | |
| status | enum | pending\|approved\|rejected\|active\|inactive |
| is_active | boolean | DEFAULT true |
| email, phone | text | DEFAULT '' |
| social_instagram, social_twitter, social_facebook | text | |
| voting_link | text | |
| voting_link_slug | text | UNIQUE |
| is_verified, verification_badge | boolean/text | |
| total_votes | integer | DEFAULT 0 — maintained by trigger |
| ranking | integer | nullable |
| user_id | uuid → user_profiles | |

**Indexes:** contest_id, status, category, user_id, total_votes DESC, ranking, voting_link_slug (UNIQUE)  
**Triggers:** update_contestant_vote_stats() — recalculates total_votes and ranking on insert into contestant_votes (legacy table)

---

## Voting — Universal Engine (AUTHORITATIVE)
> Migration: 20260602100000_universal_voting_engine.sql

### `public.voting_settings` (1 per contest)
Key fields: contest_id (UNIQUE FK), voting_enabled, voting_type (free|paid|hybrid), free_votes_per_day (DEFAULT 3), free_vote_limit_scope (user|email|phone|device|ip|session), paid_voting_enabled, currency, payment_provider (paystack|flutterwave|monnify|squad), payment_ref_prefix (DEFAULT 'SPT-VOTE'), fraud_detection_enabled, voting_starts_at, voting_ends_at, timezone (DEFAULT 'Africa/Lagos'), leaderboard_freeze_enabled, status (draft|active|paused|closed)

### `public.votes` (immutable append-only ledger)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| contest_id, contestant_id | uuid FK | |
| voter_profile_id | uuid → voter_profiles | |
| voter_user_id | uuid → auth.users | nullable (anonymous) |
| vote_type | enum | free\|paid\|bonus\|admin_adjustment\|sponsor_bundle\|refund_reversal\|fraud_reversal |
| vote_quantity | integer | ≠ 0, negative for reversals |
| vote_status | enum | pending\|confirmed\|rejected\|reversed\|quarantined\|failed |
| transaction_id | uuid → vote_transactions | nullable |
| payment_reference | text | nullable |
| round_id | uuid → voting_rounds | nullable |
| ip_address | inet | |
| device_fingerprint, user_agent | text | |
| fraud_score | integer | DEFAULT 0 ⚠️ mutable |
| fraud_status | enum | clean\|suspicious\|flagged\|quarantined\|cleared |
| created_at, confirmed_at, reversed_at | timestamptz | |

**RLS:** service_role only (created via RPC/service layer)  
**Design:** Never DELETE; status updates only  
**⚠️ MISSING:** Unique constraint on (voter_identifier, contestant_id, vote_date, vote_type='free') — duplicate free votes possible if daily_limits bypassed

### `public.vote_transactions` (payment records)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| payment_reference | text NOT NULL | UNIQUE |
| provider_reference | text | Paystack's own reference |
| idempotency_key | text | UNIQUE — format: `{contestId}:{contestantId}:{voterEmail}:{paymentRef}` ⚠️ weak |
| amount_expected, amount_paid | numeric(12,2) | |
| currency | text | DEFAULT 'NGN' |
| votes_purchased, bonus_votes, total_votes_to_credit | integer | |
| payment_status | enum | pending\|successful\|failed\|abandoned\|refunded\|chargeback |
| vote_credit_status | enum | pending\|credited\|skipped\|reversed |
| paid_at, verified_at, credited_at | timestamptz | |

**Indexes:** payment_reference, payment_status, contest_id, idempotency_key

### `public.vote_packages`
Key fields: id, contest_id, name, votes, bonus_votes (>= 0), amount (numeric), currency, is_active, promo_label, starts_at, ends_at

### `public.voter_profiles`
Key fields: id, user_id (nullable → auth.users), email, phone, display_name, device_fingerprint, ip_address, is_anonymous, is_verified, ban_reason, banned_at  
**⚠️ No uniqueness on (user_id, email, phone)**

### `public.voter_daily_limits`
| Column | Notes |
|---|---|
| contest_id, voter_identifier, voter_identifier_type, vote_date | UNIQUE composite — the race-condition guard |
| free_votes_used, free_votes_limit | integer |

### `public.vote_totals` (denormalized leaderboard)
| Column | Notes |
|---|---|
| contest_id, contestant_id, round_id | UNIQUE composite |
| free_votes, paid_votes, bonus_votes, admin_adjustment_votes, reversed_votes, quarantined_votes | bigint >= 0 |
| total_confirmed_votes | bigint = free + paid + bonus + admin - reversed |
| rank | integer — updated by recompute_leaderboard_ranks() |

**⚠️ CRITICAL:** Not referentially tied to votes; can drift if increment_vote_totals() is not called after vote insert.

### `public.voting_rounds`
Key fields: id, contest_id, round_number, round_type (prequalification|top50|top20|top10|eviction|wildcard|finale|fan_favorite|sponsor|standard), status (upcoming|active|closed|results_published), vote_weight, carry_forward_votes, starts_at, ends_at  
**UNIQUE:** (contest_id, slug)

### `public.fraud_flags` (universal)
Key fields: id, vote_id, contest_id, voter_profile_id, flag_type (enum: 14 types), severity (low|medium|high|critical), status (open|under_review|resolved|dismissed|actioned)

### `public.vote_audit_logs`
Key fields: id, actor_id, actor_role, action, entity_type, entity_id, contest_id, contestant_id, old_value, new_value, reason, ip_address, created_at

### `public.admin_vote_adjustments`
Key fields: id, contest_id, contestant_id, admin_id, approved_by, adjustment_type (add|subtract|reverse|quarantine|restore), vote_quantity, before_total, after_total, reason NOT NULL, status (pending|approved|rejected|applied)

### `public.vote_receipts`
Key fields: id, transaction_id FK, receipt_number UNIQUE (format: SPT-RCP-{ts}-{uuid}), votes_purchased, bonus_votes, amount_paid, issued_at

---

## Voting — Legacy Engine ⚠️ PARALLEL SYSTEM
> Migration: 20260404240000_voting_engine.sql

### `public.contestant_votes` (legacy)
Key fields: id, contestant_id, contest_id, voter_ip, voter_fingerprint, user_id, vote_type (free|paid|referral|bonus), vote_count, payment_reference, device_fingerprint, referral_code, created_at  
**⚠️ No idempotency, no fraud detection, no payment linking**

### `public.vote_allocations` (legacy daily limits)
Key fields: id, user_id, device_fingerprint, contest_id, contestant_id, vote_date, free_votes_used, free_votes_limit  
**UNIQUE:** (COALESCE(user_id::text,''), device_fingerprint, contestant_id, vote_date)  
**OVERLAPS WITH:** voter_daily_limits (universal engine)

---

## Fraud Detection (Legacy)
> Migration: 20260404250000_fraud_detection.sql

### `public.ip_velocity_tracking`
Key fields: voter_ip, contest_id, vote_count, window_start, window_end, last_vote_at

### `public.device_tracking`
Key fields: device_fingerprint, voter_ip, contest_id, vote_count, ip_changes, geo_country, geo_region, geo_city, user_agent

### `public.vote_fraud_logs`
Key fields: vote_id, contestant_id, contest_id, voter_ip, device_fingerprint, check_passed, fraud_score, checks_performed (jsonb), user_agent

---

## Payments & Academy

### `public.academy_installment_plans`
> Migration: 20260603000000_academy_installment_payments.sql

Key fields: id, application_id UNIQUE FK → academy_applications, batch_id, total_amount_ngn (> 0), installments_count (1–12), frequency (weekly|biweekly|monthly), status (active|completed|cancelled)

### `public.academy_installment_payments`
Key fields: id, plan_id FK, installment_number, amount_ngn (> 0), due_date, paid_at, payment_reference, payment_provider (DEFAULT 'paystack'), status (pending|paid|overdue|waived)  
**UNIQUE:** (plan_id, installment_number)  
**Triggers:** check_installment_plan_completion() — sets plan.status='completed' when all paid  
**⚠️ No check that SUM(installments) = total_amount_ngn**

---

## Mobile Fintech (Existing, Pre-PRD)
> Migration: 20260423190000_mobile_fintech_persistence.sql

### `public.mobile_fintech_accounts`
Key fields: user_id PK, display_name, email, currency, **available_balance, ledger_balance** (not ledger-backed ⚠️), kyc_status (not_started|in_review|verified|rejected), card_controls_enabled

### `public.mobile_fintech_cards`
Key fields: id, user_id, kind (virtual|physical), masked_pan, expiry, status (active|frozen|inactive), spending_limit_daily

### `public.mobile_fintech_transactions`
Key fields: id, user_id, type (credit|debit|pending|failed), title, amount, currency, status_label, reference, counterparty, created_at  
**⚠️ Not double-entry; no transaction integrity**

### `public.mobile_fintech_transfer_reviews`
Key fields: review_token PK, user_id, recipient_name, bank_name, account_number_masked, amount, fee, total_debit, expires_at, consumed_at

### `public.mobile_fintech_transfers`
Key fields: id, user_id, review_token, reference, status (success|pending), amount

### `public.mobile_fintech_bill_payments`
Key fields: id, user_id, biller, customer_id, amount, reference, status

### `public.mobile_fintech_support_tickets`
Key fields: id, user_id, category, transaction_reference, message, status (open|in_progress|resolved|closed)

---

## Applicant Dashboard
> Migration: 20260423113000_applicant_dashboard_core.sql

### `public.applicant_notifications`
Key fields: user_id, service_type, application_id, title, message, is_read, link, metadata

### `public.application_status_history`
Key fields: user_id, service_type, application_id, old_status, new_status, note, next_action

---

## RPC Functions (Stored Procedures)

| Function | File | Idempotent | Notes |
|---|---|---|---|
| `increment_vote_totals(contest_id, contestant_id, round_id, free, paid, bonus, admin, reversed, quarantined)` | 20260602110000 | ✅ (upsert) | Leaderboard counter; RPC can be missed on crash |
| `recompute_leaderboard_ranks(contest_id, round_id)` | 20260602110000 | ✅ | RANK() OVER total_confirmed_votes DESC |
| `increment_share_click(share_link_id)` | 20260602110000 | ❌ | Increments click_count; no dedup |
| `run_fraud_checks(vote_id, contestant_id, contest_id, ip, device, type, count)` | 20260404250000 | ❌ | Synchronous; blocking vote path; duplicate flags possible |
| `check_free_vote_allowed(user_id, device, contestant_id, date)` | 20260404240000 | ✅ | Read-only check |
| `cast_free_vote(contestant_id, user_id, device, ip)` | 20260404240000 | ❌ | Legacy; no idempotency key |
| `cast_paid_votes(contestant_id, user_id, device, count, payment_ref, ip)` | 20260404240000 | ❌ | Legacy; no reference dedup |
| `confirm_academy_payment(application_id, payment_ref, amount, email)` | 20260407135234 | ✅ | Returns already_confirmed=true on replay |
| `effective_permissions(user_id, scope_type, scope_id)` | 20260527100000 | ✅ | Returns permission slugs |
| `user_has_permission(user_id, permission_slug, scope_type, scope_id)` | 20260527100000 | ✅ | Super-admin bypass |

---

---

## Reality Show (Most Recent Module)
> Migration: 20260604100000_reality_show_stages_evictions.sql

### `public.reality_show_seasons`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name, slug | text | slug UNIQUE |
| status | text | CHECK: draft\|registration_open\|auditions\|bootcamp\|ended |
| season_number | integer | |
| starts_at, ends_at | timestamptz | |

### `public.reality_show_contestants`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| season_id | uuid FK → reality_show_seasons | |
| user_id | uuid FK → auth.users | |
| stage_name | text | |
| status | text | CHECK: registered\|approved\|active\|evicted\|withdrawn |
| evicted_at | timestamptz | |
| eviction_week | integer | |
| UNIQUE | (season_id, user_id) | |

### `public.reality_show_weeks`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| season_id | uuid FK | |
| week_number | integer | |
| status | text | upcoming\|open\|closed\|eviction_declared |
| eviction_count | integer | DEFAULT 1 — how many to evict this week |
| eviction_finalized | boolean | DEFAULT false |

### `public.reality_show_eviction_votes`
Key fields: id, week_id FK, contestant_id FK, voter_id FK → auth.users, voter_role (admin|judge), vote_note, created_at  
**UNIQUE:** (week_id, contestant_id, voter_id)  
**RLS:** Admin all; judge can insert + read own votes only

### `public.reality_show_evictions`
Key fields: id, season_id FK, week_id FK, contestant_id FK, evicted_by (admin|judge_vote|public_vote|auto), eviction_order, eviction_note, evicted_at  
**RLS:** Admin only

---

## Academy Payment Preference
> Migration: 20260603200000_academy_payment_preference.sql

Adds column to `public.academy_applications`:
- `payment_preference` VARCHAR(20) DEFAULT 'installment' CHECK (payment_preference IN ('one_off','installment'))

---

## Key Relationships Summary

```
auth.users 1──1 user_profiles
auth.users 1──N user_roles ──N─1 roles ──N─N permissions
auth.users 1──1 mobile_fintech_accounts
auth.users 1──N voter_profiles

contests 1──N contestants
contests 1──1 voting_settings
contests 1──N voting_rounds
contests 1──N votes
contests 1──N vote_transactions
contests 1──N vote_totals (N per contestant)
contests 1──N vote_packages

vote_transactions 1──1 votes (via transaction_id)
vote_transactions 1──1 vote_receipts

contestant_votes (LEGACY) ──> contestants.total_votes via trigger
votes (UNIVERSAL) ──> vote_totals via increment_vote_totals() RPC

academy_applications 1──1 academy_installment_plans
academy_installment_plans 1──N academy_installment_payments

reality_show_seasons 1──N reality_show_contestants
reality_show_seasons 1──N reality_show_weeks
reality_show_weeks   1──N reality_show_eviction_votes
reality_show_weeks   1──N reality_show_evictions
reality_show_contestants ──FK── auth.users
```

---

## Migration Count & Most Recent
> Total migrations: **65** (as of 2026-06-13)  
> Most recent: `20260604100000_reality_show_stages_evictions.sql`

### Migrations not yet applied to production (check `supabase migration list`):
Run `supabase migration list` against the production project to confirm which are pending.
The local migration directory is the source of truth for schema intent.
