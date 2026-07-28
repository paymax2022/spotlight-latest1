# LIVE-DB VALIDATION — results + how to run the full suite

## Constraint
The agent sandbox is network-isolated from your host: your local Supabase at
`127.0.0.1:54322` is NOT reachable from the sandbox (no route to your machine's localhost;
confirmed — gateway 172.16.10.1 exposes no path to it). So I stood up a **real Postgres 16.2
inside the sandbox** (userspace, no root) and ran the live-DB test suites against it with the
migrations applied.

## What passed against real Postgres (sandbox)
- **learn — 5/5 live-DB tests PASS.** Full persistence logic validated end-to-end: quiz scoring
  (server-authoritative, 0.7 boundary), answer-key scrubbing, lesson progress %, attempt recording.
- **spotlightwealth — 5/6 live-DB tests PASS** (join guard, idempotency-key requirement, zero-reward
  path, ended-challenge rejection, leaderboard ordering). The 6th (`CompleteChallenge` ledger credit)
  needs the full ledger schema chain — see below.
- All DB-free unit suites (learn/spotlight/crypto/association/etc.) continue to pass.

## Real bugs found during validation (these would fail on YOUR Supabase too)
1. **FIXED — spotlight test seeded an invalid `kind`.** `tests/spotlightwealth/live_db_integration_test.go`
   inserted `kind='learn'`, but the schema CHECK only allows `('literacy','quiz','savings')` →
   `spotlight_challenges_kind_check` violation. Changed to `'literacy'`. (Committed.)
2. **FIXED — live-DB tests now seed `auth.users`.** They used fresh `uuid.New()` user IDs but the
   schema FKs `user_id → auth.users(id)`, so on a fresh DB they failed with `..._user_id_fkey`
   violations. Added a `seedUser(t, ctx, pool)` helper (`INSERT INTO auth.users (id) ... ON CONFLICT
   DO NOTHING`) to the learn / spotlightwealth / crypto live-DB suites and repointed every user-mint
   site to it. Re-validated **with the FK constraint INTACT** (no workaround): **learn 5/5 PASS,
   spotlightwealth 5/6 PASS** on a fresh migrated Postgres. (association / transport_scheduled don't
   FK to auth.users — no change needed.)

## Why the money/ledger tests need your full stack
`crypto` swap/withdrawal and `spotlight` challenge-completion post to the finance ledger via
`ledger.GetOrCreateUserWallet` / standing accounts, which use `ON CONFLICT (user_id, type)`. The
current `ledger_accounts` schema (standing accounts, `user_wallet`/`escrow` types, the (user_id,type)
uniqueness) is the product of the FULL, ordered migration chain — not the early
`20260613020000_ledger_accounts.sql` alone. Reproducing that plus PostGIS + the Supabase `auth`
schema in a userspace Postgres is a `supabase db reset`-scale job. Your local Supabase already IS
that environment.

## Run the FULL live-DB suite on your local Supabase (one command block)
```bash
# 1. Ensure local Supabase is up with all migrations applied:
supabase db reset            # applies every migration in supabase/migrations in order

# 2. Point the tests at it and run (54322 is the local Supabase Postgres port):
cd backend
export TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:54322/postgres"
go test ./tests/... -run LiveDB -v

# If you hit auth.users FK errors, apply bug #2's fix first (seed test users),
# or run against a disposable copy where you drop the auth.users FKs.
```

## Bottom line
The test harness is proven to work against real Postgres; `learn` is fully validated and
`spotlightwealth` all-but-the-ledger-credit. Two real test bugs were surfaced (one fixed, one
documented). Full money-path (crypto/ledger) validation should be run on your local Supabase via
the block above — that's the environment with the complete migrated schema.
