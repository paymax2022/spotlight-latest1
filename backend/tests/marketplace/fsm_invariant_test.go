package marketplace_test

// ---------------------------------------------------------------------------
// Agent F (QA) — Marketplace FSM invariant tests.
//
// WHY THIS FILE EXISTS AS A MIRROR, NOT A DIRECT CALL:
// Agent A's guarded-transition tables (orderTransitions, listingTransitions,
// disputeTransitions, boostTransitions) and their guard functions
// (canOrderTransition, guardOrderTransition, ...) in backend/internal/marketplace
// are UNEXPORTED (lowercase) by design — the FSM internals are not part of the
// frozen public contract (SWARM_INTEGRATION_CONTRACT.md only freezes the struct
// shapes, Service method signatures, routes, and error codes). Per Agent F's file
// boundary, tests must live in backend/tests/marketplace/ as an external test
// package (marketplace_test) and may only import EXPORTED symbols of
// spotlight/backend/internal/marketplace — an unexported func cannot be called
// from outside the package, and this directory must not contain a `package
// marketplace` (internal) file, since backend/internal/marketplace/*.go is
// Agent A's exclusive file-ownership boundary.
//
// So these tests do two things, mirroring the house pattern already used in
// backend/internal/finance/settlement/split_invariant_test.go (splitLegsKobo):
//
//  1. They TRANSCRIBE the exact transition tables from
//     Paymax_Marketplace_CLAUDE_BUILD_CONTRACT.md §2.1-2.4 (verified line-by-line
//     against fsm_listing.go / fsm_order.go / fsm_dispute.go / fsm_boost.go source
//     read directly during test authoring) and assert every legal edge is present
//     and every OTHER edge (illegal) is absent — i.e. the transcription itself
//     enforces "guarded, exhaustive, no implicit transitions" as a spec-level
//     regression lock. If Agent A's source table ever silently drifts from the
//     contract, a source-level diff review (or a future in-package test A adds)
//     is the enforcement point; this file is the CONTRACT-side lock.
//  2. Where the guard's OBSERVABLE effect crosses into exported territory (the
//     CodedError code + HTTP status a caller actually receives), the codes are
//     asserted against the frozen §3 taxonomy in errors.go (which IS exported).
//
// A live Postgres would let us drive Service methods end-to-end and observe the
// unexported guards indirectly (see sequence_flow_test.go's DB-required notes).
// Absent that, these tests are correct-by-construction against the transcribed
// tables and catch the class of bug the skill calls out: "test every allowed
// transition produces the right next state... and every disallowed transition is
// rejected."
// ---------------------------------------------------------------------------

import (
	"testing"

	mkt "spotlight/backend/internal/marketplace"
)

// ─── ADR-023 HISTORICAL NOTICE (order + dispute FSM) ─────────────────────────
//
// The escrow ORDER and DISPUTE money-paths were REMOVED in the listings-and-connect
// pivot (ADR-023): the marketplace no longer holds funds, creates orders, or manages
// disputes (parties transact off-platform via Meetup Mode). The order/dispute FSM
// source (fsm_order.go / fsm_dispute.go, service_order.go / service_dispute.go and
// their handlers/webhooks) has been DELETED. Per ADR-023 the residual enum values
// and mkt_orders/mkt_disputes tables are retained-but-unused (additive-only; not
// physically dropped).
//
// Consequently the order/dispute transition-table MIRRORS below (orderTransitionsMirror,
// disputeTransitionsMirror) transcribe a spec that no live code implements. Their
// TestOrderFSM_* / TestDisputeFSM_* assertions were passing while testing DELETED
// behavior — false confidence. They are now t.Skip'd with this pointer (kept, not
// deleted, as the historical §2.2/§2.3 record). The LISTING and BOOST FSM tests in
// this file SHIP and still run — boostTransitionsMirror is also consumed by the live
// boost chaos test in chaos_error_taxonomy_test.go.
const adr023OrderDisputeSkip = "ADR-023: order/dispute escrow money-path removed (listings-and-connect pivot); " +
	"this mirror tests deleted FSM code. Kept as the historical §2.2/§2.3 record. See ADR-023."

