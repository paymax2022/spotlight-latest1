package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for the FAIL-CLOSED TIER GATE on the food-order escrow
// (backend/internal/restaurant/service.go PlaceOrder).
//
// Regression guard: PlaceOrder used to escrow the customer's wallet — a real ledger
// DEBIT — without ever calling s.tiers.EnforceWalletDebitLimit. The seam existed and
// was wired, but only withdrawal.go used it, so food orders were an uncapped side
// door out of the wallet: a Tier 0 customer (wallet disabled) could order, and any
// customer could blow straight through their KYC daily debit cap by ordering food.
//
// What these tests pin, in the order that matters:
//
//	 1. an order INSIDE the tier's daily cap still succeeds and still escrows;
//	 2. an order OVER the cap is refused BEFORE any money moves — no ledger entry,
//	    no settlement row, no order row, and an unchanged wallet balance;
//	 3. the cap is cumulative across the day, not per-order;
//	 4. Tier 0 (wallet disabled) is refused the same way;
//	 5. a customer with NO user_profiles row is refused (the strongest fail-closed
//	    case: the gate cannot determine a tier, so it must not let the debit through);
//	 6. a Service with NO tier gate wired refuses rather than escrowing ungated;
//	 7. the gate prices the FULL escrowed total (subtotal + delivery + tip), proven
//	    with a recording limiter rather than by arithmetic coincidence;
//	 8. FinalizeGroupOrder inherits the gate — a shared cart is not a way around it.
//
// And the idempotency properties the gate could have broken, which are money-path
// invariants in their own right:
//
//	 9. a replay is NOT re-gated (the gate would otherwise count an order against
//	    itself and refuse a retry whose money already moved);
//	10. a retry whose escrow committed but whose order row did not still heals;
//	11. an Idempotency-Key resolves only for the customer who used it;
//	12. an empty Idempotency-Key is refused.
//
// Every refusal case asserts zero ledger entries for the order's escrow legs, which is
// the invariant the gate exists to hold: a refused order costs the customer nothing and
// leaves nothing to reverse.
//
// Skipped unless TEST_DATABASE_URL/DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
)

func tierPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB tier-gate test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

// seedKYCTier inserts (or updates) the user_profiles row that the tier gate reads.
// Shared by every live-DB test in this package that places an order: without a
// profile row tiers.GetUserTier errors and the gate fails closed, so seeding a tier
// is now part of seeding a customer. Tier 3 is unlimited — use it wherever the test
// is about something other than the cap itself.
func seedKYCTier(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string, kycTier int) {
	t.Helper()
	// email is NOT NULL on user_profiles — mirror the auth.users seed address.
	if _, err := pool.Exec(ctx,
		`INSERT INTO user_profiles (id, email, kyc_tier) VALUES ($1,$2,$3)
		 ON CONFLICT (id) DO UPDATE SET kyc_tier = EXCLUDED.kyc_tier`, userID, userID+"@seed.test", kycTier); err != nil {
		t.Fatalf("seed kyc tier %d for %s: %v", kycTier, userID, err)
	}
}

