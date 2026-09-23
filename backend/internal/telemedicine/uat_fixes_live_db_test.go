package telemedicine_test

// ---------------------------------------------------------------------------
// LIVE-DB regression coverage for three defects found live during the
// Telemedicine (Module 14) UAT pass:
//
//   - BookAppointment's idempotent replay was unreachable: assertSlotFree ran
//     BEFORE the Idempotency-Key check, so a legitimate retry that reused the
//     doctor's now-occupied slot was rejected with "slot no longer available"
//     instead of returning the original appointment. Money-safe (no double
//     charge), but the retry contract was broken.
//   - GetDoctorDashboard's weekly-revenue query summed `fee_kobo * 0.85`,
//     which Postgres evaluates as a fractional numeric whenever fee_kobo is
//     not a multiple of 20. pgx cannot scan that into an int64, the scan
//     error was discarded, and the figure silently stayed at its Go zero
//     value — a doctor with an odd consult fee saw ₦0 weekly revenue despite
//     having been genuinely paid.
//   - AddReview leaked a raw Postgres unique-violation error (constraint name
//     and SQLSTATE) to the API response on a duplicate review instead of a
//     clean domain error.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/telemedicine"
)

func uatFixesPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping telemedicine UAT-fix live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedApprovedDoctor creates an MDCN-approved, available doctor with the given
// consult fee, plus a funded patient wallet. Returns (doctorID, doctorUserID, patientID).
func seedApprovedDoctor(t *testing.T, ctx context.Context, pool *pgxpool.Pool, led *ledger.Service, consultFeeKobo int64) (doctorID, doctorUserID, patientID string) {
	t.Helper()
	doctorID = uuid.New().String()
	doctorUserID = uuid.New().String()
	patientID = uuid.New().String()

	for _, u := range []string{doctorUserID, patientID} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1::uuid,$2) ON CONFLICT DO NOTHING`,
			u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO doctors (id, user_id, name, specialty, consult_fee_kobo,
			is_available, is_online, is_hmo_verified, experience_years, rating,
			review_count, patients_count, success_rate, education)
		 VALUES ($1::uuid, $2::uuid, $3, 'general', $4,
			TRUE, FALSE, FALSE, 5, 4.5, 0, 0, 90, '[]'::jsonb)`,
		doctorID, doctorUserID, "Dr UAT "+doctorID[:8], consultFeeKobo); err != nil {
		t.Fatalf("seed doctor: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO doctor_verifications (user_id, status, kind) VALUES ($1::uuid, 'approved', 'initial')`,
		doctorUserID); err != nil {
		t.Fatalf("seed doctor_verifications: %v", err)
	}

	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, patientID, "uatfix-seed", "uatfix-fund-"+patientID, revAcc.ID, 10_000_000); err != nil {
		t.Fatalf("fund patient: %v", err)
	}

	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM telemedicine_reviews WHERE doctor_id=$1::uuid`, doctorID)
		_, _ = pool.Exec(bg, `DELETE FROM appointments WHERE doctor_id=$1::uuid`, doctorID)
		_, _ = pool.Exec(bg, `DELETE FROM doctor_verifications WHERE user_id=$1::uuid`, doctorUserID)
		_, _ = pool.Exec(bg, `DELETE FROM doctors WHERE id=$1::uuid`, doctorID)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id IN ($1::uuid,$2::uuid)`, doctorUserID, patientID)
	})
	return doctorID, doctorUserID, patientID
}

// TestLiveDB_BookAppointment_IdempotentReplayReturnsOriginal locks the fix for
// the defect found live: a retry with the same Idempotency-Key must return the
// original appointment, not fail because the slot it already booked looks taken.
func TestLiveDB_BookAppointment_IdempotentReplayReturnsOriginal(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := telemedicine.NewService(pool, settlement.NewService(pool, led))

	doctorID, _, patientID := seedApprovedDoctor(t, ctx, pool, led, 500_000)

	key := "uat-idem-" + uuid.New().String()
	req := telemedicine.BookAppointmentRequest{
		DoctorID:       doctorID,
		ScheduledAt:    time.Now().Add(48 * time.Hour).Truncate(time.Second),
		IdempotencyKey: key,
	}

	first, err := svc.BookAppointment(ctx, patientID, req)
	if err != nil {
		t.Fatalf("first booking: %v", err)
	}

	second, err := svc.BookAppointment(ctx, patientID, req)
	if err != nil {
		t.Fatalf("replay with the same Idempotency-Key must succeed and return the original appointment, got error: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("replay returned a different appointment: first=%s second=%s", first.ID, second.ID)
	}

	var apptCount, ledgerCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM appointments WHERE idempotency_key=$1`, key).Scan(&apptCount); err != nil {
		t.Fatalf("count appointments: %v", err)
	}
	if apptCount != 1 {
		t.Fatalf("expected exactly 1 appointment for idempotency key, got %d", apptCount)
	}
	// ledger.Debit posts a balanced pair under "<idempotencyKey>:escrow:debit"
	// and "<idempotencyKey>:escrow:credit" (see settlement.Service.Escrow +
	// ledger.Service.Debit), not the bare key.
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key LIKE $1`, key+":escrow:%").Scan(&ledgerCount); err != nil {
		t.Fatalf("count ledger entries: %v", err)
	}
	if ledgerCount != 2 { // one balanced DEBIT/CREDIT pair, not two
		t.Fatalf("expected exactly 2 ledger entries (one balanced pair) for the idempotency key, got %d — replay must not double-charge", ledgerCount)
	}
}

