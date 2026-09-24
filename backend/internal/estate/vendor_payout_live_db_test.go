package estate

// ---------------------------------------------------------------------------
// UAT batch: live-DB coverage for the vendor RequestPayout money path and the
// vendor job FSM (backend/internal/estate/vendor.go), per docs/qa/modules/estate.md
// §4/§5 — ESTATE-INT-003, ESTATE-VAL-003, ESTATE-AUTHZ-006, ESTATE-IDEM-002,
// and the full FSM table ESTATE-FSM-001..008.
//
// Package estate (not estate_test) so the tests can reach unexported helpers
// (jobTransition targets are exercised only through the exported AcceptJob/
// RejectJob/CheckInAtGate/StartJob/MarkJobComplete/RequestPayout wrappers, which
// are already exported — no unexported access is actually required, but the
// file stays in-package to match vendor_test.go's convention).
//
// Skipped unless TEST_DATABASE_URL is set. Run locally with:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./backend/internal/estate/... -run TestLiveDB_VendorPayout -v
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

// ── fixtures ─────────────────────────────────────────────────────────────

func vendorPayoutPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB estate vendor payout test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedVendorPayoutAuthUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

// seedVendorEstate creates an estate with an estate_admin resident, returning
// (estateID, adminUserID).
func seedVendorEstate(t *testing.T, ctx context.Context, pool *pgxpool.Pool, svc *Service) (estateID, adminID string) {
	t.Helper()
	adminID = seedVendorPayoutAuthUser(t, ctx, pool)
	e, err := svc.CreateEstate(ctx, adminID, CreateEstateRequest{Name: "Payout Test Estate", Address: "1 Test Rd"})
	if err != nil {
		t.Fatalf("create estate: %v", err)
	}
	return e.ID, adminID
}

// seedVendor onboards a vendor (estate_vendors row) linked to a fresh auth user
// and immediately marks it verified (onboarding leaves status='pending', which
// is irrelevant to RequestPayout but kept realistic).
func seedVendor(t *testing.T, ctx context.Context, pool *pgxpool.Pool, svc *Service, estateID string) (vendorUserID string) {
	t.Helper()
	vendorUserID = seedVendorPayoutAuthUser(t, ctx, pool)
	if _, err := svc.OnboardVendor(ctx, estateID, vendorUserID, OnboardVendorRequest{BusinessName: "Fixit Co", Category: "plumbing"}); err != nil {
		t.Fatalf("onboard vendor: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE estate_vendors SET status='verified', verified=TRUE WHERE estate_id=$1 AND user_id=$2`, estateID, vendorUserID); err != nil {
		t.Fatalf("verify vendor: %v", err)
	}
	return vendorUserID
}

// seedVendorJob assigns a job (as the estate admin) to the given vendor user,
// returning the job id. Status starts 'available'.
func seedVendorJob(t *testing.T, ctx context.Context, svc *Service, estateID, adminID, vendorUserID string, amountKobo int64) string {
	t.Helper()
	prof, err := svc.GetVendorProfile(ctx, estateID, vendorUserID)
	if err != nil {
		t.Fatalf("get vendor profile: %v", err)
	}
	job, err := svc.AssignJob(ctx, estateID, adminID, AssignJobRequest{VendorID: prof.ID, Title: "Fix the gate", AmountKobo: amountKobo})
	if err != nil {
		t.Fatalf("assign job: %v", err)
	}
	return job.ID
}

func vendorWalletBalance(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN e.type IN ('CREDIT','REVERSAL_CREDIT') THEN e.amount_kobo ELSE -e.amount_kobo END),0)
		FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
		WHERE a.user_id=$1`, userID).Scan(&bal); err != nil {
		t.Fatalf("wallet balance for %s: %v", userID, err)
	}
	return bal
}

// creditLegsForRef counts and sums CREDIT ledger_entries rows for a reference —
// used to prove idempotency posts exactly one credit leg, not just that the
// balance looks right (a bug could double-post and net to the same balance if
// paired with an accidental double-debit; counting rows rules that out).
func creditLegsForRef(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ref string) (count int, total int64) {
	t.Helper()
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE reference=$1 AND type='CREDIT'`,
		ref).Scan(&count, &total); err != nil {
		t.Fatalf("credit legs for %s: %v", ref, err)
	}
	return count, total
}