// escrowLegs counts the ledger entries posted for an order's escrow. The order id is
// not knowable when PlaceOrder is refused, so the stable handle is the caller's
// Idempotency-Key: settlement.Escrow debits under "<key>:escrow", and the ledger splits
// that into the balanced pair "<key>:escrow:debit" / "<key>:escrow:credit".
//
// An ACCEPTED order therefore has exactly escrowLegsPosted (2) entries; a REFUSED one
// must have 0 — the customer's wallet was never touched.
func escrowLegs(t *testing.T, ctx context.Context, pool *pgxpool.Pool, idemKey string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key LIKE $1`, idemKey+":escrow:%").Scan(&n); err != nil {
		t.Fatalf("count escrow ledger entries: %v", err)
	}
	return n
}

// escrowLegsPosted is the balanced pair (DR customer wallet, CR escrow) one accepted
// order's escrow writes.
const escrowLegsPosted = 2

// assertNothingWritten is the full fail-closed assertion for a REFUSED order: the
// escrow ledger leg, the settlement row, and the order row must all be absent, and
// the customer's balance must be exactly what it was before the attempt.
func assertNothingWritten(t *testing.T, ctx context.Context, pool *pgxpool.Pool, led *ledger.Service, customer, idemKey string, balanceBefore int64) {
	t.Helper()
	if n := escrowLegs(t, ctx, pool, idemKey); n != 0 {
		t.Errorf("%d ledger entries posted for a refused order (idem %s) — the tier gate must run BEFORE the escrow debit", n, idemKey)
	}
	var settlements, orders int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM settlements WHERE idempotency_key=$1`, idemKey).Scan(&settlements); err != nil {
		t.Fatalf("count settlements: %v", err)
	}
	if settlements != 0 {
		t.Errorf("%d settlement rows created for a refused order (idem %s)", settlements, idemKey)
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM orders WHERE idempotency_key=$1`, idemKey).Scan(&orders); err != nil {
		t.Fatalf("count orders: %v", err)
	}
	if orders != 0 {
		t.Errorf("%d order rows created for a refused order (idem %s)", orders, idemKey)
	}
	after, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	if after != balanceBefore {
		t.Errorf("customer balance moved on a refused order: %d -> %d", balanceBefore, after)
	}
}

// tierGateFixture seeds an open restaurant with one menu item and a funded customer,
// returning the service, ledger, restaurant id, menu item and customer id.
func tierGateFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, name string, itemPriceKobo, fundKobo int64) (*Service, *ledger.Service, string, *MenuItem, string) {
	t.Helper()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led).WithTiers(tiers.NewService(pool))

	owner := uuid.New().String()
	customer := uuid.New().String()
	for _, u := range []string{owner, customer} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,$3,'1 St',TRUE)`, restID, owner, name); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	cat, err := svc.CreateCategory(ctx, restID, owner, "Mains")
	if err != nil {
		t.Fatalf("category: %v", err)
	}
	item, err := svc.CreateItem(ctx, restID, owner, CreateItemRequest{CategoryID: cat.ID, Name: "Jollof", PriceKobo: itemPriceKobo})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}

	// Fund the customer well past every amount these tests order, so a rejection can
	// only ever be the tier gate — never an insufficient-funds error wearing its coat.
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, customer, "seed-fund", "tierfund-"+customer, revAcc.ID, fundKobo); err != nil {
		t.Fatalf("fund customer: %v", err)
	}
	return svc, led, restID, item, customer
}

// TestLiveDB_OrderEscrowTierGate_UnderLimit: an order that fits inside the customer's
// daily cap is unaffected by the gate — it still escrows the full total.
//
// Tier 1 caps daily wallet debits at ₦50,000 (5,000,000 kobo). This order is one
// ₦2,000 item + the flat ₦500 delivery fee + a ₦500 tip = ₦3,000, comfortably under.
func TestLiveDB_OrderEscrowTierGate_UnderLimit(t *testing.T) {
	pool := tierPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, led, restID, item, customer := tierGateFixture(t, ctx, pool, "Under Limit Kitchen", 200_000, 10_000_000)
	seedKYCTier(t, ctx, pool, customer, 1) // ₦50k/day

	const tip int64 = 50_000
	wantTotal := int64(200_000) + DeliveryFeeKobo + tip
	before, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	idem := "tier-under-" + uuid.New().String()
	order, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		TipKobo:         tip,
		IdempotencyKey:  idem,
	})
	if err != nil {
		t.Fatalf("under-limit order must succeed, got: %v", err)
	}
	if order.TotalKobo != wantTotal {
		t.Errorf("order total = %d, want %d", order.TotalKobo, wantTotal)
	}
	// The gate let the money through: the balanced escrow pair is posted and the
	// wallet moved by exactly the escrowed total.
	if n := escrowLegs(t, ctx, pool, idem); n != escrowLegsPosted {
		t.Errorf("escrow ledger legs for the accepted order = %d, want %d", n, escrowLegsPosted)
	}
	after, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	if before-after != wantTotal {
		t.Errorf("customer debited %d, want the escrowed total %d", before-after, wantTotal)
	}
}

