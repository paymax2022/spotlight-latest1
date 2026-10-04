package risk

// LIVE-DB regression for member abuse-report target scoping: a member may name
// only (a) their own attributed referrer or (b) a user they referred — anything
// else is refused with ErrMemberTargetScope (400).
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func liveRiskPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB risk test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedRiskUser inserts a bare auth.users row and registers cleanup.
func seedRiskUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	uid := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, uid, "risk-"+uid+"@test.local"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, uid)
	return uid
}

// attribute links referred → referrer through a real (non-house) attribution
// edge — the same row ReportAbuse's scope check reads.
func attribute(t *testing.T, pool *pgxpool.Pool, referred, referrer string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO referral_attributions (referred_user_id, referrer_id, attribution_type, code_used)
		VALUES ($1,$2,'code','TESTCODE')`, referred, referrer); err != nil {
		t.Fatalf("attribute %s→%s: %v", referred, referrer, err)
	}
}

// alertsOn returns the member_report alerts filed against a subject, so a
// refused report can be proven to have written nothing (not just errored).
func alertsOn(t *testing.T, pool *pgxpool.Pool, subjectID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM referral_risk_alerts WHERE subject_id = $1 AND rule_code = 'member_report'`,
		subjectID).Scan(&n); err != nil {
		t.Fatalf("count alerts on %s: %v", subjectID, err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(),
			`DELETE FROM referral_risk_alerts WHERE subject_id = $1 AND rule_code = 'member_report'`,
			subjectID); err != nil {
			t.Errorf("cleanup alerts on %s: %v", subjectID, err)
		}
	})
	return n
}

func newRiskSvc(pool *pgxpool.Pool) *Service {
	return NewService(NewRepository(pool), nil, nil)
}

// TestLiveDB_ReportAbuse_ArbitraryTargetRefused is the finding itself: a
// stranger id in target_user_id must be refused and must write NO alert.
func TestLiveDB_ReportAbuse_ArbitraryTargetRefused(t *testing.T) {
	ctx := context.Background()
	pool := liveRiskPool(t)
	svc := newRiskSvc(pool)

	reporter := seedRiskUser(t, pool)
	referrer := seedRiskUser(t, pool)
	stranger := seedRiskUser(t, pool)
	attribute(t, pool, reporter, referrer)

	_, err := svc.ReportAbuse(ctx, reporter, ReportInput{
		TargetUserID: stranger,
		ReasonCode:   "SUSPICIOUS",
	})
	if !errors.Is(err, ErrMemberTargetScope) {
		t.Fatalf("arbitrary target err = %v, want ErrMemberTargetScope", err)
	}
	if n := alertsOn(t, pool, stranger); n != 0 {
		t.Errorf("alerts on stranger = %d, want 0 — a refused report must write nothing", n)
	}
}

// TestLiveDB_ReportAbuse_OwnGraphTargetsAllowed pins the legitimate surface
// that must KEEP working: the empty target resolves server-side to the
// reporter's attributed referrer, an explicit target naming the referrer is
// accepted, and a user the reporter referred is accepted too.
func TestLiveDB_ReportAbuse_OwnGraphTargetsAllowed(t *testing.T) {
	ctx := context.Background()
	pool := liveRiskPool(t)
	svc := newRiskSvc(pool)

	reporter := seedRiskUser(t, pool)
	referrer := seedRiskUser(t, pool)
	recruit := seedRiskUser(t, pool)
	attribute(t, pool, reporter, referrer)
	attribute(t, pool, recruit, reporter) // reporter referred recruit

	a, err := svc.ReportAbuse(ctx, reporter, ReportInput{})
	if err != nil {
		t.Fatalf("empty-target report: %v", err)
	}
	if a.SubjectID != referrer {
		t.Errorf("empty target resolved to %q, want the attributed referrer %q", a.SubjectID, referrer)
	}
	if a.RuleCode != "member_report" || a.Status != "open" {
		t.Errorf("alert = %q/%q, want member_report/open", a.RuleCode, a.Status)
	}
	alertsOn(t, pool, referrer)

	b, err := svc.ReportAbuse(ctx, reporter, ReportInput{TargetUserID: referrer})
	if err != nil {
		t.Fatalf("explicit referrer target: %v", err)
	}
	if b.SubjectID != referrer {
		t.Errorf("explicit target alert subject = %q, want %q", b.SubjectID, referrer)
	}

	c, err := svc.ReportAbuse(ctx, reporter, ReportInput{TargetUserID: recruit})
	if err != nil {
		t.Fatalf("own-referral target: %v", err)
	}
	if c.SubjectID != recruit {
		t.Errorf("own-referral alert subject = %q, want %q", c.SubjectID, recruit)
	}
	alertsOn(t, pool, recruit)
}

// TestLiveDB_ReportAbuse_EdgeCasesRefused covers the remaining refusals:
// self-report is rejected (here via the scope gate — a self edge is never a
// valid report target), and a member with NO referrer cannot file at all.
func TestLiveDB_ReportAbuse_EdgeCasesRefused(t *testing.T) {
	ctx := context.Background()
	pool := liveRiskPool(t)
	svc := newRiskSvc(pool)

	reporter := seedRiskUser(t, pool)
	loner := seedRiskUser(t, pool)
	stranger := seedRiskUser(t, pool)

	if _, err := svc.ReportAbuse(ctx, reporter, ReportInput{TargetUserID: reporter}); err == nil {
		t.Fatalf("self-report succeeded — must be refused")
	}
	if n := alertsOn(t, pool, reporter); n != 0 {
		t.Errorf("alerts on self = %d, want 0", n)
	}

	if _, err := svc.ReportAbuse(ctx, loner, ReportInput{}); !errors.Is(err, ErrNoReferrerToReport) {
		t.Errorf("loner empty-target err = %v, want ErrNoReferrerToReport", err)
	}
	if _, err := svc.ReportAbuse(ctx, loner, ReportInput{TargetUserID: stranger}); !errors.Is(err, ErrMemberTargetScope) {
		t.Errorf("loner named-target err = %v, want ErrMemberTargetScope", err)
	}
	if n := alertsOn(t, pool, stranger); n != 0 {
		t.Errorf("alerts on stranger = %d, want 0", n)
	}
}