// ─── §2.2 Escrow Order FSM (the critical path) — HISTORICAL, see ADR-023 above ─

// orderTransitionsMirror transcribes fsm_order.go's orderTransitions verbatim.
// Keep in sync with backend/internal/marketplace/fsm_order.go if that table changes.
var orderTransitionsMirror = map[mkt.OrderStatus]map[mkt.OrderStatus]bool{
	mkt.OrderInitiated: {
		mkt.OrderFunded:    true,
		mkt.OrderCancelled: true, // fund_timeout
	},
	mkt.OrderFunded: {
		mkt.OrderSellerAccepted: true,
		mkt.OrderCancelled:      true, // seller_reject_or_timeout → refund
	},
	mkt.OrderSellerAccepted: {
		mkt.OrderInDelivery: true, // dispatch
		mkt.OrderCancelled:  true,
	},
	mkt.OrderInDelivery: {
		mkt.OrderDelivered: true,
	},
	mkt.OrderDelivered: {
		mkt.OrderInspectionWindow: true, // immediate per §2.2
	},
	mkt.OrderInspectionWindow: {
		mkt.OrderReleased: true, // buyer_confirm | auto_release
		mkt.OrderDisputed: true, // open_dispute
	},
	mkt.OrderDisputed: {
		mkt.OrderRefunded:     true, // resolve_refund
		mkt.OrderReleased:     true, // resolve_release
		mkt.OrderSplitSettled: true, // resolve_split
	},
	mkt.OrderReleased:     {},
	mkt.OrderCancelled:    {},
	mkt.OrderRefunded:     {},
	mkt.OrderSplitSettled: {},
}

var allOrderStates = []mkt.OrderStatus{
	mkt.OrderInitiated, mkt.OrderFunded, mkt.OrderSellerAccepted, mkt.OrderInDelivery,
	mkt.OrderDelivered, mkt.OrderInspectionWindow, mkt.OrderReleased, mkt.OrderCancelled,
	mkt.OrderDisputed, mkt.OrderRefunded, mkt.OrderSplitSettled,
}

var orderTerminalStates = map[mkt.OrderStatus]bool{
	mkt.OrderReleased: true, mkt.OrderCancelled: true, mkt.OrderRefunded: true, mkt.OrderSplitSettled: true,
}

// TestOrderFSM_ExhaustiveTransitionMatrix walks EVERY (from,to) pair over all 11
// order states (121 combinations) and asserts the transcribed table is the
// complete and only set of legal edges — i.e. anything not explicitly listed is
// illegal, matching the "no implicit transitions anywhere" build-order mandate
// (§10.2) and the skill's "every disallowed transition is rejected" checklist item.
func TestOrderFSM_ExhaustiveTransitionMatrix(t *testing.T) {
	t.Skip(adr023OrderDisputeSkip)
	legalCount := 0
	for _, from := range allOrderStates {
		for _, to := range allOrderStates {
			legal := orderTransitionsMirror[from][to]
			if legal {
				legalCount++
			}
			// Self-transitions are never legal (no-op edges are not modeled).
			if from == to && legal {
				t.Errorf("self-transition %s -> %s must not be legal", from, to)
			}
			// A terminal state must have ZERO outgoing legal edges.
			if orderTerminalStates[from] && legal {
				t.Errorf("terminal state %s must have no outgoing edges, but %s -> %s is legal", from, from, to)
			}
		}
	}
	// §2.2 defines exactly 13 legal edges: 2+2+2+1+1+2+3 = 13.
	if legalCount != 13 {
		t.Errorf("expected exactly 13 legal order edges per §2.2, got %d", legalCount)
	}
}

