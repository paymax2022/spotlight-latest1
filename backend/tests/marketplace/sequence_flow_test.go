package marketplace_test

// ---------------------------------------------------------------------------
// Agent F (QA) — the 3 §6 sequence-diagram flows encoded as tests, per §10
// build order ("implement the three sequence-diagram flows in §6 as integration
// tests first — they encode the system's non-negotiable invariants").
//
// LIVE-DB REQUIREMENT (documented per task instructions):
// All three flows below are driven through spotlight/backend/internal/marketplace
// Service methods (CreateOrder, FundOrder, SellerAccept, HandleDeliveryConfirmed,
// ConfirmDelivery, AutoReleaseDue, OpenDispute, DecideDispute, ApproveDispute).
// Service is constructed via NewService(pool *pgxpool.Pool, ledger *ledger.Service,
// rdb *redis.Client) and every one of those methods immediately calls into
// s.repo (a *Repository wrapping a real *pgxpool.Pool) and/or s.ledger (the real
// finance ledger service, itself pgx-backed). There is no in-memory/fake
// repository or ledger implementation exposed by Agent A's package — Repository
// is a concrete struct, not an interface, so it cannot be swapped for a test
// double from this external test package without modifying
// backend/internal/marketplace/*.go, which is Agent A's exclusive boundary.
//
// Consequently every TestFlow_* function below is SKIPPED at runtime (t.Skip)
// with a clear reason, and is structured as a fully-written integration test
// that will run unmodified the moment a live Postgres + the marketplace
// migrations + a ledger.Service are available in CI (see QA_REPORT.md for the
// exact bring-up recipe: docker-compose postgres + `supabase db reset` +
// construct ledger.NewService(pool) + marketplace.NewService(pool, ledgerSvc, nil)).
//
// What CAN run without a DB (and does, unconditionally) is asserted directly
// below each skip: the deterministic ledger reference/idempotency-key naming
// scheme (mirrors service_order.go's s.ref/s.idem), which is what makes the
// idempotent-replay and reconciliation invariants hold in the first place.
// ---------------------------------------------------------------------------

import (
	"fmt"
	"testing"

	mkt "spotlight/backend/internal/marketplace"
)

// ADR-023 NOTICE: every §6 flow in this file drives the escrow ORDER / DISPUTE
// money-path (CreateOrder, FundOrder, HandleDeliveryConfirmed, AutoReleaseDue,
// OpenDispute, DecideDispute, ApproveDispute) or reconciliation over escrow — ALL
// REMOVED in the listings-and-connect pivot (ADR-023). The live-DB TestFlow_* cases
// already t.Skip (no MARKETPLACE_TEST_DATABASE_URL); the DB-free "structural" halves
// used to RUN while asserting mirrors of deleted code (deterministic order fund-ref
// naming, delivery-webhook idempotency state-set, dispute dual-approval boundary,
// escrow reconciliation arithmetic) — false confidence. Those are now t.Skip'd with
// this pointer, kept as the historical §6 record rather than deleted.
const adr023SeqSkip = "ADR-023: escrow order/dispute/webhook flow removed (listings-and-connect pivot); " +
	"this asserts a mirror of deleted code. Kept as the historical §6 record. See ADR-023."

// newTestService is the single place a live-DB flow test would construct the
// service under test. It returns (nil, false) today because no pgxpool/ledger
// wiring is available in this sandbox; when infra is available, wire:
//
//	pool, _ := pgxpool.New(ctx, os.Getenv("MARKETPLACE_TEST_DATABASE_URL"))
//	ledgerSvc := ledger.NewService(pool)
//	svc := mkt.NewService(pool, ledgerSvc, nil) // redis nil is supported (DB-unique backstop)
// (removed) newTestService was a constructor that called t.Skip() unconditionally
// even when MARKETPLACE_TEST_DATABASE_URL was set, so nothing gated on it could
// run in ANY environment — the tests behind it reported ok while asserting
// nothing. Live marketplace tests use liveMktService (remoderation_live_db_test.go),
// which actually connects and is what chaos_live_db_test.go drives.

// ─── 6.1 Escrow checkout → funding ────────────────────────────────────────────

