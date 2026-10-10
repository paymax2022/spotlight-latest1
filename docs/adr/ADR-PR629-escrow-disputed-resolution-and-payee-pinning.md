# ADR-PR629: DISPUTED resolves only via Arbitrate, and the release payee is pinned at hold time

## Status
Accepted (implemented in PR #629).

## Context
Two related gaps existed in `internal/escrow`:

1. **Arbitrate(RELEASE) was dead code.** `Arbitrate` takes a `decision` of RELEASE or
   REFUND, but `Release` requires a payee (the credit destination) and `Arbitrate`'s
   signature carried none. Its RELEASE branch could only reach a code path that always
   failed or credited a guessed party, so every dispute was effectively resolved by
   refund regardless of the arbitrator's ruling.
2. **Direct Release/Refund could close a DISPUTED hold.** A caller could bypass an open
   dispute by invoking the direct endpoints, resolving the money while an arbitration was
   in flight.

The crash-recovery work in the same lane also exposed that `p2pmarket` (the real caller)
is the layer that knows who the seller is; `internal/escrow` only knew payer + order.

## Decision
Pin the release payee **at hold time**, and make DISPUTED fail-closed to anything but
arbitration.

- `HoldWithPayee(ctx, tx, orderID, payer, payee, amount, idem, meta)` stores `payee_id`
  on the `escrow_holds` row (new `payee_id` column). `Hold` keeps its signature and
  delegates with an empty payee for legacy/zero-party callers.
- `p2pmarket` passes the listing's `seller_id` as payee on checkout holds, so the
  arbitration RELEASE path has a real, seller-bound destination — not an
  order-derived guess.
- `Release` and `Arbitrate(RELEASE)` require a non-empty stored `payee_id`; a hold
  without one fail-closes (returns the zero-payee sentinel) rather than fabricating a
  destination. `Refund` ignores the pin — the payer is still always the refund target.
- `RaiseDispute` on a DISPUTED hold is a party-only idempotent no-op: the caller must
  be buyer or seller, otherwise `ErrNotParty` — no existence oracle on the replay path.
- Direct `Release`/`Refund` on a DISPUTED hold fail-closed with
  `ErrResolutionInFlight`; the only way out of DISPUTED is `Arbitrate`, which is
  itself idempotent for replayed identical decisions.
- Payee pinning is one-shot: it cannot be overwritten after hold creation, and the pin
  write is audit-logged (`escrow.payee.pin`).

## Consequences
- Arbitrators can now actually rule RELEASE — the decision is no longer silently
  refunded.
- A foreign payer cannot pin themselves via idempotency replay on a same-key hold from
  a different module — the heal-path validates both journal legs (PR #608) and the pin
  only writes when absent.
- Residual accepted race (ledger-audit F1): between `holdReferenced` and `Refund` in
  p2pmarket checkout there is a narrow window where a refund can land while a checkout
  order references the hold — the money direction stays correct (payer refunded), but
  an order row can momentarily reference a refunded hold. A trigger or serialized
  lookup is the follow-up if it ever matters in practice.
- `payee_id` is a new column; migration is additive-only per repo policy.
