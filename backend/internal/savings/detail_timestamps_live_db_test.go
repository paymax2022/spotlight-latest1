package savings

// Live-DB test: single-entity detail reads must carry created_at/updated_at.
// The list queries always selected them, but getVault / getCircle / get (target)
// did not — so every detail response serialised "0001-01-01T00:00:00Z" while
// the same row in a list showed real times. Mobile renders the detail screen
// from these reads.
// ⚠️ GATED ON TEST_DATABASE_URL — same warning as list_balance_live_db_test.go:
// run against a LOCAL database only.

import (
	"context"
	"testing"

	"spotlight/backend/internal/scheduler"
)

func TestLiveDB_DetailReads_CarryTimestamps(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	owner := newTestOwner(t, pool)

	// Vault detail.
	vaultID := seedVault(t, pool, owner, "ts-vault", nil)
	v, err := (&VaultService{db: pool}).getVault(ctx, vaultID)
	if err != nil {
		t.Fatalf("getVault: %v", err)
	}
	if v.CreatedAt.IsZero() || v.UpdatedAt.IsZero() {
		t.Errorf("vault detail dropped timestamps: created=%v updated=%v", v.CreatedAt, v.UpdatedAt)
	}

	// Circle detail.
	var circleID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO ajo_circles (creator_user_id, name, contribution_kobo, interval_secs, state)
		 VALUES ($1,'ts-circle',1000,86400,'FORMING') RETURNING id`, owner).Scan(&circleID); err != nil {
		t.Fatalf("seed circle: %v", err)
	}
	c, err := (&AjoService{db: pool}).getCircle(ctx, circleID)
	if err != nil {
		t.Fatalf("getCircle: %v", err)
	}
	if c.CreatedAt.IsZero() || c.UpdatedAt.IsZero() {
		t.Errorf("circle detail dropped timestamps: created=%v updated=%v", c.CreatedAt, c.UpdatedAt)
	}

	// Target detail.
	var targetID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO group_targets (creator_user_id, name, target_kobo, withdrawal_rule, state)
		 VALUES ($1,'ts-goal',100000,'ON_DATE','OPEN') RETURNING id`, owner).Scan(&targetID); err != nil {
		t.Fatalf("seed target: %v", err)
	}
	tg, err := (&TargetService{db: pool}).get(ctx, targetID)
	if err != nil {
		t.Fatalf("get target: %v", err)
	}
	if tg.CreatedAt.IsZero() || tg.UpdatedAt.IsZero() {
		t.Errorf("target detail dropped timestamps: created=%v updated=%v", tg.CreatedAt, tg.UpdatedAt)
	}
}

// Re-enabling autosave on a vault that already has a job must CANCEL the prior
// job — otherwise both keep running and the orphaned one still debits at the
// old amount/cadence, unreachable via autosave_job_id.
func TestLiveDB_EnableAutoSave_ReplacesPriorJob(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	owner := newTestOwner(t, pool)
	vaultID := seedVault(t, pool, owner, "ts-autosave", nil)

	svc := &VaultService{db: pool, sched: scheduler.NewService(pool)}

	first, err := svc.EnableAutoSave(ctx, owner, vaultID, 1000, 86400)
	if err != nil {
		t.Fatalf("enable autosave #1: %v", err)
	}
	second, err := svc.EnableAutoSave(ctx, owner, vaultID, 2000, 3600)
	if err != nil {
		t.Fatalf("enable autosave #2: %v", err)
	}
	if first == second {
		t.Fatalf("re-enable returned the same job id %s — expected a replacement", first)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM scheduler_jobs WHERE id=$1`, first).Scan(&status); err != nil {
		t.Fatalf("read prior job status: %v", err)
	}
	if status != "cancelled" {
		t.Errorf("prior autosave job status = %q, want cancelled (orphan keeps debiting)", status)
	}
	var newStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM scheduler_jobs WHERE id=$1`, second).Scan(&newStatus); err != nil {
		t.Fatalf("read new job status: %v", err)
	}
	if newStatus != "active" {
		t.Errorf("new autosave job status = %q, want active", newStatus)
	}
}
