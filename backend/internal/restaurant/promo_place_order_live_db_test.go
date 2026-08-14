package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for the promo discount on the food-delivery money
// path: a code supplied to PlaceOrder must actually DISCOUNT the escrow, be
// PERSISTED on the order (discount_kobo / promo_id / promo_funder), RECORD a
// redemption so usage limits are enforceable, and be charged at settlement to
// whichever party funded it — with conservation intact (escrow released ==
// provider + platform + rider legs).
//
// Regression guard: PlaceOrder never called resolvePromo, so req.PromoCode was
// silently dropped. The customer paid full price, discount_kobo/promo_id/
// promo_funder stayed 0/NULL, no redemption was ever written (making
// usage_limit / per_user_limit unenforceable), and an invalid code was ignored
// instead of failing the order.
//
// Skipped unless TEST_DATABASE_URL/DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
)

func promoOrderPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB promo order test")
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

// promoOrderFixture seeds a restaurant with one priced item and a funded customer.
type promoOrderFixture struct {
	svc      *Service
	led      *ledger.Service
	pool     *pgxpool.Pool
	owner    string
	customer string
	rider    string
	restID   string
	itemID   string
}

func newPromoOrderFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, name string, priceKobo int64) promoOrderFixture {
	t.Helper()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led).WithTiers(tiers.NewService(pool))

	f := promoOrderFixture{svc: svc, led: led, pool: pool,
		owner: uuid.New().String(), customer: uuid.New().String(), rider: uuid.New().String()}
	for _, u := range []string{f.owner, f.customer, f.rider} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	f.restID = uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,$3,'1 St',TRUE)`, f.restID, f.owner, name); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	cat, err := svc.CreateCategory(ctx, f.restID, f.owner, "Mains")
	if err != nil {
		t.Fatalf("category: %v", err)
	}
	item, err := svc.CreateItem(ctx, f.restID, f.owner, CreateItemRequest{CategoryID: cat.ID, Name: "Jollof", PriceKobo: priceKobo})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	f.itemID = item.ID

	// PlaceOrder's escrow is tier-gated fail-closed (ADR-033), so the paying customer
	// needs a KYC tier. Tier 3 is unlimited — these tests are about the promo, not the cap.
	seedKYCTier(t, ctx, pool, f.customer, 3)

	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, f.customer, "seed-fund", "promofund-"+f.customer, revAcc.ID, 10_000_000); err != nil {
		t.Fatalf("fund customer: %v", err)
	}
	return f
}

// seedPromo inserts a promo directly so a PLATFORM-funded one can be exercised
// (CreatePromo deliberately forces funder='restaurant' for owner-created codes).
func seedPromo(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restID, code string,
	funder PromoFunder, kind PromoKind, valueBp int, amountKobo int64, usageLimit, perUserLimit *int) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurant_promos (id, restaurant_id, code, funder, kind, value_bp, amount_kobo, usage_limit, per_user_limit, active)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)`,
		id, restID, code, string(funder), string(kind), valueBp, amountKobo, usageLimit, perUserLimit); err != nil {
		t.Fatalf("seed promo %s: %v", code, err)
	}
	return id
}

// legs reads the three settlement credit legs posted for an order.
func legs(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID string) (provider, platform, rider int64) {
	t.Helper()
	ref := "settle:order:" + orderID
	return creditLegKobo(t, ctx, pool, ref+":provider"),
		creditLegKobo(t, ctx, pool, ref+":commission"),
		creditLegKobo(t, ctx, pool, ref+":rider")
}

// deliverWithRider drives the order to `delivered` through the real handoff gate.
func deliverWithRider(t *testing.T, ctx context.Context, f promoOrderFixture, orderID string) {
	t.Helper()
	if _, err := f.pool.Exec(ctx,
		`UPDATE orders SET rider_id=$2, status='picked_up', dispatch_status='assigned', delivery_code='4321' WHERE id=$1`,
		orderID, f.rider); err != nil {
		t.Fatalf("assign rider: %v", err)
	}
	if err := f.svc.ConfirmHandoff(ctx, orderID, f.rider, "4321"); err != nil {
		t.Fatalf("confirm handoff: %v", err)
	}
}

