package healthvet_test

// LIVE-DB: admin payout decisions are idempotent, KYC-gated (HL-10) and
// single-decision per accrual snapshot. Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	healthvet "spotlight/backend/internal/health/vet"
)

type fakePayoutGate struct{ ok bool }

func (g *fakePayoutGate) PayoutEligible(context.Context, string) (bool, error) { return g.ok, nil }

func TestLiveDB_AdminDecidePayout_IdempotentGatedSingleDecision(t *testing.T) {
	pool := vetAdminDashboardPool(t)
	ctx := t.Context()
	f := newVetAdminFixture(t, ctx, pool)
	if _, err := pool.Exec(ctx, `UPDATE vet_appointment_payments SET pay_state='RELEASED' WHERE appointment_id=$1`, f.completedID); err != nil {
		t.Fatalf("release leg: %v", err)
	}
	gate := &fakePayoutGate{ok: false}
	svc := healthvet.NewService(pool, nil, nil, nil, gate, nil, nil, nil, nil, nil, nil)
	admin := f.other

	// KYC below tier → recorded as kyc_hold, not approved.
	k1 := "vet-payout-" + uuid.NewString()
	r, err := svc.AdminDecidePayout(ctx, admin, f.provider, "approve", "", k1)
	if err != nil || r.PayoutStatus != "kyc_hold" || r.ReleasedKobo != 500000 {
		t.Fatalf("kyc gate: %+v %v", r, err)
	}
	// Same key replays without writing.
	r2, err := svc.AdminDecidePayout(ctx, admin, f.provider, "approve", "", k1)
	if err != nil || !r2.Replayed || r2.DecisionID != r.DecisionID {
		t.Fatalf("replay: %+v %v", r2, err)
	}
	// Same key, different decision → conflict.
	if _, err := svc.AdminDecidePayout(ctx, admin, f.provider, "reject", "", k1); !errors.Is(err, healthvet.ErrPayoutIdemConflict) {
		t.Fatalf("key reuse: %v", err)
	}

	gate.ok = true
	r3, err := svc.AdminDecidePayout(ctx, admin, f.provider, "approve", "kyc cleared", "vet-payout-"+uuid.NewString())
	if err != nil || r3.PayoutStatus != "approved" {
		t.Fatalf("approve: %+v %v", r3, err)
	}
	if _, err := svc.AdminDecidePayout(ctx, admin, f.provider, "reject", "", "vet-payout-"+uuid.NewString()); !errors.Is(err, healthvet.ErrPayoutDecided) {
		t.Fatalf("second decision on same snapshot: %v", err)
	}

	rows, err := svc.AdminConsolePayouts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range rows {
		if p.ID == f.provider {
			found = true
			if p.PayoutStatus != "approved" || !p.KYCVerified {
				t.Fatalf("list row: %+v", p)
			}
		}
	}
	if !found {
		t.Fatal("provider accrual missing from payouts list")
	}

	if _, err := svc.AdminDecidePayout(ctx, admin, uuid.NewString(), "approve", "", "vet-payout-"+uuid.NewString()); !errors.Is(err, healthvet.ErrPayoutNotFound) {
		t.Fatalf("unknown provider: %v", err)
	}
}
