package settlement_test

// LIVE-DB regression for SettleToStandingAccounts: a provider leg bound for a
// standing account must not resolve a user wallet. Pins: Settle with a
// synthetic provider ref still fails closed; SettleToStandingAccounts posts
// balanced escrow→provider_clearing and escrow→commission legs and flips the
// row to 'settled'; a non-escrowed row still refuses.
// Skipped unless TEST_DATABASE_URL is set.
// Escrow is seeded via EscrowExternal (external-rail hold: DR provider_clearing
// → CR escrow journal) so the test needs no funded wallet or KYC tier — payer_id
// still requires a real auth.users row (FK).
//
// SKIPPED whenever TEST_DATABASE_URL is unset.
//   export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//   cd backend && go test ./internal/finance/settlement/ -run TestLiveDB_SettleToStanding -v -count=1

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/testsupport"
)

func mustStandingPool(t *testing.T) *pgxpool.Pool {
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

// legsForRef returns the (account_type, entry_type, amount_kobo) rows posted for
// one settlement leg reference — e.g. "settle:<ref>:provider".
func legsForRef(t *testing.T, pool *pgxpool.Pool, reference string) map[string]int64 {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
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

func TestLiveDB_SettleToStandingAccounts(t *testing.T) {
	ctx := context.Background()
	pool := mustStandingPool(t)
	svc := settlement.NewService(pool, ledger.NewService(ledger.NewRepository(pool), nil))

	payer := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		payer, payer+"@seed.test"); err != nil {
		t.Fatalf("seed payer: %v", err)
	}
	testsupport.CleanupUser(t, pool, payer)

	const total = int64(5_000_000) // ₦50,000 gross
	const fee = int64(500_000)     // ₦5,000 stays commission
	ref := "stays:settle-standing:" + uuid.NewString()[:12]

	// ── 1. The OLD path must still fail closed: a synthetic stays-clearing ref
	// is not a user uuid, and Settle resolves ProviderID as a wallet owner.
	oldSett, err := svc.EscrowExternal(ctx, payer, ref+":old", "ldescold-"+uuid.NewString(), "stays", total)
	if err != nil {
		t.Fatalf("seed old-path escrow: %v", err)
	}
	if err := svc.Settle(ctx, oldSett.ID, settlement.Split{
		ProviderID:  "stays-clearing:self",
		ProviderPct: 0.90,
		PlatformPct: 0.10,
	}); err == nil {
		t.Fatal("Settle accepted a non-uuid stays-clearing provider id — uuid validation must stay fail-closed")
	}

	// ── 2. The NEW path settles the same synthetic counterparty onto standing
	// accounts: provider leg → provider_clearing, platform leg → commission.
	sett, err := svc.EscrowExternal(ctx, payer, ref, "ldesc-"+uuid.NewString(), "stays", total)
	if err != nil {
		t.Fatalf("seed escrow: %v", err)
	}
	err = svc.SettleToStandingAccounts(ctx, sett.ID, settlement.Split{
		ProviderID:     "stays-clearing:self", // annotation only — not a user id
		ProviderPct:    1.0,
		ServiceFeeKobo: fee,
	}, ledger.AccountProviderClearing, ledger.AccountCommission)
	if err != nil {
		t.Fatalf("SettleToStandingAccounts: %v", err)
	}

	var status string
	var providerKobo, feeKobo int64
	if err := pool.QueryRow(ctx,
		`SELECT status, provider_kobo, fee_kobo FROM settlements WHERE id=$1`, sett.ID).
		Scan(&status, &providerKobo, &feeKobo); err != nil {
		t.Fatalf("read settlement row: %v", err)
	}
	if status != "settled" {
		t.Fatalf("settlement status = %q, want settled", status)
	}
	if providerKobo != total-fee || feeKobo != fee {
		t.Fatalf("settlement legs = provider %d / fee %d, want %d / %d",
			providerKobo, feeKobo, total-fee, fee)
	}

	// Provider leg: DEBIT escrow → CREDIT provider_clearing, total−fee.
	prov := legsForRef(t, pool, "settle:"+ref+":provider")
	if prov["escrow:DEBIT"] != total-fee || prov["provider_clearing:CREDIT"] != total-fee {
		t.Fatalf("provider leg wrong: %v — want escrow DEBIT %d + provider_clearing CREDIT %d",
			prov, total-fee, total-fee)
	}
	// Platform leg: DEBIT escrow → CREDIT commission (stays parks its cut on the
	// SEPARATE commission account, not the general paymax_revenue float).
	comm := legsForRef(t, pool, "settle:"+ref+":commission")
	if comm["escrow:DEBIT"] != fee || comm["commission:CREDIT"] != fee {
		t.Fatalf("commission leg wrong: %v — want escrow DEBIT %d + commission CREDIT %d",
			comm, fee, fee)
	}
	// NO user_wallet leg — the provider leg must never touch a wallet keyed on
	// the synthetic ref.
	for k := range prov {
		if k == "user_wallet:CREDIT" {
			t.Fatalf("provider leg hit a user wallet — the synthetic ref must never resolve to one: %v", prov)
		}
	}

	// ── 3. Re-settle refuses on the status guard (idempotent at the row level;
	// the ledger legs are additionally ON CONFLICT DO NOTHING).
	if err := svc.SettleToStandingAccounts(ctx, sett.ID, settlement.Split{
		ProviderID:     "stays-clearing:self",
		ProviderPct:    1.0,
		ServiceFeeKobo: fee,
	}, ledger.AccountProviderClearing, ledger.AccountCommission); err == nil {
		t.Fatal("re-settle of a settled row must fail closed")
	}
}