// TestLiveDB_OrderPromoRestaurantFunded: a restaurant-funded percent promo discounts
// what the customer is charged, and the discount comes ENTIRELY out of the restaurant's
// settled share — the platform and the rider are paid on the full pre-discount gross.
func TestLiveDB_OrderPromoRestaurantFunded(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Promo Kitchen", 450_000)

	promo, err := f.svc.CreatePromo(ctx, f.restID, f.owner, CreatePromoRequest{
		Code: "TENOFF-" + uuid.New().String()[:8], Kind: PromoPercent, ValueBp: 1000, // 10% off the items
	})
	if err != nil {
		t.Fatalf("create promo: %v", err)
	}

	// No delivery coords → the flat DeliveryFeeKobo applies, so the arithmetic is exact.
	subtotal := int64(2) * 450_000
	gross := subtotal + DeliveryFeeKobo // what the 80/10/10 percentages price
	wantDiscount := subtotal / 10
	wantTotal := gross - wantDiscount

	balBefore, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 2}},
		DeliveryAddress: "Victoria Island",
		PromoCode:       promo.Code,
		IdempotencyKey:  "promo-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place discounted order: %v", err)
	}

	// --- The returned order carries the discount + its provenance. ---
	if order.DiscountKobo != wantDiscount {
		t.Errorf("returned discount_kobo = %d, want %d (the promo code was dropped)", order.DiscountKobo, wantDiscount)
	}
	if order.TotalKobo != wantTotal {
		t.Errorf("returned total = %d, want %d (gross %d − discount %d)", order.TotalKobo, wantTotal, gross, wantDiscount)
	}
	if order.PromoID == nil || *order.PromoID != promo.ID {
		t.Errorf("returned promo_id = %v, want %s", order.PromoID, promo.ID)
	}
	if order.PromoFunder == nil || *order.PromoFunder != string(FunderRestaurant) {
		t.Errorf("returned promo_funder = %v, want restaurant", order.PromoFunder)
	}

	// --- Persisted on the order row (all three columns were always 0/NULL before). ---
	var dbDiscount, dbTotal int64
	var dbPromoID, dbFunder *string
	if err := pool.QueryRow(ctx,
		`SELECT discount_kobo, promo_id::text, promo_funder, total_kobo FROM orders WHERE id=$1`, order.ID).
		Scan(&dbDiscount, &dbPromoID, &dbFunder, &dbTotal); err != nil {
		t.Fatalf("read order row: %v", err)
	}
	if dbDiscount != wantDiscount {
		t.Errorf("persisted discount_kobo = %d, want %d", dbDiscount, wantDiscount)
	}
	if dbPromoID == nil || *dbPromoID != promo.ID {
		t.Errorf("persisted promo_id = %v, want %s", dbPromoID, promo.ID)
	}
	if dbFunder == nil || *dbFunder != string(FunderRestaurant) {
		t.Errorf("persisted promo_funder = %v, want restaurant", dbFunder)
	}
	if dbTotal != wantTotal {
		t.Errorf("persisted total_kobo = %d, want %d", dbTotal, wantTotal)
	}

	// --- The customer was actually charged the DISCOUNTED amount, no more. ---
	var debited int64
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE reference=$1 AND type='DEBIT'`,
		"escrow:order:"+order.ID).Scan(&debited); err != nil {
		t.Fatalf("read escrow debit: %v", err)
	}
	if debited != wantTotal {
		t.Errorf("customer debited %d, want %d — the discount must reduce what is charged", debited, wantTotal)
	}
	balAfter, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if balBefore-balAfter != wantTotal {
		t.Errorf("customer paid %d, want %d", balBefore-balAfter, wantTotal)
	}
	var escrowedTotal int64
	if err := pool.QueryRow(ctx, `SELECT total_kobo FROM settlements WHERE id=$1`, order.SettlementID).Scan(&escrowedTotal); err != nil {
		t.Fatalf("read settlement: %v", err)
	}
	if escrowedTotal != wantTotal {
		t.Errorf("escrowed total = %d, want the discounted %d", escrowedTotal, wantTotal)
	}

	// --- A redemption was recorded: this is what makes usage limits enforceable. ---
	var redeemedDiscount int64
	var redeemedUser string
	if err := pool.QueryRow(ctx,
		`SELECT discount_kobo, user_id::text FROM restaurant_promo_redemptions WHERE order_id=$1`, order.ID).
		Scan(&redeemedDiscount, &redeemedUser); err != nil {
		t.Fatalf("read redemption (none was written — usage limits cannot be enforced): %v", err)
	}
	if redeemedDiscount != wantDiscount || redeemedUser != f.customer {
		t.Errorf("redemption = (%d, %s), want (%d, %s)", redeemedDiscount, redeemedUser, wantDiscount, f.customer)
	}

	// --- Settlement: the RESTAURANT funds the discount; platform + rider are unaffected. ---
	deliverWithRider(t, ctx, f, order.ID)

	wantPlatform := int64(float64(gross) * splitPlatformPct)
	wantRider := int64(float64(gross) * splitRiderPct)
	wantProvider := wantTotal - wantPlatform - wantRider

	gotProvider, gotPlatform, gotRider := legs(t, ctx, pool, order.ID)
	if gotPlatform != wantPlatform {
		t.Errorf("platform leg = %d, want %d (10%% of the PRE-discount gross %d)", gotPlatform, wantPlatform, gross)
	}
	if gotRider != wantRider {
		t.Errorf("rider leg = %d, want %d — the rider never funds a discount", gotRider, wantRider)
	}
	if gotProvider != wantProvider {
		t.Errorf("provider leg = %d, want %d — the restaurant must bear the whole %d discount", gotProvider, wantProvider, wantDiscount)
	}
	// The restaurant is exactly the discount worse off than an undiscounted order.
	if undiscounted := gross - wantPlatform - wantRider; undiscounted-gotProvider != wantDiscount {
		t.Errorf("restaurant bore %d of the discount, want the full %d", undiscounted-gotProvider, wantDiscount)
	}
	// Conservation: everything escrowed is released, nothing minted.
	if sum := gotProvider + gotPlatform + gotRider; sum != escrowedTotal {
		t.Errorf("settlement legs sum to %d, want the escrowed total %d", sum, escrowedTotal)
	}
	var settledStatus string
	var settledProvider, settledFee int64
	if err := pool.QueryRow(ctx,
		`SELECT status, provider_kobo, fee_kobo FROM settlements WHERE id=$1`, order.SettlementID).
		Scan(&settledStatus, &settledProvider, &settledFee); err != nil {
		t.Fatalf("read settled row: %v", err)
	}
	if settledStatus != "settled" || settledProvider != wantProvider || settledFee != wantPlatform {
		t.Errorf("settlement row = (%s, provider=%d, fee=%d), want (settled, %d, %d)",
			settledStatus, settledProvider, settledFee, wantProvider, wantPlatform)
	}
}

// TestLiveDB_OrderPromoPlatformFunded: a platform-funded promo comes out of the
// PLATFORM's leg — the restaurant and the rider settle on the full pre-discount gross,
// exactly as if the customer had paid full price.
func TestLiveDB_OrderPromoPlatformFunded(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Platform Promo Kitchen", 450_000)

	code := "PLATFORM-" + uuid.New().String()[:8]
	seedPromo(t, ctx, pool, f.restID, code, FunderPlatform, PromoPercent, 1000, 0, nil, nil)

	subtotal := int64(2) * 450_000
	gross := subtotal + DeliveryFeeKobo
	wantDiscount := subtotal / 10
	wantTotal := gross - wantDiscount

	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 2}},
		DeliveryAddress: "Victoria Island",
		PromoCode:       code,
		IdempotencyKey:  "promoplat-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place platform-funded order: %v", err)
	}
	if order.DiscountKobo != wantDiscount || order.TotalKobo != wantTotal {
		t.Fatalf("order discount=%d total=%d, want %d/%d", order.DiscountKobo, order.TotalKobo, wantDiscount, wantTotal)
	}

	deliverWithRider(t, ctx, f, order.ID)

	wantRider := int64(float64(gross) * splitRiderPct)
	wantPlatform := int64(float64(gross)*splitPlatformPct) - wantDiscount
	wantProvider := wantTotal - wantPlatform - wantRider

	gotProvider, gotPlatform, gotRider := legs(t, ctx, pool, order.ID)
	if gotPlatform != wantPlatform {
		t.Errorf("platform leg = %d, want %d (its 10%% of %d LESS the %d it funded)", gotPlatform, wantPlatform, gross, wantDiscount)
	}
	if gotRider != wantRider {
		t.Errorf("rider leg = %d, want %d — unaffected by a platform-funded discount", gotRider, wantRider)
	}
	// The restaurant is paid as though nothing was discounted.
	if undiscounted := gross - int64(float64(gross)*splitPlatformPct) - wantRider; gotProvider != undiscounted {
		t.Errorf("provider leg = %d, want %d — the restaurant must NOT fund a platform promo", gotProvider, undiscounted)
	}
	if gotProvider != wantProvider {
		t.Errorf("provider leg = %d, want %d", gotProvider, wantProvider)
	}
	if sum := gotProvider + gotPlatform + gotRider; sum != wantTotal {
		t.Errorf("settlement legs sum to %d, want the escrowed total %d", sum, wantTotal)
	}
}

// TestLiveDB_OrderPromoUnfundableRejectedBeforeEscrow: a discount larger than the
// funder's own settlement leg is rejected AT PLACEMENT. Escrowing it would create an
// order that can never settle (Settle fails closed on a negative leg), stranding the
// customer's money in escrow forever.
func TestLiveDB_OrderPromoUnfundableRejectedBeforeEscrow(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Unfundable Promo Kitchen", 450_000)

	// 20% off the items, funded by the platform — whose leg is only 10% of the gross.
	code := "TOOBIG-" + uuid.New().String()[:8]
	seedPromo(t, ctx, pool, f.restID, code, FunderPlatform, PromoPercent, 2000, 0, nil, nil)

	before, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}
	_, err = f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 2}},
		DeliveryAddress: "Victoria Island",
		PromoCode:       code,
		IdempotencyKey:  "promobig-" + uuid.New().String(),
	})
	if err == nil {
		t.Fatal("a discount exceeding the funder's settlement leg must be rejected before escrow")
	}
	if !errors.Is(err, ErrPromoInvalid) {
		t.Errorf("error = %v, want it to wrap ErrPromoInvalid (so the handler answers 422, not 500)", err)
	}
	after, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if after != before {
		t.Errorf("customer balance moved by %d on a rejected order — nothing may be escrowed", before-after)
	}
}

// TestLiveDB_OrderInvalidPromoFailsOrder: an unusable code FAILS the order rather than
// being silently ignored — the customer must never be charged full price for an order
// they submitted with a discount code.
func TestLiveDB_OrderInvalidPromoFailsOrder(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Invalid Promo Kitchen", 450_000)

	before, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}
	_, err = f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		PromoCode:       "NO-SUCH-CODE-" + uuid.New().String()[:8],
		IdempotencyKey:  "promobad-" + uuid.New().String(),
	})
	if err == nil {
		t.Fatal("an unknown promo code must fail the order, not be silently ignored")
	}
	if !errors.Is(err, ErrPromoInvalid) {
		t.Errorf("error = %v, want it to wrap ErrPromoInvalid", err)
	}
	after, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if after != before {
		t.Errorf("customer was charged %d on a rejected order", before-after)
	}

	// An INACTIVE code fails the same way (it exists, but cannot be applied).
	code := "DEAD-" + uuid.New().String()[:8]
	seedPromo(t, ctx, pool, f.restID, code, FunderRestaurant, PromoPercent, 500, 0, nil, nil)
	if _, err := pool.Exec(ctx, `UPDATE restaurant_promos SET active=FALSE WHERE lower(code)=lower($1)`, code); err != nil {
		t.Fatalf("deactivate promo: %v", err)
	}
	if _, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		PromoCode:       code,
		IdempotencyKey:  "promodead-" + uuid.New().String(),
	}); !errors.Is(err, ErrPromoInvalid) {
		t.Errorf("inactive promo error = %v, want ErrPromoInvalid", err)
	}
}

// TestLiveDB_OrderPromoUsageLimitEnforced: because PlaceOrder now records a redemption,
// usage_limit and per_user_limit actually bite on the SECOND order. Before the fix no
// redemption row was ever written, so every limit was unenforceable.
func TestLiveDB_OrderPromoUsageLimitEnforced(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Limited Promo Kitchen", 450_000)

	one := 1
	code := "ONCE-" + uuid.New().String()[:8]
	promoID := seedPromo(t, ctx, pool, f.restID, code, FunderRestaurant, PromoFixed, 0, 40_000, &one, nil)

	first, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		PromoCode:       code,
		IdempotencyKey:  "promolim1-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("first redemption must succeed: %v", err)
	}
	if first.DiscountKobo != 40_000 {
		t.Errorf("first order discount = %d, want 40000", first.DiscountKobo)
	}
	var redemptions int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_promo_redemptions WHERE promo_id=$1`, promoID).Scan(&redemptions); err != nil {
		t.Fatalf("count redemptions: %v", err)
	}
	if redemptions != 1 {
		t.Fatalf("redemption count = %d, want 1", redemptions)
	}

	// usage_limit=1 is now reached → the second order is refused outright.
	if _, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		PromoCode:       code,
		IdempotencyKey:  "promolim2-" + uuid.New().String(),
	}); !errors.Is(err, ErrPromoInvalid) {
		t.Errorf("second use of a usage_limit=1 promo: err = %v, want ErrPromoInvalid", err)
	}
}

