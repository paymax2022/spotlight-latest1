package orchestration

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// This file holds executed, deterministic assertions confirming the money & rate
// invariants (§4) that were already implemented but previously unproven in the
// FX master test plan: atomicity/value-conservation, rollback, no-overdraw under
// concurrency, single-use quotes, compliance gating, server authority, and
// cross-currency routing.

// allFailService builds a service where every provider fails execution, to prove
// full rollback (CV-004): the ledger debit only ever happens after a provider
// success, so an all-fail run must leave balances untouched.
func allFailService(now *time.Time) (*Service, Store) {
	store := NewMemStore()
	svc := NewService([]Provider{stubProvider{name: "eversend", fail: true}, stubProvider{name: "maplerad", fail: true}}, store, Options{
		Now: func() time.Time { return *now },
	})
	return svc, store
}

// CV-001 / §4.1: a conversion conserves value — the source is debited by exactly
// (quoted source + provider/rail fees) and the target credited by exactly the
// quoted destination; nothing is created or destroyed beyond the disclosed fee.
func TestConversionValueConservation(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, store := newTestService(&clock, false)
	cust := "cus_vc"
	const opening = int64(1_000_00)
	_ = svc.SeedBalance(ctx, cust, "USD", opening)

	q, e := svc.CreateQuote(ctx, cust, "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	if e != nil {
		t.Fatalf("quote: %v", e)
	}
	conv, e := svc.ExecuteConversion(ctx, cust, "vc-1", ConversionRequest{QuoteID: q.ID})
	if e != nil {
		t.Fatalf("convert: %v", e)
	}
	usd, _ := store.Balance(ctx, cust, "USD")
	ngn, _ := store.Balance(ctx, cust, "NGN")
	expectedDebit := q.Source.AmountMinor + feeAmount(q.Fees, FeeProvider) + feeAmount(q.Fees, FeeRail)
	if usd != opening-expectedDebit {
		t.Fatalf("USD debit not exact: got %d, want %d", usd, opening-expectedDebit)
	}
	if ngn != conv.Destination.AmountMinor {
		t.Fatalf("NGN credit not exact: got %d, want %d", ngn, conv.Destination.AmountMinor)
	}
	// Credited target equals the quoted destination to the minor unit (CV-002).
	if conv.Destination.AmountMinor != q.Destination.AmountMinor {
		t.Fatalf("credited %d != quoted %d", conv.Destination.AmountMinor, q.Destination.AmountMinor)
	}
}

// CV-004 / §4.1: provider failure across all routes rolls back fully — no debit,
// no credit, balances intact.
func TestConversionFullRollbackOnProviderFailure(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, store := allFailService(&clock)
	cust := "cus_rb"
	const opening = int64(1_000_00)
	_ = svc.SeedBalance(ctx, cust, "USD", opening)
	q, _ := svc.CreateQuote(ctx, cust, "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	_, e := svc.ExecuteConversion(ctx, cust, "rb-1", ConversionRequest{QuoteID: q.ID})
	if e == nil || e.Type != ErrProviderError {
		t.Fatalf("expected provider_error, got %v", e)
	}
	usd, _ := store.Balance(ctx, cust, "USD")
	ngn, _ := store.Balance(ctx, cust, "NGN")
	if usd != opening || ngn != 0 {
		t.Fatalf("balances must be intact after rollback: USD=%d NGN=%d", usd, ngn)
	}
}

// CV-006 / NF-003 / WB-008 / EC-003 / §4.6: concurrent conversions cannot overdraw
// a balance — exactly one wins, the balance never goes negative.
func TestConcurrentConversionsNoOverdraw(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, store := newTestService(&clock, false)
	cust := "cus_race"

	// Fund exactly enough for ONE conversion (source + provider fee = 100_00 + 25).
	const one = int64(100_00 + 25)
	_ = svc.SeedBalance(ctx, cust, "USD", one)

	const n = 8
	quotes := make([]string, n)
	for i := 0; i < n; i++ {
		q, e := svc.CreateQuote(ctx, cust, "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
		if e != nil {
			t.Fatalf("quote %d: %v", i, e)
		}
		quotes[i] = q.ID
	}

	var success int32
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if _, e := svc.ExecuteConversion(ctx, cust, "race-"+quotes[i], ConversionRequest{QuoteID: quotes[i]}); e == nil {
				atomic.AddInt32(&success, 1)
			}
		}(i)
	}
	wg.Wait()

	if success != 1 {
		t.Fatalf("exactly one conversion should succeed, got %d", success)
	}
	usd, _ := store.Balance(ctx, cust, "USD")
	if usd < 0 {
		t.Fatalf("balance went negative: %d", usd)
	}
	if usd != 0 {
		t.Fatalf("winning conversion should drain the balance to 0, got %d", usd)
	}
}

// QT-005 / §4.5: a quote is single-use — once consumed, a fresh execution with a
// different idempotency key is rejected (no replay at a new key).
func TestQuoteSingleUseNoReplay(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, _ := newTestService(&clock, false)
	cust := "cus_su"
	_ = svc.SeedBalance(ctx, cust, "USD", 1_000_00)
	q, _ := svc.CreateQuote(ctx, cust, "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	if _, e := svc.ExecuteConversion(ctx, cust, "su-1", ConversionRequest{QuoteID: q.ID}); e != nil {
		t.Fatalf("first execute: %v", e)
	}
	// Different idempotency key, same (now consumed) quote -> conflict.
	_, e := svc.ExecuteConversion(ctx, cust, "su-2", ConversionRequest{QuoteID: q.ID})
	if e == nil || e.Type != ErrConflict {
		t.Fatalf("consumed quote reused at new key should conflict, got %v", e)
	}
}

