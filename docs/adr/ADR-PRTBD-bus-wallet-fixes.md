# ADR-PRTBD: Wallet bus path — truthful refunds, deferred settlement, idempotent booking

Status: proposed (rename file + references to `ADR-PR<n>-bus-wallet-fixes` once the PR number exists)
Scope: wallet-funded bus booking only. Card-direct bus is deliberately NOT in this change.

## Context

`BookBusTicket` escrowed the fare and then **Settled to the operator immediately**.
`CancelBusTicket` later flipped the ticket to `cancelled / payment_status='refunded'`
and called `settlement.Refund` with the error discarded (`_ =`). `Refund` only works on
an `escrowed` settlement, so for every settled ticket the call failed silently: the
rider got nothing while the app said "refunded". `CancelEventBooking` had the identical
defect. A read-only investigation also found: a retry after a failed `Settle` produced a
free ticket; every INSERT error was reported as `SEAT_TAKEN`; a cancelled seat could
never be re-booked (UNIQUE across all rows vs. a seat map that treats cancelled as free);
booking skipped checks that only search enforced; the payout recipient silently fell
back to `routes.operator_id`; boarding validation had no time window; nothing could
cancel a schedule; and nothing ever wrote `departed/completed/no_show`.

## Decisions

### 1. A refund is only ever reported when money moved
- Cancel is a CAS state machine: **decide → claim ticket (`status='cancelled',
  refund_status='pending'`) → `settlement.Refund` → finalize (`payment_status='refunded',
  refund_status='refunded'`)**. `refunded` is written only after the wallet credit posted.
- Response carries `refund_status` ∈ `refunded | pending | failed | none | manual_required`
  and `refunded_kobo`. HTTP 200 only when refunded; **202** while pending/failed.
- Already paid out (settlement `settled`) ⇒ **409 `REFUND_REQUIRES_SUPPORT`**, ticket untouched.
- Repeating a cancel resumes/returns the same outcome; a sweeper retries pending/failed refunds.
- Event bookings get the same treatment: an escrowed booking refunds; a settled one (the normal
  case - events settle on book) is cancelled with `refund_status='manual_required'` plus an
  `event.cancelled_manual_refund_required` audit event for ops - never reported as refunded.
  Pending/failed event refunds are retried by the sweep.

### 2. Deferred settlement (`FEATURE_TRANSPORT_BUS_DEFERRED_SETTLEMENT`, default OFF)
- ON: booking leaves the settlement `escrowed`; the transport-scheduler worker settles at
  `departure + TRANSPORT_BUS_SETTLE_GRACE_MINUTES` (default 30). Settling at the boarding
  scan was considered and rejected: it adds a second trigger racing cancel/schedule-cancel
  for no benefit, because boarded tickets are already non-cancellable by the rider.
- **Split and recipient are FROZEN on the ticket at booking** (`provider_pct`,
  `platform_pct`, `settle_user_id`, `cancel_cutoff_minutes`); settle never re-reads
  `transport_commission_config` or the provider owner. The split is validated before escrow.
- **Mutual exclusion cancel ⇄ settle** is by compare-and-swap on `bus_tickets.payout_state`
  (`held → releasing → released`): settle claims `held→releasing`; cancel claims only on
  `held|released` and rejects `releasing`. The settlement row lock (`FOR UPDATE` in
  `Settle`/`Refund`) is the final arbiter. Tested concurrently.
- Cancel cutoff: per-schedule `bus_schedules.cancel_cutoff_minutes` (60–1440) else
  `TRANSPORT_BUS_CANCEL_CUTOFF_MINUTES` (default 120). After the cutoff ⇒ 409
  `CANCEL_WINDOW_CLOSED`. Never after departure.
- **Commission earning**: recorded when the fare is *paid out* (at settle), not at booking, via
  `RecordExact` with the platform kobo the settlement legs really moved (frozen split), not the
  live rate card. A ticket refunded while escrowed therefore never has an earning row (earnings
  are append-only/immutable, so a reversing row is avoided by construction; it also keeps the
  referral hook from firing on revenue that never existed).
  Legacy mode (flag OFF) still records at booking and a settled ticket can no longer be refunded.
- OFF: legacy settle-on-issue is unchanged, but the lie stops (item 1).

### 3. Idempotent booking
Ticket id = `uuid.NewSHA1(ns, userID|idempotencyKey)`; a ticket is looked up by key first
and replayed. A different user/schedule/seat on the same key ⇒ 409
`IDEMPOTENCY_KEY_CONFLICT`. If the escrow row Escrow replays is not still `escrowed` for the
same amount (an earlier attempt was refunded) the key is rejected — it can never mint a
free ticket. If settle fails after issue the retry **resumes the settle**; the escrow is
never refunded when a ticket for the key exists.