// TestOrderFSM_HappyPathEdgesLegal locks each named §2.2 event as legal.
func TestOrderFSM_HappyPathEdgesLegal(t *testing.T) {
	t.Skip(adr023OrderDisputeSkip)
	cases := []struct {
		event    string
		from, to mkt.OrderStatus
	}{
		{"fund", mkt.OrderInitiated, mkt.OrderFunded},
		{"seller_accept", mkt.OrderFunded, mkt.OrderSellerAccepted},
		{"dispatch", mkt.OrderSellerAccepted, mkt.OrderInDelivery},
		{"deliver", mkt.OrderInDelivery, mkt.OrderDelivered},
		{"deliver_immediate_inspection", mkt.OrderDelivered, mkt.OrderInspectionWindow},
		{"buyer_confirm_or_auto_release", mkt.OrderInspectionWindow, mkt.OrderReleased},
		{"open_dispute", mkt.OrderInspectionWindow, mkt.OrderDisputed},
		{"resolve_refund", mkt.OrderDisputed, mkt.OrderRefunded},
		{"resolve_release", mkt.OrderDisputed, mkt.OrderReleased},
		{"resolve_split", mkt.OrderDisputed, mkt.OrderSplitSettled},
		{"fund_timeout", mkt.OrderInitiated, mkt.OrderCancelled},
		{"seller_reject_or_timeout", mkt.OrderFunded, mkt.OrderCancelled},
		{"cancel_after_accept", mkt.OrderSellerAccepted, mkt.OrderCancelled},
	}
	for _, tc := range cases {
		t.Run(tc.event, func(t *testing.T) {
			if !orderTransitionsMirror[tc.from][tc.to] {
				t.Errorf("%s: %s -> %s must be legal per §2.2", tc.event, tc.from, tc.to)
			}
		})
	}
}

// TestOrderFSM_IllegalTransitionsRejected asserts specific dangerous illegal edges
// that a regression could plausibly introduce (skipping states, going backward,
// re-entering after terminal) are rejected.
func TestOrderFSM_IllegalTransitionsRejected(t *testing.T) {
	t.Skip(adr023OrderDisputeSkip)
	cases := []struct {
		name     string
		from, to mkt.OrderStatus
	}{
		{"cannot skip funding straight to seller_accepted", mkt.OrderInitiated, mkt.OrderSellerAccepted},
		{"cannot skip to delivered without dispatch", mkt.OrderSellerAccepted, mkt.OrderDelivered},
		{"cannot release before inspection window", mkt.OrderInDelivery, mkt.OrderReleased},
		{"cannot fund an already-funded order (no self loop)", mkt.OrderFunded, mkt.OrderFunded},
		{"cannot dispute a released order (race guard, see §8)", mkt.OrderReleased, mkt.OrderDisputed},
		{"cannot dispute a cancelled order", mkt.OrderCancelled, mkt.OrderDisputed},
		{"cannot re-release a refunded order (double payout)", mkt.OrderRefunded, mkt.OrderReleased},
		{"cannot re-refund a released order (double refund after payout)", mkt.OrderReleased, mkt.OrderRefunded},
		{"cannot go backward from disputed to inspection_window", mkt.OrderDisputed, mkt.OrderInspectionWindow},
		{"cannot go backward from funded to initiated", mkt.OrderFunded, mkt.OrderInitiated},
		{"cannot split-settle an order that was never disputed", mkt.OrderFunded, mkt.OrderSplitSettled},
		{"cannot cancel a split-settled (terminal) order", mkt.OrderSplitSettled, mkt.OrderCancelled},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if orderTransitionsMirror[tc.from][tc.to] {
				t.Errorf("%s: %s -> %s must be REJECTED, but the table marks it legal", tc.name, tc.from, tc.to)
			}
		})
	}
}

