package healthlab

// Live-DB coverage for server-side order pricing: package pricing and the
// home-visit fee. The invariant under test is the money one — what the escrow
// holds equals the order total equals the sum of its lines plus the home fee,
// and the client supplies no amount at all. Skips without TEST_DATABASE_URL.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

type pricingFixture struct {
	svc                    *Service
	led                    *ledger.Service
	pool                   *pgxpool.Pool
	patient, owner, lab    string
	fbc, lipid, lft        string // test ids at the lab (650_00, 950_00, 880_00)
	basicPkg               string // package of fbc+lipid+lft priced 2_200_00
	otherLab, otherLabTest string
	otherLabPkg            string
}

func seedPriceTest(t *testing.T, ctx context.Context, pool *pgxpool.Pool, lab, code string, kobo int64, active bool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO lab_tests (id, lab_provider_id, code, name, price_kobo, active) VALUES ($1,$2,$3,$4,$5,$6)`,
		id, lab, code, code+" test", kobo, active); err != nil {
		t.Fatalf("seed test: %v", err)
	}
	return id
}

func seedPricePackage(t *testing.T, ctx context.Context, pool *pgxpool.Pool, lab string, kobo int64, active bool, tests ...string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO lab_packages (id, lab_provider_id, name, price_kobo, test_ids, active) VALUES ($1,$2,'Basic check',$3,$4,$5)`,
		id, lab, kobo, tests, active); err != nil {
		t.Fatalf("seed package: %v", err)
	}
	return id
}

func newPricingFixture(t *testing.T) (*pricingFixture, context.Context) {
	pool := listEndpointsLivePool(t)
	ctx := t.Context()
	f := &pricingFixture{pool: pool}
	// The REAL escrow and ledger: the tests assert against the money tables, not a fake.
	f.led = ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	f.svc = NewService(pool, labUnwindEscrow{e: escrow.NewService(pool, f.led, nil)}, nil, nil, nil, nil, nil, nil)
	f.patient, f.owner = uuid.NewString(), uuid.NewString()
	other := uuid.NewString()
	for _, u := range []string{f.patient, f.owner, other} {
		seedLabTestUser(t, ctx, pool, u)
	}
	testsupport.SetKycTier(t, ctx, pool, f.patient, testsupport.KycTierUnlimited)
	revAcc, err := f.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing account: %v", err)
	}
	if err := f.led.Credit(ctx, f.patient, "lab-pricing-seed", "lab-pricing-fund-"+uuid.NewString(), revAcc.ID, 50_000_00); err != nil {
		t.Fatalf("fund patient wallet: %v", err)
	}
	f.lab = seedDirLab(t, ctx, pool, f.owner, true, true, "APPROVED") // home fee 250_000 kobo
	f.otherLab = seedDirLab(t, ctx, pool, other, true, true, "APPROVED")
	f.fbc = seedPriceTest(t, ctx, pool, f.lab, "FBC", 650_00, true)
	f.lipid = seedPriceTest(t, ctx, pool, f.lab, "LIPID", 950_00, true)
	f.lft = seedPriceTest(t, ctx, pool, f.lab, "LFT", 880_00, true)
	f.basicPkg = seedPricePackage(t, ctx, pool, f.lab, 2_200_00, true, f.fbc, f.lipid, f.lft)
	f.otherLabTest = seedPriceTest(t, ctx, pool, f.otherLab, "FBC", 700_00, true)
	f.otherLabPkg = seedPricePackage(t, ctx, pool, f.otherLab, 700_00, true, f.otherLabTest)
	t.Cleanup(func() {
		bg := context.WithoutCancel(t.Context())
		_, _ = pool.Exec(bg, `DELETE FROM lab_orders WHERE patient_id=$1`, f.patient)
	})
	return f, ctx
}

func (f *pricingFixture) in(method CollectionMethod, tests []string, pkgs []string) CreateOrderInput {
	return CreateOrderInput{
		LabProviderID: f.lab, CollectionMethod: method, IdempotencyKey: "price-" + uuid.NewString(),
		TestIDs: tests, PackageIDs: pkgs, CollectionAddress: "12 Ozumba Mbadiwe Ave",
	}
}