### 4. Error classification
Only a unique violation on the seat index ⇒ `SEAT_TAKEN`. A duplicate idempotency key/id is
a concurrent replay. Anything else ⇒ 500 and the escrow is reversed (only if no ticket
exists for the key; if that lookup itself fails the escrow is left for reconciliation and
logged). The insert runs under `FOR SHARE` on the schedule row so a concurrent schedule
cancel cannot interleave.

### 5. Booking guards / validation
Departure ≥ now + `TRANSPORT_BUS_MIN_BOOKING_LEAD_MINUTES` (15), provider verified+active,
schedule `scheduled|boarding`, fare approved, route active; **no fallback** of the payout
recipient — unresolved provider/owner ⇒ 409 `PROVIDER_UNAVAILABLE`. Boarding scan: window
`[departure − 3h, (arrival_estimate | departure+24h) + 30m]`, rejects cancelled/refunded
tickets and cancelled schedules, status flip is a CAS.

### 6. Schedule cancel + sweeper
`POST /mobility/bus/provider/schedules/:id/cancel` (owner-gated) and
`POST /admin/transport/bus/schedules/:id/cancel` (`mobility.bus.manage`): cancel the schedule,
then refund every active ticket through the same CAS machine (no cutoff). Already-paid-out
tickets ⇒ `cancelled` + `refund_status='manual_required'` (never "refunded"). Idempotent and
resumable; the summary is read back from persisted state. Sweeper
(`FEATURE_TRANSPORT_BUS_LIFECYCLE_SWEEPER`, default OFF, gates ONLY the lifecycle step): schedule → `departed` at departure, → `completed` at end+grace; boarded tickets →
`completed`; never-boarded tickets → `boarding_status='no_show'` once the window closed.

### 7. Migrations
- `20271013000000_bus_ticket_deferred_settlement_and_refund_truth.sql` — additive only.
- `20271013000100_bus_ticket_seat_unique_active_only.sql` — **USER-APPROVED EXCEPTION to
  additive-only**: creates the partial unique index (FIRST, so there is never a window without
  seat uniqueness even on a non-transactional runner such as plain `psql -f`) and then drops
  `UNIQUE(schedule_id, seat_number)` (found by column set, not by name). A plain (non-CONCURRENT)
  `CREATE UNIQUE INDEX` takes a SHARE lock on `bus_tickets` while it builds - writes block,
  reads do not; the table is small so this is sub-second. The index is
  `bus_tickets_schedule_seat_active_uidx ... WHERE status NOT IN ('cancelled','refunded')`
  — the same predicate the seat map already uses. Own file so it can be dropped from the PR;
  if dropped, a cancelled seat stays un-rebookable (the code still maps the legacy
  constraint name to `SEAT_TAKEN`). Safe on existing data (old constraint was stricter).

## Flags and env (all new, all default OFF / safe)
| name | default | meaning |
|---|---|---|
| `FEATURE_TRANSPORT_BUS_DEFERRED_SETTLEMENT` | false | keep wallet bus fares escrowed until departure+grace |
| `FEATURE_TRANSPORT_BUS_LIFECYCLE_SWEEPER` | false | advance schedules/tickets to departed/completed/no_show |
| `TRANSPORT_BUS_SETTLE_GRACE_MINUTES` | 30 | deferred settle delay after departure |
| `TRANSPORT_BUS_CANCEL_CUTOFF_MINUTES` | 120 | default cancel cutoff, clamped 60–1440 |
| `TRANSPORT_BUS_MIN_BOOKING_LEAD_MINUTES` | 15 | latest booking before departure |

The `transport-scheduler` worker's **bus-sweep runs whenever `FEATURE_TRANSPORT_MODES_ENABLED`
(or a bus flag) is on**, with no dependence on the deferred flag: bus + event refund retries,
finishing tickets stranded on cancelled schedules, reversing orphan escrows (>10 min, no ticket)
and paying out due deferred tickets. Because payout does not depend on the worker's flag, an
API/worker flag mismatch cannot strand money; a worker with the flag off but deferred tickets
pending logs `FLAG MISMATCH` every sweep (and drains them anyway). The Render worker wrapper
now idles only if scheduling, modes and both bus flags are all off (set
`FEATURE_TRANSPORT_MODES_ENABLED` on the worker too).

