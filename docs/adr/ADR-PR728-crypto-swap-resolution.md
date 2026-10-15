# ADR-PR728: Crypto swap resolution — state-gated release/retry for parked needs_review swaps, never a manual settle

Status: accepted (flag-off)

## Context
ADR-PR727 added a read-only admin queue of swaps the provider-driven pipeline
(`backend/internal/cryptosvc`, table `crypto_swaps`) parked in `needs_review` with the user's NGN
held in the ledger. Ops could see held money but not act on it. This ADR covers the resolution
action: `POST /api/v1/admin/crypto/swaps/{id}/resolve`.

Resolving a parked swap moves real money, and the *safe* action depends on how far the swap got
with the provider — so the decision set cannot be a free choice.

## Decision
- **The resolution set is gated by provider state, enforced server-side in the handler/service (not
  just the UI):**
  - parked **with** a `provider_swap_id` → `retry` only. Re-poll the provider via the existing
    `Ingest.ResolveSwap`, which applies the authoritative outcome (settles the crypto or releases the
    hold itself). `release` is refused (`ErrReleaseUnsafe`, HTTP 422) — the provider received the
    swap, so a blind release could pay the user back *and* still deliver the crypto (double spend).
  - parked **without** a `provider_swap_id` → `release` only. The provider outcome is unknown, so
    reverse the NGN hold back to the user's wallet (`Settler.FailBuy`) and move the swap to `failed`.
    `retry` is refused (`ErrNothingToRetry`, HTTP 422) — there is nothing to poll.
- **No manual settle/capture exists.** The decision enum is `release | retry` only; there is no path
  that marks a swap completed. We never credit crypto we cannot prove was bought.
- **Concurrency / idempotency.** `Service.AdminResolve` runs under a per-swap `"resolve:"+id` lock
  (a different key from the settler's own raw-`swapID` lock, so no re-entrancy/deadlock) and re-reads
  the swap state *inside* the lock. `FailBuy` is release-idempotent (no-op without a live hold or
  when already released; refused once the fee is recognised), and the `needs_review → failed` move is
  a conditional CAS whose `applied` result is checked — the release audit event is written only when
  this call actually performed the transition, so a lost race never records a release it did not do.
  A repeat resolve therefore converges: the second attempt finds the swap no longer parked
  (`ErrNotParked`, HTTP 409). A release-eligible swap (no provider id) can never be targeted by a
  provider webhook (webhooks route by `provider_swap_id`), so its release has no racing settler.
- **Auth, flag, audit.** Mounted behind `crypto.admin` + `FEATURE_CRYPTO_SWAPS_ENABLED`. An
  `Idempotency-Key` header and a non-empty operator note are mandatory; both the key and the note are
  recorded on the audit event (`crypto.swap.admin_release` / `crypto.swap.admin_retry`).
  `Store.SwapByIDAny` (no user scoping) is reachable only from this admin path.

## Known and deferred
- **`Idempotency-Key` is request-tracing, not the dedupe authority.** Dedupe is structural — the
  deterministic ledger key (`crypto:swap:<id>:release`) plus the conditional state transition — so
  two *different* keys on concurrent requests are still safe (locks + CAS), but the header does not by
  itself collapse replays. It is validated (absence is refused) and recorded; a dedicated attempt
  table could make it authoritative later.
- **`Settler.FailBuy` fee-guard is fee-gated (pre-existing, not reachable here).** `failBuy` refuses a
  release after settlement only when `FeeKobo > 0`; a *completed zero-fee* buy posts no fee leg, so at
  the ledger level it looks unsettled. This is NOT reachable from admin release (a completed swap has a
  provider id → `ErrReleaseUnsafe`, and is terminal → `ErrNotParked`), so the admin path is safe, but
  `failBuy` itself relies on the caller's guards for zero-fee completions. Hardening `failBuy` to
  detect completion independent of fee is a follow-up for the settlement module.

See ADR-PR727 for the read-only queue this builds on.