// TestLiveDB_OrderPromoIdempotentReplay: replaying PlaceOrder on the same
// Idempotency-Key returns the same order and does NOT burn a second redemption —
// otherwise a client retry would silently consume the customer's per-user allowance.
func TestLiveDB_OrderPromoIdempotentReplay(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Replay Promo Kitchen", 450_000)

	code := "REPLAY-" + uuid.New().String()[:8]
	promoID := seedPromo(t, ctx, pool, f.restID, code, FunderRestaurant, PromoFixed, 0, 30_000, nil, nil)

	req := PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		PromoCode:       code,
		IdempotencyKey:  "promoreplay-" + uuid.New().String(),
	}
	first, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, req)
	if err != nil {
		t.Fatalf("first place: %v", err)
	}
	replay, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, req)
	if err != nil {
		t.Fatalf("idempotent replay: %v", err)
	}
	if replay.ID != first.ID {
		t.Errorf("replay returned order %s, want the canonical %s", replay.ID, first.ID)
	}
	if replay.DiscountKobo != first.DiscountKobo {
		t.Errorf("replay discount = %d, want %d", replay.DiscountKobo, first.DiscountKobo)
	}
	var redemptions int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_promo_redemptions WHERE promo_id=$1`, promoID).Scan(&redemptions); err != nil {
		t.Fatalf("count redemptions: %v", err)
	}
	if redemptions != 1 {
		t.Errorf("redemption count after replay = %d, want 1 — a retry must not burn the allowance", redemptions)
	}
}

// TestLiveDB_OrderPromoReplayUnderPerUserLimit: the retry that the Idempotency-Key
// header exists to make safe. The first attempt commits a redemption; replaying the SAME
// key must return the canonical order, NOT fail its own per_user_limit with a 422 — a
// client that believes that 422 re-submits on a fresh key and is charged twice.
func TestLiveDB_OrderPromoReplayUnderPerUserLimit(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Retry Promo Kitchen", 450_000)

	one := 1
	code := "ONEPER-" + uuid.New().String()[:8]
	// per_user_limit=1 AND usage_limit=1 — the shape a replay used to trip on.
	seedPromo(t, ctx, pool, f.restID, code, FunderRestaurant, PromoFixed, 0, 30_000, &one, &one)

	req := PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		PromoCode:       code,
		IdempotencyKey:  "promoretry-" + uuid.New().String(),
	}
	before, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}
	first, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, req)
	if err != nil {
		t.Fatalf("first place: %v", err)
	}

	replay, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, req)
	if err != nil {
		t.Fatalf("replaying a limited promo on the same Idempotency-Key must return the canonical order, got: %v", err)
	}
	if replay.ID != first.ID {
		t.Errorf("replay returned order %s, want the canonical %s", replay.ID, first.ID)
	}
	if replay.DiscountKobo != first.DiscountKobo || replay.TotalKobo != first.TotalKobo {
		t.Errorf("replay (discount=%d total=%d) != first (discount=%d total=%d)",
			replay.DiscountKobo, replay.TotalKobo, first.DiscountKobo, first.TotalKobo)
	}
	// The customer was charged exactly once.
	after, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if before-after != first.TotalKobo {
		t.Errorf("customer paid %d across the retry, want a single charge of %d", before-after, first.TotalKobo)
	}
	var orders, redemptions int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM orders WHERE idempotency_key=$1`, req.IdempotencyKey).Scan(&orders); err != nil {
		t.Fatalf("count orders: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_promo_redemptions WHERE user_id=$1`, f.customer).Scan(&redemptions); err != nil {
		t.Fatalf("count redemptions: %v", err)
	}
	if orders != 1 || redemptions != 1 {
		t.Errorf("after replay: %d orders / %d redemptions, want 1 / 1", orders, redemptions)
	}
}

