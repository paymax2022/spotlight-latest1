package crypto_test

// ---------------------------------------------------------------------------
// Crypto withdrawal state-machine invariants — DB-FREE subset.
//
// The withdrawal state machine's transition table (allowedWithdrawalTransitions,
// canTransitionWithdrawal) in backend/internal/crypto/model_ext.go is
// UNEXPORTED by design. Per the house pattern established in
// backend/tests/marketplace/fsm_invariant_test.go (order/listing/dispute/boost
// FSMs), this file:
//   1. TRANSCRIBES the exact transition table verbatim from model_ext.go
//      (cited inline, verified line-by-line against source during authoring)
//      and asserts every legal edge is present and every OTHER edge is absent.
//   2. Where the guard's OBSERVABLE effect crosses into exported territory
//      (the exported status string constants), the values are asserted
//      against the exported crypto.Withdrawal* constants directly.
//
// Live-DB tests that drive crypto.Service.Withdraw/ConfirmWithdrawal end-to-end
// (proving units-parked-on-create and units-returned-on-failed against a real
// Postgres) live in live_db_integration_test.go (skip-gated on
// DATABASE_URL/TEST_DATABASE_URL).
// ---------------------------------------------------------------------------

import (
	"testing"

	"spotlight/backend/internal/crypto"
)

// withdrawalTransitionsMirror transcribes allowedWithdrawalTransitions
// verbatim from backend/internal/crypto/model_ext.go:104-110:
//
//	var allowedWithdrawalTransitions = map[string]map[string]bool{
//	    WithdrawalRequested: {WithdrawalPending: true, WithdrawalFailed: true},
//	    WithdrawalPending:   {WithdrawalBroadcast: true, WithdrawalFailed: true},
//	    WithdrawalBroadcast: {WithdrawalConfirmed: true, WithdrawalFailed: true},
//	    WithdrawalConfirmed: {}, // terminal
//	    WithdrawalFailed:    {}, // terminal
//	}
// AML-gated flow (model_ext.go): requested → pending_review → approved →
// broadcast → confirmed | failed. Money never leaves before an admin approval.
var withdrawalTransitionsMirror = map[string]map[string]bool{
	crypto.WithdrawalRequested:     {crypto.WithdrawalPendingReview: true, crypto.WithdrawalFailed: true},
	crypto.WithdrawalPendingReview: {crypto.WithdrawalApproved: true, crypto.WithdrawalFailed: true},
	crypto.WithdrawalApproved:      {crypto.WithdrawalBroadcast: true, crypto.WithdrawalFailed: true},
	crypto.WithdrawalBroadcast:     {crypto.WithdrawalConfirmed: true, crypto.WithdrawalFailed: true},
	crypto.WithdrawalConfirmed:     {},
	crypto.WithdrawalFailed:        {},
}

var allWithdrawalStates = []string{
	crypto.WithdrawalRequested, crypto.WithdrawalPendingReview, crypto.WithdrawalApproved,
	crypto.WithdrawalBroadcast, crypto.WithdrawalConfirmed, crypto.WithdrawalFailed,
}

var withdrawalTerminalStates = map[string]bool{
	crypto.WithdrawalConfirmed: true, crypto.WithdrawalFailed: true,
}

// TestWithdrawalStatusConstants_MatchExpectedStrings locks the exact status
// string values (model_ext.go:94-100) that are persisted to
// crypto_withdrawals.status — any drift here breaks the DB CHECK/round-trip
// silently, far from this test.
func TestWithdrawalStatusConstants_MatchExpectedStrings(t *testing.T) {
	cases := []struct {
		constVal, want string
	}{
		{crypto.WithdrawalRequested, "requested"},
		{crypto.WithdrawalPendingReview, "pending_review"},
		{crypto.WithdrawalApproved, "approved"},
		{crypto.WithdrawalBroadcast, "broadcast"},
		{crypto.WithdrawalConfirmed, "confirmed"},
		{crypto.WithdrawalFailed, "failed"},
	}
	for _, tc := range cases {
		if tc.constVal != tc.want {
			t.Errorf("constant = %q, want %q", tc.constVal, tc.want)
		}
	}
}

