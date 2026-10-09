package fractionalre

import (
	"errors"
	"math"
	"strings"
	"testing"
)

// TestMulKobo checks the checked integer-kobo multiply used on every money
// path: units*price and amount*feeBps must never wrap into a small positive
// number that sails through the ticket-range and cap checks.
func TestMulKobo(t *testing.T) {
	cases := []struct {
		name    string
		a, b    int64
		want    int64
		wantErr bool
	}{
		{"normal", 50, 100_000, 5_000_000, false},
		{"one", 1, 1, 1, false},
		{"zero operand", 0, 100, 0, true},
		{"negative operand", -5, 100, 0, true},
		{"negative price", 5, -100, 0, true},
		{"overflow wraps negative", math.MaxInt64, 2, 0, true},
		{"overflow wraps small positive", math.MaxInt64/4 + 1, 8, 0, true},
		{"boundary ok", math.MaxInt64 / 1000, 1000, math.MaxInt64 / 1000 * 1000, false},
		{"boundary over", math.MaxInt64/1000 + 1, 1000, 0, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := mulKobo(tc.a, tc.b)
			if tc.wantErr {
				if !errors.Is(err, ErrAmountOverflow) {
					t.Fatalf("mulKobo(%d,%d) = %v, %v — want ErrAmountOverflow", tc.a, tc.b, got, err)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("mulKobo(%d,%d) = %d, %v — want %d", tc.a, tc.b, got, err, tc.want)
			}
		})
	}
}

// TestMulDivKobo covers the pro-rata helper (a*b/c) used by fee computation and
// distribution line splits: the multiply is checked before the divide so a
// wrap can't shrink a fee or payout line.
func TestMulDivKobo(t *testing.T) {
	cases := []struct {
		name      string
		a, b, c   int64
		want      int64
		wantErrIs error
	}{
		{"fee 1% of 5m", 5_000_000, 100, 10000, 50_000, nil},
		{"truncates toward zero", 100, 1, 3, 33, nil},
		{"zero numerator", 0, 500, 7, 0, nil},
		{"zero divisor", 100, 1, 0, 0, ErrAmountOverflow},
		{"negative divisor", 100, 1, -3, 0, ErrAmountOverflow},
		{"mul overflow", math.MaxInt64, 2, 3, 0, ErrAmountOverflow},
		{"mul overflow before div", math.MaxInt64 / 2, 3, 2, 0, ErrAmountOverflow},
		{"large but safe", math.MaxInt64 / 10000, 10000, 10000, math.MaxInt64 / 10000, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := mulDivKobo(tc.a, tc.b, tc.c)
			if tc.wantErrIs != nil {
				if !errors.Is(err, tc.wantErrIs) {
					t.Fatalf("mulDivKobo(%d,%d,%d) = %d, %v — want %v", tc.a, tc.b, tc.c, got, err, tc.wantErrIs)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("mulDivKobo(%d,%d,%d) = %d, %v — want %d", tc.a, tc.b, tc.c, got, err, tc.want)
			}
		})
	}
}

// TestScopedIdemKey pins the per-actor key namespace: a client's key must never
// collide with another user's identical key, another module's identical key, or
// a raw unset prefix in the shared UNIQUE indexes.
func TestScopedIdemKey(t *testing.T) {
	a := scopedIdemKey("user-a", "key-1")
	b := scopedIdemKey("user-b", "key-1")
	if a == b {
		t.Fatal("same client key must scope to different keys for different users")
	}
	if !strings.HasPrefix(a, "fractionalre:user-a:") || !strings.HasSuffix(a, "key-1") {
		t.Fatalf("scoped key must be module:user:key, got %q", a)
	}
	if scopedIdemKey("user-a", "key-1") != a {
		t.Fatal("scoped key must be deterministic for replay")
	}
}