// TestLiveDB_OrderReplayIsScopedToTheCaller: the replay short-circuit must never hand a
// stranger's order to whoever supplies its Idempotency-Key. Keys are client-chosen and
// share one global namespace, and the order carries the delivery address and the
// delivery_code — the proof-of-delivery handoff secret.
func TestLiveDB_OrderReplayIsScopedToTheCaller(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Scoping Kitchen", 400_000)

	// A second, unrelated customer, funded so their own order would otherwise succeed.
	attacker := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, attacker, attacker+"@seed.test"); err != nil {
		t.Fatalf("seed attacker: %v", err)
	}
	revAcc, err := f.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := f.led.Credit(ctx, attacker, "seed-fund", "scopefund-"+attacker, revAcc.ID, 5_000_000); err != nil {
		t.Fatalf("fund attacker: %v", err)
	}

	key := "shared-key-" + uuid.New().String()
	victim, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "17 Victim Street, Ikoyi",
		IdempotencyKey:  key,
	})
	if err != nil {
		t.Fatalf("victim places order: %v", err)
	}

	// The attacker replays the victim's key. They must NOT receive the victim's order.
	got, err := f.svc.PlaceOrder(ctx, f.restID, attacker, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "1 Attacker Road",
		IdempotencyKey:  key,
	})
	if err == nil && got != nil && got.ID == victim.ID {
		t.Fatalf("another user's Idempotency-Key returned the victim's order %s (address %q) — the replay path must be scoped to the caller",
			got.ID, got.DeliveryAddress)
	}
	if got != nil && got.CustomerID != attacker {
		t.Errorf("returned an order belonging to %s, want only the caller's own", got.CustomerID)
	}
	// The victim's order is untouched either way.
	var owner string
	if err := pool.QueryRow(ctx, `SELECT customer_id::text FROM orders WHERE id=$1`, victim.ID).Scan(&owner); err != nil {
		t.Fatalf("re-read victim order: %v", err)
	}
	if owner != f.customer {
		t.Errorf("victim order now belongs to %s", owner)
	}
}

