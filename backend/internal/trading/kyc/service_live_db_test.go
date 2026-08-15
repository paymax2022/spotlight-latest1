package kyc

// LIVE-DB test for the Module-KYC service: the full transition graph, the
// mandatory-reason reject, the two-person/time-boxed bypass policy + register,
// the expiry sweep, and — critically — that HasTradingAccess (the wallet's gate)
// grants access ONLY for APPROVED or an unexpired BYPASSED record.
// Skipped unless TEST_DATABASE_URL is set —
// deliberately with NO fallback to DATABASE_URL, which the root .env points
// at the PRODUCTION Supabase pooler.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func liveKyc(t *testing.T) (*Service, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping trading KYC live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	return NewService(pool), pool
}

func access(t *testing.T, ctx context.Context, s *Service, u string) bool {
	t.Helper()
	ok, err := s.HasTradingAccess(ctx, u)
	if err != nil {
		t.Fatalf("access: %v", err)
	}
	return ok
}

func TestLiveDB_KYC_HappyPathAndGate(t *testing.T) {
	svc, pool := liveKyc(t)
	defer pool.Close()
	ctx := context.Background()
	u := uuid.NewString()

	if rec, _ := svc.GetStatus(ctx, u); rec.Status != StatusNotStarted {
		t.Fatalf("fresh user should be NOT_STARTED, got %s", rec.Status)
	}
	if access(t, ctx, svc, u) {
		t.Fatal("NOT_STARTED must NOT have trading access")
	}
	// Illegal jump: approve without submit.
	if err := svc.Approve(ctx, uuid.NewString(), u, "x"); err != ErrInvalidTransition {
		t.Fatalf("approve from NOT_STARTED must be illegal, got %v", err)
	}

	reviewer := uuid.NewString()
	if err := svc.Submit(ctx, u); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if err := svc.StartReview(ctx, reviewer, u); err != nil {
		t.Fatalf("start review: %v", err)
	}
	if access(t, ctx, svc, u) {
		t.Fatal("UNDER_REVIEW must NOT have access")
	}
	if err := svc.Approve(ctx, reviewer, u, "id_verified"); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if !access(t, ctx, svc, u) {
		t.Fatal("APPROVED must have trading access")
	}
}

func TestLiveDB_KYC_RejectRequiresReasonAndResubmit(t *testing.T) {
	svc, pool := liveKyc(t)
	defer pool.Close()
	ctx := context.Background()
	u := uuid.NewString()
	reviewer := uuid.NewString()
	_ = svc.Submit(ctx, u)

	if err := svc.Reject(ctx, reviewer, u, ""); err != ErrReasonRequired {
		t.Fatalf("reject without reason must be refused, got %v", err)
	}
	if err := svc.Reject(ctx, reviewer, u, "doc_mismatch"); err != nil {
		t.Fatalf("reject: %v", err)
	}
	if access(t, ctx, svc, u) {
		t.Fatal("REJECTED must NOT have access")
	}
	// Resubmission is allowed (REJECTED → SUBMITTED).
	if err := svc.Submit(ctx, u); err != nil {
		t.Fatalf("resubmit after reject: %v", err)
	}
	if rec, _ := svc.GetStatus(ctx, u); rec.Status != StatusSubmitted {
		t.Fatalf("after resubmit want SUBMITTED, got %s", rec.Status)
	}
}

func TestLiveDB_KYC_BypassPolicyAndRegister(t *testing.T) {
	svc, pool := liveKyc(t)
	defer pool.Close()
	ctx := context.Background()
	u := uuid.NewString()
	maker := uuid.NewString()
	checker := uuid.NewString()

	// Policy rejections (two-person, reason, bounded ttl).
	if err := svc.Bypass(ctx, maker, maker, u, "r", time.Hour, nil); err != ErrBypassSameApprover {
		t.Fatalf("same maker/checker must be refused, got %v", err)
	}
	if err := svc.Bypass(ctx, maker, checker, u, "", time.Hour, nil); err != ErrBypassNoReason {
		t.Fatalf("missing reason must be refused, got %v", err)
	}
	if err := svc.Bypass(ctx, maker, checker, u, "r", 0, nil); err != ErrBypassBadTTL {
		t.Fatalf("non-positive ttl must be refused, got %v", err)
	}
	if err := svc.Bypass(ctx, maker, checker, u, "r", MaxBypassTTL+time.Hour, nil); err != ErrBypassTTLTooLong {
		t.Fatalf("over-long ttl must be refused, got %v", err)
	}

	// Valid bypass grants access + writes the register row.
	cap := int64(50_000_00)
	if err := svc.Bypass(ctx, maker, checker, u, "vip_manual_review", 7*24*time.Hour, &cap); err != nil {
		t.Fatalf("valid bypass: %v", err)
	}
	if !access(t, ctx, svc, u) {
		t.Fatal("valid BYPASSED must have access")
	}
	var reg int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM trading_kyc_bypass WHERE user_id=$1::uuid AND maker_id=$2::uuid AND checker_id=$3::uuid`, u, maker, checker).Scan(&reg)
	if reg != 1 {
		t.Fatalf("bypass register row missing (got %d)", reg)
	}
}

func TestLiveDB_KYC_BypassExpirySweep(t *testing.T) {
	svc, pool := liveKyc(t)
	defer pool.Close()
	ctx := context.Background()
	u := uuid.NewString()
	if err := svc.Bypass(ctx, uuid.NewString(), uuid.NewString(), u, "temp", 7*24*time.Hour, nil); err != nil {
		t.Fatalf("bypass: %v", err)
	}
	// Backdate the time-box into the past → access must drop immediately (pure gate).
	if _, err := pool.Exec(ctx, `UPDATE trading_kyc SET bypass_expires_at = now() - interval '1 hour' WHERE user_id=$1::uuid`, u); err != nil {
		t.Fatalf("backdate: %v", err)
	}
	if access(t, ctx, svc, u) {
		t.Fatal("expired bypass must NOT grant access")
	}
	// Sweep flips it to EXPIRED.
	if _, err := svc.ExpireDue(ctx); err != nil {
		t.Fatalf("expire sweep: %v", err)
	}
	if rec, _ := svc.GetStatus(ctx, u); rec.Status != StatusExpired {
		t.Fatalf("swept bypass want EXPIRED, got %s", rec.Status)
	}
}
