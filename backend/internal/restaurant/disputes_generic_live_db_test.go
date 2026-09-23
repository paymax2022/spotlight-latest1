package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for FOOD-004: the generic finance/disputes admin-resolve
// endpoint (POST /api/finance/admin/disputes/:id/resolve) used to bare-flip the shared
// disputes.status column for EVERY module_type, including "food" — so resolving a
// food dispute with resolution=refunded and a refund_kobo amount returned 200 and
// moved ZERO money, never touching this module's real refund-cap (ADR-031) + rider
// tip-clawback logic in AdminResolveFoodDispute.
//
// This test drives the fix through the SAME entrypoint the frontend actually calls —
// disputes.Service.Resolve (the generic path), not restaurant.Service directly — with
// restaurant.Service wired in as its FoodDisputeResolver exactly as
// internal/app/finance_routes.go wires it in production. It proves:
//   - the ORIGINAL bug (documented above) reproduces when no resolver is wired: a
//     food dispute resolved as "refunded" fails closed rather than a fake 200 (this
//     package's own regression guard against ever going back to a silent no-op);
//   - with the resolver wired, a plain {resolution:"refunded", refund_kobo} through
//     the generic Resolve() posts a real, correctly-capped (non-tip basis) ledger
//     reversal;
//   - a full-refund case where the rider was already paid the tip triggers the real
//     tip clawback;
//   - "dismissed" still resolves with zero money movement.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"fmt"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/disputes"
	"spotlight/backend/internal/finance/ledger"

	"spotlight/backend/internal/testsupport"
)

// genericFoodResolverAdapter mirrors internal/app's foodDisputeResolverAdapter
// (finance_routes.go) so this test exercises the exact seam production wiring uses,
// without importing package app (which would be a layering inversion — app depends on
// restaurant, not the reverse).
type genericFoodResolverAdapter struct{ svc *Service }

func (a genericFoodResolverAdapter) ResolveGenericDispute(ctx context.Context, disputeID, adminID, resolution string, refundKobo int64, note string) error {
	_, err := a.svc.ResolveGenericDispute(ctx, disputeID, adminID, resolution, refundKobo, note)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, ErrForbidden):
		return fmt.Errorf("%w: %s", disputes.ErrDisputeForbidden, err)
	case errors.Is(err, ErrDisputeInvalid):
		return fmt.Errorf("%w: %s", disputes.ErrDisputeNotResolvable, err)
	default:
		return err
	}
}