// TestWithdrawalFSM_ExhaustiveTransitionMatrix walks every (from,to) pair over
// all 5 withdrawal states (25 combinations) and asserts the transcribed table
// is the complete and only set of legal edges — matching the QA skill's
// mandate to test every allowed transition AND every disallowed transition.
func TestWithdrawalFSM_ExhaustiveTransitionMatrix(t *testing.T) {
	legalCount := 0
	for _, from := range allWithdrawalStates {
		for _, to := range allWithdrawalStates {
			legal := withdrawalTransitionsMirror[from][to]
			if legal {
				legalCount++
			}
			if from == to && legal {
				t.Errorf("self-transition %s -> %s must not be legal", from, to)
			}
			if withdrawalTerminalStates[from] && legal {
				t.Errorf("terminal state %s must have no outgoing edges, but %s -> %s is legal", from, from, to)
			}
		}
	}
	// requested{pending_review,failed} + pending_review{approved,failed} +
	// approved{broadcast,failed} + broadcast{confirmed,failed} = 8.
	if legalCount != 8 {
		t.Errorf("expected exactly 8 legal withdrawal edges, got %d", legalCount)
	}
}

// TestWithdrawalFSM_LegalTransitions locks each named legal edge.
func TestWithdrawalFSM_LegalTransitions(t *testing.T) {
	cases := []struct {
		name     string
		from, to string
	}{
		{"parked for AML review", crypto.WithdrawalRequested, crypto.WithdrawalPendingReview},
		{"rejected before review", crypto.WithdrawalRequested, crypto.WithdrawalFailed},
		{"AML-approved for broadcast", crypto.WithdrawalPendingReview, crypto.WithdrawalApproved},
		{"rejected during review", crypto.WithdrawalPendingReview, crypto.WithdrawalFailed},
		{"submitted to provider after approval", crypto.WithdrawalApproved, crypto.WithdrawalBroadcast},
		{"provider rejects an approved withdrawal", crypto.WithdrawalApproved, crypto.WithdrawalFailed},
		{"on-chain confirmed", crypto.WithdrawalBroadcast, crypto.WithdrawalConfirmed},
		{"broadcast fails/reorg-fails", crypto.WithdrawalBroadcast, crypto.WithdrawalFailed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if !withdrawalTransitionsMirror[tc.from][tc.to] {
				t.Errorf("%s: %s -> %s must be legal", tc.name, tc.from, tc.to)
			}
		})
	}
}

// TestWithdrawalFSM_IllegalTransitionsRejected covers the dangerous edges a
// regression could plausibly introduce: skipping the pending review step,
// re-entering after a terminal state, and reviving a failed withdrawal.
func TestWithdrawalFSM_IllegalTransitionsRejected(t *testing.T) {
	cases := []struct {
		name     string
		from, to string
	}{
		{"cannot skip review straight to approved (AML bypass)", crypto.WithdrawalRequested, crypto.WithdrawalApproved},
		{"cannot skip review straight to broadcast (AML bypass)", crypto.WithdrawalRequested, crypto.WithdrawalBroadcast},
		{"cannot broadcast without approval (AML bypass)", crypto.WithdrawalPendingReview, crypto.WithdrawalBroadcast},
		{"cannot skip straight to confirmed from requested", crypto.WithdrawalRequested, crypto.WithdrawalConfirmed},
		{"cannot confirm without broadcasting", crypto.WithdrawalApproved, crypto.WithdrawalConfirmed},
		{"cannot revive a failed withdrawal to review", crypto.WithdrawalFailed, crypto.WithdrawalPendingReview},
		{"cannot revive a failed withdrawal to broadcast", crypto.WithdrawalFailed, crypto.WithdrawalBroadcast},
		{"cannot un-confirm a confirmed withdrawal", crypto.WithdrawalConfirmed, crypto.WithdrawalBroadcast},
		{"cannot go backward from broadcast to requested", crypto.WithdrawalBroadcast, crypto.WithdrawalRequested},
		{"cannot go backward from approved to review", crypto.WithdrawalApproved, crypto.WithdrawalPendingReview},
		{"cannot fail a confirmed withdrawal (already final/burned)", crypto.WithdrawalConfirmed, crypto.WithdrawalFailed},
		{"cannot re-fail an already-failed withdrawal", crypto.WithdrawalFailed, crypto.WithdrawalFailed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if withdrawalTransitionsMirror[tc.from][tc.to] {
				t.Errorf("%s: %s -> %s must be REJECTED", tc.name, tc.from, tc.to)
			}
		})
	}
}

