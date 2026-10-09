package healthpharmacy_test

// LIVE-DB regression for E2E-HLT-002: GET /admin/dispense-audit must not 500.
// The optional pharmacy_provider_id filter binds NULL for "no filter" and
// compares in a single typed context ($1::uuid) — a `($1 = '' OR col = $1)`
// shape still evaluates the uuid comparison per row and Postgres rejects
// `uuid = ''` with `invalid input syntax for type uuid`, filtered or not.
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestLiveDB_AdminDispenseAudit_UnfilteredAndFiltered(t *testing.T) {
	pool := adminPool(t)
	ctx := context.Background()
	f := newAdminFixture(t, ctx, pool)

	// The pharmacist (order's pharmacy owner) dispensed the CONFIRMED order —
	// one immutable dispense_records row, exactly as Service.Dispense writes.
	dispenseID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO dispense_records (id, order_id, prescription_id, pharmacist_id)
		 VALUES ($1,$2,NULL,$3)`, dispenseID, f.confirmedID, f.owner); err != nil {
		t.Fatalf("seed dispense record: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM dispense_records WHERE id=$1`, dispenseID)
	})

	// UNFILTERED — the call that 500'd on `uuid = ''` before the fix.
	all, err := f.svc.AdminDispenseAudit(ctx, "")
	if err != nil {
		t.Fatalf("AdminDispenseAudit(unfiltered): %v", err)
	}
	var sawOurs bool
	for _, r := range all {
		if r["id"] == dispenseID {
			sawOurs = true
			if r["order_id"] != f.confirmedID {
				t.Errorf("row order_id = %v, want %s", r["order_id"], f.confirmedID)
			}
			if r["pharmacy_provider_id"] != f.pharmacy {
				t.Errorf("row pharmacy_provider_id = %v, want %s", r["pharmacy_provider_id"], f.pharmacy)
			}
		}
	}
	if !sawOurs {
		t.Error("unfiltered audit is missing the seeded dispense record")
	}

	// Filtered to our pharmacy — contains exactly our record.
	filtered, err := f.svc.AdminDispenseAudit(ctx, f.pharmacy)
	if err != nil {
		t.Fatalf("AdminDispenseAudit(filtered): %v", err)
	}
	if len(filtered) != 1 || filtered[0]["id"] != dispenseID {
		t.Fatalf("filtered audit = %v, want exactly [%s]", filtered, dispenseID)
	}

	// Filtered to an unrelated pharmacy — the filter must actually narrow.
	other, err := f.svc.AdminDispenseAudit(ctx, uuid.New().String())
	if err != nil {
		t.Fatalf("AdminDispenseAudit(other pharmacy): %v", err)
	}
	for _, r := range other {
		if r["id"] == dispenseID {
			t.Error("a different pharmacy's filter returned our dispense record")
		}
	}
}