func TestLiveDB_Quote_TestsAndHomeFee(t *testing.T) {
	f, ctx := newPricingFixture(t)

	q, err := f.svc.QuoteOrder(ctx, f.in(CollectWalkIn, []string{f.fbc}, nil))
	if err != nil || q.TotalKobo != 650_00 || q.HomeFeeKobo != 0 || q.SubtotalKobo != 650_00 {
		t.Fatalf("a walk-in test is just its catalog price: %v %+v", err, q)
	}

	q, err = f.svc.QuoteOrder(ctx, f.in(CollectHome, []string{f.fbc, f.lipid}, nil))
	if err != nil {
		t.Fatal(err)
	}
	if q.SubtotalKobo != 1_600_00 || q.HomeFeeKobo != 250_000 || q.TotalKobo != 1_600_00+250_000 {
		t.Fatalf("a home order adds the lab's own visit fee exactly once: %+v", q)
	}
}

func TestLiveDB_Quote_HomeEligibility(t *testing.T) {
	f, ctx := newPricingFixture(t)
	if _, err := f.pool.Exec(ctx, `UPDATE lab_profiles SET supports_home_collection = false WHERE lab_provider_id = $1`, f.lab); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.QuoteOrder(ctx, f.in(CollectHome, []string{f.fbc}, nil)); !errors.Is(err, ErrHomeNotOffered) {
		t.Fatalf("a lab that does not offer home collection must refuse a home order, got %v", err)
	}
	if _, err := f.svc.QuoteOrder(ctx, f.in(CollectWalkIn, []string{f.fbc}, nil)); err != nil {
		t.Fatalf("walk-in is unaffected: %v", err)
	}

	// A lab with no profile row keeps the previous behaviour: home allowed, no fee.
	if _, err := f.pool.Exec(ctx, `DELETE FROM lab_profiles WHERE lab_provider_id = $1`, f.lab); err != nil {
		t.Fatal(err)
	}
	q, err := f.svc.QuoteOrder(ctx, f.in(CollectHome, []string{f.fbc}, nil))
	if err != nil || q.HomeFeeKobo != 0 || q.TotalKobo != 650_00 {
		t.Fatalf("no profile means no fee, not a refusal: %v %+v", err, q)
	}
}

func TestLiveDB_Quote_PackagePricing(t *testing.T) {
	f, ctx := newPricingFixture(t)

	q, err := f.svc.QuoteOrder(ctx, f.in(CollectWalkIn, nil, []string{f.basicPkg}))
	if err != nil {
		t.Fatal(err)
	}
	if q.TotalKobo != 2_200_00 || q.SubtotalKobo != 2_200_00 {
		t.Fatalf("a package costs its package price (not the sum of its tests): %+v", q)
	}
	if len(q.Lines) != 3 {
		t.Fatalf("a package expands to one line per test so results and release are unchanged, got %d lines", len(q.Lines))
	}
	var sum int64
	for _, l := range q.Lines {
		sum += l.UnitPriceKobo
		if l.PackageID == nil || *l.PackageID != f.basicPkg || l.UnitPriceKobo < 1 {
			t.Fatalf("each package line must record its package and a positive price: %+v", l)
		}
	}
	if sum != 2_200_00 {
		t.Fatalf("package lines must add up to the package price exactly, got %d", sum)
	}

	q, err = f.svc.QuoteOrder(ctx, f.in(CollectHome, nil, []string{f.basicPkg}))
	if err != nil || q.TotalKobo != 2_200_00+250_000 {
		t.Fatalf("package plus home fee: %v %+v", err, q)
	}
}

