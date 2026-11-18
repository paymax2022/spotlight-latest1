package doctor

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Live-DB suite for credential-gated discoverability (HL-2). The patient directory
// is the telemedicine `doctors` table — ListDoctors selects FROM doctors WHERE
// is_available = TRUE — while the review console writes doctor_profiles. These tests
// pin the two together: an ops approval must leave the doctor bookable-by-discovery,
// and a refusal must not. Runs only with TEST_DATABASE_URL set; owns its fixtures.

func liveDirectoryDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping discoverability live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedPendingDoctor is the state the admin queue approves from: a submitted profile,
// a pending verification, and NO patient-directory row yet.
func seedPendingDoctor(t *testing.T, pool *pgxpool.Pool) (userID, verificationID string) {
	t.Helper()
	ctx := context.Background()
	userID = uuid.NewString()
	verificationID = uuid.NewString()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("fixture %q: %v", sql, err)
		}
	}
	exec(`INSERT INTO auth.users (id) VALUES ($1)`, userID)
	exec(`INSERT INTO doctor_profiles (user_id, name, specialty_id, fee_kobo, years_experience, mdcn_number, verification, is_published)
	      VALUES ($1,'Dr Ada Live','cardiology',750000,9,'MDCN/LIVE/1','unsubmitted',false)`, userID)
	exec(`INSERT INTO doctor_verifications (id, user_id, status, mdcn_number) VALUES ($1,$2,'pending','MDCN/LIVE/1')`,
		verificationID, userID)
	t.Cleanup(func() {
		for _, q := range []string{
			`DELETE FROM doctors WHERE user_id = $1`,
			`DELETE FROM doctor_verifications WHERE user_id = $1`,
			`DELETE FROM doctor_profiles WHERE user_id = $1`,
			`DELETE FROM auth.users WHERE id = $1`,
		} {
			_, _ = pool.Exec(context.Background(), q, userID)
		}
	})
	return userID, verificationID
}

// seedBuilderDoctor is how the provider profile builder actually leaves a profile:
// it writes ONLY profile_draft, and InsertVerification materializes just
// title/name/mdcn_number — so specialty_id and fee_kobo stay at their column
// defaults ('' and 0) even though the doctor entered a specialty and prices.
func seedBuilderDoctor(t *testing.T, pool *pgxpool.Pool, draft string) (userID, verificationID string) {
	t.Helper()
	ctx := context.Background()
	userID = uuid.NewString()
	verificationID = uuid.NewString()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("fixture %q: %v", sql, err)
		}
	}
	exec(`INSERT INTO auth.users (id) VALUES ($1)`, userID)
	exec(`INSERT INTO doctor_profiles (user_id, name, specialty_id, fee_kobo, mdcn_number, verification, is_published, profile_draft)
	      VALUES ($1,'Dr Builder Live','',0,'MDCN/LIVE/2','unsubmitted',false,$2::jsonb)`, userID, draft)
	exec(`INSERT INTO doctor_verifications (id, user_id, status, mdcn_number) VALUES ($1,$2,'pending','MDCN/LIVE/2')`,
		verificationID, userID)
	t.Cleanup(func() {
		for _, q := range []string{
			`DELETE FROM doctors WHERE user_id = $1`,
			`DELETE FROM doctor_verifications WHERE user_id = $1`,
			`DELETE FROM doctor_profiles WHERE user_id = $1`,
			`DELETE FROM auth.users WHERE id = $1`,
		} {
			_, _ = pool.Exec(context.Background(), q, userID)
		}
	})
	return userID, verificationID
}

type directoryState struct {
	exists    bool
	name      string
	specialty string
	feeKobo   int64
	available bool
}

func readDirectory(t *testing.T, pool *pgxpool.Pool, userID string) directoryState {
	t.Helper()
	var s directoryState
	err := pool.QueryRow(context.Background(),
		`SELECT name, specialty, consult_fee_kobo, is_available FROM doctors WHERE user_id=$1`, userID).
		Scan(&s.name, &s.specialty, &s.feeKobo, &s.available)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return directoryState{}
		}
		t.Fatalf("read directory: %v", err)
	}
	s.exists = true
	return s
}

