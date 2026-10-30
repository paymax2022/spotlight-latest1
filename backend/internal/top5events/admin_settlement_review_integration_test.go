//go:build integration

// Settlement-break detection/review and the vendor payout decision.
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

func requireSettlementReviews(t *testing.T, ctx context.Context) {
	t.Helper()
	pool := itestPool(t)
	t.Cleanup(pool.Close)
	var ok bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public.event_settlement_reviews') IS NOT NULL`).Scan(&ok); err != nil {
		t.Fatalf("table check: %v", err)
	}
	if !ok {
		t.Skip("event_settlement_reviews migration not applied")
	}
}

func settlementLine(t *testing.T, svc *top5events.Service, eventID string) *top5events.AdminSettlementLine {
	t.Helper()
	view, err := svc.AdminGetSettlement(context.Background())
	if err != nil {
		t.Fatalf("AdminGetSettlement: %v", err)
	}
	for i := range view.Lines {
		if view.Lines[i].EventID == eventID {
			return &view.Lines[i]
		}
	}
	return nil
}

func TestIntegration_SettlementBreak_DetectedReviewedAndReopened(t *testing.T) {
	ctx := context.Background()
	f := seedTapChargeSettleFixture(t, ctx)
	requireSettlementReviews(t, ctx)
	pool := itestPool(t)
	t.Cleanup(pool.Close)

	if _, err := f.svc.TapCharge(ctx, f.vendorOperator, f.vendorID, f.walletID, 10_00, "itest-brk-"+uuid.New().String()); err != nil {
		t.Fatalf("tap charge: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE user_profiles SET kyc_tier=2 WHERE id=$1`, f.vendorOperator); err != nil {
		t.Fatalf("bump kyc: %v", err)
	}
	if _, err := f.svc.SettleVendor(ctx, f.eventID, f.vendorID, "itest-brk-settle-"+uuid.New().String()); err != nil {
		t.Fatalf("settle: %v", err)
	}
	if l := settlementLine(t, f.svc, f.eventID); l == nil || l.BreakKobo != 0 || l.Status != "settled" {
		t.Fatalf("clean settlement line = %+v, want settled with no break", l)
	}

	// Defect: float marked settled with no settlement row behind it.
	if _, err := pool.Exec(ctx,
		`INSERT INTO vendor_float (id, vendor_id, amount_kobo, reference, idempotency_key, settled, settled_at) VALUES ($1,$2,700,'itest',$3,true,now())`,
		uuid.New().String(), f.vendorID, "itest-brk-float-"+uuid.New().String()); err != nil {
		t.Fatalf("seed break: %v", err)
	}
	// vendor_float now exceeds vendor_charges by 700 and settled float exceeds
	// settled gross by 700 — both invariants report it.
	l := settlementLine(t, f.svc, f.eventID)
	if l == nil || l.BreakKobo != 14_00 || l.Status != "open" {
		t.Fatalf("broken line = %+v, want open with 1400 break", l)
	}

	if _, err := f.svc.AdminResolveSettlementBreak(ctx, f.organiser, l.ID, "resolve", ""); !errors.Is(err, top5events.ErrValidation) {
		t.Fatalf("resolve without note: err = %v, want ErrValidation", err)
	}
	res, err := f.svc.AdminResolveSettlementBreak(ctx, f.organiser, l.ID, "investigate", "")
	if err != nil || res.Status != "investigating" || res.AuditID == "" {
		t.Fatalf("investigate = %+v, %v", res, err)
	}
	if l := settlementLine(t, f.svc, f.eventID); l.Status != "investigating" {
		t.Fatalf("status after investigate = %q", l.Status)
	}
	d, err := f.svc.AdminGetDashboard(ctx)
	if err != nil || d.SettlementBreaks < 1 || d.SettlementBreakKobo < 14_00 {
		t.Fatalf("dashboard breaks = %d/%d, %v; want >=1 / >=1400", d.SettlementBreaks, d.SettlementBreakKobo, err)
	}

	// The delta moves ⇒ the earlier review no longer applies.
	if _, err := pool.Exec(ctx,
		`INSERT INTO vendor_float (id, vendor_id, amount_kobo, reference, idempotency_key, settled, settled_at) VALUES ($1,$2,100,'itest',$3,true,now())`,
		uuid.New().String(), f.vendorID, "itest-brk-float2-"+uuid.New().String()); err != nil {
		t.Fatalf("seed second delta: %v", err)
	}
	if l := settlementLine(t, f.svc, f.eventID); l.Status != "open" || l.BreakKobo != 16_00 {
		t.Fatalf("after delta moved = %+v, want reopened at 1600", l)
	}
}

func findVendor(t *testing.T, svc *top5events.Service, id string) *top5events.AdminVendorRecord {
	t.Helper()
	rows, err := svc.AdminListVendors(context.Background(), "", "")
	if err != nil {
		t.Fatalf("AdminListVendors: %v", err)
	}
	for i := range rows {
		if rows[i].ID == id {
			return &rows[i]
		}
	}
	t.Fatal("vendor missing")
	return nil
}

func TestIntegration_VendorPayout_RejectThenApproveIdempotent(t *testing.T) {
	ctx := context.Background()
	f := seedTapChargeSettleFixture(t, ctx)
	requireSettlementReviews(t, ctx)
	pool := itestPool(t)
	t.Cleanup(pool.Close)

	if _, err := f.svc.TapCharge(ctx, f.vendorOperator, f.vendorID, f.walletID, 25_00, "itest-pay-"+uuid.New().String()); err != nil {
		t.Fatalf("tap charge: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE user_profiles SET kyc_tier=2 WHERE id=$1`, f.vendorOperator); err != nil {
		t.Fatalf("bump kyc: %v", err)
	}

	if _, err := f.svc.AdminDecideVendorPayout(ctx, f.organiser, f.vendorID, "reject", "", ""); !errors.Is(err, top5events.ErrValidation) {
		t.Fatalf("reject without note: err = %v, want ErrValidation", err)
	}
	if _, err := f.svc.AdminDecideVendorPayout(ctx, f.organiser, f.vendorID, "approve", "", ""); !errors.Is(err, top5events.ErrValidation) {
		t.Fatalf("approve without key: err = %v, want ErrValidation", err)
	}
	if _, err := f.svc.AdminDecideVendorPayout(ctx, f.organiser, f.vendorID, "reject", "receipts missing", ""); err != nil {
		t.Fatalf("reject: %v", err)
	}
	if v := findVendor(t, f.svc, f.vendorID); v.PayoutStatus != "rejected" {
		t.Fatalf("payout_status after reject = %q, want rejected", v.PayoutStatus)
	}

	key := "itest-pay-approve-" + uuid.New().String()
	first, err := f.svc.AdminDecideVendorPayout(ctx, f.organiser, f.vendorID, "approve", "ok", key)
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if first.PayoutStatus != "paid" || first.NetKobo <= 0 || first.NetKobo > 25_00 {
		t.Fatalf("approve result = %+v", *first)
	}
	again, err := f.svc.AdminDecideVendorPayout(ctx, f.organiser, f.vendorID, "approve", "ok", key)
	if err != nil {
		t.Fatalf("approve replay must succeed idempotently: %v", err)
	}
	if again.AuditID != first.AuditID || again.NetKobo != first.NetKobo {
		t.Fatalf("replay = %+v, want same audit id and net as %+v", *again, *first)
	}
	var settlements int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM event_settlements WHERE vendor_id=$1`, f.vendorID).Scan(&settlements); err != nil {
		t.Fatalf("count settlements: %v", err)
	}
	if settlements != 1 {
		t.Fatalf("settlements = %d, want exactly 1 after a replayed approval", settlements)
	}
}
