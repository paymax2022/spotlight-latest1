package paystackcheckout

// Ledgerless pieces and domain ledger unwinds — the two engine seams parcel
// insurance paid by card needs (ADR-PR837):
//   - a Domain may post ledger legs OUTSIDE settlements (the parcel premium hold);
//     a failed Book must unwind them BEFORE the whole charge is refunded;
//   - a piece of a charge that is not a settlement (the premium) is refunded to
//     the card by the same fenced, lookup-first piece machinery, gateway only —
//     the domain posts its own ledger leg afterwards.

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type unwindDomain struct {
	*fakeDomain
	unwinds   []string
	unwindErr error
}

func (d *unwindDomain) UnwindUnbooked(_ context.Context, payerID, reference string) error {
	d.ev.add("domain.unwind")
	d.unwinds = append(d.unwinds, payerID+"|"+reference)
	return d.unwindErr
}

func newUnwindRig() (*rig, *unwindDomain) {
	r := newRig()
	ud := &unwindDomain{fakeDomain: r.d}
	e := NewEngine(r.gw, r.st, r.lg)
	e.Register(ud)
	r.e = e
	return r, ud
}

func TestOrderFailed_DomainLedgerLegsUnwoundBeforeTheGatewayRefund(t *testing.T) {
	r, ud := newUnwindRig()
	ref := paid(t, r)
	r.d.bookErr = errors.New("insert failed")
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	unwind, gw := -1, -1
	for i, e := range r.ev.list() {
		if e == "domain.unwind" && unwind < 0 {
			unwind = i
		}
		if e == "gateway.refund" && gw < 0 {
			gw = i
		}
	}
	if unwind < 0 || gw < 0 || unwind > gw {
		t.Fatalf("events %v: the domain's own ledger legs must be unwound BEFORE the customer is refunded", r.ev.list())
	}
	if len(ud.unwinds) != 1 || ud.unwinds[0] != "u1|"+ref {
		t.Fatalf("unwinds %v", ud.unwinds)
	}
}

func TestOrderFailed_DomainUnwindFails_NoGatewayRefund(t *testing.T) {
	r, ud := newUnwindRig()
	ref := paid(t, r)
	r.d.bookErr = errors.New("insert failed")
	ud.unwindErr = errors.New("ledger down")
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	if len(r.gw.refundCalls) != 0 {
		t.Fatal("refunded the customer while the domain's ledger legs could not be unwound")
	}
	if rec := status(t, r, ref); rec.Status != StatusProcessing {
		t.Fatalf("status %q, want processing (retried)", rec.Status)
	}
	ud.unwindErr = nil
	r.st.now = func() time.Time { return time.Now().Add(staleClaimAfter + time.Second) }
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	if rec := status(t, r, ref); rec.Status != StatusRefunded {
		t.Fatalf("after recovery %q", rec.Status)
	}
}

func TestReconcile_StrandedOrderFailed_UnwindsDomainLegsToo(t *testing.T) {
	r, ud := newUnwindRig()
	ref := paid(t, r)
	r.d.bookErr = errors.New("insert failed")
	r.gw.pErr = nil
	r.gw.refundErr = errors.New("gateway down") // definite: no lookup hit → order_failed restored
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	before := len(ud.unwinds)
	r.gw.refundErr = nil
	r.st.now = func() time.Time { return time.Now().Add(time.Hour) }
	if _, err := r.e.Reconcile(context.Background(), time.Minute, 0); err != nil {
		t.Fatal(err)
	}
	if len(ud.unwinds) <= before {
		t.Fatal("the reconciler's order_failed refund must re-assert the domain unwind before refunding")
	}
}

// confirmedPieceRig: a confirmed 250_000 charge for entity ent-1 with piece
// refunds enabled.
func confirmedPieceRig(t *testing.T) (*rig, string) {
	t.Helper()
	r := newRig()
	r.e.EnablePartialRefunds(r.gw, r.st)
	ref := paid(t, r)
	if res, err := r.e.OnChargeSuccess(context.Background(), ref, ref); err != nil || res.Status != StatusConfirmed {
		t.Fatalf("confirm: %+v %v", res, err)
	}
	return r, ref
}

func pieceRefunder(r *rig) interface {
	RefundExternalPiece(ctx context.Context, entityID, pieceKey string, amountKobo int64) error
} {
	return r.e.RefunderFor("fake").(interface {
		RefundExternalPiece(ctx context.Context, entityID, pieceKey string, amountKobo int64) error
	})
}

