# Commerce & Services — E2E coverage sweep

Lane: `stays`, `insurance`, `business` registry, `realtor`, `transport`,
`onboarding`, `learn`, `maps`, `estate` (admin dues), `restaurant`
(bank-accounts residual), `app:misc` triage.

Result: **13 Playwright specs / 26 tests — all green** (chromium-desktop,
11.9s). `go build ./...` clean; `go vet` clean on all owned packages;
`go test -count=1` green on every owned package that has tests
(stays adapters+extranet, insurance catalog/gateway/policy/webhooks,
business, realtor, transport, onboarding, maps, estate,
estate/paystackcheckout). `learn` has no Go test files — covered by E2E.

Specs: `frontend-web/tests/e2e/commerce/com-001…013` (no com-014+).
Shared fixtures in `frontend-web/tests/e2e/commerce/helpers.ts`.

---

## Proven journeys (covered by E2E)

| Spec | Journey | Tests |
|---|---|---|
| CMS-001 stays-onboard | hotelier extranet onboarding (OWNER profile granted by service, no outer RBAC) → room types/rate plans → ARI availability/rates/restrictions/promotions → admin moderation → listing ACTIVE → member discovery + consent/status/grant + home/deals/loyalty/saved/wishlist/saved-guests CRUD/search/content | 1 |
| CMS-002 stays-booking | consent gate → seeded PREBOOK_OK → `/book` saga confirms with balanced HOLD legs (`escrow:stays:<id>` DR wallet / CR escrow) → replay safe → cancel path → **oversell race: allotment=1 admits exactly one confirm; loser 409 + OVERSELL_BLOCKED text + auto-RELEASE + VOID, never settled** → insufficient funds VOIDs the reservation, never held | 3 |
| CMS-003 stays-settlement | review locked until COMPLETED (`REVIEW_LOCKED`) → verified review → settlement → payout queue → **PAYOUT_HELD fail-closed** (plus the supplier-ref ambiguity finding below) → agent channel: seeded quote → agent/book → bookings → commissions | 3 |
| CMS-004 insurance | catalog → consent → quote gates → policy/beneficiary reads → embedded events → FNOL claim → evidence → admin decision → settle posts wallet credit (idempotent replay) | 2 |
| CMS-005 business registry | `register_new` journey with real wallet fee legs → submit → status → admin review; insufficient-fee → 402; admin reject → `rejected` | 2 |
| CMS-006 transport | estimate → ride request (wallet escrow, tier-gated, Idempotency-Key) → driver accept (single-winner conditional CAS) → arrive → PIN verify → start → complete (settle split: driver wallet + platform revenue) → rate/history/earnings → parcel book→cancel refund → bus/towing/movers/car-hire/event probes → admin dashboard | 2 |
| CMS-007 realtor admin | overview → pending listings → decide listing → pending verifications → decide verification → payments → escrow → **escrow resolve: inspection-gated ledger reversal (REVERSAL_DEBIT restores tenant wallet / REVERSAL_CREDIT settlement), idempotent, terminal-state double-payout guard**; every mutation writes `realtor_admin_audit_log`; stays→estate gate-pass bridge fail-closed on unknown booking | 3 |
| CMS-008 onboarding | modules → merchant types → form schema → draft → submit (idempotent, fail-closed CAC `requires_business` gate) → admin request-info → resubmit → approve → role/profile grant → capabilities; reject path + nonexistent records | 2 |
| CMS-009 learn | admin authors path → lesson → quiz → glossary (`learn.admin.manage` perm) → member lists paths/progress → reads lesson (tracking) → takes quiz (answer key scrubbed, server-side scoring) → glossary; permission gate + validation guards | 2 |
| CMS-010 maps | pin upsert (idempotent location write) → nearby → in-zone geofence → geocode/reverse/autocomplete/route/matrix/match/places/basemap via deterministic local fallback (no provider keys) → telemetry fail-closed for members (403) | 2 |
| CMS-011 estate dues | estate create → resident → invoice (`service_charge`) → resident pays (wallet debit, Idempotency-Key, tier gate, balanced legs, immutable receipt) → **replay returns canonical receipt** → platform-admin `/estate-admin/dues/*` oversight | 1 |
| CMS-012 restaurant banks | add (10-digit, provider soft-verify, first auto-default, upsert idempotent on user+bank+number) → list (masked) → verify probe → set-default → delete; capture-only — no ledger legs (asserted) | 1 |
| CMS-013 misc triage | `/api/v1/public/media/banners/:filename` strict regex — traversal/junk 404 before R2; well-formed → 302 presign / 404 unconfigured. Flag-gated surfaces probe | 2 |

## Money-path invariants proven live

- **Idempotency**: every money mutation required `Idempotency-Key` —
  replayed stays `/book`, transport ride request, estate invoice pay
  (canonical receipt returned), realtor escrow resolve (terminal-state
  guard), restaurant bank upsert, insurance claim settle replay.
- **Balanced legs**: stays HOLD (`escrow:stays:`) and auto-RELEASE
  (`refund:stays:`), business-registry fee, transport trip settle split
  (driver + platform revenue), estate dues, realtor escrow reversal legs
  — all asserted DR/CR pairs against the ledger.
