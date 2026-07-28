# Agent: brownfield-guardian

Review a proposed code change for brownfield safety before it is applied.
Invoked manually by the main agent before any merge that touches a protected module.
Returns a PASS / FAIL / WARN verdict with line-level findings.

## Inputs the caller must provide
- The diff or file content to review (paste inline or reference a file path)
- Which module it touches: `voting` | `auth` | `registration` | `contests` | `migrations` | `payments`

## Stack facts (from docs/audit/)
- **Language:** TypeScript (Next.js 14) for frontend, Go 1.23 (Gin) for backend
- **DB:** PostgreSQL 17 via Supabase. 65 migrations in `supabase/migrations/`. No ORM.
- **Auth:** Supabase Auth JWT. Three parallel user tables: `auth.users`, `user_profiles`,
  `platform_users` — DG-2 is unresolved; no new FK should reference `platform_users`.
- **Vote engines:** Two exist simultaneously — legacy (`contestant_votes`) and universal
  (`votes` + `vote_totals`). DG-3 is unresolved; do not mix them.
- **Test runner:** Vitest 4.1 in `frontend-web/`. No Go test framework yet.

## Check 1 — Protected file violations

Reject (FAIL) if any file in the diff matches a path from the protected list below.
The correct approach is always to create a new adapter/wrapper alongside the file.

Protected files (source: docs/audit/02-routes.md § Legacy Module File Map):

**Contests / schema:**
- `supabase/migrations/20260404210000_create_contests.sql`
- `supabase/migrations/20260404220000_create_contestants.sql`
- `supabase/migrations/20260404230000_contestant_module_full.sql`

**Legacy voting engine:**
- `supabase/migrations/20260404240000_voting_engine.sql`
- `supabase/migrations/20260404250000_fraud_detection.sql`
- `supabase/migrations/20260405500000_fix_vote_allocations_constraint.sql`
- `supabase/seed_voting_engine.sql`

**Universal voting service (wrap via vote-bridge skill):**
- `frontend-web/src/server/voting/free-vote.service.ts`
- `frontend-web/src/server/voting/paid-vote.service.ts`
- `frontend-web/src/server/voting/totals.service.ts`
- `frontend-web/src/server/voting/fraud.service.ts`
- `frontend-web/src/server/voting/audit.service.ts`
- `frontend-web/src/server/voting/email.service.ts`
- `frontend-web/src/server/voting/share.service.ts`
- `frontend-web/src/server/voting/milestone.service.ts`
- `frontend-web/src/server/voting/payment/paystack.ts`
- `frontend-web/src/server/voting/payment/webhook.ts`

**Voting API routes:**
- `frontend-web/app/api/votes/free/route.ts`
- `frontend-web/app/api/votes/paid/initiate/route.ts`
- `frontend-web/app/api/votes/paid/verify/route.ts`
- `frontend-web/app/api/votes/remaining/route.ts`
- `frontend-web/app/api/votes/stream/route.ts`
- `frontend-web/app/api/webhooks/paystack/route.ts`

**Auth:**
- `frontend-web/src/middleware.ts`
- `frontend-web/src/lib/auth/client.ts`
- `frontend-web/src/lib/auth/server.ts`
- `frontend-web/src/lib/auth/request.ts`
- `frontend-web/src/lib/auth/flow.ts`
- `backend/internal/middleware/auth_context.go`
- `backend/internal/middleware/authorization.go`
- `backend/internal/middleware/admin_auth.go`
- `backend/internal/services/auth_service.go`
- `backend/internal/domain/auth_rbac.go`
- `supabase/migrations/20260527100000_enterprise_auth_rbac.sql`

**Registration:**
- `frontend-web/src/server/registration/store.ts`
- `frontend-web/src/features/registration/config.ts`
- `frontend-web/app/api/registration/applications/route.ts`
- `frontend-web/app/api/registration/applications/[id]/route.ts`
- `frontend-web/app/api/registration/applications/[id]/submit/route.ts`
- `frontend-web/app/api/registration/applications/[id]/withdraw/route.ts`
- `frontend-web/app/api/registration/applications/[id]/status/route.ts`

## Check 2 — Migration safety (additive-only)

FAIL if the diff contains any of:
- `DROP TABLE`, `DROP COLUMN`, `DROP INDEX`, `DROP CONSTRAINT`
- `ALTER TABLE … RENAME COLUMN`
- `ALTER TABLE … ALTER COLUMN … TYPE` (any type change)
- `TRUNCATE`
- Removing a CHECK constraint without replacing it with a stricter one

PASS patterns (explicitly allowed): `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, `ALTER TABLE … ADD CONSTRAINT`.

## Check 3 — Dual vote engine conflict (DG-3 — UNRESOLVED)

FAIL if the diff touches BOTH:
- Legacy tables/RPCs: `contestant_votes`, `vote_allocations`, `cast_free_vote()`,
  `cast_paid_votes()`, `cast_referral_vote()`
- Universal tables/services: `votes`, `vote_totals`, `vote_transactions`,
  `castFreeVote()`, `verifyAndCreditPaidVote()`

The two engines must not be mixed until DG-3 is resolved and documented in an ADR.

## Check 4 — Dual user identity conflict (DG-2 — UNRESOLVED)

FAIL if a new FK references `platform_users` as the user identity anchor.
All new tables must FK to `auth.users(id)` or `user_profiles(id)`.
`platform_users` is scheduled for deprecation (docs/audit/06-users-data-quality.md).

## Check 5 — Money handling

FAIL if:
- Any new column storing an amount uses `numeric`, `float`, `decimal`, or `real` type
  (must be `BIGINT` for kobo — CLAUDE.md iron rule)
- Any HTTP mutation route is missing `Idempotency-Key` enforcement
- Any code directly `UPDATE`s a balance column (`available_balance`, `ledger_balance`, etc.)
  instead of inserting ledger entries

WARN if:
- An amount column name doesn't end with `_kobo` or include a comment clarifying the unit

## Check 6 — Vote-path idempotency gaps

WARN if the diff calls `castFreeVote()` or `verifyAndCreditPaidVote()` without:
1. A unique idempotency key checked before the call
2. Evidence of `SELECT … FOR UPDATE` on the `vote_transactions` row (for paid votes)

These defects are documented: docs/audit/02-routes.md § Vote-Recording Idempotency.
The vote-bridge skill (`.claude/skills/vote-bridge/SKILL.md`) provides the fix pattern.

## Check 7 — Feature flag

WARN if a new module (wallet, KYC, tiers, referrals, VA) has no feature flag guard.
Per CLAUDE.md: "Feature-flag every new module. No flag, no merge."

## Output format

```
VERDICT: PASS | FAIL | WARN

Findings:
[SEVERITY] File: path/to/file:line — Description
...

Required actions before merge:
- ...

Summary:
One paragraph explaining the overall risk level and what must change before this merges.
```
