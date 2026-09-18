package referrals_test

// Live-DB coverage for the Refer & Earn modification (Module 8 spec sign-off,
// 2026-09-18): Admin as the default referrer, signup points, and the 100-
// commission-event lifetime cap per referral code with an Admin handoff.
//
// The rate computation itself (tiered 5/8/12/15% by active-referral-count) is
// UNCHANGED and already covered by the prior sign-off — these tests exercise
// only what's new: attribution always resolving (never left empty), the
// Admin fallback across every no-code/invalid-code/self-referral path, the
// atomic cap counter, the Admin handoff at event 101, and that a refund does
// not give back the consumed slot.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
)

// withAdmin seeds a real auth user to act as the platform Admin, points
// SUPER_ADMIN_USER_ID at it for the duration of the test, and restores the
// previous env value afterwards (tests in this package may run in parallel
// within the same process only if none of them touch this env var — none of
// the existing ones do).
func withAdmin(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	adminID := newUser(t, ctx, pool)
	prev, had := os.LookupEnv(referrals.EnvSuperAdminUserID)
	if err := os.Setenv(referrals.EnvSuperAdminUserID, adminID); err != nil {
		t.Fatalf("set admin env: %v", err)
	}
	t.Cleanup(func() {
		if had {
			_ = os.Setenv(referrals.EnvSuperAdminUserID, prev)
		} else {
			_ = os.Unsetenv(referrals.EnvSuperAdminUserID)
		}
	})
	return adminID
}

func TestLiveDB_AttributeOrDefault_NoCodeDefaultsToAdmin(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	adminID := withAdmin(t, ctx, pool)
	user := newUser(t, ctx, pool)

	referrerID, usedDefault, invalidCode, err := s.AttributeOrDefault(ctx, user, "")
	if err != nil {
		t.Fatalf("AttributeOrDefault: %v", err)
	}
	if referrerID != adminID {
		t.Errorf("referrer = %q, want Admin %q", referrerID, adminID)
	}
	if !usedDefault {
		t.Error("usedAdminDefault = false, want true for an empty code")
	}
	if invalidCode {
		t.Error("invalidCode = true, want false — an empty code is not an invalid one")
	}
}

func TestLiveDB_AttributeOrDefault_UnknownCodeFallsBackToAdminNotRejected(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	adminID := withAdmin(t, ctx, pool)
	user := newUser(t, ctx, pool)

	referrerID, usedDefault, invalidCode, err := s.AttributeOrDefault(ctx, user, "NOSUCH")
	if err != nil {
		t.Fatalf("AttributeOrDefault must succeed (signup is not blocked by a bad code), got: %v", err)
	}
	if referrerID != adminID {
		t.Errorf("referrer = %q, want Admin %q", referrerID, adminID)
	}
	if !usedDefault || !invalidCode {
		t.Errorf("usedAdminDefault=%v invalidCode=%v, want both true for an unknown code", usedDefault, invalidCode)
	}
}

func TestLiveDB_AttributeOrDefault_SelfReferralFallsBackToAdmin(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	adminID := withAdmin(t, ctx, pool)
	user := newUser(t, ctx, pool)

	link, err := s.GetOrCreateLink(ctx, user)
	if err != nil {
		t.Fatalf("GetOrCreateLink: %v", err)
	}
	referrerID, usedDefault, _, err := s.AttributeOrDefault(ctx, user, link.Code)
	if err != nil {
		t.Fatalf("AttributeOrDefault must succeed even on self-referral (not a hard signup failure): %v", err)
	}
	if referrerID != adminID {
		t.Errorf("self-referral: referrer = %q, want Admin %q (no self-earning)", referrerID, adminID)
	}
	if !usedDefault {
		t.Error("usedAdminDefault = false, want true for a rejected self-referral")
	}
}

func TestLiveDB_AttributeOrDefault_ValidCodeStillAttributesNormally(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	withAdmin(t, ctx, pool)
	referrer, referred := newUser(t, ctx, pool), newUser(t, ctx, pool)

	link, err := s.GetOrCreateLink(ctx, referrer)
	if err != nil {
		t.Fatalf("GetOrCreateLink: %v", err)
	}
	referrerID, usedDefault, _, err := s.AttributeOrDefault(ctx, referred, link.Code)
	if err != nil {
		t.Fatalf("AttributeOrDefault: %v", err)
	}
	if referrerID != referrer {
		t.Errorf("referrer = %q, want the real referrer %q", referrerID, referrer)
	}
	if usedDefault {
		t.Error("usedAdminDefault = true, want false for a valid code")
	}
}

