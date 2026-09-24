//go:build integration

// Integration tests for two defects found live during Events Tickets
// (Module 19) UAT, neither of which had ANY prior test coverage exercising
// the real Service methods against a real Postgres:
//
//   - TapCharge had no caller/ownership check at all — any authenticated
//     user who knew (or, per GET /:id/vendors, could simply read) a vendor
//     id could tap-charge an attendee's wallet and have the float credited
//     to a vendor they don't control. The pure-logic TestTapCharge_* tests
//     in service_money_test.go never call Service.TapCharge itself — they
//     test the settlement-fee math in isolation — so this authz gap was
//     invisible to the existing suite.
//   - SettleVendor's SUM(...) FOR UPDATE query is rejected outright by
//     Postgres ("FOR UPDATE is not allowed with aggregate functions"), so
//     every real settlement failed before any payout. The passing
//     TestSettleVendor_* tests in service_durability_test.go are a pure
//     in-memory crash-ordering simulation (runSettle/effectLog) that never
//     issues the real SQL, so this was also invisible to the existing suite.
//
// Run with: go test -tags=integration ./internal/top5events/... (TEST_DATABASE_URL set)
package top5events_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	top5events "spotlight/backend/internal/top5events"
)

// tapChargeSettleFixture seeds a full LIVE event: organiser, buyer (funded
// event-wallet), vendor (with its own operator user), through GoLive, one
// ticket tier, and an open event-wallet ready to tap-charge against.
type tapChargeSettleFixture struct {
	svc                        *top5events.Service
	eventID                    string
	organiser, buyer           string
	vendorOperator, vendorID   string
	stranger                   string
	walletID                   string
}

func seedTapChargeSettleFixture(t *testing.T, ctx context.Context) tapChargeSettleFixture {
	t.Helper()
	pool := itestPool(t)
	t.Cleanup(pool.Close)
	svc := newTestService(t, pool)

	organiser := seedUser(t, pool)
	buyer := seedUser(t, pool)
	vendorOperator := seedUser(t, pool)
	stranger := seedUser(t, pool)

	ev, err := svc.CreateEvent(ctx, organiser, top5events.Event{
		Title: "tapcharge-settle itest", StartsAt: time.Now(), EndsAt: time.Now().Add(6 * time.Hour),
	})
	if err != nil {
		t.Fatalf("create event: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM events WHERE id=$1`, ev.ID) })
	if err := svc.Submit(ctx, organiser, ev.ID); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if err := svc.Approve(ctx, "admin", ev.ID); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if err := svc.GoLive(ctx, organiser, ev.ID); err != nil {
		t.Fatalf("golive: %v", err)
	}

	vendor, err := svc.AddVendor(ctx, organiser, ev.ID, top5events.Vendor{UserID: vendorOperator, Name: "Test Vendor"})
	if err != nil {
		t.Fatalf("add vendor: %v", err)
	}

	wal, err := svc.OpenWallet(ctx, buyer, ev.ID)
	if err != nil {
		t.Fatalf("open wallet: %v", err)
	}
	// TopUpAgent is a cash-collected-on-site rail — it credits the sub-balance
	// directly with no attendee-main-wallet debit, so it needs no KYC tier
	// setup at all (avoids an unrelated tier-0 gate masking this test).
	if _, err := svc.TopUp(ctx, buyer, wal.ID, 100_00, top5events.TopUpAgent, "itest-topup-"+uuid.New().String()); err != nil {
		t.Fatalf("topup: %v", err)
	}

	return tapChargeSettleFixture{
		svc: svc, eventID: ev.ID, organiser: organiser, buyer: buyer,
		vendorOperator: vendorOperator, vendorID: vendor.ID, stranger: stranger, walletID: wal.ID,
	}
}

// TestIntegration_TapCharge_RejectsNonVendorCaller locks the authZ fix: a
// caller who is not the vendor's own operator (a random stranger, or even
// the event's organiser) must be refused — the float must never move.
func TestIntegration_TapCharge_RejectsNonVendorCaller(t *testing.T) {
	ctx := context.Background()
	f := seedTapChargeSettleFixture(t, ctx)

	for name, caller := range map[string]string{"stranger": f.stranger, "organiser": f.organiser, "buyer_themselves": f.buyer} {
		t.Run(name, func(t *testing.T) {
			_, err := f.svc.TapCharge(ctx, caller, f.vendorID, f.walletID, 10_00, "itest-tap-"+name+"-"+uuid.New().String())
			if err == nil {
				t.Fatalf("TapCharge by %s (not the vendor's own operator) must be refused, got nil error", name)
			}
		})
	}
}

// TestIntegration_TapCharge_AllowsVendorOperator is the companion positive
// case: the vendor's own registered operator must still be able to
// tap-charge normally.
func TestIntegration_TapCharge_AllowsVendorOperator(t *testing.T) {
	ctx := context.Background()
	f := seedTapChargeSettleFixture(t, ctx)

	charge, err := f.svc.TapCharge(ctx, f.vendorOperator, f.vendorID, f.walletID, 10_00, "itest-tap-ok-"+uuid.New().String())
	if err != nil {
		t.Fatalf("TapCharge by the vendor's own operator must succeed: %v", err)
	}
	if charge.AmountKobo != 10_00 {
		t.Fatalf("charge amount = %d, want 1000", charge.AmountKobo)
	}
}

// TestIntegration_SettleVendor_RealSQLSucceeds locks the SQL fix: the
// FOR-UPDATE-with-aggregate query must not error, and a real settlement must
// actually pay the vendor out. This test needs the vendor's operator at a
// real KYC tier (SettleVendor's own HL-10-style payout gate) — bumped
// directly via SQL, matching the KYC-tier-bump convention already
// established elsewhere in this session's live-DB tests.
func TestIntegration_SettleVendor_RealSQLSucceeds(t *testing.T) {
	ctx := context.Background()
	f := seedTapChargeSettleFixture(t, ctx)
	pool := itestPool(t)
	t.Cleanup(pool.Close)

	if _, err := f.svc.TapCharge(ctx, f.vendorOperator, f.vendorID, f.walletID, 10_00, "itest-tap-settle-"+uuid.New().String()); err != nil {
		t.Fatalf("tap charge: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE user_profiles SET kyc_tier=2 WHERE id=$1`, f.vendorOperator); err != nil {
		t.Fatalf("bump vendor kyc tier: %v", err)
	}

	net, err := f.svc.SettleVendor(ctx, f.eventID, f.vendorID, "itest-settle-"+uuid.New().String())
	if err != nil {
		t.Fatalf("SettleVendor must not error on the FOR-UPDATE+aggregate query: %v", err)
	}
	if net <= 0 || net > 10_00 {
		t.Fatalf("settled net = %d, want a positive amount <= 1000 (gross minus fee)", net)
	}

	var settledCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM vendor_float WHERE vendor_id=$1 AND settled=true`, f.vendorID).Scan(&settledCount); err != nil {
		t.Fatalf("count settled float: %v", err)
	}
	if settledCount != 1 {
		t.Fatalf("settled float rows = %d, want 1", settledCount)
	}
}
