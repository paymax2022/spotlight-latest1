# Bus Transport v2 — Operations Runbook

Scope: customer booking flow (search → holds → book → Paystack → tickets),
operator KYB, manifests/check-in, settlement. Backend: `backend/internal/transport/*`
behind `FEATURE_BUS_TRANSPORT_V2`. Money is integer kobo; the ledger is the
system of record.

## Dashboards / signals to watch

- **Booking funnel**: searches → holds created → bookings → paid → issued.
  Step-drop alerts: hold→book < 70% in 15m; book→issued < 90% in 30m.
- **Hold health**: active holds count, hold expiry rate, `SEAT_CONFLICT` 409s
  per departure (spikes = double-sell races or leaked occupancy).
- **Payment**: `POST /mobility/bus/paystack/initiate` error rate, webhook
  `charge.success` lag, pending_payment bookings older than 30m.
- **Ledger**: escrow balance per departure vs issued fares — must never
  diverge; `bus_seat_occupancy` insert failures (overlap guard).
- **Provider ops**: manifest views per departure, check-in rate
  (`provider/checkin` per manifest size), trip status events.
- **Settlement**: reconciliation endpoint output — unsettled escrows past
  departure+grace.

## Common incidents

### Webhook delays → bookings stuck `pending_payment`
1. Check Paystack status + webhook delivery in the Paystack dashboard.
2. Query bookings: status `pending_payment` with a successful Paystack charge
   (match on `reference` `pmx_bus_*`).
3. Replay the Paystack event or POST the webhook manually; ticket issuance is
   idempotent on webhook replay.
4. If hold TTL lapsed while pending: booking stays valid — occupancy is
   written on issuance; only refund the charge if the departure is sold out
   (server rejects issuance → refund via compensation path).

### Double-sell / seat conflict storms
`SEAT_CONFLICT` is the working overlap guard (`from_seq < new.to_seq AND
to_seq > new.from_seq`). If conflicts spike on one departure, inspect
`bus_seat_occupancy` + `bus_seat_hold` rows for that departure; look for holds
not expiring (sweeper down) or occupancy rows written outside the txn.

### Refund stuck after cancellation
Cancel is a REQUEST → `cancel_requested` → refund via existing compensation
path. Check `refund_status`: `pending`/`failed` = retry the compensation job;
`manual_required` = hand to support with booking_ref + audit event id.

### Provider outage (operator no-show / bus breakdown)
1. `POST /provider/trips/:id/status` → `cancelled` (operator or platform admin).
2. All active tickets on the departure move to refundable: cancel with 100%
   refund regardless of the normal cut-off — run the bulk-cancel job for the
   departure, then notify passengers.
3. If a rescue vehicle covers the trip: status stays scheduled; manifest and
   tokens are unchanged (tickets key on booking, not vehicle).

### CAC/KYB adapter down
Provider registrations queue with `verification_status=pending` and a
`provider_unavailable` note; the reviewer queue shows them flagged. Do NOT
approve manually without a cleared CAC + Tier-2 kycverify gate — resume the
adapter and let automation re-run.

## Reconciliation (daily)

- `GET /admin/bus/reconciliation`: issued fares per departure vs escrowed
  amounts vs settled batches. Investigate any row where
  `escrowed − settled − refunded ≠ 0`.
- Settlement batch ops run at departure+grace; a batch that fails twice is a
  pageable event — check the ledger error before re-running (entries are
  immutable; corrections are reversing entries only).

## Rollback

- Flag off `FEATURE_BUS_TRANSPORT_V2` (+ module-visibility row): v2 endpoints
  404, customers fall back to the legacy flat bus flow, which keeps working
  (both write paths are additive).
- In-flight holds expire on their TTL — no cleanup needed.
- `pending_payment` bookings at flag-off still resolve via webhook; settle or
  refund through the normal compensation path — do not hand-edit.
