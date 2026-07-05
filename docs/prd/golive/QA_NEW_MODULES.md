# QA — New Modules Go-Live Test Report

Scope: black-box Go integration tests for `backend/internal/learn`,
`backend/internal/spotlightwealth`, and `backend/internal/crypto`, added under
`backend/tests/{learn,spotlightwealth,crypto}/` as external `_test` packages
(exported-API-only), following the house pattern established in
`backend/tests/association/` and `backend/tests/marketplace/`.

No internal module code was modified. No git commit/checkout was run.

## Files added

- `backend/tests/learn/quiz_scoring_test.go` — DB-free scoring/serialization invariants
- `backend/tests/learn/live_db_integration_test.go` — skip-gated live-DB tests
- `backend/tests/spotlightwealth/reward_invariants_test.go` — DB-free reward/leaderboard invariants
- `backend/tests/spotlightwealth/live_db_integration_test.go` — skip-gated live-DB tests
- `backend/tests/crypto/swap_invariants_test.go` — DB-free swap economics/idempotency invariants
- `backend/tests/crypto/withdrawal_fsm_test.go` — DB-free withdrawal state-machine invariants
- `backend/tests/crypto/live_db_integration_test.go` — skip-gated live-DB tests (swap + withdrawal)

## Invariants covered

### learn (quiz scoring)
- `QuizPassRatio` locked at exactly `0.7` (model.go:100).
- Pass/fail boundary is **inclusive** (`>= 0.7`): 7/10 (exactly 0.7) passes, 6/10 fails; 3/3 passes, 2/3 (0.667) fails.
- Empty quiz (0 questions) never reports `passed=true` (the `total > 0` guard).
- An unanswered question scores as wrong, never as correct.
- An answer referencing a nonexistent option id never scores as correct.
- `QuizAnswers` is structurally `map[questionID]optionID` — no field through which a client could assert correctness.
- **Answer key never serialized**: `GetQuiz`'s client-facing path (`withKey=false`) forces every option's `Correct` to `false`, regardless of the DB's real `is_correct` value; only `SubmitQuiz`'s internal scoring load (`withKey=true`) retains it, and `QuizResult` (the only thing returned to the client) has no field capable of carrying it out.
- Live: `GetQuiz` never leaks `is_correct=true` end-to-end; `SubmitQuiz` scores authoritatively and persists exactly one `learn_quiz_attempts` row + one audit call; unauthenticated `SubmitQuiz` is rejected with zero rows written; `GetLesson` marks progress idempotently and `ProgressPct` advances correctly (0% → 50% → 100%).

### spotlightwealth (challenge rewards + leaderboard)
- `koboToMoney` conversion (`kobo/100.0`) is exact across representative amounts; `DefaultCurrency == "NGN"`.
- **Reward idempotency**: retrying `CompleteChallenge` with the same Idempotency-Key results in exactly one ledger credit and one `spotlight_reward_ledger` row — enforced primarily by the guarded `JOINED→COMPLETED` state transition (`RowsAffected==1` only on the first call), with the ledger/DB idempotency keys as a second line of defense.
- Documented (not silently assumed) that the reward table's `ON CONFLICT (idempotency_key)` dedups per-key, not per-membership — the state-machine guard is what actually prevents a double-payout race.
- A zero-reward challenge completes the membership state but posts nothing to the ledger or reward table.
- A caller who never joined is forbidden before any state change or ledger call.
- Reward credit is sourced from `paymax_revenue` via `ledger.Credit`, never minted; reference string format (`spotlight:reward:<id>`) locked.
- **Leaderboard ranks learning points, never profit**: rank mirrors `ORDER BY points DESC`; the caller's own row is relabeled `"You"` without altering its rank/points; `LeaderboardEntry`'s exported shape (`Rank`, `DisplayName`, `Points`) is structurally incapable of carrying a profit/gains field.
- `RewardWallet` balance is proven to be a live `SUM` over credits (positive) and redemptions (negative), never a mutated counter; empty history yields balance `0`.
- Live: idempotent retry proven against a real ledger (wallet balance increases by exactly the reward amount once, not twice); join-then-complete happy path; missing-join forbidden; missing Idempotency-Key rejected; zero-reward challenge; ended-challenge join rejection; leaderboard ordering + "You" labeling against real seeded rows.

