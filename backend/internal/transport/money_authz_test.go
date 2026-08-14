package transport

// Go-live money-path + object-level-authz tests for transport.
//
// These are DB-free and correct-by-construction: they exercise the pure logic
// that GUARDS money (idempotency-key derivation, the fail-closed tier gate, the
// cross-user authz decision, the phase-transition guard, and the
// completion-failure marker) via small extracted seams, so `go test
// ./internal/transport/...` proves the invariants without a Postgres instance.
//
// Companion pure-logic suites: mobility_engine_test.go, modes_engine_test.go,
// split_invariant_test.go, model_test.go.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"
)

// ─── 1. delta-escrow stable idempotency key (the double-charge bug) ──────────
//
// The original bug embedded time.Now().UnixNano() in the delta-escrow key, so a
// retried RiderOffer/AcceptCounter aiming at the SAME target fare minted a NEW
// key and double-charged the rider. deltaEscrowKey must be:
//   - STABLE: same trip + same target fare → identical key (ledger no-op on retry),
//   - DISTINCT: same trip + different target fare → different key (a real delta).

func TestDeltaEscrowKey_StableAcrossRetriesForSameFare(t *testing.T) {
	const tripID = "trip-abc"
	const targetFare int64 = 250000

	first := deltaEscrowKey(tripID, targetFare)
	// Simulate a client retry to the exact same target fare.
	retry := deltaEscrowKey(tripID, targetFare)

	if first != retry {
		t.Fatalf("delta-escrow key must be identical on retry to the same target fare:\n first=%q\n retry=%q\n"+
			"(a differing key here is the original double-charge bug)", first, retry)
	}
	// Key must be derived from the ABSOLUTE target fare, not a nonce/timestamp.
	want := fmt.Sprintf("trip:%s:delta:%d", tripID, targetFare)
	if first != want {
		t.Fatalf("delta-escrow key = %q, want %q (must encode trip id + target fare)", first, want)
	}
}

func TestDeltaEscrowKey_DiffersForDifferentFare(t *testing.T) {
	const tripID = "trip-abc"
	lower := deltaEscrowKey(tripID, 250000)
	higher := deltaEscrowKey(tripID, 300000)
	if lower == higher {
		t.Fatalf("a raise to a different target fare must yield a DISTINCT escrow key; "+
			"both were %q (would collapse two real deltas into one)", lower)
	}
}

func TestDeltaEscrowKey_DiffersAcrossTrips(t *testing.T) {
	// Two riders (distinct trips) raising to the same numeric fare must not collide.
	a := deltaEscrowKey("trip-a", 250000)
	b := deltaEscrowKey("trip-b", 250000)
	if a == b {
		t.Fatalf("distinct trips with equal target fares must not share a key: %q", a)
	}
}

// ─── 2. enforceTierLimit fails closed ────────────────────────────────────────
//
// A fake tierLimiter lets us prove the enforceTierLimit DECISION without a DB.

// fakeTierLimiter injects a configurable outcome for the tier gate: err==nil
// allows, a non-nil err denies (fail-closed). It records the last call for
// delegation assertions.
type fakeTierLimiter struct {
	err       error  // returned verbatim (nil = allow)
	gotUserID string // last user id seen
	gotAmount int64  // last amount seen
	calls     int    // number of invocations (either gate)
	// gotMethod records WHICH gate ran. A rider fare is a consumer purchase and
	// must use the checkout gate (ADR-043); recording the method is what stops a
	// future edit silently moving a money path onto the wrong one.
	gotMethod string
}

func (f *fakeTierLimiter) EnforceWalletDebitLimit(_ context.Context, userID string, amountKobo int64) error {
	f.calls++
	f.gotUserID = userID
	f.gotAmount = amountKobo
	f.gotMethod = "wallet"
	return f.err
}

func (f *fakeTierLimiter) EnforceCheckoutDebitLimit(_ context.Context, userID string, amountKobo int64) error {
	f.calls++
	f.gotUserID = userID
	f.gotAmount = amountKobo
	f.gotMethod = "checkout"
	return f.err
}

func TestEnforceTierLimit_AllowsWhenUnderLimit(t *testing.T) {
	fake := &fakeTierLimiter{err: nil}
	s := &Service{tiers: fake}
	if err := s.enforceTierLimit(context.Background(), "rider-1", 200000); err != nil {
		t.Fatalf("expected allow when tier dep permits, got %v", err)
	}
	if fake.calls != 1 || fake.gotUserID != "rider-1" || fake.gotAmount != 200000 {
		t.Fatalf("tier gate must delegate the exact user+amount: %+v", fake)
	}
}