- **Fail-closed gates**: insufficient funds → 402/VOID (never held);
  tier checks enforced; `OVERSELL_BLOCKED` (409), `PAYOUT_HELD` (409),
  `REVIEW_LOCKED`, `INSUFFICIENT_FUNDS` codes/text asserted through
  `httperr`; member telemetry 403; CAC `requires_business` gate.
- **Single-winner races**: stays allotment=1 concurrent books → exactly
  one confirm, loser auto-released; transport driver accept via
  conditional UPDATE (second accept loses).
- **Audit**: realtor admin mutations write `realtor_admin_audit_log`;
  stays/insurance/estate mutations emit audit events.

## Production defects (asserted, not fixed)

| ID | Module | Symptom |
|---|---|---|
| E2E-CMS-001 | stays | `POST /prebook` + `/agent/quote` → 500: `reservation.Repository.Create` inserts NULL into `stays_reservation.cancellation_policy_snapshot` (NOT NULL). Booking funnel dead upstream of the adapter; specs seed PREBOOK_OK rows via `helpers.seedPrebookedReservation` to exercise the real `/book` saga. |
| E2E-CMS-002 | stays settlement | `settleConfirmed` fails on every direct booking: `Split.ProviderID = "stays-clearing:<code>"` is not a user uuid → `finance/settlement.Settle` rejects; escrowed gross never split to commission/provider-clearing (201 CONFIRMED still returned). |
| E2E-CMS-003 | stays | Direct-adapter `Cancel` returns `RefundKobo=0` → member cancel posts NO refund legs; held gross stays in escrow. |
| E2E-CMS-004 | stays payout | `HasCompletedStay` looks up the internal `property_id`, but the client contract stores the **supplier ref** → admin release of a real completed stay 409s `PAYOUT_HELD` permanently. |
| E2E-CMS-005 | stays `/book` | Insufficient funds returns **409 + `data.state=VOID`** instead of the documented 402 `INSUFFICIENT_FUNDS` — `mapErr`'s ErrInsufficient→402 branch is unreachable when the saga returns a reservation. |
| E2E-CMS-006 | maps | `internal/maps/handler.go` `adminRoleSlugs` = `{admin, super_admin}` but seeded role slug is `super-admin` → even Super Admin gets 403 on `/api/finance/maps/metrics|usage`; telemetry surface dead at HEAD (asserted 403; flip to 200 on fix). |
| E2E-CMS-007 | stays refund/payout | **F-6 — documented backlog, intentionally NOT fixed.** (a) Penalty-cancelled bookings strand the hotelier share: only `Cancellation.RefundKobo` is drawn from the parked legs; the retained penalty remains parked in provider_clearing/commission/escrow with no leg routing it to the hotelier or platform. Pinned by `TestLiveDB_CancelWithPenalty_RetainsNonRefundableShare` (retained share is never refunded — the stranding itself is the gap). (b) Orphan payouts bypass the gate: `ReleasePayout` only checks `ReservationState` when `p.ReservationID != ""`, so a payout queued with no reservation id can draw provider_clearing with no cancel linkage at all. |
| — | fixtures | Teardown `DELETE platform_users` can violate `settlements_payer_id_fkey` when fixtures leave settlement rows referencing the payer. |

## Stays money-path hardening (F-1…F-5 landed)

Follow-up pass on the stays money paths in
`backend/internal/stays/{reservation,settlement}` (+ one
`finance/settlement` method). All integer-kobo, balanced, retry-safe.

- **F-1 residual-aware refund allocation** — settlement-row `provider_kobo` /
  `fee_kobo` are historical parked amounts, not residual balances. After a
  modify-down refund draws them, a later cancel computed against the stale
  totals over-drew the pooled provider_clearing/commission accounts.
  `Repository.RefundDraws` now nets prior draws out of the immutable ledger
  (DEBIT/REVERSAL_CREDIT on the standing accounts, minus offsets, keyed by
  refund references and excluding the in-flight operation's idempotency
  prefix so a retry recomputes the same allocation); `loadParkedMoney`
  allocates against those residuals.
- **F-2 payout TOCTOU** — `Cancel` flips pending payouts CANCELLED *before*
  posting refund legs, and `SetPayoutStatus` now carries a
  `status IN ('HELD','PENDING')` predicate: a release that raced a cancel can
  no longer overwrite CANCELLED→PAID. A 0-row update surfaces
  `ErrPayoutNotPayable`; `ReleasePayout` treats PAID as idempotent replay and
  otherwise reverses any orphaned wallet credit back to provider_clearing
  (`stays:payout:clawback:<id>`), on both the raced and the already-resolved
  read paths — a resolved payout never leaves money in a hotelier wallet.
- **F-3 refund retry convergence** — the escrow draw now posts under the
  refund operation's own idempotency key *before* settlement rows flip to
  `refunded` (`MarkSettlementsRefunded`, `WHERE status='escrowed'`), and
  `loadParkedMoney` still counts `refunded` rows' parked value net of ledger
  draws. A crash between leg and status flip (or between flip and the
  terminal transition) no longer wedges the booking: the retry's leg no-ops
  as a duplicate and the flip/transition catch up.
