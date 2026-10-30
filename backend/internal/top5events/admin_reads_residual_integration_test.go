//go:build integration

// Admin reads that used to be zero-filled: vendor fee preview, per-event
// residual refunds, and float stranded on CLOSED event wallets.
//
// Run with: go test -tags=integration ./internal/top5events/... (TEST_DATABASE_URL set)
package top5events_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestIntegration_AdminReads_VendorFeePreviewMatchesSettlementMath(t *testing.T) {
	ctx := context.Background()
	f := seedTapChargeSettleFixture(t, ctx)
	pool := itestPool(t)
	t.Cleanup(pool.Close)

	if _, err := pool.Exec(ctx, `UPDATE events SET fee_bps=750 WHERE id=$1`, f.eventID); err != nil {
		t.Fatalf("set fee_bps: %v", err)
	}
	if _, err := f.svc.TapCharge(ctx, f.vendorOperator, f.vendorID, f.walletID, 33_33, "itest-fee-"+uuid.New().String()); err != nil {
		t.Fatalf("tap charge: %v", err)
	}

	rows, err := f.svc.AdminListVendors(ctx, "", "")
	if err != nil {
		t.Fatalf("AdminListVendors: %v", err)
	}
	for _, v := range rows {
		if v.ID != f.vendorID {
			continue
		}
		wantFee := int64(33_33) * 750 / 10000
		if v.CollectedKobo != 33_33 || v.FeesKobo != wantFee || v.NetPayableKobo != 33_33-wantFee {
			t.Fatalf("collected/fee/net = %d/%d/%d, want 3333/%d/%d", v.CollectedKobo, v.FeesKobo, v.NetPayableKobo, wantFee, 33_33-wantFee)
		}
		return
	}
	t.Fatal("seeded vendor missing from AdminListVendors")
}

func TestIntegration_AdminReads_ResidualRefundedAndPending(t *testing.T) {
	ctx := context.Background()
	f := seedTapChargeSettleFixture(t, ctx)
	pool := itestPool(t)
	t.Cleanup(pool.Close)

	if _, err := f.svc.TapCharge(ctx, f.vendorOperator, f.vendorID, f.walletID, 40_00, "itest-res-"+uuid.New().String()); err != nil {
		t.Fatalf("tap charge: %v", err)
	}
	if err := f.svc.CloseWallet(ctx, f.walletID); err != nil {
		t.Fatalf("close wallet: %v", err)
	}

	line := func() (refunded, pending int64) {
		t.Helper()
		cf, err := f.svc.AdminGetCashlessFloat(ctx)
		if err != nil {
			t.Fatalf("AdminGetCashlessFloat: %v", err)
		}
		for _, l := range cf.Lines {
			if l.EventID == f.eventID {
				return l.ResidualRefundedKobo, l.ResidualPendingKobo
			}
		}
		t.Fatal("event missing from cashless lines")
		return 0, 0
	}

	// 100_00 loaded − 40_00 spent ⇒ 60_00 refunded on close, nothing stranded.
	if refunded, pending := line(); refunded != 60_00 || pending != 0 {
		t.Fatalf("after close: refunded/pending = %d/%d, want 6000/0", refunded, pending)
	}

	// Simulate a defect: float lands on a wallet that is already CLOSED. The
	// admin read must surface it rather than assume CloseWallet always ran.
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_wallet_ledger (id, wallet_id, type, amount_kobo, reference, idempotency_key) VALUES ($1,$2,'TOPUP',1500,'itest',$3)`,
		uuid.New().String(), f.walletID, "itest-stranded-"+uuid.New().String()); err != nil {
		t.Fatalf("seed stranded float: %v", err)
	}
	if _, pending := line(); pending != 15_00 {
		t.Fatalf("stranded pending = %d, want 1500", pending)
	}
	d, err := f.svc.AdminGetDashboard(ctx)
	if err != nil {
		t.Fatalf("AdminGetDashboard: %v", err)
	}
	if d.ResidualPendingKobo < 15_00 {
		t.Fatalf("dashboard residual pending = %d, want >= 1500", d.ResidualPendingKobo)
	}
}
