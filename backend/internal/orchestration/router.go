package orchestration

import "sort"

// Weights are the smart-order-routing score weights (spec §6). Config per
// corridor/tier in the control plane; this struct carries the resolved set.
type Weights struct {
	Cost     float64
	Coverage float64
	Liquidity float64
	Reliability float64
}

// DefaultWeights is the V1 flat weighting.
var DefaultWeights = Weights{Cost: 0.45, Coverage: 0.20, Liquidity: 0.20, Reliability: 0.15}

// Candidate is a provider-scored route option produced during aggregation.
type Candidate struct {
	Provider    string
	Corridor    string
	Rail        Rail
	AllInRate   float64 // customer all-in rate (post spread+fees) for ranking
	Destination Money

	// Raw score inputs in [0,1].
	Cost        float64
	CoverageFit float64
	Liquidity   float64
	Reliability float64

	// Penalties in [0,1].
	FloatCost      float64
	ExposurePenalty float64

	Viable bool
	Note   string
}

// score computes the weighted route score (spec §6).
func (c Candidate) score(w Weights) float64 {
	return w.Cost*c.Cost +
		w.Coverage*c.CoverageFit +
		w.Liquidity*c.Liquidity +
		w.Reliability*c.Reliability -
		c.FloatCost -
		c.ExposurePenalty
}

// Router selects the best viable candidate and ranks the rest.
type Router struct {
	weights Weights
}

// NewRouter builds a router with the given weights (falls back to defaults).
func NewRouter(w Weights) *Router {
	if w == (Weights{}) {
		w = DefaultWeights
	}
	return &Router{weights: w}
}

// RankResult is the ordered output of routing.
type RankResult struct {
	Best         *Candidate
	Alternatives []Candidate
}

// Rank scores all candidates, returns the highest-scoring viable one as Best and
// the remaining viable candidates (descending score) as alternatives.
// Returns Best=nil when no candidate is viable (caller -> routing_unavailable).
func (r *Router) Rank(candidates []Candidate) RankResult {
	scored := make([]Candidate, 0, len(candidates))
	for _, c := range candidates {
		if c.Viable {
			scored = append(scored, c)
		}
	}
	if len(scored) == 0 {
		return RankResult{}
	}
	sort.SliceStable(scored, func(i, j int) bool {
		return scored[i].score(r.weights) > scored[j].score(r.weights)
	})
	best := scored[0]
	return RankResult{Best: &best, Alternatives: scored[1:]}
}

// costCompetitiveness scores a rate against the best rate in the set ([0,1]).
// Higher (better) rate for the customer -> closer to 1.
func costCompetitiveness(rate, bestRate float64) float64 {
	if bestRate <= 0 {
		return 0
	}
	ratio := rate / bestRate
	if ratio > 1 {
		ratio = 1
	}
	if ratio < 0 {
		ratio = 0
	}
	return ratio
}