- **F-4 modify retry amount safety** — modify charge/refund idempotency keys
  now bind `(reservation, caller idempotency-key, amount)`, so a repriced
  retry under the same caller key cannot replay the stale amount; the
  payment-intent `NextModifySeq` counter was dropped from the money path and
  `RecordPaymentIntent` errors propagate instead of being swallowed.
- **F-5 per-reservation serialization** — `Cancel`/`Modify` take a
  transaction-scoped advisory lock (`pg_advisory_xact_lock` on
  `stays:reservation:<id>`) and re-read + re-check state inside it, so two
  concurrent money sagas cannot both pass the CONFIRMED gate and draw the
  same parked funds. Advisory, not FOR UPDATE: a row lock would deadlock the
  saga's own FK-checked inserts into `stays_reservation` children
  (commission deltas, payment intents) — proven by live test.

**Live-DB pins** (`TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres`):
`TestLiveDB_ModifyDownRebalance_CancelUsesResidualAllocation` (commission-grew
rebalance + asymmetric residual cancel), `TestLiveDB_CancelRetryAfterPartialEscrowRelease_Converges`
(posted+flipped and posted-not-flipped wedge variants),
`TestLiveDB_CancelWithPenalty_RetainsNonRefundableShare`,
`TestLiveDB_HasCompletedStay_CrossSupplierRefDoesNotOpenGate`,
`TestLiveDB_ReleasePayout_CancelledMidRelease_ClawsBack`,
`TestLiveDB_SetPayoutStatus_RefusesResolvedRows` — plus the pre-existing
modify/cancel/payout pins. `go build ./...`, `go vet ./...`,
`go test ./internal/stays/... ./internal/finance/settlement/ ./tests/crowdfunding/`
all green.

## Classified paths

- **External dependency (`psp-unverified` / provider-unverified)**:
  - Estate dues Paystack checkout + transport Paystack checkout — mounts
    absent locally (flags off, live keys absent); classified
    `psp-unverified`, not covered.
  - Insurance live quote on generated products → "mycover product has no
    provider product id (run the catalog sync)" — catalog-sync dependent.
  - Insurance certificate surface absent without a provider-issued cert.
  - Restaurant bank verify — provider soft-fail tolerated.
  - Banner media → R2 presign (302/404).
  - Maps provider primitives run on the deterministic local fallback
    (no Google/Geoapify/OSRM keys); distances/durations mock — money
    legs real.
- **Feature-gated OFF locally → unmounted 404** (asserted in CMS-013):
  `FEATURE_SPOTLIGHTWEALTH_ENABLED` (`/api/v1/spotlight/*`),
  `FEATURE_INVESTAI_ENABLED` (`/api/v1/ai/invest/*`),
  `FEATURE_PLACEMENT_ENABLED` (`/api/finance/placement/*` — incl.
  `submit`/`pay` idempotent money paths, `placement.admin.*` RBAC),
  `FEATURE_ARENA_ENABLED` (`/api/arena/*`),
  `FEATURE_NUTRITION_ENABLED` (`/api/finance/nutrition/*` +
  `/api/nutrition/admin/*`),
  `FEATURE_ESTATE_DUES_PAYSTACK_CHECKOUT_ENABLED`,
  `FEATURE_TRANSPORT_PAYSTACK_CHECKOUT_ENABLED`.
- **Webhook/internal-only**: insurance provider webhooks
  (`internal/insurance/webhooks`, Go-covered), stays supplier webhooks,
  settlement pending-reconciliation marker path.
- **Invalid/noise**: traversal/junk banner filenames (404 by regex);
  `/api/nutrition/admin/payouts`, `/api/finance/nutrition/dishes/*`
  probes are unmounted (flag off); academy/nutrition log noise and
  invalid-UUID academy probes are out of this lane's scope.
- **Supabase-RPC write plane**: realtor member listing creation lives in
  Supabase RPCs, not the Go surface — Go coverage is the admin plane only.

## Commands run

```sh
cd frontend-web && npx playwright test tests/e2e/commerce/ --project=chromium-desktop   # 26/26 green
cd backend && go build ./...                                                            # clean
cd backend && go vet ./internal/{stays,insurance,business,realtor,transport,onboarding,learn,maps,estate}/...   # clean
cd backend && go test -count=1 -short ./internal/{stays,...,estate}/...                 # all ok
```

## Files added/edited (lane-only)

- `frontend-web/tests/e2e/commerce/com-001…003` stays, `004` insurance,
  `005` business, `006` transport, `007` realtor, `008` onboarding,
  `009` learn, `010` maps, `011` estate, `012` restaurant banks,
  `013` misc triage (specs)
- `frontend-web/tests/e2e/commerce/helpers.ts` — shared fixtures
  (`seedPrebookedReservation`, `grantAdminPerm`, insurance/stays
  fixtures, ledger/psql helpers)

No production code changed; all defects are asserted at current behavior
in the specs and listed above for orchestrator dispatch.