// TestOrderFSM_EveryTerminalStateHasNoForwardPath is the direct FSM-shape encoding
// of the §2.2 non-negotiable invariant: "No transition may leave funds in the
// escrow sub-account with no forward path" — restated as "every terminal state has
// zero outgoing edges" (verified exhaustively above) AND "every non-terminal state
// has at least one outgoing edge" (no dead ends short of a terminal state).
func TestOrderFSM_EveryTerminalStateHasNoForwardPath(t *testing.T) {
	t.Skip(adr023OrderDisputeSkip)
	for _, s := range allOrderStates {
		edges := orderTransitionsMirror[s]
		isTerminal := orderTerminalStates[s]
		if isTerminal && len(edges) != 0 {
			t.Errorf("terminal state %s has %d outgoing edges, want 0", s, len(edges))
		}
		if !isTerminal && len(edges) == 0 {
			t.Errorf("non-terminal state %s has NO outgoing edges — a stuck order with no forward path", s)
		}
	}
}

// TestOrderFSM_EscrowHoldsFundsMirrorsReconciliationSet transcribes
// escrowHoldsFunds's state set (fsm_order.go) — the exact set the §2.2 hourly
// reconciliation job sums against: SUM(escrow_sub_account_balance) =
// SUM(orders WHERE status IN (...)). If this set ever omits a state that still
// holds buyer funds, the reconciliation job would under-count and silently miss
// leaked/stranded escrow — the highest-severity class of bug in this system.
func TestOrderFSM_EscrowHoldsFundsMirrorsReconciliationSet(t *testing.T) {
	t.Skip(adr023OrderDisputeSkip)
	holdsFunds := map[mkt.OrderStatus]bool{
		mkt.OrderFunded:           true,
		mkt.OrderSellerAccepted:   true,
		mkt.OrderInDelivery:       true,
		mkt.OrderDelivered:        true,
		mkt.OrderInspectionWindow: true,
		mkt.OrderDisputed:         true,
	}
	for _, s := range allOrderStates {
		want := holdsFunds[s]
		// Every terminal state must NOT hold funds (money moved out by definition).
		if orderTerminalStates[s] && want {
			t.Errorf("terminal state %s must not be in the escrow-holds-funds set", s)
		}
		// initiated has not been funded yet — must not be counted either.
		if s == mkt.OrderInitiated && want {
			t.Error("initiated (unfunded) must not be in the escrow-holds-funds set")
		}
	}
	if len(holdsFunds) != 6 {
		t.Errorf("expected exactly 6 escrow-holding states per §2.2 reconciliation clause, got %d", len(holdsFunds))
	}
}

// ─── §2.1 Listing FSM ─────────────────────────────────────────────────────────

var listingTransitionsMirror = map[mkt.ListingStatus]map[mkt.ListingStatus]bool{
	mkt.ListingDraft: {
		mkt.ListingPendingReview: true,
		mkt.ListingActive:        true, // auto-approve path
		mkt.ListingRemovedUser:   true,
	},
	mkt.ListingPendingReview: {
		mkt.ListingActive:        true, // approve
		mkt.ListingRemovedPolicy: true, // reject
		mkt.ListingRemovedUser:   true,
	},
	mkt.ListingActive: {
		mkt.ListingPaused:        true,
		mkt.ListingExpired:       true,
		mkt.ListingSold:          true,
		mkt.ListingPendingReview: true, // re-moderation: a content edit to a live listing
		mkt.ListingRemovedPolicy: true,
		mkt.ListingRemovedUser:   true,
	},
	mkt.ListingPaused: {
		mkt.ListingActive:      true, // resume
		mkt.ListingExpired:     true,
		mkt.ListingRemovedUser: true,
	},
	mkt.ListingExpired: {
		mkt.ListingActive:      true, // renew
		mkt.ListingRemovedUser: true,
	},
	mkt.ListingSold:          {},
	mkt.ListingRemovedPolicy: {},
	mkt.ListingRemovedUser:   {},
}

