package orchestration

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"spotlight/backend/internal/provider"
)

func TestApplyRateRounding(t *testing.T) {
	// $1,000.00 (100000 cents) at 1581.43 -> NGN 1,581,430.00 = 158143000 kobo
	got := applyRate(100000, 1581.43)
	if got != 158143000 {
		t.Fatalf("applyRate = %d, want 158143000", got)
	}
}

func TestInverseAmount(t *testing.T) {
	if got := inverseAmount(158143000, 1581.43); got != 100000 {
		t.Fatalf("inverseAmount = %d, want 100000", got)
	}
	if inverseAmount(100, 0) != 0 {
		t.Fatal("inverseAmount with zero rate must be 0")
	}
}

func TestBpsOf(t *testing.T) {
	if got := bpsOf(100000, 105); got != 1050 { // 1.05% of 100000 = 1050
		t.Fatalf("bpsOf = %d, want 1050", got)
	}
}

func TestMidRateTriangulation(t *testing.T) {
	if r := MidRate("USD", "USD"); r != 1 {
		t.Fatalf("USD/USD = %v, want 1", r)
	}
	if r := MidRate("USD", "ZZZ"); r != 0 {
		t.Fatalf("unknown currency should give 0, got %v", r)
	}
	if r := MidRate("USD", "NGN"); r < 1500 || r > 1700 {
		t.Fatalf("USD/NGN mid out of range: %v", r)
	}
}

func TestSpreadCustomerRateAndGuards(t *testing.T) {
	e := NewSpreadEngine(100,
		SpreadRule{Corridor: "USD-NGN", Tier: "business", BPS: 50, MinBPS: 40, MaxBPS: 80},
		SpreadRule{Corridor: "USD-NGN", BPS: 120, MinBPS: 80, MaxBPS: 200},
	)
	if bps := e.EffectiveBPS("USD-NGN", "business"); bps != 50 {
		t.Fatalf("business corridor bps = %d, want 50", bps)
	}
	if bps := e.EffectiveBPS("USD-NGN", "retail"); bps != 120 {
		t.Fatalf("retail corridor bps = %d, want 120", bps)
	}
	if bps := e.EffectiveBPS("EUR-NGN", "retail"); bps != 100 {
		t.Fatalf("fallback bps = %d, want default 100", bps)
	}
	// Customer receives less than mid.
	if r := e.CustomerRate(1000, "USD-NGN", "retail"); r >= 1000 {
		t.Fatalf("customer rate %v should be below mid 1000", r)
	}
}

func TestSpreadGuardClamps(t *testing.T) {
	e := NewSpreadEngine(0, SpreadRule{Corridor: "USD-NGN", BPS: 9999, MinBPS: 50, MaxBPS: 150})
	if bps := e.EffectiveBPS("USD-NGN", "retail"); bps != 150 {
		t.Fatalf("bps should clamp to max 150, got %d", bps)
	}
}

func TestRouterPicksHighestScore(t *testing.T) {
	r := NewRouter(DefaultWeights)
	cands := []Candidate{
		{Provider: "a", AllInRate: 100, Cost: 0.8, CoverageFit: 1, Liquidity: 0.8, Reliability: 0.9, Viable: true},
		{Provider: "b", AllInRate: 100, Cost: 1.0, CoverageFit: 1, Liquidity: 0.9, Reliability: 0.95, Viable: true},
		{Provider: "c", AllInRate: 100, Cost: 1.0, CoverageFit: 1, Liquidity: 0.9, Reliability: 0.95, Viable: false},
	}
	res := r.Rank(cands)
	if res.Best == nil || res.Best.Provider != "b" {
		t.Fatalf("expected best=b, got %+v", res.Best)
	}
	if len(res.Alternatives) != 1 || res.Alternatives[0].Provider != "a" {
		t.Fatalf("expected one alt=a, got %+v", res.Alternatives)
	}
}

func TestRouterNoViable(t *testing.T) {
	r := NewRouter(DefaultWeights)
	if res := r.Rank([]Candidate{{Provider: "a", Viable: false}}); res.Best != nil {
		t.Fatal("expected no best when none viable")
	}
}