// TestLiveDB_OrderEscrowTierGate_OverLimit: an order that would push the customer past
// their daily cap is refused BEFORE the escrow — nothing is written anywhere.
//
// The order is priced above Tier 1's entire ₦50,000 daily allowance on its own, so the
// refusal does not depend on any prior spend in the test window.
func TestLiveDB_OrderEscrowTierGate_OverLimit(t *testing.T) {
	pool := tierPool(t)
	defer pool.Close()
	ctx := context.Background()

	// One ₦60,000 item — over Tier 1's ₦50,000/day cap before delivery is even added.
	svc, led, restID, item, customer := tierGateFixture(t, ctx, pool, "Over Limit Kitchen", 6_000_000, 50_000_000)
	seedKYCTier(t, ctx, pool, customer, 1)

	before, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	idem := "tier-over-" + uuid.New().String()
	_, err = svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  idem,
	})
	if !errors.Is(err, tiers.ErrDailyLimitExceeded) {
		t.Fatalf("over-cap order err = %v, want tiers.ErrDailyLimitExceeded", err)
	}
	assertNothingWritten(t, ctx, pool, led, customer, idem, before)
}

// TestLiveDB_OrderEscrowTierGate_OverLimitCumulative: the cap is cumulative across the
// day, not per-order. A first order that fits is accepted; a second that fits on its
// own but pushes the DAY over the cap is refused — and the refusal still writes nothing.
//
// This is the case a naive per-order check would miss, and the reason the gate reads the
// same wallet DEBIT rows the escrow posts.
func TestLiveDB_OrderEscrowTierGate_OverLimitCumulative(t *testing.T) {
	pool := tierPool(t)
	defer pool.Close()
	ctx := context.Background()

	// ₦300 item; Tier 1's cap is ₦50,000/day. 100 × (₦300 + nothing) plus the flat
	// ₦500 delivery = ₦30,500 for the first order — under the cap. The second order of
	// the same size would take the day to ₦61,000, over it.
	svc, led, restID, item, customer := tierGateFixture(t, ctx, pool, "Cumulative Kitchen", 30_000, 100_000_000)
	seedKYCTier(t, ctx, pool, customer, 1)

	first := "tier-cum-a-" + uuid.New().String()
	if _, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 100}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  first,
	}); err != nil {
		t.Fatalf("first (under-cap) order must succeed, got: %v", err)
	}

	before, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	second := "tier-cum-b-" + uuid.New().String()
	_, err = svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 100}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  second,
	})
	if !errors.Is(err, tiers.ErrDailyLimitExceeded) {
		t.Fatalf("second order err = %v, want tiers.ErrDailyLimitExceeded (the day's spend is cumulative)", err)
	}
	assertNothingWritten(t, ctx, pool, led, customer, second, before)
}

// TestLiveDB_OrderEscrowTierGate_Tier0WalletDisabled: a Tier 0 customer has no usable
// wallet, so an order is refused before the escrow even with a funded balance.
func TestLiveDB_OrderEscrowTierGate_Tier0WalletDisabled(t *testing.T) {
	pool := tierPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, led, restID, item, customer := tierGateFixture(t, ctx, pool, "Tier0 Kitchen", 200_000, 10_000_000)
	seedKYCTier(t, ctx, pool, customer, 0) // wallet disabled

	before, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	idem := "tier0-" + uuid.New().String()
	_, err = svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  idem,
	})
	if !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("tier 0 order err = %v, want tiers.ErrWalletDisabled", err)
	}
	assertNothingWritten(t, ctx, pool, led, customer, idem, before)
}

// TestLiveDB_OrderEscrowTierGate_NoProfileFailsClosed: a customer with no user_profiles
// row cannot have their tier determined — so the gate must REFUSE, not wave them
// through. This is the strongest fail-closed guarantee and the one an "unknown tier ⇒
// allow" bug would quietly break.
func TestLiveDB_OrderEscrowTierGate_NoProfileFailsClosed(t *testing.T) {
	pool := tierPool(t)
	defer pool.Close()
	ctx := context.Background()

	// Deliberately NO seedKYCTier call for this customer.
	svc, led, restID, item, customer := tierGateFixture(t, ctx, pool, "No Profile Kitchen", 200_000, 10_000_000)

	before, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	idem := "tier-noprofile-" + uuid.New().String()
	_, err = svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  idem,
	})
	if err == nil {
		t.Fatal("an order from a customer with no tier profile must be refused (fail closed), got nil")
	}
	assertNothingWritten(t, ctx, pool, led, customer, idem, before)
}