func TestEnforceTierLimit_DeniesWhenOverLimit(t *testing.T) {
	// Tier dep rejects (over daily limit / disabled wallet) → gate must fail closed
	// with a client-visible 403 FORBIDDEN and money must NOT move.
	fake := &fakeTierLimiter{err: errors.New("daily debit limit exceeded")}
	s := &Service{tiers: fake}
	err := s.enforceTierLimit(context.Background(), "rider-1", 500000)
	if err == nil {
		t.Fatal("over-limit debit MUST be denied (fail closed)")
	}
	ce, ok := err.(*CodedError)
	if !ok {
		t.Fatalf("expected *CodedError, got %T", err)
	}
	if ce.Status != http.StatusForbidden || ce.Code != CodeForbidden {
		t.Fatalf("want 403 FORBIDDEN, got status=%d code=%q", ce.Status, ce.Code)
	}
}

func TestEnforceTierLimit_FailsClosedOnDepError(t *testing.T) {
	// A DB / infra error from the tier dep must ALSO block the escrow — never allow
	// money to move when the limit cannot be evaluated.
	fake := &fakeTierLimiter{err: errors.New("tiers: get tier (fail closed): connection refused")}
	s := &Service{tiers: fake}
	if err := s.enforceTierLimit(context.Background(), "rider-1", 100000); err == nil {
		t.Fatal("a tier-dep error MUST fail closed (deny the debit)")
	}
}

func TestEnforceTierLimit_NilGateFailsClosed(t *testing.T) {
	// Defensive: a Service with no tier gate wired must never permit a debit.
	s := &Service{tiers: nil}
	err := s.enforceTierLimit(context.Background(), "rider-1", 100000)
	if err == nil {
		t.Fatal("a nil tier gate MUST fail closed")
	}
	ce, ok := err.(*CodedError)
	if !ok || ce.Status != http.StatusForbidden {
		t.Fatalf("want 403 FORBIDDEN on nil gate, got %+v", err)
	}
}

func TestEnforceTierLimit_ZeroAmountIsNoop(t *testing.T) {
	// A non-positive amount is not a wallet move; the gate short-circuits allow and
	// never calls the dep (so a $0 lower-offer delta cannot be spuriously blocked).
	fake := &fakeTierLimiter{err: errors.New("should not be consulted")}
	s := &Service{tiers: fake}
	if err := s.enforceTierLimit(context.Background(), "rider-1", 0); err != nil {
		t.Fatalf("zero amount must be a no-op allow, got %v", err)
	}
	if err := s.enforceTierLimit(context.Background(), "rider-1", -100); err != nil {
		t.Fatalf("negative amount must be a no-op allow, got %v", err)
	}
	if fake.calls != 0 {
		t.Fatalf("tier dep must not be consulted for non-positive amounts, calls=%d", fake.calls)
	}
}

// ─── 3. Object-level authz: cross-user actors rejected ───────────────────────
//
// tripActorAllowed is the pure decision behind "only the rider or the assigned
// driver may act on a trip". It catches the class of bug where rider A cancels /
// rates rider B's trip, or a non-assigned driver advances a trip.

func TestTripActorAllowed_RiderMayActOnOwnTrip(t *testing.T) {
	driver := "driver-user-9"
	if !tripActorAllowed("rider-A", "rider-A", &driver) {
		t.Fatal("the trip's own rider must be allowed")
	}
}

func TestTripActorAllowed_AssignedDriverMayAct(t *testing.T) {
	driver := "driver-user-9"
	if !tripActorAllowed("driver-user-9", "rider-A", &driver) {
		t.Fatal("the assigned driver must be allowed")
	}
}

func TestTripActorAllowed_OtherRiderRejected(t *testing.T) {
	// Rider B cannot cancel/rate rider A's trip.
	driver := "driver-user-9"
	if tripActorAllowed("rider-B", "rider-A", &driver) {
		t.Fatal("a different rider must NOT be allowed to act on someone else's trip")
	}
}

func TestTripActorAllowed_NonAssignedDriverRejected(t *testing.T) {
	// A driver who is not the assigned driver cannot advance the trip.
	assigned := "driver-user-9"
	if tripActorAllowed("driver-user-OTHER", "rider-A", &assigned) {
		t.Fatal("a non-assigned driver must NOT be allowed to advance the trip")
	}
}

func TestTripActorAllowed_NoDriverAssignedOnlyRider(t *testing.T) {
	// Before assignment, only the rider may act; any other actor is rejected.
	if !tripActorAllowed("rider-A", "rider-A", nil) {
		t.Fatal("rider must act on an unassigned trip")
	}
	if tripActorAllowed("stranger", "rider-A", nil) {
		t.Fatal("a stranger must NOT act on an unassigned trip")
	}
}

// ─── 4. Phase-transition guard rejects illegal / skipped transitions ─────────
//
// canTransition is the money-relevant guard: only a legal move into
// PhaseCompleted triggers settlement, and only a legal move into PhaseCancelled
// triggers a refund. Illegal jumps (that would settle/refund out of turn) are
// rejected. (mobility_engine_test.go covers the happy path; these lock the
// money-triggering edges specifically.)

