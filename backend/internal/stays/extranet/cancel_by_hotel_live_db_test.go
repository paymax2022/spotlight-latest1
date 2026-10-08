package extranet

// LIVE-DB regression for hotel-side cancel: it drives the shared refund
// machinery (reservation.RefundOps) rather than a bare state UPDATE. Pins:
// full-refund legs post, the guest returns to pre-booking balance, queued
// payouts cancel, a second cancel can't re-refund, AuthZ still gates.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	finsettlement "spotlight/backend/internal/finance/settlement"
	stayssettlement "spotlight/backend/internal/stays/settlement"
	"spotlight/backend/internal/testsupport"
)

func cancelHotelPool(t *testing.T) *pgxpool.Pool {
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

func seedCancelUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	testsupport.SetKycTier(t, context.Background(), pool, id, testsupport.KycTierUnlimited)
	return id
}

// hotelCancelFixture wires a real extranet.Service over a live pool plus a
// CONFIRMED reservation whose gross is parked in provider_clearing +
// commission exactly as the book-time settle leaves it.
type hotelCancelFixture struct {
	pool      *pgxpool.Pool
	svc       *Service
	ledgerSvc *ledger.Service
	owner     string
	guest     string
	hotelier  string
	propID    string
	resID     string
	gross     int64
	comm      int64
	provider  int64
}