// TestLiveDB_OrderEscrowTierGate_UnwiredGateRefuses: a Service built WITHOUT WithTiers
// refuses to escrow at all. A nil gate is a misconfigured deployment, not a dev-mode
// bypass — see ADR-033. This is the test that would fail if someone "fixed" a wiring
// problem by making the nil case permissive again.
func TestLiveDB_OrderEscrowTierGate_UnwiredGateRefuses(t *testing.T) {
	pool := tierPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, led, restID, item, customer := tierGateFixture(t, ctx, pool, "Unwired Kitchen", 200_000, 10_000_000)
	seedKYCTier(t, ctx, pool, customer, 3) // unlimited — only the missing gate can refuse
	svc.WithTiers(nil)                     // drop the gate

	before, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	idem := "tier-unwired-" + uuid.New().String()
	_, err = svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  idem,
	})
	if !errors.Is(err, ErrTierGateUnwired) {
		t.Fatalf("unwired-gate order err = %v, want ErrTierGateUnwired", err)
	}
	assertNothingWritten(t, ctx, pool, led, customer, idem, before)
}

// recordingLimiter is a TierLimiter that records the amount it was asked to authorize
// and always allows. It exists to pin WHAT is gated, independently of any real limit:
// the arithmetic in the cap tests would pass just as happily if the gate priced only the
// food subtotal, because every order there is far under or far over the cap.
type recordingLimiter struct{ gotKobo, calls int64 }

func (r *recordingLimiter) EnforceWalletDebitLimit(_ context.Context, _ string, amountKobo int64) error {
	r.gotKobo = amountKobo
	r.calls++
	return nil
}

// TestLiveDB_OrderEscrowTierGate_GatesTheFullEscrowedTotal: the gate is enforced on the
// WHOLE amount leaving the wallet — subtotal + delivery + tip — not the food subtotal.
//
// This is the invariant that keeps the tip from being a lever around the cap: the tip is
// the one client-supplied amount on the order, so gating a smaller number than the one
// escrowed would let a customer spend past their limit by tipping.
func TestLiveDB_OrderEscrowTierGate_GatesTheFullEscrowedTotal(t *testing.T) {
	pool := tierPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, _, restID, item, customer := tierGateFixture(t, ctx, pool, "Full Total Kitchen", 200_000, 10_000_000)
	seedKYCTier(t, ctx, pool, customer, 3)

	rec := &recordingLimiter{}
	svc.WithTiers(rec)

	const tip int64 = 70_000
	order, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 3}},
		DeliveryAddress: "Victoria Island",
		TipKobo:         tip,
		IdempotencyKey:  "tier-fulltotal-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order: %v", err)
	}
	if rec.calls != 1 {
		t.Fatalf("tier gate called %d times, want exactly 1 per order", rec.calls)
	}
	// The gated amount must be the escrowed amount, to the kobo.
	if rec.gotKobo != order.TotalKobo {
		t.Errorf("gate authorized %d kobo but the order escrowed %d — the gate must price the full total",
			rec.gotKobo, order.TotalKobo)
	}
	// Spelled out, so a regression to "subtotal only" names itself in the failure.
	wantGated := int64(3)*200_000 + DeliveryFeeKobo + tip
	if rec.gotKobo != wantGated {
		t.Errorf("gate authorized %d kobo, want %d (subtotal %d + delivery %d + tip %d)",
			rec.gotKobo, wantGated, int64(3)*200_000, DeliveryFeeKobo, tip)
	}
}