// TestLiveDB_GenericDisputeResolve_FoodDelegatesToRealRefundLogic is the FOOD-004
// regression test: the generic disputes.Service.Resolve, wired with the real
// restaurant resolver, must produce a real capped refund + tip clawback for a food
// dispute — not a bare status flip.
func TestLiveDB_GenericDisputeResolve_FoodDelegatesToRealRefundLogic(t *testing.T) {
	pool := tipPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	const tip int64 = 50_000
	f := newDisputeTipFixture(t, ctx, pool, led, "Generic Dispute Kitchen", tip)

	admin := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, admin, admin+"@seed.test"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	testsupport.CleanupUser(t, pool, admin)

	// See dispute_tip_live_db_test.go's disputeRefundDebitKobo doc comment: reads
	// THIS dispute's own ledger entry by idempotency key rather than a shared
	// standing-account balance snapshot, which races against unrelated concurrent
	// postings from other packages' live-DB tests under `go test ./...`.
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("revenue account: %v", err)
	}

	// --- Reproduce the ORIGINAL bug first: no resolver wired ⇒ fails closed, moves
	// no money. This is what the bare-status-update version used to do WITHOUT even
	// the courtesy of an error (it returned 200 and moved zero kobo); failing closed
	// is the safe replacement for that silent no-op. ---
	unwired := disputes.NewService(pool)
	custBefore, err := led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("customer balance before: %v", err)
	}
	revBefore := disputeRefundDebitKobo(t, ctx, pool, revAcc.ID, f.disputeID)
	if err := unwired.Resolve(ctx, f.disputeID, disputes.ResolutionRefunded, "no resolver wired", f.total, admin); err == nil {
		t.Fatal("resolving a food dispute with no FoodDisputeResolver wired must fail closed, not silently succeed")
	}
	if custAfter, _ := led.GetBalance(ctx, f.customer); custAfter != custBefore {
		t.Fatalf("unwired resolve moved customer balance: %d → %d", custBefore, custAfter)
	}
	if rev := disputeRefundDebitKobo(t, ctx, pool, revAcc.ID, f.disputeID); rev != revBefore {
		t.Fatalf("unwired resolve moved platform revenue: %d → %d", revBefore, rev)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM disputes WHERE id=$1`, f.disputeID).Scan(&status); err != nil {
		t.Fatalf("read ticket: %v", err)
	}
	if status == "resolved" {
		t.Fatal("the ticket must NOT be marked resolved when the resolver failed closed")
	}

	// --- Now wire the real resolver (production wiring: WithFoodResolver) and drive
	// the SAME generic endpoint with a plain, frontend-shaped request: {resolution:
	// "refunded", refund_kobo}. No full/partial distinction — the console never sends
	// one. This is a FULL refund of the whole order, so it should trigger the tip
	// clawback exactly like the direct AdminResolveFoodDispute call does. ---
	wired := disputes.NewService(pool).WithFoodResolver(genericFoodResolverAdapter{svc: f.svc})

	custBeforeReal, err := led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("customer balance before real resolve: %v", err)
	}
	riderBefore, err := led.GetBalance(ctx, f.rider)
	if err != nil {
		t.Fatalf("rider balance before: %v", err)
	}

	// The customer's whole order total, submitted as a flat refund_kobo — exactly
	// what the frontend admin console sends (restaurantAdminService.ts resolveDispute).
	if err := wired.Resolve(ctx, f.disputeID, disputes.ResolutionRefunded, "upheld via generic endpoint", f.total, admin); err != nil {
		t.Fatalf("generic resolve with resolver wired: %v", err)
	}

	// --- A real, correctly-CAPPED (non-tip basis) platform refund landed. ---
	revDelta := disputeRefundDebitKobo(t, ctx, pool, revAcc.ID, f.disputeID)
	if revDelta != f.basis {
		t.Fatalf("platform revenue fell by %d, want %d (total %d − tip %d) — the generic path must "+
			"cap the refund to the non-tip basis exactly like the direct call", revDelta, f.basis, f.total, f.tip)
	}
	var storedRefund int64
	if err := pool.QueryRow(ctx,
		`SELECT refund_kobo FROM restaurant_dispute_refunds WHERE dispute_id=$1`, f.disputeID).Scan(&storedRefund); err != nil {
		t.Fatalf("read refund record: %v", err)
	}
	if storedRefund != f.basis {
		t.Fatalf("persisted refund_kobo = %d, want %d", storedRefund, f.basis)
	}

	// --- The tip was CLAWED BACK from the rider (already paid at settlement), not
	// funded by the platform. ---
	riderAfter, err := led.GetBalance(ctx, f.rider)
	if err != nil {
		t.Fatalf("rider balance after: %v", err)
	}
	if delta := riderBefore - riderAfter; delta != f.tip {
		t.Fatalf("rider wallet fell by %d, want %d — the generic path must still trigger the tip "+
			"clawback on a full refund", delta, f.tip)
	}
	var clawStatus string
	var clawTip int64
	if err := pool.QueryRow(ctx,
		`SELECT status, tip_kobo FROM restaurant_dispute_tip_clawbacks WHERE dispute_id=$1`, f.disputeID).
		Scan(&clawStatus, &clawTip); err != nil {
		t.Fatalf("read clawback record: %v", err)
	}
	if clawStatus != "recovered" || clawTip != f.tip {
		t.Fatalf("clawback = (%s, %d), want (recovered, %d)", clawStatus, clawTip, f.tip)
	}

	// --- The customer is made whole: basis from the platform + tip from the rider. ---
	custAfterReal, err := led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("customer balance after: %v", err)
	}
	if delta := custAfterReal - custBeforeReal; delta != f.total {
		t.Fatalf("customer credited %d, want the full %d (basis %d + tip %d)", delta, f.total, f.basis, f.tip)
	}

	// --- The ticket is now genuinely resolved. ---
	if err := pool.QueryRow(ctx, `SELECT status FROM disputes WHERE id=$1`, f.disputeID).Scan(&status); err != nil {
		t.Fatalf("read ticket: %v", err)
	}
	if status != "resolved" {
		t.Fatalf("ticket status = %s, want resolved", status)
	}
}

// TestLiveDB_GenericDisputeResolve_DismissedMovesNoMoney checks the OTHER branch of
// the generic vocabulary: "dismissed" (and by the same mapping, "settled") must
// resolve the ticket with zero money movement, same as before this fix — the
// dispatch only changes behavior for "refunded".
func TestLiveDB_GenericDisputeResolve_DismissedMovesNoMoney(t *testing.T) {
	pool := disputesLivePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	restSvc := NewService(pool, nil).WithLedger(led)

	owner := uuid.New().String()
	customer := uuid.New().String()
	admin := uuid.New().String()
	for _, u := range []string{owner, customer, admin} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Dismiss Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	orderID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status, idempotency_key, delivery_address)
		VALUES ($1,$2,$3,100000,100000,'delivered',$4,'1 Test Street')`,
		orderID, customer, restID, "gendisp-"+orderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	d, err := restSvc.RaiseFoodDispute(ctx, orderID, customer, "wrong_item",
		"received the wrong dish entirely, no drinks either")
	if err != nil {
		t.Fatalf("raise: %v", err)
	}

	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("revenue account: %v", err)
	}
	custBefore, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}
	revBefore := disputeRefundDebitKobo(t, ctx, pool, revAcc.ID, d.ID)

	wired := disputes.NewService(pool).WithFoodResolver(genericFoodResolverAdapter{svc: restSvc})
	if err := wired.Resolve(ctx, d.ID, disputes.ResolutionDismissed, "not upheld", 0, admin); err != nil {
		t.Fatalf("resolve dismissed: %v", err)
	}

	custAfter, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if custAfter != custBefore {
		t.Fatalf("dismissed resolution moved customer balance: %d → %d", custBefore, custAfter)
	}
	if rev := disputeRefundDebitKobo(t, ctx, pool, revAcc.ID, d.ID); rev != revBefore {
		t.Fatalf("dismissed resolution moved platform revenue: %d → %d", revBefore, rev)
	}
	var st string
	if err := pool.QueryRow(ctx, `SELECT status FROM disputes WHERE id=$1`, d.ID).Scan(&st); err != nil {
		t.Fatalf("read ticket: %v", err)
	}
	if st != "resolved" {
		t.Fatalf("ticket status = %s, want resolved", st)
	}
}

