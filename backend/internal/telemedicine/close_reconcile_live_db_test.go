package telemedicine_test

// LIVE-DB coverage for the money-path blockers the ledger audit of PR #879 set
// before FEATURE_TELEMEDICINE_CONSOLE_BRIDGE_ENABLED may be turned on (ADR-PR879):
//   L-H1/M-2/M-3  one atomic terminal claim per appointment: complete and cancel
//                 race to it and exactly one wins; money follows the winner
//   L-H1          a claim whose payment did not land is finished by the reconciler
//   L-H2          a consult stuck in_progress is flagged for review (patient or
//                 timeout) and an admin settles or refunds it, audited
//   L-H3          every settle and refund writes an audit row
//   L-M1          a patient cancel is mirrored onto the doctor-console row
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"sync"
	"testing"
	"time"

	"spotlight/backend/internal/doctor"
	"spotlight/backend/internal/telemedicine"
)

func (f *bridgeFixture) settlementStatus(t *testing.T) string {
	t.Helper()
	var s string
	if err := f.pool.QueryRow(f.ctx, `
		SELECT s.status FROM appointments a JOIN settlements s ON s.id = a.settlement_id WHERE a.id=$1`, f.appt).Scan(&s); err != nil {
		t.Fatalf("settlement status: %v", err)
	}
	return s
}

func (f *bridgeFixture) auditCount(t *testing.T, action string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx, `
		SELECT count(*) FROM doctor_compliance_audit WHERE action=$1 AND entity_id=$2`, action, f.appt).Scan(&n); err != nil {
		t.Fatalf("audit count: %v", err)
	}
	return n
}

func newAuditedFixture(t *testing.T) *bridgeFixture {
	f := newBridgeFixture(t, true)
	f.svc.WithAudit(doctor.NewRepository(f.pool))
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(), `DELETE FROM doctor_compliance_audit WHERE entity_id=$1`, f.appt)
	})
	return f
}

func TestLiveDB_Close_CompleteAndCancelRaceExactlyOneWins(t *testing.T) {
	f := newAuditedFixture(t)
	var wg sync.WaitGroup
	errs := make([]error, 2)
	wg.Add(2)
	go func() { defer wg.Done(); errs[0] = f.svc.CompleteAppointment(f.ctx, f.appt, f.doctorUserID) }()
	go func() { defer wg.Done(); errs[1] = f.svc.CancelAppointment(f.ctx, f.appt, f.doctorUserID) }()
	wg.Wait()
	if (errs[0] == nil) == (errs[1] == nil) {
		t.Fatalf("exactly one of complete/cancel must win: complete=%v cancel=%v", errs[0], errs[1])
	}
	appt, sett := f.status(t), f.settlementStatus(t)
	if !(appt == "completed" && sett == "settled") && !(appt == "cancelled" && sett == "refunded") {
		t.Fatalf("appointment %q and settlement %q disagree", appt, sett)
	}
}

func TestLiveDB_Close_EmitsAuditOnSettleAndRefund(t *testing.T) {
	a := newAuditedFixture(t)
	if err := a.svc.CompleteAppointment(a.ctx, a.appt, a.doctorUserID); err != nil {
		t.Fatalf("complete: %v", err)
	}
	if a.auditCount(t, "telemedicine.appointment.settled") != 1 {
		t.Fatal("L-H3: settle wrote no audit row")
	}
	b := newAuditedFixture(t)
	if err := b.svc.CancelAppointment(b.ctx, b.appt, b.patientID); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if b.auditCount(t, "telemedicine.appointment.refunded") != 1 {
		t.Fatal("L-H3: refund wrote no audit row")
	}
}

func TestLiveDB_Reconcile_FinishesAClaimWhosePaymentDidNotLand(t *testing.T) {
	for _, tc := range []struct{ claim, wantSett string }{
		{"completed", "settled"},
		{"cancelled", "refunded"},
	} {
		f := newAuditedFixture(t)
		// The terminal claim landed but the money call did not (crash, timeout).
		if _, err := f.pool.Exec(f.ctx, `
			UPDATE appointments SET status=$2, closed_at = now() - interval '10 minutes' WHERE id=$1`, f.appt, tc.claim); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.ReconcileConsults(f.ctx, time.Now()); err != nil {
			t.Fatalf("reconcile: %v", err)
		}
		if got := f.settlementStatus(t); got != tc.wantSett {
			t.Fatalf("claim %s: settlement %q after reconcile, want %q", tc.claim, got, tc.wantSett)
		}
		// Idempotent: a second sweep moves nothing more.
		if _, err := f.svc.ReconcileConsults(f.ctx, time.Now()); err != nil {
			t.Fatalf("second reconcile: %v", err)
		}
		if got := f.settlementStatus(t); got != tc.wantSett {
			t.Fatalf("second sweep changed settlement to %q", got)
		}
	}
}

