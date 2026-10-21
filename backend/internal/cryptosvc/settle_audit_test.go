package cryptosvc

// Regression tests for the independent ledger audit of PR #709.

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

// memLocker is an in-process SwapLocker.
type memLocker struct {
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func (m *memLocker) WithSwapLock(ctx context.Context, id string, fn func(context.Context) error) error {
	m.mu.Lock()
	if m.locks == nil {
		m.locks = map[string]*sync.Mutex{}
	}
	l := m.locks[id]
	if l == nil {
		l = &sync.Mutex{}
		m.locks[id] = l
	}
	m.mu.Unlock()
	l.Lock()
	defer l.Unlock()
	return fn(ctx)
}

func TestHoldBuyRefusesAnythingButABuy(t *testing.T) {
	s, l := newSettler(t)
	l.fund(user, 2_000_000)
	for _, side := range []Side{SideSell, SideSwap, Side("")} {
		in := buy(1_000_000, 7_500)
		in.Side = side
		if err := s.HoldBuy(context.Background(), in); err == nil {
			t.Errorf("HoldBuy accepted side %q", side)
		}
	}
	if len(l.posted) != 0 {
		t.Fatalf("posted: %v", l.posted)
	}
}

func TestASwapSideRowWithAHoldNeverSilentlySkipsTheMoney(t *testing.T) {
	// The column defaults to 'swap'. A buy row inserted without a side would otherwise
	// finish as failed with the NGN still parked in clearing.
	s, l := newSettler(t)
	l.fund(user, 2_000_000)
	ctx := context.Background()
	_ = s.HoldBuy(ctx, buy(1_000_000, 7_500)) // hold posted for swap s1
	wrong := SwapRecord{ID: "s1", UserID: user, Side: SideSwap}
	if err := s.Fail(ctx, wrong); !errors.Is(err, ErrSettlementConflict) {
		t.Fatalf("Fail err = %v, want ErrSettlementConflict", err)
	}
	if err := s.Complete(ctx, wrong, decimal.RequireFromString("1")); !errors.Is(err, ErrSettlementConflict) {
		t.Fatalf("Complete err = %v, want ErrSettlementConflict", err)
	}
}

func TestCompleteAndFailRacingNeverPostBothOutcomes(t *testing.T) {
	for i := 0; i < 200; i++ {
		l := newFakeLedger()
		s := NewSettler(l).WithLocker(&memLocker{})
		l.fund(user, 2_000_000)
		ctx := context.Background()
		in := buy(1_000_000, 7_500)
		_ = s.HoldBuy(ctx, in)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); _ = s.CompleteBuy(ctx, in) }()
		go func() { defer wg.Done(); _ = s.FailBuy(ctx, in) }()
		wg.Wait()
		_, fee := l.entries[swapKey("s1", "fee")+":credit"]
		_, rel := l.entries[swapKey("s1", "release")+":rev_debit"]
		if fee && rel {
			t.Fatalf("iteration %d: both the fee and the release posted", i)
		}
		if l.total() != 2_000_000 {
			t.Fatalf("iteration %d: value not conserved: %d", i, l.total())
		}
	}
}

func TestPermanentSettlementErrorsParkTheSwapInReview(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateProcessing)
	r.ing.WithSettler(&recSettler{err: ErrReplayMismatch})
	_ = r.mock.CompleteSwap(r.swap.ID, cryptoprov.SwapCompleted)
	out, err := r.deliver(t, "swap_transaction.completed")
	if err != nil || out != OutcomeApplied {
		t.Fatalf("out=%s err=%v: a permanent error must not retry forever", out, err)
	}
	if r.state() != cryptoprov.SwapStateNeedsReview {
		t.Fatalf("state = %s, want needs_review", r.state())
	}
}

func TestTransientSettlementErrorsStillRetry(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateProcessing)
	r.ing.WithSettler(&recSettler{err: ErrClaimedNotPosted})
	_ = r.mock.CompleteSwap(r.swap.ID, cryptoprov.SwapCompleted)
	if _, err := r.deliver(t, "swap_transaction.completed"); err == nil {
		t.Fatal("a transient error was swallowed")
	}
	if r.state() != cryptoprov.SwapStateProcessing {
		t.Fatalf("state = %s", r.state())
	}
}

func TestClaimedButNeverPostedIsTransientNotAMismatch(t *testing.T) {
	s, l := newSettler(t)
	l.fund(user, 2_000_000)
	l.claimOnly = map[string]bool{swapKey("s1", "hold"): true}
	err := s.HoldBuy(context.Background(), buy(1_000_000, 7_500))
	if !errors.Is(err, ErrClaimedNotPosted) || errors.Is(err, ErrPermanent) {
		t.Fatalf("err = %v, want a retryable ErrClaimedNotPosted", err)
	}
}

func TestSellPayoutOutsideTheQuoteBandIsRefused(t *testing.T) {
	s, l := newSettler(t)
	in, _ := sell("0") // quoted 1,000,000 kobo = 10,000 NGN, default band 5%
	for _, v := range []string{"10501", "9499", "1000000"} {
		err := s.CompleteSell(context.Background(), in, decimal.RequireFromString(v))
		if !errors.Is(err, ErrPermanent) {
			t.Errorf("%s: err = %v, want a permanent refusal", v, err)
		}
	}
	if len(l.posted) != 0 || l.bal(walletK) != 0 {
		t.Fatalf("an out-of-band payout posted: %v", l.posted)
	}
	// Inside the band is paid.
	if err := s.CompleteSell(context.Background(), in, decimal.RequireFromString("10400")); err != nil {
		t.Fatal(err)
	}
}

func TestSellWithoutAQuotedAmountIsRefused(t *testing.T) {
	s, _ := newSettler(t)
	in := SwapLedgerInput{SwapID: "s3", UserID: user, Side: SideSell, FeeBps: 75}
	if err := s.CompleteSell(context.Background(), in, decimal.RequireFromString("10000")); !errors.Is(err, ErrPermanent) {
		t.Fatalf("err = %v", err)
	}
}

// Out-of-range proceeds are a permanent error. (Sub-kobo fractions are floored, not
// refused: see TestSellFloorsFractionalKoboNeverRoundsUp.)
func TestUnrepresentableProceedsAreAPermanentError(t *testing.T) {
	s, _ := newSettler(t)
	in, _ := sell("0")
	if err := s.CompleteSell(context.Background(), in, decimal.RequireFromString("1e30")); !errors.Is(err, ErrPermanent) {
		t.Fatalf("err = %v", err)
	}
}
