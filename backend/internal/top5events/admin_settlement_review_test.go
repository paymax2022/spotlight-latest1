package top5events

import (
	"context"
	"errors"
	"testing"
)

func TestBreakStatus_ReviewAppliesOnlyToTheDeltaItSaw(t *testing.T) {
	reviews := map[string]settlementReview{"set_a": {status: "resolved", breakKobo: 700}}
	if got := breakStatus("set_a", 700, reviews); got != "resolved" {
		t.Errorf("same delta: %q, want resolved", got)
	}
	if got := breakStatus("set_a", 800, reviews); got != "open" {
		t.Errorf("moved delta: %q, want open", got)
	}
	if got := breakStatus("set_b", 700, reviews); got != "open" {
		t.Errorf("unreviewed: %q, want open", got)
	}
	if !breakIsOpen("investigating") || breakIsOpen("resolved") || breakIsOpen("reconciled") {
		t.Error("breakIsOpen: only open and investigating count as open")
	}
}

// Validation runs before any DB access, so a zero Service is enough.
func TestAdminResolveSettlementBreak_ValidatesBeforeTouchingDB(t *testing.T) {
	s := &Service{}
	for _, tc := range []struct{ action, note string }{
		{"settle", "x"},
		{"", "x"},
		{"resolve", ""},
		{"reconcile", "  "},
	} {
		if _, err := s.AdminResolveSettlementBreak(context.Background(), "actor", "set_x", tc.action, tc.note); !errors.Is(err, ErrValidation) {
			t.Errorf("action %q note %q: err = %v, want ErrValidation", tc.action, tc.note, err)
		}
	}
}
