package supplierwebhooks_test

// LIVE-DB regression for the reservation.* webhook sync: transitions are
// FSM-guarded via reservation.InboundSources (replayed events can't resurrect
// terminal states) and hotel cancels drive the shared refund machinery
// (reservation.RefundOps) rather than a bare state UPDATE.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	finsettlement "spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/stays/ari"
	stayssettlement "spotlight/backend/internal/stays/settlement"
	"spotlight/backend/internal/stays/supplierwebhooks"
	"spotlight/backend/internal/testsupport"
)

func mustWebhookPool(t *testing.T) *pgxpool.Pool {
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

func seedWebhookUser(t *testing.T, pool *pgxpool.Pool) string {
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

// seedWebhookReservation inserts a reservation in the given lifecycle state on
// a freshly seeded DIRECT property and returns (reservationID, propertyID).
func seedWebhookReservation(t *testing.T, ctx context.Context, pool *pgxpool.Pool, guestID, state string) (string, string) {
	t.Helper()
	var propID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.stays_property
			(source_rail, supplier_code, supplier_property_ref, name, address, city, star_rating, property_type, status)
		VALUES ('DIRECT','self',$1,'Webhook Test Hotel','1 St','Lagos',4,'hotel','ACTIVE')
		RETURNING id`, uuid.NewString()).Scan(&propID); err != nil {
		t.Fatalf("seed property: %v", err)
	}
	resID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.stays_reservation
			(id, guest_user_id, property_id, room_type_id, rate_plan_id, source_rail, supplier_code, supplier_ref, state,
			 check_in, check_out, rooms, currency, gross_amount_kobo, net_rate_kobo, commission_kobo,
			 payment_method, cancellation_policy_snapshot, idempotency_key, book_token_ref, voucher_ref)
		VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, 'DIRECT', 'self', $6, $7,
		        $8::date, $9::date, 1, 'NGN', $10, $10, 150000,
		        'WALLET', '{"refundable":true}'::jsonb, $11, 'tok', 'vch')`,
		resID, guestID, propID, uuid.NewString(), uuid.NewString(), "DIR-"+uuid.NewString()[:12], state,
		time.Now().Add(72*time.Hour).Format("2006-01-02"),
		time.Now().Add(96*time.Hour).Format("2006-01-02"),
		1_100_000, "wh-"+uuid.NewString()); err != nil {
		t.Fatalf("seed reservation: %v", err)
	}
	return resID, propID
}

func resState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, resID string) string {
	t.Helper()
	var s string
	if err := pool.QueryRow(ctx,
		`SELECT state FROM public.stays_reservation WHERE id = $1`, resID).Scan(&s); err != nil {
		t.Fatalf("read state: %v", err)
	}
	return s
}

func eventStatus(t *testing.T, pool *pgxpool.Pool, eventID string) string {
	t.Helper()
	var s string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM public.stays_ari_event WHERE external_event_id = $1`, eventID).Scan(&s); err != nil {
		t.Fatalf("event status: %v", err)
	}
	return s
}

func walletOf(t *testing.T, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var sum int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN le.type IN ('CREDIT','REVERSAL_DEBIT') THEN le.amount_kobo ELSE -le.amount_kobo END),0)
		FROM ledger_entries le
		JOIN ledger_accounts a ON a.id = le.account_id
		WHERE a.user_id = $1 AND a.type = 'user_wallet'`, userID).Scan(&sum); err != nil {
		t.Fatalf("wallet: %v", err)
	}
	return sum
}

