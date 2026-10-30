package healthvet

import (
	"errors"
	"net/http"
	"testing"
)

// The payout decision guards run before any DB access (nil-dependency Service):
// a fallthrough would nil-pointer panic rather than merely fail.
func TestAdminDecidePayout_Guards(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/payouts/:id/decision", h.AdminDecidePayout)

	if w := postJSON(t, r, "/payouts/not-a-uuid/decision", `{"decision":"approve"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("bad id: status %d, want 400", w.Code)
	}
	// No Idempotency-Key header (postJSON never sets one).
	if w := postJSON(t, r, "/payouts/"+uuidOK+"/decision", `{"decision":"approve"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("missing key: status %d, want 400", w.Code)
	}
}

func TestAdminDecidePayout_RejectsUnknownDecisionBeforeDB(t *testing.T) {
	s := &Service{}
	if _, err := s.AdminDecidePayout(t.Context(), uuidOK, uuidOK, "pay_now", "", "k1"); !errors.Is(err, ErrPayoutBadDecision) {
		t.Fatalf("err = %v, want ErrPayoutBadDecision", err)
	}
	if _, err := s.AdminDecidePayout(t.Context(), uuidOK, uuidOK, "approve", "", ""); err == nil {
		t.Fatal("empty idempotency key must be refused")
	}
}

func TestStoredToPayoutStatus(t *testing.T) {
	for in, want := range map[string]string{"APPROVED": "approved", "REJECTED": "rejected", "KYC_HOLD": "kyc_hold", "": "pending"} {
		if got := storedToPayoutStatus(in); got != want {
			t.Fatalf("%q → %q, want %q", in, got, want)
		}
	}
}