// TestLiveDB_OrderEscrowTierGate_ReplayNotRegated: replaying an order under the same
// Idempotency-Key returns the original order and does NOT re-run the tier gate.
//
// Regression guard for the bug the gate itself introduced: the gate measures today's
// spend from the customer's wallet DEBIT rows, which on a replay already include THIS
// order's escrow. Gating a replay therefore counts the order against itself and refuses
// it with "daily limit exceeded" — telling the caller their order failed when the money
// had already moved and the order existed. The order below is deliberately sized just
// over half the daily cap, which is exactly the range where that double-count bites.
func TestLiveDB_OrderEscrowTierGate_ReplayNotRegated(t *testing.T) {
	pool := tierPool(t)
	defer pool.Close()
	ctx := context.Background()

	// ₦30,000 item; Tier 1's cap is ₦50,000/day. One order = ₦30,500 — under the cap,
	// but 2 × ₦30,500 is over it, so a re-gated replay would be refused.
	svc, led, restID, item, customer := tierGateFixture(t, ctx, pool, "Replay Kitchen", 3_000_000, 100_000_000)
	seedKYCTier(t, ctx, pool, customer, 1)

	idem := "tier-replay-" + uuid.New().String()
	req := PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  idem,
	}
	first, err := svc.PlaceOrder(ctx, restID, customer, req)
	if err != nil {
		t.Fatalf("first order: %v", err)
	}
	afterFirst, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	replay, err := svc.PlaceOrder(ctx, restID, customer, req)
	if err != nil {
		t.Fatalf("replaying an already-placed order must return it, not refuse it: %v", err)
	}
	if replay.ID != first.ID {
		t.Errorf("replay returned order %s, want the original %s", replay.ID, first.ID)
	}
	// The replay moved no money: still exactly one balanced escrow pair, balance flat.
	if n := escrowLegs(t, ctx, pool, idem); n != escrowLegsPosted {
		t.Errorf("escrow legs after replay = %d, want %d (a replay must not post a second debit)", n, escrowLegsPosted)
	}
	afterReplay, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	if afterReplay != afterFirst {
		t.Errorf("balance moved on replay: %d -> %d", afterFirst, afterReplay)
	}
}

// TestLiveDB_OrderEscrowTierGate_StrandedEscrowRetryHeals: a retry whose escrow already
// committed is NOT charged against the tier limit a second time.
//
// settlement.Escrow can commit (ledger debit + settlement row) while the order tx that
// follows it fails — an item deleted mid-flight, a commit timeout, a pod restart. Escrow
// is documented as idempotent precisely so the customer's retry heals that: the debit is
// deduped and the order row finally lands.
//
// Gating the escrow put that recovery at risk. The retry has no order row, so the fast
// idempotent path cannot see it, and the customer's wallet debit is ALREADY posted — so
// re-running the limit counts the order against itself and refuses the retry. The money
// would then sit escrowed with no order attached: invisible to the reconciler (which
// joins orders) and with no path to a refund.
//
// The order below is sized just over half the daily cap, which is exactly the range where
// that double-count bites. Deleting the order row reproduces the crash window.
func TestLiveDB_OrderEscrowTierGate_StrandedEscrowRetryHeals(t *testing.T) {
	pool := tierPool(t)
	defer pool.Close()
	ctx := context.Background()

	// ₦26,000 item + ₦500 delivery = ₦26,500 against Tier 1's ₦50,000/day cap: one
	// fits, twice the amount does not.
	svc, led, restID, item, customer := tierGateFixture(t, ctx, pool, "Stranded Escrow Kitchen", 2_600_000, 100_000_000)
	seedKYCTier(t, ctx, pool, customer, 1)

	idem := "tier-stranded-" + uuid.New().String()
	req := PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  idem,
	}
	if _, err := svc.PlaceOrder(ctx, restID, customer, req); err != nil {
		t.Fatalf("first order: %v", err)
	}
	afterEscrow, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	// Reproduce the crash window: the escrow (ledger debit + settlement row) survives,
	// the order row does not.
	if _, err := pool.Exec(ctx, `DELETE FROM order_restaurant_items WHERE order_id IN (SELECT id FROM orders WHERE idempotency_key=$1)`, idem); err != nil {
		t.Fatalf("clear order mappings: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE idempotency_key=$1)`, idem); err != nil {
		t.Fatalf("clear order items: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM orders WHERE idempotency_key=$1`, idem); err != nil {
		t.Fatalf("simulate crash before order insert: %v", err)
	}

	// The retry must heal: same key, escrow already posted, order row recreated.
	healed, err := svc.PlaceOrder(ctx, restID, customer, req)
	if err != nil {
		t.Fatalf("retry of a stranded escrow must heal, not be re-gated: %v", err)
	}
	if healed == nil {
		t.Fatal("retry returned no order")
	}
	// And it healed without charging the customer twice.
	if n := escrowLegs(t, ctx, pool, idem); n != escrowLegsPosted {
		t.Errorf("escrow legs after the healing retry = %d, want %d (no second debit)", n, escrowLegsPosted)
	}
	after, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	if after != afterEscrow {
		t.Errorf("balance moved on the healing retry: %d -> %d", afterEscrow, after)
	}
}

// TestLiveDB_OrderRequiresIdempotencyKey: the service refuses an empty Idempotency-Key
// rather than resolving it against the globally-unique ”-keyed order row.
func TestLiveDB_OrderRequiresIdempotencyKey(t *testing.T) {
	pool := tierPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, _, restID, item, customer := tierGateFixture(t, ctx, pool, "No Idem Kitchen", 200_000, 10_000_000)
	seedKYCTier(t, ctx, pool, customer, 3)

	if _, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
	}); !errors.Is(err, ErrOrderMissingIdem) {
		t.Fatalf("err = %v, want ErrOrderMissingIdem", err)
	}
}

