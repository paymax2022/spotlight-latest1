package restaurant

import (
	"strings"
	"testing"
	"time"
)

// TestFormatInterval proves the pure grace-window→Postgres-interval mapping the
// stuck-settlement selection predicate depends on, without a database. A wrong
// literal here would silently widen or void the grace window on a money path.
func TestFormatInterval(t *testing.T) {
	cases := []struct {
		name string
		in   time.Duration
		want string
	}{
		{"ten minutes", 10 * time.Minute, "600 seconds"},
		{"five minutes", 5 * time.Minute, "300 seconds"},
		{"one second", time.Second, "1 seconds"},
		{"sub-second truncates to zero", 500 * time.Millisecond, "0 seconds"},
		{"zero", 0, "0 seconds"},
		{"negative clamps to zero", -time.Minute, "0 seconds"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := formatInterval(c.in); got != c.want {
				t.Fatalf("formatInterval(%s) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

// TestStuckSettlementSelect_Predicate documents the money-path invariants the
// crash-recovery SQL must hold: it selects ONLY delivered orders whose escrow is
// still held (non-terminal), scoped to this module, and only past the grace
// window. If any of these guards is dropped the reconciler could double-pay or
// race a live delivery — so pin them.
func TestStuckSettlementSelect_Predicate(t *testing.T) {
	q := stuckSettlementSelect
	for _, must := range []string{
		"o.status = 'delivered'",   // only terminal (delivered) orders
		"s.status = 'escrowed'",    // only still-held escrow (idempotent re-drive target)
		"module_type = 'food_delivery'", // scoped to this module's settlements
		"escrowed_at < NOW() - $1::interval", // grace window
	} {
		if !strings.Contains(q, must) {
			t.Fatalf("stuck-settlement predicate missing guard %q", must)
		}
	}
}
