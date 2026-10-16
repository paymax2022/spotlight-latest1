package pricingadmin

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/crossborder/pricing"
)

// Live DB (TEST_DATABASE_URL, migration 20271045000000 applied): the persisted
// fee schedule round-trips into pricing.FeeSchedule, self-approval is refused
// by the store itself, and a newer approved version supersedes the old window.
func TestLiveDB_FeeScheduleMakerCheckerAndRoundTrip(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	st := NewPGStore(pool)

	eff := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	svc := "livetest-" + time.Now().Format("150405.000000")
	rec, err := st.CreateFeeRuleChange(ctx, FeeRuleRecord{
		Level: int(pricing.LevelCorridorService), Service: svc, Corridor: "USD-NGN",
		FlatMinor: 100, PctBPS: 50, MaxMinor: 5000, PayerMode: "FEE_ON_TOP",
		EffectiveFrom: &eff, Maker: "maker-a", Reason: "live test",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM public.crossborder_fee_rules WHERE rule_key = $1::uuid`, rec.RuleKey)
	})
	if rec.Version != 1 || rec.Status != StatusPending {
		t.Fatalf("created %+v", rec)
	}
	if _, err := st.ApproveFeeRule(ctx, rec.ID, "MAKER-A", time.Now()); !errors.Is(err, ErrSelfApproval) {
		t.Fatalf("self-approve err = %v, want ErrSelfApproval", err)
	}
	if _, err := st.ApproveFeeRule(ctx, rec.ID, "checker-b", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ApproveFeeRule(ctx, rec.ID, "checker-b", time.Now()); !errors.Is(err, ErrNotPending) {
		t.Fatalf("re-approve err = %v, want ErrNotPending", err)
	}

	// Round trip: active schedule contains the rule and validates.
	sched, err := st.ActiveFeeSchedule(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := sched.Validate(); err != nil {
		t.Fatalf("persisted schedule invalid: %v", err)
	}
	var found *pricing.FeeRule
	for i := range sched.Rules {
		if sched.Rules[i].ID == rec.ID {
			found = &sched.Rules[i]
		}
	}
	if found == nil || found.Fee.FlatMinor != 100 || found.Fee.PctBPS != 50 || found.Fee.MaxMinor != 5000 ||
		found.Maker != "maker-a" || found.Checker != "checker-b" || found.Status != pricing.StatusActive || found.ValidFrom.IsZero() {
		t.Fatalf("round trip lost data: %+v", found)
	}

	// New version approved with a later start supersedes v1 without a gap.
	later := time.Now().UTC().Add(2 * time.Hour).Truncate(time.Second)
	v2, err := st.CreateFeeRuleChange(ctx, FeeRuleRecord{
		RuleKey: rec.RuleKey, Level: rec.Level, Service: svc, Corridor: "USD-NGN",
		FlatMinor: 200, PctBPS: 60, PayerMode: "FEE_ON_TOP", EffectiveFrom: &later, Maker: "maker-a", Reason: "v2",
	})
	if err != nil || v2.Version != 2 {
		t.Fatalf("v2 %+v err=%v", v2, err)
	}
	if _, err := st.ApproveFeeRule(ctx, v2.ID, "checker-b", time.Now()); err != nil {
		t.Fatal(err)
	}
	old, _ := st.GetFeeRule(ctx, rec.ID)
	if old.EffectiveTo == nil || !old.EffectiveTo.Equal(later) || old.Status != StatusActive {
		t.Fatalf("v1 not end-dated at v2 start: %+v", old)
	}

	// Rollback to v1 -> pending v3, needs a checker.
	v3, err := st.RollbackFeeRule(ctx, rec.RuleKey, 1, "maker-c", "revert", later)
	if err != nil || v3.Version != 3 || v3.Status != StatusPending || v3.FlatMinor != 100 || v3.RolledBackFrom != rec.ID {
		t.Fatalf("rollback %+v err=%v", v3, err)
	}
	if _, err := st.RollbackFeeRule(ctx, rec.RuleKey, 99, "maker-c", "x", later); !errors.Is(err, ErrVersionNotFound) {
		t.Fatalf("rollback missing err = %v", err)
	}
}
