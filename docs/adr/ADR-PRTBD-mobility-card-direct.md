# ADR-PRTBD-mobility-card-direct: Card-direct (Paystack-funded) checkout for every Mobility service

- **Status:** Accepted — foundation + parcel + towing + movers + car hire (narrow scope, see "Car hire (implemented)") implemented; bus and event transport deferred (table below)
- **Date:** 2026-10-07
- **Module:** transport (Mobility) / `backend/internal/transport/paystackcheckout`
- **Supersedes the pattern of:** wallet-top-up-then-spend for Mobility cards (the "card rail" inside `usePurchasePayment`)
- **Siblings:** `restaurant/paystackcheckout`, `estate/paystackcheckout`, ride `transport/paystackcheckout/service.go`

## Context

A rider/sender who picks **debit card** in Mobility must never see the wallet's
"Verification needed" (KYC-tier) gate. Today only instant ride-hailing has a
true card path. Every other Mobility service (parcel, bus, towing, car hire,
movers, event transport) uses `usePurchasePayment`'s built-in card rail, which
tops the **wallet** up with the card and then spends from it — so a Tier-0
user's card money lands in a wallet the tier gate forbids them to spend (this
is the exact failure ADR-041 / the checkout-allowance audit documented for food).

The proven fix is the *card-direct* shape already live for rides, food and
estate dues: Paystack collects the money directly (server-initiated), the
server verifies it, and the money is escrowed with `settlement.EscrowExternal`
(DR provider-clearing / CR escrow). No wallet leg exists, so there is nothing
for the tier gate to price — and the wallet rail keeps its gate unchanged.

## Decision

### 1. One shared engine, one thin adapter per service

`transport/paystackcheckout.Engine` (new, `engine.go`) owns everything that is
easy to get wrong; a service plugs in by implementing `Domain` (4 identity
strings + `Quote`, `Find`, `Book`) in its own file. The existing ride adapter
(`service.go`, table `transport_ride_paystack_intents`) is left byte-for-byte
as is; it can migrate onto the engine later with no API change.

```
POST /mobility/<svc>/paystack/initiate   (Idempotency-Key header REQUIRED)
  → Domain.Quote (server price only) → freeze {request, amount} in
    transport_paystack_intents → Paystack initialize(reference = "<prefix>:<key>")
GET  /mobility/<svc>/paystack/:reference/status        (owner only, 404 otherwise)
  → verify with Paystack → Claim → amount+currency check → Domain.Book → confirmed
webhook charge.success (prefix-routed) → the same OnChargeSuccess
cancel → transport.refundSettlement → engine refunder (gateway refund, then
         settlement.RefundExternal)  — never settlement.Refund (wallet credit)
```

### 2. Flags: one master + one per service

- `FEATURE_TRANSPORT_PAYSTACK_CHECKOUT_ENABLED` (existing, default off) = master:
  mounts rides (unchanged) **and** the shared engine + webhook seam.
- `FEATURE_TRANSPORT_PAYSTACK_PARCEL_ENABLED` (new, default off) = parcel domain.
  Reserved names for the follow-ups: `…_BUS_…`, `…_TOWING_…`, `…_CARHIRE_…`,
  `…_MOVERS_…`, `…_EVENT_…` (not read by code until their adapters land).
- A service flag is inert unless the master **and** `FEATURE_TRANSPORT_MODES_ENABLED`
  are on (its routes live in that block).

*Why per-service rather than one flag:* each lifecycle has different failure
modes (cancel windows, payout timing, partial refunds). Ops must be able to
roll one back (kill-switch) without turning off rides that are already live and
verified. Cost: one `bool` + one table row per service. Rejected: a single flag
(all-or-nothing blast radius), and per-service flags without a master (would
re-open the "route exists without a Paystack client" wiring hazard).

### 3. Data: one generic intents table (additive migration)

`20271008090000_transport_paystack_intents.sql` — `reference` PK, `domain`,
`payer_id`, frozen `request_json`, frozen `amount_kobo`, `idempotency_key`
(unique per domain), `status`, `entity_id`, stored `authorization_url`/`access_code`,
`refund_reference`, `claimed_at`. A new service needs **no schema change**.
No parcel-table migration: the funding rail is read from
`settlements.funding_source` (already written by `Escrow`/`EscrowExternal`),
not from a new per-entity `payment_method` column.

### 4. Idempotency and replay

| Situation | Behaviour |
|---|---|
| initiate, same key + same request | same reference; stored authorization URL re-served; **no second gateway initialize** (Paystack errors on a duplicate reference); **no re-quote** (frozen) |
| initiate, same key + different request or different user | `409 idempotency_conflict` — never silently served a different price |
| initiate after the key was paid | returns terminal `status`, empty URL (client polls instead of re-opening the gateway) |
| key shape | header only; `^[A-Za-z0-9._=-]{8,100}$` (it becomes part of a Paystack reference and a `/transaction/verify/<ref>` URL path — the ride adapter does not validate this; the engine does) |
| confirm: webhook + poll + retry race | `Claim` is an atomic UPDATE; exactly one caller books. A `processing` claim older than 2 min is re-claimable (crash between claim and mark would otherwise strand a paid charge); safe because `Book` is required to be idempotent |
| settlement/entity idempotency keys | the engine passes the **namespaced** key (`parcelorder:<key>`), so it can never collide with another domain's or the wallet path's raw key |

### 5. Amount mismatch and failure-after-charge handling

