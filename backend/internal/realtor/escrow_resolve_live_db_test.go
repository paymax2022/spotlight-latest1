package realtor

// ---------------------------------------------------------------------------
// LIVE-DB integration test for PROPMGMT-002: refundable lease deposits paid
// into realtor_escrow_deposits (funded via realtor_pay_invoice debiting the
// tenant's wallet into the shared 'settlement' standing account, ADR-040
// pattern) had NO way to ever come back out — no release, no refund, no
// dispute mechanism existed. This proves the new inspection-gated resolve
// path (Repository.ResolveEscrow / POST /api/realtor/admin/escrow/:id/resolve)
// moves real, balanced double-entry ledger money for both outcomes
// (released_to_tenant, forfeited_to_landlord), enforces the move-out
// inspection gate, and guards against double-payout on a repeated resolve.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

func escrowResolvePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping realtor escrow resolve live-DB tests")
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

func erSeedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed user %s: %v", id, err)
	}
	testsupport.CleanupUser(t, pool, id)
}

// erWalletBalance sums ledger_entries for a user's wallet directly via SQL,
// using the SAME sign convention as the canonical projection
// (ledger/repository.go GetBalanceAcrossUserPots / balanceProjectionSQL):
// CREDIT and REVERSAL_DEBIT are +balance, DEBIT and REVERSAL_CREDIT are
// -balance. PostReversalPair's own comment confirms this: "Restore balance to
// the user wallet — REVERSAL_DEBIT reads as +balance" / "Drain the suspense
// hold — REVERSAL_CREDIT reads as -balance."
func erWalletBalance(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN e.type IN ('CREDIT','REVERSAL_DEBIT') THEN e.amount_kobo ELSE -e.amount_kobo END),0)
		FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
		WHERE a.user_id=$1`, userID).Scan(&bal); err != nil {
		t.Fatalf("wallet balance for %s: %v", userID, err)
	}
	return bal
}

// erLedgerEntryCount counts ledger_entries rows for a given reference+type pair.
func erLedgerEntryCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, reference, entryType string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM ledger_entries WHERE reference=$1 AND type=$2`, reference, entryType).Scan(&n); err != nil {
		t.Fatalf("count ledger entries for %s/%s: %v", reference, entryType, err)
	}
	return n
}

