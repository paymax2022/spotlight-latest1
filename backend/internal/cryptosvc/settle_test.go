package cryptosvc

import (
	"context"
	"errors"
	"testing"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/finance/ledger"
)

const (
	user     = "user-1"
	walletK  = "user:" + user
	clearK   = "std:crypto_clearing"
	revenueK = "std:paymax_revenue"
)

func newSettler(t *testing.T) (*Settler, *fakeLedger) {
	t.Helper()
	l := newFakeLedger()
	return NewSettler(l), l
}

func buy(ngn, fee int64) SwapLedgerInput {
	return SwapLedgerInput{SwapID: "s1", UserID: user, Side: SideBuy, NGNKobo: ngn, FeeKobo: fee}
}

func TestBuyHoldMovesPrincipalPlusFeeIntoClearing(t *testing.T) {
	s, l := newSettler(t)
	l.fund(user, 2_000_000)
	if err := s.HoldBuy(context.Background(), buy(1_000_000, 7_500)); err != nil {
		t.Fatal(err)
	}
	if l.bal(walletK) != 992_500 || l.bal(clearK) != 1_007_500 {
		t.Fatalf("wallet=%d clearing=%d", l.bal(walletK), l.bal(clearK))
	}
	if l.total() != 2_000_000 {
		t.Fatalf("money created or destroyed: total=%d", l.total())
	}
}

func TestBuyHoldRefusesWhenTheWalletCannotCover(t *testing.T) {
	s, l := newSettler(t)
	l.fund(user, 1_000_000) // principal only; fee not covered
	err := s.HoldBuy(context.Background(), buy(1_000_000, 7_500))
	if !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("err = %v", err)
	}
	if l.bal(clearK) != 0 || len(l.posted) != 0 {
		t.Fatal("a refused hold left legs behind")
	}
}

func TestBuyHoldReplayIsANoOp(t *testing.T) {
	s, l := newSettler(t)
	l.fund(user, 2_000_000)
	for i := 0; i < 3; i++ {
		if err := s.HoldBuy(context.Background(), buy(1_000_000, 7_500)); err != nil {
			t.Fatalf("replay %d: %v", i, err)
		}
	}
	if l.bal(clearK) != 1_007_500 {
		t.Fatalf("replay double-posted: clearing=%d", l.bal(clearK))
	}
}

func TestReplayAfterTheCacheSaysDuplicateIsVerifiedNotTrusted(t *testing.T) {
	s, l := newSettler(t)
	l.fund(user, 2_000_000)
	if err := s.HoldBuy(context.Background(), buy(1_000_000, 7_500)); err != nil {
		t.Fatal(err)
	}
	l.duplicateOnReplay = true // the Redis fast path answers ErrDuplicate without comparing
	if err := s.HoldBuy(context.Background(), buy(1_000_000, 7_500)); err != nil {
		t.Fatalf("identical replay rejected: %v", err)
	}
	// Same key, different amount: a foreign or tampered retry must fail closed.
	if err := s.HoldBuy(context.Background(), buy(2_000_000, 15_000)); err == nil {
		t.Fatal("a different journal under the same key was accepted as done")
	}
}

func TestBuyCompletionRecognisesTheFeeOnce(t *testing.T) {
	s, l := newSettler(t)
	l.fund(user, 2_000_000)
	ctx := context.Background()
	_ = s.HoldBuy(ctx, buy(1_000_000, 7_500))
	for i := 0; i < 2; i++ {
		if err := s.CompleteBuy(ctx, buy(1_000_000, 7_500)); err != nil {
			t.Fatal(err)
		}
	}
	if l.bal(clearK) != 1_000_000 || l.bal(revenueK) != 7_500 {
		t.Fatalf("clearing=%d revenue=%d", l.bal(clearK), l.bal(revenueK))
	}
	if l.total() != 2_000_000 {
		t.Fatalf("total=%d", l.total())
	}
}

func TestBuyCompletionWithoutAHoldPostsNothing(t *testing.T) {
	s, l := newSettler(t)
	if err := s.CompleteBuy(context.Background(), buy(1_000_000, 7_500)); err == nil {
		t.Fatal("fee recognised from a hold that never existed")
	}
	if l.bal(revenueK) != 0 {
		t.Fatalf("revenue = %d", l.bal(revenueK))
	}
}