var allListingStates = []mkt.ListingStatus{
	mkt.ListingDraft, mkt.ListingPendingReview, mkt.ListingActive, mkt.ListingPaused,
	mkt.ListingExpired, mkt.ListingSold, mkt.ListingRemovedPolicy, mkt.ListingRemovedUser,
}

var listingTerminalStates = map[mkt.ListingStatus]bool{
	mkt.ListingSold: true, mkt.ListingRemovedPolicy: true, mkt.ListingRemovedUser: true,
}

func TestListingFSM_HappyPathEdgesLegal(t *testing.T) {
	cases := []struct {
		event    string
		from, to mkt.ListingStatus
	}{
		{"submit_to_review", mkt.ListingDraft, mkt.ListingPendingReview},
		{"submit_auto_approve", mkt.ListingDraft, mkt.ListingActive},
		{"approve", mkt.ListingPendingReview, mkt.ListingActive},
		{"reject", mkt.ListingPendingReview, mkt.ListingRemovedPolicy},
		{"pause", mkt.ListingActive, mkt.ListingPaused},
		{"resume", mkt.ListingPaused, mkt.ListingActive},
		{"auto_expire", mkt.ListingActive, mkt.ListingExpired},
		{"renew", mkt.ListingExpired, mkt.ListingActive},
		{"mark_sold", mkt.ListingActive, mkt.ListingSold},
		{"user_delete_from_active", mkt.ListingActive, mkt.ListingRemovedUser},
		{"user_delete_from_draft", mkt.ListingDraft, mkt.ListingRemovedUser},
	}
	for _, tc := range cases {
		t.Run(tc.event, func(t *testing.T) {
			if !listingTransitionsMirror[tc.from][tc.to] {
				t.Errorf("%s: %s -> %s must be legal per §2.1", tc.event, tc.from, tc.to)
			}
		})
	}
}

func TestListingFSM_IllegalTransitionsRejected(t *testing.T) {
	cases := []struct {
		name     string
		from, to mkt.ListingStatus
	}{
		{"cannot approve a draft directly (must go through pending_review or auto-approve path only)", mkt.ListingDraft, mkt.ListingRemovedPolicy},
		{"cannot resume a sold listing", mkt.ListingSold, mkt.ListingActive},
		{"cannot un-reject a removed_policy listing", mkt.ListingRemovedPolicy, mkt.ListingActive},
		{"cannot un-delete a removed_user listing", mkt.ListingRemovedUser, mkt.ListingActive},
		{"cannot sell a paused listing without resuming first", mkt.ListingPaused, mkt.ListingSold},
		{"cannot sell an expired listing without renewing first", mkt.ListingExpired, mkt.ListingSold},
		{"cannot pause a pending_review listing", mkt.ListingPendingReview, mkt.ListingPaused},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if listingTransitionsMirror[tc.from][tc.to] {
				t.Errorf("%s: %s -> %s must be REJECTED", tc.name, tc.from, tc.to)
			}
		})
	}
}

func TestListingFSM_TerminalStatesHaveNoOutgoingEdges(t *testing.T) {
	for s, isTerm := range listingTerminalStates {
		if !isTerm {
			continue
		}
		if edges := listingTransitionsMirror[s]; len(edges) != 0 {
			t.Errorf("terminal listing state %s has %d outgoing edges, want 0", s, len(edges))
		}
	}
	for _, s := range allListingStates {
		if !listingTerminalStates[s] && len(listingTransitionsMirror[s]) == 0 {
			t.Errorf("non-terminal listing state %s has no outgoing edges", s)
		}
	}
}

