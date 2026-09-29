package attribution_test

// Live-DB regression guard for an explicit 2026-09-18 product decision: signup
// must NEVER be profitable, for a real referrer OR for the house — a referrer
// earns only when the REFERRED user goes on to purchase a service (see
// referral/commissionsplit for that path). This used to accrue a notional
// ₦500 (attribution.HouseReferrerRewardKobo) into referral_reward_ledger on
// EVERY signup, human-referrer or house; that accrual was removed from
// attributeToReferrer/attributeToHouseAccount and this pins its absence so it
// can never silently come back.
//
// SKIPPED whenever TEST_DATABASE_URL is unset.

import (
	"context"
	"testing"

	"github.com/google/uuid"

	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	"spotlight/backend/internal/referral/attribution"
)

func TestResolveReferrer_NeverAccruesAnythingOnSignup_HumanReferrer(t *testing.T) {
	ctx := context.Background()
	pool := liveAttribPool(t)
	t.Cleanup(pool.Close)

	referrer := seedAttribUser(t, pool)
	referred := seedAttribUser(t, pool)

	fin := financeledger.NewService(financeledger.NewRepository(pool), nil)
	rewardSvc := referrals.NewRewardService(pool, fin)
	link, err := rewardSvc.GetOrCreateLink(ctx, referrer)
	if err != nil {
		t.Fatalf("GetOrCreateLink: %v", err)
	}

	svc := newLiveAttributionService(pool)
	att, err := svc.ResolveReferrer(ctx, referred, attribution.ResolveOpts{CodeEntered: link.Code})
	if err != nil {
		t.Fatalf("ResolveReferrer: %v", err)
	}
	if att.IsHouse || att.ReferrerID != referrer {
		t.Fatalf("test setup invalid: expected direct attribution to %s, got IsHouse=%v ReferrerID=%s", referrer, att.IsHouse, att.ReferrerID)
	}

	var ledgerRows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM public.referral_reward_ledger WHERE referred_user_id = $1`, referred,
	).Scan(&ledgerRows); err != nil {
		t.Fatalf("count referral_reward_ledger: %v", err)
	}
	if ledgerRows != 0 {
		t.Fatalf("referral_reward_ledger has %d row(s) for a fresh signup — signup must never accrue anything, even to a real referrer", ledgerRows)
	}

	balance, err := fin.GetBalance(ctx, referrer)
	if err != nil {
		t.Fatalf("GetBalance: %v", err)
	}
	if balance != 0 {
		t.Fatalf("referrer wallet balance = %d, want 0 — signup itself must never move real money either", balance)
	}
}

// TestClaimCode_ReassignsButNeverAccrues covers the §7A.3 late-claim path
// (a user forgot to enter a code, then claims one inside the grace window).
// It used to reverse a notional house accrual and re-accrue a fresh ₦500 to
// the newly-claimed referrer — a late claim is still a signup-time event, not
// a purchase, so per the same 2026-09-18 decision it must stay just as
// profit-free as the original signup was.
func TestClaimCode_ReassignsButNeverAccrues(t *testing.T) {
	ctx := context.Background()
	pool := liveAttribPool(t)
	t.Cleanup(pool.Close)

	referrer := seedAttribUser(t, pool)
	referred := seedAttribUser(t, pool)

	fin := financeledger.NewService(financeledger.NewRepository(pool), nil)
	rewardSvc := referrals.NewRewardService(pool, fin)
	link, err := rewardSvc.GetOrCreateLink(ctx, referrer)
	if err != nil {
		t.Fatalf("GetOrCreateLink: %v", err)
	}

	svc := newLiveAttributionService(pool)
	// No code entered at signup — routes to the house.
	att, err := svc.ResolveReferrer(ctx, referred, attribution.ResolveOpts{})
	if err != nil {
		t.Fatalf("ResolveReferrer: %v", err)
	}
	if !att.IsHouse {
		t.Fatalf("test setup invalid: expected house attribution for a code-less signup, got ReferrerID=%s", att.ReferrerID)
	}

	claimed, err := svc.ClaimCode(ctx, referred, link.Code)
	if err != nil {
		t.Fatalf("ClaimCode: %v", err)
	}
	if claimed.IsHouse || claimed.ReferrerID != referrer {
		t.Fatalf("ClaimCode did not reassign to the real referrer: IsHouse=%v ReferrerID=%s", claimed.IsHouse, claimed.ReferrerID)
	}

	var ledgerRows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM public.referral_reward_ledger WHERE referred_user_id = $1`, referred,
	).Scan(&ledgerRows); err != nil {
		t.Fatalf("count referral_reward_ledger: %v", err)
	}
	if ledgerRows != 0 {
		t.Fatalf("referral_reward_ledger has %d row(s) after a late code claim — a claim is still a signup-time event, not a purchase, and must not accrue anything", ledgerRows)
	}

	balance, err := fin.GetBalance(ctx, referrer)
	if err != nil {
		t.Fatalf("GetBalance: %v", err)
	}
	if balance != 0 {
		t.Fatalf("referrer wallet balance = %d, want 0 — a late claim must not move real money either", balance)
	}
}

func TestResolveReferrer_NeverAccruesAnythingOnSignup_House(t *testing.T) {
	ctx := context.Background()
	pool := liveAttribPool(t)
	t.Cleanup(pool.Close)

	referred := seedAttribUser(t, pool)

	svc := newLiveAttributionService(pool)
	// An unknown/invalid code routes to the house (RiskInvalidCode) — exactly
	// the second call site the accrual was removed from.
	att, err := svc.ResolveReferrer(ctx, referred, attribution.ResolveOpts{CodeEntered: "NOSUCHCODE" + uuid.NewString()[:6]})
	if err != nil {
		t.Fatalf("ResolveReferrer: %v", err)
	}
	if !att.IsHouse {
		t.Fatalf("test setup invalid: expected house attribution for an unknown code, got ReferrerID=%s", att.ReferrerID)
	}

	var ledgerRows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM public.referral_reward_ledger WHERE referred_user_id = $1`, referred,
	).Scan(&ledgerRows); err != nil {
		t.Fatalf("count referral_reward_ledger: %v", err)
	}
	if ledgerRows != 0 {
		t.Fatalf("referral_reward_ledger has %d row(s) for a house-attributed signup — even the NOTIONAL house accrual must be gone", ledgerRows)
	}
}