func TestRefundExternalPiece_RefundsTheExactAmountToTheCard_Once_GatewayOnly(t *testing.T) {
	r, ref := confirmedPieceRig(t)
	pr := pieceRefunder(r)
	for i := 0; i < 2; i++ {
		if err := pr.RefundExternalPiece(context.Background(), "ent-1", "piece:premium", 50_000); err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}
	if len(r.gw.pCalls) != 1 || r.gw.pCalls[0].Amt != 50_000 || r.gw.pCalls[0].Ref != ref || r.gw.pCalls[0].Note != ref+"#piece:premium" {
		t.Fatalf("gateway piece refunds %+v, want one of 50000 noted %s#piece:premium", r.gw.pCalls, ref)
	}
	if len(r.lg.calls) != 0 || len(r.lg.byKey) != 0 {
		t.Fatalf("a ledgerless piece must not touch settlements: %v %v", r.lg.calls, r.lg.byKey)
	}
	rec := status(t, r, ref)
	if rec.Status != StatusConfirmed || rec.RefundedKobo != 50_000 {
		t.Fatalf("intent %s refunded=%d, want confirmed with 50000 refunded", rec.Status, rec.RefundedKobo)
	}
}

func TestRefundExternalPiece_RefusesAKeyThatIsNotLedgerless_AndAnOverCap(t *testing.T) {
	r, _ := confirmedPieceRig(t)
	pr := pieceRefunder(r)
	if err := pr.RefundExternalPiece(context.Background(), "ent-1", "fare", 1_000); err == nil || !strings.Contains(err.Error(), "piece:") {
		t.Fatalf("a settlement-shaped key must be refused, got %v", err)
	}
	if err := pr.RefundExternalPiece(context.Background(), "ent-1", "piece:premium", 250_001); !errors.Is(err, ErrPartialCapExceeded) {
		t.Fatalf("over the collected amount: want ErrPartialCapExceeded, got %v", err)
	}
	if err := pr.RefundExternalPiece(context.Background(), "ent-1", "piece:premium", 0); err == nil {
		t.Fatal("a non-positive piece must be refused")
	}
	if len(r.gw.pCalls) != 0 {
		t.Fatalf("refused pieces reached the gateway: %+v", r.gw.pCalls)
	}
}

func TestRefundExternalPiece_FailsClosedWithoutPartialRefunds(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	if _, err := r.e.OnChargeSuccess(context.Background(), ref, ref); err != nil {
		t.Fatal(err)
	}
	if err := pieceRefunder(r).RefundExternalPiece(context.Background(), "ent-1", "piece:premium", 1_000); !errors.Is(err, ErrPartialRefundsUnsupported) {
		t.Fatalf("want ErrPartialRefundsUnsupported, got %v", err)
	}
}

func TestReconcile_StrandedLedgerlessPiece_ResolvedAtTheGatewayWithoutSettlements(t *testing.T) {
	r, ref := confirmedPieceRig(t)
	// The first attempt's reply was lost after the gateway accepted it.
	r.gw.pErr, r.gw.pAcceptOnErr = errors.New("timeout"), true
	_ = pieceRefunder(r).RefundExternalPiece(context.Background(), "ent-1", "piece:premium", 50_000)
	r.gw.pErr, r.gw.pAcceptOnErr = nil, false
	hits := r.lg.getHits
	r.st.now = func() time.Time { return time.Now().Add(time.Hour) }
	if _, err := r.e.Reconcile(context.Background(), time.Minute, 0); err != nil {
		t.Fatal(err)
	}
	row, _ := r.st.GetPartial(context.Background(), ref, "piece:premium")
	if row == nil || row.Status != PartialRefunded {
		t.Fatalf("stranded premium piece %+v, want refunded (found by lookup)", row)
	}
	if len(r.gw.pCalls) != 1 {
		t.Fatalf("gateway refunds %d, want 1 (the sweep must never re-POST an accepted refund)", len(r.gw.pCalls))
	}
	if r.lg.getHits != hits || len(r.lg.calls) != 0 {
		t.Fatal("a ledgerless piece has no settlement: the sweep must not load or reverse one")
	}
}

// A parcel booker that cannot unwind a premium hold must BLOCK the whole-charge
// refund (it may have held a premium the refund would strand), never pass.
func TestParcelDomain_UnwindFailsClosedWithoutAnUnwinder(t *testing.T) {
	d := NewParcelDomain(&fakeParcels{})
	if err := d.UnwindUnbooked(context.Background(), "u1", "parcelorder-k"); err == nil {
		t.Fatal("want an error: the booker cannot unwind a premium hold")
	}
}
