package orchestration

import (
	"context"
	"errors"
	"testing"
	"time"
)

// TS-2 Rate Sourcing & Management — deterministic, executed assertions on the
// rate feed: ingest→versioned snapshot, staleness, spike guard, crossed market.

func baseTime() time.Time { return time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC) }

// RT-001: publishing a provider mid rate yields a normalized, versioned, timestamped snapshot.
func TestRateFeedPublishVersioned(t *testing.T) {
	f := NewRateFeed(RateFeedConfig{TTL: time.Minute, MaxDeviationPct: 10})
	t0 := baseTime()
	s1, err := f.Publish("USD", "NGN", 1598.20, t0)
	if err != nil {
		t.Fatalf("publish 1: %v", err)
	}
	if s1.Version != 1 || s1.Pair != "USD-NGN" || s1.Mid != 1598.20 || !s1.At.Equal(t0) {
		t.Fatalf("bad snapshot: %+v", s1)
	}
	s2, err := f.Publish("USD", "NGN", 1600.00, t0.Add(time.Second))
	if err != nil {
		t.Fatalf("publish 2: %v", err)
	}
	if s2.Version != 2 {
		t.Fatalf("version = %d, want 2", s2.Version)
	}
}

// RT-002: a rate older than the TTL is stale and must not be quotable.
func TestRateFeedStaleness(t *testing.T) {
	f := NewRateFeed(RateFeedConfig{TTL: 30 * time.Second, MaxDeviationPct: 50})
	t0 := baseTime()
	if _, err := f.Publish("USD", "NGN", 1598.20, t0); err != nil {
		t.Fatal(err)
	}
	if !f.Fresh("USD", "NGN", t0.Add(10*time.Second)) {
		t.Fatal("rate within TTL should be fresh")
	}
	if f.Fresh("USD", "NGN", t0.Add(31*time.Second)) {
		t.Fatal("rate past TTL must be stale")
	}
	_, ok, stale := f.Rate("USD", "NGN", t0.Add(31*time.Second))
	if !ok || !stale {
		t.Fatalf("expected ok+stale, got ok=%v stale=%v", ok, stale)
	}
	// Untracked pair defers to the provider (does not hard-block).
	if !f.Fresh("EUR", "GHS", t0) {
		t.Fatal("untracked pair should not be reported stale")
	}
}

// RT-006 / EC-002: an abnormal spike beyond the sanity band is rejected; the prior
// good rate is retained (no wild-rate ingestion).
func TestRateFeedSpikeGuard(t *testing.T) {
	f := NewRateFeed(RateFeedConfig{TTL: time.Minute, MaxDeviationPct: 10})
	t0 := baseTime()
	if _, err := f.Publish("USD", "NGN", 1600.00, t0); err != nil {
		t.Fatal(err)
	}
	// +25% spike -> rejected.
	if _, err := f.Publish("USD", "NGN", 2000.00, t0.Add(time.Second)); !errors.Is(err, ErrRateSpike) {
		t.Fatalf("expected ErrRateSpike, got %v", err)
	}
	// Current rate unchanged, still the good one.
	snap, ok, _ := f.Rate("USD", "NGN", t0.Add(time.Second))
	if !ok || snap.Mid != 1600.00 || snap.Version != 1 {
		t.Fatalf("spike must not mutate current rate: %+v", snap)
	}
	// A move within band is accepted.
	if _, err := f.Publish("USD", "NGN", 1650.00, t0.Add(2*time.Second)); err != nil {
		t.Fatalf("in-band move rejected: %v", err)
	}
}

// Sanity: non-positive rates are always rejected.
func TestRateFeedRejectsNonPositive(t *testing.T) {
	f := NewRateFeed(RateFeedConfig{TTL: time.Minute})
	if _, err := f.Publish("USD", "NGN", 0, baseTime()); !errors.Is(err, ErrRateNonPositive) {
		t.Fatalf("zero rate: want ErrRateNonPositive, got %v", err)
	}
	if _, err := f.Publish("USD", "NGN", -5, baseTime()); !errors.Is(err, ErrRateNonPositive) {
		t.Fatalf("negative rate: want ErrRateNonPositive, got %v", err)
	}
}

// EC-011: a crossed market (bid > ask, i.e. negative spread) is rejected.
func TestRateFeedRejectsCrossedMarket(t *testing.T) {
	f := NewRateFeed(RateFeedConfig{TTL: time.Minute, MaxDeviationPct: 50})
	t0 := baseTime()
	// Normal book: bid < ask.
	if _, err := f.PublishQuote("USD", "NGN", 1595, 1601, t0); err != nil {
		t.Fatalf("normal book rejected: %v", err)
	}
	// Crossed book: bid > ask.
	if _, err := f.PublishQuote("USD", "NGN", 1601, 1595, t0.Add(time.Second)); !errors.Is(err, ErrRateCrossed) {
		t.Fatalf("crossed market: want ErrRateCrossed, got %v", err)
	}
}

// RT-005: version history is immutable — a returned copy cannot mutate the store.
func TestRateFeedHistoryImmutable(t *testing.T) {
	f := NewRateFeed(RateFeedConfig{TTL: time.Minute, MaxDeviationPct: 50})
	t0 := baseTime()
	_, _ = f.Publish("USD", "NGN", 1600, t0)
	_, _ = f.Publish("USD", "NGN", 1620, t0.Add(time.Second))
	h := f.History("USD", "NGN")
	if len(h) != 2 {
		t.Fatalf("history len = %d, want 2", len(h))
	}
	h[0].Mid = 999999 // mutate the copy
	h2 := f.History("USD", "NGN")
	if h2[0].Mid == 999999 {
		t.Fatal("history must be immutable; internal store was mutated")
	}
}

// RT-008: inverse-rate consistency — A/B and B/A reconcile within precision (no
// free arbitrage from the indicative table).
func TestInverseRateConsistency(t *testing.T) {
	for _, p := range [][2]string{{"USD", "NGN"}, {"EUR", "GBP"}, {"USD", "JPY"}, {"USD", "KWD"}} {
		ab := MidRate(p[0], p[1])
		ba := MidRate(p[1], p[0])
		prod := ab * ba
		if prod < 0.9999 || prod > 1.0001 {
			t.Errorf("%s/%s * %s/%s = %v, want ~1", p[0], p[1], p[1], p[0], prod)
		}
	}
}

// RT-002 end-to-end: with a rate feed wired into the service, a stale corridor
// rate blocks quote creation (no conversion priced on a stale rate).
func TestServiceBlocksStaleRateQuote(t *testing.T) {
	ctx := context.Background()
	clock := baseTime()
	store := NewMemStore()
	feed := NewRateFeed(RateFeedConfig{TTL: 30 * time.Second, MaxDeviationPct: 50})
	_, _ = feed.Publish("USD", "NGN", 1598.20, clock)
	svc := NewService(
		[]Provider{stubProvider{name: "eversend"}, stubProvider{name: "maplerad"}},
		store,
		Options{Now: func() time.Time { return clock }, Rates: feed},
	)
	_ = svc.SeedBalance(ctx, "c1", "USD", 1_000_00)

	// Fresh -> quote succeeds.
	if _, e := svc.CreateQuote(ctx, "c1", "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion}); e != nil {
		t.Fatalf("fresh quote should succeed: %v", e)
	}
	// Age past TTL -> quote blocked as rate_expired.
	clock = clock.Add(2 * time.Minute)
	_, e := svc.CreateQuote(ctx, "c1", "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion})
	if e == nil || e.Type != ErrRateExpired {
		t.Fatalf("stale rate must block quote with rate_expired, got %v", e)
	}
}