func TestLiveDB_AttributeOrDefault_LockedInPermanently(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	withAdmin(t, ctx, pool)
	referrer, referred := newUser(t, ctx, pool), newUser(t, ctx, pool)

	// Attributed to Admin first (no code).
	first, _, _, err := s.AttributeOrDefault(ctx, referred, "")
	if err != nil {
		t.Fatalf("first AttributeOrDefault: %v", err)
	}

	// A later attempt with a REAL code must NOT change the relationship — spec:
	// "locked in permanently at signup."
	link, err := s.GetOrCreateLink(ctx, referrer)
	if err != nil {
		t.Fatalf("GetOrCreateLink: %v", err)
	}
	second, _, _, err := s.AttributeOrDefault(ctx, referred, link.Code)
	if err != nil {
		t.Fatalf("second AttributeOrDefault: %v", err)
	}
	if second != first {
		t.Errorf("referrer changed from %q to %q after a post-signup code entry — must be locked in permanently", first, second)
	}
}

// seedHouseFallbackPlaceholder simulates exactly what the pre-existing §7A
// attribution engine (referral/attribution, wired into every real signup ahead
// of Module 8 via NewSignupAttributor) leaves behind for a no-code/unresolved
// signup: a referral_attributions row with referrer_id NULL and
// attribution_type='global_house'. Module 8's AttributeOrDefault must be able
// to run AFTER this row already exists (which it always will, once wired into
// the signup flow) and still actually attribute to Admin.
func seedHouseFallbackPlaceholder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, referredUserID string) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`INSERT INTO referral_attributions (referred_user_id, referrer_id, attribution_type, is_house)
		 VALUES ($1, NULL, 'global_house', true)`, referredUserID); err != nil {
		t.Fatalf("seed §7A house placeholder: %v", err)
	}
}

func TestLiveDB_AttributeOrDefault_ClaimsExistingHousePlaceholderRow(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	adminID := withAdmin(t, ctx, pool)
	user := newUser(t, ctx, pool)

	// Simulate §7A having already run first (as it does on every real signup).
	seedHouseFallbackPlaceholder(t, ctx, pool, user)

	referrerID, usedDefault, _, err := s.AttributeOrDefault(ctx, user, "")
	if err != nil {
		t.Fatalf("AttributeOrDefault: %v", err)
	}
	if referrerID != adminID {
		t.Fatalf("referrer = %q, want Admin %q — a plain INSERT...DO NOTHING would silently no-op against the §7A placeholder and leave this empty, defeating the whole point of the modification", referrerID, adminID)
	}
	if !usedDefault {
		t.Error("usedAdminDefault = false, want true")
	}

	// And it must actually be usable for commission — OnPurchaseSettled reads
	// attributedReferrer the same way, so this proves the claim isn't just
	// visible to AttributeOrDefault's own return value but to the real read path.
	var storedReferrer *string
	if err := pool.QueryRow(ctx, `SELECT referrer_id FROM referral_attributions WHERE referred_user_id=$1`, user).Scan(&storedReferrer); err != nil {
		t.Fatalf("read back attribution row: %v", err)
	}
	if storedReferrer == nil || *storedReferrer != adminID {
		t.Errorf("stored referrer_id = %v, want Admin %q persisted in the row itself", storedReferrer, adminID)
	}
}

func TestLiveDB_AttributeOrDefault_NeverOverwritesARealPreExistingReferrer(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	withAdmin(t, ctx, pool)
	realReferrer, user := newUser(t, ctx, pool), newUser(t, ctx, pool)

	// Simulate §7A having already resolved a REAL referrer (e.g. via its own
	// code/deeplink/context chain) — this row already has a non-null referrer_id.
	if _, err := pool.Exec(ctx,
		`INSERT INTO referral_attributions (referred_user_id, referrer_id, attribution_type)
		 VALUES ($1, $2, 'code')`, user, realReferrer); err != nil {
		t.Fatalf("seed real pre-existing attribution: %v", err)
	}

	// A later call — even with a DIFFERENT code, or none at all — must not
	// disturb it ("locked in permanently").
	referrerID, usedDefault, _, err := s.AttributeOrDefault(ctx, user, "")
	if err != nil {
		t.Fatalf("AttributeOrDefault: %v", err)
	}
	if referrerID != realReferrer {
		t.Errorf("referrer = %q, want the pre-existing real referrer %q untouched", referrerID, realReferrer)
	}
	if usedDefault {
		t.Error("usedAdminDefault = true, want false — a real referrer already existed")
	}
}

