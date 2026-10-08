package paystackcheckout

// H3 (settlement validated BEFORE the gateway), H4 (gateway refund is
// idempotent: 'refunding' recorded first, ambiguous replies resolved by lookup,
// failed/pending statuses honoured) and H6 (an unbooked charge's ledger side is
// reversed BEFORE the customer is refunded).

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/provider"
)

func underpaid(r *rig) {
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: 100_000, Currency: "NGN"}
}

func status(t *testing.T, r *rig, ref string) *Intent {
	t.Helper()
	rec, err := r.st.Get(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	return rec
}

// ── H4 ──────────────────────────────────────────────────────────────────────

func TestRefund_RefundingIsRecordedBeforeTheGatewayIsCalled(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	underpaid(r)
	var seen string
	r.gw.onRefund = func(string) { seen = status(t, r, ref).Status }
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	if seen != StatusRefunding {
		t.Fatalf("intent was %q when the gateway refund was issued; it must already be 'refunding' so a crash mid-call is resolvable", seen)
	}
	rec := status(t, r, ref)
	if rec.Status != StatusRefunded || rec.RefundReference == nil {
		t.Errorf("final %q ref=%v", rec.Status, rec.RefundReference)
	}
	if rec.RefundAmountKobo != 100_000 {
		t.Errorf("refund amount recorded %d, want the COLLECTED 100000", rec.RefundAmountKobo)
	}
}

func TestRefund_AcceptedButReplyLost_IsRecordedAsRefunded_NotAsFailure(t *testing.T) {
	for _, tc := range []struct {
		name string
		prep func(*rig)
	}{
		{"amount_mismatch", underpaid},
		{"order_failed", func(r *rig) { r.d.bookErr = errors.New("insert failed") }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := newRig()
			ref := paid(t, r)
			tc.prep(r)
			r.gw.refundErr = errors.New("http request: context deadline exceeded") // reply lost
			r.gw.lookupRes = &provider.RefundResult{Reference: "rf_lost", Status: "processed", AmountKobo: 100_000}
			_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
			rec := status(t, r, ref)
			if rec.Status != StatusRefunded {
				t.Fatalf("status %q: a refund Paystack accepted must be recorded as refunded, never %q", rec.Status, tc.name)
			}
			if rec.RefundReference == nil || *rec.RefundReference != "rf_lost" {
				t.Errorf("refund reference %v, want the looked-up rf_lost", rec.RefundReference)
			}
		})
	}
}

func TestRefund_AlreadyReversed_IsVerifiedByLookup(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	underpaid(r)
	r.gw.refundErr = fmt.Errorf("paystack: refund: %w", provider.ErrAlreadyReversed)
	r.gw.lookupRes = &provider.RefundResult{Reference: "rf_prev", Status: "processed", AmountKobo: 100_000}
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	if rec := status(t, r, ref); rec.Status != StatusRefunded {
		t.Fatalf("an earlier successful refund exists at the gateway; status %q", rec.Status)
	}
	if r.gw.lookupCalls == 0 {
		t.Error("'already reversed' must be VERIFIED via the gateway, not trusted")
	}
}

func TestRefund_AlreadyReversed_ButLookupSaysFailed_IsNotRefunded(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	underpaid(r)
	r.gw.refundErr = fmt.Errorf("paystack: refund: %w", provider.ErrAlreadyReversed)
	r.gw.lookupRes = &provider.RefundResult{Reference: "rf_bad", Status: "failed"}
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	rec := status(t, r, ref)
	if rec.Status != StatusAmountMismatch || rec.RefundReference != nil {
		t.Fatalf("a FAILED earlier refund is not a refund: status %q ref=%v", rec.Status, rec.RefundReference)
	}
}

func TestRefund_GatewayReportsFailedStatus_IsNotRefunded(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	underpaid(r)
	r.gw.refundRes = &provider.RefundResult{Reference: "rf_x", Status: "failed", AmountKobo: 100_000}
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	if rec := status(t, r, ref); rec.Status != StatusAmountMismatch || rec.RefundReference != nil {
		t.Fatalf("status %q ref=%v: a refund whose status is 'failed' must not be recorded as refunded", rec.Status, rec.RefundReference)
	}
}