// TestLiveDB_OrderCancelCompletesAfterAPriorRefund: a crash between the escrow refund and
// the cancel commit must not wedge the order. Retrying has to finish closing it —
// otherwise the order stays advanceable and can be delivered to a customer who was
// already refunded in full, with nobody paid.
func TestLiveDB_OrderCancelCompletesAfterAPriorRefund(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Refund Retry Kitchen", 400_000)

	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "refundretry-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place: %v", err)
	}
	// Simulate the crash window: the escrow was refunded, the order never got closed.
	if err := f.svc.settlement.Refund(ctx, order.SettlementID, "simulated_crash"); err != nil {
		t.Fatalf("pre-refund: %v", err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, order.ID).Scan(&status); err != nil {
		t.Fatalf("read order: %v", err)
	}
	if status != string(OrderPending) {
		t.Fatalf("precondition: order status = %s, want pending", status)
	}

	balBefore, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance before retry: %v", err)
	}
	// The retry must converge, not error on "cannot refund — current status is refunded".
	if err := f.svc.CancelOrder(ctx, order.ID, f.customer); err != nil {
		t.Fatalf("cancel retry after a prior refund must succeed, got: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, order.ID).Scan(&status); err != nil {
		t.Fatalf("re-read order: %v", err)
	}
	if status != string(OrderCancelled) {
		t.Errorf("status = %s, want cancelled — a wedged order stays advanceable to delivered", status)
	}
	// And it did NOT refund a second time.
	balAfter, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance after retry: %v", err)
	}
	if balAfter != balBefore {
		t.Errorf("balance moved by %d on the retry — the refund must not be applied twice", balAfter-balBefore)
	}
}

