package referrals_test

// Live-DB tests for the Direct Referral Rewards ENGINE money path (REF-005).
//
// SKIPPED whenever TEST_DATABASE_URL is unset, and it does NOT fall back to
// DATABASE_URL — same convention as
// backend/internal/referral/ledger/withdraw_integration_test.go and
// backend/internal/referral/compliance/consent_append_only_live_db_test.go.
// Point it at a disposable, migrated Postgres:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/finance/referrals/... -v
//
// Each test seeds its own users with fresh UUIDs and registers
// testsupport.CleanupUser, so runs never observe each other's rows and are
// safe to run repeatedly without a truncate.

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	"spotlight/backend/internal/testsupport"
)

func liveRewardsPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB referral rewards test")
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

func mustRewardExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

// seedRewardUser inserts a bare auth.users row and registers cleanup.
func seedRewardUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	uid := uuid.NewString()
	mustRewardExec(t, pool, `INSERT INTO auth.users (id, email) VALUES ($1,$2)`,
		uid, "rwd-"+uid+"@test.local")
	testsupport.CleanupUser(t, pool, uid)
	return uid
}

// seedAttribution links a referred user to a referrer via referral_attributions
// (the table OnPurchaseSettled reads for the reward lookup).
func seedAttribution(t *testing.T, pool *pgxpool.Pool, referredUserID, referrerID string) {
	t.Helper()
	mustRewardExec(t, pool,
		`INSERT INTO referral_attributions (referred_user_id, referrer_id, attribution_type, code_used)
		 VALUES ($1,$2,'code','TESTCODE')`,
		referredUserID, referrerID)
}

// seedTierRate pins the referrer's applied rate deterministically, independent
// of whatever referral_program_config happens to be active on the target DB —
// currentRate() prefers a referral_tier_status row over the config lookup.
func seedTierRate(t *testing.T, pool *pgxpool.Pool, referrerID string, rate float64) {
	t.Helper()
	mustRewardExec(t, pool,
		`INSERT INTO referral_tier_status (referrer_id, active_referral_count, current_tier, current_rate)
		 VALUES ($1,1,'STARTER',$2)
		 ON CONFLICT (referrer_id) DO UPDATE SET current_rate=EXCLUDED.current_rate`,
		referrerID, rate)
}

func newRewardSvc(pool *pgxpool.Pool) (*referrals.RewardService, *financeledger.Service) {
	fin := financeledger.NewService(financeledger.NewRepository(pool), nil)
	return referrals.NewRewardService(pool, fin), fin
}

func rewardRow(t *testing.T, pool *pgxpool.Pool, transactionID string) (id, status string, rewardKobo int64, marginKobo int64, appliedRate float64) {
	t.Helper()
	err := pool.QueryRow(context.Background(),
		`SELECT id, status, reward_kobo, margin_kobo, applied_rate FROM referral_rewards WHERE source_transaction_id=$1`,
		transactionID).Scan(&id, &status, &rewardKobo, &marginKobo, &appliedRate)
	if err != nil {
		t.Fatalf("load reward row for %s: %v", transactionID, err)
	}
	return
}

