package cryptosvc

// Sell (crypto -> NGN) through the same quote -> confirm -> settle pipeline as a buy.
// The crypto sits in the user's provider sub-account, so a sell holds NO NGN: the
// provider executes against the crypto it holds, and the NGN proceeds (minus the fee)
// are paid to the wallet only when the provider confirms (Settler.CompleteSell).

import (
	"context"
	"errors"
	"testing"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

func (r *svcRig) sellQuote(t *testing.T, key, amount string) SwapRecord {
	t.Helper()
	q, err := r.svc.Quote(context.Background(), QuoteRequest{
		UserID: user, IdempotencyKey: key, Asset: "USDT", Side: SideSell, Amount: decimal.RequireFromString(amount),
	})
	if err != nil {
		t.Fatalf("sell quote: %v", err)
	}
	return q
}

func sellRig(t *testing.T) *svcRig {
	r := newSvcRig(t)
	r.prov.SetPrice("USDTNGN", decimal.RequireFromString("1500")) // 1 USDT = ₦1,500
	return r
}

func TestSellQuotePersistsTheSideAndMovesNoMoney(t *testing.T) {
	r := sellRig(t)
	q := r.sellQuote(t, "s1", "10")
	if q.Side != SideSell || q.FromCurrency != "USDT" || q.ToCurrency != "NGN" {
		t.Fatalf("quote %+v", q)
	}
	if !q.FromAmount.Equal(decimal.NewFromInt(10)) || q.NGNKobo != 1_500_000 {
		t.Fatalf("from=%s ngn_kobo=%d, want 10 USDT and 1,500,000 kobo", q.FromAmount, q.NGNKobo)
	}
	if q.FeeKobo <= 0 {
		t.Fatalf("a sell quote must show its fee, got %d", q.FeeKobo)
	}
	if r.led.total() != 0 {
		t.Fatalf("a quote moved money: %d", r.led.total())
	}
}

func TestSellQuoteReplayAndConflicts(t *testing.T) {
	r := sellRig(t)
	a := r.sellQuote(t, "s1", "10")
	b := r.sellQuote(t, "s1", "10")
	if a.ID != b.ID {
		t.Fatal("same key, same body must return the same quote")
	}
	_, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "s1", Asset: "USDT", Side: SideSell, Amount: decimal.NewFromInt(11)})
	if !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("a different amount under the same key: %v, want conflict", err)
	}
	_, err = r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "s1", Asset: "USDT", NGNKobo: 1_500_000})
	if !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("a buy under a sell's key: %v, want conflict", err)
	}
}

func TestSellQuoteValidatesBeforeTheProvider(t *testing.T) {
	r := sellRig(t)
	for name, req := range map[string]QuoteRequest{
		"zero amount":     {UserID: user, IdempotencyKey: "v1", Asset: "USDT", Side: SideSell},
		"negative amount": {UserID: user, IdempotencyKey: "v2", Asset: "USDT", Side: SideSell, Amount: decimal.NewFromInt(-1)},
		"NGN asset":       {UserID: user, IdempotencyKey: "v3", Asset: "NGN", Side: SideSell, Amount: decimal.NewFromInt(1)},
		"unknown side":    {UserID: user, IdempotencyKey: "v4", Asset: "USDT", Side: Side("short"), Amount: decimal.NewFromInt(1)},
	} {
		if _, err := r.svc.Quote(context.Background(), req); err == nil {
			t.Fatalf("%s: want a refusal", name)
		}
	}
}

func TestSellConfirmHoldsNothingThenPaysProceedsMinusFeeOnCompletion(t *testing.T) {
	r := sellRig(t)
	q := r.sellQuote(t, "s1", "10")
	clearingAtConfirm, walletAtConfirm := int64(-1), int64(-1)
	r.prov.onConfirm = func() { clearingAtConfirm, walletAtConfirm = r.led.bal(clearK), r.led.bal(walletK) }

	got, err := r.svc.Confirm(context.Background(), user, q.ID)
	if err != nil {
		t.Fatal(err)
	}
	if clearingAtConfirm != 0 || walletAtConfirm != 0 {
		t.Fatalf("a sell must hold no NGN: clearing=%d wallet=%d when the provider was asked", clearingAtConfirm, walletAtConfirm)
	}
	if got.State != cryptoprov.SwapStateProcessing || got.ProviderSwapID == "" {
		t.Fatalf("after confirm: %+v", got)
	}
	if r.led.bal(walletK) != 0 {
		t.Fatal("proceeds must not be paid before the provider confirms")
	}

	_ = r.prov.CompleteSwap(got.ProviderSwapID, cryptoprov.SwapCompleted)
	done, err := r.svc.Resolve(context.Background(), user, q.ID)
	if err != nil || done.State != cryptoprov.SwapStateCompleted {
		t.Fatalf("resolve: %+v, %v", done, err)
	}
	fee, _ := FeeKobo(1_500_000, q.FeeBps)
	if r.led.bal(walletK) != 1_500_000-fee || r.led.bal(revenueK) != fee {
		t.Fatalf("wallet=%d revenue=%d, want %d and %d", r.led.bal(walletK), r.led.bal(revenueK), 1_500_000-fee, fee)
	}
	if r.led.total() != 0 {
		t.Fatalf("value not conserved (clearing mirrors the NGN the provider now holds): %d", r.led.total())
	}
}