func reviewService(pool *pgxpool.Pool) *MDCNReviewService {
	return NewMDCNReviewService(NewRepository(pool), nil, nil, nil, nil)
}

// seedReviewer creates the ops reviewer as a real auth.users row —
// doctor_verifications.reviewer_id is a foreign key, and Decide forbids
// self-approval, so the reviewer must be a distinct user.
func seedReviewer(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	reviewer := uuid.NewString()
	if _, err := pool.Exec(context.Background(), `INSERT INTO auth.users (id) VALUES ($1)`, reviewer); err != nil {
		t.Fatalf("seed reviewer: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id = $1`, reviewer)
	})
	return reviewer
}

func approve(t *testing.T, pool *pgxpool.Pool, reviewerID, verificationID string) {
	t.Helper()
	expiry := time.Now().AddDate(2, 0, 0)
	discipline := "medical"
	if _, err := reviewService(pool).Decide(context.Background(), reviewerID, verificationID,
		MDCNDecision{Action: "approve", LicenceExpiry: &expiry, Discipline: &discipline}); err != nil {
		t.Fatalf("approve: %v", err)
	}
}

// The bug this pins: approval flipped doctor_profiles.is_published but never wrote
// the doctors row the patient list reads, so an approved doctor stayed invisible.
func TestLiveDB_ApproveMakesDoctorDiscoverableInPatientDirectory(t *testing.T) {
	pool := liveDirectoryDB(t)
	// Reviewer first: t.Cleanup is LIFO, and the verification's reviewer_id FK means
	// the doctor's rows must be deleted before the reviewer's auth.users row.
	reviewerID := seedReviewer(t, pool)
	userID, verificationID := seedPendingDoctor(t, pool)

	approve(t, pool, reviewerID, verificationID)

	got := readDirectory(t, pool, userID)
	if !got.exists {
		t.Fatal("approved doctor has no patient-directory row — patients cannot discover them")
	}
	if !got.available {
		t.Error("directory row is_available=false; ListDoctors filters on is_available=TRUE")
	}
	if got.name != "Dr Ada Live" {
		t.Errorf("directory name = %q, want the profile name %q", got.name, "Dr Ada Live")
	}
	if got.specialty != "cardiology" {
		t.Errorf("directory specialty = %q, want the profile specialty_id %q", got.specialty, "cardiology")
	}
	if got.feeKobo != 750000 {
		t.Errorf("directory consult_fee_kobo = %d, want the profile fee 750000", got.feeKobo)
	}
}

func TestLiveDB_RejectKeepsDoctorOutOfPatientDirectory(t *testing.T) {
	pool := liveDirectoryDB(t)
	reviewerID := seedReviewer(t, pool)
	userID, verificationID := seedPendingDoctor(t, pool)

	if _, err := reviewService(pool).Decide(context.Background(), reviewerID, verificationID,
		MDCNDecision{Action: "reject", Notes: "licence mismatch"}); err != nil {
		t.Fatalf("reject: %v", err)
	}

	if got := readDirectory(t, pool, userID); got.exists && got.available {
		t.Error("rejected doctor is discoverable in the patient directory")
	}
}

// Doctors approved before the directory projection existed have no doctors row, and
// Decide treats a repeated identical decision as an idempotent no-op. Re-approving must
// still heal discoverability, otherwise ops has no way to publish them from the console.
func TestLiveDB_ReapprovingAlreadyApprovedDoctorPublishesDirectory(t *testing.T) {
	pool := liveDirectoryDB(t)
	reviewerID := seedReviewer(t, pool)
	userID, verificationID := seedPendingDoctor(t, pool)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `UPDATE doctor_verifications SET status='approved', decided_at=now() WHERE id=$1`, verificationID); err != nil {
		t.Fatalf("seed approved: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE doctor_profiles SET verification='approved', is_published=true WHERE user_id=$1`, userID); err != nil {
		t.Fatalf("seed published profile: %v", err)
	}

	approve(t, pool, reviewerID, verificationID)

	got := readDirectory(t, pool, userID)
	if !got.exists || !got.available {
		t.Errorf("re-approval left the doctor undiscoverable: exists=%v available=%v", got.exists, got.available)
	}
}

