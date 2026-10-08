package paystackcheckout

// Round-2 ledger-audit pins that need the real adapters / PGStore:
//   L-f  the refund-domain strings transport files refunds under equal each
//        adapter's Name() (a mismatch ⇒ "no refunder wired" or a wrong-adapter refund)
//   M2   the reconciler drives a cancelled booking's stranded card refund end to end
//   M3   one open mover checkout per job, enforced in SQL

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/transport"
)

func TestRefundDomainStringsEqualEveryAdapterName(t *testing.T) {
	for _, c := range []struct {
		refundDomain string
		d            Domain
	}{
		{transport.RefundDomainParcel, NewParcelDomain(nil)},
		{transport.RefundDomainTowing, NewTowingDomain(nil)},
		{transport.RefundDomainMovers, NewMoversDomain(nil)},
	} {
		if c.refundDomain != c.d.Name() {
			t.Errorf("transport files %q refunds but the adapter registers its refunder as %q — cancel would fail closed (no refunder) or hit the wrong adapter",
				c.refundDomain, c.d.Name())
		}
	}
	// and the exported adapter consts are the same strings
	if ParcelDomainName != transport.RefundDomainParcel || TowingDomainName != transport.RefundDomainTowing || MoversDomainName != transport.RefundDomainMovers {
		t.Error("adapter domain-name constants drifted from transport.RefundDomain*")
	}
}

type sweepBooker struct {
	*fakeTowing
	gotDomain string
	gotAge    time.Duration
}

func (s *sweepBooker) SweepCancelledCardRefunds(_ context.Context, domain string, minAge time.Duration, _ int) (transport.CancelSweepResult, error) {
	s.gotDomain, s.gotAge = domain, minAge
	return transport.CancelSweepResult{Completed: 3, Failed: 1}, nil
}

func TestEveryAdapterIsACancelledRefundSweeper_AndFilesItUnderItsOwnDomain(t *testing.T) {
	var _ CancelledRefundSweeper = ParcelDomain{}
	var _ CancelledRefundSweeper = TowingDomain{}
	var _ CancelledRefundSweeper = MoversDomain{}

	b := &sweepBooker{fakeTowing: &fakeTowing{}}
	res, err := NewTowingDomain(b).SweepCancelledRefunds(context.Background(), 5*time.Minute, 10)
	if err != nil || res.Completed != 3 || res.Failed != 1 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if b.gotDomain != TowingDomainName || b.gotAge != 5*time.Minute {
		t.Errorf("swept domain %q age %v", b.gotDomain, b.gotAge)
	}
	// A booker with no sweep support simply has nothing to sweep.
	if res, err := NewTowingDomain(&fakeTowing{}).SweepCancelledRefunds(context.Background(), 0, 10); err != nil || res != (CancelSweepResult{}) {
		t.Errorf("res=%+v err=%v", res, err)
	}
}

// ── M2 end to end ───────────────────────────────────────────────────────────

