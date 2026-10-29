package top5events_test

// Live-DB money-path tests for the organiser payout rail (EVTC-D003). Skips
// unless TEST_DATABASE_URL is set. Escrow and revenue are SHARED standing
// accounts that other packages post to concurrently, so conservation is
// asserted per payout from the ledger entries under its own idempotency keys
// (evpayout:<id>:*) rather than from global balance deltas; the organiser's
// own wallet is private to the test and is asserted by delta.

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
	"spotlight/backend/internal/top5events"
)

var testPayoutPolicy = top5events.PayoutPolicy{
	HoldWindow:     72 * time.Hour,
	ReserveBps:     500,
	ReserveRelease: 30 * 24 * time.Hour,
	MinKYCTier:     1,
}

type payoutFixture struct {
	pool      *pgxpool.Pool
	svc       *top5events.Service
	led       *ledger.Service
	organiser string
	admin     string
	event     string
	orders    []string
}

func payoutService(pool *pgxpool.Pool) *top5events.Service {
	svc := ticketTokenService(pool)
	svc.SetPayoutPolicy(testPayoutPolicy)
	return svc
}

// seedPayoutEvent sells `sold` 100 000-kobo tickets through the real Purchase
// path (money really lands in escrow), then closes the event `endedAgo` in the
// past. The organiser is KYC tier kycTier.
func seedPayoutEvent(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sold int, endedAgo time.Duration, kycTier int) *payoutFixture {
	t.Helper()
	f := &payoutFixture{pool: pool, svc: payoutService(pool), led: cancelLedger(pool)}
	f.organiser = seedTicketTokenUser(t, ctx, pool)
	f.admin = seedTicketTokenUser(t, ctx, pool)
	testsupport.SetKycTier(t, ctx, pool, f.organiser, kycTier)
	f.event = seedManageEvent(t, ctx, pool, f.organiser, "LIVE")
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM event_organiser_payouts WHERE event_id=$1`, f.event)
	})
	setFee1000(t, ctx, pool, f.event)
	tier := seedPricedTier(t, ctx, pool, f.event, 100000)
	for i := range sold {
		buyer := seedTicketTokenUser(t, ctx, pool)
		fundBuyer(t, ctx, pool, f.led, buyer, 100000)
		tk, err := f.svc.Purchase(ctx, buyer, f.event, tier, "", "idem-"+uuid.New().String())
		if err != nil {
			t.Fatalf("purchase %d: %v", i, err)
		}
		f.orders = append(f.orders, tk.OrderID)
	}
	ends := time.Now().Add(-endedAgo)
	if _, err := pool.Exec(ctx, `UPDATE events SET state='CLOSED', starts_at=$2, ends_at=$3 WHERE id=$1`,
		f.event, ends.Add(-2*time.Hour), ends); err != nil {
		t.Fatalf("close event: %v", err)
	}
	return f
}

func newKey() string { return "idem-" + uuid.New().String() }

// payoutLegs returns the signed (CREDIT +, DEBIT -) ledger movement per
// account type for one payout's keys, plus the organiser-wallet credit.
func payoutLegs(t *testing.T, ctx context.Context, pool *pgxpool.Pool, payoutID string) map[string]int64 {
	t.Helper()
	rows, err := pool.Query(ctx, `
		SELECT CASE WHEN la.user_id IS NULL THEN la.type ELSE 'organiser_wallet' END,
		       SUM(CASE le.type WHEN 'CREDIT' THEN le.amount_kobo WHEN 'REVERSAL_DEBIT' THEN le.amount_kobo ELSE -le.amount_kobo END)
		  FROM ledger_entries le JOIN ledger_accounts la ON la.id = le.account_id
		 WHERE le.idempotency_key LIKE $1
		 GROUP BY 1`, "evpayout:"+payoutID+":%")
	if err != nil {
		t.Fatalf("payout legs: %v", err)
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var k string
		var v int64
		if err := rows.Scan(&k, &v); err != nil {
			t.Fatalf("scan legs: %v", err)
		}
		out[k] = v
	}
	return out
}

func assertConserved(t *testing.T, legs map[string]int64, net, fee int64) {
	t.Helper()
	var sum int64
	for _, v := range legs {
		sum += v
	}
	if sum != 0 {
		t.Fatalf("payout legs do not net to zero: %+v", legs)
	}
	if legs["organiser_wallet"] != net || legs["paymax_revenue"] != fee || legs["escrow"] != -(net+fee) {
		t.Fatalf("legs = %+v, want organiser +%d revenue +%d escrow -%d", legs, net, fee, net+fee)
	}
}

func openEventDispute(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID, orderID string) {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO disputes (id, user_id, reference, module_type, type, description, status)
		VALUES ($1,$2,$3,'events','not_received','ticket was never honoured at the gate','open')`, id, userID, orderID); err != nil {
		t.Fatalf("seed dispute: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM disputes WHERE id=$1`, id) })
}

//nolint:gocyclo // live money-statement fixture; sequential assertions kept inline
func TestLiveDB_Payout_EligibleNetOfRefundsDisputesFeesReserve(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	f := seedPayoutEvent(t, ctx, pool, 4, 80*time.Hour, testsupport.KycTierUnlimited)
	// Order 0 refunded, order 1 disputed → 2 × 100 000 eligible.
	if _, err := pool.Exec(ctx, `UPDATE event_orders SET status='REFUNDED' WHERE id=$1`, f.orders[0]); err != nil {
		t.Fatalf("refund order: %v", err)
	}
	openEventDispute(t, ctx, pool, f.organiser, f.orders[1])

	st, err := f.svc.OrganiserPayoutStatement(ctx, f.organiser, f.event)
	if err != nil {
		t.Fatalf("statement: %v", err)
	}
	if !st.Eligible || st.GrossSalesKobo != 400000 || st.RefundsKobo != 100000 || st.DisputedHeldKobo != 100000 ||
		st.EligibleGrossKobo != 200000 || st.FeesKobo != 20000 || st.ReserveKobo != 9000 ||
		st.NetEarningsKobo != 171000 || st.AvailableKobo != 171000 || st.PaidKobo != 0 {
		t.Fatalf("statement before payout: %+v", st)
	}

	walletBefore := buyerBalance(t, ctx, f.led, f.organiser)
	p, err := f.svc.RequestOrganiserPayout(ctx, f.organiser, f.event, newKey(), false)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if p.Status != top5events.PayoutPending || p.GrossKobo != 200000 || p.FeeKobo != 20000 || p.NetKobo != 171000 || p.ReserveHeldKobo != 9000 {
		t.Fatalf("payout = %+v", p)
	}
	paid, err := f.svc.ApproveOrganiserPayout(ctx, f.admin, p.ID, newKey())
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if paid.Status != top5events.PayoutPaid || paid.PaidAt == nil {
		t.Fatalf("approved payout = %+v", paid)
	}
	if got := buyerBalance(t, ctx, f.led, f.organiser) - walletBefore; got != 171000 {
		t.Fatalf("organiser wallet delta = %d, want 171000", got)
	}
	assertConserved(t, payoutLegs(t, ctx, pool, p.ID), 171000, 20000)

	// Statement totals reconcile to the ledger.
	st, err = f.svc.OrganiserPayoutStatement(ctx, f.organiser, f.event)
	if err != nil {
		t.Fatalf("statement after: %v", err)
	}
	var ledgerNet, ledgerFee int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(le.amount_kobo) FILTER (WHERE le.idempotency_key LIKE '%:net:credit'),0),
		       COALESCE(SUM(le.amount_kobo) FILTER (WHERE le.idempotency_key LIKE '%:fee:credit'),0)
		  FROM ledger_entries le
		 WHERE le.idempotency_key IN (
		   SELECT 'evpayout:'||id||':net:credit' FROM event_organiser_payouts WHERE event_id=$1
		   UNION ALL SELECT 'evpayout:'||id||':fee:credit' FROM event_organiser_payouts WHERE event_id=$1)`, f.event).
		Scan(&ledgerNet, &ledgerFee); err != nil {
		t.Fatalf("ledger totals: %v", err)
	}
	if st.PaidKobo != ledgerNet || st.FeesCollectedKobo != ledgerFee || st.PaidKobo != 171000 || st.AvailableKobo != 0 || st.PendingKobo != 0 {
		t.Fatalf("statement %+v does not reconcile to ledger net=%d fee=%d", st, ledgerNet, ledgerFee)
	}
	if st.GrossSalesKobo != st.RefundsKobo+st.DisputedHeldKobo+st.EligibleGrossKobo ||
		st.EligibleGrossKobo != st.FeesKobo+st.ReserveKobo+st.NetEarningsKobo ||
		st.NetEarningsKobo != st.PaidKobo+st.PendingKobo+st.BalanceKobo {
		t.Fatalf("statement identities broken: %+v", st)
	}

	// Nothing more is due while the reserve is held.
	if _, err := f.svc.RequestOrganiserPayout(ctx, f.admin, f.event, newKey(), true); !errors.Is(err, top5events.ErrPayoutNothingDue) {
		t.Fatalf("second request err=%v, want ErrPayoutNothingDue", err)
	}
}

func TestLiveDB_Payout_RefusedBeforeEligibility(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	f := seedPayoutEvent(t, ctx, pool, 1, 1*time.Hour, testsupport.KycTierUnlimited) // inside 72h hold
	if _, err := f.svc.RequestOrganiserPayout(ctx, f.organiser, f.event, newKey(), false); !errors.Is(err, top5events.ErrPayoutNotEligible) {
		t.Fatalf("inside hold err=%v, want ErrPayoutNotEligible", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE events SET state='LIVE', starts_at=now()-interval '102 hours', ends_at=now()-interval '100 hours' WHERE id=$1`, f.event); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.RequestOrganiserPayout(ctx, f.admin, f.event, newKey(), true); !errors.Is(err, top5events.ErrPayoutNotEligible) {
		t.Fatalf("not-closed err=%v, want ErrPayoutNotEligible", err)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM event_organiser_payouts WHERE event_id=$1`, f.event).Scan(&n)
	if n != 0 {
		t.Fatalf("%d payout rows created before eligibility", n)
	}
}

func TestLiveDB_Payout_KYCUnverifiedOrganiserRefused(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	f := seedPayoutEvent(t, ctx, pool, 1, 80*time.Hour, 0)
	if _, err := f.svc.RequestOrganiserPayout(ctx, f.admin, f.event, newKey(), true); !errors.Is(err, top5events.ErrKYCRequired) {
		t.Fatalf("err=%v, want ErrKYCRequired", err)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM event_organiser_payouts WHERE event_id=$1`, f.event).Scan(&n)
	if n != 0 {
		t.Fatalf("unverified organiser got %d payout rows", n)
	}
}