func TestRefund_PendingAndProcessingAreAccepted(t *testing.T) {
	for _, st := range []string{"pending", "processing", "processed"} {
		r := newRig()
		ref := paid(t, r)
		underpaid(r)
		r.gw.refundRes = &provider.RefundResult{Reference: "rf_" + st, Status: st, AmountKobo: 100_000}
		_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
		if rec := status(t, r, ref); rec.Status != StatusRefunded {
			t.Errorf("gateway status %q: want refunded (money is on its way back), got %q", st, rec.Status)
		}
	}
}

func TestRefund_AmbiguousOutcome_StaysRefunding_AndSweeperFinishesWithoutASecondRefund(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	underpaid(r)
	r.gw.refundErr = errors.New("timeout")
	r.gw.lookupErr = errors.New("paystack down") // cannot tell whether the refund happened
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	if rec := status(t, r, ref); rec.Status != StatusRefunding {
		t.Fatalf("status %q: when the outcome is unknowable the intent must stay 'refunding', never be guessed", rec.Status)
	}
	// Paystack recovers and shows the refund. After the stale window the
	// reconciler resolves it by LOOKUP — it must not refund again.
	r.gw.lookupErr = nil
	r.gw.lookupRes = &provider.RefundResult{Reference: "rf_late", Status: "processed", AmountKobo: 100_000}
	calls := len(r.gw.refundCalls)
	r.st.now = func() time.Time { return time.Now().Add(staleClaimAfter + time.Minute) }
	if _, err := r.e.Reconcile(context.Background(), time.Minute, 24*time.Hour); err != nil {
		t.Fatal(err)
	}
	rec := status(t, r, ref)
	if rec.Status != StatusRefunded || rec.RefundReference == nil || *rec.RefundReference != "rf_late" {
		t.Fatalf("sweeper result %q ref=%v", rec.Status, rec.RefundReference)
	}
	if len(r.gw.refundCalls) != calls {
		t.Errorf("sweeper re-issued the gateway refund (%d→%d calls); a refunding retry must verify first", calls, len(r.gw.refundCalls))
	}
}