Rollout: apply both migrations → deploy API → deploy worker with the flags → enable the flag
on API and worker together. **Rollback**: turning the deferred flag OFF is safe - already-deferred tickets are still paid
out (and refundable) by the always-on sweep; only NEW tickets revert to settle-on-issue. Track the
drain with
`SELECT count(*) FROM bus_tickets WHERE settle_mode='deferred' AND payout_state IN ('held','releasing') AND status NOT IN ('cancelled','refunded');`

## Ops runbook — existing damage (DOCUMENT ONLY; nothing here has been run on any DB)

### (i) Size it
Definitive test = "ticket says refunded but no refund credit leg exists in the ledger"
(`Refund` posts `refund:<settlement_id>:credit`).

```sql
-- Bus: tickets marked refunded with NO refund credit posted
SELECT t.id, t.user_id, t.fare_kobo, t.settlement_id, st.status AS settlement_status,
       st.settled_at, t.created_at
FROM bus_tickets t
LEFT JOIN settlements st ON st.id = t.settlement_id
LEFT JOIN ledger_entries le ON le.idempotency_key = 'refund:' || t.settlement_id::text || ':credit'
WHERE t.payment_status = 'refunded' AND le.id IS NULL
ORDER BY t.created_at;

-- Rollup (count + kobo owed), split by settlement status
SELECT COALESCE(st.status,'(no settlement)') AS settlement_status,
       count(*) AS tickets, sum(t.fare_kobo) AS owed_kobo
FROM bus_tickets t
LEFT JOIN settlements st ON st.id = t.settlement_id
LEFT JOIN ledger_entries le ON le.idempotency_key = 'refund:' || t.settlement_id::text || ':credit'
WHERE t.payment_status = 'refunded' AND le.id IS NULL
GROUP BY 1;

-- Event bookings (old code set status='refunded')
SELECT b.id, b.user_id, b.fare_kobo, b.settlement_id, st.status AS settlement_status
FROM event_transport_bookings b
LEFT JOIN settlements st ON st.id = b.settlement_id
LEFT JOIN ledger_entries le ON le.idempotency_key = 'refund:' || b.settlement_id::text || ':credit'
WHERE b.status = 'refunded' AND b.refund_status = 'none' AND le.id IS NULL;

-- Quick-and-cheaper approximation (no ledger join): refunded flag on a settled settlement
SELECT count(*), sum(t.fare_kobo) FROM bus_tickets t
JOIN settlements st ON st.id = t.settlement_id
WHERE t.payment_status = 'refunded' AND st.status = 'settled';
```
Also check commission earnings recorded for those tickets (the old code recorded at booking,
key = ticket id): `SELECT * FROM commission_earnings WHERE source_module='transport' AND source_ref = ANY(<ticket ids>)`.

### (ii) Safe remediation approach (not automated; clawback out of scope)
1. Ship the fix first so no new faked refunds are created.
2. Export the (i) list; finance reviews and decides who bears each amount (platform
   absorbs vs. recover from the provider payout) — a business decision, not a code one.
3. Pay riders through a reviewed one-off script using the ledger's idempotent
   `Credit`/`PostJournal` with a deterministic key `bus-remediation:<ticket_id>` (re-runnable
   safely), from the funding account finance chooses, with an audit row per ticket and a
   dry-run mode that only prints. Do NOT mutate `settlements` rows or ledger entries
   (immutable); do not re-run `settlement.Refund` (it correctly refuses a settled row).
4. After each credit set `bus_tickets.refund_status='refunded', refunded_at=now()` (the
   ticket already says `payment_status='refunded'`), so the (i) query returns empty.
5. Commission earnings for those tickets are append-only: finance posts reversing earning
   rows through the commission module's normal correction path.
6. Notify affected riders after, not before, the credit posts.

## Other findings (not changed here)
- `mode_ratings.mode` CHECK allows only `parcel|towing|mover`, so `RateBusTrip` (mode `'bus'`)
  is rejected by the database. Widening a CHECK is not additive; needs its own decision.
- `settlement.Escrow` keys its ledger debit on the caller key without a user scope; the bus
  path now guards this at the ticket layer (key conflict across users ⇒ 409), other modules unchanged.

