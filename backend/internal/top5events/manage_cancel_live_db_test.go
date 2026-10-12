package top5events_test

// Live-DB tests for Cancel + the 90/10 buyer refund (money path). Skips unless
// TEST_DATABASE_URL is set (via ticketTokenPool). Balance assertions are deltas
// because escrow and revenue are shared standing accounts.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
	"spotlight/backend/internal/top5events"
)

func cancelLedger(pool *pgxpool.Pool) *ledger.Service {
	return ledger.NewService(ledger.NewRepository(pool), nil)
}

// seedPricedTier inserts a paid tier and registers FK-safe cleanup.
func seedPricedTier(t *testing.T, ctx context.Context, pool *pgxpool.Pool, eventID string, price int64) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_ticket_tiers (id, event_id, name, price_kobo, capacity) VALUES ($1,$2,'VIP',$3,100)`,
		id, eventID, price); err != nil {
		t.Fatalf("seed priced tier: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM event_tickets WHERE event_id=$1`, eventID)
		_, _ = pool.Exec(bg, `DELETE FROM event_orders WHERE event_id=$1`, eventID)
		_, _ = pool.Exec(bg, `DELETE FROM event_ticket_tiers WHERE event_id=$1`, eventID)
	})
	return id
}

// fundBuyer promotes the buyer past the tier-0 gate and credits their main
// wallet from the provider_clearing standing account.
func fundBuyer(t *testing.T, ctx context.Context, pool *pgxpool.Pool, led *ledger.Service, buyer string, kobo int64) {
	t.Helper()
	testsupport.SetKycTier(t, ctx, pool, buyer, testsupport.KycTierUnlimited)
	clearing, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing acct: %v", err)
	}
	if err := led.Credit(ctx, buyer, "itest-fund:"+buyer, "itest-fund:"+buyer, clearing.ID, kobo); err != nil {
		t.Fatalf("fund buyer: %v", err)
	}
}

func standingBalance(t *testing.T, ctx context.Context, led *ledger.Service, typ ledger.AccountType) int64 {
	t.Helper()
	acc, err := led.GetOrCreateStandingAccount(ctx, typ)
	if err != nil {
		t.Fatalf("%s acct: %v", typ, err)
	}
	b, err := led.GetAccountBalance(ctx, acc.ID)
	if err != nil {
		t.Fatalf("%s balance: %v", typ, err)
	}
	return b
}

func buyerBalance(t *testing.T, ctx context.Context, led *ledger.Service, id string) int64 {
	t.Helper()
	b, err := led.GetBalance(ctx, id)
	if err != nil {
		t.Fatalf("buyer balance: %v", err)
	}
	return b
}

func setFee1000(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ev string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `UPDATE events SET fee_bps=1000 WHERE id=$1`, ev); err != nil {
		t.Fatalf("set fee: %v", err)
	}
}