func TestZeroFeeBuyPostsNoFeeLeg(t *testing.T) {
	s, l := newSettler(t)
	l.fund(user, 1_000_000)
	ctx := context.Background()
	if err := s.HoldBuy(ctx, buy(1_000_000, 0)); err != nil {
		t.Fatal(err)
	}
	if err := s.CompleteBuy(ctx, buy(1_000_000, 0)); err != nil {
		t.Fatal(err)
	}
	if l.bal(revenueK) != 0 || l.bal(clearK) != 1_000_000 {
		t.Fatalf("revenue=%d clearing=%d", l.bal(revenueK), l.bal(clearK))
	}
}

func TestFailedBuyReleasesTheWholeHold(t *testing.T) {
	s, l := newSettler(t)
	l.fund(user, 2_000_000)
	ctx := context.Background()
	_ = s.HoldBuy(ctx, buy(1_000_000, 7_500))
	for i := 0; i < 2; i++ {
		if err := s.FailBuy(ctx, buy(1_000_000, 7_500)); err != nil {
			t.Fatal(err)
		}
	}
	if l.bal(walletK) != 2_000_000 || l.bal(clearK) != 0 {
		t.Fatalf("wallet=%d clearing=%d, want the user made whole", l.bal(walletK), l.bal(clearK))
	}
}

func TestFailedBuyWithoutAHoldCreditsNothing(t *testing.T) {
	s, l := newSettler(t)
	l.fund(user, 500)
	if err := s.FailBuy(context.Background(), buy(1_000_000, 7_500)); err != nil {
		t.Fatalf("a failure with nothing held must be a no-op, got %v", err)
	}
	if l.bal(walletK) != 500 {
		t.Fatalf("wallet = %d: a release credited money that was never held", l.bal(walletK))
	}
}

func TestACompletedBuyCanNeverBeReleased(t *testing.T) {
	s, l := newSettler(t)
	l.fund(user, 2_000_000)
	ctx := context.Background()
	_ = s.HoldBuy(ctx, buy(1_000_000, 7_500))
	_ = s.CompleteBuy(ctx, buy(1_000_000, 7_500))
	if err := s.FailBuy(ctx, buy(1_000_000, 7_500)); err == nil {
		t.Fatal("a completed buy was refunded")
	}
	if l.bal(walletK) != 992_500 {
		t.Fatalf("wallet = %d", l.bal(walletK))
	}
}

func TestACompletionAfterARefundIsRefused(t *testing.T) {
	s, l := newSettler(t)
	l.fund(user, 2_000_000)
	ctx := context.Background()
	_ = s.HoldBuy(ctx, buy(1_000_000, 7_500))
	_ = s.FailBuy(ctx, buy(1_000_000, 7_500))
	if err := s.CompleteBuy(ctx, buy(1_000_000, 7_500)); err == nil {
		t.Fatal("fee recognised on a refunded buy")
	}
	if l.bal(revenueK) != 0 {
		t.Fatalf("revenue = %d", l.bal(revenueK))
	}
}

func sell(gross string) (SwapLedgerInput, decimal.Decimal) {
	return SwapLedgerInput{SwapID: "s2", UserID: user, Side: SideSell, FeeBps: 75, NGNKobo: 1_000_000}, decimal.RequireFromString(gross)
}

func TestSellPaysTheWalletNetOfFeeFromClearing(t *testing.T) {
	s, l := newSettler(t)
	in, recv := sell("10000") // 10,000 NGN = 1,000,000 kobo -> fee 7,500
	if err := s.CompleteSell(context.Background(), in, recv); err != nil {
		t.Fatal(err)
	}
	if l.bal(walletK) != 992_500 || l.bal(revenueK) != 7_500 || l.bal(clearK) != -1_000_000 {
		t.Fatalf("wallet=%d revenue=%d clearing=%d", l.bal(walletK), l.bal(revenueK), l.bal(clearK))
	}
	if l.total() != 0 {
		t.Fatalf("a sell must be value-conserving: total=%d", l.total())
	}
}

func TestSellReplayDoesNotPayTwice(t *testing.T) {
	s, l := newSettler(t)
	in, recv := sell("10000")
	for i := 0; i < 3; i++ {
		if err := s.CompleteSell(context.Background(), in, recv); err != nil {
			t.Fatal(err)
		}
	}
	if l.bal(walletK) != 992_500 {
		t.Fatalf("wallet = %d", l.bal(walletK))
	}
}