## Verification
## Resolved after ledger audit (no Criticals; all High/Medium/Low addressed, test-first)
| finding | resolution | test |
|---|---|---|
| H1 settlement already `refunded` but ticket active -> API said refunded, ticket stayed valid; finalize ignored 0 rows | Resume on a live ticket now CLAIMS (cancels) it first; every finalize checks `RowsAffected` and on 0 re-reads and reports the stored `refund_status`; same for events; schedule cancel completes | `Audit_H1_SettlementAlreadyRefundedStillCancelsTicket`, `Audit_H1_Event_SettlementAlreadyRefundedStillCancelsBooking` |
| M1 overlapping settlers / revert races a live Settle / refund of a paid-out ticket loops as `failed` | settle claims `held` only (`releasing` re-claimable only when `payout_claimed_at` > 5 min old); revert is conditional on OUR claim and an `escrowed` settlement; a refund that finds the settlement settled/releasing/disputed parks the ticket as `manual_required` (+ALERT log + audit), never `failed` | `Audit_M1_FreshReleasingClaimIsNotStolenStaleIs`, `Audit_M1_RefundOfPaidOutTicketBecomesManualRequired` |
| M2 refund-retry worker did not run with default flags; ADR wrong | bus-sweep runs whenever modes/bus flags are on; settle independent of the worker flag; `FLAG MISMATCH` logged; Render guard + ADR corrected | `Audit_M2_SweepDrainsDeferredEvenWithWorkerFlagOff` |
| M3 active tickets stranded on a cancelled schedule | sweeper step cancels/refunds them (operator path); settle claim refuses a cancelled schedule; paid-out => `manual_required` | `Audit_M3_SweeperRefundsStrandedTicketsOnCancelledSchedule`, `Audit_M3_SettleRefusesCancelledSchedule` |
| M4 schedule cancel past departure / unchecked status UPDATE | provider path refuses `departure <= now`; admin needs `force=true` (audited); 0-row UPDATE aborts unless already cancelled | `Audit_M4_ProviderCannotCancelPastDeparture`, `Audit_M4_AdminForceOverridesPastDeparture` |
| M5 escrow idempotency key not user-scoped | Escrow keyed `bus:<ticketID>` (ticket id is user+key derived); settlement payer verified BEFORE any debit | `Audit_M5_CrossUserKeyCollisionIsIsolated` |
| M6 event cancel was a 409 dead end | settled booking => cancelled + `manual_required` + ops audit event; event refunds added to the retry sweep. **Deviation:** no extra flag - there is no legacy path that could genuinely refund a settled booking, and an escrowed booking still refunds as before | `Event_CancelOfSettledBookingGoesToManualRefundNotFaked`, `Audit_M6_EventRefundRetriedBySweep` |
| M7 earning vs frozen split could disagree | earning recorded with `RecordExact` = platform kobo from the frozen split legs | `Audit_M7_EarningUsesFrozenPlatformCut` |
| L1 replay of a cancelled/refunded key returned 201 | 409 `IDEMPOTENCY_KEY_CONFLICT` | `Audit_L1_ReplayOfCancelledTicketConflicts` |
| L1 orphan `bus:` escrows | sweep reverses wallet escrows >10 min old with no ticket | `Audit_L1_OrphanEscrowIsReversedOnlyWhenOldAndTicketless` |
| L1 mobile key regenerated inside `charge()` | key generated once per attempt in `review.tsx` | reviewed + tsc (no RN test harness for screens) |
| L1 disputed settlement spun the sweeper | parked once as `manual_required` + single audit | `Audit_L1_DisputedSettlementIsParkedOnce` |
| L1 ticket payload lacked route/operator | `routeLabel/originTerminal/destTerminal/operatorName/arriveAt` added (spec + existing normaliser) | `Audit_L1_TicketPayloadHasRouteAndOperator` |
| L1 bad `arrival_estimate` completed schedules early | sweeper ignores an arrival not after departure (same rule as the boarding window) | `Audit_L1_BadArrivalEstimateDoesNotCompleteEarly` |
| L1 migration 2 lock/window | index created first, constraint dropped after; lock + non-transactional runner documented in the migration and above | fresh replay of the whole chain on a throwaway postgis |
| (found while fixing) worker audit rows silently dropped: `transport_audit_log.admin_id` is a NOT NULL uuid and the label "system" is not one | system actor is the nil UUID | covered by the audit-count assertions above |

Backend: `bus_wallet_test.go` (pure) and `bus_wallet_live_db_test.go` (live DB, 17+ tests)
incl. the four pre-fix reproductions (cancel-after-settle lie, free ticket on retry,
masked SEAT_TAKEN, un-rebookable seat), concurrent cancel/settle exclusivity, frozen split,
schedule cancel idempotency, validation window, lifecycle sweep, event cancel.
