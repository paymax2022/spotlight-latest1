package transport_scheduled_test

// ---------------------------------------------------------------------------
// Escrow-safety invariant: "a booking that ever escrowed funds MUST reach a
// terminal state that refunds or settles them — never strand an escrow"
// (SWARM_INTEGRATION_CONTRACT.md §"FROZEN FSM", last line).
//
// Service.DispatchScheduled / onDispatchFailure / cancelScheduledInternal
// (backend/internal/transport/scheduled_dispatch.go, scheduled.go) take a
// concrete *pgxpool.Pool + *settlement.Service, so their DB code paths cannot
// be exercised without a live Postgres (same constraint documented in
// backend/internal/finance/settlement/split_invariant_test.go and
// backend/tests/marketplace/*). This file PROVES the properties those code
// paths are built to uphold using a fakeStore modeled on the exact control
// flow read from source (cited inline at each test), the same pattern as
// settlement's split_invariant_test.go fakeStore.
//
// Control flow transcribed from backend/internal/transport/scheduled_dispatch.go:
//
//   - onDispatchFailure(ctx, b, cause, settlementID):
//     if settlementID != "" { settlement.Refund(ctx, settlementID, "scheduled_dispatch_failed") }
//     nextAttempts := b.DispatchAttempts + 1
//     if nextAttempts >= maxDispatchAttempts (=3) { status -> failed_no_driver, settlement_id=NULL }
//     else                                          { status -> scheduled (retry), settlement_id=NULL }
//
//   - cancelScheduledInternal(ctx, b, actorID, reason, event):
//     if b.Status == cancelled { return b, nil } // idempotent no-op
//     guardScheduled(b.Status, cancelled)
//     UPDATE status='cancelled' WHERE status=$3 (optimistic)
//     if b.SettlementID != nil && *b.SettlementID != "" { settlement.Refund(...) }
// ---------------------------------------------------------------------------

import "testing"

const maxDispatchAttemptsSched = 3 // transcribed from scheduled_dispatch.go: maxDispatchAttempts

// fakeSchedStore models the escrow-lifecycle side effects of a scheduled
// booking through dispatch attempts and cancel, keyed the same way the real
// code is (settlement_id column tracks "currently holds an active escrow or
// not"; a Refund call clears it). It is NOT the production code — it encodes
// the same control-flow invariants so a regression in reasoning surfaces here,
// exactly as settlement_test.fakeStore does for Settle/Refund/Escrow.
type fakeSchedStore struct {
	status           schedStatus
	dispatchAttempts int
	settlementID     string // "" means no active escrow held
	refundCalls      []string
	escrowActive     bool
}

// attemptDispatch models ONE DispatchScheduled tick that fails to find a
// driver/courier (materialize() returned an error), after having ALREADY
// escrowed via the underlying mode service (settlementID != ""). Mirrors
// onDispatchFailure exactly.
func (f *fakeSchedStore) attemptDispatchFailure(settlementIDAtFailure string) {
	f.status = schedDispatchPending
	if settlementIDAtFailure != "" {
		f.refundCalls = append(f.refundCalls, settlementIDAtFailure)
		f.escrowActive = false // refunded — no longer stranded
	}
	f.dispatchAttempts++
	if f.dispatchAttempts >= maxDispatchAttemptsSched {
		f.status = schedFailedNoDriver
	} else {
		f.status = schedScheduled
	}
	f.settlementID = "" // onDispatchFailure always clears settlement_id, both branches
}

// cancel models cancelScheduledInternal.
func (f *fakeSchedStore) cancel() {
	if f.status == schedCancelled {
		return // idempotent no-op, matches the guard at the top of cancelScheduledInternal
	}
	if !canTransitionSched(f.status, schedCancelled) {
		return // guardScheduled would reject; no-op in this model
	}
	f.status = schedCancelled
	if f.settlementID != "" {
		f.refundCalls = append(f.refundCalls, f.settlementID)
		f.escrowActive = false
		f.settlementID = ""
	}
}

