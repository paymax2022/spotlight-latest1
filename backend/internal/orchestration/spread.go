package orchestration

import "strings"

// SpreadRule is a configurable markup for a corridor × customer-tier (spec §9).
// Spread is expressed in basis points over the provider all-in rate, with an
// optional fixed component and min/max guards.
type SpreadRule struct {
	Corridor string // "" matches any corridor (default rule)
	Tier     string // "" matches any tier
	BPS      int
	FixedMinor int64
	MinBPS   int
	MaxBPS   int
}

// SpreadEngine resolves the effective spread for a corridor/tier and applies it.
type SpreadEngine struct {
	rules      []SpreadRule
	defaultBPS int
}

// NewSpreadEngine builds an engine with a flat default and optional overrides.
func NewSpreadEngine(defaultBPS int, rules ...SpreadRule) *SpreadEngine {
	return &SpreadEngine{rules: rules, defaultBPS: defaultBPS}
}

// resolve picks the most specific matching rule (corridor+tier > corridor > tier > default).
func (e *SpreadEngine) resolve(corridor, tier string) SpreadRule {
	corridor, tier = strings.ToUpper(corridor), strings.ToLower(tier)
	var best *SpreadRule
	bestScore := -1
	for i := range e.rules {
		r := e.rules[i]
		score := 0
		if r.Corridor != "" {
			if strings.ToUpper(r.Corridor) != corridor {
				continue
			}
			score += 2
		}
		if r.Tier != "" {
			if strings.ToLower(r.Tier) != tier {
				continue
			}
			score++
		}
		if score > bestScore {
			bestScore = score
			rr := r
			best = &rr
		}
	}
	if best == nil {
		return SpreadRule{BPS: e.defaultBPS, MinBPS: 0, MaxBPS: e.defaultBPS * 4}
	}
	return *best
}

// EffectiveBPS returns the guarded spread in basis points for a corridor/tier.
func (e *SpreadEngine) EffectiveBPS(corridor, tier string) int {
	r := e.resolve(corridor, tier)
	bps := r.BPS
	if r.MaxBPS > 0 && bps > r.MaxBPS {
		bps = r.MaxBPS
	}
	if bps < r.MinBPS {
		bps = r.MinBPS
	}
	return bps
}

// FixedMinor returns the fixed-fee component for a corridor/tier.
func (e *SpreadEngine) FixedMinor(corridor, tier string) int64 {
	return e.resolve(corridor, tier).FixedMinor
}

// CustomerRate applies the spread to a provider all-in mid rate. The customer
// receives slightly less than mid (markup retained as Paymax spread revenue).
func (e *SpreadEngine) CustomerRate(providerRate float64, corridor, tier string) float64 {
	bps := e.EffectiveBPS(corridor, tier)
	return providerRate * (1 - float64(bps)/10_000.0)
}