func countRewardRows(t *testing.T, pool *pgxpool.Pool, transactionID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM referral_rewards WHERE source_transaction_id=$1`, transactionID).Scan(&n); err != nil {
		t.Fatalf("count reward rows: %v", err)
	}
	return n
}

// ============================================================================
// OnPurchaseSettled — normal crediting + idempotency + rounding.
// ============================================================================

// TestOnPurchaseSettled_CreditsReward_Integration proves the full happy path:
// one referral_rewards row, CREDITED, reward_kobo == floor(margin*rate), and
// the referrer's wallet balance moved by exactly that amount via a balanced
// ledger credit.
func TestOnPurchaseSettled_CreditsReward_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveRewardsPool(t)
	t.Cleanup(pool.Close)
	svc, fin := newRewardSvc(pool)

	referrer := seedRewardUser(t, pool)
	payer := seedRewardUser(t, pool)
	seedAttribution(t, pool, payer, referrer)
	seedTierRate(t, pool, referrer, 0.10) // 10% flat for this test

	txnID := "txn-" + uuid.NewString()
	err := svc.OnPurchaseSettled(ctx, referrals.PurchaseSettled{
		Module:        "marketplace",
		TransactionID: txnID,
		PayerUserID:   payer,
		MarginKobo:    100_000, // ₦1,000 margin
	})
	if err != nil {
		t.Fatalf("OnPurchaseSettled: %v", err)
	}

	id, status, rewardKobo, marginKobo, appliedRate := rewardRow(t, pool, txnID)
	if status != referrals.RewardStatusCredited {
		t.Fatalf("status = %q, want CREDITED", status)
	}
	wantReward := referrals.ComputeReward(marginKobo, appliedRate)
	if rewardKobo != wantReward {
		t.Fatalf("reward_kobo = %d, want %d (floor(%d*%v))", rewardKobo, wantReward, marginKobo, appliedRate)
	}
	if rewardKobo != 10_000 { // floor(100_000 * 0.10)
		t.Fatalf("reward_kobo = %d, want 10000", rewardKobo)
	}
	if id == "" {
		t.Fatal("reward row id is empty")
	}

	bal, err := fin.GetBalance(ctx, referrer)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if bal != 10_000 {
		t.Fatalf("referrer wallet balance = %d, want 10000 (balanced credit)", bal)
	}
}

// TestOnPurchaseSettled_FractionalTruncation_Integration pins the documented
// rounding rule (§4.1: reward = floor(margin_kobo * rate)) at a margin/rate
// combination that does NOT divide evenly, so a rounding bug (round-half-up,
// ceiling, etc.) would show up as an off-by-one on the persisted reward_kobo.
func TestOnPurchaseSettled_FractionalTruncation_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveRewardsPool(t)
	t.Cleanup(pool.Close)
	svc, _ := newRewardSvc(pool)

	referrer := seedRewardUser(t, pool)
	payer := seedRewardUser(t, pool)
	seedAttribution(t, pool, payer, referrer)
	seedTierRate(t, pool, referrer, 0.05) // 5%

	// 333 * 0.05 = 16.65 kobo — must truncate to 16, never round to 17.
	txnID := "txn-" + uuid.NewString()
	if err := svc.OnPurchaseSettled(ctx, referrals.PurchaseSettled{
		Module:        "bills",
		TransactionID: txnID,
		PayerUserID:   payer,
		MarginKobo:    333,
	}); err != nil {
		t.Fatalf("OnPurchaseSettled: %v", err)
	}

	_, status, rewardKobo, _, _ := rewardRow(t, pool, txnID)
	if status != referrals.RewardStatusCredited {
		t.Fatalf("status = %q, want CREDITED", status)
	}
	if rewardKobo != 16 {
		t.Fatalf("reward_kobo = %d, want 16 (floor(333*0.05)=16.65 truncated)", rewardKobo)
	}
	// Direct pin against the exported rounding function, so a future change to
	// either the SQL path or ComputeReward that disagrees with the other fails.
	if want := referrals.ComputeReward(333, 0.05); rewardKobo != want {
		t.Fatalf("reward_kobo = %d disagrees with ComputeReward = %d", rewardKobo, want)
	}
}

// TestOnPurchaseSettled_Idempotent_Integration replays the exact same
// TransactionID twice. The UNIQUE(source_transaction_id) constraint plus the
// insertOrGetReward fetch-on-conflict path must produce exactly one reward row
// and exactly one ledger credit — never a double payout.
func TestOnPurchaseSettled_Idempotent_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveRewardsPool(t)
	t.Cleanup(pool.Close)
	svc, fin := newRewardSvc(pool)

	referrer := seedRewardUser(t, pool)
	payer := seedRewardUser(t, pool)
	seedAttribution(t, pool, payer, referrer)
	seedTierRate(t, pool, referrer, 0.10)

	txnID := "txn-" + uuid.NewString()
	in := referrals.PurchaseSettled{
		Module:        "marketplace",
		TransactionID: txnID,
		PayerUserID:   payer,
		MarginKobo:    100_000,
	}

	if err := svc.OnPurchaseSettled(ctx, in); err != nil {
		t.Fatalf("first OnPurchaseSettled: %v", err)
	}
	if err := svc.OnPurchaseSettled(ctx, in); err != nil {
		t.Fatalf("replay OnPurchaseSettled: %v", err)
	}

	if n := countRewardRows(t, pool, txnID); n != 1 {
		t.Fatalf("referral_rewards rows for txn = %d, want exactly 1", n)
	}

	bal, err := fin.GetBalance(ctx, referrer)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if bal != 10_000 {
		t.Fatalf("referrer wallet balance after replay = %d, want 10000 (no double credit)", bal)
	}
}

// TestOnPurchaseSettled_NoAttribution_NoOp_Integration: an unattributed payer
// must produce no reward row and move no money (fail-closed no-op, §3).
func TestOnPurchaseSettled_NoAttribution_NoOp_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveRewardsPool(t)
	t.Cleanup(pool.Close)
	svc, _ := newRewardSvc(pool)

	payer := seedRewardUser(t, pool) // no referral_attributions row at all

	txnID := "txn-" + uuid.NewString()
	if err := svc.OnPurchaseSettled(ctx, referrals.PurchaseSettled{
		Module:        "marketplace",
		TransactionID: txnID,
		PayerUserID:   payer,
		MarginKobo:    100_000,
	}); err != nil {
		t.Fatalf("OnPurchaseSettled: %v", err)
	}
	if n := countRewardRows(t, pool, txnID); n != 0 {
		t.Fatalf("referral_rewards rows for unattributed payer = %d, want 0", n)
	}
}

// TestOnPurchaseSettled_SelfReferral_NoOp_Integration: the engine's own
// fail-closed guard (referrerID == PayerUserID) must refuse to pay a user for
// their own purchase even if a (malformed) self-attribution row exists.
func TestOnPurchaseSettled_SelfReferral_NoOp_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveRewardsPool(t)
	t.Cleanup(pool.Close)
	svc, _ := newRewardSvc(pool)

	user := seedRewardUser(t, pool)
	// Bypass Attribute()'s own self-referral rejection by writing the row
	// directly — this is exactly the "attribution should never do this, but
	// never pay a user for their own purchase" case the service comments call out.
	seedAttribution(t, pool, user, user)

	txnID := "txn-" + uuid.NewString()
	if err := svc.OnPurchaseSettled(ctx, referrals.PurchaseSettled{
		Module:        "marketplace",
		TransactionID: txnID,
		PayerUserID:   user,
		MarginKobo:    100_000,
	}); err != nil {
		t.Fatalf("OnPurchaseSettled: %v", err)
	}
	if n := countRewardRows(t, pool, txnID); n != 0 {
		t.Fatalf("referral_rewards rows for self-referral = %d, want 0", n)
	}
}

// TestOnPurchaseSettled_NonPositiveMargin_NoOp_Integration: margin<=0 must be a
// no-op per §4.1 even when attribution exists.
func TestOnPurchaseSettled_NonPositiveMargin_NoOp_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveRewardsPool(t)
	t.Cleanup(pool.Close)
	svc, _ := newRewardSvc(pool)

	referrer := seedRewardUser(t, pool)
	payer := seedRewardUser(t, pool)
	seedAttribution(t, pool, payer, referrer)
	seedTierRate(t, pool, referrer, 0.10)

	txnID := "txn-" + uuid.NewString()
	if err := svc.OnPurchaseSettled(ctx, referrals.PurchaseSettled{
		Module:        "marketplace",
		TransactionID: txnID,
		PayerUserID:   payer,
		MarginKobo:    0,
	}); err != nil {
		t.Fatalf("OnPurchaseSettled: %v", err)
	}
	if n := countRewardRows(t, pool, txnID); n != 0 {
		t.Fatalf("referral_rewards rows for zero margin = %d, want 0", n)
	}
}

// ============================================================================
// OnPurchaseRefunded — reversal on CREDITED, no-op otherwise, idempotent.
// ============================================================================

// TestOnPurchaseRefunded_ReversesCredited_Integration settles then refunds:
// the reward flips to REVERSED, the ledger reversal is balanced (wallet drained
// back to zero), and a second refund call is a safe no-op that neither
// double-reverses the row nor moves money again.
func TestOnPurchaseRefunded_ReversesCredited_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveRewardsPool(t)
	t.Cleanup(pool.Close)
	svc, fin := newRewardSvc(pool)

	referrer := seedRewardUser(t, pool)
	payer := seedRewardUser(t, pool)
	seedAttribution(t, pool, payer, referrer)
	seedTierRate(t, pool, referrer, 0.10)

	txnID := "txn-" + uuid.NewString()
	if err := svc.OnPurchaseSettled(ctx, referrals.PurchaseSettled{
		Module:        "marketplace",
		TransactionID: txnID,
		PayerUserID:   payer,
		MarginKobo:    100_000,
	}); err != nil {
		t.Fatalf("OnPurchaseSettled: %v", err)
	}
	balAfterCredit, err := fin.GetBalance(ctx, referrer)
	if err != nil {
		t.Fatalf("balance after credit: %v", err)
	}
	if balAfterCredit != 10_000 {
		t.Fatalf("balance after credit = %d, want 10000", balAfterCredit)
	}

	if err := svc.OnPurchaseRefunded(ctx, referrals.PurchaseRefunded{TransactionID: txnID}); err != nil {
		t.Fatalf("OnPurchaseRefunded: %v", err)
	}

	_, status, _, _, _ := rewardRow(t, pool, txnID)
	if status != referrals.RewardStatusReversed {
		t.Fatalf("status after refund = %q, want REVERSED", status)
	}
	balAfterRefund, err := fin.GetBalance(ctx, referrer)
	if err != nil {
		t.Fatalf("balance after refund: %v", err)
	}
	if balAfterRefund != 0 {
		t.Fatalf("balance after refund = %d, want 0 (balanced reversal drains the credit)", balAfterRefund)
	}

	// Replay the refund event — must be a safe no-op: status stays REVERSED,
	// balance stays 0 (never double-reversed).
	if err := svc.OnPurchaseRefunded(ctx, referrals.PurchaseRefunded{TransactionID: txnID}); err != nil {
		t.Fatalf("OnPurchaseRefunded replay: %v", err)
	}
	_, status2, _, _, _ := rewardRow(t, pool, txnID)
	if status2 != referrals.RewardStatusReversed {
		t.Fatalf("status after replayed refund = %q, want REVERSED", status2)
	}
	balAfterReplay, err := fin.GetBalance(ctx, referrer)
	if err != nil {
		t.Fatalf("balance after replayed refund: %v", err)
	}
	if balAfterReplay != 0 {
		t.Fatalf("balance after replayed refund = %d, want 0 (no double reversal)", balAfterReplay)
	}
}

// TestOnPurchaseRefunded_PendingReward_NoOp_Integration: a reward that is still
// PENDING (never reached CREDITED) must not be reversed — OnPurchaseRefunded's
// own status guard (`if status != RewardStatusCredited { return nil }`) says
// this is a no-op, not a rejection. We reach a PENDING row by inserting one
// directly, since the normal service path always resolves PENDING rows to
// CREDITED (or skips them) before returning.
func TestOnPurchaseRefunded_PendingReward_NoOp_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveRewardsPool(t)
	t.Cleanup(pool.Close)
	svc, fin := newRewardSvc(pool)

	referrer := seedRewardUser(t, pool)
	payer := seedRewardUser(t, pool)
	seedAttribution(t, pool, payer, referrer)

	txnID := "txn-" + uuid.NewString()
	mustRewardExec(t, pool,
		`INSERT INTO referral_rewards
		   (referrer_id, referred_user_id, source_transaction_id, module,
		    margin_kobo, applied_rate, reward_kobo, status, config_version)
		 VALUES ($1,$2,$3,'marketplace',100000,0.10,10000,'PENDING',1)`,
		referrer, payer, txnID)

	if err := svc.OnPurchaseRefunded(ctx, referrals.PurchaseRefunded{TransactionID: txnID}); err != nil {
		t.Fatalf("OnPurchaseRefunded: %v", err)
	}

	_, status, _, _, _ := rewardRow(t, pool, txnID)
	if status != referrals.RewardStatusPending {
		t.Fatalf("status = %q, want PENDING unchanged (refund on a never-credited reward is a no-op)", status)
	}
	bal, err := fin.GetBalance(ctx, referrer)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if bal != 0 {
		t.Fatalf("balance = %d, want 0 (no reversal posted against an uncredited reward)", bal)
	}
}

// TestOnPurchaseRefunded_UnknownTransaction_NoOp_Integration: refunding a
// transaction with no reward row at all is a fail-closed no-op, not an error.
func TestOnPurchaseRefunded_UnknownTransaction_NoOp_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveRewardsPool(t)
	t.Cleanup(pool.Close)
	svc, _ := newRewardSvc(pool)

	err := svc.OnPurchaseRefunded(ctx, referrals.PurchaseRefunded{TransactionID: "txn-" + uuid.NewString()})
	if err != nil {
		t.Fatalf("OnPurchaseRefunded for unknown txn = %v, want nil (no-op)", err)
	}
}

// ============================================================================
// ComputeReward — pure rounding-rule unit tests (no DB).
// ============================================================================

// ============================================================================
// ResolveCodeToReferrer — the REF-002 CodeResolver adapter (attribution engine
// entry point). resolveCode itself is exercised indirectly through this public
// method, which is what internal/referral/attribution wires against.
// ============================================================================

// TestResolveCodeToReferrer_ReferralLinksOnly_Integration: a code that exists
// ONLY in referral_links (the engine's own canonical table, minted via
// GetOrCreateLink) must resolve to its referrer.
func TestResolveCodeToReferrer_ReferralLinksOnly_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveRewardsPool(t)
	t.Cleanup(pool.Close)
	svc, _ := newRewardSvc(pool)

	referrer := seedRewardUser(t, pool)
	link, err := svc.GetOrCreateLink(ctx, referrer)
	if err != nil {
		t.Fatalf("GetOrCreateLink: %v", err)
	}

	got, err := svc.ResolveCodeToReferrer(ctx, link.Code)
	if err != nil {
		t.Fatalf("ResolveCodeToReferrer(%q): %v", link.Code, err)
	}
	if got != referrer {
		t.Fatalf("ResolveCodeToReferrer(%q) = %q, want %q", link.Code, got, referrer)
	}
}

// TestResolveCodeToReferrer_LegacyFinanceReferralCodesOnly_Integration: a code
// that exists ONLY in the legacy finance_referral_codes table (never touched
// referral_links) must still resolve — the fallback path this engine has
// always had must keep working.
func TestResolveCodeToReferrer_LegacyFinanceReferralCodesOnly_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveRewardsPool(t)
	t.Cleanup(pool.Close)
	svc, fin := newRewardSvc(pool)
	legacySvc := referrals.NewService(pool, fin)

	referrer := seedRewardUser(t, pool)
	code, err := legacySvc.GetOrCreateCode(ctx, referrer)
	if err != nil {
		t.Fatalf("GetOrCreateCode: %v", err)
	}

	got, err := svc.ResolveCodeToReferrer(ctx, code.Code)
	if err != nil {
		t.Fatalf("ResolveCodeToReferrer(%q): %v", code.Code, err)
	}
	if got != referrer {
		t.Fatalf("ResolveCodeToReferrer(%q) = %q, want %q", code.Code, got, referrer)
	}
}

// TestResolveCodeToReferrer_UnknownCode_Errors_Integration: a code present in
// neither table must return a non-nil error (never ("", nil)) — callers like
// attribution.Service treat "err != nil || referrerID == """ as the single
// "invalid code" signal, so a silent empty-string-no-error would be read the
// same way in practice, but must never regress to a false "resolved" state.
func TestResolveCodeToReferrer_UnknownCode_Errors_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveRewardsPool(t)
	t.Cleanup(pool.Close)
	svc, _ := newRewardSvc(pool)

	got, err := svc.ResolveCodeToReferrer(ctx, "NOSUCHCODE-"+uuid.NewString())
	if err == nil {
		t.Fatalf("ResolveCodeToReferrer(unknown) = (%q, nil), want a non-nil error", got)
	}
	if got != "" {
		t.Fatalf("ResolveCodeToReferrer(unknown) referrerID = %q, want empty", got)
	}
}

// ============================================================================
// REF-004 / REF-008 — shared code format across the two generators writing
// into finance_referral_codes, and case-insensitive resolution of whatever
// case a legacy row happens to be stored in.
// ============================================================================

// referralCodeAlphabet mirrors codeAlphabet in code.go — duplicated here
// (rather than exported test-only) because the point of this test is to
// verify the LEGACY Service's generateCode delegates to the exact same
// generator referral_links uses, not to re-test GenerateCode() itself (that
// is code_test.go's job).
const referralCodeAlphabet = "ABCDEFGHJKMNPQRTUVWXY346789"

// TestGetOrCreateCode_Legacy_MatchesSharedAlphabetFormat_Integration is the
// REF-004 regression: the legacy Service used to generate 8 lowercase hex
// characters via its own generateCode(), a format incompatible with both
// referral_links (5 chars, uppercase, curated alphabet) and the frontend's
// then-SPOT-XXXXXX format — three shapes writing into/reading from the same
// finance_referral_codes.code column. All issuers must now agree.
func TestGetOrCreateCode_Legacy_MatchesSharedAlphabetFormat_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveRewardsPool(t)
	t.Cleanup(pool.Close)
	_, fin := newRewardSvc(pool)
	legacySvc := referrals.NewService(pool, fin)

	referrer := seedRewardUser(t, pool)
	code, err := legacySvc.GetOrCreateCode(ctx, referrer)
	if err != nil {
		t.Fatalf("GetOrCreateCode: %v", err)
	}

	if got := len([]rune(code.Code)); got != 5 {
		t.Fatalf("legacy generated code %q is %d characters, want 5 (the referral_links shape)", code.Code, got)
	}
	if code.Code != strings.ToUpper(code.Code) {
		t.Fatalf("legacy generated code %q is not uppercase-only", code.Code)
	}
	for _, r := range code.Code {
		if !strings.ContainsRune(referralCodeAlphabet, r) {
			t.Fatalf("legacy generated code %q contains %q, not in the shared alphabet %q", code.Code, string(r), referralCodeAlphabet)
		}
	}
}

// TestResolveCodeToReferrer_LegacyService_CaseInsensitive_Integration is the
// REF-008 regression on the LEGACY Service.ResolveCodeToReferrer itself
// (distinct from RewardService's two-table resolver exercised elsewhere in
// this file): a code stored in lowercase — exactly what the pre-fix
// generateCode() used to emit — must still resolve when looked up in a
// different case, mirroring what internal/referral/attribution's
// normalizeCode() does to every code entered at signup.
func TestResolveCodeToReferrer_LegacyService_CaseInsensitive_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveRewardsPool(t)
	t.Cleanup(pool.Close)
	_, fin := newRewardSvc(pool)
	legacySvc := referrals.NewService(pool, fin)

	referrer := seedRewardUser(t, pool)
	const storedLowercase = "abcde"
	mustRewardExec(t, pool,
		`INSERT INTO finance_referral_codes (user_id, code) VALUES ($1,$2)`,
		referrer, storedLowercase)

	// Looked up in UPPERCASE — the shape normalizeCode() always produces.
	got, err := legacySvc.ResolveCodeToReferrer(ctx, "ABCDE")
	if err != nil {
		t.Fatalf("ResolveCodeToReferrer(uppercase lookup of lowercase-stored code): %v", err)
	}
	if got != referrer {
		t.Fatalf("ResolveCodeToReferrer(%q) = %q, want %q", "ABCDE", got, referrer)
	}

	// Looked up in the ORIGINAL stored case too — must still work.
	got2, err := legacySvc.ResolveCodeToReferrer(ctx, storedLowercase)
	if err != nil {
		t.Fatalf("ResolveCodeToReferrer(original case): %v", err)
	}
	if got2 != referrer {
		t.Fatalf("ResolveCodeToReferrer(%q) = %q, want %q", storedLowercase, got2, referrer)
	}
}

// TestResolveCodeToReferrer_RewardService_LegacyLowercaseCode_Integration is
// the REF-008 regression on the production wiring: internal/app/referral_routes.go
// wires RewardService (not the legacy Service) as attribution's CodeResolver,
// so its finance_referral_codes fallback — resolveCode()'s q2 — is the query
// that actually runs at signup. A lowercase-stored legacy code must resolve
// through it too.
func TestResolveCodeToReferrer_RewardService_LegacyLowercaseCode_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveRewardsPool(t)
	t.Cleanup(pool.Close)
	svc, _ := newRewardSvc(pool)

	referrer := seedRewardUser(t, pool)
	const storedLowercase = "wxy34"
	mustRewardExec(t, pool,
		`INSERT INTO finance_referral_codes (user_id, code) VALUES ($1,$2)`,
		referrer, storedLowercase)

	got, err := svc.ResolveCodeToReferrer(ctx, "WXY34")
	if err != nil {
		t.Fatalf("ResolveCodeToReferrer(uppercase lookup of lowercase-stored legacy code): %v", err)
	}
	if got != referrer {
		t.Fatalf("ResolveCodeToReferrer(%q) = %q, want %q", "WXY34", got, referrer)
	}
}

func TestComputeReward_FloorsFractionalKobo(t *testing.T) {
	cases := []struct {
		name       string
		marginKobo int64
		rate       float64
		want       int64
	}{
		{"exact division", 100_000, 0.10, 10_000},
		{"truncates down, never rounds", 333, 0.05, 16},        // 16.65 -> 16
		{"truncates down at .99 fraction", 199, 0.5, 99},       // 99.5 -> 99
		{"zero margin", 0, 0.10, 0},
		{"zero rate", 100_000, 0, 0},
		{"negative margin is zeroed (never pays on a loss)", -100, 0.10, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := referrals.ComputeReward(tc.marginKobo, tc.rate)
			if got != tc.want {
				t.Errorf("ComputeReward(%d, %v) = %d, want %d", tc.marginKobo, tc.rate, got, tc.want)
			}
		})
	}
}