// TestLiveDB_GenericDisputeResolve_NonFoodModuleUnaffected is the "don't break other
// modules" guard: a dispute whose module_type is NOT "food" must still resolve via the
// original bare status-flip, completely unaffected by the food dispatch added for
// FOOD-004 — with or without a food resolver wired.
func TestLiveDB_GenericDisputeResolve_NonFoodModuleUnaffected(t *testing.T) {
	pool := disputesLivePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	reporter := uuid.New().String()
	admin := uuid.New().String()
	for _, u := range []string{reporter, admin} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}

	svc := disputes.NewService(pool).WithFoodResolver(genericFoodResolverAdapter{svc: NewService(pool, nil)})
	d, err := svc.Open(ctx, reporter, disputes.OpenRequest{
		Reference:   "txn-" + uuid.New().String(),
		ModuleType:  "wallet",
		Type:        disputes.TypeFailedPayment,
		Description: "payment was deducted but never credited to the recipient",
	})
	if err != nil {
		t.Fatalf("open wallet dispute: %v", err)
	}

	if err := svc.Resolve(ctx, d.ID, disputes.ResolutionSettled, "resolved out of band", 0, admin); err != nil {
		t.Fatalf("resolve non-food dispute: %v — a food resolver being wired must not affect other module_types", err)
	}

	var status, resolution string
	if err := pool.QueryRow(ctx, `SELECT status, resolution FROM disputes WHERE id=$1`, d.ID).Scan(&status, &resolution); err != nil {
		t.Fatalf("read ticket: %v", err)
	}
	if status != "resolved" || resolution != string(disputes.ResolutionSettled) {
		t.Fatalf("ticket = (%s, %s), want (resolved, settled) — unchanged bare status-flip behavior", status, resolution)
	}
}
