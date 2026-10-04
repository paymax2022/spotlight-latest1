package settlement_test

// LIVE-DB regression for the payout fraud gate: stays_reservation.property_id
// may carry the supplier ref rather than the internal stays_property.id, so
// HasCompletedStay must resolve through stays_property. Pins: supplier-ref join
// finds the stay, ReleasePayout posts balanced legs, a property with no
// completed stay still fails closed, re-release is idempotent.
// Skipped unless TEST_DATABASE_URL is set.
// SKIPPED whenever TEST_DATABASE_URL is unset.
//   export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" // trufflehog:ignore
//   cd backend && go test ./internal/stays/settlement/ -run TestLiveDB -v -count=1

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	stayssettlement "spotlight/backend/internal/stays/settlement"
	"spotlight/backend/internal/testsupport"
)

func mustPayoutPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping TEST_DATABASE_URL: %v", err)
	}
	return pool
}

func seedUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

// seedProperty inserts a self-listed DIRECT property (the same shape the extranet
// stamps: source_rail='DIRECT', supplier_code='self', uuid-shaped supplier ref)
// and returns (internal id, supplier_property_ref).
func seedProperty(t *testing.T, pool *pgxpool.Pool) (string, string) {
	t.Helper()
	var id, ref string
	ref = uuid.NewString() // uuid-shaped — the ambiguity this test exercises
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO public.stays_property
			(source_rail, supplier_code, supplier_property_ref, name, address, city, star_rating, property_type, status)
		VALUES ('DIRECT','self',$1,'PayoutGate Test Hotel','1 St','Lagos',4,'hotel','ACTIVE')
		RETURNING id`, ref).Scan(&id); err != nil {
		t.Fatalf("seed stays_property: %v", err)
	}
	return id, ref
}

// seedCompletedReservation writes a COMPLETED reservation whose property_id is
// whatever identifier the caller stored at booking (internal id or supplier ref —
// the contract ambiguity under test).
func seedCompletedReservation(t *testing.T, pool *pgxpool.Pool, guestID, storedPropertyRef string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO public.stays_reservation
			(guest_user_id, property_id, source_rail, supplier_code, supplier_ref, state,
			 check_in, check_out, rooms, currency, gross_amount_kobo, net_rate_kobo,
			 payment_method, cancellation_policy_snapshot, idempotency_key)
		VALUES ($1, $2::uuid, 'DIRECT', 'self', $3, 'COMPLETED',
		        $4::date, $5::date, 1, 'NGN', 5000000, 4500000,
		        'WALLET', '{"refundable":true}'::jsonb, $6)
		RETURNING id`,
		guestID, storedPropertyRef, "DIR-"+uuid.NewString()[:12],
		time.Now().Add(-72*time.Hour).Format("2006-01-02"),
		time.Now().Add(-48*time.Hour).Format("2006-01-02"),
		"test-"+uuid.NewString()).Scan(&id); err != nil {
		t.Fatalf("seed stays_reservation: %v", err)
	}
	return id
}

