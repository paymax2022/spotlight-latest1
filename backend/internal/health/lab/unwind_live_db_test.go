package healthlab

// LIVE-DB regression coverage for CreateOrder's post-hold unwind
// (failAfterHold): when the escrow hold has posted but the lab_orders insert
// fails, the hold must be refunded ONLY when it is still this payer's AND
// unbound — escrow.Hold dedups on the bare idempotency key, so the hold may
// belong to a winning concurrent request (bound to a committed order) and
// must never be refunded out from under it.
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"

	goredis "github.com/redis/go-redis/v9"
)

func labUnwindPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping lab post-hold unwind live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// labUnwindEscrowAdapter mirrors internal/app's unexported escrowAdapter —
// re-created narrowly so this test can drive the REAL escrow.Service (the
// dedup-on-idempotency-key behavior under test lives there, not in the fake).
type labUnwindHoldRef struct{ id string }

func (h labUnwindHoldRef) HoldID() string { return h.id }

type labUnwindEscrow struct{ e *escrow.Service }

func (e labUnwindEscrow) Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (HoldRef, error) {
	hold, err := e.e.Hold(ctx, payerID, reference, moduleType, idemKey, amountKobo)
	if err != nil {
		return nil, err
	}
	return labUnwindHoldRef{id: hold.ID}, nil
}
func (e labUnwindEscrow) Release(ctx context.Context, escrowID, payeeID string) error {
	return e.e.Release(ctx, escrowID, payeeID)
}
func (e labUnwindEscrow) Refund(ctx context.Context, escrowID string) error {
	return e.e.Refund(ctx, escrowID)
}

// labUnwindProv approves the seeded lab only.
type labUnwindProv struct{ labID string }

func (p labUnwindProv) IsApprovedLab(_ context.Context, providerID string) (bool, error) {
	return providerID == p.labID, nil
}
func (p labUnwindProv) VerifiedLabOwner(context.Context, string, string) (bool, error) {
	return false, nil
}
func (p labUnwindProv) IsVerifiedScientist(context.Context, string, string) (bool, error) {
	return false, nil
}
func (p labUnwindProv) IsVerifiedPhlebotomist(context.Context, string, string) (bool, error) {
	return false, nil
}

// TestLiveDB_CreateOrder_PostHoldFailureRefundsUnboundHold injects a
// deterministic lab_orders insert failure (a BEFORE INSERT trigger that
// raises on a marked idempotency key) AFTER escrow.Hold committed, then
// proves the compensation ran: the hold is REFUNDED, no order row exists, and
// the patient's balance is restored.
func TestLiveDB_CreateOrder_PostHoldFailureRefundsUnboundHold(t *testing.T) {
	pool := labUnwindPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	patientID, _, _, _, _, labID := seedLabAuthzFixture(t, ctx, pool)
	testsupport.SetKycTier(t, ctx, pool, patientID, testsupport.KycTierUnlimited)

	testID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_tests (id, lab_provider_id, name, price_kobo, active) VALUES ($1,$2,'Unwind Panel',150000,true)`,
		testID, labID); err != nil {
		t.Fatalf("seed test: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM lab_tests WHERE id=$1`, testID)
	})

	// Deterministic failure injection: refuse lab_orders inserts carrying the
	// marked idempotency key. Dropped in cleanup.
	if _, err := pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION lab_fail_order_insert() RETURNS trigger AS $$
		BEGIN
			IF NEW.idempotency_key LIKE 'labunwind-%' THEN
				RAISE EXCEPTION 'injected lab_orders insert failure';
			END IF;
			RETURN NEW;
		END $$ LANGUAGE plpgsql`); err != nil {
		t.Fatalf("create inject function: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		CREATE TRIGGER trg_lab_fail_order_insert BEFORE INSERT ON lab_orders
		FOR EACH ROW EXECUTE FUNCTION lab_fail_order_insert()`); err != nil {
		t.Fatalf("create inject trigger: %v", err)
	}
	t.Cleanup(func() {
		bg := context.WithoutCancel(ctx)
		_, _ = pool.Exec(bg, `DROP TRIGGER IF EXISTS trg_lab_fail_order_insert ON lab_orders`)
		_, _ = pool.Exec(bg, `DROP FUNCTION IF EXISTS lab_fail_order_insert()`)
	})

	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, patientID, "lab-unwind-seed", "lab-unwind-fund-"+uuid.New().String(), revAcc.ID, 5_000_000); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}

	svc := NewService(pool, labUnwindEscrow{e: escrow.NewService(pool, led, nil)}, nil, labUnwindProv{labID: labID}, nil, nil, nil, nil)

	key := "labunwind-" + uuid.New().String()
	_, err = svc.CreateOrder(ctx, patientID, CreateOrderInput{
		LabProviderID:    labID,
		CollectionMethod: CollectWalkIn,
		IdempotencyKey:   key,
		TestIDs:          []string{testID},
	})
	if err == nil {
		t.Fatal("CreateOrder with injected insert failure must fail")
	}

	// No order row may have survived the injected failure.
	var orderCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM lab_orders WHERE idempotency_key=$1`, key).Scan(&orderCount); err != nil {
		t.Fatalf("count orders: %v", err)
	}
	if orderCount != 0 {
		t.Fatalf("orphan lab_orders row created under injected failure: %d", orderCount)
	}

	// The deduped hold was genuinely unbound → the unwind must have refunded it.
	var holdState string
	if err := pool.QueryRow(ctx, `SELECT state FROM escrow_holds WHERE idempotency_key=$1`, key).Scan(&holdState); err != nil {
		t.Fatalf("read escrow hold: %v", err)
	}
	if holdState != "REFUNDED" {
		t.Fatalf("escrow hold state = %q, want REFUNDED after post-hold unwind", holdState)
	}

	// The patient's balance is fully restored — no stranded debit.
	var balance int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN le.type='CREDIT' THEN le.amount_kobo ELSE -le.amount_kobo END), 0)
		FROM ledger_entries le JOIN ledger_accounts la ON la.id = le.account_id
		WHERE la.user_id = $1`, patientID).Scan(&balance); err != nil {
		t.Fatalf("read wallet balance: %v", err)
	}
	if balance != 5_000_000 {
		t.Fatalf("patient wallet balance = %d, want 5000000 (hold fully refunded)", balance)
	}
}