func TestLiveDB_SignupPoints_AwardedOncePerUser(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	user := newUser(t, ctx, pool)

	if err := s.AwardSignupPoints(ctx, user); err != nil {
		t.Fatalf("first award: %v", err)
	}
	if err := s.AwardSignupPoints(ctx, user); err != nil {
		t.Fatalf("second award (idempotent replay): %v", err)
	}
	total, err := s.TotalPoints(ctx, user)
	if err != nil {
		t.Fatalf("TotalPoints: %v", err)
	}
	if total != referrals.SignupPoints {
		t.Errorf("total points = %d, want exactly %d (no double-award on replay)", total, referrals.SignupPoints)
	}
}

func TestLiveDB_KYCPoints_StacksWithSignupPoints(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	user := newUser(t, ctx, pool)

	if err := s.AwardSignupPoints(ctx, user); err != nil {
		t.Fatalf("signup award: %v", err)
	}
	if err := s.AwardKYCPoints(ctx, user); err != nil {
		t.Fatalf("kyc award: %v", err)
	}
	total, err := s.TotalPoints(ctx, user)
	if err != nil {
		t.Fatalf("TotalPoints: %v", err)
	}
	if want := referrals.SignupPoints + referrals.KYCUpdatePoints; total != want {
		t.Errorf("total points = %d, want %d (1 signup + 5 KYC)", total, want)
	}
}

// settle fires a purchase-settled event for referredUser under referrer's
// attribution, with a fixed margin, and returns the resulting reward row.
func settle(t *testing.T, ctx context.Context, s *referrals.RewardService, referredUser, txnID string, marginKobo int64) {
	t.Helper()
	if err := s.OnPurchaseSettled(ctx, referrals.PurchaseSettled{
		Module: "test", TransactionID: txnID, PayerUserID: referredUser, MarginKobo: marginKobo, Currency: "NGN",
	}); err != nil {
		t.Fatalf("OnPurchaseSettled(%s): %v", txnID, err)
	}
}

