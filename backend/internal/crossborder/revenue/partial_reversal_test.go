package revenue_test

import (
	"context"
	"testing"

	"spotlight/backend/internal/crossborder/revenue"
)

// Crash between the wallet reversal and the fees_unswept release, then restart:
// the fee must rebuild as ACCRUED (not REVERSED) so Reverse completes the release.
func TestRestart_PartialFeeReversal_UnsweptReleaseStillPosted(t *testing.T) {
	ctx := context.Background()
	l, c := accruedBoth(t)
	// Simulated first run: wallet reversal landed, process died before the unswept release.
	if err := l.PostReversal(ctx, "wallet-1", "rev-send", 5000, "cb:platform_fee:reversal:t1:send", "cb:t1:platform_fee:send:reverse"); err != nil {
		t.Fatal(err)
	}
	if l.balances["unswept-1"] != 5000 {
		t.Fatalf("precondition: unswept should still hold 5000, got %d", l.balances["unswept-1"])
	}

	r2 := revenue.NewRecognizer(l, c, revenue.NewMemStore()) // restart
	rec, ok, err := r2.Record(ctx, "t1", revenue.ComponentPlatformFee)
	if err != nil || !ok || rec.State != revenue.StateAccrued {
		t.Fatalf("partially reversed fee must rebuild ACCRUED, got %+v ok=%v err=%v", rec, ok, err)
	}
	for i := 0; i < 2; i++ { // and the completion is idempotent
		if err := r2.Reverse(ctx, "t1", "refund"); err != nil {
			t.Fatal(err)
		}
	}
	if l.balances["unswept-1"] != 0 {
		t.Fatalf("fees_unswept stranded after partial reversal + restart: %d", l.balances["unswept-1"])
	}
	if l.balances["wallet-1"] != 0 || l.balances["rev-send"] != 0 {
		t.Fatalf("wallet/revenue double-reversed or not restored: wallet=%d rev=%d", l.balances["wallet-1"], l.balances["rev-send"])
	}
	// Fully reversed now: a further restart rebuilds REVERSED.
	r3 := revenue.NewRecognizer(l, c, revenue.NewMemStore())
	if rec, _, _ := r3.Record(ctx, "t1", revenue.ComponentPlatformFee); rec.State != revenue.StateReversed {
		t.Fatalf("want REVERSED after full reversal, got %s", rec.State)
	}
}