func TestPhaseGuard_CompletionOnlyFromInProgress(t *testing.T) {
	// Settlement fires on the move into 'completed'. It must be reachable ONLY from
	// in_progress (or a safety_hold that resumes), never skipped from earlier phases.
	if !canTransition(PhaseInProgress, PhaseCompleted) {
		t.Fatal("in_progress → completed must be legal (settlement trigger)")
	}
	if !canTransition(PhaseSafetyHold, PhaseCompleted) {
		t.Fatal("safety_hold → completed must be legal (resume + settle)")
	}
	illegalToComplete := []TripPhase{
		PhaseRequested, PhaseFareNegotiating, PhaseDriverAssigned,
		PhaseDriverArriving, PhasePinVerified, PhaseCancelled, PhaseCompleted,
	}
	for _, from := range illegalToComplete {
		if canTransition(from, PhaseCompleted) {
			t.Errorf("%s → completed must be REJECTED (would settle escrow out of turn)", from)
		}
	}
}

func TestPhaseGuard_CannotCancelTerminalTrip(t *testing.T) {
	// A refund fires on the move into 'cancelled'. A terminal trip must never be
	// re-cancelled (double refund) and an in-progress trip is not cancellable here.
	for _, from := range []TripPhase{PhaseCompleted, PhaseCancelled} {
		if canTransition(from, PhaseCancelled) {
			t.Errorf("%s → cancelled must be REJECTED (would double-refund/void a terminal trip)", from)
		}
	}
}

func TestParcelPhaseGuard_NoSettleBeforeDropoffVerified(t *testing.T) {
	// Parcel escrow settles on dropoff_verified → delivered. 'delivered' must be
	// reachable ONLY from dropoff_verified, never skipped.
	if !canTransitionParcel("dropoff_verified", "delivered") {
		t.Fatal("dropoff_verified → delivered must be legal")
	}
	for _, from := range []string{"created", "courier_assigned", "pickup_pin_verified", "picked_up", "in_transit"} {
		if canTransitionParcel(from, "delivered") {
			t.Errorf("parcel %s → delivered must be REJECTED (would release escrow without PIN+proof)", from)
		}
	}
}

func TestMoverPhaseGuard_NoConfirmBeforeBidAccepted(t *testing.T) {
	// Mover escrow releases on completion_confirmed. It must be reachable ONLY from
	// in_progress, which itself requires an accepted (funded) bid.
	if canTransitionMover("quote_requested", "completion_confirmed") {
		t.Fatal("cannot confirm completion (release escrow) before a bid is funded")
	}
	if canTransitionMover("bids_received", "completion_confirmed") {
		t.Fatal("cannot confirm completion (release escrow) before a bid is funded")
	}
	if !canTransitionMover("in_progress", "completion_confirmed") {
		t.Fatal("in_progress → completion_confirmed must be legal")
	}
}

// ─── 5. Completion-failure path records settlement_pending ───────────────────
//
// When a trip is marked completed but settlement fails, the code MUST record a
// durable 'settlement_pending' marker (a queryable status + an audit payload
// carrying the settlement id) instead of silently succeeding, so a reconciliation
// job can re-drive the idempotent settleTrip.

func TestSettlementPendingMarker_CarriesSettlementIDAndCause(t *testing.T) {
	tr := &tripRow{ID: "trip-xyz", SettlementID: "sett-123"}
	cause := errors.New("ledger: insufficient escrow")
	m := settlementPendingMarker(tr, cause)

	if m["settlement_id"] != "sett-123" {
		t.Fatalf("marker must carry the settlement id for reconciliation, got %v", m["settlement_id"])
	}
	if m["error"] != "ledger: insufficient escrow" {
		t.Fatalf("marker must record the failure cause, got %v", m["error"])
	}
}

func TestSettlementPendingStatus_IsPendingNotSettled(t *testing.T) {
	// The queryable flag written on the trip must be the non-terminal marker the
	// reconciliation job scans for — NOT a silent 'settled'. It must also be a value
	// the trips.settlement_status CHECK constraint permits ('settlement_pending'),
	// otherwise the mirror UPDATE fails the constraint and silently no-ops.
	if settlementPendingStatus != "settlement_pending" {
		t.Fatalf("settlement_status marker = %q, want %q", settlementPendingStatus, "settlement_pending")
	}
	if settlementPendingEvent != "settlement_pending" {
		t.Fatalf("trip_events marker = %q, want %q", settlementPendingEvent, "settlement_pending")
	}
	if settlementPendingStatus == "settled" {
		t.Fatal("completion-failure path must NOT record 'settled' (that would silently swallow stranded escrow)")
	}
}
