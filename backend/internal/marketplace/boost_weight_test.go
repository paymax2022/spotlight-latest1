package marketplace

import "testing"

func TestMaxBoostWeight(t *testing.T) {
	cases := []struct {
		name   string
		tiers  []string
		want   float64
	}{
		{"no boosts", nil, 0},
		{"single start", []string{"start"}, 1.0},
		{"single diamond", []string{"diamond"}, 5.0},
		{"stacked takes the strongest, not the sum", []string{"start", "vip", "vip_gold"}, 3.0},
		{"unknown tier contributes nothing", []string{"mystery"}, 0},
		{"unknown mixed with known", []string{"mystery", "vip"}, 2.0},
		{"enterprise is the ceiling", []string{"enterprise", "diamond"}, 8.0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			boosts := make([]Boost, len(c.tiers))
			for i, tr := range c.tiers {
				boosts[i] = Boost{Tier: tr}
			}
			if got := maxBoostWeight(boosts); got != c.want {
				t.Fatalf("maxBoostWeight(%v)=%v, want %v", c.tiers, got, c.want)
			}
		})
	}
}