// erSeedEscrowFixture builds one full property graph (portfolio -> property ->
// unit -> listing -> application -> lease) plus an escrow deposit in 'held'
// status, and seeds the tenant's wallet balance the way it would really have
// gotten there: a 'settlement' credit (via ledger.Credit) matching the deposit
// amount, mirroring realtor_pay_invoice's DR wallet / CR settlement debit
// (the tenant's spendable balance is drawn down by Debit at pay time — here we
// only need the SETTLEMENT side to already hold the money, since that's what
// ResolveEscrow's PostReversal releases from).
func erSeedEscrowFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, led *ledger.Service, amountKobo int64) (escrowID, leaseID, tenantID, landlordID string) {
	t.Helper()
	tenantID = uuid.New().String()
	landlordID = uuid.New().String()
	erSeedUser(t, ctx, pool, tenantID)
	erSeedUser(t, ctx, pool, landlordID)

	portfolioID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO realtor_portfolios (id, owner_id, name) VALUES ($1,$2,'Fixture Portfolio')`, portfolioID, landlordID); err != nil {
		t.Fatalf("seed portfolio: %v", err)
	}
	propertyID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO realtor_properties (id, portfolio_id, name, property_type, address, area, city, state)
		VALUES ($1,$2,'Fixture Towers','apartment','1 Fixture Rd','Lekki','Lagos','Lagos')`, propertyID, portfolioID); err != nil {
		t.Fatalf("seed property: %v", err)
	}
	unitID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO realtor_units (id, property_id, label, property_type) VALUES ($1,$2,'Flat 1A','apartment')`, unitID, propertyID); err != nil {
		t.Fatalf("seed unit: %v", err)
	}
	listingID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO realtor_listings (id, unit_id, title, mode, caution_kobo) VALUES ($1,$2,'Flat 1A Lease','long_rent',$3)`, listingID, unitID, amountKobo); err != nil {
		t.Fatalf("seed listing: %v", err)
	}
	applicationID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO realtor_rental_applications (id, listing_id, user_id, full_name, email, phone, monthly_income_kobo)
		VALUES ($1,$2,$3,'Fixture Tenant','tenant@fixture.test','+2340000000000',0)`, applicationID, listingID, tenantID); err != nil {
		t.Fatalf("seed application: %v", err)
	}
	leaseID = uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO realtor_leases (id, application_id, listing_id, tenant_id, caution_kobo, start_date, end_date)
		VALUES ($1,$2,$3,$4,$5, CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year')`, leaseID, applicationID, listingID, tenantID, amountKobo); err != nil {
		t.Fatalf("seed lease: %v", err)
	}
	escrowID = uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO realtor_escrow_deposits (id, lease_id, amount_kobo, status) VALUES ($1,$2,$3,'held')`, escrowID, leaseID, amountKobo); err != nil {
		t.Fatalf("seed escrow deposit: %v", err)
	}

	// Seed the settlement standing account's balance the way realtor_pay_invoice
	// really put it there: a CREDIT of the deposit amount referencing the
	// original invoice payment, debited from a throwaway revenue account (fixture
	// plumbing only — the real debit leg was the tenant's wallet at pay time).
	settlementAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("get settlement account: %v", err)
	}
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("get revenue account: %v", err)
	}
	if err := led.PostJournal(ctx, ledger.JournalEntry{
		Reference:       "fixture:realtor:escrow:fund:" + escrowID,
		IdempotencyKey:  "fixture-realtor-escrow-fund-" + escrowID,
		AmountKobo:      amountKobo,
		DebitAccountID:  revAcc.ID,
		CreditAccountID: settlementAcc.ID,
		Description:     "fixture: seed settlement balance to mirror realtor_pay_invoice's deposit hold",
	}); err != nil {
		t.Fatalf("seed settlement balance: %v", err)
	}
	return escrowID, leaseID, tenantID, landlordID
}

func erSubmitMoveOut(t *testing.T, ctx context.Context, pool *pgxpool.Pool, leaseID string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `INSERT INTO realtor_move_outs (lease_id, checklist, submitted_at)
		VALUES ($1, '[]'::jsonb, now())
		ON CONFLICT (lease_id) DO UPDATE SET submitted_at = now()`, leaseID); err != nil {
		t.Fatalf("submit move-out for lease %s: %v", leaseID, err)
	}
}

func TestLiveDB_EscrowResolve_ReleaseRequiresMoveOutInspection(t *testing.T) {
	pool := escrowResolvePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	repo := NewRepository(pool, led)

	const depositAmount = 650_000_00 // NGN 650,000 in kobo
	escrowID, _, _, _ := erSeedEscrowFixture(t, ctx, pool, led, depositAmount)

	// 1) WITHOUT a submitted move-out: released_to_tenant must be refused.
	_, err := repo.ResolveEscrow(ctx, escrowID, "released_to_tenant", "tenant requested release", uuid.New().String())
	if !errors.Is(err, ErrMoveOutRequired) {
		t.Fatalf("resolve without move-out: want ErrMoveOutRequired, got %v", err)
	}

	// Deposit must be untouched.
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM realtor_escrow_deposits WHERE id=$1`, escrowID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != "held" {
		t.Fatalf("escrow deposit status after refused resolve = %q, want still 'held'", status)
	}
}