func TestQuoteBookConsumeExpiry(t *testing.T) {
	b := NewQuoteBook(time.Minute)
	now := time.Now()
	q := &Quote{ID: "q1", CustomerID: "c1", Status: QuoteLocked, ExpiresAt: now.Add(time.Minute)}
	b.Put(q)
	if _, e := b.Consume("q1", "c1", now); e != nil {
		t.Fatalf("consume should succeed, got %v", e)
	}
	if _, e := b.Consume("q1", "c1", now); e == nil || e.Type != ErrConflict {
		t.Fatalf("second consume should conflict, got %v", e)
	}
	q2 := &Quote{ID: "q2", CustomerID: "c1", Status: QuoteLocked, ExpiresAt: now.Add(time.Minute)}
	b.Put(q2)
	if _, e := b.Consume("q2", "c1", now.Add(2*time.Minute)); e == nil || e.Type != ErrRateExpired {
		t.Fatalf("expired quote should give rate_expired, got %v", e)
	}
}

type stubProvider struct {
	name      string
	fail      bool // definite refusal — provable non-execution, failover-safe
	ambiguous bool // unknown outcome (timeout/5xx) — must NOT fail over
	calls     *int
}

func (s stubProvider) Name() string               { return s.name }
func (s stubProvider) Supports(string, Rail) bool { return true }
func (s stubProvider) Quote(_ context.Context, src, dst string, amt int64, at AmountType, rail Rail) (*ProviderQuote, error) {
	return &ProviderQuote{Provider: s.name, Corridor: Corridor(src, dst), Rail: rail, Rate: MidRate(src, dst), ProviderFee: NewMoney(25, src), RailFee: NewMoney(0, src), Reliability: 0.95, Viable: true}, nil
}
func (s stubProvider) ExecuteConversion(_ context.Context, q *Quote, _ string) (*ExecuteResult, error) {
	if s.calls != nil {
		*s.calls++
	}
	if s.fail {
		return nil, fmt.Errorf("%w: %s refused the conversion", provider.ErrProviderRefused, s.name)
	}
	if s.ambiguous {
		return nil, errors.New("dial tcp: i/o timeout")
	}
	return &ExecuteResult{ProviderRef: s.name + "_ref", ExecutedRate: q.AllInRate, Destination: q.Destination, Status: "settled"}, nil
}
func (s stubProvider) ExecuteTransfer(_ context.Context, q *Quote, _ Destination, _ string) (*ExecuteResult, error) {
	if s.calls != nil {
		*s.calls++
	}
	if s.fail {
		return nil, fmt.Errorf("%w: %s refused the payout", provider.ErrProviderRefused, s.name)
	}
	if s.ambiguous {
		return nil, errors.New("dial tcp: i/o timeout")
	}
	return &ExecuteResult{ProviderRef: s.name + "_ref", ExecutedRate: q.AllInRate, Destination: q.Destination, Status: "processing"}, nil
}
func (s stubProvider) CreateCollection(_ context.Context, cur, typ, _ string) (*CollectionResult, error) {
	return &CollectionResult{ProviderRef: "col", Details: map[string]any{"currency": cur, "type": typ}}, nil
}
func (s stubProvider) VerifyWebhookSignature([]byte, string) bool { return true }

func newTestService(now *time.Time, fail bool) (*Service, Store) {
	store := NewMemStore()
	svc := NewService([]Provider{stubProvider{name: "eversend", fail: fail}, stubProvider{name: "maplerad"}}, store, Options{
		Now: func() time.Time { return *now },
	})
	return svc, store
}