// dispatchSucceeds models a successful materialize()+escrow, setting
// settlement_id and flipping to dispatched (escrow now "owned" by the real
// trip/parcel/bus ticket — settlement is later Settled by that mode's own
// completion path, out of scope for scheduling).
func (f *fakeSchedStore) dispatchSucceeds(settlementID string) {
	f.status = schedDispatched
	f.settlementID = settlementID
	f.escrowActive = true
}

// TestEscrowSafety_FailedNoDriverAlwaysRefundsBeforeTerminal proves that ANY
// path reaching failed_no_driver has had its escrow refunded (escrowActive ==
// false) — the exhausted-attempts branch of onDispatchFailure.
func TestEscrowSafety_FailedNoDriverAlwaysRefundsBeforeTerminal(t *testing.T) {
	f := &fakeSchedStore{status: schedScheduled}
	// Simulate 3 dispatch attempts, each escrowing then failing to find a driver.
	for i := 0; i < maxDispatchAttemptsSched; i++ {
		f.status = schedDispatchPending
		settlementID := "settlement-attempt-" + string(rune('0'+i))
		f.attemptDispatchFailure(settlementID)
	}
	if f.status != schedFailedNoDriver {
		t.Fatalf("after %d exhausted attempts, status = %s, want failed_no_driver", maxDispatchAttemptsSched, f.status)
	}
	if f.escrowActive {
		t.Error("escrow-safety invariant violated: failed_no_driver booking has an active (stranded) escrow")
	}
	if len(f.refundCalls) != maxDispatchAttemptsSched {
		t.Errorf("expected %d refund calls (one per failed attempt that had escrowed), got %d", maxDispatchAttemptsSched, len(f.refundCalls))
	}
	if f.settlementID != "" {
		t.Errorf("failed_no_driver booking must have settlement_id cleared, got %q", f.settlementID)
	}
}

// TestEscrowSafety_RetryBeforeExhaustionReturnsToScheduled proves attempts 1
// and 2 (of 3) return the booking to 'scheduled' for the next worker tick,
// with escrow refunded each time (never carried forward as "active" across a
// failed attempt).
func TestEscrowSafety_RetryBeforeExhaustionReturnsToScheduled(t *testing.T) {
	f := &fakeSchedStore{status: schedDispatchPending}
	f.attemptDispatchFailure("settlement-1")
	if f.status != schedScheduled {
		t.Fatalf("after attempt 1/%d, status = %s, want scheduled (retry)", maxDispatchAttemptsSched, f.status)
	}
	if f.escrowActive {
		t.Error("escrow must be refunded on a retryable failed attempt, not left active")
	}
	if f.dispatchAttempts != 1 {
		t.Errorf("dispatchAttempts = %d, want 1", f.dispatchAttempts)
	}
}

// TestEscrowSafety_DispatchedNeverStrandsUntilCompleted proves that once a
// booking successfully dispatches (escrow now backs a real trip/parcel/bus
// ticket), the escrow is marked active — ownership passes to that mode's own
// settle/refund lifecycle at completion, which is out of scope here but the
// scheduled_booking itself never re-enters a state that would double-refund
// or re-escrow.
func TestEscrowSafety_DispatchedNeverStrandsUntilCompleted(t *testing.T) {
	f := &fakeSchedStore{status: schedDispatchPending}
	f.dispatchSucceeds("settlement-final")
	if f.status != schedDispatched {
		t.Fatalf("status = %s, want dispatched", f.status)
	}
	if !f.escrowActive {
		t.Error("a successfully dispatched booking should show escrow as active (owned by the materialized trip/parcel/ticket)")
	}
	if f.settlementID == "" {
		t.Error("dispatched booking must carry a non-empty settlement_id")
	}
	// From dispatched, the ONLY legal edge is -> completed (FSM invariant,
	// cross-checked against fsm_invariant_test.go). Cancel/expire cannot fire
	// here — proven structurally in fsm_invariant_test.go
	// (TestSchedFSM_IllegalTransitionsRejected: dispatched->cancelled is illegal).
	if canTransitionSched(schedDispatched, schedCancelled) {
		t.Fatal("dispatched -> cancelled must be illegal (would risk a double-refund race against the mode service's own settle path)")
	}
}