func TestLiveDB_Payout_MakerCheckerAndOwnership(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	f := seedPayoutEvent(t, ctx, pool, 1, 80*time.Hour, testsupport.KycTierUnlimited)
	stranger := seedTicketTokenUser(t, ctx, pool)

	if _, err := f.svc.RequestOrganiserPayout(ctx, stranger, f.event, newKey(), false); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("stranger request err=%v, want ErrForbidden", err)
	}
	if _, err := f.svc.OrganiserPayoutStatement(ctx, stranger, f.event); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("stranger statement err=%v, want ErrForbidden", err)
	}
	p, err := f.svc.RequestOrganiserPayout(ctx, f.admin, f.event, newKey(), true)
	if err != nil {
		t.Fatalf("admin request: %v", err)
	}
	if _, err := f.svc.ApproveOrganiserPayout(ctx, f.admin, p.ID, newKey()); !errors.Is(err, top5events.ErrPayoutSameActor) {
		t.Fatalf("maker approving own payout err=%v, want ErrPayoutSameActor", err)
	}
	if _, err := f.svc.GetOrganiserPayout(ctx, stranger, p.ID); !errors.Is(err, top5events.ErrNotFound) {
		t.Fatalf("stranger payout read err=%v, want ErrNotFound", err)
	}
	if got, err := f.svc.GetOrganiserPayout(ctx, f.organiser, p.ID); err != nil || got.ID != p.ID {
		t.Fatalf("owner payout read: %v", err)
	}
	mine, err := f.svc.ListMyOrganiserPayouts(ctx, stranger)
	if err != nil || len(mine) != 0 {
		t.Fatalf("stranger sees %d payouts (err %v)", len(mine), err)
	}
	// Checker rejects → failed, retained; a fresh request can then be made.
	rej, err := f.svc.RejectOrganiserPayout(ctx, stranger, p.ID, "bank details mismatch")
	if err != nil || rej.Status != top5events.PayoutFailed {
		t.Fatalf("reject: %+v %v", rej, err)
	}
	if _, err := f.svc.ApproveOrganiserPayout(ctx, stranger, p.ID, newKey()); !errors.Is(err, top5events.ErrPayoutNotPayable) {
		t.Fatalf("approve after reject err=%v, want ErrPayoutNotPayable", err)
	}
	if len(payoutLegs(t, ctx, pool, p.ID)) != 0 {
		t.Fatal("rejected payout moved money")
	}
}

