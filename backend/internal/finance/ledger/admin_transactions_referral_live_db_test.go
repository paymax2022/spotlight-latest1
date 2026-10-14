package ledger

// LIVE-DB coverage for the referral columns on the admin Transactions list: the
// commission a purchase earned the payer's referrer, and the referral id.
//
// attachReferral is exercised directly on hand-built rows. ledger_entries is
// append-only and ADR-040 requires the whole table to net to zero, so a test that
// only needs the join must not write ledger rows. referral_rewards rows are removed
// afterwards; the one commission_earnings row (append-only) is left, tagged.
// SKIPPED whenever TEST_DATABASE_URL is unset.
//   export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//   cd backend && go test ./internal/finance/ledger/ -run TestAdminReferral -v -count=1

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func refPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func refUser(t *testing.T, pool *pgxpool.Pool, name string) string {
	t.Helper()
	id := uuid.NewString()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2)`, id, "zzledref-"+id+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.user_profiles (id, email, full_name) VALUES ($1,$2,$3)
		ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name`, id, "zzledref-"+id+"@seed.test", name); err != nil {
		t.Fatalf("seed profile: %v", err)
	}
	return id
}

func seedReward(t *testing.T, pool *pgxpool.Pool, referrer, referred, sourceTxn, status string, kobo int64) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO public.referral_rewards
		  (referrer_id, referred_user_id, source_transaction_id, module, margin_kobo, applied_rate, reward_kobo, status)
		VALUES ($1,$2,$3,'bills',10000,0.2,$4,$5) RETURNING id`,
		referrer, referred, sourceTxn, kobo, status).Scan(&id); err != nil {
		t.Fatalf("seed reward: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.referral_rewards WHERE id=$1`, id)
	})
	return id
}

func strp(s string) *string { return &s }

func TestAdminReferral_DirectEngineRewardAttachesToThePayersDebit(t *testing.T) {
	pool := refPool(t)
	repo := NewRepository(pool)
	referrer := refUser(t, pool, "Ada Referrer")
	payer := refUser(t, pool, "Bola Payer")
	tag := "zzledref-" + uuid.NewString()
	rewardID := seedReward(t, pool, referrer, payer, tag, "CREDITED", 2000)

	rows := []AdminTransactionRow{
		{ID: "e1", Type: "DEBIT", Reference: tag, UserID: strp(payer)},
		{ID: "e2", Type: "REVERSAL_CREDIT", Reference: tag, UserID: strp(payer)}, // same ref, not the purchase leg
		{ID: "e3", Type: "CREDIT", Reference: tag, UserID: strp(referrer)},      // someone else's leg
		{ID: "e4", Type: "DEBIT", Reference: "zzledref-unrelated-" + tag, UserID: strp(payer)},
	}
	if err := repo.attachReferral(context.Background(), rows); err != nil {
		t.Fatalf("attachReferral: %v", err)
	}

	got := rows[0]
	if got.ReferralID == nil || *got.ReferralID != rewardID {
		t.Fatalf("referral id = %v, want %s", got.ReferralID, rewardID)
	}
	if got.ReferralCommissionKobo == nil || *got.ReferralCommissionKobo != 2000 {
		t.Errorf("commission = %v, want 2000", got.ReferralCommissionKobo)
	}
	if got.ReferralCommissionStatus == nil || *got.ReferralCommissionStatus != "CREDITED" {
		t.Errorf("status = %v, want CREDITED", got.ReferralCommissionStatus)
	}
	if got.ReferrerID == nil || *got.ReferrerID != referrer || got.ReferrerName == nil || *got.ReferrerName != "Ada Referrer" {
		t.Errorf("referrer = %v / %v, want %s / Ada Referrer", got.ReferrerID, got.ReferrerName, referrer)
	}
	for _, i := range []int{1, 2, 3} {
		if rows[i].ReferralID != nil || rows[i].ReferralCommissionKobo != nil {
			t.Errorf("row %s must not carry the commission: the reward belongs to the payer's purchase leg only", rows[i].ID)
		}
	}
}

func TestAdminReferral_CommissionSplitRewardIsFoundThroughTheEarning(t *testing.T) {
	pool := refPool(t)
	repo := NewRepository(pool)
	referrer := refUser(t, pool, "Ada Referrer")
	payer := refUser(t, pool, "Bola Payer")
	ref := "zzledref-ce-" + uuid.NewString()

	// The split records the reward as "commission:<earning id>", where the earning's
	// source_ref is the purchase's reference. (commission_earnings is append-only.)
	var earningID string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO public.commission_earnings
		  (service_category, service, gross_amount_kobo, spotlight_revenue_kobo, source_module, source_ref, user_id, idempotency_key)
		VALUES ('utility','electricity',100000,5000,'utility',$1,$2,$3) RETURNING id`,
		ref, payer, "zzledref-"+ref).Scan(&earningID); err != nil {
		t.Fatalf("seed earning: %v", err)
	}
	rewardID := seedReward(t, pool, referrer, payer, "commission:"+earningID, "CREDITED", 1000)

	rows := []AdminTransactionRow{{ID: "e1", Type: "DEBIT", Reference: ref, UserID: strp(payer)}}
	if err := repo.attachReferral(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	if rows[0].ReferralID == nil || *rows[0].ReferralID != rewardID {
		t.Fatalf("referral id = %v, want %s (found via commission_earnings.source_ref)", rows[0].ReferralID, rewardID)
	}
	if rows[0].ReferralCommissionKobo == nil || *rows[0].ReferralCommissionKobo != 1000 {
		t.Errorf("commission = %v, want 1000", rows[0].ReferralCommissionKobo)
	}
}

func TestAdminReferral_ReversedRewardIsShownButNotCounted(t *testing.T) {
	pool := refPool(t)
	repo := NewRepository(pool)
	referrer := refUser(t, pool, "R")
	payer := refUser(t, pool, "P")
	tag := "zzledref-" + uuid.NewString()
	seedReward(t, pool, referrer, payer, tag, "REVERSED", 2000)

	rows := []AdminTransactionRow{{ID: "e1", Type: "DEBIT", Reference: tag, UserID: strp(payer)}}
	if err := repo.attachReferral(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	if rows[0].ReferralCommissionStatus == nil || *rows[0].ReferralCommissionStatus != "REVERSED" {
		t.Fatalf("status = %v, want REVERSED", rows[0].ReferralCommissionStatus)
	}
	if rows[0].ReferralCommissionKobo == nil || *rows[0].ReferralCommissionKobo != 0 {
		t.Errorf("a fully reversed reward earns 0 net commission, got %v", rows[0].ReferralCommissionKobo)
	}
}

func TestAdminReferral_NoRewardLeavesTheRowUntouched(t *testing.T) {
	pool := refPool(t)
	repo := NewRepository(pool)
	payer := refUser(t, pool, "P")
	rows := []AdminTransactionRow{{ID: "e1", Type: "DEBIT", Reference: "zzledref-none-" + uuid.NewString(), UserID: strp(payer)}}
	if err := repo.attachReferral(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	if rows[0].ReferralID != nil || rows[0].ReferralCommissionKobo != nil || rows[0].ReferrerID != nil {
		t.Fatalf("a purchase with no referral reward must carry no referral fields, got %+v", rows[0])
	}
}

func TestAdminReferral_EmptyPageIsANoOp(t *testing.T) {
	pool := refPool(t)
	if err := NewRepository(pool).attachReferral(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
}