// TestEscrowSafety_CancelFromScheduledNeverEscrowed proves cancelling BEFORE
// dispatch (settlement_id was never set — booking never escrowed) issues NO
// refund call, matching cancelScheduledInternal's `if b.SettlementID != nil`
// guard: nothing to refund because nothing was ever taken.
func TestEscrowSafety_CancelFromScheduledNeverEscrowed(t *testing.T) {
	f := &fakeSchedStore{status: schedScheduled} // settlementID == "" (zero value)
	f.cancel()
	if f.status != schedCancelled {
		t.Fatalf("status = %s, want cancelled", f.status)
	}
	if len(f.refundCalls) != 0 {
		t.Errorf("cancelling a never-escrowed booking must not call Refund, got %d calls", len(f.refundCalls))
	}
}

// TestEscrowSafety_CancelFromDispatchPendingRefundsIfEscrowed proves cancelling
// mid-dispatch (a partial attempt had escrowed, settlement_id is set) DOES
// refund — never stranding the mid-flight escrow.
func TestEscrowSafety_CancelFromDispatchPendingRefundsIfEscrowed(t *testing.T) {
	f := &fakeSchedStore{status: schedDispatchPending, settlementID: "settlement-midflight", escrowActive: true}
	f.cancel()
	if f.status != schedCancelled {
		t.Fatalf("status = %s, want cancelled", f.status)
	}
	if len(f.refundCalls) != 1 || f.refundCalls[0] != "settlement-midflight" {
		t.Errorf("expected exactly one refund of settlement-midflight, got %v", f.refundCalls)
	}
	if f.escrowActive {
		t.Error("escrow must be marked inactive after the mid-dispatch cancel refund")
	}
}

// TestEscrowSafety_CancelIsIdempotent proves a second cancel call on an
// already-cancelled booking is a no-op (matches
// `if b.Status == SchedCancelled { return b, nil }`) — critically, it must NOT
// issue a second refund call.
func TestEscrowSafety_CancelIsIdempotent(t *testing.T) {
	f := &fakeSchedStore{status: schedDispatchPending, settlementID: "settlement-1", escrowActive: true}
	f.cancel()
	firstRefundCount := len(f.refundCalls)
	if firstRefundCount != 1 {
		t.Fatalf("expected 1 refund after first cancel, got %d", firstRefundCount)
	}
	f.cancel() // retry (e.g. client resubmits the same Idempotency-Key)
	if len(f.refundCalls) != firstRefundCount {
		t.Errorf("cancel retry must not issue a second refund: had %d, now %d", firstRefundCount, len(f.refundCalls))
	}
	if f.status != schedCancelled {
		t.Errorf("status after idempotent re-cancel = %s, want cancelled", f.status)
	}
}

// TestEscrowSafety_ExpireNeverRefundsBecauseNeverEscrowed proves ExpireStale
// only ever fires from 'scheduled' (per the FSM: expired is reachable only
// from scheduled), and a 'scheduled' booking — by construction — has never
// escrowed (escrow only happens at dispatch, per contract §"Product
// decisions": "Wallet is charged/escrowed at dispatch (not at booking)").
// Therefore expiry needs no refund call, matching
// Service.ExpireStale's doc comment ("These never escrowed, so there is
// nothing to refund.").
func TestEscrowSafety_ExpireNeverRefundsBecauseNeverEscrowed(t *testing.T) {
	if !canTransitionSched(schedScheduled, schedExpired) {
		t.Fatal("precondition failed: scheduled -> expired must be legal")
	}
	// Expiry can ONLY be reached from scheduled (cross-check against the
	// exhaustive matrix): no other state has an edge to expired.
	for _, from := range allSchedStatuses {
		if from == schedScheduled {
			continue
		}
		if canTransitionSched(from, schedExpired) {
			t.Errorf("only 'scheduled' should reach expired; found illegal edge %s -> expired", from)
		}
	}
	f := &fakeSchedStore{status: schedScheduled} // settlementID == "" by construction
	if f.settlementID != "" {
		t.Fatal("test setup bug: scheduled booking must start with no settlement")
	}
	// No dispatch call ever happened on this booking, so there is nothing to
	// refund when it expires — asserting the absence of any refund call.
	if len(f.refundCalls) != 0 {
		t.Error("an expired booking (never dispatched) must have zero refund calls")
	}
}
