package reservation_test

// LIVE-DB regression for the stays refund/settle money defects: a fake
// SupplyGateway drives the saga end to end (prebook → book → settle →
// cancel/modify) on a real database, real ledger and real settlement rows.
// Pins: modify settles post each leg's DELTA; post-settle cancels refund from
// the parked provider_clearing/commission legs (never pooled escrow); queued
// payouts die with the cancel; refund legs are retry-safe.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	finsettlement "spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/stays/consent"
	"spotlight/backend/internal/stays/gateway"
	"spotlight/backend/internal/stays/pricing"
	"spotlight/backend/internal/stays/reservation"
	stayssettlement "spotlight/backend/internal/stays/settlement"
	"spotlight/backend/internal/testsupport"
)

func mustResPool(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping TEST_DATABASE_URL: %v", err)
	}
	return pool
}

func seedResUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUserCtx(t, ctx, pool, id)
	testsupport.SetKycTier(t, ctx, pool, id, testsupport.KycTierUnlimited)
	return id
}

// fakeSupply is a scripted SupplyGateway: it returns queued prebook results (one
// per call — initial prebook, then each modify re-quote) and fixed book/cancel
// responses. It is the seam that lets the whole saga run on real money rows
// without a real supplier.
type fakeSupply struct {
	prebooks []gateway.PrebookResult
	calls    int
	book     gateway.Reservation
	cancel   gateway.Cancellation
}

func (f *fakeSupply) Name() string { return "fake" }

func (f *fakeSupply) Search(ctx context.Context, req gateway.SearchRequest) ([]gateway.PropertyOffer, error) {
	return nil, nil
}

func (f *fakeSupply) GetContent(ctx context.Context, supplierPropertyRef string) (gateway.PropertyContent, error) {
	return gateway.PropertyContent{}, nil
}

func (f *fakeSupply) Prebook(ctx context.Context, req gateway.PrebookRequest) (gateway.PrebookResult, error) {
	i := f.calls
	if i >= len(f.prebooks) {
		i = len(f.prebooks) - 1
	}
	f.calls++
	return f.prebooks[i], nil
}

func (f *fakeSupply) Book(ctx context.Context, req gateway.BookRequest) (gateway.Reservation, error) {
	return f.book, nil
}

func (f *fakeSupply) GetReservation(ctx context.Context, supplierRef string) (gateway.Reservation, error) {
	return f.book, nil
}

func (f *fakeSupply) Cancel(ctx context.Context, req gateway.CancelRequest) (gateway.Cancellation, error) {
	return f.cancel, nil
}

func (f *fakeSupply) Modify(ctx context.Context, req gateway.ModifyRequest) (gateway.Reservation, error) {
	return f.book, nil
}

func (f *fakeSupply) SyncARI(ctx context.Context, ev gateway.ARIEvent) error { return nil }

// sagaFixture wires a real reservation.Service over a live pool with the fake
// gateway + a funded guest.
type sagaFixture struct {
	pool      *pgxpool.Pool
	svc       *reservation.Service
	deps      reservation.Deps
	ledgerSvc *ledger.Service
	settleSvc *stayssettlement.Service
	guest     string
	hotelier  string
	propID    string // internal stays_property.id (also the reservation's property_id)
	fake      *fakeSupply
}

func newSagaFixture(t *testing.T, ctx context.Context, prebooks []gateway.PrebookResult, book gateway.Reservation, canc gateway.Cancellation) *sagaFixture {
	t.Helper()
	pool := mustResPool(t, ctx)

	f := &sagaFixture{pool: pool}
	f.guest = seedResUser(t, ctx, pool)
	f.hotelier = seedResUser(t, ctx, pool)

	// Self-listed DIRECT property — the extranet onboarding shape.
	propRef := uuid.NewString()
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.stays_property
			(source_rail, supplier_code, supplier_property_ref, name, address, city, star_rating, property_type, status)
		VALUES ('DIRECT','self',$1,'Saga Test Hotel','1 St','Lagos',4,'hotel','ACTIVE')
		RETURNING id`, propRef).Scan(&f.propID); err != nil {
		t.Fatalf("seed stays_property: %v", err)
	}

	f.ledgerSvc = ledger.NewService(ledger.NewRepository(pool), nil)
	finSettle := finsettlement.NewService(pool, f.ledgerSvc)
	f.settleSvc = stayssettlement.NewService(stayssettlement.NewRepository(pool), f.ledgerSvc)
	f.fake = &fakeSupply{prebooks: prebooks, book: book, cancel: canc}
	router := gateway.NewRouter(
		gateway.StaticRailResolver{Bindings: map[gateway.SourceRail]string{gateway.RailDirect: "fake"}},
		f.fake)
	eng := pricing.NewEngine(pricing.Config{
		DefaultMarkupBps:      1200,
		DefaultCommissionBps:  1500,
		MaxStackedDiscountBps: 2000,
		DisplayCurrency:       "NGN",
	}, nil)

	f.deps = reservation.Deps{
		Repo:                reservation.NewRepository(pool),
		Router:              router,
		Pricing:             eng,
		Consent:             consent.NewService(pool),
		Settlement:          finSettle,
		Ledger:              f.ledgerSvc,
		Tiers:               tiers.NewService(pool),
		DirectCommissionBps: 1500,
	}
	f.svc = reservation.NewService(f.deps)

	// NDPA consent + funded wallet for the escrow debits.
	if _, err := consent.NewService(pool).Grant(ctx, f.guest, consent.DefaultScope); err != nil {
		t.Fatalf("grant consent: %v", err)
	}
	clearing, err := f.ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("resolve clearing: %v", err)
	}
	if err := f.ledgerSvc.Credit(ctx, f.guest, "seed:wallet:"+uuid.NewString(),
		"seed-wallet-"+uuid.NewString(), clearing.ID, 3_000_000); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
	return f
}

// book drives prebook→book to CONFIRMED and returns the reservation.
func (f *sagaFixture) book(t *testing.T, ctx context.Context) *reservation.Reservation {
	t.Helper()
	ci := time.Now().Add(72 * time.Hour)
	co := time.Now().Add(120 * time.Hour)
	pre, err := f.svc.Prebook(ctx, f.guest, reservation.PrebookInput{
		Rail:         gateway.RailDirect,
		SupplierCode: "self",
		PropertyID:   f.propID,
		RoomTypeID:   uuid.NewString(),
		RatePlanID:   uuid.NewString(),
		CheckIn:      ci,
		CheckOut:     co,
		Rooms:        1,
		Currency:     "NGN",
	})
	if err != nil {
		t.Fatalf("Prebook: %v", err)
	}
	res, err := f.svc.Book(ctx, f.guest, pre.Reservation.ID, pre.BookToken,
		"book-"+uuid.NewString(), gateway.GuestInfo{FirstName: "T", LastName: "G"})
	if err != nil {
		t.Fatalf("Book: %v", err)
	}
	if res.State != reservation.StateConfirmed {
		t.Fatalf("post-book state = %s, want CONFIRMED", res.State)
	}
	return res
}

// legsForRef sums ledger entries by (account type, entry type) for one reference —
// e.g. "stays:refund:<resID>:provider".
func resLegsForRef(t *testing.T, ctx context.Context, pool *pgxpool.Pool, reference string) map[string]int64 {
	t.Helper()
	rows, err := pool.Query(ctx, `
		SELECT a.type || ':' || le.type, le.amount_kobo
		FROM ledger_entries le
		JOIN ledger_accounts a ON a.id = le.account_id
		WHERE le.reference = $1`, reference)
	if err != nil {
		t.Fatalf("query legs for %s: %v", reference, err)
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var k string
		var amt int64
		if err := rows.Scan(&k, &amt); err != nil {
			t.Fatalf("scan leg: %v", err)
		}
		out[k] = amt
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	return out
}

func walletBalance(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var sum int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN le.type IN ('CREDIT','REVERSAL_DEBIT') THEN le.amount_kobo ELSE -le.amount_kobo END),0)
		FROM ledger_entries le
		JOIN ledger_accounts a ON a.id = le.account_id
		WHERE a.user_id = $1 AND a.type = 'user_wallet'`, userID).Scan(&sum); err != nil {
		t.Fatalf("wallet balance: %v", err)
	}
	return sum
}