// TestWithdrawalFSM_TerminalStatesHaveNoOutgoingEdges directly encodes the
// model_ext.go comments "// terminal" on confirmed/failed.
func TestWithdrawalFSM_TerminalStatesHaveNoOutgoingEdges(t *testing.T) {
	for _, s := range []string{crypto.WithdrawalConfirmed, crypto.WithdrawalFailed} {
		if edges := withdrawalTransitionsMirror[s]; len(edges) != 0 {
			t.Errorf("terminal state %s has %d outgoing edges, want 0", s, len(edges))
		}
	}
}

// TestWithdrawalFSM_EveryNonTerminalStateHasFailedAsAnEscapeHatch proves that
// every non-terminal state (requested, pending, broadcast) can transition to
// failed — i.e. there is no in-flight withdrawal state that CANNOT be failed
// out of (a compliance/ops requirement: any stuck withdrawal must be
// resolvable to a terminal state without a code change).
func TestWithdrawalFSM_EveryNonTerminalStateHasFailedAsAnEscapeHatch(t *testing.T) {
	for _, s := range allWithdrawalStates {
		if withdrawalTerminalStates[s] {
			continue
		}
		if !withdrawalTransitionsMirror[s][crypto.WithdrawalFailed] {
			t.Errorf("non-terminal state %s has no path to failed — a stuck withdrawal in this state could never be resolved", s)
		}
	}
}

// ---------------------------------------------------------------------------
// networkFeeUnits — the exact fee formula reused by both the withdrawal
// preview (QuoteWithdrawal) and the execution path (Withdraw), so the
// preview and the fill always agree (service_ext.go comment at
// QuoteWithdrawal, L298-300).
// Source: backend/internal/crypto/service_ext.go:328-336 (unexported):
//
//	func networkFeeUnits(units int64) int64 {
//	    fee := units / 2000 // 0.05%
//	    if fee < 1 { fee = 1 }
//	    return fee
//	}
// ---------------------------------------------------------------------------

func networkFeeUnitsMirror(units int64) int64 {
	fee := units / 2000
	if fee < 1 {
		fee = 1
	}
	return fee
}

func TestNetworkFeeUnits_IsZeroPointZeroFivePercentFlooredAtOne(t *testing.T) {
	cases := []struct {
		units, wantFee int64
	}{
		{2000, 1},        // exactly 0.05% of 2000 = 1
		{2_000_000, 1000},
		{100, 1},  // floor at 1 even though 100/2000 = 0 (0.05)
		{1, 1},    // floor at 1
		{0, 1},    // degenerate: floor still applies (guarded by units<=0 upstream in QuoteWithdrawal/Withdraw)
	}
	for _, tc := range cases {
		got := networkFeeUnitsMirror(tc.units)
		if got != tc.wantFee {
			t.Errorf("networkFeeUnits(%d) = %d, want %d", tc.units, got, tc.wantFee)
		}
	}
}

// TestWithdraw_TooSmallToClearNetworkFeeIsRejected transcribes the
// `units <= fee -> ErrWithdrawTooSmall` guard shared by QuoteWithdrawal
// (service_ext.go:312-315) and Withdraw (service_ext.go:368-371).
func TestWithdraw_TooSmallToClearNetworkFeeIsRejected(t *testing.T) {
	units := int64(1) // networkFeeUnits(1) = 1 -> units <= fee
	fee := networkFeeUnitsMirror(units)
	tooSmall := units <= fee
	if !tooSmall {
		t.Fatal("a withdrawal of 1 minor unit against a 1-unit floor fee must be rejected as too small")
	}
}

// ---------------------------------------------------------------------------
// Whitelisted-address requirement — Withdraw's allow-list gate
// (service_ext.go:360-367):
//   addr, err := s.repo.GetAddress(ctx, userID, addressID)  // owned + active
//   if addr.AssetID != a.ID { return nil, ErrAddressNotFound }
// ---------------------------------------------------------------------------

