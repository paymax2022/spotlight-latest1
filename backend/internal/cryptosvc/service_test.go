package cryptosvc

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
	"spotlight/backend/internal/finance/ledger"
)

// spy wraps the Mock to count and observe provider calls.
type spy struct {
	*cryptoprov.Mock
	confirms   int32
	onConfirm  func() // runs at the moment the provider is asked to confirm
	tamperFrom *decimal.Decimal
	confirmErr error
}

func (s *spy) ConfirmSwap(ctx context.Context, acct, q string) (cryptoprov.Swap, error) {
	atomic.AddInt32(&s.confirms, 1)
	if s.onConfirm != nil {
		s.onConfirm()
	}
	if s.confirmErr != nil {
		return cryptoprov.Swap{}, s.confirmErr
	}
	return s.Mock.ConfirmSwap(ctx, acct, q)
}

func (s *spy) QuoteSwap(ctx context.Context, r cryptoprov.SwapQuoteRequest) (cryptoprov.SwapQuote, error) {
	q, err := s.Mock.QuoteSwap(ctx, r)
	if err == nil && s.tamperFrom != nil {
		q.FromAmt = *s.tamperFrom
	}
	return q, err
}

type okGate struct{ err error }

func (g okGate) CanTrade(context.Context, string) error { return g.err }

type dir struct{}

func (dir) UserRef(_ context.Context, id string) (cryptoprov.UserRef, error) {
	return cryptoprov.UserRef{UserID: id, Email: id + "@x.test"}, nil
}

type svcRig struct {
	svc   *Service
	store *memStore
	led   *fakeLedger
	prov  *spy
	now   time.Time
}

func newSvcRig(t *testing.T) *svcRig {
	t.Helper()
	r := &svcRig{now: time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)}
	m := cryptoprov.NewMock("mock", func() time.Time { return r.now })
	m.SetPrice("NGNUSDT", decimal.RequireFromString("0.000666")) // ~1500 NGN per USDT
	r.prov = &spy{Mock: m}
	reg := cryptoprov.NewRegistry("mock")
	if err := reg.Register(r.prov); err != nil {
		t.Fatal(err)
	}
	r.store = newMemStore()
	r.led = newFakeLedger()
	settler := NewSettler(r.led).WithLocker(&memLocker{})
	ing := NewIngest(reg, r.store).WithSettler(settler)
	r.svc = NewService(ServiceConfig{
		Registry: reg, Provider: "mock", Store: r.store, Settler: settler, Ingest: ing,
		Fees: DefaultFeeSchedule(), Users: dir{}, Gate: okGate{}, Locker: &memLocker{},
		Now: func() time.Time { return r.now },
	})
	return r
}

func (r *svcRig) quote(t *testing.T, key string, kobo int64) SwapRecord {
	t.Helper()
	q, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: key, Asset: "USDT", NGNKobo: kobo})
	if err != nil {
		t.Fatalf("quote: %v", err)
	}
	return q
}

func TestQuotePersistsTheLedgerInputsAndCreatesOneProviderAccount(t *testing.T) {
	r := newSvcRig(t)
	q := r.quote(t, "k1", 1_000_000)
	if q.Side != SideBuy || q.NGNKobo != 1_000_000 || q.FeeBps != 75 || q.FeeKobo != 7_500 || q.State != cryptoprov.SwapStateQuoted {
		t.Fatalf("quote = %+v", q)
	}
	if q.ProviderQuoteID == "" || q.ProviderAccountID == "" || !q.ExpiresAt.After(r.now) {
		t.Fatalf("quote missing provider data: %+v", q)
	}
	r.quote(t, "k2", 2_000_000)
	if n := r.prov.AccountsCreated(); n != 1 {
		t.Fatalf("provider accounts created = %d, want 1", n)
	}
}

func TestQuoteReplayReturnsTheSameQuoteAndADifferentBodyConflicts(t *testing.T) {
	r := newSvcRig(t)
	a := r.quote(t, "same", 1_000_000)
	b := r.quote(t, "same", 1_000_000)
	if a.ID != b.ID || a.ProviderQuoteID != b.ProviderQuoteID {
		t.Fatalf("replay created a second quote: %s vs %s", a.ID, b.ID)
	}
	_, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "same", Asset: "USDT", NGNKobo: 2_000_000})
	if !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("err = %v, want ErrIdempotencyConflict", err)
	}
}

