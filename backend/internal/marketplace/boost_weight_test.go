package marketplace

import "testing"

func TestMaxBoostWeight(t *testing.T) {
	// weights mirror the frozen values a real purchase would have stamped onto
	// the row (see ComputeBoostQuote / PurchaseBoost) — maxBoostWeight reads
	// Boost.Weight directly, it no longer looks a tier name up against a
	// catalog, so a boost with no recognized tier still contributes whatever
	// weight was actually frozen on it (here: 0, i.e. "not boosted").
	cases := []struct {
		name    string
		weights []float64
		want    float64
	}{
		{"no boosts", nil, 0},
		{"single start", []float64{1.0}, 1.0},
		{"single diamond", []float64{5.0}, 5.0},
		{"stacked takes the strongest, not the sum", []float64{1.0, 2.0, 3.0}, 3.0},
		{"zero-weight row contributes nothing", []float64{0}, 0},
		{"zero-weight mixed with weighted", []float64{0, 2.0}, 2.0},
		{"enterprise is the ceiling", []float64{8.0, 5.0}, 8.0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			boosts := make([]Boost, len(c.weights))
			for i, w := range c.weights {
				boosts[i] = Boost{Weight: w}
			}
			if got := maxBoostWeight(boosts); got != c.want {
				t.Fatalf("maxBoostWeight(%v)=%v, want %v", c.weights, got, c.want)
			}
		})
	}
}