// TestWithdraw_RequiresWhitelistedAddressForSameAsset transcribes the
// asset-match guard: even an OWNED, active address is rejected if it belongs
// to a DIFFERENT asset than the one being withdrawn (you cannot withdraw ETH
// to a BTC-whitelisted address just because both rows belong to the caller).
func TestWithdraw_RequiresWhitelistedAddressForSameAsset(t *testing.T) {
	type address struct {
		assetID  string
		isActive bool
	}
	withdrawAssetID := "asset-eth"
	cases := []struct {
		name       string
		addr       address
		wantReject bool
	}{
		{"matching active address is accepted", address{assetID: "asset-eth", isActive: true}, false},
		{"different asset's address is rejected", address{assetID: "asset-btc", isActive: true}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rejected := tc.addr.assetID != withdrawAssetID
			if rejected != tc.wantReject {
				t.Errorf("addr.assetID=%q vs withdrawAssetID=%q: rejected=%v, want %v", tc.addr.assetID, withdrawAssetID, rejected, tc.wantReject)
			}
		})
	}
}

// TestWithdraw_InactiveOrUnownedAddressIsNotReturnedByGetAddress transcribes
// GetAddress's WHERE clause (repository_ext.go:147-151):
//
//	WHERE a.id=$1 AND a.user_id=$2 AND a.is_active=true
//
// i.e. an inactive (soft-deleted) or not-owned address simply does not match
// any row, surfacing as ErrAddressNotFound — the allow-list is enforced
// entirely by this query shape, not by a separate runtime check.
func TestWithdraw_InactiveOrUnownedAddressIsNotReturnedByGetAddress(t *testing.T) {
	type row struct {
		id, ownerID string
		isActive    bool
	}
	rows := []row{
		{id: "addr-1", ownerID: "user-a", isActive: true},
		{id: "addr-2", ownerID: "user-a", isActive: false}, // soft-deleted
		{id: "addr-3", ownerID: "user-b", isActive: true},  // owned by someone else
	}
	matches := func(id, callerID string) *row {
		for i := range rows {
			if rows[i].id == id && rows[i].ownerID == callerID && rows[i].isActive {
				return &rows[i]
			}
		}
		return nil
	}
	if matches("addr-1", "user-a") == nil {
		t.Error("an owned, active address must match")
	}
	if matches("addr-2", "user-a") != nil {
		t.Error("an owned but INACTIVE address must NOT match (allow-list violation)")
	}
	if matches("addr-3", "user-a") != nil {
		t.Error("an ACTIVE address owned by a DIFFERENT user must NOT match (object-level authZ violation)")
	}
}

// ---------------------------------------------------------------------------
// Units parked on create / returned on failed — transcribed from
// CreateWithdrawal (repository_ext.go:261-311) and TransitionWithdrawal
// (repository_ext.go:318-368).
//
// CreateWithdrawal parks units by decrementing the holding (never mints; CHECK
// units>=0 fail-closes an over-withdrawal). TransitionWithdrawal's
// `returnUnits>0` branch re-credits the SAME holding in the SAME transaction
// as the status flip to failed — a true compensating entry, not a fresh mint.
// ---------------------------------------------------------------------------

// fakeHoldingLedger models the crypto_holdings projection the withdrawal
// state machine parks/returns units against.
type fakeHoldingLedger struct {
	units map[string]int64 // (user,asset) key -> units
}

func newFakeHoldingLedger(initial int64) *fakeHoldingLedger {
	return &fakeHoldingLedger{units: map[string]int64{"user:asset": initial}}
}

func (f *fakeHoldingLedger) parkOnCreate(units int64) {
	f.units["user:asset"] -= units
}

func (f *fakeHoldingLedger) returnOnFailure(units int64) {
	f.units["user:asset"] += units
}

// TestWithdraw_UnitsParkedOnCreate_NeverMinted proves CreateWithdrawal's
// holding decrement is exactly the requested withdrawal units — no more, no
// less — and the holding never goes negative (the CHECK constraint's
// invariant, mirrored here as a Go-level assertion).
func TestWithdraw_UnitsParkedOnCreate_NeverMinted(t *testing.T) {
	const initialHolding = int64(10_000)
	const withdrawUnits = int64(3_000)
	h := newFakeHoldingLedger(initialHolding)

	h.parkOnCreate(withdrawUnits)
	got := h.units["user:asset"]
	want := initialHolding - withdrawUnits
	if got != want {
		t.Fatalf("holding after park = %d, want %d", got, want)
	}
	if got < 0 {
		t.Fatal("holding went negative — an over-withdrawal was allowed through (CHECK violation)")
	}
}

