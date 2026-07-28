package orchestration

import (
	"context"
	"errors"
	"sync"
	"time"
)

// Rate-integrity errors (spec §2 RT-002/RT-006, §17 EC-002/EC-011). Returned by
// the feed on ingestion so a bad/stale/wild rate never reaches the quote engine.
var (
	ErrRateNonPositive = errors.New("rate_non_positive")   // sanity: rate <= 0
	ErrRateSpike       = errors.New("rate_spike")          // deviation beyond the sanity band
	ErrRateCrossed     = errors.New("rate_crossed_market") // bid > ask (negative spread)
)

// RateSnapshot is one immutable, versioned, timestamped rate for a corridor
// (spec §2 RT-001/RT-005). Amounts are decimals only at the display/pricing
// boundary; money is still converted in integer minor units downstream.
type RateSnapshot struct {
	Pair    string    `json:"pair"`
	From    string    `json:"from"`
	To      string    `json:"to"`
	Mid     float64   `json:"mid"`
	Bid     float64   `json:"bid"`
	Ask     float64   `json:"ask"`
	Source  string    `json:"source"`
	Version int       `json:"version"`
	At      time.Time `json:"at"`
}

// RateFeedConfig tunes the staleness and sanity guards.
type RateFeedConfig struct {
	TTL             time.Duration // max age before a rate is stale and non-quotable (RT-002)
	MaxDeviationPct float64       // reject a new mid deviating > this % from the prior good mid (RT-006)
	Source          string        // provenance label recorded on each snapshot
}

// RateFeed is the authoritative, versioned rate store with staleness and sanity
// guards. It is the ingestion boundary between provider feeds and the quote
// engine: every mid is version-stamped and retained immutably (audit, RT-005),
// wild/crossed rates are rejected at the door (RT-006/EC-002/EC-011), and stale
// rates are reported non-fresh so nothing is priced on them (RT-002).
type RateFeed struct {
	mu      sync.RWMutex
	cfg     RateFeedConfig
	current map[string]RateSnapshot   // pair -> latest good snapshot
	history map[string][]RateSnapshot // pair -> immutable version history
}

// NewRateFeed builds an empty feed with the given guards.
func NewRateFeed(cfg RateFeedConfig) *RateFeed {
	return &RateFeed{
		cfg:     cfg,
		current: map[string]RateSnapshot{},
		history: map[string][]RateSnapshot{},
	}
}

// Publish ingests a new mid rate for a corridor, applying sanity (positive) and
// spike (deviation-band) guards. On success it stores a new immutable, versioned,
// timestamped snapshot and returns it; on rejection the prior good rate is
// retained and an error (ErrRateNonPositive / ErrRateSpike) is returned.
func (f *RateFeed) Publish(from, to string, mid float64, at time.Time) (RateSnapshot, error) {
	return f.publish(from, to, mid, 0, 0, at)
}

// PublishQuote ingests a bid/ask book, rejecting a crossed market (bid > ask,
// i.e. negative spread — EC-011) and non-positive quotes. The mid is derived as
// (bid+ask)/2 and then passes the same spike guard as Publish.
func (f *RateFeed) PublishQuote(from, to string, bid, ask float64, at time.Time) (RateSnapshot, error) {
	if bid <= 0 || ask <= 0 {
		return RateSnapshot{}, ErrRateNonPositive
	}
	if bid > ask {
		return RateSnapshot{}, ErrRateCrossed
	}
	return f.publish(from, to, (bid+ask)/2, bid, ask, at)
}

func (f *RateFeed) publish(from, to string, mid, bid, ask float64, at time.Time) (RateSnapshot, error) {
	if mid <= 0 {
		return RateSnapshot{}, ErrRateNonPositive
	}
	pair := Corridor(from, to)
	f.mu.Lock()
	defer f.mu.Unlock()
	prev, had := f.current[pair]
	if had && f.cfg.MaxDeviationPct > 0 && prev.Mid > 0 {
		dev := (mid - prev.Mid) / prev.Mid
		if dev < 0 {
			dev = -dev
		}
		if dev*100 > f.cfg.MaxDeviationPct {
			return RateSnapshot{}, ErrRateSpike
		}
	}
	version := 1
	if had {
		version = prev.Version + 1
	}
	snap := RateSnapshot{
		Pair: pair, From: from, To: to, Mid: mid, Bid: bid, Ask: ask,
		Source: f.cfg.Source, Version: version, At: at,
	}
	f.current[pair] = snap
	f.history[pair] = append(f.history[pair], snap)
	return snap, nil
}

// Rate returns the current snapshot for a corridor, whether one exists, and
// whether it is stale at `now` (age > TTL). A stale rate is still returned so ops
// can see the last-known value, but Fresh/quote-gating treat it as non-quotable.
func (f *RateFeed) Rate(from, to string, now time.Time) (snap RateSnapshot, ok, stale bool) {
	f.mu.RLock()
	defer f.mu.RUnlock()
	snap, ok = f.current[Corridor(from, to)]
	if !ok {
		return RateSnapshot{}, false, false
	}
	if f.cfg.TTL > 0 && now.Sub(snap.At) > f.cfg.TTL {
		stale = true
	}
	return snap, true, stale
}

// Fresh reports whether the corridor has a non-stale rate at `now`. An untracked
// corridor returns true (defer to live provider freshness) so the gate only
// blocks corridors the feed actually governs and finds stale.
func (f *RateFeed) Fresh(from, to string, now time.Time) bool {
	_, ok, stale := f.Rate(from, to, now)
	if !ok {
		return true
	}
	return !stale
}

// History returns an immutable copy of every stored version for a corridor
// (audit, RT-005). Mutating the returned slice/elements cannot affect the store.
func (f *RateFeed) History(from, to string) []RateSnapshot {
	f.mu.RLock()
	defer f.mu.RUnlock()
	src := f.history[Corridor(from, to)]
	out := make([]RateSnapshot, len(src))
	copy(out, src)
	return out
}

// SeedFromBaseRates stamps the deterministic base table into the feed at `at`, so
// the common corridors have a versioned, fresh baseline. Production replaces this
// with live provider ticks calling Publish; the guards still apply.
func (f *RateFeed) SeedFromBaseRates(at time.Time) {
	pairs := [][2]string{
		{"USD", "NGN"}, {"EUR", "NGN"}, {"GBP", "NGN"}, {"USD", "GHS"},
		{"USD", "KES"}, {"USD", "XAF"}, {"USD", "ZAR"}, {"USD", "EUR"}, {"USD", "GBP"},
	}
	for _, p := range pairs {
		if mid := MidRate(p[0], p[1]); mid > 0 {
			_, _ = f.Publish(p[0], p[1], mid, at)
		}
	}
}

// StartRateFeedRefresher keeps the deterministic baseline fresh by re-seeding the
// feed on an interval, so the staleness gate stays operational (and would surface
// a genuinely frozen feed) until live provider ticks call Publish directly. It
// seeds once immediately, then ticks until ctx is cancelled.
func StartRateFeedRefresher(ctx context.Context, f *RateFeed, interval time.Duration) {
	if f == nil || interval <= 0 {
		return
	}
	f.SeedFromBaseRates(time.Now())
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-t.C:
				f.SeedFromBaseRates(now)
			}
		}
	}()
}
