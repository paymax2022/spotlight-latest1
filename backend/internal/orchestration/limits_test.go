package orchestration

import (
	"context"
	"testing"
	"time"
)

// TS-8 Limits, Velocity & Controls / QT-006 — deterministic, executed assertions.

func retailLimits(usage UsageFunc) *LimitsEngine {
	return NewLimitsEngine("USD", LimitRule{ // default (retail)
		PerTxnMinMinor: 1_00, PerTxnMaxMinor: 10_000_00,
		DailyMaxMinor: 20_000_00, MonthlyMaxMinor: 100_000_00, MaxTxnsPerHour: 5,
	}, map[string]LimitRule{
		"business": {PerTxnMinMinor: 1_00, PerTxnMaxMinor: 250_000_00, DailyMaxMinor: 1_000_000_00, MonthlyMaxMinor: 5_000_000_00, MaxTxnsPerHour: 50},
	}, usage)
}

func zeroUsage(context.Context, string, time.Time) (LimitUsage, error) {
	return LimitUsage{}, nil
}

// QT-006 / LM-001: per-transaction min and max are enforced (in the check currency).
func TestLimitsPerTxnMinMax(t *testing.T) {
	e := retailLimits(zeroUsage)
	ctx := context.Background()
	now := baseTime()
	// Below min ($0.50 < $1.00).
	if err := e.Check(ctx, "c1", "retail", "USD", 50, now); err == nil || err.Code != "amount_below_min" {
		t.Fatalf("below-min: want amount_below_min, got %v", err)
	}
	// Above max ($20,000 > $10,000).
	if err := e.Check(ctx, "c1", "retail", "USD", 20_000_00, now); err == nil || err.Code != "amount_above_max" {
		t.Fatalf("above-max: want amount_above_max, got %v", err)
	}
	// In range passes.
	if err := e.Check(ctx, "c1", "retail", "USD", 500_00, now); err != nil {
		t.Fatalf("in-range should pass, got %v", err)
	}
}

// LM-003: KYC-tier-based limits — business tier permits an amount retail cannot.
func TestLimitsTierBased(t *testing.T) {
	e := retailLimits(zeroUsage)
	ctx := context.Background()
	now := baseTime()
	amt := int64(50_000_00) // $50,000
	if err := e.Check(ctx, "c1", "retail", "USD", amt, now); err == nil {
		t.Fatal("retail should be blocked above its per-txn max")
	}
	if err := e.Check(ctx, "c1", "business", "USD", amt, now); err != nil {
		t.Fatalf("business should permit $50k, got %v", err)
	}
}

// LM-002: daily cumulative limit blocks at the threshold.
func TestLimitsDailyCumulative(t *testing.T) {
	// Customer already used $19,500 today; a $600 convert would breach the $20k cap.
	usage := func(context.Context, string, time.Time) (LimitUsage, error) {
		return LimitUsage{DailyMinor: 19_500_00, MonthlyMinor: 19_500_00, LastHourCount: 1}, nil
	}
	e := retailLimits(usage)
	ctx := context.Background()
	now := baseTime()
	if err := e.Check(ctx, "c1", "retail", "USD", 600_00, now); err == nil || err.Code != "daily_limit" {
		t.Fatalf("daily breach: want daily_limit, got %v", err)
	}
	// A $400 convert stays under $20k.
	if err := e.Check(ctx, "c1", "retail", "USD", 400_00, now); err != nil {
		t.Fatalf("under daily cap should pass, got %v", err)
	}
}

// LM-004: velocity / anti-structuring — too many conversions within the hour is throttled.
func TestLimitsVelocity(t *testing.T) {
	usage := func(context.Context, string, time.Time) (LimitUsage, error) {
		return LimitUsage{LastHourCount: 5}, nil // already at the retail hourly cap
	}
	e := retailLimits(usage)
	if err := e.Check(context.Background(), "c1", "retail", "USD", 100_00, baseTime()); err == nil || err.Code != "velocity" {
		t.Fatalf("velocity breach: want velocity, got %v", err)
	}
}

// Cross-currency check: a limit in USD is applied to a NGN amount via the mid rate.
func TestLimitsCrossCurrencyNormalization(t *testing.T) {
	e := retailLimits(zeroUsage)
	// ₦100,000,000 (100_000_000_00 kobo) is ~$62k, above the retail $10k per-txn max.
	if err := e.Check(context.Background(), "c1", "retail", "NGN", 100_000_000_00, baseTime()); err == nil || err.Code != "amount_above_max" {
		t.Fatalf("NGN over-max: want amount_above_max, got %v", err)
	}
}

// LM-001 end-to-end: the service consults the limits engine at quote time.
func TestServiceEnforcesLimitsAtQuote(t *testing.T) {
	ctx := context.Background()
	clock := baseTime()
	store := NewMemStore()
	svc := NewService(
		[]Provider{stubProvider{name: "eversend"}, stubProvider{name: "maplerad"}},
		store,
		Options{Now: func() time.Time { return clock }, Limits: retailLimits(zeroUsage)},
	)
	_ = svc.SeedBalance(ctx, "c1", "USD", 1_000_000_00)
	// $50,000 exceeds retail per-txn max -> quote blocked.
	_, e := svc.CreateQuote(ctx, "c1", "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 50_000_00, Intent: IntentConversion})
	if e == nil || e.Type != ErrInvalidRequest {
		t.Fatalf("over-limit quote should be blocked, got %v", e)
	}
	// $500 is fine.
	if _, e := svc.CreateQuote(ctx, "c1", "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 500_00, Intent: IntentConversion}); e != nil {
		t.Fatalf("in-limit quote should pass, got %v", e)
	}
}