func TestLiveDB_Quote_PackageAndTestRefusals(t *testing.T) {
	f, ctx := newPricingFixture(t)

	if _, err := f.svc.QuoteOrder(ctx, f.in(CollectWalkIn, nil, []string{f.otherLabPkg})); err == nil {
		t.Fatal("a package from another lab must be refused")
	}
	if _, err := f.svc.QuoteOrder(ctx, f.in(CollectWalkIn, nil, []string{uuid.NewString()})); err == nil {
		t.Fatal("an unknown package must be refused")
	}
	inactive := seedPricePackage(t, ctx, f.pool, f.lab, 1_000_00, false, f.fbc)
	if _, err := f.svc.QuoteOrder(ctx, f.in(CollectWalkIn, nil, []string{inactive})); err == nil {
		t.Fatal("an inactive package must be refused")
	}
	deadTest := seedPriceTest(t, ctx, f.pool, f.lab, "OLD", 100_00, false)
	withDead := seedPricePackage(t, ctx, f.pool, f.lab, 900_00, true, f.fbc, deadTest)
	if _, err := f.svc.QuoteOrder(ctx, f.in(CollectWalkIn, nil, []string{withDead})); err == nil {
		t.Fatal("a package containing an inactive test must be refused")
	}
	if _, err := f.svc.QuoteOrder(ctx, f.in(CollectWalkIn, []string{f.fbc}, []string{f.basicPkg})); !errors.Is(err, ErrDuplicateItem) {
		t.Fatalf("a test already inside the package must not be charged twice, got %v", err)
	}
	if _, err := f.svc.QuoteOrder(ctx, f.in(CollectWalkIn, []string{f.fbc, f.fbc}, nil)); !errors.Is(err, ErrDuplicateItem) {
		t.Fatalf("the same test twice must be refused, got %v", err)
	}
	if _, err := f.svc.QuoteOrder(ctx, f.in(CollectWalkIn, nil, nil)); err == nil {
		t.Fatal("an empty order must be refused")
	}
}

func (f *pricingFixture) balance(t *testing.T, ctx context.Context) int64 {
	t.Helper()
	b, err := f.led.GetBalance(ctx, f.patient)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	return b
}