// walletCredits sums CREDIT ledger entries on the user's wallet account.
func walletCredits(t *testing.T, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var sum int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(le.amount_kobo),0)
		FROM ledger_entries le
		JOIN ledger_accounts a ON a.id = le.account_id
		WHERE a.user_id = $1 AND a.type = 'user_wallet' AND le.type = 'CREDIT'`,
		userID).Scan(&sum); err != nil {
		t.Fatalf("sum wallet credits: %v", err)
	}
	return sum
}

func TestLiveDB_PayoutReleasedWhenStayCompletedUnderSupplierRef(t *testing.T) {
	ctx := context.Background()
	pool := mustPayoutPool(t)
	repo := stayssettlement.NewRepository(pool)
	svc := stayssettlement.NewService(repo, ledger.NewService(ledger.NewRepository(pool), nil))

	hotelier := seedUser(t, pool)
	guest := seedUser(t, pool)
	propID, supplierRef := seedProperty(t, pool)

	// The ambiguity: the reservation's property_id holds the SUPPLIER ref, not
	// the internal property id (the client-contract storage shape).
	resID := seedCompletedReservation(t, pool, guest, supplierRef)

	ok, err := repo.HasCompletedStay(ctx, propID)
	if err != nil {
		t.Fatalf("HasCompletedStay: %v", err)
	}
	if !ok {
		t.Fatal("HasCompletedStay missed a COMPLETED stay stored under the supplier ref — E2E-CMS-004")
	}

	const amount = int64(1_000_000)
	payoutID, err := svc.QueuePayout(ctx, propID, hotelier, resID, amount, "pq-"+uuid.NewString())
	if err != nil {
		t.Fatalf("QueuePayout: %v", err)
	}
	before := walletCredits(t, pool, hotelier)

	p, err := svc.ReleasePayout(ctx, payoutID)
	if err != nil {
		t.Fatalf("ReleasePayout: %v", err)
	}
	if p.Status != "PAID" {
		t.Fatalf("payout status = %q, want PAID", p.Status)
	}
	if got := walletCredits(t, pool, hotelier); got != before+amount {
		t.Fatalf("hotelier wallet credits = %d, want %d (+%d)", got, before, before+amount)
	}

	// Idempotent re-release: PAID no-op, no second credit.
	if _, err := svc.ReleasePayout(ctx, payoutID); err != nil {
		t.Fatalf("re-release: %v", err)
	}
	if got := walletCredits(t, pool, hotelier); got != before+amount {
		t.Fatalf("re-release double-credited: credits = %d, want %d", got, before+amount)
	}
}

func TestLiveDB_PayoutStillHeldWithoutCompletedStay(t *testing.T) {
	ctx := context.Background()
	pool := mustPayoutPool(t)
	repo := stayssettlement.NewRepository(pool)
	svc := stayssettlement.NewService(repo, ledger.NewService(ledger.NewRepository(pool), nil))

	hotelier := seedUser(t, pool)
	propID, _ := seedProperty(t, pool) // property with NO reservation at all

	ok, err := repo.HasCompletedStay(ctx, propID)
	if err != nil {
		t.Fatalf("HasCompletedStay: %v", err)
	}
	if ok {
		t.Fatal("HasCompletedStay reported a stay for a property with none — fraud gate must fail closed")
	}

	payoutID, err := svc.QueuePayout(ctx, propID, hotelier, "", 500_000, "pqheld-"+uuid.NewString())
	if err != nil {
		t.Fatalf("QueuePayout: %v", err)
	}
	if _, err := svc.ReleasePayout(ctx, payoutID); !errors.Is(err, stayssettlement.ErrPayoutHeld) {
		t.Fatalf("ReleasePayout on a property with no completed stay = %v, want ErrPayoutHeld", err)
	}
}

// ────────────────────────────────────────────────────────────────────────────
// PIN: HasCompletedStay is supplier-scoped — a reservation whose stored
// property_id matches a property's supplier_property_ref but was booked under
// a DIFFERENT rail/supplier must NOT open the payout gate. Supplier refs are
// only unique per supplier, so a cross-supplier ref collision (or a crafted
// booking) must not satisfy THIS property's fraud gate.
// ────────────────────────────────────────────────────────────────────────────
func TestLiveDB_HasCompletedStay_CrossSupplierRefDoesNotOpenGate(t *testing.T) {
	ctx := context.Background()
	pool := mustPayoutPool(t)
	repo := stayssettlement.NewRepository(pool)

	propID, propARef := seedProperty(t, pool)
	_, propBRef := seedProperty(t, pool)
	guest := seedUser(t, pool)

	// 1) The reservation stores propA's supplier ref in property_id but was
	// booked under a DIFFERENT rail+supplier — the scoped supplier-ref branch
	// (supplier_code AND source_rail must equal the property's) must not match.
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.stays_reservation
			(guest_user_id, property_id, source_rail, supplier_code, supplier_ref, state,
			 check_in, check_out, rooms, currency, gross_amount_kobo, net_rate_kobo,
			 payment_method, cancellation_policy_snapshot, idempotency_key)
		VALUES ($1, $2::uuid, 'BEDBANK', 'bedbank-co', $3, 'COMPLETED',
		        $4::date, $5::date, 1, 'NGN', 100000, 100000,
		        'WALLET', '{}'::jsonb, $6)`,
		guest, propARef, "BB-"+uuid.NewString()[:12],
		time.Now().Add(-96*time.Hour).Format("2006-01-02"),
		time.Now().Add(-48*time.Hour).Format("2006-01-02"),
		"xrail-"+uuid.NewString()); err != nil {
		t.Fatalf("seed cross-rail res: %v", err)
	}
	if ok, err := repo.HasCompletedStay(ctx, propID); err != nil || ok {
		t.Fatalf("cross-rail/supplier ref must not open the gate: ok=%v err=%v", ok, err)
	}

	// 2) Same rail+supplier but the stored ref belongs to ANOTHER property —
	// the ref match must fail for propA.
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.stays_reservation
			(guest_user_id, property_id, source_rail, supplier_code, supplier_ref, state,
			 check_in, check_out, rooms, currency, gross_amount_kobo, net_rate_kobo,
			 payment_method, cancellation_policy_snapshot, idempotency_key)
		VALUES ($1, $2::uuid, 'DIRECT', 'self', $3, 'COMPLETED',
		        $4::date, $5::date, 1, 'NGN', 100000, 100000,
		        'WALLET', '{}'::jsonb, $6)`,
		guest, propBRef, "DIR-"+uuid.NewString()[:12],
		time.Now().Add(-96*time.Hour).Format("2006-01-02"),
		time.Now().Add(-48*time.Hour).Format("2006-01-02"),
		"xref-"+uuid.NewString()); err != nil {
		t.Fatalf("seed cross-ref res: %v", err)
	}
	if ok, err := repo.HasCompletedStay(ctx, propID); err != nil || ok {
		t.Fatalf("another property's ref must not open propA's gate: ok=%v err=%v", ok, err)
	}

	// Positive control — a matching DIRECT/'self' reservation under propA's own
	// supplier ref does open it.
	seedCompletedReservation(t, pool, guest, propARef)
	if ok, err := repo.HasCompletedStay(ctx, propID); err != nil || !ok {
		t.Fatalf("matching res must open the gate: ok=%v err=%v", ok, err)
	}
}

// ────────────────────────────────────────────────────────────────────────────
// PIN: F-2 release-vs-cancel race. A payout whose wallet credit already posted
// but whose row a guest cancel flipped CANCELLED must never pay out — and a
// later release attempt must reverse the orphaned credit back to
// provider_clearing rather than leaving money the hotelier never earned
// sitting in their wallet.
// ────────────────────────────────────────────────────────────────────────────
func TestLiveDB_ReleasePayout_CancelledMidRelease_ClawsBack(t *testing.T) {
	ctx := context.Background()
	pool := mustPayoutPool(t)
	repo := stayssettlement.NewRepository(pool)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := stayssettlement.NewService(repo, ledgerSvc)

	hotelier := seedUser(t, pool)
	propID, _ := seedProperty(t, pool)

	payoutID, err := svc.QueuePayout(ctx, propID, hotelier, "", 1_000_000, "pq-race-"+uuid.NewString())
	if err != nil {
		t.Fatalf("QueuePayout: %v", err)
	}

	// Simulate a release that posted the credit, then crashed before flipping —
	// and a guest cancel that flipped the row CANCELLED in between.
	clearingAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing: %v", err)
	}
	if err := ledgerSvc.Credit(ctx, hotelier, "stays:payout:"+payoutID,
		"stays:payout:"+payoutID, clearingAcc.ID, 1_000_000); err != nil {
		t.Fatalf("seed orphan credit: %v", err)
	}
	if got := walletCredits(t, pool, hotelier); got != 1_000_000 {
		t.Fatalf("hotel wallet credits after orphan = %d, want 1000000", got)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE public.stays_hotel_payout SET status='CANCELLED' WHERE id = $1`, payoutID); err != nil {
		t.Fatalf("simulate cancel flip: %v", err)
	}

	// The release retry must refuse — and unwind the orphan credit.
	if _, err := svc.ReleasePayout(ctx, payoutID); err == nil {
		t.Fatal("release of a CANCELLED payout must fail")
	}
	p, err := repo.GetPayout(ctx, payoutID)
	if err != nil {
		t.Fatalf("GetPayout: %v", err)
	}
	if p.Status != "CANCELLED" {
		t.Fatalf("payout status = %s, want CANCELLED (release must not resurrect it)", p.Status)
	}

	// Orphan reversed: wallet DR 1,000,000 / provider_clearing CR under the
	// clawback key — the wallet nets back to zero.
	var net int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN le.type='CREDIT' THEN le.amount_kobo ELSE -le.amount_kobo END),0)
		FROM public.ledger_entries le
		JOIN public.ledger_accounts a ON a.id = le.account_id
		WHERE a.user_id = $1 AND a.type = 'user_wallet'`, hotelier).Scan(&net); err != nil {
		t.Fatalf("wallet net: %v", err)
	}
	if net != 0 {
		t.Fatalf("hotel wallet net = %d, want 0 — the orphaned credit must be clawed back", net)
	}
	var clawCount int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM public.ledger_entries
		WHERE idempotency_key IN ('stays:payout:clawback:'||$1||':rev_debit',
		                          'stays:payout:clawback:'||$1||':rev_credit')`, payoutID).Scan(&clawCount); err != nil {
		t.Fatalf("clawback count: %v", err)
	}
	if clawCount != 2 {
		t.Fatalf("clawback entries = %d, want 2 (balanced DR/CR pair)", clawCount)
	}

	// And the refusal is retry-safe: a second release neither errors differently
	// nor posts a second clawback.
	if _, err := svc.ReleasePayout(ctx, payoutID); err == nil {
		t.Fatal("second release of a CANCELLED payout must still fail")
	}
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM public.ledger_entries
		WHERE idempotency_key LIKE 'stays:payout:clawback:'||$1||':%'`, payoutID).Scan(&clawCount); err != nil {
		t.Fatalf("clawback recount: %v", err)
	}
	if clawCount != 2 {
		t.Fatalf("clawback entries after retry = %d, want 2 (idempotent)", clawCount)
	}
}

// ────────────────────────────────────────────────────────────────────────────
// PIN: G-3 no-show money semantics — a no-show EARNS the stay (the guest
// forfeits the gross; no refund legs post), so a payout bound to a NO_SHOW
// reservation must release exactly like a COMPLETED one. Without this the
// provider's earned net would be stranded in provider_clearing forever.
// ────────────────────────────────────────────────────────────────────────────
func TestLiveDB_PayoutReleasedForNoShowStay(t *testing.T) {
	ctx := context.Background()
	pool := mustPayoutPool(t)
	repo := stayssettlement.NewRepository(pool)
	svc := stayssettlement.NewService(repo, ledger.NewService(ledger.NewRepository(pool), nil))

	hotelier := seedUser(t, pool)
	guest := seedUser(t, pool)
	propID, _ := seedProperty(t, pool)

	// A no-show reservation on the property + a COMPLETED stay to open the
	// property-level fraud gate.
	completedID := seedCompletedReservation(t, pool, guest, propID)
	var noShowID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.stays_reservation
			(guest_user_id, property_id, source_rail, supplier_code, supplier_ref, state,
			 check_in, check_out, rooms, currency, gross_amount_kobo, net_rate_kobo,
			 payment_method, cancellation_policy_snapshot, idempotency_key)
		VALUES ($1, $2::uuid, 'DIRECT', 'self', $3, 'NO_SHOW',
		        '2026-01-01'::date, '2026-01-03'::date, 1, 'NGN', 1100000, 1000000,
		        'WALLET', '{}'::jsonb, $4)
		RETURNING id`, guest, propID, "DIR-"+uuid.NewString()[:12], "noshow-"+uuid.NewString()).Scan(&noShowID); err != nil {
		t.Fatalf("seed no-show reservation: %v", err)
	}
	_ = completedID

	const amount = int64(950_000)
	payoutID, err := svc.QueuePayout(ctx, propID, hotelier, noShowID, amount, "pq-noshow-"+uuid.NewString())
	if err != nil {
		t.Fatalf("QueuePayout: %v", err)
	}
	before := walletCredits(t, pool, hotelier)

	p, err := svc.ReleasePayout(ctx, payoutID)
	if err != nil {
		t.Fatalf("ReleasePayout on a NO_SHOW stay must pay — the provider earned it: %v", err)
	}
	if p.Status != "PAID" {
		t.Fatalf("payout status = %q, want PAID", p.Status)
	}
	if got := walletCredits(t, pool, hotelier); got != before+amount {
		t.Fatalf("hotelier wallet credits = %d, want %d (+%d)", got, before, before+amount)
	}
}

