// Package commissionsplit implements the referral purchase-commission-split
// policy: a referrer earns a flat 20% of Spotlight's realized commission on
// every purchase made by someone they referred — never at signup, only when a
// service is actually purchased — capped at a fixed number of rewarded
// purchases PER REFERRAL CODE (one code can be used by any number of referred
// people; the cap is shared across all of them, not reset per person). Once a
// code hits its cap it is retired: the 20% simply stays with Spotlight (the
// "default referrer is Admin" policy needs no separate payout, since Spotlight
// already holds its own commission by default — there's nothing to move).
//
// Hooked into commission.Service via the ReferralHook interface (see
// finance/commission/service.go) — this package imports commission for the
// Earning type; commission never imports this package (the same late-binding
// shape as ledger.TransactionDetailResolver / Service.SetResolvers), so there
// is no import cycle.
//
// Deliberately independent of the older, tiered (5/8/12/15%) Direct Referral
// Rewards engine in finance/referrals — that engine computes its own margin
// from a module-specific proxy and is wired to exactly one path (Maplerad bill
// payments) behind its own flag. This package reads the SAME commission_earnings
// figure (spotlight_revenue_kobo) that ~18 modules already write via
// commission.RecordFor/RecordExact, so it applies uniformly across all of them
// with no per-module wiring. It reuses that engine's referral_rewards table for
// the reward record itself (see the 2026-09-18 migration's comment on why) but
// writes a DISTINCT applied_rate (0.20, always) and config_version (0, a
// sentinel meaning "not tied to referral_program_config").
package commissionsplit

import (
	"context"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/ledger"
)

// RateBps is the flat referral commission-split rate: 20% of Spotlight's
// realized commission on the purchase. Never tiered, unlike the older engine.
const RateBps = 2000

// ledgerService is the minimal slice of the finance ledger this package needs.
// Kept as an interface for the same reason commission.ledgerService is: nil-safe
// wiring and independent testability.
type ledgerService interface {
	GetOrCreateStandingAccount(ctx context.Context, accountType ledger.AccountType) (*ledger.Account, error)
	Credit(ctx context.Context, userID, reference, idempotencyKey, debitAccountID string, amountKobo int64) error
}

// Service implements commission.ReferralHook.
type Service struct {
	pool    *pgxpool.Pool
	ledger  ledgerService
	enabled bool
}

// NewService builds the referral commission-split hook. enabled mirrors
// config.FeatureReferralCommissionSplitEnabled — checked here (not just at the
// call site) so a caller that forgets the flag check still gets a safe no-op,
// never a live payout.
func NewService(pool *pgxpool.Pool, ledgerSvc ledgerService, enabled bool) *Service {
	return &Service{pool: pool, ledger: ledgerSvc, enabled: enabled}
}

// OnEarningRecorded implements commission.ReferralHook. Called exactly once per
// genuinely NEW commission_earnings row (never on an idempotent-replay
// duplicate — see commission.Service.notifyReferralHook). Best-effort: every
// failure is logged and swallowed. This must NEVER be allowed to fail the
// purchase that already succeeded and already recorded Spotlight's commission —
// the exact same posture every other commission/referral bookkeeping hook in
// this codebase takes (e.g. utilitybills.recordCommission's own "must never
// fail or reverse the customer's payment" comment).
func (s *Service) OnEarningRecorded(ctx context.Context, e commission.Earning) {
	if !s.enabled {
		return
	}
	if e.UserID == nil || *e.UserID == "" {
		return
	}
	if e.SpotlightRevenueKobo <= 0 {
		return
	}
	if err := s.trySplit(ctx, e); err != nil {
		log.Printf("[referral/commissionsplit] split failed (earning=%s user=%s): %v", e.ID, *e.UserID, err)
	}
}