func TestQuoteValidatesBeforeTouchingTheProvider(t *testing.T) {
	r := newSvcRig(t)
	for name, req := range map[string]QuoteRequest{
		"no key":     {UserID: user, Asset: "USDT", NGNKobo: 1_000_000},
		"no user":    {IdempotencyKey: "k", Asset: "USDT", NGNKobo: 1_000_000},
		"no asset":   {UserID: user, IdempotencyKey: "k", NGNKobo: 1_000_000},
		"zero ngn":   {UserID: user, IdempotencyKey: "k", Asset: "USDT"},
		"negative":   {UserID: user, IdempotencyKey: "k", Asset: "USDT", NGNKobo: -5},
		"ngn asset":  {UserID: user, IdempotencyKey: "k", Asset: "NGN", NGNKobo: 100},
		"fee == all": {UserID: user, IdempotencyKey: "k", Asset: "USDT", NGNKobo: 1}, // fee floors to 0: allowed? see below
	} {
		if name == "fee == all" {
			continue
		}
		if _, err := r.svc.Quote(context.Background(), req); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	if r.prov.AccountsCreated() != 0 {
		t.Fatal("invalid quotes reached the provider")
	}
}

func TestQuoteRefusedByTheTradeGate(t *testing.T) {
	r := newSvcRig(t)
	r.svc.cfg.Gate = okGate{err: errors.New("kyc tier too low")}
	if _, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "k", Asset: "USDT", NGNKobo: 1_000_000}); err == nil {
		t.Fatal("gate ignored")
	}
	if r.prov.AccountsCreated() != 0 {
		t.Fatal("a refused user got a provider account")
	}
}

func TestMissingGateFailsClosed(t *testing.T) {
	r := newSvcRig(t)
	r.svc.cfg.Gate = nil
	if _, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "k", Asset: "USDT", NGNKobo: 1_000_000}); err == nil {
		t.Fatal("a nil trade gate allowed trading")
	}
}

func TestQuoteThatDoesNotMatchTheRequestedNGNIsRefused(t *testing.T) {
	r := newSvcRig(t)
	wrong := decimal.RequireFromString("5000")
	r.prov.tamperFrom = &wrong
	if _, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "k", Asset: "USDT", NGNKobo: 1_000_000}); err == nil {
		t.Fatal("a provider quote for a different NGN amount was accepted")
	}
	if len(r.store.swaps) != 0 {
		t.Fatal("a mismatched quote was persisted")
	}
}

func TestConfirmHoldsBeforeTheProviderIsAskedThenSettlesOnCompletion(t *testing.T) {
	r := newSvcRig(t)
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	holdAtConfirm := int64(-1)
	r.prov.onConfirm = func() { holdAtConfirm = r.led.bal(clearK) }

	got, err := r.svc.Confirm(context.Background(), user, q.ID)
	if err != nil {
		t.Fatal(err)
	}
	if holdAtConfirm != 1_007_500 {
		t.Fatalf("clearing was %d when the provider was asked: the hold must exist BEFORE the provider confirm", holdAtConfirm)
	}
	if got.State != cryptoprov.SwapStateProcessing || got.ProviderSwapID == "" {
		t.Fatalf("after confirm: %+v", got)
	}
	if r.led.bal(walletK) != 992_500 {
		t.Fatalf("wallet = %d", r.led.bal(walletK))
	}

	_ = r.prov.CompleteSwap(got.ProviderSwapID, cryptoprov.SwapCompleted)
	done, err := r.svc.Resolve(context.Background(), user, q.ID)
	if err != nil || done.State != cryptoprov.SwapStateCompleted {
		t.Fatalf("resolve: %+v, %v", done, err)
	}
	if r.led.bal(revenueK) != 7_500 || r.led.bal(clearK) != 1_000_000 {
		t.Fatalf("revenue=%d clearing=%d", r.led.bal(revenueK), r.led.bal(clearK))
	}
	if r.led.total() != 2_000_000 {
		t.Fatalf("value not conserved: %d", r.led.total())
	}
}

func TestConfirmReplayDoesNotHoldOrConfirmTwice(t *testing.T) {
	r := newSvcRig(t)
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	for i := 0; i < 3; i++ {
		if _, err := r.svc.Confirm(context.Background(), user, q.ID); err != nil {
			t.Fatalf("confirm %d: %v", i, err)
		}
	}
	if r.prov.confirms != 1 || r.led.bal(walletK) != 992_500 {
		t.Fatalf("provider confirms=%d wallet=%d", r.prov.confirms, r.led.bal(walletK))
	}
}

func TestConcurrentConfirmsHoldAndConfirmOnce(t *testing.T) {
	r := newSvcRig(t)
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, _ = r.svc.Confirm(context.Background(), user, q.ID) }()
	}
	wg.Wait()
	if r.prov.confirms != 1 || r.led.bal(walletK) != 992_500 {
		t.Fatalf("provider confirms=%d wallet=%d", r.prov.confirms, r.led.bal(walletK))
	}
}

func TestExpiredQuoteIsNeverHeldOrConfirmed(t *testing.T) {
	r := newSvcRig(t)
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	r.now = q.ExpiresAt.Add(time.Second)
	_, err := r.svc.Confirm(context.Background(), user, q.ID)
	if !errors.Is(err, ErrQuoteExpired) {
		t.Fatalf("err = %v", err)
	}
	if r.prov.confirms != 0 || r.led.bal(walletK) != 2_000_000 {
		t.Fatal("an expired quote moved money or reached the provider")
	}
	if s, _, _ := r.store.SwapByID(context.Background(), user, q.ID); s.State != cryptoprov.SwapStateExpired {
		t.Fatalf("state = %s", s.State)
	}
}