func TestLiveDB_CancelRefunds90_10(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	led := cancelLedger(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	buyer := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	setFee1000(t, ctx, pool, ev)
	tier := seedPricedTier(t, ctx, pool, ev, 100000)
	fundBuyer(t, ctx, pool, led, buyer, 100000)

	tk, err := svc.Purchase(ctx, buyer, ev, tier, "", "idem-"+uuid.New().String())
	if err != nil {
		t.Fatalf("priced purchase: %v", err)
	}
	if tk.PricePaidKobo != 100000 {
		t.Fatalf("price paid = %d", tk.PricePaidKobo)
	}
	buyerAfterBuy := buyerBalance(t, ctx, led, buyer)
	revBefore := standingBalance(t, ctx, led, ledger.AccountPaymaxRevenue)
	escBefore := standingBalance(t, ctx, led, ledger.AccountEscrow)

	if err := svc.Cancel(ctx, owner, ev, "venue flooded", "idem-"+uuid.New().String()); err != nil {
		t.Fatalf("Cancel: %v", err)
	}

	if got := buyerBalance(t, ctx, led, buyer) - buyerAfterBuy; got != 90000 {
		t.Fatalf("buyer refund delta = %d, want 90000", got)
	}
	if got := standingBalance(t, ctx, led, ledger.AccountPaymaxRevenue) - revBefore; got != 10000 {
		t.Fatalf("revenue delta = %d, want 10000", got)
	}
	if got := standingBalance(t, ctx, led, ledger.AccountEscrow) - escBefore; got != -100000 {
		t.Fatalf("escrow delta = %d, want -100000", got)
	}
	var tState, oState, cState string
	if err := pool.QueryRow(ctx, `SELECT t.state, o.status, c.state FROM event_tickets t
		JOIN event_orders o ON o.id=t.order_id JOIN credentials c ON c.id=t.credential_id WHERE t.id=$1`, tk.ID).
		Scan(&tState, &oState, &cState); err != nil {
		t.Fatalf("read states: %v", err)
	}
	if tState != "REFUNDED" || oState != "REFUNDED" || cState != "REVOKED" {
		t.Fatalf("ticket=%s order=%s credential=%s", tState, oState, cState)
	}
	var evState string
	var cancelledAt *time.Time
	var reason *string
	if err := pool.QueryRow(ctx, `SELECT state, cancelled_at, cancel_reason FROM events WHERE id=$1`, ev).
		Scan(&evState, &cancelledAt, &reason); err != nil {
		t.Fatalf("read event: %v", err)
	}
	if evState != "CANCELLED" || cancelledAt == nil || reason == nil || *reason != "venue flooded" {
		t.Fatalf("event state=%s cancelled_at=%v reason=%v", evState, cancelledAt, reason)
	}
}

func TestLiveDB_CancelIdempotentResume(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	led := cancelLedger(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	buyer := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	setFee1000(t, ctx, pool, ev)
	tier := seedPricedTier(t, ctx, pool, ev, 100000)
	fundBuyer(t, ctx, pool, led, buyer, 100000)
	tk, err := svc.Purchase(ctx, buyer, ev, tier, "", "idem-"+uuid.New().String())
	if err != nil {
		t.Fatalf("purchase: %v", err)
	}
	buyerAfterBuy := buyerBalance(t, ctx, led, buyer)
	revBefore := standingBalance(t, ctx, led, ledger.AccountPaymaxRevenue)

	idem := "idem-" + uuid.New().String()
	for i := 0; i < 2; i++ {
		if err := svc.Cancel(ctx, owner, ev, "again", idem); err != nil {
			t.Fatalf("Cancel #%d: %v", i+1, err)
		}
	}
	if got := buyerBalance(t, ctx, led, buyer) - buyerAfterBuy; got != 90000 {
		t.Fatalf("buyer delta after 2 cancels = %d, want 90000 (exactly once)", got)
	}
	if got := standingBalance(t, ctx, led, ledger.AccountPaymaxRevenue) - revBefore; got != 10000 {
		t.Fatalf("revenue delta after 2 cancels = %d, want 10000", got)
	}
	var refundRows, feeRows int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE idempotency_key LIKE $1`, "evt-cancel:"+tk.ID+":refund%").Scan(&refundRows)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE idempotency_key LIKE $1`, "evt-cancel:"+tk.ID+":fee%").Scan(&feeRows)
	if refundRows != 2 || feeRows != 2 { // exactly one balanced pair (debit+credit side) each
		t.Fatalf("ledger rows refund=%d fee=%d, want 2 and 2", refundRows, feeRows)
	}
}

func TestLiveDB_CancelMixedTickets(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	led := cancelLedger(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	buyer := seedTicketTokenUser(t, ctx, pool)
	compBuyer := seedTicketTokenUser(t, ctx, pool)
	doneBuyer := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	setFee1000(t, ctx, pool, ev)
	tier := seedPricedTier(t, ctx, pool, ev, 100000)
	fundBuyer(t, ctx, pool, led, buyer, 100000)
	paid, err := svc.Purchase(ctx, buyer, ev, tier, "", "idem-"+uuid.New().String())
	if err != nil {
		t.Fatalf("purchase: %v", err)
	}
	// Comp (price 0) and pre-REFUNDED tickets seeded directly.
	seedRaw := func(who string, price int64, ticketState, orderState string) string {
		oid, tid := uuid.New().String(), uuid.New().String()
		if _, err := pool.Exec(ctx, `INSERT INTO event_orders (id, event_id, buyer_id, tier_id, total_kobo, status, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			oid, ev, who, tier, price, orderState, "itest-"+oid); err != nil {
			t.Fatalf("seed order: %v", err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO event_tickets (id, event_id, tier_id, order_id, owner_id, state, price_paid_kobo) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			tid, ev, tier, oid, who, ticketState, price); err != nil {
			t.Fatalf("seed ticket: %v", err)
		}
		return tid
	}
	comp := seedRaw(compBuyer, 0, "ISSUED", "PAID")
	done := seedRaw(doneBuyer, 100000, "REFUNDED", "REFUNDED")

	buyerAfterBuy := buyerBalance(t, ctx, led, buyer)
	compBefore := buyerBalance(t, ctx, led, compBuyer)
	doneBefore := buyerBalance(t, ctx, led, doneBuyer)
	revBefore := standingBalance(t, ctx, led, ledger.AccountPaymaxRevenue)

	if err := svc.Cancel(ctx, owner, ev, "mixed", "idem-"+uuid.New().String()); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if got := buyerBalance(t, ctx, led, buyer) - buyerAfterBuy; got != 90000 {
		t.Fatalf("paid buyer delta = %d", got)
	}
	if got := buyerBalance(t, ctx, led, compBuyer) - compBefore; got != 0 {
		t.Fatalf("comp buyer moved money: %d", got)
	}
	if got := buyerBalance(t, ctx, led, doneBuyer) - doneBefore; got != 0 {
		t.Fatalf("pre-refunded buyer moved money: %d", got)
	}
	if got := standingBalance(t, ctx, led, ledger.AccountPaymaxRevenue) - revBefore; got != 10000 {
		t.Fatalf("revenue delta = %d, want 10000", got)
	}
	for _, id := range []string{paid.ID, comp, done} {
		var st string
		_ = pool.QueryRow(ctx, `SELECT state FROM event_tickets WHERE id=$1`, id).Scan(&st)
		if st != "REFUNDED" {
			t.Fatalf("ticket %s state=%s, want REFUNDED", id, st)
		}
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE idempotency_key LIKE ANY($1)`,
		[]string{"evt-cancel:" + comp + "%", "evt-cancel:" + done + "%"}).Scan(&n)
	if n != 0 {
		t.Fatalf("comp/pre-refunded tickets have %d ledger rows, want 0", n)
	}
}

func TestLiveDB_CancelManagerForbidden(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	mgr := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_team_members (event_id, user_id, role, granted_by) VALUES ($1,$2,'MANAGER',$3)`, ev, mgr, owner); err != nil {
		t.Fatalf("seed team member: %v", err)
	}
	if err := svc.Cancel(ctx, mgr, ev, "nope", "idem-"+uuid.New().String()); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	var st string
	_ = pool.QueryRow(ctx, `SELECT state FROM events WHERE id=$1`, ev).Scan(&st)
	if st != "LIVE" {
		t.Fatalf("event state = %s, want LIVE", st)
	}
}

func TestLiveDB_CancelRefundsPayerNotOwner(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	led := cancelLedger(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	buyer := seedTicketTokenUser(t, ctx, pool)
	recipient := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	setFee1000(t, ctx, pool, ev)
	tier := seedPricedTier(t, ctx, pool, ev, 100000)
	fundBuyer(t, ctx, pool, led, buyer, 100000)
	tk, err := svc.Purchase(ctx, buyer, ev, tier, "", "idem-"+uuid.New().String())
	if err != nil {
		t.Fatalf("purchase: %v", err)
	}
	// Simulate a gift/transfer: ticket owner differs from the order's payer.
	if _, err := pool.Exec(ctx, `UPDATE event_tickets SET owner_id=$2 WHERE id=$1`, tk.ID, recipient); err != nil {
		t.Fatalf("transfer: %v", err)
	}
	buyerBefore := buyerBalance(t, ctx, led, buyer)
	recipBefore := buyerBalance(t, ctx, led, recipient)

	if err := svc.Cancel(ctx, owner, ev, "gifted", "idem-"+uuid.New().String()); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if got := buyerBalance(t, ctx, led, buyer) - buyerBefore; got != 90000 {
		t.Fatalf("payer delta = %d, want 90000", got)
	}
	if got := buyerBalance(t, ctx, led, recipient) - recipBefore; got != 0 {
		t.Fatalf("ticket owner delta = %d, want 0", got)
	}
}

func TestLiveDB_CreateEventDefaultsFee1000(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev, err := svc.CreateEvent(ctx, owner, top5events.Event{
		Title: "fee default", StartsAt: time.Now().Add(time.Hour), EndsAt: time.Now().Add(2 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateEvent: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM events WHERE id=$1`, ev.ID) })
	var bps int
	if err := pool.QueryRow(ctx, `SELECT fee_bps FROM events WHERE id=$1`, ev.ID).Scan(&bps); err != nil || bps != 1000 {
		t.Fatalf("fee_bps = %d err=%v, want 1000", bps, err)
	}
}
