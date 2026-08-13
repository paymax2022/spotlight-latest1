package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for the POST-SETTLEMENT dispute refund tip policy
// (ADR-030).
//
// A food dispute resolves only on a DELIVERED order — i.e. AFTER settlement has
// already paid the rider 100% of the customer's tip, with no provider clawback on
// that path. The regression this guards: the resolve path read the now
// tip-inclusive orders.total_kobo and refunded ALL of it from AccountPaymaxRevenue,
// so the platform funded a tip it never held.
//
// Policy under test:
//   - the PLATFORM-funded refund is capped at total_kobo − tip_kobo, on BOTH the
//     full and partial branches;
//   - the tip itself is recovered FROM THE RIDER and passed to the customer —
//     immediately when the rider's wallet covers it, otherwise queued and taken
//     off their next delivery settlement;
//   - the rider's wallet is never driven negative.
//
// Distinct from the cancel/reject/dispatch_failed path, which goes through
// settlement.Refund and returns the true escrowed total (tips included) — covered
// by TestLiveDB_OrderTipRefundedOnCancel.
//
// Skipped unless TEST_DATABASE_URL/DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
)

// disputeTipFixture is a tipped order that has been DELIVERED (and therefore settled,
// paying the rider its tip) with an open dispute ready to resolve.
type disputeTipFixture struct {
	svc       *Service
	led       *ledger.Service
	pool      *pgxpool.Pool
	customer  string
	rider     string
	owner     string
	orderID   string
	disputeID string
	total     int64
	tip       int64
	basis     int64 // total − tip: the platform-funded refund basis
}

// platformRevenueBalance reads the projected balance of the standing paymax_revenue
// account — the account a platform-funded dispute refund is drawn from.
func platformRevenueBalance(t *testing.T, ctx context.Context, led *ledger.Service) int64 {
	t.Helper()
	acc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("revenue account: %v", err)
	}
	bal, err := led.GetAccountBalance(ctx, acc.ID)
	if err != nil {
		t.Fatalf("revenue balance: %v", err)
	}
	return bal
}

