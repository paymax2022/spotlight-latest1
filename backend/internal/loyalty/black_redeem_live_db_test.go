package loyalty

// Live-DB tests for BlackService.RedeemPerk idempotency. SKIPPED whenever
// TEST_DATABASE_URL is unset — same convention as redeem_live_db_test.go.
//
// Requires migration 20271017010000_loyalty_perk_redemption_idem_key.sql applied
// (perk_redemptions.idempotency_key partial unique index).

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/points"
)

func seedBlackMember(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	uid := seedLoyaltyUser(t, pool)
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO loyalty_black_members (user_id, state) VALUES ($1,'ACTIVE')`, uid); err != nil {
		t.Fatalf("seed black member: %v", err)
	}
	return uid
}

// entitlement perk: redeem_via='entitlement' skips the credential mint, so the
// test needs no credential.Service (nil is fine — the mint branch is not taken).
func seedEntitlementPerk(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	code := "TESTPERK-" + uuid.NewString()[:13]
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO loyalty_perks (code, title, kind, redeem_via, max_per_month, active)
		 VALUES ($1,'test perk','partner','entitlement',0,true)`, code); err != nil {
		t.Fatalf("seed perk: %v", err)
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM perk_redemptions WHERE perk_code=$1`, code)
		_, _ = pool.Exec(c, `DELETE FROM loyalty_perks WHERE code=$1`, code)
	})
	return code
}

// A client-supplied key makes a replay return the SAME perk redemption with no
// second row — the deduction the member sees (a perk claim) happens once.
func TestLiveDB_PerkRedeem_ClientKeyReplaysIdempotently(t *testing.T) {
	pool := liveLoyaltyPool(t)
	base := NewService(pool, points.NewService(pool, nil), nil)
	svc := NewBlackService(base, nil)
	ctx := context.Background()
	uid := seedBlackMember(t, pool)
	perk := seedEntitlementPerk(t, pool)

	key := "blk-" + uuid.NewString()
	first, err := svc.RedeemPerk(ctx, uid, perk, "evt-1", key)
	if err != nil {
		t.Fatalf("first redeem: %v", err)
	}
	second, err := svc.RedeemPerk(ctx, uid, perk, "evt-1", key)
	if err != nil {
		t.Fatalf("replay redeem: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("replay must return the same redemption: %s vs %s", first.ID, second.ID)
	}
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM perk_redemptions WHERE user_id=$1 AND idempotency_key=$2`, uid, key).Scan(&rows); err != nil {
		t.Fatalf("count redemptions: %v", err)
	}
	if rows != 1 {
		t.Fatalf("expected exactly 1 perk redemption row, got %d", rows)
	}
}

// Headerless calls are rejected fail-closed (iron rule): no key, no perk mint,
// no redemption row.
func TestLiveDB_PerkRedeem_NoKey_Rejected(t *testing.T) {
	pool := liveLoyaltyPool(t)
	base := NewService(pool, points.NewService(pool, nil), nil)
	svc := NewBlackService(base, nil)
	ctx := context.Background()
	uid := seedBlackMember(t, pool)
	perk := seedEntitlementPerk(t, pool)

	if _, err := svc.RedeemPerk(ctx, uid, perk, "evt-1", ""); !errors.Is(err, points.ErrIdempotencyRequired) {
		t.Fatalf("headerless perk redeem: err = %v, want points.ErrIdempotencyRequired", err)
	}
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM perk_redemptions WHERE user_id=$1`, uid).Scan(&rows); err != nil {
		t.Fatalf("count redemptions: %v", err)
	}
	if rows != 0 {
		t.Fatalf("rejected perk redeem must write nothing, got %d rows", rows)
	}
}