func TestConversionHappyPathAndIdempotency(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, store := newTestService(&clock, false)
	cust := "cus_1"
	_ = svc.SeedBalance(ctx, cust, "USD", 1_000_00) // $1,000

	q, e := svc.CreateQuote(ctx, cust, "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	if e != nil {
		t.Fatalf("quote error: %v", e)
	}
	if q.Destination.AmountMinor <= 0 || q.Destination.Currency != "NGN" {
		t.Fatalf("bad destination: %+v", q.Destination)
	}

	conv, e := svc.ExecuteConversion(ctx, cust, "idem-1", ConversionRequest{QuoteID: q.ID})
	if e != nil {
		t.Fatalf("convert error: %v", e)
	}
	if conv.Status != ConvSettled {
		t.Fatalf("status = %s, want settled", conv.Status)
	}
	usd, _ := store.Balance(ctx, cust, "USD")
	ngn, _ := store.Balance(ctx, cust, "NGN")
	if usd != 1_000_00-(100_00+25) { // source + provider fee
		t.Fatalf("USD balance = %d", usd)
	}
	if ngn != conv.Destination.AmountMinor {
		t.Fatalf("NGN balance = %d, want %d", ngn, conv.Destination.AmountMinor)
	}

	// Idempotent replay returns the same conversion.
	conv2, e := svc.ExecuteConversion(ctx, cust, "idem-1", ConversionRequest{QuoteID: q.ID})
	if e != nil || conv2.ID != conv.ID {
		t.Fatalf("idempotent replay mismatch: %v %v", e, conv2)
	}
}

