package healthlab

// Live-DB coverage for the provider earnings read model. It moves no money; it
// must agree exactly with the escrow rows the ledger credits from. Skips without
// TEST_DATABASE_URL.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type fixedBalance struct {
	kobo int64
	err  error
}

func (f fixedBalance) AvailableKobo(context.Context, string) (int64, error) { return f.kobo, f.err }

// seedHeldOrder inserts an escrow hold plus the lab order bound to it.
func seedEscrowOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, patient, lab, payee, holdState, orderState string, kobo int64) {
	t.Helper()
	hold := uuid.NewString()
	order := uuid.NewString()
	var payeeArg any
	if payee != "" {
		payeeArg = payee
	}
	if _, err := pool.Exec(ctx, `INSERT INTO escrow_holds (id, reference, module_type, payer_id, payee_id, amount_kobo, state, idempotency_key)
		VALUES ($1,$2,'health.lab',$3,$4,$5,$6,$7)`, hold, "lab:"+order, patient, payeeArg, kobo, holdState, "earn-"+hold); err != nil {
		t.Fatalf("seed hold: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO lab_orders (id, patient_id, lab_provider_id, state, collection_method, total_kobo, escrow_id, idempotency_key)
		VALUES ($1,$2,$3,$4,'WALK_IN',$5,$6,$7)`, order, patient, lab, orderState, kobo, hold, "earn-o-"+order); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM lab_orders WHERE id=$1`, order)
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM escrow_holds WHERE id=$1`, hold)
	})
}

func TestLiveDB_Earnings_BucketsMatchEscrowStates(t *testing.T) {
	pool := listEndpointsLivePool(t)
	ctx := t.Context()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)
	svc.SetEarningsReader(fixedBalance{kobo: 7_000_00})

	owner, otherOwner, patient := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, u := range []string{owner, otherOwner, patient} {
		seedLabTestUser(t, ctx, pool, u)
	}
	lab := seedDirLab(t, ctx, pool, owner, true, false, "APPROVED")
	otherLab := seedDirLab(t, ctx, pool, otherOwner, true, false, "APPROVED")

	// Released to this owner: counts as earned.
	seedEscrowOrder(t, ctx, pool, patient, lab, owner, "RELEASED", "RELEASED", 1_000_00)
	seedEscrowOrder(t, ctx, pool, patient, lab, owner, "RELEASED", "CLOSED", 2_000_00)
	// In flight: pending.
	seedEscrowOrder(t, ctx, pool, patient, lab, owner, "HELD", "CREATED", 300_00)
	seedEscrowOrder(t, ctx, pool, patient, lab, owner, "HELD", "PROCESSING", 400_00)
	// Awaiting sign-off / contested: held.
	seedEscrowOrder(t, ctx, pool, patient, lab, owner, "HELD", "RESULT_READY", 500_00)
	seedEscrowOrder(t, ctx, pool, patient, lab, owner, "HELD", "ESCALATED", 600_00)
	seedEscrowOrder(t, ctx, pool, patient, lab, owner, "DISPUTED", "RELEASED", 700_00)
	// Never this owner's money.
	seedEscrowOrder(t, ctx, pool, patient, lab, owner, "REFUNDED", "CANCELLED", 9_000_00)
	seedEscrowOrder(t, ctx, pool, patient, otherLab, otherOwner, "RELEASED", "RELEASED", 8_000_00)
	seedEscrowOrder(t, ctx, pool, patient, lab, otherOwner, "RELEASED", "RELEASED", 6_000_00) // released to someone else

	e, err := svc.ProviderEarnings(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	if e.EarnedKobo != 3_000_00 {
		t.Errorf("earned = %d, want 300000 (released to this owner only)", e.EarnedKobo)
	}
	if e.PendingKobo != 700_00 {
		t.Errorf("pending = %d, want 70000", e.PendingKobo)
	}
	if e.HeldKobo != 1_800_00 {
		t.Errorf("held = %d, want 180000 (sign-off + escalated + disputed)", e.HeldKobo)
	}
	if e.AvailableKobo != 7_000_00 {
		t.Errorf("available must be the wallet balance the ledger reports, got %d", e.AvailableKobo)
	}
}

func TestLiveDB_Earnings_OnlyTheLabOwner(t *testing.T) {
	pool := listEndpointsLivePool(t)
	ctx := t.Context()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)
	svc.SetEarningsReader(fixedBalance{kobo: 1})
	stranger := uuid.NewString()
	seedLabTestUser(t, ctx, pool, stranger)
	if _, err := svc.ProviderEarnings(ctx, stranger); !errors.Is(err, ErrNotLabOwner) {
		t.Fatalf("a user who owns no lab must be refused, got %v", err)
	}
}

func TestLiveDB_Earnings_BalanceFailureIsAnErrorNotZero(t *testing.T) {
	pool := listEndpointsLivePool(t)
	ctx := t.Context()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)
	svc.SetEarningsReader(fixedBalance{err: errors.New("ledger down")})
	owner := uuid.NewString()
	seedLabTestUser(t, ctx, pool, owner)
	seedDirLab(t, ctx, pool, owner, true, false, "APPROVED")
	if _, err := svc.ProviderEarnings(ctx, owner); err == nil {
		t.Fatal("an unavailable ledger must fail the read, never report a zero balance")
	}
}

func TestLiveDB_Earnings_WithdrawalsAndReviews(t *testing.T) {
	pool := listEndpointsLivePool(t)
	ctx := t.Context()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)
	svc.SetEarningsReader(fixedBalance{kobo: 0})
	owner, patient := uuid.NewString(), uuid.NewString()
	seedLabTestUser(t, ctx, pool, owner)
	seedLabTestUser(t, ctx, pool, patient)
	lab := seedDirLab(t, ctx, pool, owner, true, false, "APPROVED")

	for i, st := range []string{"successful", "funds_reserved", "failed", "reversed"} {
		if _, err := pool.Exec(ctx, `INSERT INTO bank_transfers (user_id, amount_kobo, fee_kobo, account_number, account_number_last4, account_name, bank_code, bank_name, reference, status, idempotency_key)
			VALUES ($1,$2,0,'0123456789','6789','Lab Owner','058','GTBank',$3,$4,$5)`,
			owner, int64(100000*(i+1)), "bt-earn-"+uuid.NewString()[:8], st, "wd-"+uuid.NewString()); err != nil {
			t.Fatalf("seed bank transfer: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM bank_transfers WHERE user_id=$1`, owner)
	})

	e, err := svc.ProviderEarnings(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]int{}
	for _, p := range e.Withdrawals {
		got[p.Status]++
	}
	if got["paid"] != 1 || got["processing"] != 1 || got["failed"] != 2 {
		t.Fatalf("bank transfer statuses must map to paid/processing/failed, got %v", got)
	}

	order := seedDirOrder(t, ctx, pool, patient, lab, "RELEASED")
	if _, err := svc.SubmitReview(ctx, patient, order, 5, "Great"); err != nil {
		t.Fatal(err)
	}
	reviews, err := svc.ProviderReviews(ctx, owner)
	if err != nil || len(reviews) != 1 || reviews[0].Rating != 5 {
		t.Fatalf("the owner must see reviews of their lab: %v %+v", err, reviews)
	}
	if _, err := svc.ProviderReviews(ctx, patient); !errors.Is(err, ErrNotLabOwner) {
		t.Fatalf("only the lab owner reads provider reviews, got %v", err)
	}
}