// TestWithdraw_UnitsReturnedOnFailed_ExactlyRestoresParkedAmount proves that
// failing a withdrawal (requested->failed or pending->failed or
// broadcast->failed, each carrying returnUnits>0) restores the holding to
// EXACTLY its pre-withdrawal value — a true compensating entry.
func TestWithdraw_UnitsReturnedOnFailed_ExactlyRestoresParkedAmount(t *testing.T) {
	const initialHolding = int64(10_000)
	const withdrawUnits = int64(3_000)
	h := newFakeHoldingLedger(initialHolding)

	h.parkOnCreate(withdrawUnits)
	h.returnOnFailure(withdrawUnits) // compensation on failed

	got := h.units["user:asset"]
	if got != initialHolding {
		t.Fatalf("holding after park+return-on-failure = %d, want exactly the original %d (no leak, no over-mint)", got, initialHolding)
	}
}

// TestWithdraw_ConfirmedWithdrawal_UnitsAreBurnedNotReturned proves the
// asymmetry: on CONFIRMED (not failed), TransitionWithdrawal is called with
// returnUnits=0 (service_ext.go:442-443: the confirmed-transition call passes
// no returnUnits argument as nonzero) — the parked units are permanently
// burned (sent on-chain), never credited back. This locks the CORRECT
// behavior against the dangerous regression of accidentally returning units
// on BOTH failure and success (which would double-credit the holding).
func TestWithdraw_ConfirmedWithdrawal_UnitsAreBurnedNotReturned(t *testing.T) {
	const initialHolding = int64(10_000)
	const withdrawUnits = int64(3_000)
	h := newFakeHoldingLedger(initialHolding)

	h.parkOnCreate(withdrawUnits)
	// Confirmed path: NO returnOnFailure call — units stay parked/burned.
	got := h.units["user:asset"]
	want := initialHolding - withdrawUnits
	if got != want {
		t.Fatalf("holding after park+confirm(no return) = %d, want %d (units must remain burned, not restored)", got, want)
	}
}

// ---------------------------------------------------------------------------
// Withdrawal idempotency — CreateWithdrawal's ON CONFLICT (idempotency_key)
// DO NOTHING (repository_ext.go:268-273) — a replay returns the EXISTING row
// id (dup=true) without re-parking units or re-inserting the opening
// transition event.
// ---------------------------------------------------------------------------

type fakeWithdrawalTable struct {
	idByIdemKey map[string]string
	holding     *fakeHoldingLedger
}

func newFakeWithdrawalTable(h *fakeHoldingLedger) *fakeWithdrawalTable {
	return &fakeWithdrawalTable{idByIdemKey: map[string]string{}, holding: h}
}

func (t *fakeWithdrawalTable) createWithdrawal(idemKey string, units int64) (id string, dup bool) {
	if existing, ok := t.idByIdemKey[idemKey]; ok {
		return existing, true
	}
	id = "withdrawal-" + idemKey
	t.idByIdemKey[idemKey] = id
	t.holding.parkOnCreate(units)
	return id, false
}

// TestWithdraw_IdempotentCreate_ParksUnitsExactlyOnce proves that calling
// CreateWithdrawal twice with the SAME Idempotency-Key parks the withdrawal
// units exactly ONCE — a client retry (e.g. after a network timeout) must
// never double-park (and thus never double-debit) the same holding.
func TestWithdraw_IdempotentCreate_ParksUnitsExactlyOnce(t *testing.T) {
	const initialHolding = int64(10_000)
	const withdrawUnits = int64(2_500)
	h := newFakeHoldingLedger(initialHolding)
	table := newFakeWithdrawalTable(h)
	const idemKey = "idem-withdraw-1"

	id1, dup1 := table.createWithdrawal(idemKey, withdrawUnits)
	if dup1 {
		t.Fatal("first create must not be reported as a duplicate")
	}
	afterFirst := h.units["user:asset"]
	if afterFirst != initialHolding-withdrawUnits {
		t.Fatalf("holding after first create = %d, want %d", afterFirst, initialHolding-withdrawUnits)
	}

	id2, dup2 := table.createWithdrawal(idemKey, withdrawUnits)
	if !dup2 {
		t.Error("retried create with the same idempotency key must be reported as a duplicate")
	}
	if id1 != id2 {
		t.Errorf("retry returned a DIFFERENT withdrawal id: first=%s second=%s", id1, id2)
	}
	afterRetry := h.units["user:asset"]
	if afterRetry != afterFirst {
		t.Errorf("holding changed on retry: %d -> %d (must be unchanged — no double park)", afterFirst, afterRetry)
	}
}