func TestLiveDB_Payout_ConcurrentTriggersPayOnce(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	f := seedPayoutEvent(t, ctx, pool, 2, 80*time.Hour, testsupport.KycTierUnlimited)
	walletBefore := buyerBalance(t, ctx, f.led, f.organiser)

	// 8 concurrent requests with distinct keys: exactly one payout object.
	var wg sync.WaitGroup
	var mu sync.Mutex
	created := map[string]bool{}
	var inflight int
	for range 8 {
		wg.Go(func() {
			p, err := f.svc.RequestOrganiserPayout(ctx, f.admin, f.event, newKey(), true)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				created[p.ID] = true
			case errors.Is(err, top5events.ErrPayoutInFlight):
				inflight++
			default:
				t.Errorf("request: %v", err)
			}
		})
	}
	wg.Wait()
	if len(created) != 1 || inflight != 7 {
		t.Fatalf("created=%d inflight=%d, want 1/7", len(created), inflight)
	}
	var id string
	for k := range created {
		id = k
	}

	// Replaying the winning request's own key returns the same payout object.
	won, err := f.svc.GetOrganiserPayout(ctx, f.organiser, id)
	if err != nil {
		t.Fatal(err)
	}
	if again, err := f.svc.RequestOrganiserPayout(ctx, f.admin, f.event, won.IdempotencyKey, true); err != nil || again.ID != id {
		t.Fatalf("idempotent replay: %+v %v", again, err)
	}

	// 8 concurrent approvals by distinct checkers: paid exactly once.
	for range 8 {
		checker := seedTicketTokenUser(t, ctx, pool)
		wg.Go(func() {
			p, err := f.svc.ApproveOrganiserPayout(ctx, checker, id, newKey())
			// A checker that loses the claim race sees the payout already
			// PROCESSING and is told so (ErrPayoutInFlight); it must not move
			// money. The exactly-once credit is asserted below.
			if errors.Is(err, top5events.ErrPayoutInFlight) {
				return
			}
			if err != nil {
				t.Errorf("approve: %v", err)
				return
			}
			if p.Status != top5events.PayoutPaid {
				t.Errorf("approve returned status %s", p.Status)
			}
		})
	}
	wg.Wait()
	// 2 × 100 000, fee 20 000, reserve 5% of 180 000 = 9 000 → net 171 000.
	if got := buyerBalance(t, ctx, f.led, f.organiser) - walletBefore; got != 171000 {
		t.Fatalf("organiser credited %d, want exactly 171000 once", got)
	}
	assertConserved(t, payoutLegs(t, ctx, pool, id), 171000, 18000+2000)

	// Retry after paid: re-approve is an idempotent no-op; a new request owes nothing.
	if p, err := f.svc.ApproveOrganiserPayout(ctx, f.organiser, id, newKey()); err != nil || p.Status != top5events.PayoutPaid {
		t.Fatalf("re-approve paid: %+v %v", p, err)
	}
	if _, err := f.svc.RequestOrganiserPayout(ctx, f.admin, f.event, newKey(), true); !errors.Is(err, top5events.ErrPayoutNothingDue) {
		t.Fatalf("post-paid request err=%v", err)
	}
	if got := buyerBalance(t, ctx, f.led, f.organiser) - walletBefore; got != 171000 {
		t.Fatalf("retry double-paid: delta %d", got)
	}
}