// TestFlow_EscrowCheckoutToFunding_IdempotentSingleLedgerEffect drives §6.1
// end-to-end: POST /orders (Idempotency-Key K1) then POST /orders/{id}/fund
// (Idempotency-Key K2) TWICE with the same K2, and asserts:
//  1. The first fund call debits the buyer exactly once (one ledger_fund_ref).
//  2. The replay (same K2) returns the ORIGINAL response/order state, not a
//     second debit — "same Idempotency-Key twice = one ledger effect, replay
//     returns original" (task spec, mirrors §3 IDEMPOTENCY_KEY_REPLAY semantics
//     and the §6.1 sequence diagram's Redis idem:K2 check).
//  3. CreateOrder itself is idempotent on K1 the same way (a second POST /orders
//     with K1 returns the same order, no second row / no second listing lock).
func TestFlow_EscrowCheckoutToFunding_IdempotentSingleLedgerEffect(t *testing.T) {
	// ADR-023 removed the escrow order/dispute/webhook path this drives. The
	// old gate claimed a live database would run it, which no environment
	// could satisfy — newTestService skips unconditionally and the code under
	// test no longer exists. The intended assertions below are kept as the
	// design record if the path returns.
	t.Skip(adr023ChaosSkip)

	// ---- intended assertions once live (documented for the DB-enabled run) ----
	// order1, err := svc.CreateOrder(ctx, buyerID, "K1", mkt.CreateOrderInput{ListingID: listingID, DeliveryOption: "pickup"})
	// order2, err := svc.CreateOrder(ctx, buyerID, "K1", mkt.CreateOrderInput{ListingID: listingID, DeliveryOption: "pickup"})
	// assert order1.ID == order2.ID (replay returns the SAME order, no second insert)
	//
	// funded1, err := svc.FundOrder(ctx, order1.ID, buyerID, "K2", mkt.FundInput{PaymentMethod: "wallet"})
	// funded2, err := svc.FundOrder(ctx, order1.ID, buyerID, "K2", mkt.FundInput{PaymentMethod: "wallet"})
	// assert funded1.LedgerFundRef == funded2.LedgerFundRef (same fund ref both times)
	// assert exactly ONE ledger_entries row exists for that fund reference (query the
	//   ledger directly: SELECT count(*) FROM ledger_entries WHERE reference = fundRef
	//   GROUP BY idempotency_key HAVING count(*) > 1 must return zero rows)
	// assert funded2.Status == mkt.OrderFunded (not re-debited, not reset)
}

// TestFlow_EscrowCheckoutToFunding_DeterministicKeyNaming is the DB-FREE half of
// the above: it locks the deterministic ledger reference/idempotency-key naming
// scheme service_order.go documents ("mkt:order:<id>:fund"), which is the
// mechanical reason a replay collides on the SAME key rather than minting a new
// one. This is the same style as split_invariant_test.go's settleLegKeys: correct
// by construction, transcribed from the production formula.
func TestFlow_EscrowCheckoutToFunding_DeterministicKeyNaming(t *testing.T) {
	t.Skip(adr023SeqSkip)
	fundRef := func(orderID string) string { return fmt.Sprintf("mkt:order:%s:fund", orderID) }

	const orderID = "order-abc-123"
	first := fundRef(orderID)
	retry := fundRef(orderID) // simulates a second FundOrder call with the same order id

	if first != retry {
		t.Fatalf("fund ref must be stable across retries: first=%q retry=%q", first, retry)
	}
	want := "mkt:order:order-abc-123:fund"
	if first != want {
		t.Fatalf("fund ref derivation changed: got %q, want %q", first, want)
	}
	// Two DIFFERENT orders must never collide (else order B's funding would be a
	// silent no-op against order A's already-posted ledger entry).
	other := fundRef("order-xyz-999")
	if other == first {
		t.Fatalf("distinct orders must not share a fund ref: both were %q", first)
	}
}

// ─── 6.2 Delivery confirmation → auto-release ────────────────────────────────