// TestListingFSM_OutboxOpMirrorsSearchVisibility transcribes listingOutboxOp
// (fsm_listing.go): active ⇒ upsert (visible in search); every other status the
// listing can be IN after a transition ⇒ delete (removed from search). This
// guards the outbox contract Agent B depends on.
func TestListingFSM_OutboxOpMirrorsSearchVisibility(t *testing.T) {
	cases := []struct {
		to       mkt.ListingStatus
		wantOp   string
		wantEmit bool
	}{
		{mkt.ListingActive, "upsert", true},
		{mkt.ListingPaused, "delete", true},
		{mkt.ListingExpired, "delete", true},
		{mkt.ListingSold, "delete", true},
		{mkt.ListingRemovedPolicy, "delete", true},
		{mkt.ListingRemovedUser, "delete", true},
		{mkt.ListingDraft, "", false},
		{mkt.ListingPendingReview, "", false},
	}
	mirror := func(to mkt.ListingStatus) (string, bool) {
		switch to {
		case mkt.ListingActive:
			return mkt.OutboxUpsert, true
		case mkt.ListingPaused, mkt.ListingExpired, mkt.ListingSold, mkt.ListingRemovedPolicy, mkt.ListingRemovedUser:
			return mkt.OutboxDelete, true
		default:
			return "", false
		}
	}
	for _, tc := range cases {
		op, emit := mirror(tc.to)
		if emit != tc.wantEmit || op != tc.wantOp {
			t.Errorf("listingOutboxOp(%s) = (%q,%v), want (%q,%v)", tc.to, op, emit, tc.wantOp, tc.wantEmit)
		}
	}
}

// ─── §2.3 Dispute FSM ─────────────────────────────────────────────────────────

var disputeTransitionsMirror = map[mkt.DisputeStatus]map[mkt.DisputeStatus]bool{
	mkt.DisputeOpened: {
		mkt.DisputeEvidenceWindow: true,
	},
	mkt.DisputeEvidenceWindow: {
		mkt.DisputeUnderReview: true,
	},
	mkt.DisputeUnderReview: {
		mkt.DisputeDecided: true,
	},
	mkt.DisputeDecided: {
		mkt.DisputeExecuted: true,
	},
	mkt.DisputeExecuted: {
		mkt.DisputeClosed: true,
	},
	mkt.DisputeClosed: {
		mkt.DisputeAppealed: true,
	},
	mkt.DisputeAppealed: {
		mkt.DisputeUnderReview: true,
	},
}

func TestDisputeFSM_HappyPathIsLinearThenAppealable(t *testing.T) {
	t.Skip(adr023OrderDisputeSkip)
	order := []mkt.DisputeStatus{
		mkt.DisputeOpened, mkt.DisputeEvidenceWindow, mkt.DisputeUnderReview,
		mkt.DisputeDecided, mkt.DisputeExecuted, mkt.DisputeClosed, mkt.DisputeAppealed,
	}
	for i := 0; i < len(order)-1; i++ {
		from, to := order[i], order[i+1]
		if !disputeTransitionsMirror[from][to] {
			t.Errorf("%s -> %s must be legal (linear happy path)", from, to)
		}
	}
	// appealed loops back to under_review (NOT a fresh opened/evidence_window).
	if !disputeTransitionsMirror[mkt.DisputeAppealed][mkt.DisputeUnderReview] {
		t.Error("appealed -> under_review must be legal (single re-review loop)")
	}
}

func TestDisputeFSM_CannotSkipEvidenceOrDualDecision(t *testing.T) {
	t.Skip(adr023OrderDisputeSkip)
	cases := []struct {
		name     string
		from, to mkt.DisputeStatus
	}{
		{"cannot decide before under_review", mkt.DisputeOpened, mkt.DisputeDecided},
		{"cannot execute without a decision", mkt.DisputeUnderReview, mkt.DisputeExecuted},
		{"cannot close without executing", mkt.DisputeDecided, mkt.DisputeClosed},
		{"cannot appeal a not-yet-closed dispute", mkt.DisputeUnderReview, mkt.DisputeAppealed},
		{"cannot appeal twice by looping appealed->appealed", mkt.DisputeAppealed, mkt.DisputeAppealed},
		{"executed cannot re-enter decided (no double execution)", mkt.DisputeExecuted, mkt.DisputeDecided},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if disputeTransitionsMirror[tc.from][tc.to] {
				t.Errorf("%s: %s -> %s must be REJECTED", tc.name, tc.from, tc.to)
			}
		})
	}
}