func debitLegsForRef(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ref string) (count int, total int64) {
	t.Helper()
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE reference=$1 AND type='DEBIT'`,
		ref).Scan(&count, &total); err != nil {
		t.Fatalf("debit legs for %s: %v", ref, err)
	}
	return count, total
}

func jobStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, jobID string) string {
	t.Helper()
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM vendor_jobs WHERE id=$1`, jobID).Scan(&status); err != nil {
		t.Fatalf("job status for %s: %v", jobID, err)
	}
	return status
}

func newVendorPayoutService(pool *pgxpool.Pool) (*Service, LedgerPoster) {
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, nil).WithLedger(led)
	return svc, led
}

// ── ESTATE-INT-003 ──────────────────────────────────────────────────────────

func TestLiveDB_VendorPayout_CompletedJobCreditsVendorWallet(t *testing.T) {
	pool := vendorPayoutPool(t)
	ctx := context.Background()
	svc, _ := newVendorPayoutService(pool)

	estateID, adminID := seedVendorEstate(t, ctx, pool, svc)
	vendorUserID := seedVendor(t, ctx, pool, svc, estateID)
	jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendorUserID, 1_200_000)

	if _, err := svc.AcceptJob(ctx, estateID, vendorUserID, jobID); err != nil {
		t.Fatalf("accept job: %v", err)
	}
	if _, err := svc.StartJob(ctx, estateID, vendorUserID, jobID); err != nil {
		t.Fatalf("start job: %v", err)
	}
	if _, err := svc.MarkJobComplete(ctx, estateID, vendorUserID, jobID); err != nil {
		t.Fatalf("mark complete: %v", err)
	}

	balBefore := vendorWalletBalance(t, ctx, pool, vendorUserID)

	key := "int003-" + uuid.New().String()
	job, err := svc.RequestPayout(ctx, estateID, vendorUserID, jobID, key)
	if err != nil {
		t.Fatalf("RequestPayout: %v", err)
	}
	if job.Status != "paid" {
		t.Fatalf("job status = %q, want paid", job.Status)
	}
	if job.PaidAt == nil {
		t.Fatalf("paid_at not set")
	}
	if job.PayoutRef == "" {
		t.Fatalf("payout_ref not set")
	}

	ref := "estate_vendor_payout:" + estateID + ":" + jobID
	if job.PayoutRef != ref {
		t.Fatalf("payout_ref = %q, want %q", job.PayoutRef, ref)
	}

	// Balanced double-entry: CREDIT vendor wallet / DEBIT settlement, both exactly 1_200_000.
	creditCount, creditTotal := creditLegsForRef(t, ctx, pool, ref)
	debitCount, debitTotal := debitLegsForRef(t, ctx, pool, ref)
	if creditCount != 1 || creditTotal != 1_200_000 {
		t.Fatalf("credit legs = (%d, %d), want (1, 1200000)", creditCount, creditTotal)
	}
	if debitCount != 1 || debitTotal != 1_200_000 {
		t.Fatalf("debit legs = (%d, %d), want (1, 1200000)", debitCount, debitTotal)
	}

	balAfter := vendorWalletBalance(t, ctx, pool, vendorUserID)
	if balAfter-balBefore != 1_200_000 {
		t.Fatalf("vendor wallet delta = %d, want 1200000", balAfter-balBefore)
	}

	// Audit trail: VENDOR_PAYOUT row.
	var auditCount int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM estate_audit_log WHERE estate_id=$1 AND subject_id=$2 AND action='VENDOR_PAYOUT'`,
		estateID, jobID).Scan(&auditCount); err != nil {
		t.Fatalf("audit query: %v", err)
	}
	if auditCount != 1 {
		t.Fatalf("VENDOR_PAYOUT audit rows = %d, want 1", auditCount)
	}
}

// ── ESTATE-VAL-003 ──────────────────────────────────────────────────────────

func TestLiveDB_VendorPayout_RejectedWhenJobNotCompleted(t *testing.T) {
	pool := vendorPayoutPool(t)
	ctx := context.Background()
	svc, _ := newVendorPayoutService(pool)

	estateID, adminID := seedVendorEstate(t, ctx, pool, svc)
	vendorUserID := seedVendor(t, ctx, pool, svc, estateID)

	for _, tc := range []struct {
		name    string
		advance func(jobID string) error
	}{
		{"accepted", func(jobID string) error {
			_, err := svc.AcceptJob(ctx, estateID, vendorUserID, jobID)
			return err
		}},
		{"in_progress", func(jobID string) error {
			if _, err := svc.AcceptJob(ctx, estateID, vendorUserID, jobID); err != nil {
				return err
			}
			_, err := svc.StartJob(ctx, estateID, vendorUserID, jobID)
			return err
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendorUserID, 500_000)
			if err := tc.advance(jobID); err != nil {
				t.Fatalf("advance to %s: %v", tc.name, err)
			}

			balBefore := vendorWalletBalance(t, ctx, pool, vendorUserID)
			_, err := svc.RequestPayout(ctx, estateID, vendorUserID, jobID, "val003-"+uuid.New().String())
			if err == nil {
				t.Fatalf("expected error for payout on %s job, got nil", tc.name)
			}
			balAfter := vendorWalletBalance(t, ctx, pool, vendorUserID)
			if balAfter != balBefore {
				t.Fatalf("wallet balance changed on rejected payout: before=%d after=%d", balBefore, balAfter)
			}
			if status := jobStatus(t, ctx, pool, jobID); status != tc.name {
				t.Fatalf("job status = %q, want unchanged %q", status, tc.name)
			}
		})
	}
}

// ── ESTATE-AUTHZ-006 ────────────────────────────────────────────────────────

func TestLiveDB_VendorPayout_IDOR_CannotPayoutAnotherVendorsJob(t *testing.T) {
	pool := vendorPayoutPool(t)
	ctx := context.Background()
	svc, _ := newVendorPayoutService(pool)

	estateID, adminID := seedVendorEstate(t, ctx, pool, svc)
	vendor1 := seedVendor(t, ctx, pool, svc, estateID)
	vendor2 := seedVendor(t, ctx, pool, svc, estateID)

	jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendor1, 300_000)
	if _, err := svc.AcceptJob(ctx, estateID, vendor1, jobID); err != nil {
		t.Fatalf("accept job: %v", err)
	}
	if _, err := svc.StartJob(ctx, estateID, vendor1, jobID); err != nil {
		t.Fatalf("start job: %v", err)
	}
	if _, err := svc.MarkJobComplete(ctx, estateID, vendor1, jobID); err != nil {
		t.Fatalf("mark complete: %v", err)
	}

	vendor2BalBefore := vendorWalletBalance(t, ctx, pool, vendor2)

	// vendor2 tries to claim vendor1's completed job.
	_, err := svc.RequestPayout(ctx, estateID, vendor2, jobID, "authz006-"+uuid.New().String())
	if err == nil {
		t.Fatalf("expected error when vendor2 requests payout on vendor1's job")
	}
	if got, want := err.Error(), "estate: job not found for this vendor"; got != want {
		t.Fatalf("error = %q, want %q", got, want)
	}

	if status := jobStatus(t, ctx, pool, jobID); status != "completed" {
		t.Fatalf("victim job status = %q, want still completed (untouched)", status)
	}
	if bal := vendorWalletBalance(t, ctx, pool, vendor2); bal != vendor2BalBefore {
		t.Fatalf("vendor2 wallet balance changed: before=%d after=%d", vendor2BalBefore, bal)
	}
}

// ── ESTATE-IDEM-002 ─────────────────────────────────────────────────────────

func TestLiveDB_VendorPayout_ReplaySameKeyIsIdempotent(t *testing.T) {
	pool := vendorPayoutPool(t)
	ctx := context.Background()
	svc, _ := newVendorPayoutService(pool)

	estateID, adminID := seedVendorEstate(t, ctx, pool, svc)
	vendorUserID := seedVendor(t, ctx, pool, svc, estateID)
	jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendorUserID, 750_000)

	if _, err := svc.AcceptJob(ctx, estateID, vendorUserID, jobID); err != nil {
		t.Fatalf("accept: %v", err)
	}
	if _, err := svc.StartJob(ctx, estateID, vendorUserID, jobID); err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := svc.MarkJobComplete(ctx, estateID, vendorUserID, jobID); err != nil {
		t.Fatalf("complete: %v", err)
	}

	key := "idem002-" + uuid.New().String()
	job1, err := svc.RequestPayout(ctx, estateID, vendorUserID, jobID, key)
	if err != nil {
		t.Fatalf("first payout: %v", err)
	}
	balAfterFirst := vendorWalletBalance(t, ctx, pool, vendorUserID)

	// Replay with the SAME key on the now-paid job.
	job2, err := svc.RequestPayout(ctx, estateID, vendorUserID, jobID, key)
	if err != nil {
		t.Fatalf("replay payout: %v", err)
	}
	if job2.Status != "paid" {
		t.Fatalf("replay job status = %q, want paid", job2.Status)
	}
	if job2.ID != job1.ID || job2.PayoutRef != job1.PayoutRef {
		t.Fatalf("replay returned a different canonical row: job1=%+v job2=%+v", job1, job2)
	}

	balAfterReplay := vendorWalletBalance(t, ctx, pool, vendorUserID)
	if balAfterReplay != balAfterFirst {
		t.Fatalf("earnings total changed on replay: afterFirst=%d afterReplay=%d", balAfterFirst, balAfterReplay)
	}

	ref := "estate_vendor_payout:" + estateID + ":" + jobID
	creditCount, creditTotal := creditLegsForRef(t, ctx, pool, ref)
	if creditCount != 1 || creditTotal != 750_000 {
		t.Fatalf("credit legs after replay = (%d, %d), want (1, 750000) — single ledger credit", creditCount, creditTotal)
	}

	earnings, err := svc.GetVendorEarnings(ctx, estateID, vendorUserID)
	if err != nil {
		t.Fatalf("get earnings: %v", err)
	}
	if earnings["total_earned_kobo"] != int64(750_000) {
		t.Fatalf("total_earned_kobo = %v, want 750000", earnings["total_earned_kobo"])
	}
	if earnings["paid_jobs"] != 1 {
		t.Fatalf("paid_jobs = %v, want 1", earnings["paid_jobs"])
	}
}

// ── FSM: ESTATE-FSM-001..008 ────────────────────────────────────────────────

func TestLiveDB_VendorJobFSM(t *testing.T) {
	pool := vendorPayoutPool(t)
	ctx := context.Background()
	svc, _ := newVendorPayoutService(pool)

	estateID, adminID := seedVendorEstate(t, ctx, pool, svc)
	vendorUserID := seedVendor(t, ctx, pool, svc, estateID)

	t.Run("FSM-001 available->accepted via AcceptJob", func(t *testing.T) {
		jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendorUserID, 100_000)
		job, err := svc.AcceptJob(ctx, estateID, vendorUserID, jobID)
		if err != nil {
			t.Fatalf("AcceptJob: %v", err)
		}
		if job.Status != "accepted" {
			t.Fatalf("status = %q, want accepted", job.Status)
		}
		if job.AcceptedAt == nil {
			t.Fatalf("accepted_at not stamped")
		}
	})

	t.Run("FSM-002 available->rejected via RejectJob", func(t *testing.T) {
		jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendorUserID, 100_000)
		job, err := svc.RejectJob(ctx, estateID, vendorUserID, jobID)
		if err != nil {
			t.Fatalf("RejectJob: %v", err)
		}
		if job.Status != "rejected" {
			t.Fatalf("status = %q, want rejected", job.Status)
		}
	})

	t.Run("FSM-003 accepted->en_route via CheckInAtGate", func(t *testing.T) {
		jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendorUserID, 100_000)
		if _, err := svc.AcceptJob(ctx, estateID, vendorUserID, jobID); err != nil {
			t.Fatalf("accept: %v", err)
		}
		job, err := svc.CheckInAtGate(ctx, estateID, vendorUserID, jobID)
		if err != nil {
			t.Fatalf("CheckInAtGate: %v", err)
		}
		if job.Status != "en_route" {
			t.Fatalf("status = %q, want en_route", job.Status)
		}
	})

	t.Run("FSM-004 accepted->in_progress via StartJob", func(t *testing.T) {
		jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendorUserID, 100_000)
		if _, err := svc.AcceptJob(ctx, estateID, vendorUserID, jobID); err != nil {
			t.Fatalf("accept: %v", err)
		}
		job, err := svc.StartJob(ctx, estateID, vendorUserID, jobID)
		if err != nil {
			t.Fatalf("StartJob (from accepted): %v", err)
		}
		if job.Status != "in_progress" {
			t.Fatalf("status = %q, want in_progress", job.Status)
		}
	})

	t.Run("FSM-004b en_route->in_progress via StartJob", func(t *testing.T) {
		jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendorUserID, 100_000)
		if _, err := svc.AcceptJob(ctx, estateID, vendorUserID, jobID); err != nil {
			t.Fatalf("accept: %v", err)
		}
		if _, err := svc.CheckInAtGate(ctx, estateID, vendorUserID, jobID); err != nil {
			t.Fatalf("check in: %v", err)
		}
		job, err := svc.StartJob(ctx, estateID, vendorUserID, jobID)
		if err != nil {
			t.Fatalf("StartJob (from en_route): %v", err)
		}
		if job.Status != "in_progress" {
			t.Fatalf("status = %q, want in_progress", job.Status)
		}
	})

	t.Run("FSM-005 in_progress->completed via MarkJobComplete", func(t *testing.T) {
		jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendorUserID, 100_000)
		if _, err := svc.AcceptJob(ctx, estateID, vendorUserID, jobID); err != nil {
			t.Fatalf("accept: %v", err)
		}
		if _, err := svc.StartJob(ctx, estateID, vendorUserID, jobID); err != nil {
			t.Fatalf("start: %v", err)
		}
		job, err := svc.MarkJobComplete(ctx, estateID, vendorUserID, jobID)
		if err != nil {
			t.Fatalf("MarkJobComplete: %v", err)
		}
		if job.Status != "completed" {
			t.Fatalf("status = %q, want completed", job.Status)
		}
		if job.CompletedAt == nil {
			t.Fatalf("completed_at not stamped")
		}
	})

	t.Run("FSM-006 completed->paid via RequestPayout", func(t *testing.T) {
		jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendorUserID, 100_000)
		if _, err := svc.AcceptJob(ctx, estateID, vendorUserID, jobID); err != nil {
			t.Fatalf("accept: %v", err)
		}
		if _, err := svc.StartJob(ctx, estateID, vendorUserID, jobID); err != nil {
			t.Fatalf("start: %v", err)
		}
		if _, err := svc.MarkJobComplete(ctx, estateID, vendorUserID, jobID); err != nil {
			t.Fatalf("complete: %v", err)
		}
		job, err := svc.RequestPayout(ctx, estateID, vendorUserID, jobID, "fsm006-"+uuid.New().String())
		if err != nil {
			t.Fatalf("RequestPayout: %v", err)
		}
		if job.Status != "paid" {
			t.Fatalf("status = %q, want paid", job.Status)
		}
	})

	t.Run("FSM-007 paid->paid RequestPayout replay is a no-op", func(t *testing.T) {
		jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendorUserID, 100_000)
		if _, err := svc.AcceptJob(ctx, estateID, vendorUserID, jobID); err != nil {
			t.Fatalf("accept: %v", err)
		}
		if _, err := svc.StartJob(ctx, estateID, vendorUserID, jobID); err != nil {
			t.Fatalf("start: %v", err)
		}
		if _, err := svc.MarkJobComplete(ctx, estateID, vendorUserID, jobID); err != nil {
			t.Fatalf("complete: %v", err)
		}
		if _, err := svc.RequestPayout(ctx, estateID, vendorUserID, jobID, "fsm007-a-"+uuid.New().String()); err != nil {
			t.Fatalf("first payout: %v", err)
		}
		// A DIFFERENT key on an already-paid job must still be a clean no-op
		// (status=='paid' short-circuit in RequestPayout), not a second credit.
		balBefore := vendorWalletBalance(t, ctx, pool, vendorUserID)
		job, err := svc.RequestPayout(ctx, estateID, vendorUserID, jobID, "fsm007-b-"+uuid.New().String())
		if err != nil {
			t.Fatalf("second-key payout on paid job: %v", err)
		}
		if job.Status != "paid" {
			t.Fatalf("status = %q, want paid", job.Status)
		}
		balAfter := vendorWalletBalance(t, ctx, pool, vendorUserID)
		if balAfter != balBefore {
			t.Fatalf("balance changed on already-paid replay with a new key: before=%d after=%d", balBefore, balAfter)
		}
	})

	t.Run("FSM-008 RequestPayout rejected from available", func(t *testing.T) {
		jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendorUserID, 100_000)
		if _, err := svc.RequestPayout(ctx, estateID, vendorUserID, jobID, "fsm008-a-"+uuid.New().String()); err == nil {
			t.Fatalf("expected error requesting payout on an available job")
		}
		if status := jobStatus(t, ctx, pool, jobID); status != "available" {
			t.Fatalf("status = %q, want unchanged available", status)
		}
	})

	t.Run("FSM-008 RequestPayout rejected from in_progress", func(t *testing.T) {
		jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendorUserID, 100_000)
		if _, err := svc.AcceptJob(ctx, estateID, vendorUserID, jobID); err != nil {
			t.Fatalf("accept: %v", err)
		}
		if _, err := svc.StartJob(ctx, estateID, vendorUserID, jobID); err != nil {
			t.Fatalf("start: %v", err)
		}
		if _, err := svc.RequestPayout(ctx, estateID, vendorUserID, jobID, "fsm008-b-"+uuid.New().String()); err == nil {
			t.Fatalf("expected error requesting payout on an in_progress job")
		}
		if status := jobStatus(t, ctx, pool, jobID); status != "in_progress" {
			t.Fatalf("status = %q, want unchanged in_progress", status)
		}
	})

	// Illegal from-state transitions on the earlier legs of the FSM (rejected
	// by jobTransition's status=ANY($5) predicate), rounding out the table:
	// AcceptJob only from available; CheckInAtGate only from accepted.
	t.Run("illegal: AcceptJob from non-available", func(t *testing.T) {
		jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendorUserID, 100_000)
		if _, err := svc.AcceptJob(ctx, estateID, vendorUserID, jobID); err != nil {
			t.Fatalf("accept: %v", err)
		}
		if _, err := svc.AcceptJob(ctx, estateID, vendorUserID, jobID); err == nil {
			t.Fatalf("expected error re-accepting an already-accepted job")
		}
	})

	t.Run("illegal: CheckInAtGate from available", func(t *testing.T) {
		jobID := seedVendorJob(t, ctx, svc, estateID, adminID, vendorUserID, 100_000)
		if _, err := svc.CheckInAtGate(ctx, estateID, vendorUserID, jobID); err == nil {
			t.Fatalf("expected error checking in on an available (not accepted) job")
		}
	})
}