// TestFlow_DeliveryToAutoRelease_DeadlineDrivesRelease drives §6.2 end-to-end:
// webhook delivery-confirmed → inspection_window (deadline = delivered_at+48h) →
// cron AutoReleaseDue after the deadline passes with no open dispute → released,
// with a placeholder review inserted (§6.2: "INSERT mkt_reviews (is_placeholder=true)").
func TestFlow_DeliveryToAutoRelease_DeadlineDrivesRelease(t *testing.T) {
	// ADR-023 removed the escrow order/dispute/webhook path this drives. The
	// old gate claimed a live database would run it, which no environment
	// could satisfy — newTestService skips unconditionally and the code under
	// test no longer exists. The intended assertions below are kept as the
	// design record if the path returns.
	t.Skip(adr023ChaosSkip)

	// ---- intended assertions once live ----
	// 1. seed an order through funded -> seller_accepted (SellerAccept)
	// 2. call svc.HandleDeliveryConfirmed(ctx, mkt.DeliveryConfirmedInput{OrderID: id, DeliveryRef: "d1", ...})
	//    assert order.Status == mkt.OrderInspectionWindow
	//    assert order.InspectionDeadline ~= now()+48h (within tolerance)
	// 3. call svc.HandleDeliveryConfirmed again with the SAME DeliveryRef "d1"
	//    assert it is a no-op (idempotent replay) — no second delivered_at stamp,
	//    same InspectionDeadline as step 2.
	// 4. manually backdate inspection_deadline in the test DB to the past (test-only
	//    SQL, since Service exposes no "advance clock" seam — this is the standard
	//    way to test a deadline-driven cron without sleeping in a test).
	// 5. call n, err := svc.AutoReleaseDue(ctx); assert n >= 1 and the order is now
	//    mkt.OrderReleased, LedgerReleaseRef set.
	// 6. assert exactly one mkt_reviews row exists for the order with is_placeholder=true
	//    (the review-integrity invariant from §1: "any order reaching released MUST
	//    have a row inserted here").
	// 7. Reconciliation invariant: the escrow ledger account's balance attributable to
	//    this order is now zero (released leg + fee leg drained it exactly).
}

// TestFlow_DeliveryToAutoRelease_WebhookIdempotencyIsStructural is the DB-free half:
// HandleDeliveryConfirmed's documented behavior is that a replay with the SAME
// delivery_ref against an order already in delivered/inspection_window/terminal is
// a no-op returning the existing order (webhooks.go). This locks the STATE-SET
// that short-circuits to a no-op, so a regression that narrows this set would
// silently start re-processing (and could re-notify or, worse, attempt a duplicate
// InspectionDeadline extension) on every duplicate webhook delivery — a real
// scenario per §8's "duplicate webhook delivery" row.
func TestFlow_DeliveryToAutoRelease_WebhookIdempotencyIsStructural(t *testing.T) {
	t.Skip(adr023SeqSkip)
	// Mirrors the exact switch in HandleDeliveryConfirmed (webhooks.go).
	isIdempotentNoOp := func(status mkt.OrderStatus) bool {
		switch status {
		case mkt.OrderDelivered, mkt.OrderInspectionWindow:
			return true
		default:
			return false
		}
	}
	// Every terminal state must ALSO be a no-op replay target (orderIsTerminal
	// union), never re-processed.
	terminals := []mkt.OrderStatus{mkt.OrderReleased, mkt.OrderCancelled, mkt.OrderRefunded, mkt.OrderSplitSettled}
	for _, s := range terminals {
		// The production code's condition is:
		//   prior.Status == Delivered || prior.Status == InspectionWindow || orderIsTerminal(prior.Status)
		// so terminals are covered by the orderIsTerminal disjunct even though
		// isIdempotentNoOp() alone (mirroring only the first two cases) returns
		// false for them — assert the FULL condition, not just the two named cases.
		full := isIdempotentNoOp(s) || isOrderTerminalMirror(s)
		if !full {
			t.Errorf("terminal state %s must short-circuit a duplicate delivery webhook to a no-op replay", s)
		}
	}
	if !isIdempotentNoOp(mkt.OrderDelivered) {
		t.Error("delivered must be an idempotent no-op target for a duplicate webhook")
	}
	if !isIdempotentNoOp(mkt.OrderInspectionWindow) {
		t.Error("inspection_window must be an idempotent no-op target for a duplicate webhook")
	}
	// A genuinely in-flight state must NOT be short-circuited (the webhook must
	// still process it the first time).
	for _, s := range []mkt.OrderStatus{mkt.OrderInDelivery, mkt.OrderSellerAccepted} {
		if isIdempotentNoOp(s) || isOrderTerminalMirror(s) {
			t.Errorf("in-flight state %s must NOT be treated as an idempotent no-op (first delivery webhook must process it)", s)
		}
	}
}