// TestLiveDB_OrderPromoUsageLimitHoldsUnderConcurrency: N simultaneous placements of a
// usage_limit=1 code must yield exactly ONE redemption. The limit gates real money — a
// platform-funded code spends the platform's settlement leg on every redemption — so an
// unlocked read-then-insert would let all N through.
func TestLiveDB_OrderPromoUsageLimitHoldsUnderConcurrency(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Race Promo Kitchen", 450_000)

	one := 1
	code := "RACE-" + uuid.New().String()[:8]
	promoID := seedPromo(t, ctx, pool, f.restID, code, FunderRestaurant, PromoFixed, 0, 30_000, &one, nil)

	// Every racer gets a deadline, and the wait itself is bounded. A hang here used to
	// take the ENTIRE `go test ./...` binary down with it after 10 minutes — the failure
	// mode that made this suite red in CI while passing locally. Fail fast, and say what
	// was still in flight.
	raceCtx, cancelRace := context.WithTimeout(ctx, 60*time.Second)
	defer cancelRace()

	const racers = 8
	var wg sync.WaitGroup
	results := make([]error, racers)
	orders := make([]*Order, racers)
	start := make(chan struct{})
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start // release them together
			o, err := f.svc.PlaceOrder(raceCtx, f.restID, f.customer, PlaceOrderRequest{
				Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
				DeliveryAddress: "Victoria Island",
				PromoCode:       code,
				IdempotencyKey:  fmt.Sprintf("promorace-%d-%s", i, uuid.New().String()),
			})
			results[i], orders[i] = err, o
		}(i)
	}
	close(start)
	finished := make(chan struct{})
	go func() { wg.Wait(); close(finished) }()
	select {
	case <-finished:
	case <-time.After(75 * time.Second):
		t.Fatalf("concurrent PlaceOrder calls did not all return within 75s — the order path deadlocked. " +
			"Most likely a pool-connection starvation: PlaceOrder must never hold a transaction open across " +
			"settlement.Escrow, which acquires a second connection of its own.")
	}

	var succeeded int
	for i, err := range results {
		if err == nil {
			succeeded++
			continue
		}
		if !errors.Is(err, ErrPromoInvalid) {
			t.Errorf("racer %d failed with %v, want ErrPromoInvalid (a loser must be a clean 422)", i, err)
		}
	}
	if succeeded != 1 {
		t.Errorf("%d of %d concurrent placements redeemed a usage_limit=1 promo, want exactly 1", succeeded, racers)
	}
	var redemptions int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_promo_redemptions WHERE promo_id=$1`, promoID).Scan(&redemptions); err != nil {
		t.Fatalf("count redemptions: %v", err)
	}
	if redemptions != 1 {
		t.Errorf("redemption count = %d, want 1 — the usage limit did not hold under concurrency", redemptions)
	}
	// A rejected racer must have escrowed nothing: the limit is checked before the debit.
	for i, o := range orders {
		if results[i] == nil {
			continue
		}
		if o != nil {
			t.Errorf("racer %d returned an order despite failing", i)
		}
	}
	var escrowRows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM settlements WHERE payer_id=$1 AND module_type='food_delivery'`, f.customer).Scan(&escrowRows); err != nil {
		t.Fatalf("count settlements: %v", err)
	}
	if escrowRows != 1 {
		t.Errorf("%d escrows created, want 1 — a promo loser must be rejected before any money moves", escrowRows)
	}
}