func TestLiveDB_CommissionCap_Event100PaysReferrer_Event101PaysAdmin(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	adminID := withAdmin(t, ctx, pool)
	referrer := newUser(t, ctx, pool)

	// Fast-forward the cap to 99 directly (avoids 99 real purchase-settled calls
	// per test — the atomicity of the 99->100->101 transition is what matters,
	// not re-proving events 1-98 which are structurally identical to event 99).
	if _, err := pool.Exec(ctx,
		`INSERT INTO referral_commission_caps (referrer_id, commission_events_used) VALUES ($1, 99)`,
		referrer); err != nil {
		t.Fatalf("seed cap at 99: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM referral_commission_caps WHERE referrer_id=$1`, referrer)
	})

	referred100 := newUser(t, ctx, pool)
	if _, _, _, err := s.AttributeOrDefault(ctx, referred100, mustLinkCode(t, ctx, s, referrer)); err != nil {
		t.Fatalf("attribute referred100: %v", err)
	}
	adminBalBefore, _ := ledgerSvc.GetBalance(ctx, adminID)
	referrerBalBefore, _ := ledgerSvc.GetBalance(ctx, referrer)

	// Event #100 — still under the cap, referrer earns.
	settle(t, ctx, s, referred100, "cap-evt-100-"+uuid.NewString(), 100_000) // margin 1000.00 NGN -> 5% = 50.00 NGN = 5000 kobo

	status, err := s.GetCommissionCapStatus(ctx, referrer)
	if err != nil {
		t.Fatalf("GetCommissionCapStatus: %v", err)
	}
	if status.CommissionEventsUsed != 100 {
		t.Errorf("commission_events_used = %d, want 100 after event #100", status.CommissionEventsUsed)
	}
	if !status.Capped {
		t.Error("Capped = false after reaching exactly 100 events, want true")
	}
	referrerBalAfter100, _ := ledgerSvc.GetBalance(ctx, referrer)
	if referrerBalAfter100-referrerBalBefore != 5000 {
		t.Errorf("referrer wallet moved %d kobo on event #100, want +5000 (still under the cap)", referrerBalAfter100-referrerBalBefore)
	}

	// Event #101 — a DIFFERENT referred user under the SAME code. Must pay Admin,
	// not the referrer — proves the cap is on the CODE, not any one referred user.
	referred101 := newUser(t, ctx, pool)
	if _, _, _, err := s.AttributeOrDefault(ctx, referred101, mustLinkCode(t, ctx, s, referrer)); err != nil {
		t.Fatalf("attribute referred101: %v", err)
	}
	settle(t, ctx, s, referred101, "cap-evt-101-"+uuid.NewString(), 100_000)

	referrerBalAfter101, _ := ledgerSvc.GetBalance(ctx, referrer)
	if referrerBalAfter101 != referrerBalAfter100 {
		t.Errorf("referrer wallet moved on event #101 (%d -> %d), want unchanged — code is capped", referrerBalAfter100, referrerBalAfter101)
	}
	adminBalAfter, _ := ledgerSvc.GetBalance(ctx, adminID)
	if adminBalAfter-adminBalBefore != 5000 {
		t.Errorf("admin wallet moved %d kobo, want +5000 — event #101's commission must go to Admin", adminBalAfter-adminBalBefore)
	}

	// The reward row itself must record who actually got paid and that it was capped.
	rewards, err := s.ListEarnings(ctx, referrer, 10, 0)
	if err != nil {
		t.Fatalf("ListEarnings: %v", err)
	}
	var found101 bool
	for _, r := range rewards {
		if r.ReferredUserID == referred101 {
			found101 = true
			if !r.Capped {
				t.Error("event #101's reward row: Capped = false, want true")
			}
			if r.PayeeID == nil || *r.PayeeID != adminID {
				t.Errorf("event #101's reward row: PayeeID = %v, want Admin %q", r.PayeeID, adminID)
			}
		}
	}
	if !found101 {
		t.Fatal("event #101's reward row not found under the referrer's earnings list")
	}
}

func TestLiveDB_CommissionCap_ConcurrentEventsNearCapOnlyOnePaysReferrer(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	adminID := withAdmin(t, ctx, pool)
	referrer := newUser(t, ctx, pool)

	// Seed at 99 — exactly ONE of two concurrent events can be #100 (referrer);
	// the other must be #101 (Admin). This is the race the atomic
	// INSERT...ON CONFLICT...WHERE guard exists to prevent.
	if _, err := pool.Exec(ctx,
		`INSERT INTO referral_commission_caps (referrer_id, commission_events_used) VALUES ($1, 99)`,
		referrer); err != nil {
		t.Fatalf("seed cap at 99: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM referral_commission_caps WHERE referrer_id=$1`, referrer)
	})

	code := mustLinkCode(t, ctx, s, referrer)
	referredA, referredB := newUser(t, ctx, pool), newUser(t, ctx, pool)
	if _, _, _, err := s.AttributeOrDefault(ctx, referredA, code); err != nil {
		t.Fatalf("attribute A: %v", err)
	}
	if _, _, _, err := s.AttributeOrDefault(ctx, referredB, code); err != nil {
		t.Fatalf("attribute B: %v", err)
	}

	referrerBalBefore, _ := ledgerSvc.GetBalance(ctx, referrer)
	adminBalBefore, _ := ledgerSvc.GetBalance(ctx, adminID)

	done := make(chan error, 2)
	go func() {
		done <- s.OnPurchaseSettled(ctx, referrals.PurchaseSettled{
			Module: "test", TransactionID: "race-a-" + uuid.NewString(), PayerUserID: referredA, MarginKobo: 100_000, Currency: "NGN",
		})
	}()
	go func() {
		done <- s.OnPurchaseSettled(ctx, referrals.PurchaseSettled{
			Module: "test", TransactionID: "race-b-" + uuid.NewString(), PayerUserID: referredB, MarginKobo: 100_000, Currency: "NGN",
		})
	}()
	for i := 0; i < 2; i++ {
		if err := <-done; err != nil {
			t.Fatalf("concurrent OnPurchaseSettled: %v", err)
		}
	}

	status, err := s.GetCommissionCapStatus(ctx, referrer)
	if err != nil {
		t.Fatalf("GetCommissionCapStatus: %v", err)
	}
	if status.CommissionEventsUsed != 100 {
		t.Errorf("commission_events_used = %d, want exactly 100 (not 101 — the cap must not be exceeded)", status.CommissionEventsUsed)
	}

	referrerBalAfter, _ := ledgerSvc.GetBalance(ctx, referrer)
	adminBalAfter, _ := ledgerSvc.GetBalance(ctx, adminID)
	referrerGain := referrerBalAfter - referrerBalBefore
	adminGain := adminBalAfter - adminBalBefore
	if referrerGain != 5000 {
		t.Errorf("referrer gained %d kobo across both concurrent events, want exactly 5000 (exactly ONE of the two must pay the referrer)", referrerGain)
	}
	if adminGain != 5000 {
		t.Errorf("admin gained %d kobo across both concurrent events, want exactly 5000 (the OTHER event must pay Admin)", adminGain)
	}
}

