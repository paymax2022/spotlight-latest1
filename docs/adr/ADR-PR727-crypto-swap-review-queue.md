# ADR-PR727: Crypto swap review queue + state-gated resolution for parked needs_review swaps

Status: accepted (flag-off)

## Context
The provider-driven swap pipeline (ADR-PR708/709/710/716/719, `backend/internal/cryptosvc`,
table `crypto_swaps`) parks swaps it cannot auto-resolve in `needs_review` with the user's NGN
**held** in the ledger. Nothing on the admin dashboard could see them. The only admin crypto
routes belong to the *legacy* `backend/internal/crypto` module and read a different table
(`crypto_swap_orders`); the new pipeline's parked money sat with no operational surface at all.

The need is "ops must be able to see held money fast". Actually *resolving* a parked swap is a
separate, money-mutating decision — and the safe set of actions depends on the swap's state.

## Decision
- **A read-only review queue** (`GET /admin/crypto/swaps/review`): `Store.ListByState` →
  `Service.ListByState` → a `crypto.admin` handler, oldest-parked first. It mutates nothing, so it
  needs no ledger posting or tier gate — a `SELECT`. It surfaces `held_kobo`, the asset, age and
  `has_provider_id` so ops can see held money and tell the dangerous rows apart.
- **State-gated resolution, never a manual settle** (`POST /admin/crypto/swaps/{id}/resolve`,
  `Service.AdminResolve`). The resolution set depends on provider state and is enforced server-side:
  - parked **with** a `provider_swap_id` → `retry` only: re-poll the provider via the existing
    `Ingest.ResolveSwap`, which settles the crypto or releases the hold itself. `release` is refused
    (`ErrReleaseUnsafe`) — a blind release could pay the user back *and* still deliver the crypto.
  - parked **without** a `provider_swap_id` → `release` only: the provider outcome is unknown, so
    reverse the NGN hold back to the wallet (`Settler.FailBuy`) and move the swap to `failed`.
    `retry` is refused (`ErrNothingToRetry`) — there is nothing to poll.
  There is deliberately **no manual settle/capture**: we never credit crypto we cannot prove was
  bought. The member view hides `provider_swap_id`; the admin view exposes it, gated by `crypto.admin`.
- **Idempotent and locked.** The whole decision runs under a per-swap `"resolve:"+id` lock (a
  different key from the settler's own `swapID` lock, so no re-entrancy). `FailBuy` is itself
  idempotent (no-op without a live hold or when already released; refused once the fee is recognised),
  and the `needs_review → failed` transition is conditional, so a repeat release cannot double-credit —
  a second attempt simply finds the swap no longer parked (`ErrNotParked`). An `Idempotency-Key` header
  is required per the money-path iron rule, and a non-empty operator note is required for the audit
  trail (`crypto.swap.admin_release` / `crypto.swap.admin_retry`).
- **A second admin group on the same prefix, not an extension of the legacy module.** The two
  swap tables are disjoint, so the queue is served by `cryptosvc.RegisterAdminRoutes` mounting
  `GET /api/v1/admin/crypto/swaps/review` under the same `/api/v1/admin/crypto` prefix as the
  legacy admin routes. `/swaps/review` is a static sibling of the legacy `/swaps`, so the Gin
  route tree does not collide (guarded by a test). Reusing the prefix keeps the frontend-admin
  proxy/service/RBAC convention (`crypto.admin`) intact.
- **Admin view exposes `user_id` and `provider_swap_id`.** The member `SwapView` hides both; the
  admin surface needs them to act on held money and is gated by the `crypto.admin` permission.
- **Flag-gated.** The route is only mounted when `FEATURE_CRYPTO_SWAPS_ENABLED` is on (the same
  gate as the rest of the pipeline); when off it 404s and the console shows an empty queue.
- **Ordering + bounds.** Oldest parked first (`updated_at` asc, `id` tiebreak) so longest-held
  money surfaces first; `limit` is clamped to `[1,200]`, `offset` to `>= 0`, so a hostile query
  cannot widen the page.

## Safety / invariants
- Money fields stay **integer kobo**; `held_kobo = ngn_kobo + fee_kobo` is display addition only.
- **Additive-only, no migration**: `crypto_swaps` already has an RLS `SELECT` policy allowing
  `is_admin()` and a `(status, updated_at)` partial index covering `needs_review`.

## Known and deferred
- **Fixture mode refuses resolve.** The frontend-admin service (`USE_MOCK`) refuses to simulate a
  resolve rather than report a money movement it did not perform (per ADMIN_SIMULATED_WRITES.md);
  the live backend is the only path that mutates money.
- **Retry re-poll is bounded by the provider.** If the provider is unreachable, retry surfaces the
  provider error and leaves the swap parked (no state change) — correct, but a repeatedly stuck
  provider still needs manual attention; alerting remains the reconciler's log sink for now.