// TestLiveDB_PromoReservationSerializesUnderContention races the critical section
// DIRECTLY, with nothing in front of it.
//
// This exists because the end-to-end PlaceOrder race is NOT a sufficient guard: the work
// before the reservation (restaurant lookup, menu reads, delivery pricing) staggers the
// goroutines enough that they stop genuinely overlapping, and the test then passes even
// with the `FOR UPDATE` removed. A count-and-compare at READ COMMITTED is not a
// constraint — each transaction sees only rows committed before it started, plus its
// own, so N concurrent reservations can all read "0 redeemed" and all insert. The row
// lock is the only thing making the limit real, and this test fails without it.
func TestLiveDB_PromoReservationSerializesUnderContention(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Reservation Race Kitchen", 400_000)

	one := 1
	code := "TIGHTRACE-" + uuid.New().String()[:8]
	promoID := seedPromo(t, ctx, pool, f.restID, code, FunderRestaurant, PromoFixed, 0, 30_000, &one, nil)

	// Simulate a concurrent redeemer that is mid-reservation, deterministically — two
	// goroutines racing does NOT work here: on a fast local DB they reliably fail to
	// overlap, and such a test passes even with the lock removed (verified).
	//
	// FOR KEY SHARE is precisely the lock a redemption INSERT takes on its parent promo
	// row via the foreign key, so this holder is exactly what a concurrent reservation
	// looks like from the DB's point of view. Getting this right matters: a FOR UPDATE
	// holder would block the service's INSERT through that same foreign key whether or
	// not the service takes its own lock, so it cannot tell the two apart.
	holder, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin holder tx: %v", err)
	}
	defer holder.Rollback(ctx)
	if _, err := holder.Exec(ctx, `SELECT id FROM restaurant_promos WHERE id=$1 FOR KEY SHARE`, promoID); err != nil {
		t.Fatalf("hold promo lock: %v", err)
	}

	// The service's reservation must BLOCK on that lock. If it sails past and inserts,
	// its count was taken against a snapshot that cannot see the in-flight redeemer —
	// which is precisely how N concurrent orders all redeem a usage_limit=1 code.
	callCtx, cancelCall := context.WithTimeout(ctx, 30*time.Second)
	defer cancelCall()
	done := make(chan error, 1)
	go func() {
		done <- f.svc.reservePromoRedemption(callCtx, promoID, uuid.New().String(), f.customer, 30_000)
	}()

	select {
	case err := <-done:
		t.Fatalf("reservePromoRedemption returned (err=%v) while another transaction held the promo row lock — "+
			"it is not taking the lock, so its count-and-compare is not a constraint at READ COMMITTED", err)
	case <-time.After(2 * time.Second):
		// Correctly blocked. Release the lock and let it proceed.
	}
	if err := holder.Rollback(ctx); err != nil {
		t.Fatalf("release holder lock: %v", err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("reservation after the lock was released: %v", err)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("reservation never completed after the promo lock was released")
	}

	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_promo_redemptions WHERE promo_id=$1`, promoID).Scan(&rows); err != nil {
		t.Fatalf("count redemptions: %v", err)
	}
	if rows != 1 {
		t.Errorf("redemption rows = %d, want 1", rows)
	}
}

// TestLiveDB_OrderPromoRedemptionReleasedOnCancel: cancelling a discounted order returns
// the redemption. Otherwise anyone can kill a single-use campaign for free — place with
// the code, cancel for a full refund, and the cap stays burned forever.
func TestLiveDB_OrderPromoRedemptionReleasedOnCancel(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Release Promo Kitchen", 300_000)

	one := 1
	code := "RELEASE-" + uuid.New().String()[:8]
	promoID := seedPromo(t, ctx, pool, f.restID, code, FunderRestaurant, PromoFixed, 0, 25_000, &one, nil)

	first, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		PromoCode:       code,
		IdempotencyKey:  "promorelease1-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place: %v", err)
	}
	if err := f.svc.UpdateStatus(ctx, first.ID, f.customer, OrderCancelled); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	var redemptions int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_promo_redemptions WHERE promo_id=$1`, promoID).Scan(&redemptions); err != nil {
		t.Fatalf("count redemptions: %v", err)
	}
	if redemptions != 0 {
		t.Errorf("redemptions after cancel = %d, want 0 — a fully refunded order never consumed the code", redemptions)
	}
	// The campaign is still alive: the code can be used again.
	second, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		PromoCode:       code,
		IdempotencyKey:  "promorelease2-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("a cancelled order must not burn a usage_limit=1 campaign: %v", err)
	}
	if second.DiscountKobo != 25_000 {
		t.Errorf("second order discount = %d, want 25000", second.DiscountKobo)
	}
}

