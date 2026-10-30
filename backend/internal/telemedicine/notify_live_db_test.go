package telemedicine_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/telemedicine"
)

type sent struct{ user, event string }

type collector struct {
	mu  sync.Mutex
	got []sent
}

func (c *collector) fn() telemedicine.NotifierFunc {
	return func(_ context.Context, userID, event, _, _ string, _ map[string]any) error {
		c.mu.Lock()
		defer c.mu.Unlock()
		c.got = append(c.got, sent{userID, event})
		return nil
	}
}

func (c *collector) waitFor(t *testing.T, n int) []sent {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		c.mu.Lock()
		if len(c.got) >= n {
			out := append([]sent(nil), c.got...)
			c.mu.Unlock()
			return out
		}
		c.mu.Unlock()
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d notices, got %v", n, c.got)
	return nil
}

func TestLiveDB_BookingAndCancelNotifyBothParties(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	c := &collector{}
	svc := telemedicine.NewService(pool, settlement.NewService(pool, led)).WithTiers(tiers.NewService(pool)).WithNotifier(c.fn())

	doctorID, doctorUserID, patientID := seedApprovedDoctor(t, ctx, pool, led, 500_000)
	req := telemedicine.BookAppointmentRequest{
		DoctorID: doctorID, ScheduledAt: time.Now().Add(50 * time.Hour).Truncate(time.Second), IdempotencyKey: "ntf-" + uuid.NewString(),
	}
	appt, err := svc.BookAppointment(ctx, patientID, req)
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	got := c.waitFor(t, 2)
	if _, err := svc.BookAppointment(ctx, patientID, req); err != nil { // replay must not re-notify
		t.Fatalf("replay: %v", err)
	}
	if err := svc.CancelAppointment(ctx, appt.ID, patientID); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	got = c.waitFor(t, 4)
	want := map[sent]bool{
		{patientID, telemedicine.NotifyEventBooked}: true, {doctorUserID, telemedicine.NotifyEventBooked}: true,
		{patientID, telemedicine.NotifyEventCancelled}: true, {doctorUserID, telemedicine.NotifyEventCancelled}: true,
	}
	if len(got) != 4 {
		t.Fatalf("notices = %v, want exactly 4 (replay must not notify)", got)
	}
	for _, g := range got {
		if !want[g] {
			t.Errorf("unexpected notice %v", g)
		}
	}
}
