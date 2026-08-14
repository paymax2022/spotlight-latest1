package orchestration

import (
	"context"
	"strings"
	"sync"
)

// SpreadRule is a configurable markup for a corridor × customer-tier (spec §9).
// Spread is expressed in basis points over the provider all-in rate, with an
// optional fixed component and min/max guards.
type SpreadRule struct {
	Corridor   string // "" matches any corridor (default rule)
	Tier       string // "" matches any tier
	BPS        int
	FixedMinor int64
	MinBPS     int
	MaxBPS     int
}

// SpreadSource loads the spread rule card from durable storage. Implemented by
// the pgx-backed source over public.fx_markup_rates — the SAME table the legacy
// wallet FX service prices from, so one admin change moves both surfaces
// (ADR-031). A nil source leaves the engine on its in-code rules, which is what
// unit tests and any non-DB wiring use.
type SpreadSource interface {
	LoadRules(ctx context.Context) (defaultBPS int, rules []SpreadRule, err error)
}

// SpreadEngine resolves the effective spread for a corridor/tier and applies it.
//
// The rule card is swappable at runtime (Refresh), so it is guarded by a mutex:
// Refresh runs on the request path while resolve is being read by the candidate
// loop of a concurrent quote.
type SpreadEngine struct {
	mu         sync.RWMutex
	rules      []SpreadRule
	defaultBPS int
	source     SpreadSource
}

// NewSpreadEngine builds an engine with a flat default and optional overrides.
func NewSpreadEngine(defaultBPS int, rules ...SpreadRule) *SpreadEngine {
	return &SpreadEngine{rules: rules, defaultBPS: defaultBPS}
}

// WithSource attaches a durable rule card. The in-code rules stay as the value
// used until the first successful Refresh.
func (e *SpreadEngine) WithSource(src SpreadSource) *SpreadEngine {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.source = src
	return e
}

// HasSource reports whether a durable rule card is attached.
func (e *SpreadEngine) HasSource() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.source != nil
}

// Refresh reloads the rule card from the source, so an admin rate change is live
// on the next quote with no restart. A nil source is a no-op (in-code rules).
//
// Callers MUST treat an error as fatal to the operation: pricing from a rule card
// we could not confirm would charge a spread nobody configured. Refresh is called
// once per user-facing operation, not once per candidate, so this is one query
// per quote.
func (e *SpreadEngine) Refresh(ctx context.Context) error {
	e.mu.RLock()
	src := e.source
	e.mu.RUnlock()
	if src == nil {
		return nil
	}
	defaultBPS, rules, err := src.LoadRules(ctx)
	if err != nil {
		return err
	}
	e.mu.Lock()
	e.defaultBPS, e.rules = defaultBPS, rules
	e.mu.Unlock()
	return nil
}

// resolve picks the most specific matching rule (corridor+tier > corridor > tier > default).
func (e *SpreadEngine) resolve(corridor, tier string) SpreadRule {
	e.mu.RLock()
	defer e.mu.RUnlock()
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
