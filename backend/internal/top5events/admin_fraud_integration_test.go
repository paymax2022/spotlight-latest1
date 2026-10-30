//go:build integration

// Admin fraud queue: derived signals + append-only reviewer decisions.
//
// Run with: go test -tags=integration ./internal/top5events/... (TEST_DATABASE_URL set)
package top5events_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	top5events "spotlight/backend/internal/top5events"
)

func findSignal(t *testing.T, svc *top5events.Service, kind, id string) *top5events.AdminFraudSignal {
	t.Helper()
	rows, err := svc.AdminListFraudSignals(context.Background(), "", kind, "")
	if err != nil {
		t.Fatalf("AdminListFraudSignals: %v", err)
	}
	for i := range rows {
		if rows[i].ID == id {
			return &rows[i]
		}
	}
	return nil
}

func TestIntegration_AdminFraud_VendorSelfChargeDetectedAndBlocked(t *testing.T) {
	ctx := context.Background()
	f := seedTapChargeSettleFixture(t, ctx)
	pool := itestPool(t)
	t.Cleanup(pool.Close)

	// The vendor's own operator opens a wallet at the event and charges it.
	own, err := f.svc.OpenWallet(ctx, f.vendorOperator, f.eventID)
	if err != nil {
		t.Fatalf("open own wallet: %v", err)
	}
	if _, err := f.svc.TopUp(ctx, f.vendorOperator, own.ID, 50_00, top5events.TopUpAgent, "itest-fraud-topup-"+uuid.New().String()); err != nil {
		t.Fatalf("topup own wallet: %v", err)
	}
	if _, err := f.svc.TapCharge(ctx, f.vendorOperator, f.vendorID, own.ID, 20_00, "itest-fraud-self-"+uuid.New().String()); err != nil {
		t.Fatalf("self charge: %v", err)
	}
	// A normal charge on someone else's wallet must not be flagged on its own.
	id := "vendor_self_charge:" + f.vendorID
	sig := findSignal(t, f.svc, "vendor_self_charge", id)
	if sig == nil {
		t.Fatal("self-charge signal not derived")
	}
	if sig.Status != "open" || sig.Severity != "critical" || sig.AmountKobo != 20_00 || sig.EventID != f.eventID {
		t.Fatalf("signal = %+v, want open/critical/2000 on the fixture event", *sig)
	}

	if _, err := f.svc.AdminActionFraudSignal(ctx, f.organiser, id, "block", ""); !errors.Is(err, top5events.ErrValidation) {
		t.Fatalf("block without note: err = %v, want ErrValidation", err)
	}
	if _, err := f.svc.AdminActionFraudSignal(ctx, f.organiser, "vendor_self_charge:"+uuid.New().String(), "investigate", ""); !errors.Is(err, top5events.ErrNotFound) {
		t.Fatalf("unknown signal: err = %v, want ErrNotFound", err)
	}

	var reviewsTable bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public.event_fraud_reviews') IS NOT NULL`).Scan(&reviewsTable); err != nil {
		t.Fatalf("table check: %v", err)
	}
	if !reviewsTable {
		t.Skip("event_fraud_reviews migration not applied — skipping the write half")
	}

	res, err := f.svc.AdminActionFraudSignal(ctx, f.organiser, id, "block", "operator charging own wallet")
	if err != nil {
		t.Fatalf("block: %v", err)
	}
	if res.Status != "blocked" || res.AuditID == "" {
		t.Fatalf("result = %+v, want blocked with a review id", *res)
	}
	var active bool
	if err := pool.QueryRow(ctx, `SELECT active FROM event_vendors WHERE id=$1`, f.vendorID).Scan(&active); err != nil {
		t.Fatalf("vendor active: %v", err)
	}
	if active {
		t.Fatal("blocking a self-charge signal must deactivate the vendor")
	}
	if sig := findSignal(t, f.svc, "vendor_self_charge", id); sig == nil || sig.Status != "blocked" {
		t.Fatalf("signal after block = %+v, want blocked", sig)
	}
}

func TestIntegration_AdminFraud_TopupBurstDetected(t *testing.T) {
	ctx := context.Background()
	f := seedTapChargeSettleFixture(t, ctx)

	// Fixture already posted one top-up; four more makes a 5-in-an-hour burst.
	for i := 0; i < 4; i++ {
		if _, err := f.svc.TopUp(ctx, f.buyer, f.walletID, 10_00, top5events.TopUpAgent, "itest-burst-"+uuid.New().String()); err != nil {
			t.Fatalf("topup %d: %v", i, err)
		}
	}
	rows, err := f.svc.AdminListFraudSignals(ctx, "", "abnormal_topup", "")
	if err != nil {
		t.Fatalf("AdminListFraudSignals: %v", err)
	}
	for _, r := range rows {
		if r.EventID == f.eventID {
			if r.AmountKobo != 140_00 {
				t.Fatalf("burst amount = %d, want 14000", r.AmountKobo)
			}
			return
		}
	}
	t.Fatal("top-up burst on the fixture wallet not derived")
}