func TestSellRefusedByTheProviderFailsWithNoLedgerMovement(t *testing.T) {
	r := sellRig(t)
	q := r.sellQuote(t, "s1", "10")
	r.prov.confirmErr = &cryptoprov.APIError{Provider: "mock", Status: 422, Code: "insufficient_balance"}
	if _, err := r.svc.Confirm(context.Background(), user, q.ID); err == nil {
		t.Fatal("expected the refusal to surface")
	}
	if s, _, _ := r.store.SwapByID(context.Background(), user, q.ID); s.State != cryptoprov.SwapStateFailed {
		t.Fatalf("state = %s, want failed", s.State)
	}
	if r.led.total() != 0 || r.led.bal(walletK) != 0 {
		t.Fatal("a refused sell must move no money")
	}
}

func TestSellAmbiguousOutcomeParksForReview(t *testing.T) {
	r := sellRig(t)
	q := r.sellQuote(t, "s1", "10")
	r.prov.confirmErr = &cryptoprov.APIError{Provider: "mock", Status: 503}
	if _, err := r.svc.Confirm(context.Background(), user, q.ID); err == nil {
		t.Fatal("ambiguous outcome reported as success")
	}
	if s, _, _ := r.store.SwapByID(context.Background(), user, q.ID); s.State != cryptoprov.SwapStateNeedsReview {
		t.Fatalf("state = %s, want needs_review", s.State)
	}
	if r.led.total() != 0 {
		t.Fatal("an ambiguous sell must move no money")
	}
}

func TestExpiredSellQuoteIsNeverExecuted(t *testing.T) {
	r := sellRig(t)
	q := r.sellQuote(t, "s1", "10")
	r.now = q.ExpiresAt.Add(1)
	if _, err := r.svc.Confirm(context.Background(), user, q.ID); !errors.Is(err, ErrQuoteExpired) {
		t.Fatalf("err = %v, want ErrQuoteExpired", err)
	}
	if r.prov.confirms != 0 {
		t.Fatal("the provider was asked to execute an expired sell")
	}
}

func TestAdminReleaseOfAParkedSellMovesNoMoney(t *testing.T) {
	r := sellRig(t)
	q := r.sellQuote(t, "s1", "10")
	r.prov.confirmErr = &cryptoprov.APIError{Provider: "mock", Status: 503} // parks it: outcome unknown
	if _, err := r.svc.Confirm(context.Background(), user, q.ID); err == nil {
		t.Fatal("ambiguous outcome reported as success")
	}
	if _, err := r.svc.AdminResolve(context.Background(), "admin:op-1", "rel-1", q.ID, DecisionRelease, "provider never executed"); err != nil {
		t.Fatalf("release: %v", err)
	}
	if rec, _, _ := r.store.SwapByIDAny(context.Background(), q.ID); rec.State != cryptoprov.SwapStateFailed {
		t.Fatalf("state = %s, want failed", rec.State)
	}
	if r.led.total() != 0 {
		t.Fatal("releasing a sell must not post NGN legs: a sell holds none")
	}
}

func TestSellQuoteAboveTheMaximumIsRefusedWithoutWrapping(t *testing.T) {
	r := newSvcRig(t)
	r.prov.SetPrice("USDTNGN", decimal.RequireFromString("1e30")) // would wrap int64 kobo
	_, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "big", Asset: "USDT", Side: SideSell, Amount: decimal.NewFromInt(1)})
	if err == nil {
		t.Fatal("an out-of-range sell was quoted")
	}
}