func TestLiveDB_CommissionCap_RefundDoesNotFreeUpTheSlot(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	withAdmin(t, ctx, pool)
	referrer, referred := newUser(t, ctx, pool), newUser(t, ctx, pool)

	if _, err := pool.Exec(ctx,
		`INSERT INTO referral_commission_caps (referrer_id, commission_events_used) VALUES ($1, 99)`,
		referrer); err != nil {
		t.Fatalf("seed cap at 99: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM referral_commission_caps WHERE referrer_id=$1`, referrer)
	})
	code := mustLinkCode(t, ctx, s, referrer)
	if _, _, _, err := s.AttributeOrDefault(ctx, referred, code); err != nil {
		t.Fatalf("attribute: %v", err)
	}

	txnID := "refund-slot-" + uuid.NewString()
	settle(t, ctx, s, referred, txnID, 100_000) // event #100 — pays referrer, code now capped

	balAfterCredit, _ := ledgerSvc.GetBalance(ctx, referrer)

	if err := s.OnPurchaseRefunded(ctx, referrals.PurchaseRefunded{TransactionID: txnID}); err != nil {
		t.Fatalf("OnPurchaseRefunded: %v", err)
	}
	balAfterRefund, _ := ledgerSvc.GetBalance(ctx, referrer)
	if balAfterCredit-balAfterRefund != 5000 {
		t.Errorf("refund reversed %d kobo, want exactly 5000 (the original credit)", balAfterCredit-balAfterRefund)
	}

	// The slot must NOT be freed — the code stays capped even though the event
	// that consumed slot #100 was refunded.
	status, err := s.GetCommissionCapStatus(ctx, referrer)
	if err != nil {
		t.Fatalf("GetCommissionCapStatus: %v", err)
	}
	if status.CommissionEventsUsed != 100 || !status.Capped {
		t.Errorf("after refund: commission_events_used=%d capped=%v, want unchanged (100, true) — a refund must not un-cap the code", status.CommissionEventsUsed, status.Capped)
	}
}