func TestLiveDB_EscrowResolve_ReleaseToTenantPostsBalancedReversal(t *testing.T) {
	pool := escrowResolvePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	repo := NewRepository(pool, led)

	const depositAmount = 650_000_00
	escrowID, leaseID, tenantID, _ := erSeedEscrowFixture(t, ctx, pool, led, depositAmount)

	tenantBalBefore := erWalletBalance(t, ctx, pool, tenantID)

	erSubmitMoveOut(t, ctx, pool, leaseID)

	adminID := uuid.New().String()
	erSeedUser(t, ctx, pool, adminID)
	res, err := repo.ResolveEscrow(ctx, escrowID, "released_to_tenant", "move-out clean, releasing deposit", adminID)
	if err != nil {
		t.Fatalf("ResolveEscrow released_to_tenant: %v", err)
	}
	if res.Status != "released" || res.ResolvedTo != "tenant" {
		t.Fatalf("unexpected resolution: %+v", res)
	}

	// Direct SQL verification of the escrow row.
	var status, resolvedTo string
	var releasedAt *time.Time
	if err := pool.QueryRow(ctx, `SELECT status, resolved_to, released_at FROM realtor_escrow_deposits WHERE id=$1`, escrowID).
		Scan(&status, &resolvedTo, &releasedAt); err != nil {
		t.Fatalf("read escrow row: %v", err)
	}
	if status != "released" || resolvedTo != "tenant" || releasedAt == nil {
		t.Fatalf("escrow row after release: status=%q resolvedTo=%q releasedAt=%v", status, resolvedTo, releasedAt)
	}

	// Direct SQL verification of a REAL balanced REVERSAL_DEBIT/REVERSAL_CREDIT
	// pair in ledger_entries for this exact reference.
	reversalDebits := erLedgerEntryCount(t, ctx, pool, "realtor:escrow:release:"+escrowID, "REVERSAL_DEBIT")
	reversalCredits := erLedgerEntryCount(t, ctx, pool, "realtor:escrow:release:"+escrowID, "REVERSAL_CREDIT")
	if reversalDebits != 1 || reversalCredits != 1 {
		t.Fatalf("ledger pair for release: REVERSAL_DEBIT=%d REVERSAL_CREDIT=%d, want exactly 1 each", reversalDebits, reversalCredits)
	}

	// The tenant's wallet balance moved up by exactly the deposit amount.
	tenantBalAfter := erWalletBalance(t, ctx, pool, tenantID)
	if tenantBalAfter-tenantBalBefore != depositAmount {
		t.Fatalf("tenant balance delta = %d, want exactly %d", tenantBalAfter-tenantBalBefore, depositAmount)
	}
}

func TestLiveDB_EscrowResolve_ForfeitToLandlordCreditsLandlordWallet(t *testing.T) {
	pool := escrowResolvePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	repo := NewRepository(pool, led)

	const depositAmount = 400_000_00
	escrowID, leaseID, _, landlordID := erSeedEscrowFixture(t, ctx, pool, led, depositAmount)
	erSubmitMoveOut(t, ctx, pool, leaseID)

	landlordBalBefore := erWalletBalance(t, ctx, pool, landlordID)

	adminID := uuid.New().String()
	erSeedUser(t, ctx, pool, adminID)
	res, err := repo.ResolveEscrow(ctx, escrowID, "forfeited_to_landlord", "tenant caused damage, forfeiting deposit", adminID)
	if err != nil {
		t.Fatalf("ResolveEscrow forfeited_to_landlord: %v", err)
	}
	if res.Status != "released" || res.ResolvedTo != "landlord" {
		t.Fatalf("unexpected resolution: %+v", res)
	}

	landlordBalAfter := erWalletBalance(t, ctx, pool, landlordID)
	if landlordBalAfter-landlordBalBefore != depositAmount {
		t.Fatalf("landlord balance delta = %d, want exactly %d", landlordBalAfter-landlordBalBefore, depositAmount)
	}

	debits := erLedgerEntryCount(t, ctx, pool, "realtor:escrow:forfeit:"+escrowID, "DEBIT")
	credits := erLedgerEntryCount(t, ctx, pool, "realtor:escrow:forfeit:"+escrowID, "CREDIT")
	if debits != 1 || credits != 1 {
		t.Fatalf("ledger pair for forfeiture: DEBIT=%d CREDIT=%d, want exactly 1 each", debits, credits)
	}
}