func TestLiveDB_Payout_FailedTransferNoLossThenRetryOnce(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	f := seedPayoutEvent(t, ctx, pool, 1, 80*time.Hour, testsupport.KycTierUnlimited)
	walletBefore := buyerBalance(t, ctx, f.led, f.organiser)

	p, err := f.svc.RequestOrganiserPayout(ctx, f.admin, f.event, newKey(), true)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	f.svc.SetPayoutLegFault(func(leg string) error {
		if leg == "net" {
			return errors.New("injected processor failure")
		}
		return nil
	})
	failed, err := f.svc.ApproveOrganiserPayout(ctx, f.organiser, p.ID, newKey())
	if !errors.Is(err, top5events.ErrPayoutLegFailed) {
		t.Fatalf("approve with failing leg err=%v, want ErrPayoutLegFailed", err)
	}
	if failed == nil || failed.Status != top5events.PayoutFailed || failed.FailureReason == "" {
		t.Fatalf("failed payout = %+v", failed)
	}
	if len(payoutLegs(t, ctx, pool, p.ID)) != 0 {
		t.Fatal("failed payout left ledger legs")
	}
	if got := buyerBalance(t, ctx, f.led, f.organiser) - walletBefore; got != 0 {
		t.Fatalf("failed payout credited organiser %d", got)
	}
	st, _ := f.svc.OrganiserPayoutStatement(ctx, f.organiser, f.event)
	if st.AvailableKobo != 85500 || st.PaidKobo != 0 || st.PendingKobo != 0 {
		t.Fatalf("funds not returned to available after failure: %+v", st)
	}

	// Retry with a fresh request: exactly one successful disbursement, the failed
	// attempt is retained for traceability.
	f.svc.SetPayoutLegFault(nil)
	p2, err := f.svc.RequestOrganiserPayout(ctx, f.admin, f.event, newKey(), true)
	if err != nil {
		t.Fatalf("retry request: %v", err)
	}
	if p2.ID == p.ID || p2.NetKobo != 85500 || p2.FeeKobo != 10000 {
		t.Fatalf("retry payout = %+v", p2)
	}
	if _, err := f.svc.ApproveOrganiserPayout(ctx, f.organiser, p2.ID, newKey()); err != nil {
		t.Fatalf("retry approve: %v", err)
	}
	if got := buyerBalance(t, ctx, f.led, f.organiser) - walletBefore; got != 85500 {
		t.Fatalf("organiser delta %d, want 85500", got)
	}
	var statuses []string
	rows, _ := pool.Query(ctx, `SELECT status FROM event_organiser_payouts WHERE event_id=$1 ORDER BY created_at`, f.event)
	for rows.Next() {
		var s string
		_ = rows.Scan(&s)
		statuses = append(statuses, s)
	}
	rows.Close()
	if fmt.Sprint(statuses) != "[failed paid]" {
		t.Fatalf("attempt history = %v", statuses)
	}
}