// ────────────────────────────────────────────────────────────────────────────
// PIN G-4a: a stale inbound event can NEVER resurrect a terminal reservation.
// VOID → CONFIRMED and BOOK_FAILED → COMPLETED are consumed as no-ops (the
// event records APPLIED because there is nothing it could ever legally do) —
// the row's state is untouched, so payout release can never unlock for money
// that was never parked.
// ────────────────────────────────────────────────────────────────────────────
func TestLiveDB_Webhook_RefusesTerminalResurrection(t *testing.T) {
	ctx := context.Background()
	pool := mustWebhookPool(t)
	svc := supplierwebhooks.NewService(pool, ari.NewService(ari.NewRepository(pool)), "secret")

	guest := seedWebhookUser(t, pool)

	for _, tc := range []struct {
		name, from, to string
	}{
		{"VoidToConfirmed", "VOID", "CONFIRMED"},
		{"NoShowToCompleted", "NO_SHOW", "COMPLETED"},
		{"CancelledToConfirmed", "CANCELLED_BY_GUEST", "CONFIRMED"},
		{"HotelCancelledToCompleted", "CANCELLED_BY_HOTEL", "COMPLETED"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resID, _ := seedWebhookReservation(t, ctx, pool, guest, tc.from)
			eventID := "ev-" + uuid.NewString()
			err := svc.Ingest(ctx, supplierwebhooks.Event{
				Source: "self", ExternalEventID: eventID, EventType: "reservation.sync",
				Payload: map[string]any{"reservation_id": resID, "state": tc.to},
			})
			if err != nil {
				t.Fatalf("stale terminal event must be consumed, not failed: %v", err)
			}
			if got := resState(t, ctx, pool, resID); got != tc.from {
				t.Fatalf("reservation moved %s → %s — terminal resurrection must be refused", tc.from, got)
			}
		})
	}

	// BOOK_FAILED still has a live outbound edge (→ VOID), so an inbound
	// COMPLETED is an ILLEGAL edge off a live row — refused loudly (FAILED
	// event, row untouched) rather than silently consumed.
	resID, _ := seedWebhookReservation(t, ctx, pool, guest, "BOOK_FAILED")
	eventID := "ev-" + uuid.NewString()
	err := svc.Ingest(ctx, supplierwebhooks.Event{
		Source: "self", ExternalEventID: eventID, EventType: "reservation.sync",
		Payload: map[string]any{"reservation_id": resID, "state": "COMPLETED"},
	})
	if err == nil {
		t.Fatal("BOOK_FAILED → COMPLETED must be refused")
	}
	if got := resState(t, ctx, pool, resID); got != "BOOK_FAILED" {
		t.Fatalf("state = %q, want BOOK_FAILED — resurrection must never move the row", got)
	}
	if st := eventStatus(t, pool, eventID); st != "FAILED" {
		t.Fatalf("event status = %q, want FAILED — the violation must be visible", st)
	}
}

