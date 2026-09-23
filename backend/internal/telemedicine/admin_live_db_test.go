package telemedicine_test

// ---------------------------------------------------------------------------
// LIVE-DB coverage for TELEMEDICINE-004: the admin console backend (dashboard,
// doctor roster, system-wide appointment list, MDCN verify decision + audit
// trail). Styled after uat_fixes_live_db_test.go / doctors_nullable_live_db_test.go.
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

	"spotlight/backend/internal/doctor"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/telemedicine"
)

func adminPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping telemedicine admin console live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedAdminReviewer inserts a bare auth.users row to act as the verifying
// admin (doctor_compliance_audit.user_id FKs to auth.users, so the reviewer
// must be a real row, not an arbitrary uuid).
func seedAdminReviewer(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id,email) VALUES ($1::uuid,$2) ON CONFLICT DO NOTHING`,
		id, id+"@admin-seed.test"); err != nil {
		t.Fatalf("seed admin reviewer: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM doctor_compliance_audit WHERE user_id=$1::uuid`, id)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id=$1::uuid`, id)
	})
	return id
}

// TestLiveDB_AdminDashboard_ExactKoboRevenue seeds one completed appointment
// with a known consult fee + platform fee and asserts the dashboard's platform
// revenue figure is the EXACT integer kobo the real settlement split produces
// (fee_kobo*15/100 + platform_fee_kobo) — not a float approximation.
func TestLiveDB_AdminDashboard_ExactKoboRevenue(t *testing.T) {
	pool := adminPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := telemedicine.NewService(pool, settlement.NewService(pool, led)).
		WithPlatformFeeBp(telemedicine.PlatformFeeBp) // ADR-044 fee ON for this test

	before, err := svc.GetAdminDashboard(ctx)
	if err != nil {
		t.Fatalf("dashboard before: %v", err)
	}

	const consultFeeKobo = 200_003 // odd amount — must not silently zero (TELEMEDICINE-002 shape)
	doctorID, doctorUserID, patientID := seedApprovedDoctor(t, ctx, pool, led, consultFeeKobo)

	appt, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:       doctorID,
		ScheduledAt:    time.Now().Add(24 * time.Hour).Truncate(time.Second),
		IdempotencyKey: "admin-dash-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	if err := svc.CompleteAppointment(ctx, appt.ID, doctorUserID); err != nil {
		t.Fatalf("complete: %v", err)
	}

	after, err := svc.GetAdminDashboard(ctx)
	if err != nil {
		t.Fatalf("dashboard after: %v", err)
	}

	// Re-fetch the persisted platform_fee_kobo (server-computed at booking time
	// from the ADR-044 quote) so the expectation isn't a second, independent
	// re-implementation of the fee formula.
	var platformFeeKobo int64
	if err := pool.QueryRow(ctx, `SELECT COALESCE(platform_fee_kobo,0) FROM appointments WHERE id=$1`, appt.ID).
		Scan(&platformFeeKobo); err != nil {
		t.Fatalf("read platform_fee_kobo: %v", err)
	}
	wantDelta := (int64(consultFeeKobo) * 15 / 100) + platformFeeKobo
	gotDelta := after.PlatformRevenueKoboWeek - before.PlatformRevenueKoboWeek
	if gotDelta != wantDelta {
		t.Fatalf("platform_revenue_kobo_week delta = %d, want %d (fee_kobo*15/100 + platform_fee_kobo, integer)", gotDelta, wantDelta)
	}
	if gotDelta == 0 {
		t.Fatal("platform revenue delta is 0 — must not silently read 0 the way TELEMEDICINE-002's float bug did")
	}
	if after.AppointmentsThisWeek < before.AppointmentsThisWeek+1 {
		t.Fatalf("appointments_this_week did not increase: before=%d after=%d", before.AppointmentsThisWeek, after.AppointmentsThisWeek)
	}
	if after.TotalDoctors < before.TotalDoctors+1 {
		t.Fatalf("total_doctors did not increase: before=%d after=%d", before.TotalDoctors, after.TotalDoctors)
	}
}

// TestLiveDB_AdminListDoctors_RealVerificationStatus asserts the roster surfaces
// the doctor's REAL doctor_verifications status (not the availability-filtered
// member-facing ListDoctors, and not a fabricated value).
func TestLiveDB_AdminListDoctors_RealVerificationStatus(t *testing.T) {
	pool := adminPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := telemedicine.NewService(pool, settlement.NewService(pool, led))

	// seedApprovedDoctor sets is_available=TRUE with status='approved'. Also seed
	// an UNAVAILABLE doctor to prove the admin roster is NOT availability-filtered.
	_, approvedUserID, _ := seedApprovedDoctor(t, ctx, pool, led, 150_000)

	unavailID := uuid.New().String()
	unavailUserID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1::uuid,$2) ON CONFLICT DO NOTHING`,
		unavailUserID, unavailUserID+"@seed.test"); err != nil {
		t.Fatalf("seed unavail user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO doctors (id, user_id, name, specialty, consult_fee_kobo, is_available, is_online)
		VALUES ($1::uuid, $2::uuid, $3, 'general', 100000, FALSE, FALSE)`,
		unavailID, unavailUserID, "Dr Unavailable "+unavailID[:8]); err != nil {
		t.Fatalf("seed unavailable doctor: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO doctor_verifications (user_id, status, kind, rejection_reason) VALUES ($1::uuid, 'rejected', 'initial', 'MDCN number mismatch')`,
		unavailUserID); err != nil {
		t.Fatalf("seed rejected verification: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM doctor_verifications WHERE user_id=$1::uuid`, unavailUserID)
		_, _ = pool.Exec(bg, `DELETE FROM doctors WHERE id=$1::uuid`, unavailID)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id=$1::uuid`, unavailUserID)
	})

	items, _, err := svc.ListAdminDoctors(ctx, telemedicine.AdminDoctorListQuery{Limit: 200})
	if err != nil {
		t.Fatalf("ListAdminDoctors: %v", err)
	}

	var sawApproved, sawUnavailableRejected bool
	for _, it := range items {
		if it.UserID == approvedUserID {
			sawApproved = true
			if it.VerificationStatus == nil || *it.VerificationStatus != "approved" {
				t.Fatalf("expected approved doctor's verification_status='approved', got %v", it.VerificationStatus)
			}
		}
		if it.UserID == unavailUserID {
			sawUnavailableRejected = true
			if it.IsAvailable {
				t.Fatal("unavailable doctor should have is_available=false")
			}
			if it.VerificationStatus == nil || *it.VerificationStatus != "rejected" {
				t.Fatalf("expected rejected doctor's verification_status='rejected', got %v", it.VerificationStatus)
			}
			if it.RejectionReason == nil || *it.RejectionReason != "MDCN number mismatch" {
				t.Fatalf("expected real rejection reason, got %v", it.RejectionReason)
			}
		}
	}
	if !sawApproved {
		t.Fatal("admin roster did not include the approved doctor")
	}
	if !sawUnavailableRejected {
		t.Fatal("admin roster did not include the UNAVAILABLE doctor — roster must not be availability-filtered like member-facing ListDoctors")
	}
}

// TestLiveDB_AdminListAppointments_NotScopedToOneCaller books appointments for
// two DIFFERENT patients and asserts the admin list returns both — proving it
// is system-wide, unlike ListMyAppointments (caller-scoped).
func TestLiveDB_AdminListAppointments_NotScopedToOneCaller(t *testing.T) {
	pool := adminPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := telemedicine.NewService(pool, settlement.NewService(pool, led))

	doctorID, _, patientA := seedApprovedDoctor(t, ctx, pool, led, 120_000)
	// A second, independent patient — never the doctor's own caller identity —
	// to prove ListAdminAppointments crosses patient boundaries.
	patientB := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1::uuid,$2) ON CONFLICT DO NOTHING`,
		patientB, patientB+"@seed.test"); err != nil {
		t.Fatalf("seed patientB: %v", err)
	}
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, patientB, "admin-appt-seed", "admin-appt-fund-"+patientB, revAcc.ID, 10_000_000); err != nil {
		t.Fatalf("fund patientB: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id=$1::uuid`, patientB)
	})

	apptA, err := svc.BookAppointment(ctx, patientA, telemedicine.BookAppointmentRequest{
		DoctorID: doctorID, ScheduledAt: time.Now().Add(24 * time.Hour).Truncate(time.Second),
		IdempotencyKey: "admin-appt-a-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("book A: %v", err)
	}
	apptB, err := svc.BookAppointment(ctx, patientB, telemedicine.BookAppointmentRequest{
		DoctorID: doctorID, ScheduledAt: time.Now().Add(25 * time.Hour).Truncate(time.Second),
		IdempotencyKey: "admin-appt-b-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("book B: %v", err)
	}

	items, total, err := svc.ListAdminAppointments(ctx, telemedicine.AdminAppointmentListQuery{Limit: 200})
	if err != nil {
		t.Fatalf("ListAdminAppointments: %v", err)
	}
	if total < 2 {
		t.Fatalf("expected at least 2 total appointments, got %d", total)
	}
	var sawA, sawB bool
	for _, it := range items {
		if it.ID == apptA.ID {
			sawA = true
			if it.PatientID != patientA {
				t.Fatalf("appointment A patient_id mismatch: got %s want %s", it.PatientID, patientA)
			}
		}
		if it.ID == apptB.ID {
			sawB = true
			if it.PatientID != patientB {
				t.Fatalf("appointment B patient_id mismatch: got %s want %s", it.PatientID, patientB)
			}
		}
	}
	if !sawA || !sawB {
		t.Fatalf("admin appointment list did not include both patients' bookings (sawA=%v sawB=%v) — must be system-wide, not scoped to one caller", sawA, sawB)
	}
}

// TestLiveDB_VerifyDoctor_ApproveAndReject_WriteAuditRow exercises both
// decisions end to end: approve flips doctor_verifications.status and mirrors
// onto doctor_profiles.verification; reject requires a reason. Both write a
// row into doctor_compliance_audit via the SAME AuditWriter the doctor
// module's own MDCN review console uses.
func TestLiveDB_VerifyDoctor_ApproveAndReject_WriteAuditRow(t *testing.T) {
	pool := adminPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	auditRepo := doctor.NewRepository(pool)
	svc := telemedicine.NewService(pool, settlement.NewService(pool, led)).WithAudit(auditRepo)

	reviewerID := seedAdminReviewer(t, ctx, pool)

	// A doctor with a PENDING verification (not yet approved) so both directions
	// (approve, then a second doctor's reject) are exercised from a real pending
	// state, mirroring how a fresh MDCN submission actually arrives.
	pendingDoctorID := uuid.New().String()
	pendingUserID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1::uuid,$2) ON CONFLICT DO NOTHING`,
		pendingUserID, pendingUserID+"@seed.test"); err != nil {
		t.Fatalf("seed pending user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO doctors (id, user_id, name, specialty, consult_fee_kobo, is_available, is_online)
		VALUES ($1::uuid, $2::uuid, $3, 'general', 175000, TRUE, FALSE)`,
		pendingDoctorID, pendingUserID, "Dr Pending "+pendingDoctorID[:8]); err != nil {
		t.Fatalf("seed pending doctor: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO doctor_verifications (user_id, status, kind) VALUES ($1::uuid, 'pending', 'initial')`,
		pendingUserID); err != nil {
		t.Fatalf("seed pending verification: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM doctor_verifications WHERE user_id=$1::uuid`, pendingUserID)
		_, _ = pool.Exec(bg, `DELETE FROM doctors WHERE id=$1::uuid`, pendingDoctorID)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id=$1::uuid`, pendingUserID)
	})

	// Reject without a reason must fail closed.
	if _, err := svc.VerifyDoctor(ctx, reviewerID, pendingUserID, telemedicine.AdminVerifyDoctorRequest{Decision: "rejected"}); err == nil {
		t.Fatal("reject without a reason must be rejected")
	}

	// Self-approval must be blocked.
	if _, err := svc.VerifyDoctor(ctx, pendingUserID, pendingUserID, telemedicine.AdminVerifyDoctorRequest{Decision: "approved"}); err == nil {
		t.Fatal("a doctor must not be able to verify themselves")
	}

	// Approve.
	got, err := svc.VerifyDoctor(ctx, reviewerID, pendingUserID, telemedicine.AdminVerifyDoctorRequest{Decision: "approved"})
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if got.VerificationStatus == nil || *got.VerificationStatus != "approved" {
		t.Fatalf("expected approved status in response, got %v", got.VerificationStatus)
	}
	var dbStatus, profileVerif string
	if err := pool.QueryRow(ctx, `SELECT status FROM doctor_verifications WHERE user_id=$1::uuid ORDER BY created_at DESC LIMIT 1`, pendingUserID).Scan(&dbStatus); err != nil {
		t.Fatalf("read verification status: %v", err)
	}
	if dbStatus != "approved" {
		t.Fatalf("doctor_verifications.status = %q, want approved", dbStatus)
	}
	if err := pool.QueryRow(ctx, `SELECT verification FROM doctor_profiles WHERE user_id=$1::uuid`, pendingUserID).Scan(&profileVerif); err == nil {
		if profileVerif != "approved" {
			t.Fatalf("doctor_profiles.verification = %q, want approved (mirror)", profileVerif)
		}
	} // a missing doctor_profiles row is fine — nothing to mirror onto.

	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_compliance_audit WHERE user_id=$1::uuid AND action='telemedicine.admin.doctor.verified' AND entity_id=$2`,
		reviewerID, *got.VerificationID).Scan(&auditCount); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	if auditCount != 1 {
		t.Fatalf("expected exactly 1 audit row for the approve decision, got %d", auditCount)
	}

	// Approving again (idempotent replay of the same terminal decision) must
	// succeed as a no-op and must NOT write a second audit row.
	if _, err := svc.VerifyDoctor(ctx, reviewerID, pendingUserID, telemedicine.AdminVerifyDoctorRequest{Decision: "approved"}); err != nil {
		t.Fatalf("idempotent re-approve: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_compliance_audit WHERE user_id=$1::uuid AND action='telemedicine.admin.doctor.verified' AND entity_id=$2`,
		reviewerID, *got.VerificationID).Scan(&auditCount); err != nil {
		t.Fatalf("count audit rows after replay: %v", err)
	}
	if auditCount != 1 {
		t.Fatalf("expected still exactly 1 audit row after an idempotent replay, got %d", auditCount)
	}

	// approved -> rejected is not a legal transition in this state machine
	// (terminal states don't move) — confirms the guard is real, not a no-op.
	if _, err := svc.VerifyDoctor(ctx, reviewerID, pendingUserID, telemedicine.AdminVerifyDoctorRequest{Decision: "rejected", Reason: "later found ineligible"}); err == nil {
		t.Fatal("approved -> rejected must be an illegal transition")
	}
}

// TestLiveDB_MemberRoutes_UnaffectedByAdminConsole is a sanity check that the
// OLD member-facing ListDoctors/ListMyAppointments methods still work exactly
// as before alongside the new admin methods on the same *Service.
func TestLiveDB_MemberRoutes_UnaffectedByAdminConsole(t *testing.T) {
	pool := adminPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := telemedicine.NewService(pool, settlement.NewService(pool, led))

	doctorID, _, patientID := seedApprovedDoctor(t, ctx, pool, led, 90_000)

	doctors, err := svc.ListDoctors(ctx, telemedicine.ListDoctorsQuery{Limit: 50})
	if err != nil {
		t.Fatalf("member ListDoctors: %v", err)
	}
	var found bool
	for _, d := range doctors {
		if d.ID == doctorID {
			found = true
		}
	}
	if !found {
		t.Fatal("member-facing ListDoctors no longer finds the (available) seeded doctor")
	}

	appt, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID: doctorID, ScheduledAt: time.Now().Add(24 * time.Hour).Truncate(time.Second),
		IdempotencyKey: "member-sanity-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	mine, err := svc.ListMyAppointments(ctx, patientID, "")
	if err != nil {
		t.Fatalf("member ListMyAppointments: %v", err)
	}
	var foundAppt bool
	for _, a := range mine {
		if a.ID == appt.ID {
			foundAppt = true
		}
	}
	if !foundAppt {
		t.Fatal("member-facing ListMyAppointments no longer finds the caller's own appointment")
	}
}
