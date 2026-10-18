# Bus Transport v2 — Production Readiness Checklist

Gate list for `FEATURE_BUS_TRANSPORT_V2` rollout. Every box links a verifiable
artifact or test; "owner" = the role that signs, not necessarily implements.

## Acceptance gates

- [ ] Search returns `outbound`/`return` groups; multi-stop routes expose
      board/alight segments with correct OD fares (contract test vs
      `docs/bus-transport/api-contract.md`).
- [ ] Hold → book → pay → issue completes end-to-end on staging for one-way
      and return itineraries, incl. 2+ passengers and book-for-another
      (`deliver_to`) delivery.
- [ ] Segment inventory: overlapping holds are rejected (`SEAT_CONFLICT`);
      the same seat IS resellable on non-overlapping segments — proven by a
      live-DB invariant test on `bus_seat_occupancy`.
- [ ] Idempotent replay: repeating POST /holds and POST /book with the same
      Idempotency-Key returns the original result, never a duplicate.
- [ ] Hold TTL expiry releases seats and blocks stale bookings
      (`HOLD_EXPIRED`); sweeper verified on staging.
- [ ] Cancellation request honours the policy (cut-off, fee, refund %) and the
      refund lands via the compensation path; `cancel_requested → refunded`
      audited.
- [ ] Ticket QR carries a non-guessable token; provider check-in validates it
      at the correct stop_seq and rejects replays/foreign departures.
- [ ] Golden-path + money-invariant suites green; e2e bus spec green
      (`EXPO_PUBLIC_BUS_V2` pinned mock + one live happy path on staging).

## Security gates

- [ ] All money mutations require `Idempotency-Key` and emit audit events
      (holds, book, paystack/initiate, cancel, provider check-in, admin ops).
- [ ] Customer endpoints scoped to caller: `GET /tickets/:ref` 404s/403s other
      users' refs; provider endpoints gated to the operator's own provider id.
- [ ] Webhook verification: HMAC-SHA512 signature enforced, replay-safe.
- [ ] KYB: CAC check + Tier-2 kycverify gate before an operator can publish;
      approve/reject/suspend actions maker-checked and audited.
- [ ] PII: passenger name/phone minimised in logs; manifest access audited.
- [ ] `security-reviewer` sign-off on auth/PII surfaces; `ledger-auditor`
      sign-off on the fare escrow → settle path.

## Performance gates

- [ ] Search p95 < 500ms with 200 concurrent searches on a seeded route set.
- [ ] Seat-map detail p95 < 400ms; occupancy lookup indexed on
      (departure_id, seat_id, from_seq, to_seq).
- [ ] Hold create p95 < 300ms under seat-contention load test (same departure,
      overlapping segments) — no serialization error leaks to 500s.
- [ ] Webhook → issued ticket p95 < 5s; pending_payment sweeper covers the tail.

## Rollout gates

- [ ] `FEATURE_BUS_TRANSPORT_V2` + module-visibility row exist and default OFF
      in production; flag flips without deploy verified on staging.
- [ ] `EXPO_PUBLIC_BUS_V2=false` in production/staging env manifests
      (mockAllowed already forces live in mockless envs — belt + braces).
- [ ] Migrations additive-only, no reused versions
      (`scripts/ci/check-migration-versions.sh` green).
- [ ] Runbook (`operations-runbook.md`) reviewed by on-call; reconciliation
      dashboard live BEFORE first real booking.
- [ ] Rollback rehearsed: flag off mid-flow on staging; pending bookings still
      resolve via webhook.
- [ ] Seed data: `bus_geo_state`/`bus_geo_city` reference rows loaded and
      admin-managed; no hard-coded lists left in clients.