// isOrderTerminalMirror transcribes orderIsTerminal (fsm_order.go), used only to
// compose the full idempotent-no-op condition above without depending on the
// unexported production function.
func isOrderTerminalMirror(s mkt.OrderStatus) bool {
	switch s {
	case mkt.OrderReleased, mkt.OrderCancelled, mkt.OrderRefunded, mkt.OrderSplitSettled:
		return true
	default:
		return false
	}
}

// ─── 6.3 Dispute resolution (dual-approval path) ─────────────────────────────

// TestFlow_DisputeDualApproval_RequiresDistinctSecondApprover drives §6.3
// end-to-end for an order > ₦500k: DecideDispute records `decided` and returns
// AWAITING_SECOND_APPROVAL WITHOUT moving money; ApproveDispute by the SAME admin
// is rejected (SAME_APPROVER_NOT_ALLOWED); ApproveDispute by a DIFFERENT admin
// executes the ledger transaction and closes the dispute.
func TestFlow_DisputeDualApproval_RequiresDistinctSecondApprover(t *testing.T) {
	// ADR-023 removed the escrow order/dispute/webhook path this drives. The
	// old gate claimed a live database would run it, which no environment
	// could satisfy — newTestService skips unconditionally and the code under
	// test no longer exists. The intended assertions below are kept as the
	// design record if the path returns.
	t.Skip(adr023ChaosSkip)

	// ---- intended assertions once live ----
	// 1. seed an order with AmountKobo = 60_000_000 (₦600k, > threshold) through to
	//    disputed / under_review.
	// 2. d1, err := svc.DecideDispute(ctx, "admin-1", disputeID, mkt.DecideDisputeInput{
	//        Decision: mkt.DecisionRefundBuyer, ReasonCode: "item_not_received"})
	//    assert err is a *mkt.CodedError with Code == mkt.CodeAwaitingSecondApproval
	//    assert the ORDER is still `disputed` (no ledger tx has fired yet)
	// 3. _, err = svc.ApproveDispute(ctx, "admin-1", disputeID) // SAME admin
	//    assert err.(*mkt.CodedError).Code == mkt.CodeSameApproverNotAllowed
	//    assert the order is STILL `disputed` (rejected approval must not move money)
	// 4. d2, err := svc.ApproveDispute(ctx, "admin-2", disputeID) // DIFFERENT admin
	//    assert err == nil, d2.Status == mkt.DisputeClosed
	//    assert the order is now mkt.OrderRefunded with LedgerReleaseRef set
	//    assert exactly one balanced ledger posting exists for the refund reference.
}

// TestFlow_DisputeSingleApproval_BelowThresholdExecutesImmediately is the ≤₦500k
// counterpart: DecideDispute executes the ledger transaction in the SAME call,
// no second approver required.
func TestFlow_DisputeSingleApproval_BelowThresholdExecutesImmediately(t *testing.T) {
	// ADR-023 removed the escrow order/dispute/webhook path this drives. The
	// old gate claimed a live database would run it, which no environment
	// could satisfy — newTestService skips unconditionally and the code under
	// test no longer exists. The intended assertions below are kept as the
	// design record if the path returns.
	t.Skip(adr023ChaosSkip)
	// ---- intended assertions once live ----
	// seed an order with AmountKobo = 20_000_000 (₦200k, <= threshold) disputed/under_review.
	// d, err := svc.DecideDispute(ctx, "admin-1", disputeID, mkt.DecideDisputeInput{
	//     Decision: mkt.DecisionReleaseSeller, ReasonCode: "buyer_remorse_not_valid"})
	// assert err == nil (no AWAITING_SECOND_APPROVAL signal)
	// assert d.Status == mkt.DisputeClosed immediately
	// assert the order is mkt.OrderReleased with LedgerReleaseRef set, in the SAME call.
}

