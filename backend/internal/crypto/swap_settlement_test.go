package crypto

import (
	"errors"
	"testing"
	"time"
)

func TestSwapSettlementFor(t *testing.T) {
	at := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	settled := &SwapOrder{ID: "o1", UserID: "u1", LedgerSettled: true, SettledAt: &at}
	pending := &SwapOrder{ID: "o2", UserID: "u1"}

	t.Run("owner sees settled status", func(t *testing.T) {
		s, err := swapSettlementFor(settled, "u1")
		if err != nil || !s.LedgerSettled || s.SettledAt == nil || !s.SettledAt.Equal(at) {
			t.Fatalf("got %+v, %v", s, err)
		}
	})
	t.Run("owner sees pending with nil settled_at", func(t *testing.T) {
		s, err := swapSettlementFor(pending, "u1")
		if err != nil || s.LedgerSettled || s.SettledAt != nil {
			t.Fatalf("got %+v, %v", s, err)
		}
	})
	t.Run("missing order is ErrNotFound", func(t *testing.T) {
		if _, err := swapSettlementFor(nil, "u1"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("want ErrNotFound, got %v", err)
		}
	})
	t.Run("non-owner is ErrForbidden", func(t *testing.T) {
		if _, err := swapSettlementFor(settled, "u2"); !errors.Is(err, ErrForbidden) {
			t.Fatalf("want ErrForbidden, got %v", err)
		}
	})
	t.Run("empty caller is forbidden", func(t *testing.T) {
		if _, err := swapSettlementFor(settled, ""); !errors.Is(err, ErrForbidden) {
			t.Fatalf("want ErrForbidden, got %v", err)
		}
	})
}
