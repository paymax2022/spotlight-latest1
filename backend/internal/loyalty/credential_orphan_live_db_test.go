package loyalty

// Live-DB tests for the RedeemPerk orphan-credential compensation: a credential
// minted for a redemption row that fails to persist (insert error or a lost
// same-key race) must be REVOKED, never left ACTIVE-but-unattached where it
// could still pass a gate scan. SKIPPED whenever TEST_DATABASE_URL is unset.
//
// Requires migration 20271017010000_loyalty_perk_redemption_idem_key.sql
// applied (perk_redemptions.idempotency_key partial unique index).

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/credential"
	"spotlight/backend/internal/points"
)

// seedCredentialPerk inserts a perk whose redemption mints a single-use
// credential (redeem_via='credential').
func seedCredentialPerk(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	code := "TESTCRED-" + uuid.NewString()[:13]
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO loyalty_perks (code, title, kind, redeem_via, max_per_month, active)
		 VALUES ($1,'test cred perk','lounge','credential',0,true)`, code); err != nil {
		t.Fatalf("seed credential perk: %v", err)
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM perk_redemptions WHERE perk_code=$1`, code)
		_, _ = pool.Exec(c, `DELETE FROM loyalty_perks WHERE code=$1`, code)
	})
	return code
}

// installPerkTrigger creates a BEFORE INSERT trigger on perk_redemptions that
// fires only for the given user, plus its backing function. Returns a cleanup
// that drops both.
func installPerkTrigger(t *testing.T, pool *pgxpool.Pool, userID, funcBody string) {
	t.Helper()
	suffix := uuid.NewString()[:8]
	fn := "test_perk_trg_" + suffix
	trg := "trg_test_perk_" + suffix
	ctx := context.Background()
	if _, err := pool.Exec(ctx, fmt.Sprintf(
		`CREATE OR REPLACE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $fn$ %s $fn$`, fn, funcBody)); err != nil {
		t.Fatalf("create trigger function: %v", err)
	}
	if _, err := pool.Exec(ctx, fmt.Sprintf(
		`CREATE TRIGGER %s BEFORE INSERT ON perk_redemptions
		 FOR EACH ROW WHEN (NEW.user_id = '%s'::uuid) EXECUTE FUNCTION %s()`, trg, userID, fn)); err != nil {
		t.Fatalf("create trigger: %v", err)
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, fmt.Sprintf(`DROP TRIGGER IF EXISTS %s ON perk_redemptions`, trg))
		_, _ = pool.Exec(c, fmt.Sprintf(`DROP FUNCTION IF EXISTS %s()`, fn))
	})
}

// If the perk_redemptions insert fails AFTER the credential is minted, the
// credential must not be left ACTIVE-but-unattached — the compensation revokes
// it so it can never pass a gate scan.
func TestLiveDB_PerkRedeem_InsertFailureRevokesOrphanCredential(t *testing.T) {
	pool := liveLoyaltyPool(t)
	base := NewService(pool, points.NewService(pool, nil), nil)
	svc := NewBlackService(base, credential.NewService(pool, nil))
	ctx := context.Background()
	uid := seedBlackMember(t, pool)
	perk := seedCredentialPerk(t, pool)

	installPerkTrigger(t, pool, uid, `BEGIN RAISE EXCEPTION 'test: perk insert blocked'; END`)

	if _, err := svc.RedeemPerk(ctx, uid, perk, "evt-1", "blk-"+uuid.NewString()); err == nil {
		t.Fatalf("blocked insert must error")
	}
	var active, revoked, redemptions int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FILTER (WHERE state='ACTIVE'), count(*) FILTER (WHERE state='REVOKED')
		 FROM credentials WHERE subject_ref=$1`, uid).Scan(&active, &revoked); err != nil {
		t.Fatalf("count credentials: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM perk_redemptions WHERE user_id=$1`, uid).Scan(&redemptions); err != nil {
		t.Fatalf("count redemptions: %v", err)
	}
	if active != 0 {
		t.Fatalf("orphan credential left ACTIVE: %d", active)
	}
	if revoked != 1 {
		t.Fatalf("expected the minted credential to be REVOKED, got %d", revoked)
	}
	if redemptions != 0 {
		t.Fatalf("failed insert must leave no redemption row, got %d", redemptions)
	}
}

// If a same-key race is lost (the insert dedupes to the winner's row), the
// credential the loser minted is orphaned — the winner's row references its
// own. The loser must revoke its orphan before returning the winner's row.
// Simulated deterministically: a trigger inserts the "winner" row inside the
// same statement and swallows the loser's insert (RETURN NULL), so the
// conflict read-back returns a different redemption id.
func TestLiveDB_PerkRedeem_RaceLoserRevokesOrphanCredential(t *testing.T) {
	pool := liveLoyaltyPool(t)
	base := NewService(pool, points.NewService(pool, nil), nil)
	svc := NewBlackService(base, credential.NewService(pool, nil))
	ctx := context.Background()
	uid := seedBlackMember(t, pool)
	perk := seedCredentialPerk(t, pool)

	// Depth guard: the winner's own INSERT re-fires this trigger; let it pass.
	installPerkTrigger(t, pool, uid, `BEGIN
		IF pg_trigger_depth() = 1 THEN
			INSERT INTO perk_redemptions (id, user_id, perk_code, context_ref, credential_id, idempotency_key, created_at)
			VALUES (gen_random_uuid(), NEW.user_id, NEW.perk_code, NEW.context_ref, NULL, NEW.idempotency_key, now());
			RETURN NULL;
		END IF;
		RETURN NEW;
	END`)

	got, err := svc.RedeemPerk(ctx, uid, perk, "evt-1", "blk-"+uuid.NewString())
	if err != nil {
		t.Fatalf("race-lost redeem must return the winner's row, got err %v", err)
	}
	var storedID string
	if err := pool.QueryRow(ctx,
		`SELECT id FROM perk_redemptions WHERE user_id=$1`, uid).Scan(&storedID); err != nil {
		t.Fatalf("load stored redemption: %v", err)
	}
	if got.ID != storedID {
		t.Fatalf("race loser must return the stored winner row: %s vs %s", got.ID, storedID)
	}
	var active, revoked int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FILTER (WHERE state='ACTIVE'), count(*) FILTER (WHERE state='REVOKED')
		 FROM credentials WHERE subject_ref=$1`, uid).Scan(&active, &revoked); err != nil {
		t.Fatalf("count credentials: %v", err)
	}
	if active != 0 {
		t.Fatalf("race-loser credential left ACTIVE as an orphan: %d", active)
	}
	if revoked != 1 {
		t.Fatalf("expected the orphaned mint to be REVOKED, got %d", revoked)
	}
}