func TestRefund_GatewayOKButMarkRefundedFails_LeavesRefunding_NotAFalseFailure(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	underpaid(r)
	r.st.markErr[StatusRefunded] = errors.New("db blip")
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	rec := status(t, r, ref)
	if rec.Status != StatusRefunding {
		t.Fatalf("status %q: the customer WAS refunded; the row must stay 'refunding' (resolvable), not revert to a failure status", rec.Status)
	}
	r.gw.lookupRes = &provider.RefundResult{Reference: "rf_" + ref, Status: "processed", AmountKobo: 100_000}
	delete(r.st.markErr, StatusRefunded)
	r.st.now = func() time.Time { return time.Now().Add(staleClaimAfter + time.Minute) }
	if _, err := r.e.Reconcile(context.Background(), time.Minute, 24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if rec := status(t, r, ref); rec.Status != StatusRefunded {
		t.Errorf("after reconcile %q", rec.Status)
	}
	if len(r.gw.refundCalls) != 1 {
		t.Errorf("refund issued %d times, want 1", len(r.gw.refundCalls))
	}
}

func TestRefundExternal_ReplyLost_LookupConfirms_LedgerStillReversed(t *testing.T) {
	r := newRig()
	_ = confirmed(t, r)
	r.gw.refundErr = errors.New("timeout")
	r.gw.lookupRes = &provider.RefundResult{Reference: "rf_c", Status: "processed", AmountKobo: 250_000}
	if err := r.e.RefunderFor("fake").RefundExternalSettlement(context.Background(), "ent-1", "sett-1", "cancelled"); err != nil {
		t.Fatalf("a refund Paystack accepted is a success: %v", err)
	}
	if len(r.lg.calls) != 1 {
		t.Errorf("ledger reversal calls %v", r.lg.calls)
	}
}

func TestRefundExternal_RetryOfRefunding_VerifiesBeforeRefundingAgain(t *testing.T) {
	r := newRig()
	ref := confirmed(t, r)
	// A previous cancel attempt reached 'refunding' and then died.
	rf := r.e.RefunderFor("fake")
	r.gw.refundErr = errors.New("timeout")
	r.gw.lookupErr = errors.New("down")
	if err := rf.RefundExternalSettlement(context.Background(), "ent-1", "sett-1", "x"); err == nil {
		t.Fatal("ambiguous outcome must surface as an error (retryable)")
	}
	if status(t, r, ref).Status != StatusRefunding {
		t.Fatalf("want refunding, got %q", status(t, r, ref).Status)
	}
	// retry after the stale window; Paystack now shows the refund
	r.gw.refundErr, r.gw.lookupErr = nil, nil
	r.gw.lookupRes = &provider.RefundResult{Reference: "rf_done", Status: "processed", AmountKobo: 250_000}
	r.st.now = func() time.Time { return time.Now().Add(staleClaimAfter + time.Minute) }
	calls := len(r.gw.refundCalls)
	if err := rf.RefundExternalSettlement(context.Background(), "ent-1", "sett-1", "x"); err != nil {
		t.Fatal(err)
	}
	if len(r.gw.refundCalls) != calls {
		t.Errorf("retry re-issued the refund instead of verifying it")
	}
	if status(t, r, ref).Status != StatusRefunded {
		t.Errorf("status %q", status(t, r, ref).Status)
	}
}

func TestRefundExternal_ConcurrentRefundInFlight_IsRefusedNotDoubled(t *testing.T) {
	r := newRig()
	ref := confirmed(t, r)
	// someone else holds a FRESH refunding claim
	r.st.byRef[ref].Status = StatusRefunding
	r.st.byRef[ref].ClaimedAt = r.st.now()
	r.st.byRef[ref].RefundFrom = StatusConfirmed
	if err := r.e.RefunderFor("fake").RefundExternalSettlement(context.Background(), "ent-1", "sett-1", "x"); err == nil {
		t.Fatal("a refund already in flight must make this attempt wait (error), not issue a second gateway refund")
	}
	if len(r.gw.refundCalls) != 0 {
		t.Errorf("second concurrent gateway refund issued")
	}
}

// ── H3 ──────────────────────────────────────────────────────────────────────

func TestRefundExternal_SettlementValidatedBeforeTheGateway(t *testing.T) {
	good := func() *settlement.Settlement {
		return &settlement.Settlement{ID: "sett-1", Status: settlement.StatusEscrowed, FundingSource: "external",
			TotalKobo: 250_000, PayerID: "u1", IdempotencyKey: "fakeorder:" + key1}
	}
	cases := map[string]func(*settlement.Settlement){
		"wallet-funded":         func(s *settlement.Settlement) { s.FundingSource = "wallet" },
		"already settled":       func(s *settlement.Settlement) { s.Status = settlement.StatusSettled },
		"refunded, intent not":  func(s *settlement.Settlement) { s.Status = settlement.StatusRefunded },
		"amount differs":        func(s *settlement.Settlement) { s.TotalKobo = 249_999 },
		"other payer":           func(s *settlement.Settlement) { s.PayerID = "someone-else" },
		"other intent's escrow": func(s *settlement.Settlement) { s.IdempotencyKey = "fakeorder:another-key-0001" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			r := newRig()
			_ = confirmed(t, r)
			s := good()
			mutate(s)
			r.lg.setts = map[string]*settlement.Settlement{"sett-1": s}
			if err := r.e.RefunderFor("fake").RefundExternalSettlement(context.Background(), "ent-1", "sett-1", "x"); err == nil {
				t.Fatal("want an error")
			}
			if len(r.gw.refundCalls) != 0 || r.gw.lookupCalls != 0 {
				t.Fatalf("the gateway was touched (refunds=%d lookups=%d) for a settlement that does not back this intent", len(r.gw.refundCalls), r.gw.lookupCalls)
			}
			if len(r.lg.calls) != 0 {
				t.Errorf("ledger reversed for a settlement that failed validation: %v", r.lg.calls)
			}
		})
	}
}