// A verification-only update (publish nil) must not touch directory availability —
// the same contract SetProfileVerification already documents for is_published.
func TestLiveDB_VerificationOnlyUpdateLeavesDirectoryUntouched(t *testing.T) {
	pool := liveDirectoryDB(t)
	userID, _ := seedPendingDoctor(t, pool)
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO doctors (user_id, name, specialty, consult_fee_kobo, is_available) VALUES ($1,'Dr Ada Live','cardiology',750000,true)`,
		userID); err != nil {
		t.Fatalf("seed directory: %v", err)
	}

	if err := NewRepository(pool).SetProfileVerification(ctx, userID, "needs_info", nil); err != nil {
		t.Fatalf("SetProfileVerification: %v", err)
	}

	got := readDirectory(t, pool, userID)
	if !got.exists || !got.available {
		t.Errorf("publish=nil changed directory availability: exists=%v available=%v", got.exists, got.available)
	}
}

// The directory's consult_fee_kobo is the legacy base fee (packages price each
// modality), and its specialty allowlist uses directory slugs, not the provider
// builder's taxonomy. Approval must project what the doctor actually entered in the
// draft rather than the empty flat columns, or the insert violates both checks.
func TestLiveDB_ApproveProjectsBuilderDraftPricingAndSpecialty(t *testing.T) {
	pool := liveDirectoryDB(t)
	reviewerID := seedReviewer(t, pool)
	userID, verificationID := seedBuilderDoctor(t, pool,
		`{"draft":{"specialtyId":"gp","pricing":{"currency":"NGN","chatFeeKobo":200000,"audioFeeKobo":300000,"videoFeeKobo":350000}}}`)

	approve(t, pool, reviewerID, verificationID)

	got := readDirectory(t, pool, userID)
	if !got.exists || !got.available {
		t.Fatalf("builder-onboarded doctor not discoverable: exists=%v available=%v", got.exists, got.available)
	}
	if got.specialty != "general" {
		t.Errorf("directory specialty = %q, want the provider slug 'gp' mapped to 'general'", got.specialty)
	}
	if got.feeKobo != 200000 {
		t.Errorf("directory consult_fee_kobo = %d, want the doctor's own chat fee 200000", got.feeKobo)
	}
}

// Rejecting a doctor who was never listed must not try to CREATE a directory row:
// an unlistable profile (no fee) would fail the insert checks and turn a refusal
// into an error. Unpublish only has to take an existing row offline.
func TestLiveDB_RejectNeverCreatesDirectoryRow(t *testing.T) {
	pool := liveDirectoryDB(t)
	reviewerID := seedReviewer(t, pool)
	userID, verificationID := seedBuilderDoctor(t, pool, `{"draft":{"specialtyId":"gp"}}`)

	if _, err := reviewService(pool).Decide(context.Background(), reviewerID, verificationID,
		MDCNDecision{Action: "reject", Notes: "licence mismatch"}); err != nil {
		t.Fatalf("reject of a never-listed doctor failed: %v", err)
	}

	if got := readDirectory(t, pool, userID); got.exists {
		t.Error("reject created a patient-directory row")
	}
}

// A profile with no consultation fee anywhere cannot satisfy the directory's
// CHECK (consult_fee_kobo >= 100). Approval must report that instead of returning
// a record that claims success while the doctor stays invisible.
func TestLiveDB_ApproveReportsWhenProfileCannotBeListed(t *testing.T) {
	pool := liveDirectoryDB(t)
	reviewerID := seedReviewer(t, pool)
	_, verificationID := seedBuilderDoctor(t, pool, `{"draft":{"specialtyId":"gp"}}`)

	_, err := reviewService(pool).Decide(context.Background(), reviewerID, verificationID,
		MDCNDecision{Action: "approve", LicenceExpiry: ptrTime(time.Now().AddDate(2, 0, 0)), Discipline: ptrString("medical")})
	if err == nil {
		t.Fatal("approve silently succeeded for a profile that cannot be listed in the patient directory")
	}
}

func ptrTime(v time.Time) *time.Time { return &v }
func ptrString(v string) *string     { return &v }
