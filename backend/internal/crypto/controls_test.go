package crypto

import (
	"context"
	"errors"
	"testing"
)

// The control funcs are consulted before anything moves. These tests drive the checks
// directly (the money paths need a live DB; their placement is first-statement-after-lookup).

func TestControlsAreOptionalButEnforcedWhenWired(t *testing.T) {
	s := &Service{}
	if err := s.checkTrade(context.Background(), "BTC"); err != nil {
		t.Fatalf("unwired controls must not block: %v", err)
	}
	var seen []string
	s.WithControls(func(_ context.Context, sym string) error {
		seen = append(seen, sym)
		if sym == "DOGE" {
			return ErrMarketDisabled
		}
		return nil
	}, func(context.Context) error { return ErrWithdrawalsPaused })
	if err := s.checkTrade(context.Background(), "BTC", "DOGE"); !errors.Is(err, ErrMarketDisabled) {
		t.Fatalf("a swap touching a disabled market: %v", err)
	}
	if len(seen) != 2 {
		t.Fatalf("both legs must be checked: %v", seen)
	}
	if err := s.checkWithdraw(context.Background()); !errors.Is(err, ErrWithdrawalsPaused) {
		t.Fatalf("kill switch: %v", err)
	}
}

func TestKillSwitchBlocksApprovalButNotRejection(t *testing.T) {
	s := (&Service{}).WithControls(nil, func(context.Context) error { return ErrWithdrawalsPaused })
	if _, err := s.AdminDecideWithdrawal(context.Background(), "admin", "w1", "approve", ""); !errors.Is(err, ErrWithdrawalsPaused) {
		t.Fatalf("approve under the kill switch: %v", err)
	}
	if _, err := s.Withdraw(context.Background(), "u", "a", "addr", 10, 0, "k"); !errors.Is(err, ErrWithdrawalsPaused) {
		t.Fatalf("withdraw under the kill switch: %v", err)
	}
}

func TestAWithdrawalNeedsAnIndependentDecider(t *testing.T) {
	if err := independentApprover("admin-1", "admin-1"); !errors.Is(err, ErrSelfDecision) {
		t.Fatalf("self-decision: %v", err)
	}
	if err := independentApprover("", "user-1"); !errors.Is(err, ErrSelfDecision) {
		t.Fatalf("anonymous decision: %v", err)
	}
	if err := independentApprover("admin-1", "user-1"); err != nil {
		t.Fatalf("independent decision refused: %v", err)
	}
}

func TestLegacyTradeLimit(t *testing.T) {
	s := (&Service{}).WithTradeLimit(func(_ context.Context, k int64) error {
		if k > 100 {
			return ErrAboveTradeLimit
		}
		return nil
	})
	if err := s.checkLimit(context.Background(), 101); !errors.Is(err, ErrAboveTradeLimit) {
		t.Fatalf("over the limit: %v", err)
	}
	if err := s.checkLimit(context.Background(), 100); err != nil {
		t.Fatalf("at the limit: %v", err)
	}
	if err := independentApprover("ABC-1", "abc-1"); !errors.Is(err, ErrSelfDecision) {
		t.Fatal("self-decision must be caught regardless of id case")
	}
}