func TestConversionInsufficientBalance(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, _ := newTestService(&clock, false)
	cust := "cus_broke"
	q, _ := svc.CreateQuote(ctx, cust, "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	_, e := svc.ExecuteConversion(ctx, cust, "idem-x", ConversionRequest{QuoteID: q.ID})
	if e == nil || e.Type != ErrInsufficientBalance {
		t.Fatalf("expected insufficient_balance, got %v", e)
	}
}

func TestConversionRateExpired(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, _ := newTestService(&clock, false)
	cust := "cus_2"
	_ = svc.SeedBalance(ctx, cust, "USD", 1_000_00)
	q, _ := svc.CreateQuote(ctx, cust, "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	clock = clock.Add(10 * time.Minute) // advance past lock window
	_, e := svc.ExecuteConversion(ctx, cust, "idem-2", ConversionRequest{QuoteID: q.ID})
	if e == nil || e.Type != ErrRateExpired {
		t.Fatalf("expected rate_expired, got %v", e)
	}
}

func TestConversionFailoverToAlternative(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	// eversend fails; router should still execute via the maplerad alternative.
	svc, _ := newTestService(&clock, true)
	cust := "cus_3"
	_ = svc.SeedBalance(ctx, cust, "USD", 1_000_00)
	q, _ := svc.CreateQuote(ctx, cust, "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	conv, e := svc.ExecuteConversion(ctx, cust, "idem-3", ConversionRequest{QuoteID: q.ID})
	if e != nil {
		t.Fatalf("failover should succeed via alternative, got %v", e)
	}
	if conv.Route.Provider != "maplerad" {
		t.Fatalf("expected failover to maplerad, got %s", conv.Route.Provider)
	}
}

// An ambiguous provider error (timeout, reset, 5xx) must NOT fail over — the
// request may have executed upstream. The conversion stays pending, the debit
// stays held, and a same-key replay returns the row without re-calling any
// provider.
func TestConversionAmbiguousOutcomeHoldsPending(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	evCalls, mpCalls := 0, 0
	store := NewMemStore()
	svc := NewService([]Provider{
		stubProvider{name: "eversend", ambiguous: true, calls: &evCalls},
		stubProvider{name: "maplerad", calls: &mpCalls},
	}, store, Options{Now: func() time.Time { return clock }})
	cust := "cus_amb"
	const opening = int64(1_000_00)
	_ = svc.SeedBalance(ctx, cust, "USD", opening)
	q, _ := svc.CreateQuote(ctx, cust, "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})

	conv, e := svc.ExecuteConversion(ctx, cust, "amb-1", ConversionRequest{QuoteID: q.ID})
	if e != nil {
		t.Fatalf("ambiguous outcome must return the pending conversion, got %v", e)
	}
	if conv.Status != ConvPending {
		t.Fatalf("conversion should stay pending, got %s", conv.Status)
	}
	if mpCalls != 0 {
		t.Fatalf("ambiguous eversend error must NOT fail over to maplerad (calls=%d)", mpCalls)
	}
	// Source debit is held (not refunded — the provider may have executed).
	usd, _ := store.Balance(ctx, cust, "USD")
	if usd >= opening {
		t.Fatalf("source debit should be held pending, got %d", usd)
	}
	if ngn, _ := store.Balance(ctx, cust, "NGN"); ngn != 0 {
		t.Fatalf("dest must not be credited before settle, got %d", ngn)
	}

	// Replay: same idempotency key returns the held row, zero extra provider calls.
	replay, e := svc.ExecuteConversion(ctx, cust, "amb-1", ConversionRequest{QuoteID: q.ID})
	if e != nil || replay.Reference != conv.Reference {
		t.Fatalf("replay should return the held row, got %v %v", replay, e)
	}
	if evCalls+mpCalls != 1 {
		t.Fatalf("replay must not re-execute any provider: ev=%d mp=%d", evCalls, mpCalls)
	}
}

// A definite refusal unwinds the debit exactly once and fails the request.
func TestConversionRefusalRefundsExactlyOnce(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, store := allFailService(&clock)
	cust := "cus_ref"
	const opening = int64(1_000_00)
	_ = svc.SeedBalance(ctx, cust, "USD", opening)
	q, _ := svc.CreateQuote(ctx, cust, "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	_, e := svc.ExecuteConversion(ctx, cust, "ref-1", ConversionRequest{QuoteID: q.ID})
	if e == nil || e.Type != ErrProviderError {
		t.Fatalf("definite refusal should surface provider_error, got %v", e)
	}
	usd, _ := store.Balance(ctx, cust, "USD")
	if usd != opening {
		t.Fatalf("refund must restore the full debit: got %d, want %d", usd, opening)
	}
}

func TestReconcile(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, _ := newTestService(&clock, false)
	cust := "cus_recon"
	_ = svc.SeedBalance(ctx, cust, "USD", 1_000_00)
	q, _ := svc.CreateQuote(ctx, cust, "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	conv, e := svc.ExecuteConversion(ctx, cust, "r1", ConversionRequest{QuoteID: q.ID})
	if e != nil {
		t.Fatalf("convert: %v", e)
	}
	prov := conv.Route.Provider
	fee := feeAmount(conv.Fees, FeeProvider) + feeAmount(conv.Fees, FeeRail)

	// Clean match.
	rep, err := svc.Reconcile(ctx, prov, []SettlementRecord{{Reference: conv.Reference, Provider: prov, AmountMinor: conv.Source.AmountMinor, FeeMinor: fee, Currency: "USD"}})
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if rep.Matched != 1 || len(rep.Breaks) != 0 {
		t.Fatalf("expected clean match, got matched=%d breaks=%d", rep.Matched, len(rep.Breaks))
	}

	// Missing settlement -> BreakMissing.
	rep2, _ := svc.Reconcile(ctx, prov, nil)
	if len(rep2.Breaks) != 1 || rep2.Breaks[0].Kind != BreakMissing {
		t.Fatalf("expected one missing break, got %+v", rep2.Breaks)
	}

	// Amount mismatch -> BreakAmount.
	rep3, _ := svc.Reconcile(ctx, prov, []SettlementRecord{{Reference: conv.Reference, Provider: prov, AmountMinor: conv.Source.AmountMinor + 1, FeeMinor: fee, Currency: "USD"}})
	if len(rep3.Breaks) != 1 || rep3.Breaks[0].Kind != BreakAmount {
		t.Fatalf("expected amount break, got %+v", rep3.Breaks)
	}
}

func TestCanonStatusMapping(t *testing.T) {
	if canonTransferStatus("successful") != string(TransferPaid) {
		t.Fatal("successful -> paid")
	}
	if canonTransferStatus("reversed") != string(TransferReversed) {
		t.Fatal("reversed -> reversed")
	}
	if canonConversionStatus("failed") != string(ConvFailed) {
		t.Fatal("failed -> failed")
	}
	if canonConversionStatus("settled") != string(ConvSettled) {
		t.Fatal("settled -> settled")
	}
}

func TestMissingIdempotencyKey(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, _ := newTestService(&clock, false)
	q, _ := svc.CreateQuote(ctx, "c", "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	if _, e := svc.ExecuteConversion(ctx, "c", "", ConversionRequest{QuoteID: q.ID}); e == nil || e.Type != ErrInvalidRequest {
		t.Fatalf("expected invalid_request for missing idem key, got %v", e)
	}
}