func newHotelCancelFixture(t *testing.T) *hotelCancelFixture {
	t.Helper()
	ctx := context.Background()
	pool := cancelHotelPool(t)

	f := &hotelCancelFixture{pool: pool}
	f.owner = seedCancelUser(t, pool)
	f.guest = seedCancelUser(t, pool)
	f.hotelier = seedCancelUser(t, pool)
	f.gross = 1_100_000
	f.comm = 150_000
	f.provider = f.gross - f.comm

	if err := pool.QueryRow(ctx, `
		INSERT INTO public.stays_property
			(source_rail, supplier_code, supplier_property_ref, name, address, city, star_rating, property_type, status)
		VALUES ('DIRECT','self',$1,'Hotel Cancel Test','1 St','Lagos',4,'hotel','ACTIVE')
		RETURNING id`, uuid.NewString()).Scan(&f.propID); err != nil {
		t.Fatalf("seed property: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.stays_hotelier_profile (user_id, property_id, role, status)
		VALUES ($1, $2, 'OWNER', 'ACTIVE')`, f.owner, f.propID); err != nil {
		t.Fatalf("seed owner grant: %v", err)
	}

	f.ledgerSvc = ledger.NewService(ledger.NewRepository(pool), nil)
	f.svc = NewService(NewRepository(pool), NewAuthZ(pool), nil, nil, "")

	// Fund the guest wallet for the escrow debit.
	clearing, err := f.ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing: %v", err)
	}
	if err := f.ledgerSvc.Credit(ctx, f.guest, "seed:wallet:"+uuid.NewString(),
		"hc-seed-"+uuid.NewString(), clearing.ID, 3_000_000); err != nil {
		t.Fatalf("fund guest: %v", err)
	}

	f.resID = uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.stays_reservation
			(id, guest_user_id, property_id, room_type_id, rate_plan_id, source_rail, supplier_code, supplier_ref, state,
			 check_in, check_out, rooms, currency, gross_amount_kobo, net_rate_kobo, commission_kobo,
			 payment_method, cancellation_policy_snapshot, idempotency_key, book_token_ref, voucher_ref)
		VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, 'DIRECT', 'self', $6, 'CONFIRMED',
		        $7::date, $8::date, 1, 'NGN', $9, $10, $11,
		        'WALLET', '{"refundable":true}'::jsonb, $12, 'tok', 'vch')`,
		f.resID, f.guest, f.propID, uuid.NewString(), uuid.NewString(), "DIR-"+uuid.NewString()[:12],
		time.Now().Add(72*time.Hour).Format("2006-01-02"),
		time.Now().Add(96*time.Hour).Format("2006-01-02"),
		f.gross, 1_000_000, f.comm, "hc-"+uuid.NewString()); err != nil {
		t.Fatalf("seed reservation: %v", err)
	}

	// Park the gross exactly as the book saga leaves it: escrow the gross then
	// settle the split (provider net → provider_clearing, commission →
	// commission).
	finSettle := finsettlement.NewService(pool, f.ledgerSvc)
	sett, err := finSettle.Escrow(ctx, f.guest, "stays:"+f.resID, "hc-hold-"+uuid.NewString(), "stays", f.gross)
	if err != nil {
		t.Fatalf("escrow: %v", err)
	}
	if err := finSettle.SettleToStandingAccounts(ctx, sett.ID, finsettlement.Split{
		ProviderID:     "stays-clearing:self",
		ProviderPct:    1.0,
		ServiceFeeKobo: f.comm,
	}, ledger.AccountProviderClearing, ledger.AccountCommission); err != nil {
		t.Fatalf("settle: %v", err)
	}
	return f
}

func walletBalanceKobo(t *testing.T, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var sum int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN le.type IN ('CREDIT','REVERSAL_DEBIT') THEN le.amount_kobo ELSE -le.amount_kobo END),0)
		FROM ledger_entries le
		JOIN ledger_accounts a ON a.id = le.account_id
		WHERE a.user_id = $1 AND a.type = 'user_wallet'`, userID).Scan(&sum); err != nil {
		t.Fatalf("wallet balance: %v", err)
	}
	return sum
}

func TestLiveDB_CancelByHotel_FullRefundsAndKillsPayouts(t *testing.T) {
	ctx := context.Background()
	f := newHotelCancelFixture(t)

	// Queue the hotel payout that must die with the cancel.
	settleSvc := stayssettlement.NewService(stayssettlement.NewRepository(f.pool), f.ledgerSvc)
	payoutID, err := settleSvc.QueuePayout(ctx, f.propID, f.hotelier, f.resID, f.provider, "hc-pq-"+uuid.NewString())
	if err != nil {
		t.Fatalf("QueuePayout: %v", err)
	}

	guestBefore := walletBalanceKobo(t, f.pool, f.guest) // post-escrow: seed(0) + gross escrow-debit

	if err := f.svc.CancelByHotel(ctx, f.owner, f.propID, f.resID, "overbooked"); err != nil {
		t.Fatalf("CancelByHotel: %v", err)
	}

	// Terminal state is the legal hotel-cancel state.
	var state string
	if err := f.pool.QueryRow(ctx, `SELECT state FROM public.stays_reservation WHERE id = $1`, f.resID).Scan(&state); err != nil {
		t.Fatalf("read state: %v", err)
	}
	if state != "CANCELLED_BY_HOTEL" {
		t.Fatalf("state = %q, want CANCELLED_BY_HOTEL", state)
	}

	// Full-refund legs posted out of the parked accounts — the guest got ALL
	// their money back (hotel-initiated cancels carry no policy penalty).
	var provDrawn int64
	if err := f.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(le.amount_kobo),0)
		FROM public.ledger_entries le
		JOIN public.ledger_accounts a ON a.id = le.account_id
		WHERE a.user_id IS NULL AND a.type = 'provider_clearing' AND le.type = 'DEBIT'
		  AND le.reference = 'stays:refund:' || $1 || ':provider'`, f.resID).Scan(&provDrawn); err != nil {
		t.Fatalf("provider leg: %v", err)
	}
	if provDrawn != f.provider {
		t.Fatalf("provider refund leg = %d, want %d — the guest gross must not strand in clearing", provDrawn, f.provider)
	}
	var commDrawn int64
	if err := f.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(le.amount_kobo),0)
		FROM public.ledger_entries le
		JOIN public.ledger_accounts a ON a.id = le.account_id
		WHERE a.user_id IS NULL AND a.type = 'commission' AND le.type = 'DEBIT'
		  AND le.reference = 'stays:refund:' || $1 || ':commission'`, f.resID).Scan(&commDrawn); err != nil {
		t.Fatalf("commission leg: %v", err)
	}
	if commDrawn != f.comm {
		t.Fatalf("commission refund leg = %d, want %d", commDrawn, f.comm)
	}

	// Guest wallet is restored: +gross on top of the post-escrow balance.
	if got, want := walletBalanceKobo(t, f.pool, f.guest), guestBefore+f.gross; got != want {
		t.Fatalf("guest wallet = %d, want %d — the full gross must return to the guest", got, want)
	}

	// The queued payout is CANCELLED — the queue can never pay the unwound net.
	var payoutStatus string
	if err := f.pool.QueryRow(ctx,
		`SELECT status FROM public.stays_hotel_payout WHERE id = $1`, payoutID).Scan(&payoutStatus); err != nil {
		t.Fatalf("payout status: %v", err)
	}
	if payoutStatus != "CANCELLED" {
		t.Fatalf("payout status = %q, want CANCELLED after hotel cancel", payoutStatus)
	}
	if got := walletBalanceKobo(t, f.pool, f.hotelier); got != 0 {
		t.Fatalf("hotelier credited %d on a refunded booking — the double-pay G-3 fixes", got)
	}

	// The cancellation row records the actual refunded amount (the old insert
	// always wrote refund_kobo=0 — the strand itself, made invisible).
	var refundKobo int64
	if err := f.pool.QueryRow(ctx, `
		SELECT refund_kobo FROM public.stays_cancellation
		WHERE reservation_id = $1 ORDER BY created_at DESC LIMIT 1`, f.resID).Scan(&refundKobo); err != nil {
		t.Fatalf("cancellation row: %v", err)
	}
	if refundKobo != f.gross {
		t.Fatalf("cancellation refund_kobo = %d, want %d (full refund recorded)", refundKobo, f.gross)
	}

	// Terminal: a second hotel cancel refuses (no second refund).
	if err := f.svc.CancelByHotel(ctx, f.owner, f.propID, f.resID, "again"); err == nil {
		t.Fatal("second CancelByHotel must refuse — the reservation is terminal")
	}
	if got, want := walletBalanceKobo(t, f.pool, f.guest), guestBefore+f.gross; got != want {
		t.Fatalf("guest wallet after retry = %d, want %d — a re-run must not double-refund", got, want)
	}
}

// ────────────────────────────────────────────────────────────────────────────
// PIN D-2: MarkNoShow takes the SAME 'stays:reservation:<id>' advisory lock the
// refund sagas hold. While a saga lock is held (an in-flight refund), the
// NO_SHOW flip BLOCKS rather than landing between the saga's leg posts and its
// terminal flip — the wedge that left reservations payable with guest legs
// already drawn (double-pay). Once the lock frees, the flip applies normally.
// ────────────────────────────────────────────────────────────────────────────
func TestLiveDB_MarkNoShow_SerializesWithRefundSagaLock(t *testing.T) {
	ctx := context.Background()
	f := newHotelCancelFixture(t)

	// Simulate an in-flight refund saga: hold the reservation advisory lock.
	lockTx, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin lock tx: %v", err)
	}
	if _, err := lockTx.Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtext($1))`, "stays:reservation:"+f.resID); err != nil {
		t.Fatalf("take advisory lock: %v", err)
	}

	done := make(chan error, 1)
	go func() { done <- f.svc.MarkNoShow(ctx, f.owner, f.propID, f.resID) }()

	select {
	case err := <-done:
		t.Fatalf("MarkNoShow completed (%v) while the refund saga lock was held — the D-2 wedge window is open", err)
	case <-time.After(500 * time.Millisecond):
		// Still blocked behind the saga lock — correct.
	}
	if err := lockTx.Rollback(ctx); err != nil {
		t.Fatalf("release lock: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("MarkNoShow after lock release: %v", err)
	}
	var state string
	if err := f.pool.QueryRow(ctx,
		`SELECT state FROM public.stays_reservation WHERE id = $1`, f.resID).Scan(&state); err != nil {
		t.Fatalf("read state: %v", err)
	}
	if state != "NO_SHOW" {
		t.Fatalf("state = %q, want NO_SHOW — a released lock must let the flip land", state)
	}
}

