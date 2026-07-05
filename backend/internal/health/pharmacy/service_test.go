package healthpharmacy

// Unit tests for the optional symptom-search review-case seam (PRD §10). The
// seam must be a strict no-op when no opener is wired (symptom-search flag
// off) and must never let an opener failure break an already-held order.

import (
	"context"
	"fmt"
	"testing"
)

type recordingOpener struct {
	calls         int
	actorID       string
	orderID       string
	providerID    string
	searchEventID *string
	rxRequired    bool
	err           error
}

func (r *recordingOpener) OpenReviewCaseForOrder(_ context.Context, actorID, orderID, pharmacyProviderID string, searchEventID *string, rxRequired bool) error {
	r.calls++
	r.actorID = actorID
	r.orderID = orderID
	r.providerID = pharmacyProviderID
	r.searchEventID = searchEventID
	r.rxRequired = rxRequired
	return r.err
}

// Flag off ⇒ no opener wired ⇒ nil ⇒ no-op (must not panic, no side effects).
func TestOpenReviewCase_NilOpenerIsNoOp(t *testing.T) {
	s := &Service{} // nothing injected — mirrors FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED=false
	s.openReviewCase(context.Background(), "patient-1", "order-1", "prov-1", nil, true)
}

func TestOpenReviewCase_ForwardsOrderContext(t *testing.T) {
	rec := &recordingOpener{}
	s := &Service{}
	s.SetReviewCaseOpener(rec)
	sid := "ev-1"
	s.openReviewCase(context.Background(), "patient-1", "order-1", "prov-1", &sid, true)
	if rec.calls != 1 {
		t.Fatalf("opener must be invoked exactly once, got %d", rec.calls)
	}
	if rec.actorID != "patient-1" || rec.orderID != "order-1" || rec.providerID != "prov-1" {
		t.Fatalf("opener received wrong identifiers: %+v", rec)
	}
	if rec.searchEventID == nil || *rec.searchEventID != "ev-1" || !rec.rxRequired {
		t.Fatalf("opener must receive the search context + rx flag: %+v", rec)
	}
}

// An opener failure is audited (nil-safe) and swallowed — the paid order stands.
func TestOpenReviewCase_ErrorDoesNotPanicOrPropagate(t *testing.T) {
	rec := &recordingOpener{err: fmt.Errorf("review store down")}
	s := &Service{}
	s.SetReviewCaseOpener(rec)
	s.openReviewCase(context.Background(), "patient-1", "order-1", "prov-1", nil, true)
	if rec.calls != 1 {
		t.Fatalf("opener must still be invoked, got %d calls", rec.calls)
	}
}
