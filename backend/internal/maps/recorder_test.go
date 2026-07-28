package maps

import (
	"testing"
	"time"
)

// recorder_test.go — pure event-row mapping + deflection-rate math (§9, MS-7).

func TestRecordArgsMapping(t *testing.T) {
	ts := time.Date(2026, 6, 27, 10, 0, 0, 0, time.UTC)
	e := ResolutionEvent{
		RequestType:  "geocode",
		Surface:      "delivery",
		H3Cell:       "s1z2g3",
		Tier:         TierLow,
		ChosenSource: "google",
		Provider:     "google",
		Confidence:   0.82,
		Escalated:    true,
		CostUnit:     1,
		OutcomePin:   false,
		UserID:       "user-123",
		TS:           ts,
	}
	args := recordArgs(e)
	if len(args) != len(resolutionInsertCols) {
		t.Fatalf("arg count %d != column count %d", len(args), len(resolutionInsertCols))
	}
	want := []any{
		"geocode", "delivery", "s1z2g3", "LOW", "google",
		"google", 0.82, true, 1, false, "user-123", ts,
	}
	for i := range want {
		if args[i] != want[i] {
			t.Errorf("arg[%d] (%s) = %#v, want %#v", i, resolutionInsertCols[i], args[i], want[i])
		}
	}
}

func TestRecordArgsNullableAndDefaultTS(t *testing.T) {
	// Empty optional fields become nil (→ SQL NULL); zero TS is defaulted to now.
	e := ResolutionEvent{RequestType: "reverse", ChosenSource: "gazetteer"}
	args := recordArgs(e)

	// surface(1), h3(2), tier(3), provider(5), user_id(10) should be nil.
	for _, i := range []int{1, 2, 3, 5, 10} {
		if args[i] != nil {
			t.Errorf("arg[%d] (%s) should be nil for empty value, got %#v", i, resolutionInsertCols[i], args[i])
		}
	}
	// Required fields preserved.
	if args[0] != "reverse" {
		t.Errorf("request_type = %#v", args[0])
	}
	if args[4] != "gazetteer" {
		t.Errorf("chosen_source = %#v", args[4])
	}
	// ts (last arg) must be a non-zero time.
	ts, ok := args[len(args)-1].(time.Time)
	if !ok || ts.IsZero() {
		t.Fatalf("ts should default to a non-zero time, got %#v", args[len(args)-1])
	}
}

func TestDeflectionRate(t *testing.T) {
	cases := []struct {
		name      string
		paid      int64
		deflected int64
		want      float64
	}{
		{"no traffic", 0, 0, 0},
		{"all deflected", 0, 10, 1.0},
		{"all paid", 10, 0, 0.0},
		{"half", 5, 5, 0.5},
		{"mostly deflected", 1, 9, 0.9},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := DeflectionStats{Paid: tc.paid, Deflected: tc.deflected}
			if got := s.DeflectionRate(); got != tc.want {
				t.Fatalf("DeflectionRate() = %v, want %v", got, tc.want)
			}
		})
	}
}