func TestRefundExternal_SettlementLookupFails_NoGatewayCall(t *testing.T) {
	r := newRig()
	_ = confirmed(t, r)
	r.lg.getErr = errors.New("db down")
	if err := r.e.RefunderFor("fake").RefundExternalSettlement(context.Background(), "ent-1", "sett-1", "x"); err == nil {
		t.Fatal("want error")
	}
	if len(r.gw.refundCalls) != 0 {
		t.Error("gateway refunded without being able to read the settlement")
	}
}

func TestRefundExternal_BothAlreadyRefunded_IsANoOp(t *testing.T) {
	r := newRig()
	_ = confirmed(t, r)
	rf := r.e.RefunderFor("fake")
	if err := rf.RefundExternalSettlement(context.Background(), "ent-1", "sett-1", "x"); err != nil {
		t.Fatal(err)
	}
	r.lg.setts = map[string]*settlement.Settlement{"sett-1": {ID: "sett-1", Status: settlement.StatusRefunded, FundingSource: "external",
		TotalKobo: 250_000, PayerID: "u1", IdempotencyKey: "fakeorder:" + key1}}
	calls, ledger := len(r.gw.refundCalls), len(r.lg.calls)
	if err := rf.RefundExternalSettlement(context.Background(), "ent-1", "sett-1", "x"); err != nil {
		t.Fatalf("settlement refunded + intent refunded is done, not an error: %v", err)
	}
	if len(r.gw.refundCalls) != calls || len(r.lg.calls) != ledger {
		t.Error("a completed refund must not touch the gateway or the ledger again")
	}
}

// ── H6 ──────────────────────────────────────────────────────────────────────

func TestOrderFailed_LedgerReversedBeforeGatewayRefund(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	r.d.bookErr = errors.New("insert failed") // Book may have escrowed then failed to reverse itself
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	ev := r.ev.list()
	rev, gw := -1, -1
	for i, e := range ev {
		if e == "ledger.reverseByKey" && rev < 0 {
			rev = i
		}
		if e == "gateway.refund" && gw < 0 {
			gw = i
		}
	}
	if rev < 0 || gw < 0 || rev > gw {
		t.Fatalf("events %v: the external settlement must be reversed ledger-side BEFORE the customer is refunded", ev)
	}
	if len(r.lg.byKey) != 1 || r.lg.byKey[0] != ref+"|card_direct_order_failed" {
		t.Errorf("reverse-by-key calls %v, want one for the namespaced reference", r.lg.byKey)
	}
}

func TestOrderFailed_LedgerReversalFails_NoGatewayRefund_RetriedLater(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	r.d.bookErr = errors.New("insert failed")
	r.lg.byKeyErr = errors.New("ledger down")
	if _, err := r.e.OnChargeSuccess(context.Background(), ref, ref); err == nil {
		t.Fatal("want error")
	}
	if len(r.gw.refundCalls) != 0 {
		t.Fatal("refunded the customer while the books could not be balanced")
	}
	if rec := status(t, r, ref); rec.Status != StatusProcessing {
		t.Errorf("status %q, want processing (stale takeover retries)", rec.Status)
	}
	// ledger recovers; the stale takeover completes the unwind + refund
	r.lg.byKeyErr = nil
	r.st.now = func() time.Time { return time.Now().Add(staleClaimAfter + time.Second) }
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	if rec := status(t, r, ref); rec.Status != StatusRefunded {
		t.Errorf("after recovery %q", rec.Status)
	}
}

func TestAmountMismatch_NeverBooked_NoLedgerReversalNeeded(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	underpaid(r)
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	if len(r.lg.byKey) != 0 {
		t.Errorf("a charge that was never booked has no settlement to reverse: %v", r.lg.byKey)
	}
}