func TestLiveDB_Payout_PartialLegRedriveCompletesOnce(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	f := seedPayoutEvent(t, ctx, pool, 1, 80*time.Hour, testsupport.KycTierUnlimited)
	walletBefore := buyerBalance(t, ctx, f.led, f.organiser)
	p, err := f.svc.RequestOrganiserPayout(ctx, f.admin, f.event, newKey(), true)
	if err != nil {
		t.Fatal(err)
	}
	// Net leg posts, fee leg fails: money partly moved → must stay processing
	// (never 'failed', which would free the amount for a second payout).
	f.svc.SetPayoutLegFault(func(leg string) error {
		if leg == "fee" {
			return errors.New("injected fee failure")
		}
		return nil
	})
	got, err := f.svc.ApproveOrganiserPayout(ctx, f.organiser, p.ID, newKey())
	if err == nil || got == nil || got.Status != top5events.PayoutProcessing {
		t.Fatalf("partial failure: %+v err=%v, want processing + error", got, err)
	}
	if _, err := f.svc.RequestOrganiserPayout(ctx, f.admin, f.event, newKey(), true); !errors.Is(err, top5events.ErrPayoutInFlight) {
		t.Fatalf("request while processing err=%v", err)
	}
	f.svc.SetPayoutLegFault(nil)
	n, err := f.svc.ReconcileOrganiserPayouts(ctx, 0)
	if err != nil || n != 1 {
		t.Fatalf("reconcile n=%d err=%v", n, err)
	}
	final, err := f.svc.GetOrganiserPayout(ctx, f.organiser, p.ID)
	if err != nil || final.Status != top5events.PayoutPaid {
		t.Fatalf("after re-drive: %+v %v", final, err)
	}
	if d := buyerBalance(t, ctx, f.led, f.organiser) - walletBefore; d != 85500 {
		t.Fatalf("organiser delta %d, want 85500 exactly once", d)
	}
	assertConserved(t, payoutLegs(t, ctx, pool, p.ID), 85500, 10000)
}