// CP-001 / CP-002 / §4.8: compliance is a hard gate — a blocked screen refuses to
// price (compliance_block); an allowed screen prices normally.
func TestComplianceGateBlocksQuote(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	store := NewMemStore()
	blockSanctioned := ScreenerFunc(func(_ context.Context, cust, _ string, _ int64) (bool, string, error) {
		if cust == "sanctioned" {
			return false, "sanctions_hit", nil
		}
		return true, "", nil
	})
	svc := NewService([]Provider{stubProvider{name: "eversend"}, stubProvider{name: "maplerad"}}, store,
		Options{Now: func() time.Time { return clock }, Screener: blockSanctioned})
	_ = svc.SeedBalance(ctx, "sanctioned", "USD", 1_000_00)
	_ = svc.SeedBalance(ctx, "clean", "USD", 1_000_00)

	if _, e := svc.CreateQuote(ctx, "sanctioned", "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion}); e == nil || e.Type != ErrComplianceBlock {
		t.Fatalf("sanctioned party must be blocked, got %v", e)
	}
	if _, e := svc.CreateQuote(ctx, "clean", "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion}); e != nil {
		t.Fatalf("clean party should be allowed, got %v", e)
	}
}

// CP-002 execution defense-in-depth: even a screener that flips to blocking AFTER
// a quote was priced must halt execution (fail-closed re-screen).
func TestComplianceReScreenAtExecution(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	store := NewMemStore()
	var blocking atomic.Bool
	screen := ScreenerFunc(func(_ context.Context, _, _ string, _ int64) (bool, string, error) {
		if blocking.Load() {
			return false, "sanctions_hit", nil
		}
		return true, "", nil
	})
	svc := NewService([]Provider{stubProvider{name: "eversend"}, stubProvider{name: "maplerad"}}, store,
		Options{Now: func() time.Time { return clock }, Screener: screen})
	_ = svc.SeedBalance(ctx, "c1", "USD", 1_000_00)
	q, e := svc.CreateQuote(ctx, "c1", "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	if e != nil {
		t.Fatalf("quote: %v", e)
	}
	blocking.Store(true) // party flagged after quoting
	if _, e := svc.ExecuteConversion(ctx, "c1", "cx-1", ConversionRequest{QuoteID: q.ID}); e == nil || e.Type != ErrComplianceBlock {
		t.Fatalf("execution must re-screen and block, got %v", e)
	}
	usd, _ := store.Balance(ctx, "c1", "USD")
	if usd != 1_000_00 {
		t.Fatalf("no funds should move on a blocked execution, balance=%d", usd)
	}
}

// SC-002 / §4.2: the server is authoritative — the conversion request carries only
// a quote_id; the credited amount is dictated by the server-stored quote, not any
// client-supplied figure. Confirms a client cannot substitute a better rate/amount.
func TestServerAuthoritativeAmount(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, store := newTestService(&clock, false)
	cust := "cus_auth"
	_ = svc.SeedBalance(ctx, cust, "USD", 1_000_00)
	q, _ := svc.CreateQuote(ctx, cust, "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	serverDest := q.Destination.AmountMinor

	conv, e := svc.ExecuteConversion(ctx, cust, "auth-1", ConversionRequest{QuoteID: q.ID})
	if e != nil {
		t.Fatalf("convert: %v", e)
	}
	ngn, _ := store.Balance(ctx, cust, "NGN")
	if conv.Destination.AmountMinor != serverDest || ngn != serverDest {
		t.Fatalf("credited amount not server-authoritative: conv=%d ngn=%d want=%d", conv.Destination.AmountMinor, ngn, serverDest)
	}
}

// CV-007 / RT-007 / §4.10: a cross-currency conversion with no direct pair is
// priced by triangulation via the base currency and conserves value (destination
// ≈ source × triangulated rate, less the disclosed spread only).
func TestCrossCurrencyTriangulatedRouting(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, store := newTestService(&clock, false)
	cust := "cus_tri"
	_ = svc.SeedBalance(ctx, cust, "EUR", 10_000_00)

	q, e := svc.CreateQuote(ctx, cust, "retail", QuoteRequest{Source: "EUR", Destination: "GHS", Amount: 100_00, Intent: IntentConversion, Lock: true})
	if e != nil {
		t.Fatalf("quote: %v", e)
	}
	// Triangulated mid EUR->GHS; customer receives slightly less (spread), never more.
	mid := MidRate("EUR", "GHS")
	idealMinor := convertMinor(100_00, "EUR", "GHS", mid)
	if q.Destination.AmountMinor <= 0 || q.Destination.AmountMinor > idealMinor {
		t.Fatalf("triangulated dest %d should be >0 and <= mid ideal %d (spread retained)", q.Destination.AmountMinor, idealMinor)
	}
	conv, e := svc.ExecuteConversion(ctx, cust, "tri-1", ConversionRequest{QuoteID: q.ID})
	if e != nil {
		t.Fatalf("convert: %v", e)
	}
	ghs, _ := store.Balance(ctx, cust, "GHS")
	if ghs != conv.Destination.AmountMinor {
		t.Fatalf("GHS credit %d != conv dest %d", ghs, conv.Destination.AmountMinor)
	}
}