// TestLiveDB_CommissionCap_RetryOfSameTransactionNeverBurnsASecondSlot is the
// exact scenario a ledger-auditor review of this feature flagged as a real
// money-safety defect in an earlier version: OnPurchaseSettled used to consume
// a cap slot BEFORE inserting the (idempotency-anchoring) reward row, so a
// retry of an already-in-flight transaction — a crash, an at-least-once queue
// redelivery, a manual retry — could burn a SECOND slot for one purchase, and
// once that pushed the code over 100, wrongly redirect that purchase's own
// commission to Admin on the retry. Fixed by making "insert the row" and
// "consume the slot" one atomic transaction (insertRewardAndResolveCap).
//
// This simulates the retry directly: call OnPurchaseSettled twice with the
// SAME TransactionID for a referrer sitting at exactly 99 (event #100 is the
// one under test). The second call must be a pure idempotent no-op — same
// payee, same amount, no second slot consumed, no second ledger posting.
func TestLiveDB_CommissionCap_RetryOfSameTransactionNeverBurnsASecondSlot(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	withAdmin(t, ctx, pool)
	referrer, referred := newUser(t, ctx, pool), newUser(t, ctx, pool)

	if _, err := pool.Exec(ctx,
		`INSERT INTO referral_commission_caps (referrer_id, commission_events_used) VALUES ($1, 99)`,
		referrer); err != nil {
		t.Fatalf("seed cap at 99: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM referral_commission_caps WHERE referrer_id=$1`, referrer)
	})
	code := mustLinkCode(t, ctx, s, referrer)
	if _, _, _, err := s.AttributeOrDefault(ctx, referred, code); err != nil {
		t.Fatalf("attribute: %v", err)
	}

	txnID := "retry-same-txn-" + uuid.NewString()
	referrerBalBefore, _ := ledgerSvc.GetBalance(ctx, referrer)

	// First delivery: event #100, still under the cap — pays the referrer.
	settle(t, ctx, s, referred, txnID, 100_000)

	// Second delivery of the SAME transaction id (the retry/redelivery).
	settle(t, ctx, s, referred, txnID, 100_000)

	status, err := s.GetCommissionCapStatus(ctx, referrer)
	if err != nil {
		t.Fatalf("GetCommissionCapStatus: %v", err)
	}
	if status.CommissionEventsUsed != 100 {
		t.Errorf("commission_events_used = %d after retrying ONE transaction, want exactly 100 (a replay must never consume a second slot)", status.CommissionEventsUsed)
	}
	if status.Capped != true {
		t.Error("Capped = false, want true — event #100 should have capped the code exactly once")
	}

	referrerBalAfter, _ := ledgerSvc.GetBalance(ctx, referrer)
	if referrerBalAfter-referrerBalBefore != 5000 {
		t.Errorf("referrer wallet moved %d kobo across both deliveries of ONE transaction, want exactly 5000 (idempotent replay, not a double credit)", referrerBalAfter-referrerBalBefore)
	}

	rewards, err := s.ListEarnings(ctx, referrer, 10, 0)
	if err != nil {
		t.Fatalf("ListEarnings: %v", err)
	}
	var matches int
	for _, r := range rewards {
		if r.SourceTransactionID == txnID {
			matches++
			if r.Capped {
				t.Error("the reward row for this transaction is marked Capped=true, want false — it was event #100, still under the cap")
			}
			if r.PayeeID == nil || *r.PayeeID != referrer {
				t.Errorf("PayeeID = %v, want the referrer %q — a retry must never re-derive a different payee for an already-settled transaction", r.PayeeID, referrer)
			}
		}
	}
	if matches != 1 {
		t.Fatalf("found %d reward rows for one transaction id, want exactly 1 (source_transaction_id is UNIQUE)", matches)
	}
}

// TestLiveDB_GetCase_SurfacesCommissionCapStatus is the admin-portal-facing
// regression: the A5 case view (already wired into frontend-admin's referral
// case page) must show a referrer's cap progress, so an admin can actually see
// "capped/retired" status rather than the commission silently vanishing to
// Admin with no visible explanation.
func TestLiveDB_GetCase_SurfacesCommissionCapStatus(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	referrer := newUser(t, ctx, pool)

	before, err := s.GetCase(ctx, referrer)
	if err != nil {
		t.Fatalf("GetCase (before any commission events): %v", err)
	}
	if before.CommissionCap == nil {
		t.Fatal("CommissionCap is nil, want a zero-value status (0 used, not capped) even before any commission event")
	}
	if before.CommissionCap.CommissionEventsUsed != 0 || before.CommissionCap.Capped {
		t.Errorf("CommissionCap = %+v, want zero-value before any commission event", before.CommissionCap)
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO referral_commission_caps (referrer_id, commission_events_used, capped_at) VALUES ($1, 100, now())`,
		referrer); err != nil {
		t.Fatalf("seed capped code: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM referral_commission_caps WHERE referrer_id=$1`, referrer)
	})

	after, err := s.GetCase(ctx, referrer)
	if err != nil {
		t.Fatalf("GetCase (after capping): %v", err)
	}
	if after.CommissionCap == nil || !after.CommissionCap.Capped || after.CommissionCap.CommissionEventsUsed != 100 {
		t.Errorf("CommissionCap = %+v, want {CommissionEventsUsed:100 Capped:true}", after.CommissionCap)
	}
}

// mustLinkCode is a small helper so the cap tests read as "attribute under this
// referrer's code" without repeating the GetOrCreateLink boilerplate.
func mustLinkCode(t *testing.T, ctx context.Context, s *referrals.RewardService, referrer string) string {
	t.Helper()
	link, err := s.GetOrCreateLink(ctx, referrer)
	if err != nil {
		t.Fatalf("GetOrCreateLink: %v", err)
	}
	return link.Code
}