// newDisputeTipFixture places a tipped order, delivers it (which settles it and pays the
// rider the tip in full), and opens a dispute on it.
func newDisputeTipFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, led *ledger.Service, kitchen string, tip int64) *disputeTipFixture {
	t.Helper()
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led)

	owner := uuid.New().String()
	customer := uuid.New().String()
	rider := uuid.New().String()
	for _, u := range []string{owner, customer, rider} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,$3,'1 St',TRUE)`, restID, owner, kitchen); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	cat, err := svc.CreateCategory(ctx, restID, owner, "Mains")
	if err != nil {
		t.Fatalf("category: %v", err)
	}
	item, err := svc.CreateItem(ctx, restID, owner, CreateItemRequest{CategoryID: cat.ID, Name: "Jollof", PriceKobo: 450_000})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, customer, "seed-fund", "disptipfund-"+customer, revAcc.ID, 5_000_000); err != nil {
		t.Fatalf("fund customer: %v", err)
	}

	order, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 2}},
		DeliveryAddress: "Victoria Island",
		TipKobo:         tip,
		IdempotencyKey:  "disptip-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place tipped order: %v", err)
	}
	if order.TipKobo != tip {
		t.Fatalf("order tip = %d, want %d", order.TipKobo, tip)
	}

	// Deliver it: ConfirmHandoff settles the escrow, paying the rider 10% of the non-tip
	// base PLUS 100% of the tip. This is what makes the dispute POST-settlement.
	if _, err := pool.Exec(ctx,
		`UPDATE orders SET rider_id=$2, status='picked_up', dispatch_status='assigned', delivery_code='7777' WHERE id=$1`,
		order.ID, rider); err != nil {
		t.Fatalf("assign rider: %v", err)
	}
	if err := svc.ConfirmHandoff(ctx, order.ID, rider, "7777"); err != nil {
		t.Fatalf("confirm handoff: %v", err)
	}
	// Sanity: the rider really was paid the tip, so the clawback has a live target.
	riderLeg := creditLegKobo(t, ctx, pool, "settle:order:"+order.ID+":rider")
	if want := (order.TotalKobo-tip)/10 + tip; riderLeg != want {
		t.Fatalf("rider leg = %d, want %d — fixture assumes the tip was paid at settlement", riderLeg, want)
	}

	d, err := svc.RaiseFoodDispute(ctx, order.ID, customer, "non_delivery",
		"the order never arrived and the rider marked it delivered anyway")
	if err != nil {
		t.Fatalf("raise dispute: %v", err)
	}

	return &disputeTipFixture{
		svc: svc, led: led, pool: pool,
		customer: customer, rider: rider, owner: owner,
		orderID: order.ID, disputeID: d.ID,
		total: order.TotalKobo, tip: tip, basis: order.TotalKobo - tip,
	}
}

// TestLiveDB_DisputeFullRefundCapsPlatformAtNonTipBasis: a refund_full on a tipped,
// already-settled order must draw only total − tip from platform revenue. The tip is
// clawed back from the rider (whose wallet is funded here by their settlement payout)
// and passed to the customer, so the customer still ends up whole.
func TestLiveDB_DisputeFullRefundCapsPlatformAtNonTipBasis(t *testing.T) {
	pool := tipPool(t)
	defer pool.Close()
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	const tip int64 = 50_000
	f := newDisputeTipFixture(t, ctx, pool, led, "Dispute Tip Kitchen", tip)

	custBefore, err := led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("customer balance before: %v", err)
	}
	riderBefore, err := led.GetBalance(ctx, f.rider)
	if err != nil {
		t.Fatalf("rider balance before: %v", err)
	}
	revBefore := platformRevenueBalance(t, ctx, led)

	admin := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, admin, admin+"@seed.test"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	got, err := f.svc.AdminResolveFoodDispute(ctx, f.disputeID, admin, FoodRefundFull, 0, "upheld — never delivered")
	if err != nil {
		t.Fatalf("resolve dispute: %v", err)
	}

	// --- The recorded PLATFORM-funded refund is the non-tip basis. ---
	if got.RefundKobo != f.basis {
		t.Errorf("platform-funded refund = %d, want %d (total %d − tip %d) — the platform must not "+
			"refund a tip it never held", got.RefundKobo, f.basis, f.total, f.tip)
	}
	var storedRefund int64
	if err := pool.QueryRow(ctx,
		`SELECT refund_kobo FROM restaurant_dispute_refunds WHERE dispute_id=$1`, f.disputeID).Scan(&storedRefund); err != nil {
		t.Fatalf("read refund record: %v", err)
	}
	if storedRefund != f.basis {
		t.Errorf("persisted refund_kobo = %d, want %d", storedRefund, f.basis)
	}

	// --- Platform revenue moved by EXACTLY the non-tip basis, not the tipped total. ---
	revDelta := revBefore - platformRevenueBalance(t, ctx, led)
	if revDelta != f.basis {
		t.Errorf("platform revenue fell by %d, want %d — a delta of %d would mean the platform "+
			"funded the %d kobo tip", revDelta, f.basis, f.total, f.tip)
	}

	// --- The rider funded the tip: their wallet is down by exactly the tip. ---
	riderAfter, err := led.GetBalance(ctx, f.rider)
	if err != nil {
		t.Fatalf("rider balance after: %v", err)
	}
	if delta := riderBefore - riderAfter; delta != f.tip {
		t.Errorf("rider wallet fell by %d, want %d (the tip they were paid for a delivery that "+
			"was disputed and upheld)", delta, f.tip)
	}
	if riderAfter < 0 {
		t.Errorf("rider balance = %d — a clawback must never drive a wallet negative", riderAfter)
	}

	// --- The customer is whole: basis from the platform + tip from the rider. ---
	custAfter, err := led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("customer balance after: %v", err)
	}
	if delta := custAfter - custBefore; delta != f.total {
		t.Errorf("customer credited %d, want the full %d (basis %d + tip %d)", delta, f.total, f.basis, f.tip)
	}

	// --- The clawback is recorded as recovered, and the ledger pair is DR rider/CR customer. ---
	var status string
	var clawTip int64
	if err := pool.QueryRow(ctx,
		`SELECT status, tip_kobo FROM restaurant_dispute_tip_clawbacks WHERE dispute_id=$1`, f.disputeID).
		Scan(&status, &clawTip); err != nil {
		t.Fatalf("read clawback record: %v", err)
	}
	if status != "recovered" || clawTip != f.tip {
		t.Errorf("clawback = (%s, %d), want (recovered, %d)", status, clawTip, f.tip)
	}
	if moved := creditLegKobo(t, ctx, pool, tipClawbackKey(f.disputeID)); moved != f.tip {
		t.Errorf("clawback credit leg = %d, want %d", moved, f.tip)
	}

	// --- Idempotency: re-resolving must move no further money (the ticket is closed). ---
	custSettled, riderSettled, revSettled := custAfter, riderAfter, platformRevenueBalance(t, ctx, led)
	if _, err := f.svc.AdminResolveFoodDispute(ctx, f.disputeID, admin, FoodRefundFull, 0, "retry"); err == nil {
		t.Error("re-resolving a closed dispute should be rejected")
	}
	custNow, _ := led.GetBalance(ctx, f.customer)
	riderNow, _ := led.GetBalance(ctx, f.rider)
	if custNow != custSettled || riderNow != riderSettled || platformRevenueBalance(t, ctx, led) != revSettled {
		t.Errorf("a repeat resolve moved money: customer %d→%d, rider %d→%d",
			custSettled, custNow, riderSettled, riderNow)
	}
}

// TestLiveDB_DisputePartialRefundInheritsTipCap is the loophole guard, live. The partial
// branch bounds requestedKobo against the same basis as the full branch, so a partial can
// neither reach into the tip nor be used to refund it a slice at a time.
func TestLiveDB_DisputePartialRefundInheritsTipCap(t *testing.T) {
	pool := tipPool(t)
	defer pool.Close()
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	const tip int64 = 50_000
	f := newDisputeTipFixture(t, ctx, pool, led, "Partial Cap Kitchen", tip)

	admin := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, admin, admin+"@seed.test"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}

	// --- A partial ABOVE the non-tip basis is rejected, and moves nothing. ---
	custBefore, _ := led.GetBalance(ctx, f.customer)
	revBefore := platformRevenueBalance(t, ctx, led)
	for _, requested := range []int64{f.basis, f.basis + 1, f.total - 1} {
		if _, err := f.svc.AdminResolveFoodDispute(ctx, f.disputeID, admin, FoodRefundPartial, requested, "too much"); err == nil {
			t.Errorf("partial refund of %d accepted — must be capped at the non-tip basis %d "+
				"(the tip is not the platform's to refund)", requested, f.basis)
		}
	}
	custAfterRejects, _ := led.GetBalance(ctx, f.customer)
	if custAfterRejects != custBefore || platformRevenueBalance(t, ctx, led) != revBefore {
		t.Error("a rejected partial refund moved money")
	}

	// --- A partial just UNDER the basis is accepted and paid exactly. ---
	want := f.basis - 1
	got, err := f.svc.AdminResolveFoodDispute(ctx, f.disputeID, admin, FoodRefundPartial, want, "partial — cold food")
	if err != nil {
		t.Fatalf("valid partial rejected: %v", err)
	}
	if got.RefundKobo != want {
		t.Errorf("partial refund = %d, want %d", got.RefundKobo, want)
	}
	if delta := revBefore - platformRevenueBalance(t, ctx, led); delta != want {
		t.Errorf("platform revenue fell by %d, want %d", delta, want)
	}
	custAfter, _ := led.GetBalance(ctx, f.customer)
	if delta := custAfter - custBefore; delta != want {
		t.Errorf("customer credited %d, want %d", delta, want)
	}

	// --- A partial does NOT touch the rider: no clawback row, no wallet movement. ---
	var clawbacks int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM restaurant_dispute_tip_clawbacks WHERE dispute_id=$1`, f.disputeID).Scan(&clawbacks); err != nil {
		t.Fatalf("count clawbacks: %v", err)
	}
	if clawbacks != 0 {
		t.Errorf("a partial refund queued %d rider clawback(s) — a partial is characteristically "+
			"a kitchen fault and must not take the rider's tip", clawbacks)
	}
}