// TestLiveDB_OrderPromoRefundReturnsExactlyWhatWasCharged: cancelling a discounted
// order returns the DISCOUNTED total — the customer is made whole, and the refund
// never hands back money that was never collected.
func TestLiveDB_OrderPromoRefundedOnCancel(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Refund Promo Kitchen", 300_000)

	code := "REFUND-" + uuid.New().String()[:8]
	seedPromo(t, ctx, pool, f.restID, code, FunderRestaurant, PromoFixed, 0, 25_000, nil, nil)

	before, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}
	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		PromoCode:       code,
		IdempotencyKey:  "promorefund-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place discounted order: %v", err)
	}
	if order.DiscountKobo != 25_000 {
		t.Fatalf("discount = %d, want 25000", order.DiscountKobo)
	}
	if err := f.svc.UpdateStatus(ctx, order.ID, f.customer, OrderCancelled); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	after, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if after != before {
		t.Errorf("balance after cancel = %d, want %d (off by %d) — the refund must return exactly the discounted total",
			after, before, before-after)
	}
}

// TestLiveDB_OrderPromoDroppedWhenEscrowDiverges: settleOrder honors the discount only
// when the escrow covers the order it belongs to. If they diverge, the discount leg is
// dropped rather than reconstructing a gross that was never collected — and the escrow
// still fully releases.
func TestLiveDB_OrderPromoDroppedWhenEscrowDiverges(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Divergent Promo Kitchen", 400_000)

	code := "DIVERGE-" + uuid.New().String()[:8]
	seedPromo(t, ctx, pool, f.restID, code, FunderRestaurant, PromoFixed, 0, 50_000, nil, nil)

	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		PromoCode:       code,
		IdempotencyKey:  "promodiv-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place discounted order: %v", err)
	}
	// Simulate the divergence: the escrow row holds LESS than the order claims.
	escrowed := order.TotalKobo - 10_000
	if _, err := pool.Exec(ctx, `UPDATE settlements SET total_kobo=$2 WHERE id=$1`, order.SettlementID, escrowed); err != nil {
		t.Fatalf("diverge escrow: %v", err)
	}
	deliverWithRider(t, ctx, f, order.ID)

	gotProvider, gotPlatform, gotRider := legs(t, ctx, pool, order.ID)
	// Discount dropped ⇒ the bare percentages price the escrowed total itself.
	if want := int64(float64(escrowed) * splitPlatformPct); gotPlatform != want {
		t.Errorf("platform leg = %d, want %d — a discount the escrow does not corroborate must be dropped", gotPlatform, want)
	}
	if sum := gotProvider + gotPlatform + gotRider; sum != escrowed {
		t.Errorf("legs sum to %d, want the escrowed %d — the escrow must still fully release", sum, escrowed)
	}
}