// TestLiveDB_GetDoctorDashboard_OddFeeWeeklyRevenueNotZero locks the fix for the
// silent-zero defect: a completed appointment with a consult fee that is not a
// multiple of 20 must still produce a nonzero, correct weekly revenue figure.
func TestLiveDB_GetDoctorDashboard_OddFeeWeeklyRevenueNotZero(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := telemedicine.NewService(pool, settlement.NewService(pool, led))

	// 99_991 kobo is the exact odd amount the discovering agent used: 0.85×99991
	// = 84,992.35, a non-integer that the old `fee_kobo * 0.85` SQL expression
	// returned as a fractional numeric pgx could not scan into int64.
	const oddFeeKobo = 99_991
	doctorID, doctorUserID, patientID := seedApprovedDoctor(t, ctx, pool, led, oddFeeKobo)

	appt, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:       doctorID,
		ScheduledAt:    time.Now().Add(24 * time.Hour).Truncate(time.Second),
		IdempotencyKey: "uat-dash-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	if err := svc.CompleteAppointment(ctx, appt.ID, doctorUserID); err != nil {
		t.Fatalf("complete: %v", err)
	}

	dash, err := svc.GetDoctorDashboard(ctx, doctorUserID)
	if err != nil {
		t.Fatalf("GetDoctorDashboard must not fail on an odd consult fee: %v", err)
	}
	// Doctor's actual provider leg per settlement.Split's algebra: consult −
	// floor(0.15·consult) = 99991 − 14998 = 84993 (matches the platform-fee
	// UAT pass's independently-confirmed live ledger credit for this exact
	// amount).
	const wantWeeklyRevenue = 99_991 - (99_991 * 15 / 100)
	if dash.Stats.WeeklyRevenueKobo != wantWeeklyRevenue {
		t.Fatalf("weekly_revenue_kobo = %d, want %d — must not silently read 0 for an odd consult fee",
			dash.Stats.WeeklyRevenueKobo, wantWeeklyRevenue)
	}
	if dash.Stats.WeeklyRevenueKobo == 0 {
		t.Fatal("weekly_revenue_kobo is 0 — the original defect (discarded scan error on a fractional numeric)")
	}
}

// TestLiveDB_AddReview_DuplicateReturnsCleanDomainError locks the fix for the
// leaked-Postgres-error defect: a second review for the same appointment must
// return a clean, non-leaking domain error, not a raw constraint/SQLSTATE string.
func TestLiveDB_AddReview_DuplicateReturnsCleanDomainError(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := telemedicine.NewService(pool, settlement.NewService(pool, led))

	doctorID, doctorUserID, patientID := seedApprovedDoctor(t, ctx, pool, led, 350_000)

	appt, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:       doctorID,
		ScheduledAt:    time.Now().Add(24 * time.Hour).Truncate(time.Second),
		IdempotencyKey: "uat-review-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	if err := svc.CompleteAppointment(ctx, appt.ID, doctorUserID); err != nil {
		t.Fatalf("complete: %v", err)
	}

	if _, err := svc.AddReview(ctx, appt.ID, patientID, telemedicine.SubmitReviewRequest{Rating: 5, Comment: "great"}); err != nil {
		t.Fatalf("first review: %v", err)
	}

	_, err = svc.AddReview(ctx, appt.ID, patientID, telemedicine.SubmitReviewRequest{Rating: 4, Comment: "changed my mind"})
	if err == nil {
		t.Fatal("a second review for the same appointment must be rejected")
	}
	msg := err.Error()
	if msg != "telemedicine: this appointment has already been reviewed" {
		t.Fatalf("duplicate review error leaked internal detail instead of a clean domain message: %q", msg)
	}
}
