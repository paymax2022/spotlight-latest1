package healthvet

// LIVE-DB regression coverage for Book's post-hold unwind (failBooking): if
// sched.Request has minted the appointment and escrow.Hold has posted, but a
// later step fails (payment-row insert injected here), the compensation must
// (a) refund ONLY an unbound payer hold and (b) cancel the orphaned REQUESTED
// appointment — a REQUESTED row squats the provider's slot (blockingStates)
// and is invisible to load()'s payment-row JOIN, so without the unwind the
// slot is bricked and the owner's money is stranded in escrow.
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/ledger"
	healthscheduling "spotlight/backend/internal/health/scheduling"
	"spotlight/backend/internal/scheduler"
	"spotlight/backend/internal/testsupport"

	goredis "github.com/redis/go-redis/v9"
)

func vetUnwindPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping vet booking unwind live-DB tests")
	}
	pool, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// vetUnwindEscrow mirrors internal/app's unexported escrow adapter — the real
// escrow.Service is required here because the dedup/refund semantics under
// test live in the rail, not the fake.
type vetUnwindHoldRef struct{ id string }

func (h vetUnwindHoldRef) HoldID() string { return h.id }

type vetUnwindEscrow struct{ e *escrow.Service }

func (e vetUnwindEscrow) Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (HoldRef, error) {
	hold, err := e.e.Hold(ctx, payerID, reference, moduleType, idemKey, amountKobo)
	if err != nil {
		return nil, err
	}
	return vetUnwindHoldRef{id: hold.ID}, nil
}
func (e vetUnwindEscrow) Release(ctx context.Context, escrowID, payeeID string) error {
	return e.e.Release(ctx, escrowID, payeeID)
}
func (e vetUnwindEscrow) Refund(ctx context.Context, escrowID string) error {
	return e.e.Refund(ctx, escrowID)
}

func TestLiveDB_Book_PostHoldFailureUnwindsSlotAndHold(t *testing.T) {
	pool := vetUnwindPool(t)
	ctx := t.Context()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	ownerID := uuid.New().String()
	vetOwnerID := uuid.New().String()
	for _, u := range []string{ownerID, vetOwnerID} {
		seedVetTestUser(t, ctx, pool, u)
	}
	testsupport.SetKycTier(t, ctx, pool, ownerID, testsupport.KycTierUnlimited)
	providerID := seedVetProvider(t, ctx, pool, vetOwnerID)
	serviceID := seedVetService(t, ctx, pool, providerID)
	petID := seedVetPet(t, ctx, pool, ownerID)

	schedulingSvc := healthscheduling.NewService(pool, scheduler.NewService(pool), nil)
	svc := NewService(pool, vetUnwindEscrow{e: escrow.NewService(pool, led, nil)}, nil,
		fakeVCNGate{providerID: providerID, vetOwnerID: vetOwnerID, approved: true},
		nil, schedulingSvc, nil, nil, nil, nil, nil)

	// Deterministic failure injection: refuse vet_appointment_payments inserts
	// carrying the marked idempotency key. Dropped in cleanup.
	if _, err := pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION vet_fail_pay_insert() RETURNS trigger AS $$
		BEGIN
			IF NEW.idempotency_key LIKE 'vetunwind-%' THEN
				RAISE EXCEPTION 'injected vet payment insert failure';
			END IF;
			RETURN NEW;
		END $$ LANGUAGE plpgsql`); err != nil {
		t.Fatalf("create inject function: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		CREATE TRIGGER trg_vet_fail_pay BEFORE INSERT ON vet_appointment_payments
		FOR EACH ROW EXECUTE FUNCTION vet_fail_pay_insert()`); err != nil {
		t.Fatalf("create inject trigger: %v", err)
	}
	t.Cleanup(func() {
		bg := context.WithoutCancel(ctx)
		_, _ = pool.Exec(bg, `DROP TRIGGER IF EXISTS trg_vet_fail_pay ON vet_appointment_payments`)
		_, _ = pool.Exec(bg, `DROP FUNCTION IF EXISTS vet_fail_pay_insert()`)
	})

	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, ownerID, "vet-unwind-seed", "vet-unwind-fund-"+uuid.New().String(), revAcc.ID, 5_000_000); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}

	slotStart := time.Now().Add(48 * time.Hour).Truncate(time.Minute)
	slotEnd := slotStart.Add(30 * time.Minute)
	failKey := "vetunwind-" + uuid.New().String()
	in := BookInput{
		ProviderID: providerID, PetID: petID, ServiceID: serviceID, VisitType: VisitTele,
		SlotStart: slotStart, SlotEnd: slotEnd, IdempotencyKey: failKey,
	}

	if _, err := svc.Book(ctx, ownerID, in); err == nil {
		t.Fatal("Book with injected payment-insert failure must fail")
	}

	// The orphaned appointment must have been cancelled out — the REQUESTED
	// row would otherwise squat the provider's slot.
	var apptStates []string
	rows, err := pool.Query(ctx, `SELECT state FROM health_appointments WHERE patient_id=$1`, ownerID)
	if err != nil {
		t.Fatalf("read appointments: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatalf("scan appointment: %v", err)
		}
		apptStates = append(apptStates, s)
	}
	rows.Close()
	if len(apptStates) != 1 || apptStates[0] != string(StateCancelled) {
		t.Fatalf("orphaned appointment states = %v, want exactly [CANCELLED]", apptStates)
	}

	// The deduped hold was unbound → refunded.
	var holdState string
	if err := pool.QueryRow(ctx, `SELECT state FROM escrow_holds WHERE idempotency_key=$1`, failKey).Scan(&holdState); err != nil {
		t.Fatalf("read escrow hold: %v", err)
	}
	if holdState != "REFUNDED" {
		t.Fatalf("escrow hold state = %q, want REFUNDED after booking unwind", holdState)
	}

	// No payment row may have survived the injected failure.
	var payCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM vet_appointment_payments WHERE owner_id=$1`, ownerID).Scan(&payCount); err != nil {
		t.Fatalf("count payments: %v", err)
	}
	if payCount != 0 {
		t.Fatalf("orphan vet_appointment_payments row created under injected failure: %d", payCount)
	}

	// The owner's balance is fully restored — no stranded debit.
	var balance int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN le.type='CREDIT' THEN le.amount_kobo ELSE -le.amount_kobo END), 0)
		FROM ledger_entries le JOIN ledger_accounts la ON la.id = le.account_id
		WHERE la.user_id = $1`, ownerID).Scan(&balance); err != nil {
		t.Fatalf("read wallet balance: %v", err)
	}
	if balance != 5_000_000 {
		t.Fatalf("owner wallet balance = %d, want 5000000 (hold fully refunded)", balance)
	}

	// The slot is free again: a fresh booking at the same slot must succeed —
	// if the orphan REQUESTED row had survived, Request would refuse with
	// ErrSlotTaken.
	in.IdempotencyKey = "vetrebook-" + uuid.New().String() // must NOT match the 'vetunwind-%' trigger marker
	rebooked, err := svc.Book(ctx, ownerID, in)
	if err != nil {
		t.Fatalf("re-book at the released slot must succeed (orphan would block it): %v", err)
	}
	if rebooked == nil || rebooked.State != StateRequested {
		t.Fatalf("re-booked appointment = %+v, want REQUESTED", rebooked)
	}
}
