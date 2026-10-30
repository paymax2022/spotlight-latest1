package telemedicine_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/telemedicine"
)

// Admin cancel refunds the real escrow exactly once (replay + retry safe),
// reassign moves the booking, detail/search/audit reflect both.
func TestLiveDB_AdminAppointmentActions(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := telemedicine.NewService(pool, settlement.NewService(pool, led)).WithTiers(tiers.NewService(pool))

	doctorA, _, patientID := seedApprovedDoctor(t, ctx, pool, led, 500_000)
	doctorB, _, _ := seedApprovedDoctor(t, ctx, pool, led, 400_000)
	admin := uuid.NewString()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM doctor_compliance_audit WHERE user_id = $1::uuid`, patientID)
	})

	book := func(at time.Duration) string {
		a, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
			DoctorID: doctorA, ScheduledAt: time.Now().Add(at).Truncate(time.Second), IdempotencyKey: "adm-" + uuid.NewString(),
		})
		if err != nil {
			t.Fatalf("book: %v", err)
		}
		return a.ID
	}
	cancelID, moveID := book(72*time.Hour), book(96*time.Hour)

	// Reassign A -> B; replay returns the stored result; a different key on a
	// no-longer-matching doctor conflicts.
	r1, err := svc.AdminReassignAppointment(ctx, admin, moveID, "reassign-key-1", telemedicine.AdminReassignRequest{DoctorID: doctorB, Reason: "doctor sick"})
	if err != nil || r1.DoctorID != doctorB {
		t.Fatalf("reassign: %+v %v", r1, err)
	}
	if r2, err := svc.AdminReassignAppointment(ctx, admin, moveID, "reassign-key-1", telemedicine.AdminReassignRequest{DoctorID: doctorB, Reason: "doctor sick"}); err != nil || !r2.Replayed {
		t.Fatalf("reassign replay: %+v %v", r2, err)
	}
	if _, err := svc.AdminReassignAppointment(ctx, admin, moveID, "reassign-key-2", telemedicine.AdminReassignRequest{DoctorID: doctorB, Reason: "again"}); !errors.Is(err, telemedicine.ErrAdminConflict) {
		t.Fatalf("reassign to same doctor err = %v", err)
	}

	// Cancel refunds the escrow once.
	walletBefore := patientBalance(t, ctx, led, patientID)
	c1, err := svc.AdminCancelAppointment(ctx, admin, cancelID, "cancel-key-01", telemedicine.AdminCancelRequest{Reason: "patient request by phone"})
	if err != nil || !c1.Refunded || c1.Status != "cancelled" {
		t.Fatalf("cancel: %+v %v", c1, err)
	}
	c2, err := svc.AdminCancelAppointment(ctx, admin, cancelID, "cancel-key-01", telemedicine.AdminCancelRequest{Reason: "patient request by phone"})
	if err != nil || !c2.Replayed {
		t.Fatalf("cancel replay: %+v %v", c2, err)
	}
	if _, err := svc.AdminCancelAppointment(ctx, admin, cancelID, "cancel-key-02", telemedicine.AdminCancelRequest{Reason: "again"}); !errors.Is(err, telemedicine.ErrAdminConflict) {
		t.Fatalf("second cancel err = %v", err)
	}
	if _, err := svc.AdminCancelAppointment(ctx, admin, moveID, "cancel-key-01", telemedicine.AdminCancelRequest{Reason: "x"}); !errors.Is(err, telemedicine.ErrAdminKeyReuse) {
		t.Fatalf("key reuse err = %v", err)
	}
	walletAfter := patientBalance(t, ctx, led, patientID)
	d, err := svc.GetAdminAppointment(ctx, cancelID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if walletAfter-walletBefore != d.TotalKobo {
		t.Errorf("refund credited %d kobo, want exactly the escrowed %d", walletAfter-walletBefore, d.TotalKobo)
	}
	if d.SettlementStatus != "refunded" || len(d.Audit) != 1 || d.Audit[0].Action != telemedicine.AdminActionCancel {
		t.Errorf("detail = %s audit=%+v", d.SettlementStatus, d.Audit)
	}

	// Search by doctor name prefix + id prefix.
	_, total, err := svc.ListAdminAppointments(ctx, telemedicine.AdminAppointmentListQuery{Search: moveID[:8], Limit: 20})
	if err != nil || total != 1 {
		t.Errorf("search by id prefix: total=%d err=%v", total, err)
	}
	if _, _, err := svc.ListAdminAppointments(ctx, telemedicine.AdminAppointmentListQuery{Search: "%_\\", Limit: 20}); err != nil {
		t.Errorf("search with LIKE metacharacters: %v", err)
	}
}

func patientBalance(t *testing.T, ctx context.Context, led *ledger.Service, userID string) int64 {
	t.Helper()
	b, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	return b
}
