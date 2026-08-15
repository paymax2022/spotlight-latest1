package savings

// Live-DB test for the vault-list balance projection.
//
// The savings ledger is append-only (savings_vault_ledger) and a vault's balance
// is the SUM of its entries — never a stored column (NL-8). ListVaults selects
// only savings_vaults columns, so before this change every vault in a list read
// carried a zero balance and the mobile list tiles rendered ₦0 for funded
// vaults. That is a display bug the pure invariant tests cannot catch, because
// the projection lives in SQL.
//
// ⚠️ GATED ON TEST_DATABASE_URL, DELIBERATELY WITH NO FALLBACK TO DATABASE_URL.
// The root .env points DATABASE_URL at the PRODUCTION Supabase pooler, so a
// fallback would create vaults and ledger rows in production. Run it against a
// local database only:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/savings/ -run TestLiveDB_ListVaults -v

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newTestPool dials the LOCAL test database, or skips.
func newTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB savings test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// newTestOwner creates a throwaway auth.users row and returns its id.
// savings_vaults.owner_user_id is FK-constrained to auth.users, and a fresh
// owner per run keeps assertions independent of rows left by earlier runs
// (savings rows are not torn down).
func newTestOwner(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	// email is required: a trigger on auth.users mirrors the row into
	// user_profiles, whose email column is NOT NULL. .invalid is reserved by
	// RFC 2606, so these fixtures can never be a routable address.
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		id, "savings-test-"+id+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users owner: %v", err)
	}
	return id
}

// seedVault inserts a vault plus ledger entries and returns the vault id.
// Entries are (direction, amount_kobo) pairs applied in order.
func seedVault(t *testing.T, pool *pgxpool.Pool, ownerID, name string, entries [][2]any) string {
	t.Helper()
	ctx := context.Background()
	var vaultID string
	err := pool.QueryRow(ctx,
		`INSERT INTO savings_vaults (owner_user_id, name, kind, state, target_kobo)
		 VALUES ($1,$2,'FLEX','OPEN',0) RETURNING id`, ownerID, name).Scan(&vaultID)
	if err != nil {
		t.Fatalf("seed vault %s: %v", name, err)
	}
	for i, e := range entries {
		dir := e[0].(string)
		amt := e[1].(int64)
		if _, err := pool.Exec(ctx,
			`INSERT INTO savings_vault_ledger (id, vault_id, direction, amount_kobo, reason, idempotency_key, created_at)
			 VALUES ($1,$2,$3,$4,'test',$5, now())`,
			uuid.NewString(), vaultID, dir, amt, uuid.NewString()); err != nil {
			t.Fatalf("seed ledger entry %d for %s: %v", i, name, err)
		}
	}
	return vaultID
}

// A funded vault must report its ledger-derived balance in the LIST read, not 0.
func TestLiveDB_ListVaults_ReturnsLedgerDerivedBalance(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	// Fresh owner per run: savings rows are not torn down between runs and a
	// shared fixture id would make assertions order-dependent.
	owner := newTestOwner(t, pool)

	// 250_000 credited, 50_000 withdrawn => 200_000 net.
	seedVault(t, pool, owner, "funded", [][2]any{
		{"CREDIT", int64(250_000)},
		{"DEBIT", int64(50_000)},
	})
	// A vault with no entries at all must report 0, not NULL.
	seedVault(t, pool, owner, "empty", nil)
	// Credits and debits that cancel exactly must report 0 — distinguishing a
	// real zero from a missing projection.
	seedVault(t, pool, owner, "netzero", [][2]any{
		{"CREDIT", int64(80_000)},
		{"DEBIT", int64(80_000)},
	})

	svc := &VaultService{db: pool}
	vaults, err := svc.ListVaults(ctx, owner)
	if err != nil {
		t.Fatalf("ListVaults: %v", err)
	}
	if len(vaults) != 3 {
		t.Fatalf("expected 3 vaults for owner, got %d", len(vaults))
	}

	got := map[string]int64{}
	for _, v := range vaults {
		got[v.Name] = v.BalanceKobo
	}
	want := map[string]int64{"funded": 200_000, "empty": 0, "netzero": 0}
	for name, exp := range want {
		if got[name] != exp {
			t.Errorf("vault %q: balance_kobo = %d, want %d", name, got[name], exp)
		}
	}
}

// The list balance must agree with the single-vault read for the same vault,
// so a user never sees one number on the list and another on the detail screen.
func TestLiveDB_ListVaults_AgreesWithGetVault(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	owner := newTestOwner(t, pool)

	vaultID := seedVault(t, pool, owner, "agree", [][2]any{
		{"CREDIT", int64(1_234_500)},
		{"DEBIT", int64(234_500)},
	})

	svc := &VaultService{db: pool}
	vaults, err := svc.ListVaults(ctx, owner)
	if err != nil {
		t.Fatalf("ListVaults: %v", err)
	}
	if len(vaults) != 1 {
		t.Fatalf("expected 1 vault, got %d", len(vaults))
	}

	detailBal, err := svc.Balance(ctx, vaultID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if vaults[0].BalanceKobo != detailBal {
		t.Errorf("list balance %d != detail balance %d", vaults[0].BalanceKobo, detailBal)
	}
	if detailBal != 1_000_000 {
		t.Errorf("detail balance = %d, want 1000000", detailBal)
	}
}
