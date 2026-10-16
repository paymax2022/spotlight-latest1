# ADR-PR727: Crypto swap review queue — read-only admin surface for parked needs_review swaps, resolution deferred

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
- **Ship a read-only surface first (this PR); defer resolution to a follow-up.** Round 1 is a
  review *queue* only. It mutates nothing, so it needs no ledger posting, no idempotency key and
  no tier gate — it is a `SELECT`. This gets ops visibility of held money without the risk of a
  money-path endpoint, and keeps the PR small.
- **Resolution is state-dependent, so it is not inventable here.** A swap parked *with* a
  `provider_swap_id` can be re-polled/retried (the existing `Service.Resolve`/`Ingest` path). A
  swap parked *without* one has an **unknown provider outcome**: we cannot prove the provider
  executed, so the only safe human action is to **release** the hold back to the user — a manual
  "settle/capture" there would credit crypto we cannot confirm was bought. That is a money-path
  policy call for a follow-up PR (tests-first + ledger-auditor review). The view surfaces
  `has_provider_id` so the dangerous rows are distinguishable now.
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
- **No resolution yet.** Ops can see parked money but not act on it from the dashboard. Follow-up:
  `POST /admin/crypto/swaps/{id}/resolve` with a `release | retry` decision (settle only if a
  later policy call permits it for provider-id-bearing swaps), mandatory note + Idempotency-Key,
  audit event, mirroring the withdrawals/addresses decision UIs.