func TestInsufficientFundsFailsTheSwapWithoutTheProvider(t *testing.T) {
	r := newSvcRig(t)
	r.led.fund(user, 500_000)
	q := r.quote(t, "k", 1_000_000)
	_, err := r.svc.Confirm(context.Background(), user, q.ID)
	if !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("err = %v", err)
	}
	if r.prov.confirms != 0 {
		t.Fatal("provider asked although the hold was refused")
	}
	if s, _, _ := r.store.SwapByID(context.Background(), user, q.ID); s.State != cryptoprov.SwapStateFailed {
		t.Fatalf("state = %s", s.State)
	}
}

func TestDefinitiveProviderRefusalReleasesTheHold(t *testing.T) {
	r := newSvcRig(t)
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	r.prov.confirmErr = &cryptoprov.APIError{Provider: "mock", Status: 422, Code: "quote_expired"}
	if _, err := r.svc.Confirm(context.Background(), user, q.ID); err == nil {
		t.Fatal("expected the refusal to surface")
	}
	if r.led.bal(walletK) != 2_000_000 || r.led.bal(clearK) != 0 {
		t.Fatalf("hold not released: wallet=%d clearing=%d", r.led.bal(walletK), r.led.bal(clearK))
	}
	if s, _, _ := r.store.SwapByID(context.Background(), user, q.ID); s.State != cryptoprov.SwapStateFailed {
		t.Fatalf("state = %s", s.State)
	}
}

func TestAmbiguousProviderOutcomeKeepsTheHoldAndParksTheSwap(t *testing.T) {
	r := newSvcRig(t)
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	r.prov.confirmErr = &cryptoprov.APIError{Provider: "mock", Status: 503}
	if _, err := r.svc.Confirm(context.Background(), user, q.ID); err == nil {
		t.Fatal("ambiguous outcome reported as success")
	}
	if r.led.bal(clearK) != 1_007_500 {
		t.Fatalf("the hold was released on an ambiguous outcome: clearing=%d", r.led.bal(clearK))
	}
	if s, _, _ := r.store.SwapByID(context.Background(), user, q.ID); s.State != cryptoprov.SwapStateNeedsReview {
		t.Fatalf("state = %s, want needs_review", s.State)
	}
}

func TestAnotherUsersSwapIsNotFound(t *testing.T) {
	r := newSvcRig(t)
	q := r.quote(t, "k", 1_000_000)
	if _, err := r.svc.Confirm(context.Background(), "someone-else", q.ID); !errors.Is(err, ErrSwapNotFound) {
		t.Fatalf("err = %v", err)
	}
	if _, err := r.svc.Resolve(context.Background(), "someone-else", q.ID); !errors.Is(err, ErrSwapNotFound) {
		t.Fatalf("resolve err = %v", err)
	}
}

func TestConfirmResumesAfterACrashBetweenTheHoldAndTheProviderCall(t *testing.T) {
	r := newSvcRig(t)
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	// Simulate the crash: claimed and held, provider never called.
	if ok, _ := r.store.TransitionSwap(context.Background(), q.ID, cryptoprov.SwapStateQuoted, cryptoprov.SwapStateConfirming, decimal.Zero, ""); !ok {
		t.Fatal("setup")
	}
	if err := r.svc.cfg.Settler.HoldBuy(context.Background(), SwapLedgerInput{SwapID: q.ID, UserID: user, Side: SideBuy, NGNKobo: 1_000_000, FeeKobo: 7_500}); err != nil {
		t.Fatal(err)
	}
	got, err := r.svc.Confirm(context.Background(), user, q.ID)
	if err != nil || got.State != cryptoprov.SwapStateProcessing {
		t.Fatalf("resume: %+v, %v", got, err)
	}
	if r.led.bal(walletK) != 992_500 || r.prov.confirms != 1 {
		t.Fatalf("wallet=%d confirms=%d: the hold must not post twice", r.led.bal(walletK), r.prov.confirms)
	}
}

func TestTradeGateRefusalAtConfirmClaimsNothing(t *testing.T) {
	r := newSvcRig(t)
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	r.svc.cfg.Gate = okGate{err: errors.New("frozen")}
	if _, err := r.svc.Confirm(context.Background(), user, q.ID); err == nil {
		t.Fatal("gate ignored at confirm")
	}
	if s, _, _ := r.store.SwapByID(context.Background(), user, q.ID); s.State != cryptoprov.SwapStateQuoted || r.led.bal(walletK) != 2_000_000 {
		t.Fatalf("state=%s wallet=%d", s.State, r.led.bal(walletK))
	}
}

func TestConcurrentFirstQuotesCreateOneProviderAccount(t *testing.T) {
	r := newSvcRig(t)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _ = r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "k" + string(rune('a'+i)), Asset: "USDT", NGNKobo: 1_000_000})
		}(i)
	}
	wg.Wait()
	if n := r.prov.AccountsCreated(); n != 1 {
		t.Fatalf("provider accounts created = %d, want 1", n)
	}
}