// ────────────────────────────────────────────────────────────────────────────
// PIN G-4b: an ILLEGAL edge off a LIVE row fails the event loudly (a protocol
// violation ops must see), while legal edges apply — CONFIRMED→NO_SHOW /
// CONFIRMED→COMPLETED — and a supplier-supplied CANCELLED_BY_GUEST is rejected
// outright (a supplier cannot speak for the guest's money).
// ────────────────────────────────────────────────────────────────────────────
func TestLiveDB_Webhook_IllegalEdgeFailsAndLegalEdgesApply(t *testing.T) {
	ctx := context.Background()
	pool := mustWebhookPool(t)
	svc := supplierwebhooks.NewService(pool, ari.NewService(ari.NewRepository(pool)), "secret")
	guest := seedWebhookUser(t, pool)

	// BOOKING → COMPLETED is not an edge — the event fails AND the row holds.
	resID, _ := seedWebhookReservation(t, ctx, pool, guest, "BOOKING")
	eventID := "ev-" + uuid.NewString()
	err := svc.Ingest(ctx, supplierwebhooks.Event{
		Source: "self", ExternalEventID: eventID, EventType: "reservation.sync",
		Payload: map[string]any{"reservation_id": resID, "state": "COMPLETED"},
	})
	if err == nil {
		t.Fatal("BOOKING → COMPLETED must fail — it is not a legal edge")
	}
	if got := resState(t, ctx, pool, resID); got != "BOOKING" {
		t.Fatalf("state = %q, want BOOKING (illegal edge must not move the row)", got)
	}
	if st := eventStatus(t, pool, eventID); st != "FAILED" {
		t.Fatalf("event status = %q, want FAILED — the violation must be visible", st)
	}

	// CANCELLED_BY_GUEST inbound is not an allowed target at all.
	res2, _ := seedWebhookReservation(t, ctx, pool, guest, "CONFIRMED")
	err = svc.Ingest(ctx, supplierwebhooks.Event{
		Source: "self", ExternalEventID: "ev-" + uuid.NewString(), EventType: "reservation.cancelled",
		Payload: map[string]any{"reservation_id": res2, "state": "CANCELLED_BY_GUEST"},
	})
	if err == nil {
		t.Fatal("inbound CANCELLED_BY_GUEST must be refused — a supplier cannot spend the guest's refund leg")
	}
	if got := resState(t, ctx, pool, res2); got != "CONFIRMED" {
		t.Fatalf("state = %q, want CONFIRMED", got)
	}

	// Legal edges apply: CONFIRMED → NO_SHOW and CONFIRMED → COMPLETED.
	for _, to := range []string{"NO_SHOW", "COMPLETED"} {
		res3, _ := seedWebhookReservation(t, ctx, pool, guest, "CONFIRMED")
		if err := svc.Ingest(ctx, supplierwebhooks.Event{
			Source: "self", ExternalEventID: "ev-" + uuid.NewString(), EventType: "reservation.sync",
			Payload: map[string]any{"reservation_id": res3, "state": to},
		}); err != nil {
			t.Fatalf("CONFIRMED → %s should apply: %v", to, err)
		}
		if got := resState(t, ctx, pool, res3); got != to {
			t.Fatalf("state = %q, want %s", got, to)
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// PIN G-4c + G-3: a supplier-reported CANCELLED_BY_HOTEL must run the SHARED
// refund path — kill the queued payout, drain the parked legs back to the
// guest, land the terminal state. A bare UPDATE would strand the guest's
// gross in the pooled accounts forever.
// ────────────────────────────────────────────────────────────────────────────
func TestLiveDB_Webhook_HotelCancel_RefundsAndKillsPayout(t *testing.T) {
	ctx := context.Background()
	pool := mustWebhookPool(t)
	svc := supplierwebhooks.NewService(pool, ari.NewService(ari.NewRepository(pool)), "secret")
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	guest := seedWebhookUser(t, pool)
	hotelier := seedWebhookUser(t, pool)
	const gross = int64(1_100_000)
	const comm = int64(150_000)

	resID, propID := seedWebhookReservation(t, ctx, pool, guest, "CONFIRMED")

	// Fund the guest wallet for the escrow debit.
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing: %v", err)
	}
	if err := ledgerSvc.Credit(ctx, guest, "seed:wallet:"+uuid.NewString(),
		"wh-seed-"+uuid.NewString(), clearing.ID, 3_000_000); err != nil {
		t.Fatalf("fund guest: %v", err)
	}

	// Park the gross the way the book-time settle leaves it.
	finSettle := finsettlement.NewService(pool, ledgerSvc)
	sett, err := finSettle.Escrow(ctx, guest, "stays:"+resID, "wh-hold-"+uuid.NewString(), "stays", gross)
	if err != nil {
		t.Fatalf("escrow: %v", err)
	}
	if err := finSettle.SettleToStandingAccounts(ctx, sett.ID, finsettlement.Split{
		ProviderID:     "stays-clearing:self",
		ProviderPct:    1.0,
		ServiceFeeKobo: comm,
	}, ledger.AccountProviderClearing, ledger.AccountCommission); err != nil {
		t.Fatalf("settle: %v", err)
	}
	settleSvc := stayssettlement.NewService(stayssettlement.NewRepository(pool), ledgerSvc)
	payoutID, err := settleSvc.QueuePayout(ctx, propID, hotelier, resID, gross-comm, "wh-pq-"+uuid.NewString())
	if err != nil {
		t.Fatalf("QueuePayout: %v", err)
	}

	guestBefore := walletOf(t, pool, guest)

	if err := svc.Ingest(ctx, supplierwebhooks.Event{
		Source: "self", ExternalEventID: "ev-" + uuid.NewString(), EventType: "reservation.cancelled",
		Payload: map[string]any{"reservation_id": resID, "state": "CANCELLED_BY_HOTEL", "reason": "overbooking"},
	}); err != nil {
		t.Fatalf("hotel-cancel webhook: %v", err)
	}

	if got := resState(t, ctx, pool, resID); got != "CANCELLED_BY_HOTEL" {
		t.Fatalf("state = %q, want CANCELLED_BY_HOTEL", got)
	}
	if got, want := walletOf(t, pool, guest), guestBefore+gross; got != want {
		t.Fatalf("guest wallet = %d, want %d — webhook cancel must fully refund (G-3)", got, want)
	}
	var payoutStatus string
	if err := pool.QueryRow(ctx,
		`SELECT status FROM public.stays_hotel_payout WHERE id = $1`, payoutID).Scan(&payoutStatus); err != nil {
		t.Fatalf("payout status: %v", err)
	}
	if payoutStatus != "CANCELLED" {
		t.Fatalf("payout status = %q, want CANCELLED", payoutStatus)
	}

	// Re-driving the same cancel state on the now-terminal row is a consumed
	// no-op — no second refund.
	if err := svc.Ingest(ctx, supplierwebhooks.Event{
		Source: "self", ExternalEventID: "ev-" + uuid.NewString(), EventType: "reservation.cancelled",
		Payload: map[string]any{"reservation_id": resID, "state": "CANCELLED_BY_HOTEL"},
	}); err != nil {
		t.Fatalf("duplicate hotel-cancel event must be consumed: %v", err)
	}
	if got, want := walletOf(t, pool, guest), guestBefore+gross; got != want {
		t.Fatalf("guest wallet after duplicate = %d, want %d — no double refund", got, want)
	}
}

// ────────────────────────────────────────────────────────────────────────────
// PIN D-2: a non-cancel reservation.* flip (e.g. CONFIRMED → NO_SHOW) takes
// the SAME 'stays:reservation:<id>' advisory lock the refund sagas hold. While
// the saga lock is held the flip BLOCKS — it can no longer commit between the
// saga's leg posts and terminal flip (the refunded-but-payable wedge); once
// the lock frees, the legal edge applies.
// ────────────────────────────────────────────────────────────────────────────
func TestLiveDB_Webhook_NonCancelFlip_SerializesWithRefundSagaLock(t *testing.T) {
	ctx := context.Background()
	pool := mustWebhookPool(t)
	svc := supplierwebhooks.NewService(pool, ari.NewService(ari.NewRepository(pool)), "secret")
	guest := seedWebhookUser(t, pool)

	resID, _ := seedWebhookReservation(t, ctx, pool, guest, "CONFIRMED")

	// Simulate an in-flight refund saga holding the reservation advisory lock.
	lockTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin lock tx: %v", err)
	}
	if _, err := lockTx.Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtext($1))`, "stays:reservation:"+resID); err != nil {
		t.Fatalf("take advisory lock: %v", err)
	}

	done := make(chan error, 1)
	go func() {
		done <- svc.Ingest(ctx, supplierwebhooks.Event{
			Source: "self", ExternalEventID: "ev-" + uuid.NewString(), EventType: "reservation.sync",
			Payload: map[string]any{"reservation_id": resID, "state": "NO_SHOW"},
		})
	}()

	select {
	case err := <-done:
		t.Fatalf("non-cancel flip applied (%v) while the refund saga lock was held — the D-2 wedge window is open", err)
	case <-time.After(500 * time.Millisecond):
		// Still blocked behind the saga lock — correct.
	}
	if err := lockTx.Rollback(ctx); err != nil {
		t.Fatalf("release lock: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("flip after lock release: %v", err)
	}
	if got := resState(t, ctx, pool, resID); got != "NO_SHOW" {
		t.Fatalf("state = %q, want NO_SHOW — a released lock must let the legal edge apply", got)
	}
}
