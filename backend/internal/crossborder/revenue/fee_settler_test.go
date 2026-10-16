package revenue_test

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/crossborder/revenue"
)

func TestFeeSettler_PendingThenSettledAfterRestart(t *testing.T) {
	ctx := context.Background()
	l, c := accruedBoth(t)
	// restarted process: empty store, record rebuilt from the ledger
	fs := revenue.NewFeeSettler(revenue.NewRecognizer(l, c, revenue.NewMemStore()))

	amt, pending, err := fs.PendingFee(ctx, "t1", "send")
	if err != nil || !pending || amt != 5000 {
		t.Fatalf("amt=%d pending=%v err=%v", amt, pending, err)
	}
	for i := 0; i < 2; i++ { // idempotent
		if err := fs.SettleFee(ctx, "t1", "send", "verto-tr-1"); err != nil {
			t.Fatal(err)
		}
	}
	if _, pending, _ := fs.PendingFee(ctx, "t1", "send"); pending {
		t.Fatal("settled fee must not be pending")
	}
	if c.rows["cb:t1:platform_fee:send"] == nil || len(c.rows) != 1 {
		t.Fatalf("commission roll-up: %v", c.rows)
	}
	if l.balances["unswept-1"] != 0 {
		t.Fatalf("fees_unswept not drained: %d", l.balances["unswept-1"])
	}
}

func TestFeeSettler_UnknownAndServiceMismatch(t *testing.T) {
	ctx := context.Background()
	l, c := accruedBoth(t)
	fs := revenue.NewFeeSettler(revenue.NewRecognizer(l, c, revenue.NewMemStore()))
	if _, _, err := fs.PendingFee(ctx, "nope", "send"); err == nil {
		t.Fatal("unknown transfer must error")
	}
	if _, _, err := fs.PendingFee(ctx, "t1", "fx"); !errors.Is(err, revenue.ErrInvalid) {
		t.Fatalf("service mismatch: %v", err)
	}
}
