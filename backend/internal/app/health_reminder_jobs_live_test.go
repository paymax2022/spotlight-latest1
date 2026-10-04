package app

// Live-DB tests for the two health reminder job handlers wired by
// registerHealthReminderJobs. Each handler re-reads its entity at fire time;
// these tests pin the three outcomes the poller depends on:
//   - finished/gone entity → nil (occurrence consumed, nothing to remind)
//   - live entity → Send attempted (a nil-client notifier surfaces the
//     enqueue error, which the run must see so it can retry)
// SKIPPED whenever TEST_DATABASE_URL is unset — same gate as the rest of the
// package's live suites.
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./internal/app/ -run HealthReminder -v

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/notifications"
	"spotlight/backend/internal/scheduler"
	"spotlight/backend/internal/testsupport"
)

type fakeJobView struct {
	id      string
	owner   string
	entity  string
	payload map[string]any
}

func (v fakeJobView) ID() string          { return v.id }
func (v fakeJobView) OwnerUserID() string { return v.owner }
func (v fakeJobView) EntityRef() string   { return v.entity }
func (v fakeJobView) PayloadValue(k string) (any, bool) {
	val, ok := v.payload[k]
	return val, ok
}

//nolint:containedctx // scheduler.HandlerCtx.Context() forces the fake to hold one to return
type fakeHctx struct {
	ctx  context.Context
	idem string
	job  fakeJobView
}

func (h fakeHctx) Context() context.Context { return h.ctx }
func (h fakeHctx) IdemKey() string          { return h.idem }
func (h fakeHctx) Job() scheduler.JobView   { return h.job }

func healthReminderPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping health reminder live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func reminderSeedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	uid := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, uid, uid+"@reminder.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUserCtx(t, ctx, pool, uid)
	return uid
}

func reminderSeedProvider(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		 VALUES ($1,$2,'VET','vet','Reminder Test Provider','APPROVED')`, id, ownerID); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM health_providers WHERE id=$1`, id)
	})
	return id
}

func reminderSeedAppointment(t *testing.T, ctx context.Context, pool *pgxpool.Pool, patientID, providerID, state string) string {
	t.Helper()
	id := uuid.NewString()
	now := time.Now()
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_appointments (id, provider_id, patient_id, visit_type, state, slot_start, slot_end)
		 VALUES ($1,$2,$3,'TELE',$4,$5,$6)`,
		id, providerID, patientID, state, now.Add(time.Hour), now.Add(2*time.Hour)); err != nil {
		t.Fatalf("seed appointment: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM health_appointments WHERE id=$1`, id)
	})
	return id
}

func reminderSeedPet(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO pets (id, owner_user_id, name, species) VALUES ($1,$2,'Remy','DOG')`, id, ownerID); err != nil {
		t.Fatalf("seed pet: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM pets WHERE id=$1`, id)
	})
	return id
}

func reminderSeedVaccination(t *testing.T, ctx context.Context, pool *pgxpool.Pool, petID, ownerID string, administered bool) string {
	t.Helper()
	id := uuid.NewString()
	var adminAt *time.Time
	if administered {
		now := time.Now()
		adminAt = &now
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO vaccination_schedules (id, pet_id, owner_user_id, vaccine, due_at, administered_at)
		 VALUES ($1,$2,$3,'Rabies',$4,$5)`, id, petID, ownerID, time.Now().Add(24*time.Hour), adminAt); err != nil {
		t.Fatalf("seed vaccination: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM vaccination_schedules WHERE id=$1`, id)
	})
	return id
}

// nilNotifier stands in for an unreachable queue: Send always returns an
// error, so a nil handler error PROVES the send path was skipped.
func nilNotifier() *notifications.Service { return notifications.NewService(nil) }

func TestLiveDB_HealthReminder_CancelledAppointmentIsConsumed(t *testing.T) {
	pool := healthReminderPool(t)
	ctx := context.Background()
	uid := reminderSeedUser(t, ctx, pool)
	provID := reminderSeedProvider(t, ctx, pool, uid)
	apptID := reminderSeedAppointment(t, ctx, pool, uid, provID, "CANCELLED")

	h := appointmentReminderHandler(pool, nilNotifier())
	if err := h(fakeHctx{ctx: ctx, idem: "k", job: fakeJobView{id: "j1", entity: apptID}}); err != nil {
		t.Fatalf("cancelled appointment reminder returned %v — terminal states must be consumed quietly, not retried", err)
	}
}

func TestLiveDB_HealthReminder_ConfirmedAppointmentAttemptsDelivery(t *testing.T) {
	pool := healthReminderPool(t)
	ctx := context.Background()
	uid := reminderSeedUser(t, ctx, pool)
	provID := reminderSeedProvider(t, ctx, pool, uid)
	apptID := reminderSeedAppointment(t, ctx, pool, uid, provID, "CONFIRMED")

	h := appointmentReminderHandler(pool, nilNotifier())
	if err := h(fakeHctx{ctx: ctx, idem: "k", job: fakeJobView{id: "j2", entity: apptID}}); err == nil {
		t.Fatal("confirmed appointment reminder returned nil with a nil queue client — the run must see the enqueue failure so it retries")
	}
}

func TestLiveDB_HealthReminder_GoneAppointmentIsConsumed(t *testing.T) {
	pool := healthReminderPool(t)
	ctx := context.Background()

	h := appointmentReminderHandler(pool, nilNotifier())
	if err := h(fakeHctx{ctx: ctx, idem: "k", job: fakeJobView{id: "j3", entity: uuid.NewString()}}); err != nil {
		t.Fatalf("missing appointment reminder returned %v — a deleted entity must be consumed, not retried", err)
	}
}

func TestLiveDB_HealthReminder_AdministeredVaccinationIsConsumed(t *testing.T) {
	pool := healthReminderPool(t)
	ctx := context.Background()
	uid := reminderSeedUser(t, ctx, pool)
	petID := reminderSeedPet(t, ctx, pool, uid)
	vaccID := reminderSeedVaccination(t, ctx, pool, petID, uid, true)

	h := vaccinationReminderHandler(pool, nilNotifier())
	if err := h(fakeHctx{ctx: ctx, idem: "k", job: fakeJobView{id: "j4", entity: vaccID}}); err != nil {
		t.Fatalf("administered vaccination reminder returned %v — already-done schedules must be consumed quietly", err)
	}
}

func TestLiveDB_HealthReminder_PendingVaccinationAttemptsDelivery(t *testing.T) {
	pool := healthReminderPool(t)
	ctx := context.Background()
	uid := reminderSeedUser(t, ctx, pool)
	petID := reminderSeedPet(t, ctx, pool, uid)
	vaccID := reminderSeedVaccination(t, ctx, pool, petID, uid, false)

	h := vaccinationReminderHandler(pool, nilNotifier())
	if err := h(fakeHctx{ctx: ctx, idem: "k", job: fakeJobView{id: "j5", entity: vaccID}}); err == nil {
		t.Fatal("pending vaccination reminder returned nil with a nil queue client — the run must see the enqueue failure so it retries")
	}
}
