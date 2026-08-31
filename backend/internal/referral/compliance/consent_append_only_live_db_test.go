package compliance_test

// LIVE-DB tests for the append-only referral consent record (migration
// 20260813010000). Skipped unless TEST_DATABASE_URL is set.
//
// These exist because the write path had NO test, and that gap let a
// schema/code mismatch reach the cloud database: the migration dropped the
// unique (user_id, consent_type, version) index while the repo still wrote
// `ON CONFLICT (user_id, consent_type, version) DO UPDATE`, so every consent
// write failed with SQLSTATE 42P10 until the code caught up.
//
// A consent record is evidence, so the invariants worth pinning are: every
// decision survives, the newest one is unambiguous, and nothing can be edited
// away afterwards.
//
// NOTE ON CLEANUP: these tests deliberately do not delete their consent rows —
// the table forbids DELETE by trigger, which is the property
// TestLiveDB_Consent_ImmutableByTrigger asserts. Each test uses a fresh random
// user id, so runs never observe each other's rows.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/referral/compliance"

	"spotlight/backend/internal/testsupport"
)

// consentType must be one of the values allowed by referral_consents_consent_type_check.
const consentType = "earnings_terms"

func liveConsentPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping referral consent live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

// seedConsentUser inserts an auth.users row (referral_consents.user_id references it).
func seedConsentUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		id, id+"@consent.seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

func record(t *testing.T, ctx context.Context, repo *compliance.Repository, userID string, granted bool) *compliance.Consent {
	t.Helper()
	c, err := repo.RecordConsent(ctx, userID, compliance.ConsentInput{
		ConsentType: consentType,
		Granted:     &granted,
		Version:     1,
		Source:      "live-db-test",
	})
	if err != nil {
		t.Fatalf("RecordConsent(granted=%v): %v", granted, err)
	}
	return c
}

// TestLiveDB_Consent_AppendOnly proves a withdrawal does not erase the grant it
// supersedes, and that the current state is the MOST RECENT row rather than
// "some granted row exists" — the distinction that left the client toggle stuck
// on after a user withdrew.
func TestLiveDB_Consent_AppendOnly(t *testing.T) {
	pool := liveConsentPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	repo := compliance.NewRepository(pool)
	userID := seedConsentUser(t, ctx, pool)

	// grant -> withdraw -> re-grant, all at the SAME (user, type, version) the
	// dropped unique index used to collapse into one row.
	record(t, ctx, repo, userID, true)
	record(t, ctx, repo, userID, false)
	record(t, ctx, repo, userID, true)

	got, err := repo.ConsentsByUser(ctx, userID)
	if err != nil {
		t.Fatalf("ConsentsByUser: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("append-only: want 3 rows (the old upsert kept 1), got %d", len(got))
	}

	// Newest first: the re-grant leads, then the withdrawal, then the grant.
	wantOrder := []bool{true, false, true}
	for i, want := range wantOrder {
		if got[i].Granted != want {
			t.Errorf("row %d: granted = %v, want %v (rows must be newest-first)", i, got[i].Granted, want)
		}
	}
	if got[0].Source != "live-db-test" || got[0].Version != 1 {
		t.Errorf("row 0 lost its payload: source=%q version=%d", got[0].Source, got[0].Version)
	}

	// The regression: after a further withdrawal the current state is OFF even
	// though older granted rows remain. "Any granted row exists" answers ON here.
	record(t, ctx, repo, userID, false)
	got, err = repo.ConsentsByUser(ctx, userID)
	if err != nil {
		t.Fatalf("ConsentsByUser after withdrawal: %v", err)
	}
	if len(got) != 4 {
		t.Fatalf("want 4 rows after the second withdrawal, got %d", len(got))
	}
	if got[0].Granted {
		t.Error("current state must be the LATEST row (granted=false after withdrawing), not any granted row")
	}
	anyGranted := false
	for _, c := range got {
		if c.Granted {
			anyGranted = true
		}
	}
	if !anyGranted {
		t.Error("the superseded grants should still be on record — a withdrawal must not erase the evidence")
	}
}

// TestLiveDB_Consent_OrdersBySeqNotCreatedAt pins the reason the schema carries
// a monotonic seq: now() is constant within a transaction, so consents written
// together share created_at exactly, and id is a random UUID that cannot break
// the tie. Ordering by created_at would resolve such a pair arbitrarily — which
// is how a grant/withdraw pair once read back as the withdrawal.
func TestLiveDB_Consent_OrdersBySeqNotCreatedAt(t *testing.T) {
	pool := liveConsentPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	repo := compliance.NewRepository(pool)
	userID := seedConsentUser(t, ctx, pool)

	// Both rows in ONE transaction => byte-identical created_at.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	for _, granted := range []bool{false, true} { // withdrawal first, then the grant
		if _, err := tx.Exec(ctx,
			`INSERT INTO referral_consents (user_id, consent_type, granted, version, source)
			 VALUES ($1, $2, $3, 1, 'tie-test')`, userID, consentType, granted); err != nil {
			tx.Rollback(ctx)
			t.Fatalf("insert (granted=%v): %v", granted, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	var distinctTimestamps int
	if err := pool.QueryRow(ctx,
		`SELECT count(DISTINCT created_at) FROM referral_consents WHERE user_id = $1`, userID).
		Scan(&distinctTimestamps); err != nil {
		t.Fatalf("count timestamps: %v", err)
	}
	if distinctTimestamps != 1 {
		t.Skipf("created_at did not tie (%d distinct) — nothing to disambiguate on this server", distinctTimestamps)
	}

	got, err := repo.ConsentsByUser(ctx, userID)
	if err != nil {
		t.Fatalf("ConsentsByUser: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 rows, got %d", len(got))
	}
	// created_at cannot separate these; only seq can. The grant was written last.
	if !got[0].Granted {
		t.Error("with identical created_at the LAST-written row must come first — ordering is not falling through to seq")
	}
}

// TestLiveDB_Consent_ImmutableByTrigger proves append-only is enforced by the
// database rather than promised by the application: the record is evidence, so
// neither a bug nor a console session can rewrite history.
func TestLiveDB_Consent_ImmutableByTrigger(t *testing.T) {
	pool := liveConsentPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	repo := compliance.NewRepository(pool)
	userID := seedConsentUser(t, ctx, pool)
	record(t, ctx, repo, userID, true)

	if _, err := pool.Exec(ctx,
		`UPDATE referral_consents SET granted = false WHERE user_id = $1`, userID); err == nil {
		t.Error("UPDATE on referral_consents must be refused by trigger")
	}
	if _, err := pool.Exec(ctx,
		`DELETE FROM referral_consents WHERE user_id = $1`, userID); err == nil {
		t.Error("DELETE on referral_consents must be refused by trigger")
	}

	// The row is untouched by the refused statements.
	got, err := repo.ConsentsByUser(ctx, userID)
	if err != nil {
		t.Fatalf("ConsentsByUser: %v", err)
	}
	if len(got) != 1 || !got[0].Granted {
		t.Fatalf("record must survive the refused UPDATE/DELETE, got %+v", got)
	}
}