func TestLiveDB_Payout_PerOrganiserSegregation(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	a := seedPayoutEvent(t, ctx, pool, 1, 80*time.Hour, testsupport.KycTierUnlimited)
	b := seedPayoutEvent(t, ctx, pool, 3, 80*time.Hour, testsupport.KycTierUnlimited)
	aBefore := buyerBalance(t, ctx, a.led, a.organiser)
	bBefore := buyerBalance(t, ctx, b.led, b.organiser)

	pa, err := a.svc.RequestOrganiserPayout(ctx, a.admin, a.event, newKey(), true)
	if err != nil {
		t.Fatal(err)
	}
	pb, err := b.svc.RequestOrganiserPayout(ctx, b.admin, b.event, newKey(), true)
	if err != nil {
		t.Fatal(err)
	}
	if pa.OrganiserID != a.organiser || pb.OrganiserID != b.organiser {
		t.Fatal("payee is not the event's organiser")
	}
	if _, err := a.svc.ApproveOrganiserPayout(ctx, b.admin, pa.ID, newKey()); err != nil {
		t.Fatal(err)
	}
	if _, err := b.svc.ApproveOrganiserPayout(ctx, a.admin, pb.ID, newKey()); err != nil {
		t.Fatal(err)
	}
	if d := buyerBalance(t, ctx, a.led, a.organiser) - aBefore; d != 85500 {
		t.Fatalf("organiser A delta %d", d)
	}
	// B: 300 000 gross, 30 000 fee, 5% of 270 000 = 13 500 reserve → 256 500.
	if d := buyerBalance(t, ctx, b.led, b.organiser) - bBefore; d != 256500 {
		t.Fatalf("organiser B delta %d", d)
	}
	if _, err := a.svc.OrganiserPayoutStatement(ctx, a.organiser, b.event); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("A reading B's statement err=%v", err)
	}
}

func TestLiveDB_Payout_ReserveReleasedAfterWindow(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	f := seedPayoutEvent(t, ctx, pool, 1, 80*time.Hour, testsupport.KycTierUnlimited)
	walletBefore := buyerBalance(t, ctx, f.led, f.organiser)
	p, err := f.svc.RequestOrganiserPayout(ctx, f.admin, f.event, newKey(), true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ApproveOrganiserPayout(ctx, f.organiser, p.ID, newKey()); err != nil {
		t.Fatal(err)
	}
	// Age the event past the 30-day reserve window.
	if _, err := pool.Exec(ctx, `UPDATE events SET starts_at=now()-interval '32 days', ends_at=now()-interval '31 days' WHERE id=$1`, f.event); err != nil {
		t.Fatal(err)
	}
	p2, err := f.svc.RequestOrganiserPayout(ctx, f.admin, f.event, newKey(), true)
	if err != nil {
		t.Fatalf("reserve release request: %v", err)
	}
	if p2.NetKobo != 4500 || p2.FeeKobo != 0 || p2.GrossKobo != 0 || p2.ReserveHeldKobo != 0 {
		t.Fatalf("reserve release payout = %+v", p2)
	}
	if _, err := f.svc.ApproveOrganiserPayout(ctx, f.organiser, p2.ID, newKey()); err != nil {
		t.Fatal(err)
	}
	if d := buyerBalance(t, ctx, f.led, f.organiser) - walletBefore; d != 90000 {
		t.Fatalf("total paid %d, want 90000 (gross 100000 - 10%% fee)", d)
	}
	queue, err := f.svc.AdminPayoutQueue(ctx)
	if err != nil {
		t.Fatalf("admin queue: %v", err)
	}
	for _, l := range queue {
		if l.EventID == f.event && l.AvailableKobo != 0 {
			t.Fatalf("fully settled event still shows available %d", l.AvailableKobo)
		}
	}
}
