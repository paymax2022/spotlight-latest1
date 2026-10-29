package adapters

import "testing"

func TestApplyLongStayDiscount(t *testing.T) {
	cases := []struct {
		name                   string
		total                  int64
		nights, minNights, pct int
		want                   int64
	}{
		{"no rule", 100_000, 7, 0, 0, 100_000},
		{"rule set, zero percent", 100_000, 7, 3, 0, 100_000},
		{"below threshold", 100_000, 2, 3, 10, 100_000},
		{"at threshold", 100_000, 3, 3, 10, 90_000},
		{"above threshold", 300_000, 5, 3, 10, 270_000},
		{"rounds half up", 1_005, 4, 2, 50, 502},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := applyLongStayDiscount(c.total, c.nights, c.minNights, c.pct); got != c.want {
				t.Fatalf("applyLongStayDiscount(%d, %d, %d, %d) = %d, want %d", c.total, c.nights, c.minNights, c.pct, got, c.want)
			}
		})
	}
}