func (f *pricingFixture) holdCount(t *testing.T, ctx context.Context) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM escrow_holds WHERE payer_id = $1`, f.patient).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestLiveDB_CreateOrder_DebitsAndHoldsExactlyTheQuotedTotal(t *testing.T) {
	f, ctx := newPricingFixture(t)
	start := f.balance(t, ctx)

	// Overlap is refused before any money moves.
	if _, err := f.svc.CreateOrder(ctx, f.patient, f.in(CollectHome, []string{f.fbc}, []string{f.basicPkg})); !errors.Is(err, ErrDuplicateItem) {
		t.Fatalf("overlap must be refused before any money moves, got %v", err)
	}
	if f.balance(t, ctx) != start || f.holdCount(t, ctx) != 0 {
		t.Fatal("a refused order must not touch the wallet or create a hold")
	}

	in := f.in(CollectHome, nil, []string{f.basicPkg})
	o, err := f.svc.CreateOrder(ctx, f.patient, in)
	if err != nil {
		t.Fatal(err)
	}
	want := int64(2_200_00 + 250_000)
	if o.TotalKobo != want || o.HomeFeeKobo != 250_000 {
		t.Fatalf("order total %d (fee %d), want %d (fee 250000)", o.TotalKobo, o.HomeFeeKobo, want)
	}

	// The money tables agree: the patient was debited exactly the total, and the
	// escrow hold bound to the order is for exactly that amount.
	if got := start - f.balance(t, ctx); got != want {
		t.Fatalf("wallet debited %d, want exactly the quoted total %d", got, want)
	}
	var held int64
	var state string
	if err := f.pool.QueryRow(ctx, `SELECT h.amount_kobo, h.state FROM lab_orders o JOIN escrow_holds h ON h.id = o.escrow_id WHERE o.id = $1`, o.ID).Scan(&held, &state); err != nil {
		t.Fatal(err)
	}
	if held != want || state != "HELD" {
		t.Fatalf("escrow holds %d in state %s, want %d HELD", held, state, want)
	}

	// The persisted rows reconcile: total = lines + home fee.
	var total, fee, lines int64
	if err := f.pool.QueryRow(ctx, `SELECT total_kobo, home_fee_kobo FROM lab_orders WHERE id = $1`, o.ID).Scan(&total, &fee); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(ctx, `SELECT COALESCE(SUM(unit_price_kobo),0)::bigint FROM lab_order_lines WHERE order_id = $1`, o.ID).Scan(&lines); err != nil {
		t.Fatal(err)
	}
	if total != want || fee != 250_000 || lines+fee != total {
		t.Fatalf("total %d must equal lines %d + home fee %d", total, lines, fee)
	}

	// Replaying the same idempotency key returns the same order and debits nothing more.
	again, err := f.svc.CreateOrder(ctx, f.patient, in)
	if err != nil || again.ID != o.ID {
		t.Fatalf("replay must return the same order: %v", err)
	}
	if got := start - f.balance(t, ctx); got != want || f.holdCount(t, ctx) != 1 {
		t.Fatalf("replay must not debit or hold again: debited %d, holds %d", got, f.holdCount(t, ctx))
	}
}

func TestLiveDB_CreateOrder_WalkInUnchangedByHomeFee(t *testing.T) {
	f, ctx := newPricingFixture(t)
	start := f.balance(t, ctx)
	o, err := f.svc.CreateOrder(ctx, f.patient, f.in(CollectWalkIn, []string{f.lipid}, nil))
	if err != nil {
		t.Fatal(err)
	}
	if o.TotalKobo != 950_00 || o.HomeFeeKobo != 0 || start-f.balance(t, ctx) != 950_00 {
		t.Fatalf("walk-in holds exactly the test price: total %d, fee %d, debited %d", o.TotalKobo, o.HomeFeeKobo, start-f.balance(t, ctx))
	}
}

func TestLiveDB_CreateOrder_RefusesAStaleQuote(t *testing.T) {
	f, ctx := newPricingFixture(t)
	start := f.balance(t, ctx)

	in := f.in(CollectHome, []string{f.fbc}, nil)
	q, err := f.svc.QuoteOrder(ctx, in)
	if err != nil {
		t.Fatal(err)
	}

	// The lab raises the price after the patient saw the quote.
	if _, err := f.pool.Exec(ctx, `UPDATE lab_tests SET price_kobo = price_kobo + 10000 WHERE id = $1`, f.fbc); err != nil {
		t.Fatal(err)
	}
	stale := q.TotalKobo
	in.ExpectedTotalKobo = &stale
	_, err = f.svc.CreateOrder(ctx, f.patient, in)
	var changed *QuoteChangedError
	if !errors.As(err, &changed) || !errors.Is(err, ErrQuoteChanged) {
		t.Fatalf("a changed price must be refused with the new quote, got %v", err)
	}
	if changed.Quote.TotalKobo != q.TotalKobo+10000 {
		t.Fatalf("the refusal must carry the current total, got %d", changed.Quote.TotalKobo)
	}
	if f.balance(t, ctx) != start || f.holdCount(t, ctx) != 0 {
		t.Fatal("a stale quote must be refused before any money moves")
	}

	// Accepting the new figure succeeds, and holds exactly it.
	fresh := changed.Quote.TotalKobo
	in.ExpectedTotalKobo = &fresh
	o, err := f.svc.CreateOrder(ctx, f.patient, in)
	if err != nil || o.TotalKobo != fresh || start-f.balance(t, ctx) != fresh {
		t.Fatalf("the confirmed total must be held exactly: %v total=%d debited=%d", err, o.TotalKobo, start-f.balance(t, ctx))
	}
}

func TestLiveDB_OrderReads_KeepTheHomeFeeOnReplayAndCancel(t *testing.T) {
	f, ctx := newPricingFixture(t)
	in := f.in(CollectHome, []string{f.fbc}, nil)
	o, err := f.svc.CreateOrder(ctx, f.patient, in)
	if err != nil || o.HomeFeeKobo != 250_000 {
		t.Fatalf("create: %v fee=%d", err, o.HomeFeeKobo)
	}
	again, err := f.svc.CreateOrder(ctx, f.patient, in)
	if err != nil || again.HomeFeeKobo != 250_000 {
		t.Fatalf("an idempotent replay must return the same fee, got %d (%v)", again.HomeFeeKobo, err)
	}
	cancelled, err := f.svc.Cancel(ctx, f.patient, o.ID, "changed my mind")
	if err != nil || cancelled.HomeFeeKobo != 250_000 {
		t.Fatalf("a cancelled order must still show its home fee, got %d (%v)", cancelled.HomeFeeKobo, err)
	}
}

func TestLiveDB_CreateOrder_CancelRefundsTheWholeHeldAmount(t *testing.T) {
	f, ctx := newPricingFixture(t)
	start := f.balance(t, ctx)
	o, err := f.svc.CreateOrder(ctx, f.patient, f.in(CollectHome, nil, []string{f.basicPkg}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Cancel(ctx, f.patient, o.ID, "changed my mind"); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if got := f.balance(t, ctx); got != start {
		t.Fatalf("cancelling before collection must return the package AND the home fee: balance %d, started %d", got, start)
	}
}
