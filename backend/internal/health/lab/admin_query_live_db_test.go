package healthlab_test

// ---------------------------------------------------------------------------
// LIVE-DB regression coverage for a SQL type-ambiguity bug found during
// Laboratory (Module 16) UAT, in the same shape as PHARMACY-006's
// AdminListOrders fix: AdminListOrders, AdminCustodyAudit, and
// AdminEscalations all reused one placeholder as both a `= ''` text-empty
// check and a `uuid` column comparison — Postgres rejects that the moment
// the lab_provider_id filter is actually supplied ("operator does not exist:
// uuid = text"). Fixed with nullable per-parameter comparisons, matching the
// pharmacy fix exactly, before this was ever hit live.
//
// Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	healthlab "spotlight/backend/internal/health/lab"
	"spotlight/backend/internal/testsupport"
)

func adminQueryPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping lab admin-query live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedAdminQueryFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (svc *healthlab.Service, labID, orderID string) {
	t.Helper()
	ownerID := uuid.New().String()
	patientID := uuid.New().String()
	labID = uuid.New().String()
	orderID = uuid.New().String()

	for _, u := range []string{ownerID, patientID} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		 VALUES ($1,$2,'LAB','lab','Admin Query UAT Lab','APPROVED')`, labID, ownerID); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_orders (id, patient_id, lab_provider_id, state, collection_method, total_kobo, idempotency_key)
		 VALUES ($1,$2,$3,'CREATED','WALK_IN',150000,$4)`,
		orderID, patientID, labID, "idem-adminquery-"+orderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM lab_orders WHERE id=$1`, orderID)
		pool.Exec(bg, `DELETE FROM health_providers WHERE id=$1`, labID)
	})
	svc = healthlab.NewService(pool, nil, nil, nil, nil, nil, nil, nil)
	return
}

// TestLiveDB_AdminListOrders_FilterByLabProviderIDDoesNotErrorOnUUID locks the
// fix: supplying a real lab_provider_id filter must not throw a Postgres
// type-mismatch error, and must actually scope the result to that lab.
func TestLiveDB_AdminListOrders_FilterByLabProviderIDDoesNotErrorOnUUID(t *testing.T) {
	pool := adminQueryPool(t)
	ctx := context.Background()
	svc, labID, orderID := seedAdminQueryFixture(t, ctx, pool)

	rows, err := svc.AdminListOrders(ctx, "", labID)
	if err != nil {
		t.Fatalf("AdminListOrders with a real lab_provider_id filter must not error: %v", err)
	}
	if len(rows) != 1 || rows[0]["id"] != orderID {
		t.Fatalf("AdminListOrders(labProviderID=%s) = %v, want exactly [%s]", labID, rows, orderID)
	}

	// A state filter combined with the uuid filter must also work.
	rows2, err := svc.AdminListOrders(ctx, "CREATED", labID)
	if err != nil {
		t.Fatalf("AdminListOrders with state+labProviderID filters must not error: %v", err)
	}
	if len(rows2) != 1 || rows2[0]["id"] != orderID {
		t.Fatalf("combined filter = %v, want exactly [%s]", rows2, orderID)
	}

	// A different (real, but non-matching) lab_provider_id must return zero
	// rows, not error and not return everyone's orders.
	other := uuid.New().String()
	rows3, err := svc.AdminListOrders(ctx, "", other)
	if err != nil {
		t.Fatalf("AdminListOrders with a non-matching lab_provider_id must not error: %v", err)
	}
	if len(rows3) != 0 {
		t.Fatalf("AdminListOrders(labProviderID=%s) = %d rows, want 0", other, len(rows3))
	}
}

// TestLiveDB_AdminCustodyAudit_FilterByLabProviderIDDoesNotErrorOnUUID and
// TestLiveDB_AdminEscalations_FilterByLabProviderIDDoesNotErrorOnUUID lock
// the identical fix in the two sibling admin queries. Both are exercised
// against an empty result set (no custody events / no escalated results
// seeded) since the point is proving the uuid filter no longer throws, not
// re-testing custody/escalation business logic.
func TestLiveDB_AdminCustodyAudit_FilterByLabProviderIDDoesNotErrorOnUUID(t *testing.T) {
	pool := adminQueryPool(t)
	ctx := context.Background()
	svc, labID, _ := seedAdminQueryFixture(t, ctx, pool)

	if _, err := svc.AdminCustodyAudit(ctx, labID, ""); err != nil {
		t.Fatalf("AdminCustodyAudit with a real lab_provider_id filter must not error: %v", err)
	}
}

func TestLiveDB_AdminEscalations_FilterByLabProviderIDDoesNotErrorOnUUID(t *testing.T) {
	pool := adminQueryPool(t)
	ctx := context.Background()
	svc, labID, _ := seedAdminQueryFixture(t, ctx, pool)

	if _, err := svc.AdminEscalations(ctx, labID); err != nil {
		t.Fatalf("AdminEscalations with a real lab_provider_id filter must not error: %v", err)
	}
}
