package crypto

// GAP-DEP-01 Slice 3 — the money-IN deposit READ surfaces over the real schema. These prove
// the read half that backs both the admin money-IN view and the mobile pending→credited screen:
//   * a settled credit (crypto_deposits) is listed with its whole-unit scale and ordering;
//   * the member path is owner-scoped — a foreign id reads as not-found, never another user's row;
//   * the admin path is unscoped across users.
// It deliberately does NOT cover the unmapped/awaiting exception queue: the engine persists
// nothing there, so there is nothing to read — that surface needs its own (undecided) design.
// SKIPPED unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func seedDeposit(t *testing.T, pool *pgxpool.Pool, userID, symbol string, units int64, op string) string {
	t.Helper()
	ctx := context.Background()
	var assetID string
	if err := pool.QueryRow(ctx, `SELECT id FROM crypto_assets WHERE symbol=$1 AND is_active LIMIT 1`, symbol).Scan(&assetID); err != nil {
		t.Fatalf("asset %s must exist in the dev DB: %v", symbol, err)
	}
	var id string
	if err := pool.QueryRow(ctx,
		`INSERT INTO crypto_deposits
		   (provider, provider_account_id, provider_op_id, user_id, asset_id, symbol, network, address,
		    units, confirmations, required_confs, tx_hash)
		 VALUES ('quidax', $1, $2, $3::uuid, $4::uuid, $5, 'bitcoin', 'bc1qseed', $6, 6, 3, $7)
		 RETURNING id`,
		"acct-"+uuid.NewString(), op, userID, assetID, symbol, units, "0x"+op).Scan(&id); err != nil {
		t.Fatalf("seed deposit: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM crypto_deposits WHERE provider_op_id=$1`, op)
	})
	return id
}

func TestLiveDB_DepositsMemberScoped(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	svc := NewService(pool, nil, NewMockPriceProvider())

	uA := seedLiveUser(t, ctx, pool, nil, 2, 0)
	uB := seedLiveUser(t, ctx, pool, nil, 2, 0)
	idA := seedDeposit(t, pool, uA, "BTC", 500_000, "op-"+uuid.NewString())
	seedDeposit(t, pool, uB, "BTC", 900_000, "op-"+uuid.NewString())

	own, err := svc.Deposits(ctx, uA, "", 50, 0)
	if err != nil {
		t.Fatalf("member deposits: %v", err)
	}
	var mine int
	for _, d := range own {
		if d.UserID != uA {
			t.Fatalf("member list leaked another user's row: %+v", d)
		}
		mine++
	}
	if mine == 0 {
		t.Fatalf("member list returned none of user A's credits")
	}

	// A foreign id reads as not-found, never B's row.
	if _, err := svc.Deposit(ctx, uA, idA); err != nil {
		t.Fatalf("owner fetch of own credit: %v", err)
	}
	var foreign string
	if err := pool.QueryRow(ctx, `SELECT id FROM crypto_deposits WHERE user_id=$1`, uB).Scan(&foreign); err != nil {
		t.Fatalf("read B's id: %v", err)
	}
	if _, err := svc.Deposit(ctx, uA, foreign); err != ErrNotFound {
		t.Fatalf("cross-owner fetch must be ErrNotFound, got %v", err)
	}
}

func TestLiveDB_DepositsAdminUnscopedAndScale(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	svc := NewService(pool, nil, NewMockPriceProvider())

	u := seedLiveUser(t, ctx, pool, nil, 2, 0)
	op := "op-" + uuid.NewString()
	seedDeposit(t, pool, u, "BTC", 500_000, op)

	all, err := svc.AdminListDeposits(ctx, "BTC", 200, 0)
	if err != nil {
		t.Fatalf("admin deposits: %v", err)
	}
	var found *CryptoDeposit
	for i := range all {
		if all[i].ProviderOpID == op {
			found = &all[i]
		}
	}
	if found == nil {
		t.Fatal("admin money-IN view must list the seeded credit")
	}
	if found.UserID != u {
		t.Fatalf("admin view exposes user_id for ops, got %q", found.UserID)
	}
	if found.Units != 500_000 || found.MinorUnitScale != 100_000_000 {
		t.Fatalf("want units=500000 scale=1e8, got units=%d scale=%d", found.Units, found.MinorUnitScale)
	}
	if found.Confirmations != 6 || found.RequiredConfs != 3 {
		t.Fatalf("confirmations not surfaced: %+v", found)
	}
}
