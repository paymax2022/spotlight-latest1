package crypto

import (
	"errors"
	"testing"
)

func TestNormalizeProviderSwapStatus(t *testing.T) {
	for in, want := range map[string]string{
		"completed": "completed", "COMPLETED": "completed", " success ": "completed", "done": "completed",
		"failed": "failed", "Cancelled": "failed", "rejected": "failed",
	} {
		got, err := normalizeProviderSwapStatus(in)
		if err != nil || got != want {
			t.Errorf("%q -> %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"pending", "processing", "", "'; DROP TABLE x;--"} {
		if _, err := normalizeProviderSwapStatus(in); !errors.Is(err, ErrBadRequest) {
			t.Errorf("%q: want ErrBadRequest, got %v", in, err)
		}
	}
}

func TestSwapInitialStatus(t *testing.T) {
	if got := swapInitialStatus(SwapOrder{}); got != "filled" {
		t.Errorf("internal swap status = %q, want filled", got)
	}
	if got := swapInitialStatus(SwapOrder{SwapTransactionID: "tx_1"}); got != "executing" {
		t.Errorf("provider swap status = %q, want executing", got)
	}
}

// A completed + ledger_settled swap is consistent (counted as reconciled by
// ReconcileSwapOrders); a completed-but-unsettled swap is drift.
func TestDetectOrderDriftSettledSwap(t *testing.T) {
	if d := detectOrderDrift(&SwapOrder{Status: "completed", LedgerSettled: true}); d != "" {
		t.Errorf("settled completed swap flagged as drift: %q", d)
	}
	if d := detectOrderDrift(&SwapOrder{Status: "completed"}); d == "" {
		t.Error("completed but unsettled swap must be drift")
	}
	if d := detectOrderDrift(&SwapOrder{Status: "executing"}); d != "" {
		t.Errorf("executing swap awaiting webhook flagged as drift: %q", d)
	}
}

func TestSettleSwapOrderLedgerRejectsEmptyID(t *testing.T) {
	var s Service
	if err := s.SettleSwapOrderLedger(nil, ""); !errors.Is(err, ErrBadRequest) { //nolint:staticcheck
		t.Fatalf("want ErrBadRequest, got %v", err)
	}
}