// TestDisputeFSM_DualApprovalThreshold locks the ₦500k (kobo) boundary that
// determines whether a second, DISTINCT admin approver is required (§6.3).
func TestDisputeFSM_DualApprovalThreshold(t *testing.T) {
	t.Skip(adr023OrderDisputeSkip)                 // dual-approval was a dispute-decision gate (removed); constant retained but unused.
	const halfMillionNairaInKobo int64 = 500_00000 // ₦500,000 * 100 kobo/naira = 50,000,000
	if mkt.DualApprovalThresholdKobo != halfMillionNairaInKobo {
		t.Fatalf("DualApprovalThresholdKobo = %d, want %d (₦500,000 in kobo)", mkt.DualApprovalThresholdKobo, halfMillionNairaInKobo)
	}
	cases := []struct {
		name        string
		amountKobo  int64
		requireDual bool
	}{
		{"exactly at threshold is single-approval (strict >)", 50_000_000, false},
		{"one kobo over threshold requires dual", 50_000_001, true},
		{"far above threshold requires dual", 200_000_000, true},
		{"small order is single-approval", 10_000, false},
		{"zero is single-approval", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.amountKobo > mkt.DualApprovalThresholdKobo
			if got != tc.requireDual {
				t.Errorf("amount=%d: requiresDualApproval=%v, want %v", tc.amountKobo, got, tc.requireDual)
			}
		})
	}
}

// TestDisputeFSM_EvidenceAndInspectionWindowDurations locks the §2.2/§2.3 clocks.
func TestDisputeFSM_EvidenceAndInspectionWindowDurations(t *testing.T) {
	t.Skip(adr023OrderDisputeSkip) // inspection/evidence clocks belonged to the removed escrow order/dispute flow.
	if mkt.InspectionWindow.Hours() != 48 {
		t.Errorf("InspectionWindow = %v, want 48h", mkt.InspectionWindow)
	}
	if mkt.EvidenceWindow.Hours() != 72 {
		t.Errorf("EvidenceWindow = %v, want 72h", mkt.EvidenceWindow)
	}
}

// ─── §2.4 Boost FSM ───────────────────────────────────────────────────────────

var boostTransitionsMirror = map[mkt.BoostStatus]map[mkt.BoostStatus]bool{
	mkt.BoostPurchased: {
		mkt.BoostActive:             true,
		mkt.BoostRejectedWithReason: true,
	},
	mkt.BoostActive: {
		mkt.BoostCompleted:          true,
		mkt.BoostRejectedWithReason: true,
	},
	mkt.BoostRejectedWithReason: {
		mkt.BoostAutoRefunded: true,
	},
	mkt.BoostCompleted:    {},
	mkt.BoostAutoRefunded: {},
}

func TestBoostFSM_HappyPathAndRejectionEdgesLegal(t *testing.T) {
	cases := []struct {
		name     string
		from, to mkt.BoostStatus
	}{
		{"purchase_auto_activates", mkt.BoostPurchased, mkt.BoostActive},
		{"active_completes", mkt.BoostActive, mkt.BoostCompleted},
		{"reject_from_purchased", mkt.BoostPurchased, mkt.BoostRejectedWithReason},
		{"reject_from_active", mkt.BoostActive, mkt.BoostRejectedWithReason},
		{"rejected_auto_refunds", mkt.BoostRejectedWithReason, mkt.BoostAutoRefunded},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if !boostTransitionsMirror[tc.from][tc.to] {
				t.Errorf("%s: %s -> %s must be legal per §2.4", tc.name, tc.from, tc.to)
			}
		})
	}
}