func TestLiveDB_Reconcile_CancelledTowingWithFailedGatewayRefund_IsRefundedBySweep(t *testing.T) {
	r := newTowingLiveRig(t, nil)
	ctx := context.Background()
	key := "cdtow-sw-" + uuid.New().String()
	co, err := r.e.Initiate(ctx, "towing", r.sender, json.RawMessage(liveTowingBody), key, "a@b.test", "")
	if err != nil {
		t.Fatal(err)
	}
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo, Currency: "NGN"}
	res, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference)
	if err != nil || res.EntityID == nil {
		t.Fatalf("confirm: %+v %v", res, err)
	}
	jobID := *res.EntityID

	// The gateway refund fails at cancel time: the job IS cancelled, the money is
	// NOT back, and the answer says so.
	r.gw.refundErr = provider.ErrRefundFailed
	out, err := r.svc.CancelTowingWithRefund(ctx, jobID, r.sender, "changed_mind")
	if err != nil || out.RefundStatus != transport.RefundStatusPending {
		t.Fatalf("cancel = %+v, %v; want refund_status=pending", out, err)
	}
	var sStatus string
	_ = r.pool.QueryRow(ctx, `SELECT s.status FROM towing_jobs j JOIN settlements s ON s.id=j.settlement_id WHERE j.id=$1`, jobID).Scan(&sStatus)
	if sStatus != "escrowed" {
		t.Fatalf("settlement %s, want escrowed (stranded)", sStatus)
	}

	// The customer never re-POSTs. The gateway recovers; the sweeper finishes it.
	r.gw.refundErr = nil
	st, err := r.e.Reconcile(ctx, 0, 7*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if st.CancelRefundsCompleted < 1 {
		t.Fatalf("stats %+v: the stranded cancelled refund was not driven", st)
	}
	_ = r.pool.QueryRow(ctx, `SELECT s.status FROM towing_jobs j JOIN settlements s ON s.id=j.settlement_id WHERE j.id=$1`, jobID).Scan(&sStatus)
	rec, _ := NewPGStore(r.pool).Get(ctx, co.Reference)
	if sStatus != "refunded" || rec.Status != StatusRefunded {
		t.Errorf("settlement=%s intent=%s, want both refunded", sStatus, rec.Status)
	}
	if bal := r.walletBalance(t); bal != 0 {
		t.Errorf("wallet %d: card money must go back to the card", bal)
	}
	// exactly one successful gateway refund of the exact amount, and a second
	// sweep does nothing
	okRefunds := 0
	for _, a := range r.gw.refundCalls {
		if a == co.AmountKobo {
			okRefunds++
		}
	}
	if okRefunds != 2 { // one failed at cancel time, one that succeeded
		t.Errorf("gateway refund calls %v, want the failed attempt + one successful", r.gw.refundCalls)
	}
	n := len(r.gw.refundCalls)
	if _, err := r.e.Reconcile(ctx, 0, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if len(r.gw.refundCalls) != n {
		t.Errorf("a completed refund was sent to the gateway again: %v", r.gw.refundCalls)
	}
}

// ── M3 ──────────────────────────────────────────────────────────────────────

func TestLiveDB_PGStore_OneOpenMoverCheckoutPerJob_EnforcedInSQL(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	st := NewPGStore(pool)
	payer := uuid.NewString()
	job := uuid.NewString()
	put := func(status string) (Intent, error) {
		key := "mvopen-" + uuid.NewString()
		in := Intent{Domain: "movers", Reference: "moversorder:" + key, PayerID: payer, AmountKobo: 100_000, IdempotencyKey: key,
			RequestJSON: json.RawMessage(fmt.Sprintf(`{"job_id":%q,"bid_id":%q}`, job, uuid.NewString()))}
		_, inserted, err := st.Put(ctx, in)
		if err == nil && !inserted {
			err = errors.New("not inserted")
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM transport_paystack_intents WHERE reference=$1`, in.Reference)
		})
		return in, err
	}
	first, err := put("pending")
	if err != nil {
		t.Fatal(err)
	}
	_, err = put("pending")
	ce, ok := errors.AsType[*transport.CodedError](err)
	if !ok || ce.Status != 409 || ce.Code != "checkout_in_progress" {
		t.Fatalf("a second open checkout for one job must be a coded 409 checkout_in_progress, got %v", err)
	}
	// other job / other domain is independent
	other := Intent{Domain: "movers", Reference: "moversorder:mvother-" + uuid.NewString(), PayerID: payer, AmountKobo: 1, IdempotencyKey: "mvother-" + uuid.NewString(),
		RequestJSON: json.RawMessage(fmt.Sprintf(`{"job_id":%q}`, uuid.NewString()))}
	if _, ins, err := st.Put(ctx, other); err != nil || !ins {
		t.Fatalf("a different job must not conflict: %v %v", ins, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM transport_paystack_intents WHERE reference=$1`, other.Reference)
	})

	// once the first is terminal (confirmed) the slot frees up
	fence, ok2, err := st.Claim(ctx, first.Reference, staleClaimAfter)
	if err != nil || !ok2 {
		t.Fatal(err)
	}
	ent := "mover-" + uuid.NewString()
	if applied, err := st.Mark(ctx, first.Reference, Transition{From: StatusProcessing, To: StatusConfirmed, Fence: fence, EntityID: &ent}); err != nil || !applied {
		t.Fatalf("confirm: %v %v", applied, err)
	}
	if _, err := put("pending"); err != nil {
		t.Errorf("a confirmed intent must free the job's slot: %v", err)
	}
}
