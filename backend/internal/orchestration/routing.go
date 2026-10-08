package orchestration

import (
	"context"
	"sort"
	"strings"
	"sync"
)

// ProviderQuote is an adapter's raw priced offer for a corridor (provider-native
// rate, before Paymax spread). Money is already normalized to minor units.
type ProviderQuote struct {
	Provider    string
	Corridor    string
	Rail        Rail
	Rate        float64 // provider mid/all-in rate, units of dest per 1 unit of source
	ProviderFee Money   // fee charged by the provider (source currency)
	RailFee     Money   // network/rail fee (source currency)
	Reliability float64 // rolling reliability score in [0,1] (breaker/latency aware)
	Viable      bool    // false if provider can't settle this corridor/rail
}

// ExecuteResult is the outcome of executing a conversion/transfer via a provider.
type ExecuteResult struct {
	ProviderRef  string
	ExecutedRate float64
	Destination  Money
	Status       string // "settled" | "paid" | "processing" | "failed"
}

// CollectionResult is a provisioned inbound account.
type CollectionResult struct {
	ProviderRef string
	Details     map[string]any
}

// Provider is the abstraction every FX/payment provider adapter implements
// (spec §10). Adapters map the normalized contract onto each provider's native
// API, normalize money/status, and verify webhooks.
type Provider interface {
	Name() string

	// Supports reports whether the provider can settle (corridor, rail).
	Supports(corridor string, rail Rail) bool

	// Quote returns a provider-native priced offer for the corridor/amount.
	Quote(ctx context.Context, source, dest string, amountMinor int64, amountType AmountType, rail Rail) (*ProviderQuote, error)

	// ExecuteConversion moves value between two held balances at the quoted rate.
	ExecuteConversion(ctx context.Context, q *Quote, idempotencyKey string) (*ExecuteResult, error)

	// ExecuteTransfer pays out to a beneficiary/rail (optionally with embedded FX).
	ExecuteTransfer(ctx context.Context, q *Quote, dest Destination, idempotencyKey string) (*ExecuteResult, error)

	// CreateCollection provisions an inbound virtual account / IBAN.
	CreateCollection(ctx context.Context, currency, accountType, customerID string) (*CollectionResult, error)

	// VerifyWebhookSignature validates an inbound provider webhook.
	VerifyWebhookSignature(payload []byte, signature string) bool
}

// Weights are the smart-order-routing score weights (spec §6). Config per
// corridor/tier in the control plane; this struct carries the resolved set.
type Weights struct {
	Cost        float64
	Coverage    float64
	Liquidity   float64
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
	FloatCost       float64
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

// floatKey identifies a (provider, currency) float bucket.
type floatKey struct {
	provider string
	currency string
}

// FloatBucket tracks Paymax's pre-funded balance with a provider in a currency
// (spec §7). Exposed to the router as available_float.
type FloatBucket struct {
	Provider           string
	Currency           string
	BalanceMinor       int64
	LowWaterMinor      int64
	HighWaterMinor     int64
	ExposureLimitMinor int64
	ExposureUsedMinor  int64
}

// Treasury is an in-memory float ledger. Production: back with Postgres + the
// rebalancing engine; the interface and thresholds are unchanged.
type Treasury struct {
	mu      sync.RWMutex
	buckets map[floatKey]*FloatBucket
}

// NewTreasury seeds buckets for the given providers/currencies.
func NewTreasury(seed []FloatBucket) *Treasury {
	t := &Treasury{buckets: map[floatKey]*FloatBucket{}}
	for i := range seed {
		b := seed[i]
		t.buckets[floatKey{strings.ToLower(b.Provider), strings.ToUpper(b.Currency)}] = &b
	}
	return t
}

// hasBucket reports whether a float bucket exists for provider/currency.
func (t *Treasury) hasBucket(provider, currency string) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	_, ok := t.buckets[floatKey{strings.ToLower(provider), strings.ToUpper(currency)}]
	return ok
}

// Available returns the available float for a provider/currency (0 if unknown).
func (t *Treasury) Available(provider, currency string) int64 {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if b, ok := t.buckets[floatKey{strings.ToLower(provider), strings.ToUpper(currency)}]; ok {
		return b.BalanceMinor
	}
	return 0
}

// CanCover reports whether the provider has enough float in `currency` to settle
// `amountMinor` without breaching its exposure limit.
func (t *Treasury) CanCover(provider, currency string, amountMinor int64) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	b, ok := t.buckets[floatKey{strings.ToLower(provider), strings.ToUpper(currency)}]
	if !ok {
		return false
	}
	if b.BalanceMinor < amountMinor {
		return false
	}
	if b.ExposureLimitMinor > 0 && b.ExposureUsedMinor+amountMinor > b.ExposureLimitMinor {
		return false
	}
	return true
}

// liquidityConfidence scores how comfortably a provider covers `amountMinor`
// relative to its balance ([0,1]); deeper books score higher for large tickets.
func (t *Treasury) liquidityConfidence(provider, currency string, amountMinor int64) float64 {
	avail := t.Available(provider, currency)
	if avail <= 0 {
		return 0
	}
	if amountMinor <= 0 {
		return 1
	}
	headroom := float64(avail-amountMinor) / float64(avail)
	if headroom < 0 {
		return 0
	}
	if headroom > 1 {
		headroom = 1
	}
	return headroom
}

// Reserve debits float on the chosen provider after a successful execution.
func (t *Treasury) Reserve(provider, currency string, amountMinor int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if b, ok := t.buckets[floatKey{strings.ToLower(provider), strings.ToUpper(currency)}]; ok {
		b.BalanceMinor -= amountMinor
		b.ExposureUsedMinor += amountMinor
	}
}

// Snapshot returns a copy of all buckets (for ops/treasury dashboards).
func (t *Treasury) Snapshot() []FloatBucket {
	t.mu.RLock()
	defer t.mu.RUnlock()
	out := make([]FloatBucket, 0, len(t.buckets))
	for _, b := range t.buckets {
		out = append(out, *b)
	}
	return out
}

// LowBuckets returns buckets at/below their low-water mark (rebalance triggers).
func (t *Treasury) LowBuckets() []FloatBucket {
	t.mu.RLock()
	defer t.mu.RUnlock()
	var out []FloatBucket
	for _, b := range t.buckets {
		if b.LowWaterMinor > 0 && b.BalanceMinor <= b.LowWaterMinor {
			out = append(out, *b)
		}
	}
	return out
}

// Rebalance tops a bucket back up to the midpoint of its low/high-water band,
// simulating the cheapest-path rebalancing engine (fiat or stablecoin rail).
func (t *Treasury) Rebalance(provider, currency string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	b, ok := t.buckets[floatKey{strings.ToLower(provider), strings.ToUpper(currency)}]
	if !ok {
		return false
	}
	if b.HighWaterMinor > b.LowWaterMinor {
		b.BalanceMinor = b.LowWaterMinor + (b.HighWaterMinor-b.LowWaterMinor)/2
	}
	return true
}