func TestLiveDB_Reconcile_FlagsAStuckConsultAndAdminResolves(t *testing.T) {
	for _, action := range []string{"refund", "settle"} {
		f := newAuditedFixture(t)
		if err := f.svc.SyncFromDoctorConsole(f.ctx, f.appt, "in_progress", f.doctorUserID); err != nil {
			t.Fatalf("start: %v", err)
		}
		if _, err := f.pool.Exec(f.ctx, `UPDATE appointments SET scheduled_at = now() - make_interval(secs => $2) WHERE id=$1`,
			f.appt, (telemedicine.StuckConsultAfter + time.Hour).Seconds()); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.ReconcileConsults(f.ctx, time.Now()); err != nil {
			t.Fatalf("reconcile: %v", err)
		}
		var flagged bool
		if err := f.pool.QueryRow(f.ctx, `SELECT review_required_at IS NOT NULL FROM appointments WHERE id=$1`, f.appt).Scan(&flagged); err != nil {
			t.Fatal(err)
		}
		if !flagged {
			t.Fatal("L-H2: a consult stuck in_progress past StuckConsultAfter was not flagged for review")
		}
		if got := f.settlementStatus(t); got != "escrowed" {
			t.Fatalf("flagging must not move money, settlement is %q", got)
		}
		admin := f.stranger(t)
		if err := f.svc.AdminResolveAppointment(f.ctx, admin, f.appt, action, "doctor never ended the consult"); err != nil {
			t.Fatalf("admin %s: %v", action, err)
		}
		want := map[string][2]string{"refund": {"cancelled", "refunded"}, "settle": {"completed", "settled"}}[action]
		if appt, sett := f.status(t), f.settlementStatus(t); appt != want[0] || sett != want[1] {
			t.Fatalf("admin %s: appointment %q settlement %q, want %v", action, appt, sett, want)
		}
		var auditActor string
		if err := f.pool.QueryRow(f.ctx, `
			SELECT user_id::text FROM doctor_compliance_audit
			WHERE entity_id=$1 AND action LIKE 'telemedicine.appointment.%' ORDER BY created_at DESC LIMIT 1`, f.appt).
			Scan(&auditActor); err != nil || auditActor != admin {
			t.Fatalf("admin resolution must be audited with the admin as actor: actor=%q err=%v", auditActor, err)
		}
	}
}

func TestLiveDB_Patient_ReportProblemFlagsOnlyAStartedConsult(t *testing.T) {
	f := newAuditedFixture(t)
	if err := f.svc.ReportConsultProblem(f.ctx, f.appt, f.patientID, "doctor left"); err == nil {
		t.Fatal("a consult that has not started cannot be reported (the patient can still cancel)")
	}
	if err := f.svc.SyncFromDoctorConsole(f.ctx, f.appt, "in_progress", f.doctorUserID); err != nil {
		t.Fatalf("start: %v", err)
	}
	if err := f.svc.ReportConsultProblem(f.ctx, f.appt, f.stranger(t), "x"); err == nil {
		t.Fatal("a stranger reported someone else's consult")
	}
	if err := f.svc.ReportConsultProblem(f.ctx, f.appt, f.patientID, "doctor left"); err != nil {
		t.Fatalf("patient report: %v", err)
	}
	review, err := f.svc.ListAppointmentsNeedingReview(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range review {
		found = found || r.ID == f.appt
	}
	if !found {
		t.Fatal("L-H2: a patient-reported consult did not reach the admin review queue")
	}
}

func TestLiveDB_PatientCancelIsMirroredOntoTheConsole(t *testing.T) {
	f := newAuditedFixture(t)
	if err := f.svc.CancelAppointment(f.ctx, f.appt, f.patientID); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	var consoleStatus string
	if err := f.pool.QueryRow(f.ctx, `SELECT status FROM doctor_appointments WHERE id=$1::uuid`, f.appt).Scan(&consoleStatus); err != nil {
		t.Fatal(err)
	}
	if consoleStatus != "cancelled" {
		t.Fatalf("L-M1: console still shows %q after the patient cancelled and was refunded", consoleStatus)
	}
}