### crypto (swap + withdrawal)
- `unitsForCash` / `cashForUnits` truncate toward zero (never round up / over-credit) and are guarded against zero price/scale.
- `DefaultSwapSpreadBps == 50` (0.50%); the 50bps computation is locked against a hand-computed example.
- **Swap net-zero wallet invariant**: for representative swaps, `cashKobo - netCash - spreadKobo == 0` — the wallet's net movement across the three ledger legs (sell credit, buy debit, spread debit) is always exactly zero; nothing is minted.
- **Spread to revenue**: the spread leg is exactly `cashKobo - netCash` and is strictly less than the gross proceeds; it is debited to `paymax_revenue`, never returned to the wallet.
- Swap rejects same-asset swaps, non-positive `fromUnits`, and missing Idempotency-Key (checked before pricing).
- **Swap idempotency**: retrying with the same key moves both holdings exactly once and posts all three ledger legs exactly once; an oversell is rejected before any ledger interaction (zero posts, zero holding movement).
- **Withdrawal state machine** (`requested→pending→broadcast→confirmed|failed`): exhaustive 5×5 transition matrix locked (6 legal edges only); every non-terminal state has `failed` as an escape hatch; terminal states (`confirmed`, `failed`) have zero outgoing edges; dangerous illegal jumps (skip-ahead, revive-after-failed, un-confirm, backward transitions, re-fail) explicitly rejected.
- `networkFeeUnits` (0.05%, floored at 1 minor unit) locked; a withdrawal too small to clear the fee is rejected.
- **Whitelist requirement**: an address belonging to a different asset, or one that is inactive/not-owned, is never resolved as a valid withdrawal destination (enforced by the `GetAddress` query shape itself).
- **Units parked on create, returned on failed, burned on confirmed**: parking decrements the holding by exactly the withdrawal amount; failing restores it exactly; confirming leaves it burned (no restoration) — the asymmetry between `failed` (compensating) and `confirmed` (permanent) is explicitly locked so a future regression can't accidentally return units on both paths (which would double-credit).
- Withdrawal creation is idempotent: same key parks units exactly once and returns the same withdrawal id.
- Live: swap proven end-to-end against a real ledger (wallet balance unchanged by the swap itself, both holdings move by the exact amounts, retry is a full no-op, exactly one `crypto_swap_orders` row); oversell rejected with holdings unchanged; withdrawal against a non-whitelisted address rejected; full withdraw→broadcast→confirm cycle with holding-decrease verification, confirmed-units-stay-burned verification, and rejected double-confirm; idempotent withdrawal creation; over-withdrawal rejection.

### Known gap surfaced (flagged, not fixed — out of this agent's edit boundary)
`TestPriceSwap_LargeWholeUnitCountOverflowsInt64_KnownGap` (in
`swap_invariants_test.go`) proves that `cashForUnits`/`unitsForCash`'s
`units * priceKobo` intermediate product **silently overflows int64** for a
realistic case (1.0 BTC at `MinorUnitScale=1e8`, price ₦90,000,000 → product
≈9×10²²  vs. int64 max ≈9.22×10¹⁸), producing a silently wrong (wrapped)
result instead of failing closed. This is flagged as a **HIGH-severity,
go-live-blocking finding** for `ledger-auditor`/`security-reviewer` follow-up
— the test is written to intentionally FAIL once the gap is fixed, forcing a
conscious update rather than a silent pass/fail flip. No source file was
touched to fix this (out of boundary for this QA pass).

## DB-free vs. live-DB test counts

| Package | DB-free tests (run in CI, no DB) | Live-DB tests (skip-gated on `DATABASE_URL`/`TEST_DATABASE_URL`) |
|---|---|---|
| learn | 12 (incl. subtests) | 5 |
| spotlightwealth | 15 (incl. subtests) | 6 |
| crypto | 23 (incl. subtests) | 6 |
| **Total** | **50 passing, 0 failing** | **17 skipped (no DB configured in this environment)** |

## Build / vet / test evidence

Environment: portable Go 1.25.0 (`go1.25.0 linux/amd64`) installed to
`/tmp/go125`, `GOFLAGS=-buildvcs=false`, isolated `GOCACHE`/`GOMODCACHE`.

```
$ cd backend && go build ./tests/... 
(no output — success)

$ go vet ./tests/{learn,spotlightwealth,crypto}/...
(no output — success)

$ go test ./tests/{learn,spotlightwealth,crypto}/...
ok  	spotlight/backend/tests/learn	(cached)
ok  	spotlight/backend/tests/spotlightwealth	(cached)
ok  	spotlight/backend/tests/crypto	0.028s
```

Verbose run confirms **50 `--- PASS`**, **17 `--- SKIP`** (all live-DB tests,
skipping cleanly with the bring-up-note message because no
`DATABASE_URL`/`TEST_DATABASE_URL` is set in this environment), **0
`--- FAIL`**.

## Bring-up note (to actually run the live-DB tests)

1. Apply migrations for the three modules plus `finance/ledger` (standing
   accounts, journal tables) to a **disposable** Postgres — never production.
   `supabase db reset` against the local instance (port 54322) is the safest
   target:
   ```
   export DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
   ```
2. Run per-package:
   ```
   cd backend && go test ./tests/learn/...           -run LiveDB -v
   cd backend && go test ./tests/spotlightwealth/...  -run LiveDB -v
   cd backend && go test ./tests/crypto/...           -run LiveDB -v
   ```
3. Every row created by these tests uses a fresh `uuid.New()` id (or a
   symbol suffixed with a fresh UUID for crypto assets, upserted via the
   exported `AdminConfigAsset` path) — no truncation, no shared fixtures, safe
   to re-run repeatedly against the same test database.