// ────────────────────────────────────────────────────────────────────────────
// PIN D-2 (wedge-closed): once a refund saga landed its terminal flip, a
// no-show must be refused outright — the state-guarded UPDATE sees the row is
// no longer CONFIRMED, and the payable-shape reservation can never be created
// after the fact.
// ────────────────────────────────────────────────────────────────────────────
func TestLiveDB_MarkNoShow_RefusedAfterCancelLanded(t *testing.T) {
	ctx := context.Background()
	f := newHotelCancelFixture(t)

	if err := f.svc.CancelByHotel(ctx, f.owner, f.propID, f.resID, "overbooked"); err != nil {
		t.Fatalf("CancelByHotel: %v", err)
	}
	if err := f.svc.MarkNoShow(ctx, f.owner, f.propID, f.resID); err == nil {
		t.Fatal("MarkNoShow on a cancelled reservation must refuse — the wedge must stay closed")
	}
	var state string
	if err := f.pool.QueryRow(ctx,
		`SELECT state FROM public.stays_reservation WHERE id = $1`, f.resID).Scan(&state); err != nil {
		t.Fatalf("read state: %v", err)
	}
	if state != "CANCELLED_BY_HOTEL" {
		t.Fatalf("state = %q, want CANCELLED_BY_HOTEL — a refused no-show must not move the row", state)
	}
}

func TestLiveDB_CancelByHotel_RequiresGrant(t *testing.T) {
	ctx := context.Background()
	f := newHotelCancelFixture(t)
	stranger := seedCancelUser(t, f.pool)

	if err := f.svc.CancelByHotel(ctx, stranger, f.propID, f.resID, "not mine"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("CancelByHotel by a non-staff caller = %v, want ErrForbidden", err)
	}
	var state string
	if err := f.pool.QueryRow(ctx, `SELECT state FROM public.stays_reservation WHERE id = $1`, f.resID).Scan(&state); err != nil {
		t.Fatalf("read state: %v", err)
	}
	if state != "CONFIRMED" {
		t.Fatalf("state = %q — a refused cancel must not have moved the reservation", state)
	}
}