// TestLiveDB_DisputeTipClawbackDeferredToNextSettlement: when the rider has already
// withdrawn the tip, the clawback cannot settle at resolution. It must be queued — never
// overdrawing the rider, never charged to the platform — and then recovered off their
// NEXT delivery settlement, crediting the customer at that point.
func TestLiveDB_DisputeTipClawbackDeferredToNextSettlement(t *testing.T) {
	pool := tipPool(t)
	defer pool.Close()
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	const tip int64 = 50_000
	f := newDisputeTipFixture(t, ctx, pool, led, "Deferred Clawback Kitchen", tip)

	// Drain the rider's wallet to simulate "already withdrawn".
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	riderBal, err := led.GetBalance(ctx, f.rider)
	if err != nil {
		t.Fatalf("rider balance: %v", err)
	}
	if riderBal > 0 {
		if err := led.Debit(ctx, f.rider, "withdraw", "riderdrain-"+f.rider, revAcc.ID, riderBal); err != nil {
			t.Fatalf("drain rider wallet: %v", err)
		}
	}

	admin := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, admin, admin+"@seed.test"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	custBefore, _ := led.GetBalance(ctx, f.customer)
	revBefore := platformRevenueBalance(t, ctx, led)

	got, err := f.svc.AdminResolveFoodDispute(ctx, f.disputeID, admin, FoodRefundFull, 0, "upheld — never delivered")
	if err != nil {
		t.Fatalf("resolve dispute: %v", err)
	}

	// The platform pays the basis and NOT the tip, even though the tip cannot be
	// recovered right now — an unrecoverable tip must never fall back on the platform.
	if got.RefundKobo != f.basis {
		t.Errorf("platform-funded refund = %d, want %d", got.RefundKobo, f.basis)
	}
	if delta := revBefore - platformRevenueBalance(t, ctx, led); delta != f.basis {
		t.Errorf("platform revenue fell by %d, want %d — the platform must not backstop an "+
			"unrecoverable tip", delta, f.basis)
	}
	// The customer has the basis but NOT yet the tip.
	custAfter, _ := led.GetBalance(ctx, f.customer)
	if delta := custAfter - custBefore; delta != f.basis {
		t.Errorf("customer credited %d at resolution, want %d (the tip waits on the rider)", delta, f.basis)
	}
	// The rider was NOT overdrawn.
	if bal, _ := led.GetBalance(ctx, f.rider); bal != 0 {
		t.Errorf("rider balance = %d, want 0 — an unaffordable clawback must not overdraw the wallet", bal)
	}
	// The debt is queued.
	var status string
	if err := pool.QueryRow(ctx,
		`SELECT status FROM restaurant_dispute_tip_clawbacks WHERE dispute_id=$1`, f.disputeID).Scan(&status); err != nil {
		t.Fatalf("read clawback record: %v", err)
	}
	if status != "pending" {
		t.Fatalf("clawback status = %s, want pending", status)
	}

	// --- The rider's NEXT delivery pays them, and the sweep discharges the debt. ---
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Next Delivery Kitchen','2 St',TRUE)`, restID, f.owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	cat, err := f.svc.CreateCategory(ctx, restID, f.owner, "Mains")
	if err != nil {
		t.Fatalf("category: %v", err)
	}
	item, err := f.svc.CreateItem(ctx, restID, f.owner, CreateItemRequest{CategoryID: cat.ID, Name: "Egusi", PriceKobo: 900_000})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	nextCustomer := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, nextCustomer, nextCustomer+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := led.Credit(ctx, nextCustomer, "seed-fund", "nextfund-"+nextCustomer, revAcc.ID, 5_000_000); err != nil {
		t.Fatalf("fund next customer: %v", err)
	}
	nextOrder, err := f.svc.PlaceOrder(ctx, restID, nextCustomer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 2}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "nextdel-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place next order: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE orders SET rider_id=$2, status='picked_up', dispatch_status='assigned', delivery_code='8888' WHERE id=$1`,
		nextOrder.ID, f.rider); err != nil {
		t.Fatalf("assign rider: %v", err)
	}
	custBeforeSweep, _ := led.GetBalance(ctx, f.customer)

	if err := f.svc.ConfirmHandoff(ctx, nextOrder.ID, f.rider, "8888"); err != nil {
		t.Fatalf("confirm next handoff: %v", err)
	}

	// The debt is now discharged and the DISPUTING customer has been credited the tip.
	if err := pool.QueryRow(ctx,
		`SELECT status FROM restaurant_dispute_tip_clawbacks WHERE dispute_id=$1`, f.disputeID).Scan(&status); err != nil {
		t.Fatalf("re-read clawback record: %v", err)
	}
	if status != "recovered" {
		t.Errorf("clawback status = %s after the rider's next settlement, want recovered", status)
	}
	custAfterSweep, _ := led.GetBalance(ctx, f.customer)
	if delta := custAfterSweep - custBeforeSweep; delta != f.tip {
		t.Errorf("disputing customer credited %d by the sweep, want the %d kobo tip", delta, f.tip)
	}
	// Across resolution AND recovery the customer is whole, and the platform paid only
	// the basis throughout — the whole point of the policy.
	if total := custAfterSweep - custBefore; total != f.total {
		t.Errorf("customer credited %d in total, want the full order value %d", total, f.total)
	}
	// The recovery is rider-funded end to end. A revenue BALANCE delta is the wrong
	// instrument here — the sweep runs inside the next order's ConfirmHandoff, which
	// legitimately posts that order's 10% platform commission — so assert on the clawback
	// pair itself: exactly two legs, DR the rider's wallet and CR the customer's wallet,
	// with no standing account anywhere in it.
	riderAcc, err := led.GetOrCreateUserWallet(ctx, f.rider)
	if err != nil {
		t.Fatalf("rider wallet: %v", err)
	}
	custAcc, err := led.GetOrCreateUserWallet(ctx, f.customer)
	if err != nil {
		t.Fatalf("customer wallet: %v", err)
	}
	rows, err := pool.Query(ctx,
		`SELECT type, account_id, amount_kobo FROM ledger_entries WHERE reference=$1 ORDER BY type`,
		tipClawbackKey(f.disputeID))
	if err != nil {
		t.Fatalf("read clawback legs: %v", err)
	}
	defer rows.Close()
	legs := map[string]struct {
		acct   string
		amount int64
	}{}
	for rows.Next() {
		var typ, acct string
		var amt int64
		if err := rows.Scan(&typ, &acct, &amt); err != nil {
			t.Fatalf("scan clawback leg: %v", err)
		}
		legs[typ] = struct {
			acct   string
			amount int64
		}{acct, amt}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read clawback legs: %v", err)
	}
	if len(legs) != 2 {
		t.Fatalf("clawback posted %d legs, want exactly 2 (one balanced pair)", len(legs))
	}
	if legs["DEBIT"].acct != riderAcc.ID || legs["DEBIT"].amount != f.tip {
		t.Errorf("clawback DEBIT = (%s, %d), want the rider's wallet %s for %d — the tip must "+
			"come from the rider, never from platform revenue", legs["DEBIT"].acct, legs["DEBIT"].amount, riderAcc.ID, f.tip)
	}
	if legs["CREDIT"].acct != custAcc.ID || legs["CREDIT"].amount != f.tip {
		t.Errorf("clawback CREDIT = (%s, %d), want the customer's wallet %s for %d",
			legs["CREDIT"].acct, legs["CREDIT"].amount, custAcc.ID, f.tip)
	}
	// The rider's next payout absorbed the debt, and their wallet stayed non-negative.
	riderEnd, _ := led.GetBalance(ctx, f.rider)
	if riderEnd < 0 {
		t.Errorf("rider balance = %d — recovery must never overdraw the wallet", riderEnd)
	}
	nextRiderLeg := creditLegKobo(t, ctx, pool, "settle:order:"+nextOrder.ID+":rider")
	if want := nextRiderLeg - f.tip; riderEnd != want {
		t.Errorf("rider balance = %d, want %d (next payout %d less the recovered %d tip)",
			riderEnd, want, nextRiderLeg, f.tip)
	}
}