func payoutStatus(t *testing.T, pool *pgxpool.Pool, payoutID string) string {
	t.Helper()
	var st string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM public.stays_hotel_payout WHERE id = $1`, payoutID).Scan(&st); err != nil {
		t.Fatalf("payout status: %v", err)
	}
	return st
}

// Cancel after the confirm-time settle: refund draws the parked
// provider_clearing + commission legs, never pooled escrow; the payout dies.
func TestLiveDB_CancelPostSettle_RefundsParkedLegsAndBlocksPayout(t *testing.T) {
	ctx := context.Background()
	const netRate = int64(1_000_000) // ₦10,000
	const tax = int64(100_000)       // ₦1,000
	// gross = net + tax (Rail B: commission deducted at settle, not added).
	const gross = netRate + tax       // 1_100_000
	const commission = int64(150_000) // 15% of net
	const providerNet = gross - commission

	f := newSagaFixture(t, ctx,
		[]gateway.PrebookResult{{
			BookToken:          "tok-1",
			NetRateKobo:        netRate,
			TaxKobo:            tax,
			Currency:           "NGN",
			CancellationPolicy: map[string]any{"refundable": true},
		}},
		gateway.Reservation{SupplierRef: "FAKE-" + uuid.NewString()[:12], Status: gateway.ResStatusConfirmed},
		gateway.Cancellation{Status: "cancelled", RefundKobo: gross}) // fully refundable policy

	res := f.book(t, ctx)

	// Sanity: the settle parked provider net in clearing + commission in its
	// account — the pre-condition the defect violated.
	settled := resLegsForRef(t, ctx, f.pool, "settle:stays:"+res.ID+":provider")
	if settled["escrow:DEBIT"] != providerNet || settled["provider_clearing:CREDIT"] != providerNet {
		t.Fatalf("book settle provider leg = %v, want escrow DR %d / clearing CR %d", settled, providerNet, providerNet)
	}
	commLegs := resLegsForRef(t, ctx, f.pool, "settle:stays:"+res.ID+":commission")
	if commLegs["escrow:DEBIT"] != commission || commLegs["commission:CREDIT"] != commission {
		t.Fatalf("book settle commission leg = %v, want escrow DR %d / commission CR %d", commLegs, commission, commission)
	}

	// Queue a HELD payout bound to the reservation — the double-pay vector.
	payoutID, err := f.settleSvc.QueuePayout(ctx, f.propID, f.hotelier, res.ID, providerNet, "pq-"+uuid.NewString())
	if err != nil {
		t.Fatalf("QueuePayout: %v", err)
	}
	hotelierBefore := walletBalance(t, ctx, f.pool, f.hotelier)

	// Guest cancel (supplier returns a FULL policy refund).
	if _, err := f.svc.Cancel(ctx, f.guest, res.ID, "change of plans"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}

	// Refund legs: DR provider_clearing / CR guest wallet for the provider share…
	prov := resLegsForRef(t, ctx, f.pool, "stays:refund:"+res.ID+":provider")
	if prov["provider_clearing:DEBIT"] != providerNet || prov["user_wallet:CREDIT"] != providerNet {
		t.Fatalf("refund provider leg = %v — want provider_clearing DR %d / wallet CR %d (drawn from CLEARING, not escrow)",
			prov, providerNet, providerNet)
	}
	// …DR commission / CR guest wallet for the reversed commission share…
	comm := resLegsForRef(t, ctx, f.pool, "stays:refund:"+res.ID+":commission")
	if comm["commission:DEBIT"] != commission || comm["user_wallet:CREDIT"] != commission {
		t.Fatalf("refund commission leg = %v — want commission DR %d / wallet CR %d", comm, commission, commission)
	}
	// …and NO escrow draw — the settled money was never in escrow (the old
	// double-pay bug refunded the guest from the pooled escrow anyway).
	esc := resLegsForRef(t, ctx, f.pool, "stays:refund:"+res.ID+":escrow")
	if len(esc) != 0 {
		t.Fatalf("refund touched escrow %v — post-settle refunds must draw the parked legs, not pooled escrow", esc)
	}

	// Guest wallet got the full gross back (seed − gross escrow + refund).
	if got, want := walletBalance(t, ctx, f.pool, f.guest), int64(3_000_000); got != want {
		t.Fatalf("guest wallet balance = %d, want %d (full refund restored)", got, want)
	}

	// The queued payout was CANCELLED by the cancel saga — the queue can't pay it.
	if st := payoutStatus(t, f.pool, payoutID); st != "CANCELLED" {
		t.Fatalf("payout status = %q, want CANCELLED after guest cancel", st)
	}
	if _, err := f.settleSvc.ReleasePayout(ctx, payoutID); err == nil {
		t.Fatal("ReleasePayout on a cancelled payout must refuse")
	}
	if got := walletBalance(t, ctx, f.pool, f.hotelier); got != hotelierBefore {
		t.Fatalf("hotelier credited %d on a refunded booking — the double-pay the audit flagged", got-hotelierBefore)
	}

	// A payout queued for a cancelled reservation (e.g. raced the cancel) must
	// also be refused by the reservation-state gate — fail closed.
	payout2, err := f.settleSvc.QueuePayout(ctx, f.propID, f.hotelier, res.ID, providerNet, "pq2-"+uuid.NewString())
	if err != nil {
		t.Fatalf("QueuePayout 2: %v", err)
	}
	if _, err := f.settleSvc.ReleasePayout(ctx, payout2); !errors.Is(err, stayssettlement.ErrPayoutBlocked) {
		t.Fatalf("ReleasePayout on a cancelled reservation = %v, want ErrPayoutBlocked", err)
	}
	if got := walletBalance(t, ctx, f.pool, f.hotelier); got != hotelierBefore {
		t.Fatalf("hotelier credited on a blocked payout: +%d", got-hotelierBefore)
	}

	// The commission domain ledger recorded the reversal, so a later admin
	// ReverseCommission can't re-reverse the share the guest already got back.
	var commNet int64
	if err := f.pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_kobo),0) FROM public.stays_commission_entry WHERE reservation_id = $1`,
		res.ID).Scan(&commNet); err != nil {
		t.Fatalf("commission net: %v", err)
	}
	if commNet != -commission {
		t.Fatalf("commission domain net = %d, want %d (reversal recorded)", commNet, -commission)
	}
}