// TestFlow_DisputeDualApproval_ThresholdBoundaryIsDeterministic is the DB-free
// half: given an admin decision path, whether dual-approval fires is a pure
// function of order.AmountKobo vs DualApprovalThresholdKobo (also covered from
// the FSM-shape angle in fsm_invariant_test.go; here it's asserted as the actual
// decision the DecideDispute code path takes: `d.RequiresDualApproval ||
// o.AmountKobo > DualApprovalThresholdKobo`).
func TestFlow_DisputeDualApproval_ThresholdBoundaryIsDeterministic(t *testing.T) {
	t.Skip(adr023SeqSkip)
	requiresDual := func(disputeRequiresDual bool, amountKobo int64) bool {
		return disputeRequiresDual || amountKobo > mkt.DualApprovalThresholdKobo
	}
	cases := []struct {
		name                string
		disputeRequiresDual bool
		amountKobo          int64
		want                bool
	}{
		{"small order, no forced flag", false, 10_000_000, false},
		{"large order forces dual even if flag unset", false, 60_000_000, true},
		{"appealed dispute forces dual regardless of (now smaller) amount", true, 10_000_000, true},
		{"exactly at threshold, flag unset -> single", false, 50_000_000, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := requiresDual(tc.disputeRequiresDual, tc.amountKobo); got != tc.want {
				t.Errorf("requiresDual(flag=%v, amount=%d) = %v, want %v", tc.disputeRequiresDual, tc.amountKobo, got, tc.want)
			}
		})
	}
}

// ─── Cross-cutting non-negotiable invariant (§2.2): reconciliation ───────────

// TestReconciliation_TerminalOrderIsExactlyOneBalancedPosting is a DB-free model
// of the §2.2 hourly reconciliation check. It cannot query a real ledger here, so
// it documents and locks the INVARIANT SHAPE: for each terminal outcome, the sum
// of ledger legs posted out of escrow must equal the amount that was originally
// escrowed (fund leg), i.e. escrow nets to zero for that order. The concrete
// per-leg arithmetic (sellerNet = AmountKobo, feeTotal = EscrowFeeKobo+DeliveryFeeKobo,
// split legs) is transcribed from service_order.go / service_dispute.go.
func TestReconciliation_TerminalOrderIsExactlyOneBalancedPosting(t *testing.T) {
	t.Skip(adr023SeqSkip)
	type order struct {
		amountKobo, escrowFeeKobo, deliveryFeeKobo int64
	}
	o := order{amountKobo: 100_000, escrowFeeKobo: 2_000, deliveryFeeKobo: 1_500}
	escrowed := o.amountKobo + o.escrowFeeKobo + o.deliveryFeeKobo // what FundOrder debited into escrow

	t.Run("released: seller leg + fee leg == escrowed", func(t *testing.T) {
		sellerNet := o.amountKobo
		feeTotal := o.escrowFeeKobo + o.deliveryFeeKobo
		if got := sellerNet + feeTotal; got != escrowed {
			t.Errorf("released legs sum to %d, escrowed %d (leak %d)", got, escrowed, escrowed-got)
		}
	})

	t.Run("refunded: full refund == escrowed exactly (PostReversal total)", func(t *testing.T) {
		total := o.amountKobo + o.escrowFeeKobo + o.deliveryFeeKobo // refundToBuyer's `total`
		if total != escrowed {
			t.Errorf("refund total %d != escrowed %d", total, escrowed)
		}
	})

	t.Run("split_settled: buyer leg + seller leg + fee leg == escrowed", func(t *testing.T) {
		splitBuyerKobo := int64(40_000)
		sellerShare := o.amountKobo - splitBuyerKobo
		feeTotal := o.escrowFeeKobo + o.deliveryFeeKobo
		if got := splitBuyerKobo + sellerShare + feeTotal; got != escrowed {
			t.Errorf("split legs sum to %d, escrowed %d (leak %d)", got, escrowed, escrowed-got)
		}
	})

	t.Run("cancelled (unfunded, initiated->cancelled): zero legs, zero escrowed", func(t *testing.T) {
		// CancelOrder from `initiated` moves no money at all (no fund ever happened).
		var neverEscrowed int64 = 0
		var legsPosted int64 = 0
		if legsPosted != neverEscrowed {
			t.Errorf("an order cancelled before funding must post zero ledger legs")
		}
	})
}
