package top5events

import (
	"context"
	"errors"
	"testing"
)

func TestDupScanSeverity(t *testing.T) {
	cases := []struct {
		rejects, gates int
		want           string
	}{
		{2, 1, "low"},
		{3, 1, "medium"},
		{2, 2, "medium"},
		{2, 3, "high"},
		{6, 1, "high"},
	}
	for _, c := range cases {
		if got := dupScanSeverity(c.rejects, c.gates); got != c.want {
			t.Errorf("dupScanSeverity(%d, %d) = %q, want %q", c.rejects, c.gates, got, c.want)
		}
	}
}

// Validation runs before any DB access, so a zero Service is enough.
func TestAdminActionFraudSignal_ValidatesBeforeTouchingDB(t *testing.T) {
	s := &Service{}
	ctx := context.Background()
	for _, tc := range []struct{ action, note string }{
		{"delete", "x"},
		{"", "x"},
		{"clear", ""},
		{"block", "   "},
	} {
		if _, err := s.AdminActionFraudSignal(ctx, "actor", "dup_scan:x", tc.action, tc.note); !errors.Is(err, ErrValidation) {
			t.Errorf("action %q note %q: err = %v, want ErrValidation", tc.action, tc.note, err)
		}
	}
}
