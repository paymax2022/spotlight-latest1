package orchestration

import (
	"strings"
	"sync"
)

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