1. Verify with Paystack server-side (`status == success`); a network failure is "keep polling", not a failure.
2. Currency: non-empty and not `NGN` ⇒ treated as a mismatch (empty = adapter didn't populate it, tolerated, per `provider.PaymentStatus`).
3. `collected != frozen quote` ⇒ **refund exactly what was collected, never book**.
4. `Book` independently **recomputes** the price and refuses (`AMOUNT_MISMATCH`, before any write) unless it equals the verified amount — pricing config can move between initiate and confirm.
5. `Book` fails ⇒ the engine calls `Domain.Find` **before** refunding:
   found ⇒ the booking exists (commit-then-error) ⇒ confirm, **never refund a charge that backs a booking**;
   not found ⇒ refund; `Find` itself errors ⇒ do nothing (stay `processing`; the stale-claim retry converges) — no refund on a guess.
6. Status honesty: `refunded` only if the gateway accepted the refund (`pending`/`processing`/`processed`). The refund is recorded as `refunding` BEFORE the gateway is called; a definite failure restores `amount_mismatch`/`order_failed`; an unknowable outcome stays `refunding` and is resolved by gateway lookup (see "Resolved after ledger audit" H4).
7. If `Book` posted the escrow and then failed, it reverses the escrow ledger-side (`settlement.RefundExternal`) — and the engine independently reverses the external settlement for the reference **before** the gateway refund (H6), so the books balance whatever `Book` managed to do (the ride path does not do this — see risks).

### 6. Refund on cancel

`transport.Service.refundSettlement(domain, entityID, settlementID, reason)` is
the **single** choke point for non-ride services. It reads
`settlements.funding_source`: `external` ⇒ the domain's registered
`ExternalRefunder` (`SetDomainExternalRefunder("parcel", engine.RefunderFor("parcel"))`);
otherwise `settlement.Refund` (wallet). Fail-closed: external with no refunder
wired ⇒ error + log, money stays escrowed, **never** a wallet credit.
The engine refunder first loads the settlement and requires it to BE this
intent's live external escrow (H3), then is **gateway first, ledger second**,
and resumable: the intent is marked `refunding` before the gateway call and
`refunded` once it is accepted, so a retry after a ledger failure skips the
gateway and finishes the reversal, and a retry after an ambiguous gateway reply
verifies by lookup before ever asking for a second refund (H4).
`CancelParcel` is re-POSTable to finish a refund that failed after the status flip.

### 7. Webhook routing

`webhooks.PaystackHandler.RegisterPrefixConfirmer(prefix, confirmer)` (new,
generic). The legacy per-module prefixes (`rideorder:`, `foodorder:`, …) still
win first, so a generic registration can never hijack an existing module's
money; `Engine.Register` panics on a duplicate name or overlapping prefix.
Adding a service touches **no** webhook code.

## Lifecycle verdict — which services may be card-direct

The test: *is the amount fixed and fully known when the card is charged, and can
every later money event be expressed as "refund the exact original charge" or
"settle escrow to the provider"?*

| Service | Verdict | Reason |
|---|---|---|
| Ride, instant | **Safe (already live)** | Fixed fare; refund-on-cancel = full escrow. |
| **Parcel** | **Safe — implemented here** | Fare fixed at booking (distance × size × speed); escrow held until dropoff PIN + proof; only post-booking money event is cancel ⇒ full refund. Insurance premium is indicative/separate and never in the charge. |
| **Towing** | **Safe** | Same shape as parcel: fare computed at booking, escrow, settle on completion, cancel ⇒ refund. |
| **Movers (accept-bid)** | **Safe, charged at bid acceptance** | The amount only exists once a bid is accepted. Quote = the accepted bid read server-side; initiate is bound to `bid id`; if the bid is withdrawn/expired before confirm, `Book` fails ⇒ the charge is refunded. Do **not** charge at request time. |
| **Car hire** | **Safe for a NARROW scope — implemented (flag off; see "Car hire (implemented)")** | One charge = fare + deposit held as two external settlements. Book, cancel BEFORE activation (both refunded to the card) and completion (fare settled, FULL deposit refunded to the card) are expressible as "refund one settlement's exact total" via the engine's piece-refund path. **Not** card-direct (wallet-only or refused for card bookings): extensions (a second charge), late-fee/damage deductions (no settlement primitive; excess over the deposit is uncollectable from a card), cancel-after-activation with a fare refund. Deposit return to a card takes days — product must accept that. |
| **Bus** | **Unsafe as-is — stay wallet-only** | `BookBusTicket` calls `Settle` **immediately on issue**: the money is paid out to the operator at booking, so there is nothing left in escrow to refund. (The wallet `CancelBusTicket` then calls `settlement.Refund` on a *settled* row, which returns an error that is swallowed with `_ =` — a pre-existing defect: cancel does not actually return money even for wallets.) Card-direct would turn that into a card-funded payout with no refund path. Needs a deferred-settlement (settle at boarding/departure) + a real cancel policy first. |
| **Event transport** | **Unsafe as-is — stay wallet-only** | Same as bus: escrow then `Settle` to the organizer inside `BookEvent`. |
| **Ride, offer mode** | **Unsafe — stay wallet/cash** | The held amount can change **after** booking (`RiderOffer`/`AcceptCounter` → `adjustEscrow`), and there is no live card session to charge the delta from. Card-direct requires a fixed price at charge time. The viable redesign is "negotiate first, pay on acceptance" (same shape as movers) — a lifecycle change, not an adapter. |
| Scheduled rides/parcels/buses | **Unsafe — stay wallet-only** | Escrow happens at dispatch time with no cardholder present; would need a saved card authorization. |
| Tips (`ratings.go`), business logistics (`logistics.go`) | Out of scope | Separate escrows/lifecycles; not in the brief. |

## What each remaining adapter must supply (fan-out table)

Every row is **one new file in `transport/paystackcheckout/` + one new file in
`transport/` + one `Feature…` bool in `config.go` + one row in the `domains`
table in `internal/app/transport_card_direct.go` + one `.env.example` line + one
mobile screen edit.** No change to `engine.go`, `store.go`, `webhooks.go`,
`external_funding.go` or the migration (except car hire's partial refund).

| Service | `Name()` / prefix / `RoutePrefix()` / `EntityIDKey()` | `Quote` must compute | `Book` = refactor of | `Find` key | Refund call site to swap to `refundSettlement(ctx, "<name>", id, settlementID, reason)` | Extra |
|---|---|---|---|---|---|---|
| towing | `towing` / `towingorder:` / `/towing/paystack` / `towingJobId` | `towingFare(distance, cfg)` (needs `Dest` route) | `BookTowing` (`towing.go:109`) → `bookTowing(…, external, verified, frozen)` — **done** | `towing_jobs.idempotency_key` | `CancelTowing` — **done** | `service_type` CHECK pre-flight; roadside = no route — **done** |
| movers | `movers` / `moversorder:` / `/movers/paystack` / `moveId` | accepted bid amount (server read; request carries the bid id) | accept-bid `movers.go:224` Escrow site — **done** (`acceptMoverBid`) | `settlements.idempotency_key` join (mover_jobs key is the creation key) | `CancelMover` — **done** (rail by `funding_source`) | re-check bid still acceptable inside `Book` — done (read + guarded commit) |
| car hire | `carhire` / `carhireorder:` / `/car-hire/paystack` / `bookingId` | fare + deposit (ONE charge, two legs; frozen config + legs) | `bookCarHire` (`car_hire.go`) — 2 `EscrowExternal`s, keys `<ref>:fare` / `<ref>:deposit` — **done** | `car_hire_bookings.idempotency_key` + payer | `CancelCarHireWithRefund` / `CompleteCarHireWithRefund` via `refundSettlement(ctx, "carhire", …)` — **done** | engine piece refunds (WP-A) + `CancelledRefundSweeper` hook — **done**; extensions refused for card bookings |
| bus | `bus` / `busorder:` / `/bus/paystack` / `ticketId` | schedule fare | `BookBusTicket` `bus.go:184` | `bus_tickets.idempotency_key` | `bus.go:199,306` | **blocked** until settle-on-board + real cancel policy |
| event transport | `event` / `eventorder:` / `/events/paystack` / `bookingId` | seats × offer price | `event_transport.go:196` | booking idempotency key | `event_transport.go:205-250,358` | **blocked**, same as bus |

(Prefixes must not overlap `rideorder: foodorder: duespay: feespay: parcelorder:`.)

## Tests required per domain (the bar parcel sets)

1. **Pure (fakes)** adapter test: identity strings, decode/validate-before-price, `Quote` uses server price only, `Book` passes the namespaced key + verified amount through, `Find` scoped to the payer, **route coexistence** with the service's wallet routes on the same gin group.
2. **Live-DB (gated on `TEST_DATABASE_URL`)** in `transport`: Tier-0 wallet path refused / card-direct succeeds; wallet balance unchanged; escrow journal balanced and `funding_source='external'`; amount mismatch (±1, 0, negative) writes **nothing**; replay books once; cancel uses the external refunder and never credits the wallet; no refunder ⇒ fails closed and retry completes; wallet-funded cancel still refunds the wallet.
3. **Live-DB end-to-end** in `paystackcheckout` (real Engine + PGStore + ledger, fake gateway): webhook+polls race ⇒ one booking; replay after paid ⇒ no gateway re-init; cancel ⇒ exact gateway refund + settlement `refunded` + ledger nets to zero; tampered amount ⇒ nothing booked + refund; claim exclusivity + stale reclaim in SQL.
4. Engine behaviours are covered once in `engine_test.go`; a new adapter must **not** re-test them.

## Mobile contract (mirrors `initiateRidePaystack` / `getRidePaystackStatus`)

```
POST /api/v1/mobility/<svc>/paystack/initiate     headers: Idempotency-Key
  body  : the service's normal booking body (snake_case) + optional email, callback_url.  NO amount.
  201   : { data: { reference, authorizationUrl, accessCode?, amountKobo, status } }
GET  /api/v1/mobility/<svc>/paystack/:reference/status
  200   : { data: { reference, status, amountKobo?, <entity>Id? } }
  status: pending | processing | confirmed | amount_mismatch | order_failed | refunding | refunded
```
Client: `PurchaseRequest.onCard` → `useGatewayCheckout().start({ domain, initialize, onResolved })`
→ `router.replace('/mobility/paystack/<svc>/<reference>')` → the route is a ~15-line
wrapper over the shared `CardDirectStatusScreen`, which polls (the poll *is* the
self-heal), and on `confirmed` navigates to the booked entity. Pure helpers live
in `utils/cardDirect.ts` (`node --test`-able, body builder asserts no money field).
`pay.start({ method: 'card', onCard })`: the sheet's built-in wallet-top-up card
handling is bypassed whenever `onCard` is supplied.

## Money-path risks for the ledger-auditor (original list — see "Resolved after ledger audit" below for the disposition of the audit's findings)

1. **Gateway-then-ledger refund ordering** (`domainRefunder.RefundExternalSettlement`): if the gateway refund succeeds and `Mark(refunded)` fails, the error says not to blindly retry — a retry would call the gateway a second time. Auditor: is that residual window acceptable, or should we mark `refunding` *before* the gateway call?
2. **Failed-Book ⇒ refund decision** relies on `Domain.Find`. For parcel `Find` = `parcels.idempotency_key` + sender. Verify the *absence* proof is sound under a concurrent `Book` that has escrowed but not yet inserted.
3. **Insert-failure compensation** in `bookParcel` calls `RefundExternal` only after `Find` says no parcel owns the key. The ride path (`requestRide`'s `refundOnFailure`) is a **no-op for external** — an insert failure there leaves an `escrowed` external settlement with no trip while the gateway charge is refunded ⇒ provider-clearing/escrow drift. Pre-existing; not fixed here (shared ride code).
4. **Disputes / admin refunds** on a card-funded parcel settlement call `settlement.Refund` ⇒ `ErrWrongRefundMethod` (fail-closed, good) — but there is then **no admin path** that issues the gateway refund; today it is a manual Paystack-dashboard + `RefundExternal` job.
5. **Partial courier payout then dispute** on card-funded escrow: `Settle` is source-agnostic (verified), refunds of an already-`settled` row are unsupported for both rails.
6. `amount_mismatch`/`order_failed` with a failed gateway refund are *terminal and unretried* — need a reconciliation sweep (query `status IN (…)` with `refund_reference IS NULL`).
7. Insurance premium is not in the charge (`parcel_insurance_*`): confirm the later real bind (`AcceptParcel`) still debits the **wallet** for the premium — for a Tier-0 card-direct sender that bind will hit the tier gate and skip cover cleanly (by design, "skip cover" not "fail booking"); product should know cover silently won't bind for them.

## Resolved after ledger audit

A `ledger-auditor` review of the shared engine found eight high and three low
findings. Each was fixed test-first (failing test written and watched fail, then
the fix). `Tests` names are Go test functions under
`backend/internal/transport/…` unless a path is given.

| # | Finding | Resolution | Tests |
|---|---|---|---|
| **H1** | Stale-claim takeover had no fence: a stalled former owner could overwrite its successor's / a terminal state, or refund twice. | `claim_gen` fence. `Store.Claim` returns it, every `Store.Mark` is `UPDATE … WHERE reference=$1 AND status=$from AND claim_gen=$fence` (0 rows ⇒ ownership lost; the engine re-reads and reports the successor's state, never its own). `BeginRefund` bumps it too. Book / Find / refund / final write run under a context **detached from the caller's cancellation** and bounded by `staleClaimAfter/2` per phase and by `claim + staleClaimAfter − 5s` overall (`claimWindow`), so an owner is dead before its successor can start. | `paystackcheckout`: `TestFence_StaleOwnerCannotOverwriteSuccessorsConfirmation`, `TestFence_StaleOwnerCannotRefundAfterSuccessorAlreadyRefunded`, `TestFence_BookRunsUnderBoundedContext`, `TestFence_RefundRunsUnderBoundedContext`; live-DB: `TestLiveDB_PGStore_FenceStopsStaleOwner` (claim, backdate 3 min, second claimer, old Mark = 0 rows, terminal not overwritten), `TestLiveDB_Engine_ConfirmedByStaleOwnerAfterTakeover_ReportsSuccessorState` |
| **H2** | `bookParcel` after an `EscrowExternal` replay trusted the replayed row: a *refunded* (or foreign / wallet) settlement could back a new parcel. | `EscrowExternal` now re-reads `payer_id` + `funding_source` (new `Settlement.FundingSource`); `bookParcel` requires `status==escrowed && payer==sender && funding_source=='external' && total==fare`, else errors (the engine then refunds the gateway; the ledger was already reversed). | `TestLiveDB_BookParcelPaystackFunded_ReplayOverRefundedSettlement_BooksNothing`, `…_ReplayOverForeignOrWalletSettlement_Refused`; `paystackcheckout`: `TestLiveDB_Engine_ReplayOverRefundedExternalSettlement_BooksNothing_RefundsGateway` |
| **H3** | `RefundExternalSettlement` called the gateway before looking at the settlement. | The settlement is loaded **first** and must be external-funded, bound to this intent (`idempotency_key == reference`, same payer, `total_kobo == intent amount`) and `escrowed`/`disputed`. Already-refunded settlement + refunded intent ⇒ `nil`; refunded settlement + un-refunded intent ⇒ error, **no gateway call** (manual). | `TestRefundExternal_SettlementValidatedBeforeTheGateway` (6 cases), `…_SettlementLookupFails_NoGatewayCall`, `…_BothAlreadyRefunded_IsANoOp`, `…_LedgerFails_RetrySkipsGatewayAndFinishesLedger` |
| **H4** | Gateway refund was not idempotent: lost reply ⇒ recorded as failure; "already reversed" ⇒ failure; adapter ignored the refund status. | New status `refunding`, set (fenced) **before** the gateway call, with `refund_from` (status to restore on a definite failure) and `refund_amount_kobo` (the COLLECTED amount on a mismatch). Ambiguous replies (timeout/5xx/"already reversed") are resolved with `EngineGateway.LookupRefund` (Paystack `GET /refund?reference=`): accepted refund found ⇒ `refunded`; failed ⇒ restore failure status; unknowable ⇒ stays `refunding` (reconciler). A retry of a `refunding` row looks up first. Adapter: `failed` ⇒ `provider.ErrRefundFailed`; "fully reversed/already refunded" ⇒ `provider.ErrAlreadyReversed`; `pending`/`processing`/`processed` accepted; a refund of a different amount is not success. A final-write failure after a successful refund leaves `refunding`, never a false failure. | `TestRefund_RefundingIsRecordedBeforeTheGatewayIsCalled`, `…_AcceptedButReplyLost_IsRecordedAsRefunded_NotAsFailure` (mismatch + order_failed), `…_AlreadyReversed_IsVerifiedByLookup`, `…_AlreadyReversed_ButLookupSaysFailed_IsNotRefunded`, `…_GatewayReportsFailedStatus_IsNotRefunded`, `…_PendingAndProcessingAreAccepted`, `…_AmbiguousOutcome_StaysRefunding_AndSweeperFinishesWithoutASecondRefund`, `…_GatewayOKButMarkRefundedFails_LeavesRefunding_NotAFalseFailure`, `TestRefundExternal_ReplyLost_LookupConfirms_LedgerStillReversed`, `…_RetryOfRefunding_VerifiesBeforeRefundingAgain`, `…_ConcurrentRefundInFlight_IsRefusedNotDoubled`; adapter `provider/paystack`: `TestRefundPayment_*`, `TestLookupRefund_*`; live-DB: `TestLiveDB_PGStore_BeginRefund_FencedAndStaleTakeover` |
| **H5** | Insert-failure compensation reversed the escrow even when `Find` errored (possibly orphaning a live parcel from its money). | `resolveExternalInsertFailure`: found ⇒ return that parcel; **Find error ⇒ leave the escrow and return the error**; provably none ⇒ reverse. Runs on a detached bounded ctx. | `TestResolveExternalInsertFailure`; live-DB `TestLiveDB_BookParcelPaystackFunded_InsertFailure_ReversesEscrowWhenNoParcelOwnsIt` |
| **H6** | `order_failed` relied on `Book`'s own compensation; if it failed, the gateway refund left an `escrowed` external settlement with no parcel (provider-clearing / escrow drift). | Before the gateway refund the engine calls `settlement.RefundExternalByKey(reference)` (idempotent; nil when nothing was escrowed). Failure ⇒ **no gateway refund**, row stays `processing`, the stale takeover / sweeper retries. The sweeper re-asserts it on every `order_failed` retry. Never-booked mismatches skip it. | `TestOrderFailed_LedgerReversedBeforeGatewayRefund`, `…_LedgerReversalFails_NoGatewayRefund_RetriedLater`, `TestAmountMismatch_NeverBooked_NoLedgerReversalNeeded`; live-DB `TestLiveDB_Engine_OrderFailed_ExternalSettlementReversedBeforeGatewayRefund` (settlement already `refunded` at the instant of the gateway refund; ledger balanced) |
| **H7** | Confirmer / status / refunder were registered only when the per-service flag was on (a kill switch stranded paid customers); no sweeper for stranded intents; webhook failures not retried. | `wireTransportCardDirect` registers **every** domain under the master flag; the per-service flag only calls `SetInitiateEnabled` (unmounts `initiate`, and `Engine.Initiate` refuses new keys with `service_disabled` — replays of an existing checkout are still served). `Engine.Reconcile` + `StartReconciler` (started in the wiring, i.e. behind the master flag; every 5 min, min idle age 5 min): pending/processing ⇒ gateway-verified `OnChargeSuccess`; `refunding` ⇒ lookup-first completion; `amount_mismatch`/`order_failed` with no refund ⇒ retry the COLLECTED amount (order_failed also re-checks `Find` — never refunds a charge backing a booking — and re-asserts the ledger unwind). **Webhook choice:** `PaystackHandler.Handle` answers 200 for every dispatch error on every prefix (a non-2xx would re-deliver and the legacy prefixes rely on this to avoid retry storms on deterministic failures), so card-direct stays consistent and relies on the durable intent + status poll + sweeper instead of Paystack redelivery. | `TestReconcile_*` (8), `TestInitiateDisabled_*`; `internal/app`: `TestCardDirectWiring_ServiceFlagOff_KeepsConfirmerStatusRefunderLive_UnmountsInitiateOnly`, `…_ServiceFlagOn_MountsInitiateToo`; live-DB `TestLiveDB_Reconcile_StrandedAmountMismatch_RefundsCollectedAmountViaSQL` |
| **H8** | Booking re-queried routing / pricing config; a traffic-aware duration or a config edit between charge and booking produced a spurious mismatch and refunded a correct charge. | `Domain.Quote` returns `Quoted{AmountKobo, Pricing}`; the engine freezes `Pricing` in `transport_paystack_intents.pricing_json` and hands it to `Domain.Book`. Parcel freezes `{distanceM, durationS, full PricingConfig row}` (there is no config "version" column, so the whole row is the version) and `bookParcel` prices from it (`priceParcelFrozen`) — zero routing calls at book time. Intents without a snapshot fall back to live pricing. | `TestPriceParcelFrozen_UsesFrozenRouteAndConfig_NeverRequeries` (routing fake returns 600/1500/3000 s), `TestFrozenPricing_RoundTripsThroughJSON`, `TestParcelDomain_Quote_UsesServerQuoteOnly_AndDecodesRequest`, `…_Book_PassesNamespacedKeyAndVerifiedAmountThrough`; live-DB `TestLiveDB_TrafficAwareRouteChange_DoesNotCauseAmountMismatch` |
| **L1** | Wallet parcel handler accepted keys in the card-direct namespaces. | `transport.IsReservedIdempotencyKey` (case-insensitive prefixes: `parcelorder: rideorder: foodorder: duespay: feespay:` + the reserved `towingorder: moversorder: carhireorder: busorder: eventorder:`); `BookParcel` ⇒ 400 `INVALID_IDEMPOTENCY_KEY`, including the body-key fallback. | `TestBookParcel_WalletPathRejectsReservedCardDirectPrefixes`, `TestIsReservedIdempotencyKey_OrdinaryKeysAreNotReserved` |
| **L2** | External parcel id was random, so a retry escrowed under a different `parcel:<id>` reference. | `externalParcelID = uuid.NewSHA1(ns, namespacedKey)` for the external path (wallet path unchanged). | `TestExternalParcelID_IsDeterministicPerKey`; asserted in the H2 live test |
| **L3a** | One entity could have two intents. | `CREATE UNIQUE INDEX uq_transport_paystack_intents_domain_entity ON (domain, entity_id) WHERE entity_id IS NOT NULL` (replaces the non-unique index; the migration is unshipped and edited in place). | `TestLiveDB_UniqueIntentPerEntity` |
| **L3b** | `callback_url` was forwarded unchecked (phishing redirect). | https only, no userinfo, default port, exact host in `TRANSPORT_CARD_DIRECT_CALLBACK_HOSTS`; anything else is **dropped**. Empty allowlist ⇒ all dropped. | `TestCallbackURL_AllowlistedHTTPSOnly_ElseDropped` (10 cases) |
| **L3c** | `VerifyPayment` could answer for another reference. | `status.Reference` must equal the requested reference (`ErrReferenceMismatch`, 502); nothing is claimed, booked or refunded off it. | `TestVerify_ForADifferentReference_IsRefused_NothingClaimedOrBooked` |
| **L3d** | No rate limit on initiate. | `middleware.PerUserRateLimit` (`TRANSPORT_CARD_DIRECT_INITIATE_RATE_PER_MIN`, default 20) on the initiate route only; the status poll is never limited. | `TestInitiate_PerUserRateLimited_StatusRouteIsNot`, `internal/app`: `TestCardDirectWiring_InitiateIsPerUserRateLimited` |
| **L3e** | `SaveAuthorization` failure made the replay unrecoverable (Paystack refuses a duplicate reference). | Retried 3×; if it still fails the first response still carries the URL (the customer can pay; the reference confirms by lookup) and a later replay answers `409 authorization_unavailable` ("start a new checkout; a payment already made is confirmed automatically") instead of a 500 loop. | `TestInitiate_SaveAuthorizationTransientFailure_IsRetried`, `…_PersistentFailure_ReplayIsRecoverable` |

### Deviations from the audit's wording (and why)

- **Gateway interface**: `LookupRefund` was added to a new `EngineGateway` (= the ride `Gateway` + lookup), not to `Gateway` itself, so the ride adapter and its fakes are untouched. `NewEngine` takes `EngineGateway` and a `LedgerReverser` (= `SettlementReverser` + `RefundExternalByKey` + `GetByID`); `settlement.Service` satisfies it.
- **Contexts**: Book/refund run under `WithTimeout(WithoutCancel(ctx), …)` rather than `WithTimeout(ctx, …)`: the webhook handler's 10 s request context would otherwise abort a money step half way (leaving exactly the half-state the fence exists to handle).
- **Webhook non-2xx**: not adopted (see H7) — it would be inconsistent with every other prefix; the sweeper is the retry mechanism.

### Resolved after ledger audit — round 2 (towing and movers adapters)

A second `ledger-auditor` pass reviewed the towing and movers adapters. Same
discipline: each item was fixed test-first (test written, watched failing, then
the fix). Go tests live in `backend/internal/transport/` (`card_direct_audit2_live_db_test.go`,
live-DB) and `…/paystackcheckout/` (`engine_audit2_test.go`, `card_direct_audit2_test.go`)
unless a path is given.

| # | Finding | Resolution | Tests |
|---|---|---|---|
| **H-A** | Wallet `bookTowing` skipped `validateTowingBookRequest`: `wheel_lift` / `heavy_duty` / `roadside` debited the wallet, then violated the `towing_jobs.service_type` CHECK with the escrow orphaned. (Pre-existing; it is a wallet-money loss.) | `validateTowingBookRequest` now runs BEFORE any escrow on **both** rails (clean 400 `invalid_input`, no debit, no settlement row). A post-escrow INSERT failure on the wallet rail is now compensated like the card rail: `resolveExternalInsertFailure` — owner found ⇒ return that job; `Find` error ⇒ leave the escrow; provably none ⇒ `settlement.Refund` (wallet). A wallet `Escrow` replay must be `escrowed` with `total == fare`, otherwise booking is refused (a retry after a reversed failure would otherwise book a tow for money that already went back). Card pre-flight semantics unchanged. | `TestLiveDB_BookTowing_Wallet_RefusesUnbookableRequestBeforeAnyDebit` (8 cases), `…_InsertFailureAfterEscrow_ReversesEscrowToTheWallet` (incl. replay-after-reversal books nothing) |
| **M1** | Admin `patchModeStatus` was a bare `UPDATE`: an operator could set a card-funded job to `cancelled`/`disputed`/`failed`/`completed`, stranding the charge in escrow behind a "finished" status (no admin path issues the gateway refund). | `refuseMoneyMovingPatch`: for parcels, towing and movers, when the job's settlement is `funding_source='external'` and `escrowed`/`disputed`, a manual move to `cancelled`, `disputed`, `failed`, `completed`, `completion_confirmed` or `delivered` is refused **409 `invalid_state`** with a message pointing at the customer cancel flow / this runbook. Non-money transitions, wallet-funded jobs and jobs whose settlement is already refunded/settled keep the historical bare-UPDATE behaviour. Car hire is untouched (two settlements, no card-direct rail yet). **Movers `disputed` has no exit** — see "Operator runbook" and the note below. | `TestLiveDB_AdminPatch_CardFundedEscrow_RefusesMoneyMovingStatuses`, `…_RefundedCardSettlement_IsNotBlocked_AndTheRunbookRecoveryWorks` |
| **M2** | Cancel answered success while the card refund had failed or no refunder was wired. | (a) **Fail closed first:** for an external settlement `requireRefundRail` runs BEFORE the status flips; no refunder wired ⇒ **503 `refund_unavailable`** and the booking is left exactly as it was. (b) **`refund_status`** in every cancel response (`POST /mobility/{parcels,towing,movers}/:id/cancel` → `{ok, status, refund_status}`): `none` / `refunded` / `pending` (card refund not complete; retried by re-POST and the sweep) / `failed` (wallet refund failed — manual; nothing retries it). (c) **Reconcile step 3:** `Engine.Reconcile` calls each domain that implements `CancelledRefundSweeper`; the adapters delegate to `transport.Service.SweepCancelledCardRefunds`, which selects *cancelled* bookings whose *external* settlement is still `escrowed`/`disputed` (and idle ≥ the sweeper min age, so it never races a live cancel) and drives them through the same `refundSettlement` choke point a customer re-POST uses (gateway first, ledger second, resumable ⇒ no double refund). Applied to parcel, towing and movers; a swept mover also gets `escrow_status='refunded'`. | `TestLiveDB_CancelRefundStatus_ReportsWhatActuallyHappened`, `TestLiveDB_Cancel_NoRefunderWired_IsRefusedForParcelTowingAndMovers_WalletUnaffected`, `TestLiveDB_SweepCancelledCardRefunds_DrivesStrandedRefunds_OnlyThose`, `…_Mover_MarksEscrowRefundedAndParcelIsCovered`, `paystackcheckout`: `TestReconcile_DrivesTheCancelledButStillEscrowedSweepOfEveryDomainThatHasOne`, `TestReconcile_CancelSweepError_IsCountedNotFatal_OtherStepsStillRun`, `TestEveryAdapterIsACancelledRefundSweeper_AndFilesItUnderItsOwnDomain`, live-DB `TestLiveDB_Reconcile_CancelledTowingWithFailedGatewayRefund_IsRefundedBySweep`; the three pre-existing `…NoRefunder…` cancel tests were rewritten to the new contract |
| **M3** | Two open checkouts for one mover job could both be paid (two charges, one move, one refunded). | `QuoteMoverAcceptance` refuses (after proving job ownership) with **409 `checkout_in_progress`** and the existing `reference` in the body (`Details`) so the client can resume (replay `initiate` with the same key = `reference` minus the `moversorder:` prefix ⇒ the stored authorization URL). Backed by a partial unique index `uq_transport_paystack_intents_mover_open_job ON ((request_json->>'job_id')) WHERE domain='movers' AND status IN ('pending','processing')` in the (unshipped, edited-in-place, idempotent) migration; a race that slips past the quote check hits the index and `PGStore.Put` maps it to the same coded 409. Terminal and `refunding`/failure statuses do not hold the slot. | `TestLiveDB_QuoteMoverAcceptance_RefusesASecondOpenCheckoutForTheSameJob`, `paystackcheckout`: `TestLiveDB_PGStore_OneOpenMoverCheckoutPerJob_EnforcedInSQL` |
| **L-a** | A `Book` that failed on `context.DeadlineExceeded`/`Canceled` was treated like any other failure (Find "absent" ⇒ refund), though the commit may have landed after the deadline. | `bookInterrupted(err)` ⇒ handled exactly like a `Find` error: no refund, intent left `processing`; the idempotent stale-claim retry converges. | `paystackcheckout`: `TestConfirm_BookTimedOutOrCancelled_IsTreatedLikeAFindError_NoRefund_LeftProcessing` (deadline + canceled, then the retry confirms with no refund) |
| **L-b** | The customer's cancel reason reached the settlement/ledger description unbounded. | `capCancelReason`: control characters stripped, capped at 200 **runes** (never splits a multi-byte character), applied at the top of every cancel. | `TestCapCancelReason`, `TestLiveDB_Cancel_ReasonIsCappedBeforeItReachesTheRefundPath` |
| **L-c** | Re-cancel of an already-cancelled card job finished the refund only for an `escrowed` settlement, not a `disputed` one. | `finishCancelledRefund` (shared by parcel / towing / movers) treats `disputed` exactly like `escrowed`. | `TestLiveDB_RecancelFinishesARefundForADisputedExternalSettlementToo` |
| **L-d** | (i) no `verifiedAmountKobo <= 0` guard in `bookTowing` (a zero-price config with verified 0 would pass the `fare != verified` check); (ii) a negative `route.DistanceM` discounted the fare; (iii) a zero quote reached the engine as a plain 500. | (i) guard ⇒ 409 `amount_mismatch` before any escrow; (ii) `max(DistanceM, 0)` in `priceTowing` and `EstimateTowing`; (iii) the engine returns a coded **422 `invalid_quote`** for a non-positive quote (nothing persisted, nothing sent to the gateway). | `TestLiveDB_BookTowingPaystackFunded_ZeroFareAndZeroVerified_IsRefusedNotEscrowed`, `TestLiveDB_PriceTowing_NegativeRouteDistance_IsClampedToZero`, `paystackcheckout`: `TestInitiate_NonPositiveQuote_IsACoded4xx_NothingPersisted`, `TestHTTP_Initiate_ZeroQuote_Answers4xxNot500` |
| **L-e** | Re-check provider eligibility in movers `Book`, if the wallet path does. | **No change — the condition is false.** The wallet `acceptMoverBid` does not re-check the provider's approval at accept time (eligibility is enforced when the bid is *submitted*, `SubmitMoverBid` → `driverGate`). Card-direct `Book` is stricter than the wallet path already (bid still `submitted`, same provider, same amount, guarded commit). Adding a card-only check would make the two rails diverge; if product wants "provider suspended after bidding" enforced it must be added to the shared `loadMoverAcceptance`. | — |
| **L-f** | The refund-domain strings in `transport` (`"parcel"`, `"towing"`, `moverDomain`) and each adapter's `Name()` were only coincidentally equal. | Single definition: `transport.RefundDomainParcel/Towing/Movers`, used at every `refundSettlement` call site; tests pin them equal to the adapters' `Name()` and prove the real wiring registers an adapter **and** a refunder for each. | `paystackcheckout`: `TestRefundDomainStringsEqualEveryAdapterName`; `internal/app`: `TestCardDirectWiring_EveryRefundDomainTransportUsesHasARegisteredAdapterAndRefunder` |
| **L-g** | `.env.example` still said towing / movers flags were "reserved … not read by any code yet". | Comment corrected (only bus / car hire / event remain reserved). | — |

**Movers `disputed` has no exit (documented, not built).** `moverTransitions` gives
`disputed` no outgoing edge, and neither do parcels (`disputed`) — no job type has a
dispute exit in this state machine, and dispute resolution is an operator action.
Adding `disputed → cancelled` to `moverTransitions` would also let a *customer* cancel
a disputed **wallet-funded** move through `CancelMover` (pulling a refund while the
provider's dispute is open) — a policy change to the wallet rail, which this work does
not own. After M1 a card-funded job can no longer be pushed into `disputed` by the
admin patch while its charge is held, so the stuck state cannot be created through the
console; for an already-`disputed` card job use the runbook below.

#### Operator runbook — a card-funded job whose money is stuck

Symptoms: a booking shows `cancelled`/`failed`/`disputed` but `settlements.status` is
still `escrowed`/`disputed` (`funding_source='external'`), or a customer reports a
cancelled card booking with no refund. Check `refund_status` in the cancel response /
the `*.cancelled` mode event, and `transport_paystack_intents.status`.

1. **Wait for the sweep.** Cancelled-but-escrowed card refunds are retried by the
   reconciler every 5 min (`TRANSPORT_CARD_DIRECT_RECONCILE_*`; log line
   `reconcile sweep: … CancelRefundsCompleted`). A `503 refund_unavailable` on cancel
   means the card-direct wiring is off (master flag) — fix the flag, nothing was changed.
2. **Customer re-POST.** `POST /mobility/<svc>/:id/cancel` again finishes a failed
   refund (idempotent: gateway lookup first, never a second refund).
3. **Operator recovery (booking wrongly marked terminal, or customer cannot re-POST):**
   PATCH the booking *back* to a live status (`PATCH /admin/transport/<svc>/:id/status`,
   e.g. towing `requested`, mover `bid_accepted`, parcel `created`) — non-money
   transitions are allowed — then have the customer (or support, on their behalf via the
   same endpoint) cancel it so the refund runs through the gateway path.
4. **Last resort (gateway or intent unrecoverable):** issue the refund in the **Paystack
   dashboard** against the intent's `reference` (exact `amount_kobo`; Paystack keeps its
   fee), then reverse the ledger side with `settlement.RefundExternal(settlement_id)` (or
   `RefundExternalByKey(reference)`) and set the intent `refunded` with the Paystack
   refund reference. Never use `settlement.Refund` on an external settlement — it is
   refused by design (it would credit a Tier-0 wallet).
5. A card-direct job that was set `disputed` before M1 and now needs resolving: do (4),
   then set the job `cancelled` (the money-moving guard no longer blocks once the
   settlement is `refunded`).

### Documented, not built (known gaps / operational facts)

- **No dispute / chargeback webhooks.** `charge.dispute.*` and `refund.processed/failed` events are not handled. A cardholder dispute on a card-funded parcel is not reflected in escrow or the intent; it is a manual Paystack-dashboard + `RefundExternal` job. `refund.failed` is only discovered by the sweeper's lookup. Follow-up before wide rollout.
- **The platform absorbs Paystack's refund cost.** Paystack does not return its transaction fee on a refund, and refunds here are issued for the full charged amount, so every refunded card-direct charge (cancel, mismatch, order_failed) costs the platform the gateway fee. It is **not** deducted from the customer and not booked in the ledger as an expense (the ledger only mirrors principal). Finance should budget for it / decide on a cancellation-fee policy.
- **Paystack API shapes are unverified against the live API.** The `GET /refund?reference=` lookup (query parameter name, list shape, `transaction_reference` field) and the "already reversed" message wording are implemented from Paystack's documentation and pinned only by canned-response tests (`provider/paystack/refund_internal_test.go`); they have never been called against api.paystack.co. Verify with one real test-mode refund before enabling the flag.
- **Abandoned mover checkouts hold the job's slot (round 2, M3).** An intent that is never paid stays `pending`
  (the sweeper only re-verifies it for 7 days; there is no `expired` status), and the one-open-checkout index
  counts `pending`. The customer is told the existing `reference` and resumes by replaying `initiate` with its key
  (stored authorization URL); until it is paid (→ `confirmed`) or the row is moved to a terminal status by an
  operator, a *different* bid on the same job cannot start a card checkout (wallet is unaffected). If product wants
  automatic release, add an `expired` status + a sweep that expires unpaid intents after the gateway's own
  checkout expiry — not done here because releasing a slot while a late payment can still land would reopen the
  double-charge window the index closes.
- A cancel-path refund that the sweeper completes gateway-side also reverses the escrow by key; the parcel's own cancel handler remains the primary path.
- `PATCH`/admin refund of a card-funded settlement still has no gateway-issuing admin path (risk 4 above is unchanged).
- Mobile treats the `refunding` status as non-terminal (it keeps polling) and shows dedicated in-flight copy (`CardDirectStatusScreen` / `cardDirectFailureMessage`) that never claims the money is back.
- The wallet-path reserved-key check is applied to parcels only; the other wallet booking handlers (ride/towing/…) should call `transport.IsReservedIdempotencyKey` when they gain a card-direct sibling.

## Towing and Movers (implemented)

### Towing (implemented)

`Name()="towing"`, prefix `towingorder:`, routes `/towing/paystack`, entity key `towingJobId`, flag
`FEATURE_TRANSPORT_PAYSTACK_TOWING_ENABLED` (inert without the master + `FEATURE_TRANSPORT_MODES_ENABLED`).
Charged amount = `towingFare(distance, config)`: callout + per-km × route distance, floored at the
minimum fare (no per-minute component; a destination-less roadside job never routes).
`transport.BookTowing` was refactored into a shared `bookTowing(…, external, verified, frozen)`; the wallet
path is unchanged apart from rejecting reserved-prefix keys (400 `INVALID_IDEMPOTENCY_KEY`).
Every parcel lesson is applied from the start: `Quote` returns `{amount, frozen {distanceM, full
PricingConfig}}` and `Book` prices from the frozen snapshot only (H8; garbage snapshot ⇒ error, never a
silent live re-price); after an `EscrowExternal` replay the settlement must be `escrowed`, payer == user,
`funding_source=='external'`, `total == fare` (H2); the job id is `uuid.NewSHA1(ns, namespacedKey)` so a
retry escrows under one `towing:<id>` reference (L2); an INSERT failure reverses the escrow only when
`Find` proves no job owns it, Find error ⇒ leave it (H5); the cancel path goes through
`refundSettlement(ctx, "towing", …)` (card money returns to the card, never the wallet, fail-closed with no
refunder) and a re-POSTed cancel of an already-cancelled card job finishes a stranded refund.
Card-direct pre-flight (`ValidateTowingBookRequest`, run at quote AND book) refuses what the INSERT would
reject *after* the charge: `service_type` outside the `towing_jobs.service_type` CHECK
(`tow, flatbed, jumpstart, tire_change, fuel, battery, unlock, mechanic`), empty pickup address,
(0,0)/out-of-range coordinates, and a `tow`/`flatbed` job without `dest`.
**Former wallet-path defect (fixed in round 2, H-A):** the app's service picker offers
`wheel_lift`/`heavy_duty`/`roadside`, which violate that CHECK; the wallet `BookTowing` used to escrow and then
fail the INSERT. It now refuses them with a 400 before any debit. The card-direct
mobile body maps picker values onto the accepted set (`utils/towingCardDirect.ts`:
wheel_lift/heavy_duty → `tow`; roadside → battery/fuel/tire_change/unlock/mechanic by issue). Also the wallet
mobile body sends `issue`/`photo_url`/`payment_method` while the Go request binds `issue_type` — the
card-direct body uses the backend names.

### Movers (implemented) — charged at bid acceptance

`Name()="movers"`, prefix `moversorder:`, routes `/movers/paystack`, entity key `moveId`, flag
`FEATURE_TRANSPORT_PAYSTACK_MOVERS_ENABLED` (inert without the master + `FEATURE_TRANSPORT_MODES_ENABLED`).
**Charge = the accepted bid, read server-side.** The request carries only `{job_id, bid_id}`; any client
amount is ignored. `Quote` requires the job to belong to the payer, be open + unfunded, and the bid to belong
to the job and be `submitted`; it freezes `{jobId, bidId, providerId, amountKobo}`.
`transport.AcceptMoverBid` was refactored into a shared `acceptMoverBid(…, ext)`; the wallet path is
unchanged apart from rejecting reserved-prefix keys (400 `INVALID_IDEMPOTENCY_KEY`).
**Job/bid must still be acceptable when the charge confirms.** `Book` re-reads the job and bid and refuses
BEFORE posting any escrow unless the job still belongs to the payer, is open and unfunded, and the bid is
still `submitted` with the frozen provider and an amount equal to both the frozen amount and the VERIFIED
charge. The bid flip inside the commit transaction is guarded again (`status='submitted' AND provider_id=… AND
amount_kobo=…`), so a bid withdrawn/changed between the pre-check and the commit rolls the transaction back.
Any refusal is a failed `Book` ⇒ `Find` proves absence ⇒ the engine reverses the (never-posted) ledger side
and refunds the gateway in full (`order_failed` → `refunded`). Tests: `TestLiveDB_MoversCardDirect_
JobOrBidChangedBeforeConfirm_RefundsGateway_NothingBooked` (bid withdrawn / bid amount changed / job
cancelled / job funded by another path), `TestLiveDB_MoverAcceptCardDirect_StateChangedBeforeBook_
RefusedNothingEscrowed` (also: bid provider changed, paid by a different user).
**`Find` key.** `mover_jobs.idempotency_key` is the job-CREATION key, so the acceptance key lives only on the
escrow settlement: `Find` = `mover_jobs ⋈ settlements ON settlement_id WHERE settlements.idempotency_key =
<namespaced key> AND funding_source='external' AND mover_jobs.user_id = payer`. No migration needed.
**Parcel audit lessons applied from the start:** after an `EscrowExternal` replay the settlement must be
`escrowed`, payer == user, `funding_source=='external'`, `total == bid` (H2); the escrow is reversed on a
post-escrow failure only when `Find` proves no job owns it, a `Find` error leaves it (H5, via
`resolveExternalInsertFailure`); the settlement idempotency key is the NAMESPACED reference; the settlement
reference `mover:<jobID>` is already deterministic (the job id exists before the charge, so no random id);
pricing is frozen (the "pricing" is the bid identity — there is no config/route to re-query).
**Two charges for one job** (two keys): both may pass the pre-check; the commit's `escrow_status='none'` guard
lets exactly one win and the loser's escrow is reversed ledger-side (`TestLiveDB_MoverAcceptCardDirect_
TwoChargesOneJob_ExactlyOneBooks`); the engine then refunds the loser's gateway charge.
**Cancel.** `CancelMover` now routes through `refundSettlement(ctx, "movers", …)` (rail chosen from
`settlements.funding_source`: card money returns to the card, never the wallet; fail-closed with no refunder).
`mover_jobs.escrow_status` only becomes `refunded` once the refund actually happened for a card-funded move
(a failed refund leaves it `funded`), and re-POSTing cancel on an already-cancelled card-funded move finishes a
stranded refund (no-op once complete). Wallet-funded cancel keeps its historical best-effort `refunded` mark.
There is no mover dispute-refund call site in the transport package (`disputed` was only reachable through the
admin status patch, which moves no money — now refused for card-funded escrow, see round 2 M1).

### Open product decision and known wallet-path defects (towing)

- **OPEN product decision — towing service-type mapping.** The app's service picker offers
  `wheel_lift` / `heavy_duty` / `roadside`; the `towing_jobs.service_type` CHECK accepts only
  `tow, flatbed, jumpstart, tire_change, fuel, battery, unlock, mechanic`. Card-direct currently maps
  picker values onto the accepted set client-side (`utils/towingCardDirect.ts`: wheel_lift/heavy_duty -> `tow`;
  roadside -> battery/fuel/tire_change/unlock/mechanic by issue) and the server pre-flight refuses anything
  outside the set BEFORE the charge. Product must decide whether to (a) keep the lossy mapping, (b) widen the
  CHECK additively (new migration) so `wheel_lift`/`heavy_duty`/`roadside` become first-class, or (c) change
  the picker. Until decided, wheel_lift/heavy_duty are indistinguishable from `tow` for the operator.
- **Wallet-path bug — FIXED in round 2 (H-A):** wallet `BookTowing` with `wheel_lift` / `heavy_duty` /
  `roadside` used to escrow the fare and THEN fail the `towing_jobs` INSERT on the CHECK, orphaning the
  escrow. The pre-flight now runs before any escrow on both rails (clean 400) and a post-escrow INSERT
  failure is reversed to the wallet. The product question above (how those picker values should be
  represented) is still open.
- **Existing wallet-path bug (not fixed here):** the wallet mobile body sends `issue` (plus `photo_url` /
  `payment_method`) while the Go request binds `issue_type`, so the issue is silently dropped on the wallet
  rail. The card-direct body uses the backend names.

### Rollout notes (towing and movers)

- Enable order: master `FEATURE_TRANSPORT_PAYSTACK_CHECKOUT_ENABLED` -> `FEATURE_TRANSPORT_MODES_ENABLED` ->
  `FEATURE_TRANSPORT_PAYSTACK_TOWING_ENABLED` / `FEATURE_TRANSPORT_PAYSTACK_MOVERS_ENABLED`.
- Mobile: `EXPO_PUBLIC_TOWING_USE_MOCK` / `EXPO_PUBLIC_MOVERS_USE_MOCK` must be off for card-direct calls to
  reach the server (the mocks return a canned `confirmed`).
- `TRANSPORT_CARD_DIRECT_CALLBACK_HOSTS` is shared; nothing service-specific.
- Admin `PATCH /admin/transport/{parcels,towing,movers}/:id/status` now REFUSES (409) a move to a
  money-moving status while a card-funded settlement is still held (round 2, M1); the recovery path is the
  runbook above. A card refund is still not issuable from the admin console (ADR risk 4).
- Wallet-path reserved prefixes `towingorder:` / `moversorder:` were already in
  `reservedIdempotencyPrefixes`; the wallet `BookTowing` and `AcceptMoverBid` now reject them
  (400 `INVALID_IDEMPOTENCY_KEY`, body-key fallback included).
- Contracts: `/mobility/{towing,movers}/paystack/{initiate,{reference}/status}` are declared in
  `contracts/transport.openapi.yaml` and `contracts/openapi.yaml`.

## Partial refunds (car hire)

Status: **engine support implemented (WP-A); car hire itself (adapter, `bookCarHire`, cancel/complete
wiring, mobile) is WP-B and not built here.** Scope accepted for car hire: book; cancel before
activation; complete with the deposit returned IN FULL; extensions refused for card-funded rentals; no
late-fee/damage deductions; no cancel-after-activation on the card rail.

**Why the whole-charge refund path cannot be reused.** One card charge T = fare + deposit funds TWO
settlements (`<ref>:fare`, `<ref>:deposit`). `RefundExternalSettlement` requires
`settlement.idempotency_key == reference` and `total_kobo == intent amount` (H3), `BeginRefund` always refunds
the full amount and flips the whole intent to `refunding`, and `LookupRefund` returns one "best" refund, so it
cannot tell several partial refunds apart. `RefundExternalByKey(reference)` also finds nothing when the keys
are `<ref>:fare`/`:deposit`, which would have made the H6 `order_failed` unwind a silent no-op.

**Design (rule: one gateway refund per settlement, for exactly that settlement's total).**

- *Dispatch.* A settlement whose key is `<reference>:<suffix>` (one non-empty suffix, no further `:`) is a PIECE of the
  charge and goes through `refundSettlementPiece`; a settlement keyed exactly `<reference>` keeps the strict H3 path
  untouched (parcel, towing, movers unchanged). The suffix is domain-agnostic: the engine binds by key prefix, payer,
  external funding, `escrowed|disputed`, `0 < total <= charge`.
- *Schema (additive, idempotent, in the NEW `20271009090000_transport_paystack_intent_partial_refunds.sql`; `20271008090000_transport_paystack_intents.sql` is untouched — see the third audit table):* `refund_reserved_kobo`
  (in-flight + done pieces) and `refunded_kobo` (done pieces) on the intent with
  `CHECK (0 <= refunded_kobo <= refund_reserved_kobo <= amount_kobo)` — "sum of refunds <= collected" is a DATABASE
  invariant; new table `transport_paystack_intent_refunds(reference, refund_key=settlement id, settlement_id,
  amount_kobo, status refunding|refunded|failed, gateway_refund_id, claim_gen, claimed_at, attempts, …)` with a
  partial unique index allowing ONE `refunding` piece per intent, and a sweep index. RLS enabled, anon/authenticated
  revoked. The intent stays `confirmed` while pieces refund and flips to `refunded` (same transaction) exactly when
  `refunded_kobo == amount_kobo`. `BeginRefund` gained `AND refund_reserved_kobo = 0`, so a whole-charge refund can
  never start over piece refunds.
- *Record, then call.* `BeginPartialRefund` (one tx, intent row `FOR UPDATE`, then piece row) reserves the amount and
  inserts/re-activates/takes over the piece under a per-row fence before any gateway call. A fresh in-flight piece
  (same or other) ⇒ `ErrPartialInFlight`; over-cap ⇒ `ErrPartialCapExceeded`; intent not `confirmed` ⇒
  `ErrIntentNotRefundable`; an already-refunded piece ⇒ `AlreadyDone` (skip the gateway, finish the ledger).
- *Never refund on a guess — lookup arithmetic.* Paystack has no client idempotency key for refunds. Before every
  POST the engine lists ALL gateway refunds and computes `inflight = Σ(accepted: pending/processing/processed) −
  intents.refunded_kobo`. `inflight == 0` ⇒ safe to POST; `inflight == piece amount` ⇒ OUR refund already happened
  (lost reply / crash) ⇒ record it, never POST again; anything else (a dashboard refund, a foreign note, a lookup
  error) ⇒ the piece stays `refunding`, logged, never refunded (manual). Failed gateway refunds are ignored in the
  sum. The merchant note `"<reference>#<settlementID>"` is only a tie-breaker (if the gateway echoes notes and none is
  ours, a same-sized surplus is NOT adopted); correctness does not depend on the note being echoed. One-in-flight is
  what makes the arithmetic unambiguous.
- *After the POST:* accepted with amount `0` or `== piece` ⇒ `refunded` (any other amount ⇒ left `refunding`, manual);
  `failed` / `ErrRefundFailed` ⇒ `failed` + reservation released (retryable); any ambiguous reply ⇒ second lookup
  with the same rule (`ErrAlreadyReversed` with nothing visible ⇒ stays `refunding`); **an empty second lookup does NOT mark the piece failed** (the list can lag) — see H2 in the third audit table. A store failure after a
  successful refund leaves `refunding`, never a false failure.
- *Gateway first, ledger second.* `settlement.RefundExternal(settlementID)` (idempotent) runs after the piece is
  recorded refunded; a failure leaves piece `refunded` + settlement `escrowed` and a retry/sweep finishes it without
  another gateway call. A settlement already refunded ledger-side with no refunded piece is a manual case (no gateway call).
- *Ledger unwind for failed Book.* New `settlement.RefundExternalByKeyPrefix(reference)` reverses every external
  settlement keyed `<reference>` or `<reference>:*` (exact key OR `starts_with(key, ref||':')` — never `LIKE`, `_` is a
  wildcard and legal in keys; a wallet-funded row under the prefix is refused after the others are processed). The
  engine now calls it in place of `RefundExternalByKey` (`refund.go`, `reconcile.go`); identical for single-settlement
  domains. `LedgerReverser` swapped the method; `settlement.Service` still has `RefundExternalByKey`.
- *Reconciler.* Step 3: pieces `refunding` older than `minAge` are re-driven (settlement re-validated, takeover only past
  the stale window, lookup-first). Step 4: pieces `refunded` whose settlement is still `escrowed|disputed` (SQL join on
  `settlements`, so healthy old rows cannot fill the batch) get their ledger reversal. Both skipped when partial
  refunds are not enabled; steps 1–2 untouched.
- *Wiring.* `Engine.EnablePartialRefunds(PartialGateway, PartialRefundStore)` (called in
  `internal/app/transport_card_direct.go` with the Paystack client and `PGStore`). Without it a piece refund fails
  CLOSED (`ErrPartialRefundsUnsupported`: no gateway call, no ledger call). `NewEngine`, `Store`, `Domain`,
  `EngineGateway` and `transport.ExternalRefunder` signatures are unchanged, so the existing fakes and adapters compile
  as before. Adapter: `paystack.Client.RefundPaymentNoted` (sends `merchant_note`; `RefundPayment` delegates with an
  empty note and sends the same body as before), `LookupRefunds` (all refunds incl. failed, `perPage=100`);
  `provider.RefundResult` gained `ID` and `Note`.

**Tests (all under `backend/internal/…`).** `finance/settlement`: `TestRefundExternalByKeyPrefix_{ReversesFareAndDeposit_NotOtherKeys,
UnderscoreIsNotAWildcard,WalletFundedUnderPrefixIsRefused}` (live-DB). `provider/paystack`: `TestRefundPaymentNoted_*`,
`TestLookupRefunds_*`. `transport/paystackcheckout` (pure, `partial_refund_test.go`): `TestPartial_*` (record-before-call,
fare+deposit sum/flip, cap, reply-lost, already-done-at-gateway, pending counted, unexplained refund, failed ignored,
foreign notes, failed status + retry, ambiguous ⇒ definite non-refund, already-reversed, lookup failure, wrong amount,
mark failure, ledger failure + retry, settlement validation (8 cases), not-wired fails closed, concurrency, stale owner
fence), `TestFullRefund_BlockedWhileReservedPartialsExist`, `TestReconcile_Partial*`/`RefundedRowWithEscrowedSettlement_*`.
Live-DB (`partial_refund_live_db_test.go`, real Engine + PGStore + ledger, a two-settlement stand-in domain):
`TestLiveDB_PGStore_PartialCapEnforcedByCheckConstraint`, `…_PartialFencedTakeover`, `…_OneInflightPartialIndex`,
`…_ConcurrentBegins_ExactlyOneWins`, `…_WholeChargeRefundBlockedByReservedPieces`, `…_FailedPieceReleasesReservationAndReactivates`,
`TestLiveDB_Engine_TwoSettlements_*` (cancel ⇒ two exact gateway refunds, ledger balanced, wallet untouched; deposit-only ⇒
booking stays confirmed), `…_PieceRefund_RefusesAForeignSettlement`, `…_ConcurrentRefundOfOnePiece_OneGatewayRefund`,
`…_OrderFailed_TwoSettlements_BothReversedBeforeGatewayRefund`, `TestLiveDB_Reconcile_{StrandedPiece,RefundedPiece}_*`.

**Known limits / deliberately not built.**
- Deposit deductions (late fee/damage) need a new settlement primitive (partial release of one settlement: DR escrow
  to provider/platform legs for X and to clearing for D−X) and a gateway refund of D−X; a deduction above the deposit
  is not collectable from a card (no saved authorization). Neither exists in `car_hire.go` today.
- A piece refund always equals ONE WHOLE settlement total; a refund of part of a settlement is not representable.
- A piece refund of a `settled` settlement is refused (fare already paid out); race protection against a concurrent
  `Settle` is the booking-status compare-and-swap in WP-B, not the engine. If any other path can settle a settlement
  between the validation read and the gateway call, the engine would refund the customer for money already paid out —
  `ledger-auditor` should look at that window (option: briefly mark the settlement `disputed`, which `Settle` refuses).
- The engine keeps no refund history beyond `transport_paystack_intent_refunds`; Paystack fees are not returned on refund
  (platform cost, as for whole refunds).

**UNVERIFIED against the live Paystack API (need ONE real test-mode run before enabling car hire).**
1. Two SEQUENTIAL partial refunds of one transaction (fare then deposit) are accepted, and the second is not rejected
   while the first is `pending`.
2. `POST /refund` accepts `merchant_note`, and `GET /refund?reference=` returns it as `merchant_note` per refund
   (the engine does not depend on it, but the foreign-note guard only has teeth if it is echoed).
3. `GET /refund?reference=` lists every partial refund of the transaction (one row each, `amount` in kobo, `status`),
   becomes visible immediately after the POST (the lookup-first guard assumes no lag; a lag shorter than the stale
   window would be re-checked at takeover, but a lag longer than it could cause a second refund — measure it).
4. The numeric refund `id` is in `data.id` of the POST reply (stored as `gateway_refund_id` when present; absent is fine).
5. Whether a partial refund of an already partially refunded transaction reports `ErrAlreadyReversed`-style messages
   (`isAlreadyReversedMessage` wording).

## Car hire (implemented)

Flag `FEATURE_TRANSPORT_PAYSTACK_CARHIRE_ENABLED` (default off; inert without the master flag and
`FEATURE_TRANSPORT_MODES_ENABLED`; gates ONLY new checkouts). `Name()="carhire"`, prefix `carhireorder:`, routes
`/car-hire/paystack`, entity key `bookingId`. **Do not enable until the "UNVERIFIED" Paystack behaviours in
"Partial refunds (car hire)" were proven with one real test-mode run, and see "Product blockers" below.**

**What is charged.** `QuoteCarHireBookingFrozen` = `carHireFare` (fare = `max(base + hours x hourly rate, min_fare)`,
deposit = `base`) as integer kobo — no rounding anywhere, NGN only (engine currency check). Fare must be `> 0`, deposit
`>= 0`, the sum must not overflow, and the pricing config must have no negative field / overflowing product
(`carHireFareChecked`, `carHireTotals`). The intent amount is `fare + deposit`; the frozen pricing is
`{durationHours, fareKobo, depositKobo, config}` and `Book` re-derives both legs from the frozen config for the request's
duration and refuses a snapshot that is not self-consistent (never silently re-priced from live config). Pre-flight at
quote time (strict): `hire_type` in the `car_hire_bookings.hire_type` CHECK set, `start_at` RFC3339 within \[-24h, +366d\]
(a "today" pick is midnight UTC), `duration_hours` 1-720, bounded free text. At confirm only the structural check runs — a
charged booking is never refused over its date. The wallet rail now also refuses a bad `hire_type` BEFORE the escrow (it used
to debit the wallet and then fail the INSERT) and keys starting `carhireorder:` (400 `INVALID_IDEMPOTENCY_KEY`).

**How one charge maps to two settlements.** The booking id is `uuid.NewSHA1(ns, namespacedKey)`; the fare settlement is
reference `carhire:<id>` / key `<ref>:fare`, the deposit `carhire:<id>:deposit` / `<ref>:deposit` (the same references the wallet path
uses, so Cancel/Complete select identically). Each replay is checked per settlement (H2: `escrowed`, same payer, `external`, exact
amount). If the deposit leg fails after the fare escrowed, or the INSERT fails, `Find` decides: a booking owns the key ⇒ return it;
`Find` errors ⇒ leave the escrow; none ⇒ reverse ONLY the settlements that passed the live-escrow check. The engine's `order_failed`
unwind (`RefundExternalByKeyPrefix`) covers both legs independently.

**Lifecycle (card-funded).**

| Event | Behaviour |
|---|---|
| cancel while `confirmed` and BEFORE `start_at` | pre-flight refuses with 503 `refund_unavailable` if no refunder is wired (nothing flips); otherwise status flips, then fare then deposit are each refunded to the CARD (two exact piece refunds). `refund_status` = `refunded` \| `pending`; a failed refund is reported, not swallowed. Re-POST finishes stranded legs (a finished leg is never refunded again). |
| cancel while `active`/`extended`, or after `start_at` | **409 `CARD_HIRE_ACTIVE_USE_RETURN`** (active/extended: complete the hire) or **409 `CARD_HIRE_STARTED`** (start time passed: contact support), nothing changes — a used car cannot be cancelled for a full refund. The wallet rail keeps allowing it (historical, flagged below). |
| activate | **409 `CARD_HIRE_NO_DRIVER`** for a card booking with no driver (interim; wallet unchanged). |
| complete | owner or assigned driver, **only from `active`/`extended`** (from `confirmed` it is 409 — cancel instead). **409 `CARD_HIRE_NO_DRIVER`** before anything changes if no driver is assigned. Status flips (compare-and-swap), then fare settles to the driver and the FULL deposit is refunded to the card. `deposit_refund_status`: `refunded` \| `pending`. The deposit refund never waits on the fare payout (it is the renter's money); a fare error is returned after the deposit was attempted. |
| complete re-POST | on an already-completed card booking: settles the fare if still escrowed, refunds the deposit if still escrowed; otherwise a no-op that reports the state. (Wallet re-POST stays 409.) |
| extend | **409 `EXTENSION_NOT_AVAILABLE_FOR_CARD`** before any wallet debit (rail read from the fare settlement; a failed read refuses). |
| admin status patch | money-moving targets (`cancelled`, `completed`, `disputed`, `failed`, …) are refused with 409 while ANY card-funded settlement of the booking is escrowed/disputed — fare OR deposit (`refuseMoneyMovingPatch`). |
| reconciler | `CarHireDomain` implements `CancelledRefundSweeper`: (1) cancelled card bookings with an escrowed settlement are refunded through `refundSettlement`; (2) completed card bookings with an escrowed deposit re-run the completion money steps. Wallet-funded rows are never touched. The engine's own piece sweep (WP-A steps 3/4) covers the gateway half. |

`CarHireDetail` now reports `fundingRail` (`card`\|`wallet`), `depositStatus` (`none`\|`held`\|`returning`\|`returned`) and
`refundStatus` (cancelled bookings: `none`\|`pending`\|`refunded`\|`failed`), all derived from the settlements. Mobile copy never
says the money is back before `returned`/`refunded`, and then says "sent back to your card — your bank can take a few days".

**What stays wallet-only, and why.** (a) *Extensions*: a second charge after booking — the unique `(domain, entity_id)` index forbids a
second intent for one booking, it would need its own domain/entity/refund path and mutates the fare after confirm; refusing is the only
option that cannot debit a Tier-0 user's wallet or mix funding. A card customer rebooks. (b) *Deductions* (late fee, damage): no
settlement primitive for a partial release and no way to collect above the deposit from a card (no saved authorization); neither
exists in `car_hire.go` today either. (c) *Cancel after activation with a fare refund*: refunds a consumed service and costs the
platform the gateway fee. (d) *Admin refunds* of a card booking: still the manual runbook (risk 4).

**Product blockers / known defects found while building this (not fixed here).**
- **Nothing assigns `car_hire_bookings.driver_id`** (no code path writes it). A card booking therefore cannot be completed
  (`CARD_HIRE_NO_DRIVER`) and cannot be cancelled once active — its money is stuck behind ops. The wallet `CompleteCarHire` has the same
  root cause and worse: it flips to `completed`, `Settle` fails on the empty provider, and the deposit is never refunded. **Recommend
  not enabling the flag until driver assignment exists.**
- Wallet `CancelCarHire` allows cancelling an `active` hire with a full refund (a used car is refunded).
- The mobile quote card reads `chauffeurKobo`, which the Go quote does not return (always 0).
- Mobile `carhire.api` previously returned the server's `status` as-is while screens read `phase`; the live read paths now normalise
  (`normalizeCarHireBooking`), which changes what the wallet rail's live detail screen shows (it was effectively broken live).

### Resolved after the third ledger audit (engine + car hire)

Each fix was test-first (failing test watched red, then the fix). Tests are Go functions under `backend/internal/…` unless noted.

| # | Finding | Resolution | Tests |
|---|---|---|---|
| **H2** | An ambiguous refund POST followed by an EMPTY lookup marked the piece `failed`, which allowed an immediate second POST while Paystack's list lags ⇒ a double deposit refund on the complete path. | The piece stays `refunding` (reservation kept). `transport_paystack_intent_refunds.post_attempted_at` is persisted (fenced) **before every POST** and cleared only by a definite failure. A re-POST needs (a) a clean lookup AND (b) no POST ever started, or the last one older than the lag bound (`TRANSPORT_CARD_DIRECT_REFUND_LAG_MINUTES`, default 10, `Engine.SetPartialLagBound`); a stale takeover and the sweeper obey the same rule (the store's clock is used for both timestamps). Only `ErrRefundFailed`, a `failed` reply, or our own note listed as `failed` releases the reservation immediately. A late-listed refund is adopted, never repeated. | `paystackcheckout`: `TestPartial_AmbiguousError_EmptyLookup_StaysRefunding_NoImmediateSecondPost` (rewritten from `…_IsDefiniteNonRefund`), `…_InsideLagWindow_ALateListedRefund_IsAdoptedNotRepeated`, `…_PostAttemptIsRecordedBeforeThePost`, `…_DefiniteFailure_ClearsThePostAttempt_…`, `…_AmbiguousThenLookupShowsFailedWithOurNote_IsDefiniteFailure`, `…_LagBoundIsConfigurable`, `TestReconcile_PartialRefunding_InsideLagWindowNoPost_AfterLagBoundPosts`; `internal/app`: `TestCardDirectWiring_RefundLagBound_DefaultAndEnvTunable` |
| **M1** | Any non-accepted gateway status was ignored in the lookup sum. | Only an explicit `failed` is ignorable; any other status (needs-attention, reversed, empty, …) ⇒ `gwUnknown` (stop, no POST). | `TestPartial_NonAcceptedNonFailedGatewayStatus_IsUnknown_NoPost` |
| **M2** | The car-hire sweeper only selected completed bookings with an escrowed DEPOSIT. | Selects completed card bookings with ANY external settlement (fare or deposit) still `escrowed`; `completeCarHireCardMoney` finishes the fare payout and the deposit refund. | `TestLiveDB_SweepCarHire_CompletedWithFareStillEscrowed_FinishesTheFarePayout` |
| **M3** | `Refund` / `RefundExternal` read the status without the row lock, so a `Settle` racing a refund could double-debit escrow. | Both take `SELECT … FOR UPDATE` in a tx held across check + ledger post + flip, and flip with `WHERE status IN ('escrowed','disputed')` checking rows affected. `completeCarHireCardMoney` refuses `Settle` on a settlement that has ANY row in `transport_paystack_intent_refunds`. | `settlement`: `TestLiveDB_RefundExternal_BlocksBehindASettleInFlight_PostsNoRefund`, `…RefundWallet_BlocksBehindASettleInFlight_…`, `TestLiveDB_SettleVersusRefundExternal_Stress_EscrowDebitedExactlyOnce` (reproduced 14000 debited for a 7000 escrow before the fix); `transport`: `TestLiveDB_CarHireCardDirect_Complete_RefusesToSettleAFareThatHasAPieceRow` |
| **M4** | The admin status patch could re-open a settled car-hire booking and was a blind UPDATE. | Card-funded booking: any patch OUT of `cancelled`/`completed` is refused (409), as is any patch while a piece refund is `refunding`; every mode patch is now a compare-and-swap (`WHERE status=<the status read>`, 409 if 0 rows). | `TestLiveDB_AdminPatchCarHire_CardFunded_RefusesAnyPatchOutOfCancelledOrCompleted`, `…_RefusesMoneyMovingPatchWhileAPieceRefundIsInFlight`, `TestLiveDB_AdminPatch_IsACompareAndSwap_ARacingWriterIsNotOverwritten` |
| **M5** | The partial-refund schema was an in-place edit of an already-committed migration. | `20271008090000_transport_paystack_intents.sql` is restored byte-for-byte to commit `90a8e7bcd`; the delta (columns, table, indexes, CHECK, RLS, `post_attempted_at`) lives in the NEW idempotent `20271009090000_transport_paystack_intent_partial_refunds.sql`. Verified on a throwaway DB: old file then new file (and the new file twice) upgrades cleanly; a fresh full replay works; `scripts/ci/check-migration-versions.sh` passes. | scripted (see the report); `TestLiveDB_PGStore_*` run against the upgraded DB |
| **M6/H1** | A card hire could start without a driver (then neither complete nor cancel could free its money) and a used car could be cancelled for a full refund. | **Interim, until driver assignment exists:** `ActivateCarHire` of a card booking with no driver ⇒ 409 `CARD_HIRE_NO_DRIVER`; card complete requires `active`/`extended`; card cancel only before `start_at` (after it: 409 `CARD_HIRE_STARTED`, contact support). **The flag `FEATURE_TRANSPORT_PAYSTACK_CARHIRE_ENABLED` MUST stay OFF until driver assignment is built** (nothing writes `car_hire_bookings.driver_id`). | `TestLiveDB_CarHireCardDirect_Activate_NoDriver_Refused409_WalletUnaffected`, `…_CompleteFromConfirmed_Refused409`, `…_CancelAfterStartAt_Refused409_CardHireStarted` |
| **L1** | No operator procedure for a wedged piece. | Runbook below. | — |
| **L2** | `LookupRefunds` ignored `transaction_reference` and read one page. | An entry naming ANOTHER transaction is an error; all pages are read (bounded at 20 — more is an error, never a silent truncation). | `provider/paystack`: `TestLookupRefunds_ForeignTransactionReference_IsAnError`, `…_PaginatesUntilTheLastPage`, `…_PageBudgetIsBounded` |
| **L3** | The customer cancel refunded a `disputed` fare. | Customer cancel, its re-POST and the sweeper refund only `escrowed` settlements; a `disputed` one is left for the admin paths and reported as `pending`. | `TestLiveDB_CarHireCardDirect_DisputedFare_IsNotRefundedByCustomerCancelOrSweep` |
| **L4** | The wallet extend key was not checked against the reserved card-direct namespaces. | `ExtendCarHire` rejects `IsReservedIdempotencyKey` keys (400 `INVALID_IDEMPOTENCY_KEY`). | `TestLiveDB_ExtendCarHire_RejectsReservedPrefixKey` |
| **L5** | Master flag off ⇒ no refunder/reconciler. | Documented below; kept as a pre-flight refusal rather than making the fare payout independent. | — |
| audit | No audit trail for card refund legs. | One `carhire.refund_leg` event per leg attempted by cancel / complete / the sweeper, in `transport_audit_log` (the sink sibling flows use for cancel/complete events), carrying the settlement id, rail and any error. | `TestLiveDB_CarHireCardDirect_RefundLegsLeaveAnAuditTrail` |

**Master flag off (L5).** The refunder, the status route, the confirmer and the reconciler are registered only under
`FEATURE_TRANSPORT_PAYSTACK_CHECKOUT_ENABLED`. With it off, a card-funded car-hire booking that already exists cannot be refunded:
`CancelCarHireWithRefund` and `CompleteCarHireWithRefund` fail with 503 `refund_unavailable` BEFORE changing anything (the
pre-flight `requireRefundRail`), and nothing sweeps. Completion deliberately does NOT pay the driver out on its own in that state:
paying the fare while the deposit cannot be refunded would leave a completed booking with the customer's deposit stranded and no
sweeper to finish it. The fix is operational — re-enable the master flag (the per-service flag may stay off).

**Idempotency-Key handling (consistency note).** The card-direct rail takes the key from the HEADER only (the body key is stripped
by `freezeRequest`); the wallet rail accepts the header or a body `idempotency_key` and rejects keys in the card-direct namespaces
(`carhireorder:` etc., case-insensitive) on book AND extend. Card-direct settlement keys are `<namespaced reference>:fare|:deposit`; wallet
keys are `<raw key>:fare|:deposit` (+ `…:ext:<n>` references for extensions), so the two can never collide.

**Operator runbook — adopting a gateway refund for a wedged piece (L1).** A piece stays `refunding` (never silently failed) when the
gateway outcome is unknowable: an unexplained refund in the dashboard, an unclassifiable gateway status, a foreign note, or a refund
inside the lag window that never got listed. Procedure: (1) in the Paystack dashboard find the transaction `<reference>` and its
refunds; decide for THIS piece (its amount = the settlement total) whether a refund of exactly that amount with status
`processed|pending|processing` exists. (2a) If it exists, adopt it (one transaction; replace the angle-bracket values):

```sql
BEGIN;
SELECT 1 FROM public.transport_paystack_intents WHERE reference = '<reference>' FOR UPDATE;
UPDATE public.transport_paystack_intent_refunds
   SET status = 'refunded', gateway_refund_id = '<paystack refund id>', completed_at = now()
 WHERE reference = '<reference>' AND refund_key = '<settlement id>' AND status = 'refunding';   -- must report UPDATE 1
UPDATE public.transport_paystack_intents
   SET refunded_kobo = refunded_kobo + <amount_kobo>,
       status = CASE WHEN refunded_kobo + <amount_kobo> = amount_kobo AND status = 'confirmed' THEN 'refunded' ELSE status END
 WHERE reference = '<reference>';                                                                -- the CHECK rejects an over-refund
COMMIT;
```

then re-POST cancel/complete (or wait for the sweeper) — the settlement's ledger reversal is idempotent and finishes without a second
gateway call. (2b) If it does NOT exist and the lag window has clearly passed, either wait for the sweeper (it re-POSTs once the
window is over and the lookup is clean) or release the piece for an immediate retry:
`UPDATE public.transport_paystack_intent_refunds SET status='failed', post_attempted_at=NULL WHERE reference='<reference>' AND refund_key='<settlement id>' AND status='refunding';`
followed by `UPDATE public.transport_paystack_intents SET refund_reserved_kobo = refund_reserved_kobo - <amount_kobo> WHERE reference='<reference>';`
in the same transaction. Never do (2b) without checking the dashboard first: it can produce a double refund.

**For the `ledger-auditor` (attack surface).**
1. The refund-vs-settle window: complete's compare-and-swap (`active -> completed`) is what keeps `Settle(fare)` and a cancel's gateway
   refund of the same fare apart. Any other writer of `car_hire_bookings.status` (admin patch to a non-money status, then a cancel) or
   a direct `Settle` call is outside that guard. Is a settlement-level claim (e.g. `disputed` as a lock) needed?
2. Complete flips the status BEFORE the money steps; the re-entrant path and the sweeper are the recovery. Is there a state in which a
   completed booking's fare is `settled`, deposit `escrowed`, and the sweeper cannot finish it (e.g. `refunder` unwired ⇒ the sweeper
   fails closed forever)?
3. `bookCarHire` compensation after a failed deposit leg / insert: reverses only settlements that passed the live-escrow check and only
   when `Find` proves no booking owns the key. Verify a concurrent stale-claim double `Book` cannot reverse an escrow a winning
   booking already owns.
4. `refundCarHireSettlements` refunds settlements by reference prefix, `escrowed`/`disputed` only — a `disputed` fare is refunded on
   cancel. Confirm that is intended.
5. Mixed funding: extensions are refused for card bookings, so every settlement of a card booking is external. A wallet booking never
   reaches the card refunder (`refundSettlement` picks the rail per settlement).
6. The piece-refund lookup arithmetic (WP-A) against Paystack lag — see its UNVERIFIED list.

## Consequences

- Tier-0 riders/senders can pay Mobility services by card; wallet rail unchanged.
- One place (engine) to audit for the money invariants; each service is ~100 lines.
- New table + one more webhook prefix per service; flags default off, rollout per service.
- Known follow-ups: ride adapter onto the engine; car hire driver assignment + extension/deduction design (if card car hire must support them); dispute/chargeback webhooks; the bus/event settle-at-booking defect (independent of this ADR). (The reconciliation sweep for stranded refunds is done — H7.)
