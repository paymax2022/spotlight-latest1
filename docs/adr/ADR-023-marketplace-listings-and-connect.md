# ADR-023 — Marketplace: escrow → listings-and-connect directory

**Date:** 2026-07-05  
**Status:** Accepted  
**Deciders:** Platform team · Product · Trust & Safety  
**Supersedes (in part):** the escrow-marketplace design of
`ADR-021-marketplace-mobile-and-gaps.md` and the escrow order/dispute money-path it
built on. PRD: `docs/prd/marketplace/`. Contract: `contracts/openapi.yaml`
(tags `[Marketplace]` / `[MarketplaceAdmin]`).

## Context

The Marketplace shipped as a peer-to-peer **escrow** marketplace: a buyer created an
order, funded it into a ledger escrow account, the seller accepted and dispatched, the
buyer confirmed delivery (or auto-release fired), escrow released to the seller minus a
platform fee, and disputes could freeze the release for admin adjudication. This is the
highest-risk surface in the whole app — it holds member money in flight, runs a
four-state order FSM plus a dispute FSM with dual-approval, drives two inbound
HMAC webhooks (logistics POD + payment funding), and emitted purchase-settled/refunded
events into the Direct Referral Rewards engine (ADR-022).

Product has **re-scoped the Marketplace to a listings-and-connect directory**: "no
escrow management; the function is just to list the services and connect both parties."
The platform no longer holds funds or mediates the transaction. Sellers list services;
buyers browse, search, save, and make **non-binding** offers/contact; the two parties
then agree and transact **off-platform**. This removes the entire money-path from the
Marketplace module.

## Decision

1. **Remove the escrow/order money-path (functional removal = unregister routes).**
   The following are unregistered in `backend/internal/app/marketplace_routes.go`:
   - Orders: `POST /orders`, `GET /orders`, `GET /orders/{id}`,
     `POST /orders/{id}/{fund,accept,confirm-delivery,cancel,dispute,review}`.
   - Disputes: `GET /disputes/{id}`, `POST /disputes/{id}/{evidence,appeal}`.
   - Escrow webhooks: `POST /webhooks/logistics/delivery-confirmed`,
     `POST /webhooks/payments/funding-confirmed` (these drove the order FSM).
   - Admin dispute/order: `GET /admin/disputes/queue`, `GET /admin/disputes/{id}`,
     `POST /admin/disputes/{id}/{decide,approve}`, `GET /admin/orders/aging`.

   The unregistration IS the removal. The underlying order/dispute FSM code
   (`service_order.go`, `service_dispute.go`, `fsm_order.go`, `fsm_dispute.go`, their
   handlers and admin handlers, the two webhook handlers) is left in the package as
   **unreachable dead code** rather than deleted, because it is not cleanly contained
   (shared model/repository/error/audit files) and deleting it risks touching more than
   the money-path. No route reaches it, so it cannot run.

2. **Referral-rewards emit removed from the Marketplace.** A prior integration
   (ADR-022) wired a `ReferralEmitter` into the escrow settle/refund path. With no
   escrow release there is nothing to settle a reward against, so:
   - the `referralEmitter` field, the `ReferralEmitter` interface, and the
     `WithReferralEmitter` method are removed from `marketplace.Service` (`service.go`);
   - the `emitPurchaseSettled`/`emitPurchaseRefunded` helpers and their call-sites in
     `releaseToSeller`/`refundToBuyer` are removed (`service_order.go`); the
     `finance/referrals` import is dropped from the marketplace package entirely.
   - **`RegisterMarketplace` keeps its `referralRewards *referrals.RewardService`
     param** but the body now discards it (`_ = referralRewards`). This is deliberate:
     `router.go` still calls `RegisterMarketplace(..., referralRewardsSvc)`, and
     `router.go` is a protected/non-owned file. Keeping the param a no-op lets
     `router.go` compile unchanged. (The maplerad/bills referral emit in
     `finance_routes.go` is untouched — that is a different service.)

3. **Offers become non-binding contact/negotiation.** `POST /offers` and
   `POST /offers/{id}/{accept,counter,decline}` stay. `AcceptOffer` already only
   flips the offer to `accepted` (via `transitionOffer`) with **no order side-effect** —
   the escrow order was only ever created by the now-removed `CreateOrder` reading an
   accepted offer's price. So an accepted offer now means only "the two parties agreed a
   price to meet on"; no money moves and no order is created. No code change was needed
   beyond documenting the guarantee in `service.go`.

4. **Reviews left unregistered until a non-order completion signal exists.**
   `SubmitReview` was gated on `order.status = released` (an escrow-completed order).
   With no orders there is no valid completion signal, so `POST /orders/{id}/review`
   is **not re-registered** (the lightest correct option — re-registering it would
   expose an endpoint that can never satisfy its own guard). Seller review **reads**
   (`GET /sellers/{id}/reviews`) stay live so any pre-existing reviews remain visible.
   Re-introducing review writes is deferred until a non-order "deal completed" /
   "mark met" signal is designed.

5. **DB is additive-only.** `mkt_orders` and `mkt_disputes` (and the related
   dispute-evidence / review-by-order tables) are **not** dropped — they are simply
   unused now. The seeded RBAC permissions `marketplace.admin.dispute.review`,
   `.dispute.decide`, `.dispute.approve`, and `.orders.aging` are left in place
   (additive-only) but no longer guard any live route.

## What stays (the whole remaining product)

Read/discovery: `GET /listings/{id}`, `/search`, `/categories`, `/categories/{id}`,
`/sellers/{id}/{profile,listings,reviews}`, `/boosts/tiers`. Listings CRUD +
lifecycle: `POST/PUT/DELETE /listings`, `/listings/{id}/{submit,pause,resume}`,
`POST /media/presign`. Offers (non-binding, above). Boosts (`POST /boosts`,
`GET /boosts/{id}` — wallet-funded promotion, kept). Saved searches, saved items,
reports, blocks, notification-prefs, verification, meetup safe-spots. Admin: moderation
queue, listing approve/reject, flags, audit-log, boost reject.

## Consequences

### Positive
- The highest-risk money surface in the app is gone: no funds held in flight, no order
  FSM, no dispute adjudication, no dual-approval, no escrow webhooks, no referral emit
  off marketplace margin. The remaining module is CRUD + discovery + promotion.
- Additive-only: no tables dropped, no schemas deleted, RBAC perms retained — zero
  migration risk and trivially reversible if escrow is ever re-introduced.
- `router.go` compiles untouched (no-op referral param), so a protected file is not
  edited.

### Negative / trade-offs
- **No buyer protection.** The model is now **Meetup Mode / off-platform** by design:
  parties transact directly with no escrow, no delivery confirmation, and no dispute
  recourse from the platform. Fraud/no-show risk moves entirely off-platform. Trust &
  Safety mitigations (verification badges, reports, blocks, meetup safe-spots, listing
  moderation) remain but are advisory — they do not guarantee a transaction. This is an
  accepted product trade-off for the directory model, not an oversight.
- Dead code and unused tables/perms remain in the tree (order/dispute FSM, `mkt_orders`,
  `mkt_disputes`, `dispute.*`/`orders.aging` perms). This is intentional under
  brownfield/additive-only safety; a later cleanup pass may remove them once the pivot
  is confirmed permanent.

### Deferred
- Review writes, pending a non-order "deal completed" completion signal (§4).
- Physical deletion of the order/dispute code and tables, if/when the pivot is locked in.
- Any "connect" affordance beyond offers (e.g. in-app contact/chat) is out of scope here.