// ────────────────────────────────────────────────────────────────────────────
// PIN D-2b: a payout whose reservation LOOKS payable but already has posted
// cancel-refund legs — the refunded-but-payable wedge a crashed/flipped-out
// cancel saga leaves — must be REFUSED. The state check alone cannot see the
// wedge (the row still reads CONFIRMED/NO_SHOW), so the release probes the
// ledger: any posted 'stays:refund:<id>:*' draw ⇒ ErrPayoutBlocked. Without
// the probe the release pays the hotelier money the guest already got back.
// ────────────────────────────────────────────────────────────────────────────
func TestLiveDB_ReleasePayout_BlockedWhenCancelLegsPosted(t *testing.T) {
	ctx := context.Background()
	pool := mustPayoutPool(t)
	repo := stayssettlement.NewRepository(pool)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := stayssettlement.NewService(repo, ledgerSvc)

	hotelier := seedUser(t, pool)
	guest := seedUser(t, pool)
	propID, _ := seedProperty(t, pool)

	// Open the property fraud gate + a CONFIRMED reservation (the payable shape
	// the wedge produces: cancel legs posted but the terminal flip lost its
	// race, so the row still reads payable).
	seedCompletedReservation(t, pool, guest, propID)
	var resID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.stays_reservation
			(guest_user_id, property_id, source_rail, supplier_code, supplier_ref, state,
			 check_in, check_out, rooms, currency, gross_amount_kobo, net_rate_kobo,
			 payment_method, cancellation_policy_snapshot, idempotency_key)
		VALUES ($1, $2::uuid, 'DIRECT', 'self', $3, 'CONFIRMED',
		        '2026-01-01'::date, '2026-01-03'::date, 1, 'NGN', 1100000, 1000000,
		        'WALLET', '{}'::jsonb, $4)
		RETURNING id`, guest, propID, "DIR-"+uuid.NewString()[:12], "wedge-"+uuid.NewString()).Scan(&resID); err != nil {
		t.Fatalf("seed reservation: %v", err)
	}

	const amount = int64(950_000)
	payoutID, err := svc.QueuePayout(ctx, propID, hotelier, resID, amount, "pq-wedge-"+uuid.NewString())
	if err != nil {
		t.Fatalf("QueuePayout: %v", err)
	}

	// Simulate a crashed cancel saga: the guest refund leg posted but the
	// terminal state flip never landed (reservation still CONFIRMED).
	clearingAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing: %v", err)
	}
	guestWallet, err := ledgerSvc.GetOrCreateUserWallet(ctx, guest)
	if err != nil {
		t.Fatalf("guest wallet: %v", err)
	}
	if err := ledgerSvc.PostJournal(ctx, ledger.JournalEntry{
		Reference:       "stays:refund:" + resID + ":provider",
		IdempotencyKey:  "wedge-leg-" + uuid.NewString(),
		AmountKobo:      400_000,
		DebitAccountID:  clearingAcc.ID,
		CreditAccountID: guestWallet.ID,
	}); err != nil {
		t.Fatalf("seed wedge refund leg: %v", err)
	}

	before := walletCredits(t, pool, hotelier)
	if _, err := svc.ReleasePayout(ctx, payoutID); !errors.Is(err, stayssettlement.ErrPayoutBlocked) {
		t.Fatalf("ReleasePayout on a payable-looking wedge = %v, want ErrPayoutBlocked (D-2b)", err)
	}
	if got := walletCredits(t, pool, hotelier); got != before {
		t.Fatalf("hotelier credited %d on a wedged payout — the double-pay D-2b blocks", got-before)
	}
	p, gErr := repo.GetPayout(ctx, payoutID)
	if gErr != nil {
		t.Fatalf("GetPayout: %v", gErr)
	}
	if p.Status != "HELD" {
		t.Fatalf("payout status = %q, want HELD — a blocked release must not resolve the row", p.Status)
	}
}

// ────────────────────────────────────────────────────────────────────────────
// PIN: F-2 — a resolved payout can never transition back to PAID even if a
// release raced the cancel at the database level (the UPDATE's payable-state
// predicate rejects the flip). Simulated by attempting the guarded update
// directly on resolved rows.
// ────────────────────────────────────────────────────────────────────────────
func TestLiveDB_SetPayoutStatus_RefusesResolvedRows(t *testing.T) {
	ctx := context.Background()
	pool := mustPayoutPool(t)
	repo := stayssettlement.NewRepository(pool)
	svc := stayssettlement.NewService(repo, ledger.NewService(ledger.NewRepository(pool), nil))
	hotelier := seedUser(t, pool)
	propID, _ := seedProperty(t, pool)

	for _, st := range []string{"CANCELLED", "FAILED", "PAID"} {
		pID, err := svc.QueuePayout(ctx, propID, hotelier, "", 500_000, "pq-st-"+st+"-"+uuid.NewString())
		if err != nil {
			t.Fatalf("QueuePayout %s: %v", st, err)
		}
		if _, err := pool.Exec(ctx,
			`UPDATE public.stays_hotel_payout SET status=$2 WHERE id=$1`, pID, st); err != nil {
			t.Fatalf("seed status %s: %v", st, err)
		}
		err = repo.SetPayoutStatus(ctx, pID, "PAID", "ref", "", true)
		if !errors.Is(err, stayssettlement.ErrPayoutNotPayable) {
			t.Fatalf("status %s→PAID: err = %v, want ErrPayoutNotPayable", st, err)
		}
		p, gErr := repo.GetPayout(ctx, pID)
		if gErr != nil {
			t.Fatalf("GetPayout %s: %v", st, gErr)
		}
		if p.Status != st {
			t.Fatalf("status mutated %s→%s — resolved rows must be immutable to release", st, p.Status)
		}
	}
	// A payable row still flips.
	pID, err := svc.QueuePayout(ctx, propID, hotelier, "", 500_000, "pq-st-ok-"+uuid.NewString())
	if err != nil {
		t.Fatalf("QueuePayout payable: %v", err)
	}
	if err := repo.SetPayoutStatus(ctx, pID, "PAID", "ref", "", true); err != nil {
		t.Fatalf("HELD→PAID must succeed: %v", err)
	}
}