func TestLiveDB_EscrowResolve_AlreadyReleasedIsRefusedAndDoesNotDoublePay(t *testing.T) {
	pool := escrowResolvePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	repo := NewRepository(pool, led)

	const depositAmount = 300_000_00
	escrowID, leaseID, tenantID, _ := erSeedEscrowFixture(t, ctx, pool, led, depositAmount)
	erSubmitMoveOut(t, ctx, pool, leaseID)

	admin1 := uuid.New().String()
	erSeedUser(t, ctx, pool, admin1)
	if _, err := repo.ResolveEscrow(ctx, escrowID, "released_to_tenant", "first release", admin1); err != nil {
		t.Fatalf("first resolve: %v", err)
	}
	tenantBalAfterFirst := erWalletBalance(t, ctx, pool, tenantID)

	// Resolve AGAIN on the already-released deposit.
	admin2 := uuid.New().String()
	erSeedUser(t, ctx, pool, admin2)
	_, err := repo.ResolveEscrow(ctx, escrowID, "released_to_tenant", "retry", admin2)
	if !errors.Is(err, ErrEscrowAlreadyResolved) {
		t.Fatalf("second resolve on released deposit: want ErrEscrowAlreadyResolved, got %v", err)
	}

	// No second ledger pair, no balance change.
	reversalCredits := erLedgerEntryCount(t, ctx, pool, "realtor:escrow:release:"+escrowID, "REVERSAL_CREDIT")
	if reversalCredits != 1 {
		t.Fatalf("REVERSAL_CREDIT count after double-resolve attempt = %d, want still exactly 1", reversalCredits)
	}
	tenantBalAfterSecond := erWalletBalance(t, ctx, pool, tenantID)
	if tenantBalAfterSecond != tenantBalAfterFirst {
		t.Fatalf("tenant balance changed on refused double-resolve: before=%d after=%d", tenantBalAfterFirst, tenantBalAfterSecond)
	}
}

func TestLiveDB_EscrowResolve_DisputedThenLaterReleasedMovesMoneyExactlyOnce(t *testing.T) {
	pool := escrowResolvePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	repo := NewRepository(pool, led)

	const depositAmount = 500_000_00
	escrowID, leaseID, tenantID, _ := erSeedEscrowFixture(t, ctx, pool, led, depositAmount)

	// 'disputed' requires NO move-out submission.
	disputeAdmin := uuid.New().String()
	erSeedUser(t, ctx, pool, disputeAdmin)
	disputeRes, err := repo.ResolveEscrow(ctx, escrowID, "disputed", "tenant disputes deduction", disputeAdmin)
	if err != nil {
		t.Fatalf("dispute resolve: %v", err)
	}
	if disputeRes.Status != "disputed" {
		t.Fatalf("dispute resolution status = %q, want 'disputed'", disputeRes.Status)
	}

	// No ledger entry posted for a dispute.
	if n := erLedgerEntryCount(t, ctx, pool, "realtor:escrow:release:"+escrowID, "REVERSAL_CREDIT"); n != 0 {
		t.Fatalf("dispute posted a ledger entry: REVERSAL_CREDIT count=%d, want 0", n)
	}
	tenantBalAfterDispute := erWalletBalance(t, ctx, pool, tenantID)

	// The deposit is resolvable again later — submit the move-out now, then
	// release. It must succeed and move money exactly once.
	erSubmitMoveOut(t, ctx, pool, leaseID)
	releaseAdmin := uuid.New().String()
	erSeedUser(t, ctx, pool, releaseAdmin)
	res, err := repo.ResolveEscrow(ctx, escrowID, "released_to_tenant", "dispute resolved in tenant's favor", releaseAdmin)
	if err != nil {
		t.Fatalf("resolve after dispute: %v", err)
	}
	if res.Status != "released" || res.ResolvedTo != "tenant" {
		t.Fatalf("unexpected final resolution: %+v", res)
	}

	reversalCredits := erLedgerEntryCount(t, ctx, pool, "realtor:escrow:release:"+escrowID, "REVERSAL_CREDIT")
	if reversalCredits != 1 {
		t.Fatalf("REVERSAL_CREDIT count after dispute->release = %d, want exactly 1", reversalCredits)
	}
	tenantBalAfterRelease := erWalletBalance(t, ctx, pool, tenantID)
	if tenantBalAfterRelease-tenantBalAfterDispute != depositAmount {
		t.Fatalf("tenant balance delta after dispute->release = %d, want exactly %d", tenantBalAfterRelease-tenantBalAfterDispute, depositAmount)
	}
}