func TestSellRecoversFromACrashBetweenItsTwoJournals(t *testing.T) {
	s, l := newSettler(t)
	in, recv := sell("10000")
	l.failKey, l.failErr = "crypto:swap:s2:fee", errors.New("process died")
	if err := s.CompleteSell(context.Background(), in, recv); err == nil {
		t.Fatal("expected the injected failure")
	}
	l.failKey = ""
	if err := s.CompleteSell(context.Background(), in, recv); err != nil {
		t.Fatal(err)
	}
	if l.bal(walletK) != 992_500 || l.bal(revenueK) != 7_500 {
		t.Fatalf("converged wrong: wallet=%d revenue=%d", l.bal(walletK), l.bal(revenueK))
	}
}

func TestSellRejectsFractionalKoboInsteadOfRounding(t *testing.T) {
	s, l := newSettler(t)
	in, _ := sell("0")
	if err := s.CompleteSell(context.Background(), in, decimal.RequireFromString("100.005")); err == nil {
		t.Fatal("a half-kobo amount was silently rounded")
	}
	if len(l.posted) != 0 {
		t.Fatal("legs posted for an unrepresentable amount")
	}
}

func TestSellRejectsNonPositiveProceeds(t *testing.T) {
	s, _ := newSettler(t)
	in, _ := sell("0")
	for _, v := range []string{"0", "-5"} {
		if err := s.CompleteSell(context.Background(), in, decimal.RequireFromString(v)); err == nil {
			t.Errorf("accepted proceeds %s", v)
		}
	}
}

func TestDispatchByCompletedAndFailedForEachSide(t *testing.T) {
	s, l := newSettler(t)
	l.fund(user, 2_000_000)
	ctx := context.Background()
	b := SwapRecord{ID: "b1", UserID: user, Side: SideBuy, NGNKobo: 1_000_000, FeeKobo: 7_500}
	_ = s.HoldBuy(ctx, SwapLedgerInput{SwapID: "b1", UserID: user, Side: SideBuy, NGNKobo: 1_000_000, FeeKobo: 7_500})
	if err := s.Complete(ctx, b, decimal.RequireFromString("0.5")); err != nil {
		t.Fatal(err)
	}
	if l.bal(revenueK) != 7_500 {
		t.Fatalf("buy completion did not settle: revenue=%d", l.bal(revenueK))
	}
	// A sell failing posts nothing: no NGN ever moved.
	sl := SwapRecord{ID: "s9", UserID: user, Side: SideSell, FeeBps: 75, NGNKobo: 1_000_000}
	if err := s.Fail(ctx, sl); err != nil {
		t.Fatal(err)
	}
	// A crypto-to-crypto swap has no NGN leg: nothing to post, not an error.
	x := SwapRecord{ID: "x1", UserID: user, Side: SideSwap}
	if err := s.Complete(ctx, x, decimal.RequireFromString("1")); err != nil {
		t.Fatalf("swap with no NGN leg: %v", err)
	}
	// An unknown side fails closed rather than skipping money silently.
	bad := SwapRecord{ID: "z", UserID: user, Side: Side("")}
	if err := s.Complete(ctx, bad, decimal.RequireFromString("1")); err == nil {
		t.Fatal("unknown side silently skipped")
	}
}

func TestInvalidInputsPostNothing(t *testing.T) {
	s, l := newSettler(t)
	l.fund(user, 5_000_000)
	ctx := context.Background()
	for name, in := range map[string]SwapLedgerInput{
		"no swap id":   {UserID: user, Side: SideBuy, NGNKobo: 100},
		"no user":      {SwapID: "s", Side: SideBuy, NGNKobo: 100},
		"zero ngn":     {SwapID: "s", UserID: user, Side: SideBuy},
		"negative fee": {SwapID: "s", UserID: user, Side: SideBuy, NGNKobo: 100, FeeKobo: -1},
		"fee > ngn":    {SwapID: "s", UserID: user, Side: SideBuy, NGNKobo: 100, FeeKobo: 101},
	} {
		if err := s.HoldBuy(ctx, in); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	if len(l.posted) != 0 {
		t.Fatalf("invalid inputs posted: %v", l.posted)
	}
}