func (s *Service) trySplit(ctx context.Context, e commission.Earning) error {
	// 1. Who referred this payer? Skip silently for: no attribution row at all
	// (shouldn't happen — every signup is attributed, house included — but
	// defensive), a house attribution (no human referrer to pay), or a real
	// referrer with no code row (defensive; referral_links.referrer_id is
	// UNIQUE and created alongside every human referrer in the normal flow).
	var referrerID *string
	var isHouse bool
	err := s.pool.QueryRow(ctx,
		`SELECT referrer_id, is_house FROM public.referral_attributions WHERE referred_user_id = $1`,
		*e.UserID,
	).Scan(&referrerID, &isHouse)
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if isHouse || referrerID == nil || *referrerID == "" {
		// Defaults to admin: Spotlight already holds 100% of e.SpotlightRevenueKobo
		// as recorded — there is nothing further to move.
		return nil
	}

	rewardKobo := e.SpotlightRevenueKobo * RateBps / 10000
	if rewardKobo <= 0 {
		return nil
	}

	// 2. Idempotency guard FIRST — a pure read, before touching the cap counter
	// at all. This must run before the cap increment below: incrementing first
	// and only then discovering (via the referral_rewards insert) that this
	// earning was already processed would leave reward_count off by one for
	// every replay, quietly retiring codes early. notifyReferralHook only calls
	// this on a genuinely new commission_earnings row in normal operation, so
	// this is defense-in-depth, not the primary guard — but it must come first
	// precisely because it's the fallback for when that guarantee doesn't hold.
	sourceTxnID := "commission:" + e.ID
	var exists bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM public.referral_rewards WHERE source_transaction_id = $1)`,
		sourceTxnID,
	).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}

	// 3. Atomically claim one of this CODE's capped reward slots — a single
	// UPDATE ... WHERE reward_count < reward_cap so two concurrent purchases by
	// different referred users under the same code can never both succeed past
	// the cap (a read-then-write here would race).
	var linkID string
	err = s.pool.QueryRow(ctx, `
		UPDATE public.referral_links
		SET reward_count = reward_count + 1
		WHERE referrer_id = $1 AND reward_count < reward_cap
		RETURNING id`,
		*referrerID,
	).Scan(&linkID)
	if err == pgx.ErrNoRows {
		// Code retired (at/over cap), or this referrer somehow has no code row —
		// either way, defaults to admin: no payout, no reward row is written for
		// this earning (there is nothing to record — it was never rewarded).
		return nil
	}
	if err != nil {
		return err
	}

	// 4. Reward record — reuses referral_rewards (see package doc). Inserted as
	// PENDING first (never CREDITED up front): if the ledger credit below fails,
	// the row must honestly say so, not claim money moved that never did.
	// source_transaction_id is namespaced "commission:<earning id>" so it can
	// never collide with the older engine's own (unprefixed) transaction ids.
	// ON CONFLICT DO NOTHING remains as defense-in-depth against a genuine race
	// between two concurrent calls for the same earning (step 2 already made
	// this vanishingly unlikely, not impossible under true concurrency).
	var rewardID string
	err = s.pool.QueryRow(ctx, `
		INSERT INTO public.referral_rewards
			(referrer_id, referred_user_id, source_transaction_id, module, margin_kobo, applied_rate, reward_kobo, status, config_version)
		VALUES ($1, $2, $3, $4, $5, 0.20, $6, 'PENDING', 0)
		ON CONFLICT (source_transaction_id) DO NOTHING
		RETURNING id`,
		*referrerID, *e.UserID, sourceTxnID, e.SourceModule, e.SpotlightRevenueKobo, rewardKobo,
	).Scan(&rewardID)
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}

	// 5. Credit the referrer's wallet, debiting the standing referral-reward
	// account — the same account type the older engine posts against, so every
	// referral payout (whichever engine produced it) lands in one place for
	// reporting. On success (or a benign duplicate-credit race), flip the
	// reward row to CREDITED; on any other failure it is left PENDING — an
	// honest record of "claimed a cap slot, not yet actually paid" rather than
	// a false CREDITED claim, and the error is still returned so it gets logged.
	if s.ledger == nil {
		return nil
	}
	rewardAcct, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountReferralReward)
	if err != nil {
		return err
	}
	creditErr := s.ledger.Credit(ctx, *referrerID, sourceTxnID, "referral:commission-split:"+rewardID, rewardAcct.ID, rewardKobo)
	if creditErr != nil && creditErr != ledger.ErrDuplicate {
		return creditErr
	}
	if _, err := s.pool.Exec(ctx,
		`UPDATE public.referral_rewards SET status = 'CREDITED', credited_at = now() WHERE id = $1`,
		rewardID,
	); err != nil {
		return err
	}
	return nil
}