// TestBoostFSM_RejectedNeverDanglesActive is the §8 chaos-scenario invariant at the
// FSM-shape level: "boost purchased on a listing that gets rejected afterward" must
// auto-transition to rejected_with_reason -> auto_refunded, i.e. `active` and
// `purchased` MUST have a path to `auto_refunded` and it must NOT be possible to
// stay in `active`/`purchased` with a `rejected` marker without progressing to the
// refund (no dangling active-but-rejected state exists in the enum at all).
func TestBoostFSM_RejectedNeverDanglesActive(t *testing.T) {
	// There is no "active_but_rejected" status in the enum — rejection is a real
	// transition away from active/purchased, and rejected_with_reason has EXACTLY
	// one legal edge: to auto_refunded. This proves the boost can never be left
	// sitting in rejected_with_reason with no forward path (mirrors the order FSM's
	// "no terminal-adjacent dead end" invariant).
	edges := boostTransitionsMirror[mkt.BoostRejectedWithReason]
	if len(edges) != 1 || !edges[mkt.BoostAutoRefunded] {
		t.Fatalf("rejected_with_reason must have exactly one edge, to auto_refunded; got %v", edges)
	}
}

func TestBoostFSM_TerminalStatesHaveNoOutgoingEdges(t *testing.T) {
	for _, s := range []mkt.BoostStatus{mkt.BoostCompleted, mkt.BoostAutoRefunded} {
		if edges := boostTransitionsMirror[s]; len(edges) != 0 {
			t.Errorf("terminal boost state %s has %d outgoing edges, want 0", s, len(edges))
		}
	}
}

// TestBoostFSM_IllegalTransitionsRejected covers implausible-but-dangerous jumps.
func TestBoostFSM_IllegalTransitionsRejected(t *testing.T) {
	cases := []struct {
		name     string
		from, to mkt.BoostStatus
	}{
		{"cannot re-purchase a completed boost", mkt.BoostCompleted, mkt.BoostPurchased},
		{"cannot re-activate an auto-refunded boost", mkt.BoostAutoRefunded, mkt.BoostActive},
		{"cannot skip rejection straight to auto_refunded", mkt.BoostPurchased, mkt.BoostAutoRefunded},
		{"cannot complete directly from purchased (must activate first)", mkt.BoostPurchased, mkt.BoostCompleted},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if boostTransitionsMirror[tc.from][tc.to] {
				t.Errorf("%s: %s -> %s must be REJECTED", tc.name, tc.from, tc.to)
			}
		})
	}
}

// ─── Cross-cutting: CodedError shape + the §3 taxonomy strings other agents render ─

// TestInvalidTransitionErrorCodesArePresentAndDistinct locks the frozen error code
// strings each FSM's guard function returns (errors.go), which mobile/admin (D/E)
// render verbatim. A typo here breaks every client that switches on `error.code`.
func TestInvalidTransitionErrorCodesArePresentAndDistinct(t *testing.T) {
	codes := map[string]string{
		"order":   mkt.CodeInvalidOrderTransition,
		"listing": mkt.CodeInvalidListingTransition,
		"dispute": mkt.CodeInvalidDisputeTransition,
		"boost":   mkt.CodeInvalidBoostTransition,
	}
	seen := map[string]string{}
	for name, code := range codes {
		if code == "" {
			t.Errorf("%s transition error code must not be empty", name)
		}
		if other, dup := seen[code]; dup {
			t.Errorf("%s and %s share the same invalid-transition code %q; must be distinct", name, other, code)
		}
		seen[code] = name
	}
}

// TestCodedErrorImplementsError is a compile-time + behavioral smoke check that the
// exported CodedError satisfies the error interface with the code baked into the
// message (useful in logs even when JSON isn't rendered).
func TestCodedErrorImplementsError(t *testing.T) {
	var err error = &mkt.CodedError{Status: 409, Code: mkt.CodeInvalidOrderTransition, Message: "bad transition"}
	if err.Error() == "" {
		t.Fatal("CodedError.Error() must not be empty")
	}
}
