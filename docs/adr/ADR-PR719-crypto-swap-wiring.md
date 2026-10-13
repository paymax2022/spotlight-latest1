# ADR-PR719: Crypto swap wiring — separate flag, fail-closed assembly, PIN second factor

Status: accepted (flag-off)

## Context
The swap pipeline (ADR-PR708/709/710/716) is library code. Mounting it exposes money movement and an
unauthenticated webhook, so how it is assembled and gated matters as much as the code.

## Decision
- **Its own flag.** `FEATURE_CRYPTO_SWAPS_ENABLED` (default off) on top of `FEATURE_CRYPTO_ENABLED`, which still
  guards the legacy mock-priced module. The two modules coexist; the swap routes live under `/crypto/swaps/...` and do
  not collide with the legacy `/swap`.
- **Fail-closed assembly.** `cryptosvc.Wire` returns an error — and the app mounts nothing — if the provider is not
  `quidax`, the key or webhook secret is missing, any service is nil, or the fee schedule is invalid. Outside dev,
  `Config.Validate` also refuses to boot with the flag on and no webhook secret or a tiny lock pool.
- **Second factor on confirm.** The user's transaction PIN (the wallet's existing PIN service) is required. An absent PIN
  is rejected as a bad request *before* verification so it can never count toward the 5-strike lockout; the swap is
  checked to exist and belong to the caller before the PIN is spent. A nil step-up refuses confirm.
- **Trade gate.** Active, non-deleted account and KYC tier >= 1; an unknown user or lookup error refuses.
- **Webhook.** Authenticated only by the provider signature (verified in `Ingest`), body-size limited, 200 on success and
  duplicates, 401 bad signature, 404 unknown provider, 500 on any processing failure so the provider redelivers.
- **No leakage.** Responses are integer kobo and decimal-string crypto amounts; provider ids, the provider account, the
  idempotency key and any provider/database error text never reach the client; another user's swap is 404.
- **Operational:** the lock pool is dedicated (`CRYPTO_LOCK_POOL_CONNS`, default 40) on a direct or session-mode DSN; the
  reconciler runs in-process on every replica but only the elected leader works; alerts go to the log sink for now.

## Hardening from the independent security + money review (no blockers)
- **In-process gate before the distributed lock.** Identical requests for one swap queue in memory
  (`keyedGate`), so a user firing ~40 parallel confirms cannot pin the whole lock pool. The reconciler's
  leader lock lives on its own small pool, so confirm floods cannot starve leader election.
- **Audit events** (`crypto_audit_log`) for quote, hold, executed, released, parked, failed, completed and PIN
  rejection; provider-driven transitions use actor `system:provider`. A PIN or secret is never written. Audit write
  failures are logged as alerts and never fail the money path.
- **Input bounds:** swap ids must be UUIDs (else 404, no database cast error, no PIN spent), `ngn_kobo` is capped at
  `MaxQuoteKobo` (10 bn NGN) so it can neither overflow nor reach the provider as an absurd amount, and the
  Idempotency-Key is limited to `[A-Za-z0-9._:-]{1,255}`.

## Known and deferred
- **PIN lockout is not race-safe** (existing `transfers` PIN store reads then writes the failure count): concurrent
  wrong guesses can score more attempts than the 5-strike limit before the lock lands. Pre-existing and shared with
  wallet transfers; tracked as a follow-up to make `Verify` atomic. Until then confirm inherits it.
- No per-user rate limit on quote/confirm yet (the in-process gate bounds lock-pool pressure only).
- `Wired.Close` is not hooked into process shutdown (the reconciler intentionally lives for the process).

## Not decided here
Per-user rate limiting, an admin screen for `needs_review`, sells and deposits, a real alert sink, and the Quidax webhook
facts that only a sandbox delivery can confirm (event name, signature header format, timestamp unit).