// A modify-charge settle posts each leg's DELTA — provider leg =
// delta − commission delta, platform leg = commission delta.
func TestLiveDB_ModifyDelta_PostsDeltaLegs(t *testing.T) {
	ctx := context.Background()
	const net1, tax1 = int64(1_000_000), int64(100_000)
	const net2, tax2 = int64(1_400_000), int64(140_000)
	const net3, tax3 = int64(800_000), int64(80_000)
	const gross1, gross2, gross3 = net1 + tax1, net2 + tax2, net3 + tax3 // 1_100_000, 1_540_000, 880_000
	const comm1, comm2, comm3 = int64(150_000), int64(210_000), int64(120_000)
	const delta = gross2 - gross1       // 440_000
	const commDelta = comm2 - comm1     // 60_000
	const provDelta = delta - commDelta // 380_000
	// Decrease leg: refund = gross3 − gross2 = −660_000; each parked leg unwinds
	// by its own delta: provider gives back (gross2−comm2) − (gross3−comm3) =
	// 570_000, commission gives back comm2 − comm3 = 90_000.
	const refund = gross2 - gross3                       // 660_000
	const provDraw = (gross2 - comm2) - (gross3 - comm3) // 570_000
	const commDraw = comm2 - comm3                       // 90_000

	f := newSagaFixture(t, ctx,
		[]gateway.PrebookResult{
			{BookToken: "tok-1", NetRateKobo: net1, TaxKobo: tax1, Currency: "NGN", CancellationPolicy: map[string]any{"refundable": true}},
			{BookToken: "tok-2", NetRateKobo: net2, TaxKobo: tax2, Currency: "NGN", CancellationPolicy: map[string]any{"refundable": true}},
			{BookToken: "tok-3", NetRateKobo: net3, TaxKobo: tax3, Currency: "NGN", CancellationPolicy: map[string]any{"refundable": true}},
		},
		gateway.Reservation{SupplierRef: "FAKE-" + uuid.NewString()[:12], Status: gateway.ResStatusConfirmed},
		gateway.Cancellation{Status: "cancelled", RefundKobo: gross1})

	res := f.book(t, ctx)

	// Modify UP — new dates re-quote to net2.
	newIn := time.Now().Add(144 * time.Hour)
	newOut := time.Now().Add(192 * time.Hour)
	if _, err := f.svc.Modify(ctx, f.guest, res.ID, "mod-"+uuid.NewString(), newIn, newOut); err != nil {
		t.Fatalf("Modify: %v", err)
	}

	// The modify settlement carries the DELTA legs on its row…
	var status string
	var providerKobo, feeKobo int64
	if err := f.pool.QueryRow(ctx, `
		SELECT status, provider_kobo, fee_kobo FROM public.settlements
		WHERE module_type='stays' AND reference = 'stays:modify:' || $1`, res.ID).
		Scan(&status, &providerKobo, &feeKobo); err != nil {
		t.Fatalf("read modify settlement: %v", err)
	}
	if status != "settled" {
		t.Fatalf("modify settlement status = %q, want settled (delta must not strand in escrow)", status)
	}
	if providerKobo != provDelta || feeKobo != commDelta {
		t.Fatalf("modify settlement legs = provider %d / fee %d, want DELTAS %d / %d",
			providerKobo, feeKobo, provDelta, commDelta)
	}
	// …and the ledger legs match: provider leg = delta − commission delta,
	// platform leg = commission delta. NOT the full recomputed commission.
	prov := resLegsForRef(t, ctx, f.pool, "settle:stays:modify:"+res.ID+":provider")
	if prov["escrow:DEBIT"] != provDelta || prov["provider_clearing:CREDIT"] != provDelta {
		t.Fatalf("modify provider leg = %v — want DELTA %d, not the full new provider share", prov, provDelta)
	}
	comm := resLegsForRef(t, ctx, f.pool, "settle:stays:modify:"+res.ID+":commission")
	if comm["escrow:DEBIT"] != commDelta || comm["commission:CREDIT"] != commDelta {
		t.Fatalf("modify commission leg = %v — want DELTA %d, not the full recomputed commission %d",
			comm, commDelta, comm2)
	}

	// Modify DOWN — each parked leg unwinds by its OWN delta.
	walletBefore := walletBalance(t, ctx, f.pool, f.guest)
	newerIn := time.Now().Add(216 * time.Hour)
	newerOut := time.Now().Add(240 * time.Hour)
	if _, err := f.svc.Modify(ctx, f.guest, res.ID, "mod-"+uuid.NewString(), newerIn, newerOut); err != nil {
		t.Fatalf("Modify down: %v", err)
	}

	// Provider leg: DR provider_clearing → CR guest wallet for provDraw — the
	// provider DELTA, never the whole parked provider share and never escrow.
	provRef := resLegsForRef(t, ctx, f.pool, "stays:modify:refund:"+res.ID+":provider")
	if provRef["provider_clearing:DEBIT"] != provDraw || provRef["user_wallet:CREDIT"] != provDraw {
		t.Fatalf("modify refund provider leg = %v — want clearing DR %d / wallet CR %d",
			provRef, provDraw, provDraw)
	}
	// Commission leg: DR commission → CR guest wallet for commDraw.
	commRef := resLegsForRef(t, ctx, f.pool, "stays:modify:refund:"+res.ID+":commission")
	if commRef["commission:DEBIT"] != commDraw || commRef["user_wallet:CREDIT"] != commDraw {
		t.Fatalf("modify refund commission leg = %v — want commission DR %d / wallet CR %d",
			commRef, commDraw, commDraw)
	}
	// No escrow draw — everything settled, nothing left held.
	if esc := resLegsForRef(t, ctx, f.pool, "stays:modify:refund:"+res.ID+":escrow"); len(esc) != 0 {
		t.Fatalf("modify refund touched escrow %v — the settled money is parked, not held", esc)
	}
	// Guest wallet gained exactly the price delta.
	if got := walletBalance(t, ctx, f.pool, f.guest) - walletBefore; got != refund {
		t.Fatalf("modify refund credited %d, want %d", got, refund)
	}
	// The re-priced reservation persisted the new split.
	got, err := f.svc.Get(ctx, f.guest, res.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.GrossAmountKobo != gross3 || got.CommissionKobo != comm3 {
		t.Fatalf("post-modify amounts = gross %d / commission %d, want %d / %d",
			got.GrossAmountKobo, got.CommissionKobo, gross3, comm3)
	}
}

// Modify-down that drops gross but RAISES the platform share: the guest refund
// comes entirely from provider_clearing plus a balancing clearing→commission
// transfer, and a later cancel allocates against the residual ledger-backed
// balances, not stale settlement-row totals.
func TestLiveDB_ModifyDownRebalance_CancelUsesResidualAllocation(t *testing.T) {
	ctx := context.Background()
	const net1, tax1 = int64(1_000_000), int64(300_000) // gross1 = 1,300,000
	const net2, tax2 = int64(1_200_000), int64(50_000)  // gross2 = 1,250,000
	const gross1, gross2 = net1 + tax1, net2 + tax2
	const comm1, comm2 = int64(150_000), int64(180_000)   // commission GREW
	const guestRefund = gross1 - gross2                   // 50,000
	const provDelta = (gross2 - comm2) - (gross1 - comm1) // -80,000
	const rebalance = comm2 - comm1                       // +30,000

	f := newSagaFixture(t, ctx,
		[]gateway.PrebookResult{
			{BookToken: "tok-1", NetRateKobo: net1, TaxKobo: tax1, Currency: "NGN", CancellationPolicy: map[string]any{"refundable": true}},
			{BookToken: "tok-2", NetRateKobo: net2, TaxKobo: tax2, Currency: "NGN", CancellationPolicy: map[string]any{"refundable": true}},
		},
		gateway.Reservation{SupplierRef: "FAKE-" + uuid.NewString()[:12], Status: gateway.ResStatusConfirmed},
		gateway.Cancellation{Status: "cancelled", RefundKobo: gross2})

	res := f.book(t, ctx)
	walletBefore := walletBalance(t, ctx, f.pool, f.guest)

	newIn := time.Now().Add(144 * time.Hour)
	newOut := time.Now().Add(192 * time.Hour)
	if _, err := f.svc.Modify(ctx, f.guest, res.ID, "mod-"+uuid.NewString(), newIn, newOut); err != nil {
		t.Fatalf("Modify: %v", err)
	}

	// Guest leg — funded ENTIRELY by provider_clearing (the platform share grew,
	// so the provider leg is what actually shrank by 80,000 = refund + rebalance).
	prov := resLegsForRef(t, ctx, f.pool, "stays:modify:refund:"+res.ID+":provider")
	if prov["provider_clearing:DEBIT"] != guestRefund || prov["user_wallet:CREDIT"] != guestRefund {
		t.Fatalf("modify provider leg = %v, want guest refund %d from clearing", prov, guestRefund)
	}
	// No commission guest leg (the platform share grew — nothing returns to the
	// guest from it) and no escrow draw (settled leg covered it).
	if c := resLegsForRef(t, ctx, f.pool, "stays:modify:refund:"+res.ID+":commission"); len(c) != 0 {
		t.Fatalf("unexpected commission guest leg: %v", c)
	}
	// Balancing transfer: DR provider_clearing / CR commission so parked totals
	// match the re-priced split.
	reb := resLegsForRef(t, ctx, f.pool, "stays:modify:refund:"+res.ID+":rebalance:commission")
	if reb["provider_clearing:DEBIT"] != rebalance || reb["commission:CREDIT"] != rebalance {
		t.Fatalf("rebalance leg = %v, want clearing→commission %d", reb, rebalance)
	}
	if got := walletBalance(t, ctx, f.pool, f.guest) - walletBefore; got != guestRefund {
		t.Fatalf("wallet delta after modify = %d, want %d", got, guestRefund)
	}

	// ── F-1: cancel the re-priced booking. Residual parked balances are now
	// provider 1,070,000 / commission 180,000 (row totals still read the stale
	// 1,150,000 / 150,000). The refund must draw the residual legs — the stale
	// allocation (≈1,105,769 / 144,231) would over-draw pooled clearing.
	if _, err := f.svc.Cancel(ctx, f.guest, res.ID, "cancel after modify"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	wantProv := gross2 - comm2 // 1,070,000 residual
	provLeg := resLegsForRef(t, ctx, f.pool, "stays:refund:"+res.ID+":provider")
	if provLeg["provider_clearing:DEBIT"] != wantProv || provLeg["user_wallet:CREDIT"] != wantProv {
		t.Fatalf("cancel provider leg = %v, want residual %d (stale totals over-draw clearing)", provLeg, wantProv)
	}
	commLeg := resLegsForRef(t, ctx, f.pool, "stays:refund:"+res.ID+":commission")
	if commLeg["commission:DEBIT"] != comm2 || commLeg["user_wallet:CREDIT"] != comm2 {
		t.Fatalf("cancel commission leg = %v, want residual %d", commLeg, comm2)
	}
	if got, want := walletBalance(t, ctx, f.pool, f.guest), int64(3_000_000); got != want {
		t.Fatalf("final wallet = %d, want %d (gross1 paid, guestRefund+gross2 back)", got, want)
	}
	_ = provDelta // documented in the comment above
}

// A cancel that posted its escrow reversal but crashed before the terminal
// transition must converge on retry — 'refunded' rows still count as parked and
// the reversal no-ops under its own key.
func TestLiveDB_CancelRetryAfterPartialEscrowRelease_Converges(t *testing.T) {
	ctx := context.Background()
	const gross = int64(900_000)

	run := func(t *testing.T, flipRow bool) {
		t.Helper()
		f := newSagaFixture(t, ctx,
			[]gateway.PrebookResult{
				{BookToken: "tok-1", NetRateKobo: gross, TaxKobo: 0, Currency: "NGN", CancellationPolicy: map[string]any{"refundable": true}},
			},
			gateway.Reservation{SupplierRef: "FAKE-" + uuid.NewString()[:12], Status: gateway.ResStatusConfirmed},
			gateway.Cancellation{Status: "cancelled", RefundKobo: gross})

		// Seed a CONFIRMED reservation + its escrowed settlement directly (the
		// fake book() path is irrelevant here — Cancel only needs the row).
		resID := uuid.NewString()
		if _, err := f.pool.Exec(ctx, `
			INSERT INTO public.stays_reservation
				(id, guest_user_id, property_id, room_type_id, rate_plan_id, source_rail, supplier_code, supplier_ref, state,
				 check_in, check_out, rooms, currency, gross_amount_kobo, net_rate_kobo,
				 payment_method, cancellation_policy_snapshot, idempotency_key, book_token_ref, voucher_ref)
			VALUES ($8::uuid, $1, $2::uuid, $9::uuid, $10::uuid, 'DIRECT', 'self', $3, 'CONFIRMED', $4::date, $5::date, 1, 'NGN', $6, $6,
			        'WALLET', '{"refundable":true}'::jsonb, $7, 'tok', 'vch')`,
			f.guest, f.propID, "DIR-"+uuid.NewString()[:12],
			time.Now().Add(72*time.Hour).Format("2006-01-02"),
			time.Now().Add(96*time.Hour).Format("2006-01-02"),
			gross, "wedge-"+uuid.NewString(), resID, uuid.NewString(), uuid.NewString()); err != nil {
			t.Fatalf("seed reservation: %v", err)
		}
		finSettle := finsettlement.NewService(f.pool, f.ledgerSvc)
		sett, err := finSettle.Escrow(ctx, f.guest, "stays:"+resID, "wedge-hold-"+uuid.NewString(), "stays", gross)
		if err != nil {
			t.Fatalf("Escrow: %v", err)
		}

		// Simulate the crashed attempt-1: the escrow reversal already posted
		// under the cancel refund's own key (attempt-1 and the retry share it).
		wallet, err := f.ledgerSvc.GetOrCreateUserWallet(ctx, f.guest)
		if err != nil {
			t.Fatalf("wallet: %v", err)
		}
		escrowAcc, err := f.ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
		if err != nil {
			t.Fatalf("escrow: %v", err)
		}
		if err := f.ledgerSvc.PostReversal(ctx, wallet.ID, escrowAcc.ID, gross,
			"stays:refund:"+resID+":escrow",
			// The amount-bound key shape postRefundLegs derives (G-5).
			fmt.Sprintf("stays:cancel:%s:refund:escrow:%d", resID, gross)); err != nil {
			t.Fatalf("simulate posted reversal: %v", err)
		}
		if flipRow {
			if _, err := f.pool.Exec(ctx,
				`UPDATE public.settlements SET status='refunded' WHERE id = $1`, sett.ID); err != nil {
				t.Fatalf("simulate flipped row: %v", err)
			}
		}

		// The retry must converge: no error, terminal state, no double credit.
		if _, err := f.svc.Cancel(ctx, f.guest, resID, "retry after crash"); err != nil {
			t.Fatalf("Cancel retry must converge (F-3 wedge): %v", err)
		}
		res, err := f.svc.Get(ctx, f.guest, resID)
		if err != nil {
			t.Fatalf("Get: %v", err)
		}
		if res.State != "CANCELLED_BY_GUEST" {
			t.Fatalf("state = %s, want CANCELLED_BY_GUEST", res.State)
		}
		var status string
		if err := f.pool.QueryRow(ctx,
			`SELECT status FROM public.settlements WHERE id = $1`, sett.ID).Scan(&status); err != nil {
			t.Fatalf("sett status: %v", err)
		}
		if status != "refunded" {
			t.Fatalf("settlement status = %s, want refunded", status)
		}
		if got, want := walletBalance(t, ctx, f.pool, f.guest), int64(3_000_000); got != want {
			t.Fatalf("wallet = %d, want %d — a double escrow credit over-pays the guest", got, want)
		}
	}

	t.Run("PostedAndFlipped", func(t *testing.T) { run(t, true) })
	t.Run("PostedNotFlipped", func(t *testing.T) { run(t, false) })
}

// A PAID hotel payout drew provider_clearing — the residual map nets that draw
// so a later cancel refunds only what remains parked.
func TestLiveDB_CancelAfterPaidPayout_ResidualExcludesPaidAmount(t *testing.T) {
	ctx := context.Background()
	const netRate = int64(1_000_000)
	const tax = int64(100_000)
	const gross = netRate + tax       // 1_100_000
	const commission = int64(150_000) // 15% of net
	const providerNet = gross - commission
	const payout = int64(400_000)
	// After the payout: residual = (950k − 400k) + 150k = 700k. The policy refund
	// drains exactly the residual — G-1 asserts the provider leg is 550k, not
	// the ~604k the stale row totals would have produced.
	const refundKobo = int64(700_000)
	const wantProviderLeg = providerNet - payout // 550_000

	f := newSagaFixture(t, ctx,
		[]gateway.PrebookResult{{
			BookToken: "tok-1", NetRateKobo: netRate, TaxKobo: tax, Currency: "NGN",
			CancellationPolicy: map[string]any{"refundable": true},
		}},
		gateway.Reservation{SupplierRef: "FAKE-" + uuid.NewString()[:12], Status: gateway.ResStatusConfirmed},
		gateway.Cancellation{Status: "cancelled", RefundKobo: refundKobo})

	res := f.book(t, ctx)

	// The payout release needs a COMPLETED stay on the property (fraud gate) —
	// seed one on the same internal property id.
	if _, err := f.pool.Exec(ctx, `
		INSERT INTO public.stays_reservation
			(guest_user_id, property_id, source_rail, supplier_code, supplier_ref, state,
			 check_in, check_out, rooms, currency, gross_amount_kobo, net_rate_kobo,
			 payment_method, cancellation_policy_snapshot, idempotency_key)
		VALUES ($1, $2::uuid, 'DIRECT', 'self', $3, 'COMPLETED',
		        '2026-01-01'::date, '2026-01-03'::date, 1, 'NGN', 100000, 100000,
		        'WALLET', '{}'::jsonb, $4)`,
		f.guest, f.propID, "DIR-"+uuid.NewString()[:12], "completed-"+uuid.NewString()); err != nil {
		t.Fatalf("seed completed stay: %v", err)
	}
	payoutID, err := f.settleSvc.QueuePayout(ctx, f.propID, f.hotelier, res.ID, payout, "pq-"+uuid.NewString())
	if err != nil {
		t.Fatalf("QueuePayout: %v", err)
	}
	if _, err := f.settleSvc.ReleasePayout(ctx, payoutID); err != nil {
		t.Fatalf("ReleasePayout: %v", err)
	}
	if st := payoutStatus(t, f.pool, payoutID); st != "PAID" {
		t.Fatalf("payout status = %q, want PAID", st)
	}
	if got := walletBalance(t, ctx, f.pool, f.hotelier); got != payout {
		t.Fatalf("hotelier wallet = %d, want %d paid", got, payout)
	}

	if _, err := f.svc.Cancel(ctx, f.guest, res.ID, "cancel after payout"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}

	// The provider leg drew only the RESIDUAL 550k — the 400k the payout already
	// paid the hotelier is NOT refunded to the guest out of pooled clearing.
	prov := resLegsForRef(t, ctx, f.pool, "stays:refund:"+res.ID+":provider")
	if prov["provider_clearing:DEBIT"] != wantProviderLeg || prov["user_wallet:CREDIT"] != wantProviderLeg {
		t.Fatalf("refund provider leg = %v, want residual %d — the paid payout must be netted (G-1)",
			prov, wantProviderLeg)
	}
	comm := resLegsForRef(t, ctx, f.pool, "stays:refund:"+res.ID+":commission")
	if comm["commission:DEBIT"] != commission || comm["user_wallet:CREDIT"] != commission {
		t.Fatalf("refund commission leg = %v, want %d", comm, commission)
	}
	if got, want := walletBalance(t, ctx, f.pool, f.guest), int64(3_000_000)-gross+refundKobo; got != want {
		t.Fatalf("guest wallet = %d, want %d (paid out gross, got residual refund)", got, want)
	}
	// Hotelier keeps the 400k — a paid payout stays paid (ops clawback is a
	// separate process); the residual math is what stops the double-pay.
	if got := walletBalance(t, ctx, f.pool, f.hotelier); got != payout {
		t.Fatalf("hotelier wallet after cancel = %d, want %d (paid payout is not unwound)", got, payout)
	}
}

// Admin commission journals (accrue/reverse) move money between the same
// parked legs — the residual map must net both directions.
func TestLiveDB_CancelAfterCommissionJournal_NetsAdminMovement(t *testing.T) {
	ctx := context.Background()
	const netRate = int64(1_000_000)
	const tax = int64(100_000)
	const gross = netRate + tax
	const commission = int64(150_000)
	const providerNet = gross - commission
	const accrual = int64(100_000)

	run := func(t *testing.T, reverse bool) (int64, int64) {
		t.Helper()
		f := newSagaFixture(t, ctx,
			[]gateway.PrebookResult{{
				BookToken: "tok-1", NetRateKobo: netRate, TaxKobo: tax, Currency: "NGN",
				CancellationPolicy: map[string]any{"refundable": true},
			}},
			gateway.Reservation{SupplierRef: "FAKE-" + uuid.NewString()[:12], Status: gateway.ResStatusConfirmed},
			gateway.Cancellation{Status: "cancelled", RefundKobo: gross})

		res := f.book(t, ctx)

		// Admin accrual: +100k commission out of provider_clearing → residual
		// becomes provider 850k / commission 250k.
		if _, err := f.settleSvc.AccrueCommission(ctx, res.ID, accrual, "acc-"+uuid.NewString()); err != nil {
			t.Fatalf("AccrueCommission: %v", err)
		}
		if reverse {
			// Reversal puts the 100k back → residual returns to (950k, 150k).
			if _, err := f.settleSvc.ReverseCommission(ctx, res.ID, "rev-"+uuid.NewString()); err != nil {
				t.Fatalf("ReverseCommission: %v", err)
			}
		}

		if _, err := f.svc.Cancel(ctx, f.guest, res.ID, "cancel after commission journal"); err != nil {
			t.Fatalf("Cancel: %v", err)
		}
		wantProvider, wantFee := providerNet-accrual, commission+accrual
		if reverse {
			wantProvider, wantFee = providerNet, commission
		}
		prov := resLegsForRef(t, ctx, f.pool, "stays:refund:"+res.ID+":provider")
		if prov["provider_clearing:DEBIT"] != wantProvider || prov["user_wallet:CREDIT"] != wantProvider {
			t.Fatalf("refund provider leg = %v, want residual %d (accrual must shift the residual, G-2)",
				prov, wantProvider)
		}
		comm := resLegsForRef(t, ctx, f.pool, "stays:refund:"+res.ID+":commission")
		if comm["commission:DEBIT"] != wantFee || comm["user_wallet:CREDIT"] != wantFee {
			t.Fatalf("refund commission leg = %v, want residual %d", comm, wantFee)
		}
		if got, want := walletBalance(t, ctx, f.pool, f.guest), int64(3_000_000); got != want {
			t.Fatalf("guest wallet = %d, want %d — full refund must restore the gross", got, want)
		}
		return wantProvider, wantFee
	}

	t.Run("AccrualShiftsResidual", func(t *testing.T) { run(t, false) })
	t.Run("AccrualPlusReversalRestoresResidual", func(t *testing.T) { run(t, true) })
}

// A retried cancel whose residual shifted between attempts posts the REMAINING
// refund under fresh amount-bound keys — attempt-1's 400k orphan + an
// interleaved 100k draw leave 600k to post. D-1: the allocation runs against
// the residual NET OF ALL DRAWS (950k−400k−100k = 450k provider, 150k
// commission), so the retry posts 450k/150k — NOT the 510k/90k the old
// own-draw-excluded residual produced, which over-drew the pooled provider
// bucket (1,010k drawn vs 950k parked).
func TestLiveDB_CancelRetryAfterShiftedResidual_TopsUpToPolicy(t *testing.T) {
	ctx := context.Background()
	const netRate = int64(1_000_000)
	const tax = int64(100_000)
	const gross = netRate + tax
	const commission = int64(150_000)
	const providerNet = gross - commission // 950_000
	const policyRefund = int64(1_000_000)  // post-modify policy amount
	const orphanLeg = int64(400_000)       // attempt-1 provider leg (crash sim)
	const interleavedDraw = int64(100_000) // interleaved modify draw
	// remaining = 600k over residual NET of all draws (450k / 150k):
	const wantRetryProvider = int64(450_000)
	const wantRetryCommission = int64(150_000)

	f := newSagaFixture(t, ctx,
		[]gateway.PrebookResult{{
			BookToken: "tok-1", NetRateKobo: netRate, TaxKobo: tax, Currency: "NGN",
			CancellationPolicy: map[string]any{"refundable": true},
		}},
		gateway.Reservation{SupplierRef: "FAKE-" + uuid.NewString()[:12], Status: gateway.ResStatusConfirmed},
		gateway.Cancellation{Status: "cancelled", RefundKobo: policyRefund})

	res := f.book(t, ctx)

	clearingAcc, err := f.ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing: %v", err)
	}
	guestWallet, err := f.ledgerSvc.GetOrCreateUserWallet(ctx, f.guest)
	if err != nil {
		t.Fatalf("guest wallet: %v", err)
	}
	// Attempt-1 orphan: a provider leg posted under the cancel op's key with its
	// OWN amount bound in — the shape a crashed Cancel left behind.
	if err := f.ledgerSvc.PostJournal(ctx, ledger.JournalEntry{
		Reference:       "stays:refund:" + res.ID + ":provider",
		IdempotencyKey:  fmt.Sprintf("stays:cancel:%s:refund:provider:%d", res.ID, orphanLeg),
		AmountKobo:      orphanLeg,
		DebitAccountID:  clearingAcc.ID,
		CreditAccountID: guestWallet.ID,
	}); err != nil {
		t.Fatalf("seed attempt-1 leg: %v", err)
	}
	// Interleaved draw between attempts — a modify-refund shape that shifts the
	// provider residual before the retry recomputes.
	hotelWallet, err := f.ledgerSvc.GetOrCreateUserWallet(ctx, f.hotelier)
	if err != nil {
		t.Fatalf("hotelier wallet: %v", err)
	}
	if err := f.ledgerSvc.PostJournal(ctx, ledger.JournalEntry{
		Reference:       "stays:modify:refund:" + res.ID + ":provider",
		IdempotencyKey:  "modsim-" + uuid.NewString(),
		AmountKobo:      interleavedDraw,
		DebitAccountID:  clearingAcc.ID,
		CreditAccountID: hotelWallet.ID,
	}); err != nil {
		t.Fatalf("seed interleaved draw: %v", err)
	}

	if _, err := f.svc.Cancel(ctx, f.guest, res.ID, "retry after crash"); err != nil {
		t.Fatalf("Cancel retry: %v", err)
	}

	// The retry posted the REMAINING 600k under fresh amount-bound keys — the
	// stale 400k key was NOT silently reused for a different amount (G-5).
	for _, kv := range [][2]any{
		{fmt.Sprintf("stays:cancel:%s:refund:provider:%d", res.ID, wantRetryProvider), wantRetryProvider},
		{fmt.Sprintf("stays:cancel:%s:refund:commission:%d", res.ID, wantRetryCommission), wantRetryCommission},
	} {
		key := kv[0].(string)
		amount := kv[1].(int64)
		var cnt int
		if err := f.pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM public.ledger_entries WHERE idempotency_key = $1`, key+":debit").
			Scan(&cnt); err != nil {
			t.Fatalf("probe key %s: %v", key, err)
		}
		if cnt != 1 {
			t.Fatalf("expected retry leg under fresh key %s (%d) — amount-bound keys must re-post, not no-op", key, amount)
		}
	}
	// The cumulative provider draw across orphan + interleave + retry equals
	// EXACTLY the parked 950k — the pre-D-1 allocation would have drawn 1,010k
	// out of the pooled clearing account (spending another booking's money).
	var totalProviderDraw int64
	if err := f.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(le.amount_kobo),0)
		FROM public.ledger_entries le
		JOIN public.ledger_accounts a ON a.id = le.account_id
		WHERE a.user_id IS NULL AND a.type = 'provider_clearing' AND le.type = 'DEBIT'
		  AND (le.reference LIKE 'stays:refund:' || $1 || ':%'
		    OR le.reference LIKE 'stays:modify:refund:' || $1 || ':%')`,
		res.ID).Scan(&totalProviderDraw); err != nil {
		t.Fatalf("sum provider draws: %v", err)
	}
	if totalProviderDraw != providerNet {
		t.Fatalf("cumulative provider draw = %d, want parked %d — bucket-safe allocation (D-1)",
			totalProviderDraw, providerNet)
	}
	// Total returned to the guest = policy exactly: 400k orphan + 450k + 150k.
	var totalCredited int64
	if err := f.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(le.amount_kobo),0)
		FROM public.ledger_entries le
		JOIN public.ledger_accounts a ON a.id = le.account_id
		WHERE a.user_id = $1 AND a.type = 'user_wallet' AND le.type = 'CREDIT'
		  AND le.reference LIKE 'stays:refund:' || $2 || ':%'`,
		f.guest, res.ID).Scan(&totalCredited); err != nil {
		t.Fatalf("sum refund credits: %v", err)
	}
	if totalCredited != policyRefund {
		t.Fatalf("total guest refund = %d, want policy %d — retry must converge on policy, not drift",
			totalCredited, policyRefund)
	}
	// Wallet check: seed 3M − 1.1M escrow + 1.0M refund − 0 (the interleaved
	// draw went to the hotelier, not the guest).
	if got, want := walletBalance(t, ctx, f.pool, f.guest), int64(3_000_000)-gross+policyRefund; got != want {
		t.Fatalf("guest wallet = %d, want %d", got, want)
	}
	// D-4: the cancellation row records the ledger-truth TOTAL draws (policy),
	// not merely this attempt's 600k.
	var refundKobo int64
	if err := f.pool.QueryRow(ctx,
		`SELECT refund_kobo FROM public.stays_cancellation WHERE reservation_id = $1`, res.ID).Scan(&refundKobo); err != nil {
		t.Fatalf("cancellation row: %v", err)
	}
	if refundKobo != policyRefund {
		t.Fatalf("cancellation refund_kobo = %d, want %d — the row records total draws, not own-op legs (D-4)",
			refundKobo, policyRefund)
	}
}

// Penalty cancellation: only the refundable amount reaches the guest — the
// retained share stays parked (a known stranded-share gap, not fixed here).
func TestLiveDB_CancelWithPenalty_RetainsNonRefundableShare(t *testing.T) {
	ctx := context.Background()
	const gross = int64(1_100_000)
	const refund = int64(800_000)
	const penalty = gross - refund // 300,000 stays parked

	f := newSagaFixture(t, ctx,
		[]gateway.PrebookResult{
			{BookToken: "tok-1", NetRateKobo: gross, TaxKobo: 0, Currency: "NGN",
				CancellationPolicy: map[string]any{"refundable": true, "penalty_kobo": penalty}},
		},
		gateway.Reservation{SupplierRef: "FAKE-" + uuid.NewString()[:12], Status: gateway.ResStatusConfirmed},
		gateway.Cancellation{Status: "cancelled", RefundKobo: refund, PenaltyKobo: penalty})

	res := f.book(t, ctx)
	if _, err := f.svc.Cancel(ctx, f.guest, res.ID, "penalty cancel"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if got, want := walletBalance(t, ctx, f.pool, f.guest), int64(3_000_000)-penalty; got != want {
		t.Fatalf("wallet = %d, want %d — the retained penalty share must not be refunded", got, want)
	}
	// The refund legs total exactly the refundable amount (the residual 300,000
	// remains parked — the F-6 stranded-share gap, documented as backlog).
	prov := resLegsForRef(t, ctx, f.pool, "stays:refund:"+res.ID+":provider")
	comm := resLegsForRef(t, ctx, f.pool, "stays:refund:"+res.ID+":commission")
	held := resLegsForRef(t, ctx, f.pool, "stays:refund:"+res.ID+":escrow")
	total := prov["user_wallet:CREDIT"] + comm["user_wallet:CREDIT"] + held["user_wallet:CREDIT"]
	if total != refund {
		t.Fatalf("refund legs total %d, want %d (penalty %d retained)", total, refund, penalty)
	}
}

// ────────────────────────────────────────────────────────────────────────────
// PIN D-3: a crash after the commission journal posted but before
// RecordCommissionDelta ran leaves the leg paid but the domain REVERSAL row
// missing — and a later admin ReverseCommission then re-reverses kobo the
// guest already got back. The converge path (remaining == 0) must back-fill
// the delta deterministically from the posted leg's amount-bound key.
// ────────────────────────────────────────────────────────────────────────────
func TestLiveDB_CancelConverge_RecoversMissingCommissionDelta(t *testing.T) {
	ctx := context.Background()
	const netRate = int64(1_000_000)
	const tax = int64(100_000)
	const gross = netRate + tax
	const commission = int64(150_000)
	const providerNet = gross - commission

	f := newSagaFixture(t, ctx,
		[]gateway.PrebookResult{{
			BookToken: "tok-1", NetRateKobo: netRate, TaxKobo: tax, Currency: "NGN",
			CancellationPolicy: map[string]any{"refundable": true},
		}},
		gateway.Reservation{SupplierRef: "FAKE-" + uuid.NewString()[:12], Status: gateway.ResStatusConfirmed},
		gateway.Cancellation{Status: "cancelled", RefundKobo: gross})

	res := f.book(t, ctx)

	clearingAcc, err := f.ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing: %v", err)
	}
	commissionAcc, err := f.ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		t.Fatalf("commission: %v", err)
	}
	guestWallet, err := f.ledgerSvc.GetOrCreateUserWallet(ctx, f.guest)
	if err != nil {
		t.Fatalf("guest wallet: %v", err)
	}

	// Simulated crashed attempt-1: BOTH refund legs posted under the cancel
	// family's amount-bound keys — provider AND commission — but the process
	// died before RecordCommissionDelta, so stays_commission_entry is empty.
	// The retry sees draws == policy ⇒ the converge path (remaining == 0),
	// which used to return without writing the missing delta (D-3).
	for _, leg := range []ledger.JournalEntry{
		{
			Reference:       "stays:refund:" + res.ID + ":provider",
			IdempotencyKey:  fmt.Sprintf("stays:cancel:%s:refund:provider:%d", res.ID, providerNet),
			AmountKobo:      providerNet,
			DebitAccountID:  clearingAcc.ID,
			CreditAccountID: guestWallet.ID,
		},
		{
			Reference:       "stays:refund:" + res.ID + ":commission",
			IdempotencyKey:  fmt.Sprintf("stays:cancel:%s:refund:commission:%d", res.ID, commission),
			AmountKobo:      commission,
			DebitAccountID:  commissionAcc.ID,
			CreditAccountID: guestWallet.ID,
		},
	} {
		if err := f.ledgerSvc.PostJournal(ctx, leg); err != nil {
			t.Fatalf("seed orphan leg %s: %v", leg.Reference, err)
		}
	}
	var preRows int
	if err := f.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM public.stays_commission_entry WHERE reservation_id = $1`, res.ID).Scan(&preRows); err != nil {
		t.Fatalf("pre-count: %v", err)
	}
	if preRows != 0 {
		t.Fatalf("precondition: %d commission rows — the crash sim must leave the delta unrecorded", preRows)
	}

	if _, err := f.svc.Cancel(ctx, f.guest, res.ID, "retry after crash"); err != nil {
		t.Fatalf("Cancel converge: %v", err)
	}

	// The missing REVERSAL row was back-filled under the delta key DERIVED from
	// the posted leg's amount-bound key — the same key the live path writes.
	deltaKey := fmt.Sprintf("stays:cancel:%s:refund:commission:entry:%d", res.ID, commission)
	var amt int64
	var kind string
	if err := f.pool.QueryRow(ctx, `
		SELECT amount_kobo, kind FROM public.stays_commission_entry
		WHERE reservation_id = $1 AND idempotency_key = $2`, res.ID, deltaKey).
		Scan(&amt, &kind); err != nil {
		t.Fatalf("recovered delta row: %v — converge path must back-fill the lost RecordCommissionDelta (D-3)", err)
	}
	if amt != -commission || kind != "REVERSAL" {
		t.Fatalf("recovered delta = %d %s, want %d REVERSAL", amt, kind, -commission)
	}

	// And the payoff: an admin ReverseCommission now reads net ≤ 0 and is a
	// no-op — it can no longer re-reverse the share the guest got back.
	revID, err := f.settleSvc.ReverseCommission(ctx, res.ID, "rev-"+uuid.NewString())
	if err != nil {
		t.Fatalf("ReverseCommission: %v", err)
	}
	if revID != "" {
		t.Fatalf("ReverseCommission wrote entry %s — the guest's reversed share must not double-reverse", revID)
	}
	var commNet int64
	if err := f.pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_kobo),0) FROM public.stays_commission_entry WHERE reservation_id = $1`,
		res.ID).Scan(&commNet); err != nil {
		t.Fatalf("commission net: %v", err)
	}
	if commNet != -commission {
		t.Fatalf("commission domain net = %d, want %d — reversal recorded exactly once", commNet, -commission)
	}
}

// ────────────────────────────────────────────────────────────────────────────
// PIN D-4: one cancellation row per reservation, recorded ONCE (idempotent
// check-then-insert — a retried cancel must not append a second row), and
// refund_kobo carries the ledger-truth total of the booking's cancel-refund
// draws rather than merely this attempt's computation.
// ────────────────────────────────────────────────────────────────────────────
func TestLiveDB_Cancel_RecordsSingleCancellationRow(t *testing.T) {
	ctx := context.Background()
	const netRate = int64(1_000_000)
	const tax = int64(100_000)
	const gross = netRate + tax

	f := newSagaFixture(t, ctx,
		[]gateway.PrebookResult{{
			BookToken: "tok-1", NetRateKobo: netRate, TaxKobo: tax, Currency: "NGN",
			CancellationPolicy: map[string]any{"refundable": true},
		}},
		gateway.Reservation{SupplierRef: "FAKE-" + uuid.NewString()[:12], Status: gateway.ResStatusConfirmed},
		gateway.Cancellation{Status: "cancelled", RefundKobo: gross})

	res := f.book(t, ctx)
	if _, err := f.svc.Cancel(ctx, f.guest, res.ID, "dedup cancel"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}

	var cnt int
	var refundKobo int64
	if err := f.pool.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(SUM(refund_kobo),0) FROM public.stays_cancellation
		WHERE reservation_id = $1`, res.ID).Scan(&cnt, &refundKobo); err != nil {
		t.Fatalf("cancellation rows: %v", err)
	}
	if cnt != 1 {
		t.Fatalf("cancellation rows = %d, want exactly 1 — no duplicate inserts (D-4)", cnt)
	}
	if refundKobo != gross {
		t.Fatalf("cancellation refund_kobo = %d, want %d (ledger-truth draw total)", refundKobo, gross)
	}

	// A second record attempt for the same reservation — the shape a retried
	// saga produces — is a no-op, not a duplicate row.
	repo := reservation.NewRepository(f.pool)
	if err := repo.RecordCancellation(ctx, res.ID, "retry dup", gross, 0,
		res.CancellationPolicy, "stays:refund:"+res.ID); err != nil {
		t.Fatalf("RecordCancellation retry: %v", err)
	}
	if err := f.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM public.stays_cancellation WHERE reservation_id = $1`, res.ID).Scan(&cnt); err != nil {
		t.Fatalf("recount: %v", err)
	}
	if cnt != 1 {
		t.Fatalf("cancellation rows after retry = %d, want 1 — check-then-insert dedup failed", cnt)
	}
}

// F1 (audit): Book's escrow hold used to run settlement.Escrow — an UNGATED
// wallet debit. It now goes through settlement.EscrowWithGuard +
// EnforceCheckoutDebitLimitTx: the consumer-purchase daily-cap variant
// evaluated INSIDE the escrow tx under the wallet advisory lock. This pins:
//   - a Tier-0 guest is refused when the checkout allowance is OFF (the
//     fixture's default tiers svc — fail closed, no wallet debit);
//   - a Tier-1 guest whose daily cap is already consumed is refused with
//     tiers.ErrDailyLimitExceeded before the supplier booking attempt;
//   - an unwired tier gate fails closed on reservation.ErrTierGateUnwired.
func TestLiveDB_Book_CheckoutGateRefusesTier0AndOverCap(t *testing.T) {
	ctx := context.Background()
	const netRate = int64(1_000_000) // ₦10,000
	const tax = int64(100_000)
	const gross = netRate + tax

	f := newSagaFixture(t, ctx,
		[]gateway.PrebookResult{{
			BookToken:          "tok-tg",
			NetRateKobo:        netRate,
			TaxKobo:            tax,
			Currency:           "NGN",
			CancellationPolicy: map[string]any{"refundable": true},
		}},
		gateway.Reservation{SupplierRef: "FAKE-" + uuid.NewString()[:12], Status: gateway.ResStatusConfirmed},
		gateway.Cancellation{Status: "cancelled", RefundKobo: gross})

	prebook := func(svc *reservation.Service) *reservation.Reservation {
		t.Helper()
		pre, err := svc.Prebook(ctx, f.guest, reservation.PrebookInput{
			Rail:         gateway.RailDirect,
			SupplierCode: "self",
			PropertyID:   f.propID,
			RoomTypeID:   uuid.NewString(),
			RatePlanID:   uuid.NewString(),
			CheckIn:      time.Now().Add(72 * time.Hour),
			CheckOut:     time.Now().Add(120 * time.Hour),
			Rooms:        1,
			Currency:     "NGN",
		})
		if err != nil {
			t.Fatalf("Prebook: %v", err)
		}
		return pre.Reservation
	}
	gi := gateway.GuestInfo{FirstName: "T", LastName: "G"}

	// (a) Tier-0 guest + checkout allowance OFF → the gated hold refuses.
	testsupport.SetKycTier(t, ctx, f.pool, f.guest, 0)
	res := prebook(f.svc)
	_, err := f.svc.Book(ctx, f.guest, res.ID, "tok-tg", "tg-t0-"+uuid.NewString(), gi)
	if err == nil {
		t.Fatal("Tier-0 book with the checkout allowance off must refuse")
	}
	if !errors.Is(err, reservation.ErrInsufficient) {
		t.Fatalf("Tier-0 refusal must wrap ErrInsufficient, got %v", err)
	}
	if !errors.Is(err, tiers.ErrWalletDisabled) && !errors.Is(err, tiers.ErrCheckoutAllowanceExceeded) {
		t.Fatalf("Tier-0 refusal must carry a tier sentinel, got %v", err)
	}
	if got, want := walletBalance(t, ctx, f.pool, f.guest), int64(3_000_000); got != want {
		t.Fatalf("Tier-0 refusal moved money: wallet = %d, want %d", got, want)
	}

	// (b) Unwired tier gate fails CLOSED — never a plain ungated escrow.
	depsUnwired := f.deps
	depsUnwired.Tiers = nil
	svcUnwired := reservation.NewService(depsUnwired)
	res = prebook(svcUnwired)
	if _, err := svcUnwired.Book(ctx, f.guest, res.ID, "tok-tg", "tg-unwired-"+uuid.NewString(), gi); !errors.Is(err, reservation.ErrTierGateUnwired) {
		t.Fatalf("unwired gate must fail closed on ErrTierGateUnwired, got %v", err)
	}

	// (c) Tier-1 guest whose ₦50,000/day cap is already consumed — the hold
	// refuses with ErrDailyLimitExceeded before any supplier call.
	testsupport.SetKycTier(t, ctx, f.pool, f.guest, 1)
	clearing, err := f.ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}
	if err := f.ledgerSvc.Credit(ctx, f.guest, "seed:wallet:topup:"+uuid.NewString(),
		"seed-topup-"+uuid.NewString(), clearing.ID, 10_000_000); err != nil {
		t.Fatalf("top up wallet: %v", err)
	}
	tiersSvc := tiers.NewService(f.pool)
	if err := f.ledgerSvc.DebitWithGuard(ctx, f.guest, "cap-consume", "cap-consume-"+uuid.NewString(),
		clearing.ID, 5_000_000, tiersSvc.EnforceWalletDebitLimitTx); err != nil {
		t.Fatalf("consume daily cap: %v", err)
	}
	res = prebook(f.svc)
	_, err = f.svc.Book(ctx, f.guest, res.ID, "tok-tg", "tg-cap-"+uuid.NewString(), gi)
	if !errors.Is(err, tiers.ErrDailyLimitExceeded) {
		t.Fatalf("over-cap book must fail on ErrDailyLimitExceeded, got %v", err)
	}
	if !errors.Is(err, reservation.ErrInsufficient) {
		t.Fatalf("over-cap refusal must wrap ErrInsufficient, got %v", err)
	}
}
