# Surface: Stays Supplier Extranet (`frontend-admin/app/extranet/`)

**Risk tier: 1 (settlement/payout = 0).** Partner-facing portal for hotel/short-let suppliers,
backed by `backend/internal/stays` (extranet + settlement + supplierwebhooks). Suppliers manage
inventory, rates, reservations, and get paid. See the STAYS module file
(`../modules/stays.md`) for the member-side booking flow and settlement invariants.

## 1. Flows in scope

Onboarding (signup → property → content-wizard → policies → verification → go-live), calendar,
rate-plans, room-types, restrictions, reservations (list + `[id]` + modify + bulk-edit),
photos, amenities, promotions, reviews, inbox, invoices, payouts, bank, commission,
deposit-recon, analytics (bookers/conversion/market/performance), loyalty, staff.

## 2. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| EXT-FSM-001 | Onboarding → go-live | P1 | new supplier | signup → property → content → policies → verification → go-live | — | Property only bookable after go-live; each step gated on the prior |
| EXT-AUTHZ-001 | Supplier sees only own property | P0 | supplier A + B | A opens B's reservation `[id]` | B's id | 403/404 (object-level) |
| EXT-AUTHZ-002 | Staff role scoping | P1 | supplier with staff roles | Staff member without payouts role opens payouts | — | Denied |
| EXT-INT-001 | ARI update reflected in search | P1 | live property | Update availability/rate/inventory | — | Member search/pricing reflects change; no overbooking below inventory |
| EXT-INT-002 | Overbooking guard | P0 | inventory = 1 | Two concurrent bookings for the same night | — | Exactly one succeeds; the other rejected |
| EXT-INT-003 | Reservation modify/cancel | P1 | confirmed reservation | Modify dates; cancel | — | State transitions valid; refund/penalty per policy |
| EXT-MONEY-001 | Payout / remittance accrual | P0 | completed stay | Trigger settlement | kobo | Commission accrues; supplier payable = total − commission, kobo-exact; no negative leg (`../cross-cutting/money-invariants.md` I9) |
| EXT-MONEY-002 | Commission config applied | P1 | markup/commission rule | Book with rule active | — | Correct commission computed; reconciles in deposit-recon |
| EXT-WH-001 | Supplier webhook signature | P0 | — | POST supplier webhook forged | tampered | Rejected (`../cross-cutting/webhooks-and-providers.md`) |
| EXT-SEC-001 | Bank/payout detail change | P0 | supplier | Change payout bank account | — | Requires re-auth/verification; change audited; not applied to in-flight payouts |

## 3. Automated specs to add

- Overbooking concurrency test (EXT-INT-002) at the reservation seam.
- Settlement accrual integration test vs ledger (EXT-MONEY-001) — feeds gap G9.

## 4. Exit criteria

Go-live gating enforced; object-level isolation between suppliers; overbooking impossible;
payout accrual reconciles kobo-exact; supplier webhook signatures verified.
