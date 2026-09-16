package savings

// Live-DB tests for two money-path defects found by the ledger-auditor review
// of PR #102:
//
//  1. Balance IDOR — VaultBalance/TargetBalance were reachable by ANY
//     authenticated caller because the service methods took only the entity id
//     and had no owner parameter to check against. RLS does not cover this: the
//     Go backend connects through the pgx pool as owner/service role, so the
//     savings_vault_ledger_own policy is bypassed.
//
//  2. Early-break penalty rate — penalty_bps arrived in the REQUEST BODY, so a
//     member breaking a LOCK vault could send 0 and pay nothing. The rate is now
//     server-side; the parameter is gone from the signature entirely so a
//     caller cannot supply one even by mistake.
//
// ⚠️ GATED ON TEST_DATABASE_URL WITH NO FALLBACK TO DATABASE_URL — the root
// .env DATABASE_URL is the PRODUCTION pooler and these tests move money. Run:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/savings/ -run 'TestLiveDB_(Balance|Penalty)' -v

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// seedLockVault inserts a LOCK vault maturing in the future (i.e. still
// breakable early) with the given credited balance.
func seedLockVault(t *testing.T, pool *pgxpool.Pool, ownerID string, creditKobo int64) string {
	t.Helper()
	ctx := context.Background()
	matures := time.Now().Add(365 * 24 * time.Hour)
	var id string
	if err := pool.QueryRow(ctx,
		`INSERT INTO savings_vaults (owner_user_id, name, kind, state, target_kobo, matures_at)
		 VALUES ($1,'lockbox','LOCK','OPEN',0,$2) RETURNING id`, ownerID, matures).Scan(&id); err != nil {
		t.Fatalf("seed lock vault: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO savings_vault_ledger (id, vault_id, direction, amount_kobo, reason, idempotency_key, created_at)
		 VALUES ($1,$2,'CREDIT',$3,'test',$4, now())`,
		uuid.NewString(), id, creditKobo, uuid.NewString()); err != nil {
		t.Fatalf("seed lock vault credit: %v", err)
	}
	return id
}

// ── Defect 1: balance reads must be owner-scoped ────────────────────────────

func TestLiveDB_BalanceForOwner_RejectsNonOwner(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	owner := newTestOwner(t, pool)
	attacker := newTestOwner(t, pool)

	vaultID := seedVault(t, pool, owner, "private", [][2]any{{"CREDIT", int64(750_000)}})
	svc := &VaultService{db: pool}

	// The owner sees the real balance.
	bal, err := svc.BalanceForOwner(ctx, owner, vaultID)
	if err != nil {
		t.Fatalf("owner BalanceForOwner: %v", err)
	}
	if bal != 750_000 {
		t.Errorf("owner balance = %d, want 750000", bal)
	}

	// Anyone else must be refused — and must NOT learn the amount.
	got, err := svc.BalanceForOwner(ctx, attacker, vaultID)
	if !errors.Is(err, ErrForbidden) {
		t.Errorf("non-owner: err = %v, want ErrForbidden", err)
	}
	if got != 0 {
		t.Errorf("non-owner leaked balance %d; must be 0", got)
	}
}

func TestLiveDB_BalanceForOwner_UnknownVaultIsNotAnOracle(t *testing.T) {
	pool := newTestPool(t)
	owner := newTestOwner(t, pool)
	svc := &VaultService{db: pool}

	// A random id must not be distinguishable as "exists but not yours" via a
	// different error shape leaking existence.
	if _, err := svc.BalanceForOwner(context.Background(), owner, uuid.NewString()); err == nil {
		t.Error("unknown vault: expected an error, got nil")
	}
}

func TestLiveDB_TargetBalanceForMember_RejectsNonMember(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	creator := newTestOwner(t, pool)
	outsider := newTestOwner(t, pool)

	var targetID string
	// withdrawal_rule is CHECK-constrained to ('ON_DATE','MAJORITY') — uppercase.
	if err := pool.QueryRow(ctx,
		`INSERT INTO group_targets (creator_user_id, name, target_kobo, withdrawal_rule, state)
		 VALUES ($1,'pot',1000000,'ON_DATE','OPEN') RETURNING id`, creator).Scan(&targetID); err != nil {
		t.Fatalf("seed group target: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO group_target_members (id, target_id, user_id, approved, joined_at)
		 VALUES ($1,$2,$3,false, now())`, uuid.NewString(), targetID, creator); err != nil {
		t.Fatalf("seed target member: %v", err)
	}
	// group_target_ledger has no `reason` column (unlike savings_vault_ledger)
	// and carries the contributing user_id instead.
	if _, err := pool.Exec(ctx,
		`INSERT INTO group_target_ledger (id, target_id, user_id, direction, amount_kobo, idempotency_key, created_at)
		 VALUES ($1,$2,$3,'CREDIT',$4,$5, now())`,
		uuid.NewString(), targetID, creator, int64(300_000), uuid.NewString()); err != nil {
		t.Fatalf("seed target ledger: %v", err)
	}

	svc := &TargetService{db: pool}
	if bal, err := svc.BalanceForMember(ctx, creator, targetID); err != nil || bal != 300_000 {
		t.Errorf("member: bal=%d err=%v, want 300000/nil", bal, err)
	}
	got, err := svc.BalanceForMember(ctx, outsider, targetID)
	if !errors.Is(err, ErrForbidden) {
		t.Errorf("non-member: err = %v, want ErrForbidden", err)
	}
	if got != 0 {
		t.Errorf("non-member leaked pot balance %d; must be 0", got)
	}
}

// ── Defect 2: the early-break penalty rate is server-side ───────────────────

// The rate must come from service config, NOT from the caller. The signature no
// longer accepts a bps argument, so this test pins the resulting arithmetic.
func TestLiveDB_PenaltyRate_IsServerSideNotCallerSupplied(t *testing.T) {
	pool := newTestPool(t)
	owner := newTestOwner(t, pool)
	svc := &VaultService{db: pool, earlyBreakPenaltyBps: DefaultEarlyBreakPenaltyBps}

	// A real LOCK vault holding 1_000_000 kobo (₦10,000), maturing in a year.
	vaultID := seedLockVault(t, pool, owner, 1_000_000)
	v, err := svc.getVault(context.Background(), vaultID)
	if err != nil {
		t.Fatalf("getVault: %v", err)
	}

	// At the 1000 bps (10%) default, breaking it early costs 100_000 kobo (₦1,000).
	// Crucially the caller has no way to influence this: EarlyWithdraw no longer
	// takes a bps argument at all.
	if got := svc.penaltyFor(v, 1_000_000); got != 100_000 {
		t.Errorf("LOCK broken early: penalty = %d, want 100000 (10%% of 1000000)", got)
	}
	// The quote the member is shown must be the same number that gets charged.
	if q := svc.PenaltyQuote(v, 1_000_000); q != svc.penaltyFor(v, 1_000_000) {
		t.Errorf("quote %d != charged %d", q, svc.penaltyFor(v, 1_000_000))
	}
}

func TestLiveDB_PenaltyRate_ZeroForFlexAndMatured(t *testing.T) {
	pool := newTestPool(t)
	svc := &VaultService{db: pool, earlyBreakPenaltyBps: DefaultEarlyBreakPenaltyBps}
	future := time.Now().Add(24 * time.Hour)
	past := time.Now().Add(-24 * time.Hour)

	cases := []struct {
		name string
		v    *Vault
		want int64
	}{
		// FLEX withdraws anytime — never penalised, however the rate is set.
		{"flex", &Vault{Kind: VaultFlex, State: VaultOpen, MaturesAt: &future}, 0},
		// A LOCK vault past maturity is no longer an early break.
		{"lock matured by date", &Vault{Kind: VaultLock, State: VaultOpen, MaturesAt: &past}, 0},
		// State already moved on ⇒ not an early break.
		{"lock in MATURED state", &Vault{Kind: VaultLock, State: VaultMatured, MaturesAt: &future}, 0},
		{"lock still locked", &Vault{Kind: VaultLock, State: VaultOpen, MaturesAt: &future}, 100_000},
	}
	for _, c := range cases {
		if got := svc.penaltyFor(c.v, 1_000_000); got != c.want {
			t.Errorf("%s: penalty = %d, want %d", c.name, got, c.want)
		}
	}
}

// A zero configured rate must yield a zero penalty — the knob has to actually
// work in both directions, so the default can be tuned without code changes.
func TestLiveDB_PenaltyRate_HonoursConfiguredRate(t *testing.T) {
	pool := newTestPool(t)
	future := time.Now().Add(24 * time.Hour)
	v := &Vault{Kind: VaultLock, State: VaultOpen, MaturesAt: &future}

	for _, c := range []struct{ bps, want int64 }{
		{0, 0},
		{250, 25_000},    // 2.5%
		{1000, 100_000},  // 10% (default)
		{10000, 1_000_000}, // 100% — the clamp boundary
	} {
		svc := &VaultService{db: pool, earlyBreakPenaltyBps: c.bps}
		if got := svc.penaltyFor(v, 1_000_000); got != c.want {
			t.Errorf("bps=%d: penalty = %d, want %d", c.bps, got, c.want)
		}
	}
}

// An out-of-range configured rate must fail closed rather than silently
// charging a nonsense amount.
func TestLiveDB_PenaltyRate_RejectsOutOfRangeConfig(t *testing.T) {
	pool := newTestPool(t)
	svc := &VaultService{db: pool, earlyBreakPenaltyBps: DefaultEarlyBreakPenaltyBps}
	for _, bad := range []int64{-1, 10001} {
		if err := svc.SetEarlyBreakPenaltyBps(bad); err == nil {
			t.Errorf("SetEarlyBreakPenaltyBps(%d): expected error, got nil", bad)
		}
	}
	// A rejected value must not have mutated the live rate.
	if svc.earlyBreakPenaltyBps != DefaultEarlyBreakPenaltyBps {
		t.Errorf("rate mutated to %d after rejected set", svc.earlyBreakPenaltyBps)
	}
	if err := svc.SetEarlyBreakPenaltyBps(500); err != nil {
		t.Errorf("valid set rejected: %v", err)
	}
	if svc.earlyBreakPenaltyBps != 500 {
		t.Errorf("rate = %d after valid set, want 500", svc.earlyBreakPenaltyBps)
	}
}