// TestLiveDB_OrderIdempotencyKeyIsCustomerScoped: Idempotency-Keys are client-chosen, so
// replaying someone else's key must NOT hand back their order. The stranger's request is
// refused and, because the escrow dedups on the same key, moves no money either way.
func TestLiveDB_OrderIdempotencyKeyIsCustomerScoped(t *testing.T) {
	pool := tierPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, led, restID, item, victim := tierGateFixture(t, ctx, pool, "Scoped Key Kitchen", 200_000, 10_000_000)
	seedKYCTier(t, ctx, pool, victim, 3)

	idem := "tier-scoped-" + uuid.New().String()
	req := PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  idem,
	}
	victimOrder, err := svc.PlaceOrder(ctx, restID, victim, req)
	if err != nil {
		t.Fatalf("victim order: %v", err)
	}

	stranger := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, stranger, stranger+"@seed.test"); err != nil {
		t.Fatalf("seed stranger: %v", err)
	}
	seedKYCTier(t, ctx, pool, stranger, 3)
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, stranger, "seed-fund", "scopedfund-"+stranger, revAcc.ID, 10_000_000); err != nil {
		t.Fatalf("fund stranger: %v", err)
	}
	before, err := led.GetBalance(ctx, stranger)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	got, err := svc.PlaceOrder(ctx, restID, stranger, req)
	if err == nil {
		t.Fatalf("replaying another customer's Idempotency-Key must not resolve to their order (got order %s, victim's is %s)",
			got.ID, victimOrder.ID)
	}
	after, err := led.GetBalance(ctx, stranger)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	if after != before {
		t.Errorf("stranger's balance moved on a colliding key: %d -> %d", before, after)
	}
}

// TestLiveDB_GroupOrderEscrowTierGate: FinalizeGroupOrder escrows through PlaceOrder, so
// it inherits the same gate — a host over their cap cannot use a group cart to route
// around it, and the group is re-opened rather than wedged in `locked`.
func TestLiveDB_GroupOrderEscrowTierGate(t *testing.T) {
	pool := tierPool(t)
	defer pool.Close()
	ctx := context.Background()

	// One ₦60,000 item — over Tier 1's ₦50,000/day cap on its own.
	svc, led, restID, item, host := tierGateFixture(t, ctx, pool, "Group Gate Kitchen", 6_000_000, 50_000_000)
	seedKYCTier(t, ctx, pool, host, 1)

	g, err := svc.CreateGroupOrder(ctx, host, restID, 0)
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	if _, err := svc.AddGroupItem(ctx, g.ID, host, item.ID, 1); err != nil {
		t.Fatalf("add group item: %v", err)
	}

	before, err := led.GetBalance(ctx, host)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	idem := "tier-group-" + uuid.New().String()
	_, err = svc.FinalizeGroupOrder(ctx, g.ID, host, PlaceOrderRequest{
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  idem,
	})
	if !errors.Is(err, tiers.ErrDailyLimitExceeded) {
		t.Fatalf("over-cap group finalize err = %v, want tiers.ErrDailyLimitExceeded", err)
	}
	assertNothingWritten(t, ctx, pool, led, host, idem, before)

	// The group is re-opened on a failed finalize, so the host can shrink the cart
	// and retry rather than being stuck in `locked` forever.
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM group_orders WHERE id=$1`, g.ID).Scan(&status); err != nil {
		t.Fatalf("read group status: %v", err)
	}
	if status != "open" {
		t.Errorf("group status after a gate-refused finalize = %q, want \"open\"", status)
	}
}
