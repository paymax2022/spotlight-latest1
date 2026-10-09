// Package commissionsplit implements the referral purchase-commission-split
// policy: a referrer earns a flat 20% of Spotlight's realized commission on
// every purchase made by someone they referred — never at signup, only when a
// service is actually purchased — capped at a fixed number of rewarded
// purchases PER REFERRAL CODE (one code can be used by any number of referred
// people; the cap is shared across all of them, not reset per person). Once a
// code hits its cap it is retired: the 20% simply stays with Spotlight (the
// "default referrer is Admin" policy needs no separate payout, since Spotlight
// already holds its own commission by default — there's nothing to move).
// Hooked into commission.Service via the ReferralHook interface (see
// finance/commission/service.go) — this package imports commission for the
// Earning type; commission never imports this package (the same late-binding
// shape as ledger.TransactionDetailResolver / Service.SetResolvers), so there
// is no import cycle.
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
	"errors"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	referralevents "spotlight/backend/internal/referral/events"
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

// eventTypeCredited is the referral_engine_events row appended after a split
// actually lands (CREDITED). Money mutations must emit an audit event; the
// event_type is distinct from the §7A engine's own types so analytics grouping
// by event_type never mixes the two engines' semantics.
const eventTypeCredited = "commission_split_reward_credited"

// Service implements commission.ReferralHook.
type Service struct {
	pool    *pgxpool.Pool
	ledger  ledgerService
	events  *referralevents.Service
	enabled bool
}

// NewService builds the referral commission-split hook. enabled mirrors
// config.FeatureReferralCommissionSplitEnabled — checked here (not just at the
// call site) so a caller that forgets the flag check still gets a safe no-op,
// never a live payout.
func NewService(pool *pgxpool.Pool, ledgerSvc ledgerService, enabled bool) *Service {
	var ev *referralevents.Service
	if pool != nil {
		ev = referralevents.NewService(pool)
	}
	return &Service{pool: pool, ledger: ledgerSvc, events: ev, enabled: enabled}
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
	if errors.Is(err, pgx.ErrNoRows) {
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
	//
	// A referrer with NO referral_links row at all is NOT retired — they simply
	// never minted a code: referral_links is only created by GetOrCreateLink
	// when the referrer opens their link page, yet attribution can already point
	// at them via the legacy finance_referral_codes table (RewardService.Attribute
	// resolves both code tables). Without a lazy mint here, every purchase under
	// such an attribution would silently pay the house while the other engine
	// (OnPurchaseSettled) pays the same referrer from the same attribution row.
	err = s.claimRewardSlot(ctx, *referrerID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Code retired (at/over cap) — defaults to admin: no payout, no reward
		// row is written for this earning (there is nothing to record — it was
		// never rewarded).
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
	if errors.Is(err, pgx.ErrNoRows) {
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
	if creditErr != nil && !errors.Is(creditErr, ledger.ErrDuplicate) {
		return creditErr
	}
	if _, err := s.pool.Exec(ctx,
		`UPDATE public.referral_rewards SET status = 'CREDITED', credited_at = now() WHERE id = $1`,
		rewardID,
	); err != nil {
		return err
	}

	// 6. Audit event — append-only referral_engine_events row, keyed on the
	// reward id so a replay dedupes instead of double-recording. Best-effort like
	// the rest of this hook: the money is already committed, so a failed event
	// write is logged, never treated as a split failure (which would retry the
	// whole path and claim another cap slot).
	if s.events != nil {
		if err := s.events.Record(ctx, referralevents.Input{
			EventType:  eventTypeCredited,
			UserID:     *e.UserID,
			ReferrerID: *referrerID,
			Payload: map[string]any{
				"reward_id":             rewardID,
				"earning_id":            e.ID,
				"source_transaction_id": sourceTxnID,
				"module":                e.SourceModule,
				"margin_kobo":           e.SpotlightRevenueKobo,
				"reward_kobo":           rewardKobo,
				"rate_bps":              RateBps,
			},
			IdempotencyKey: "commission-split:credited:" + rewardID,
		}); err != nil {
			log.Printf("[referral/commissionsplit] audit event failed (reward=%s): %v", rewardID, err)
		}
	}
	return nil
}

// claimRewardSlot atomically takes one of the referrer code's capped reward
// slots, lazily minting the referral_links row first when the referrer has none
// (a legacy-code referrer — see step 3 in trySplit). Returns pgx.ErrNoRows when
// the code exists but is at/over its cap (retired); any other error propagates.
func (s *Service) claimRewardSlot(ctx context.Context, referrerID string) error {
	var linkID string
	err := s.pool.QueryRow(ctx, `
		UPDATE public.referral_links
		SET reward_count = reward_count + 1
		WHERE referrer_id = $1 AND reward_count < reward_cap
		RETURNING id`,
		referrerID,
	).Scan(&linkID)
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	// No claim — either the code is retired or the row is missing entirely. A
	// missing row is not retirement: mint it, then take the slot.
	var hasLink bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM public.referral_links WHERE referrer_id = $1)`,
		referrerID,
	).Scan(&hasLink); err != nil {
		return err
	}
	if hasLink {
		return pgx.ErrNoRows // exists but at cap — retired, pay the house
	}
	if err := s.mintLink(ctx, referrerID); err != nil {
		return err
	}
	return s.pool.QueryRow(ctx, `
		UPDATE public.referral_links
		SET reward_count = reward_count + 1
		WHERE referrer_id = $1 AND reward_count < reward_cap
		RETURNING id`,
		referrerID,
	).Scan(&linkID)
}

// mintLink inserts a referral_links row for a referrer who never opened their
// link page — same shape as referrals.RewardService.GetOrCreateLink: a fresh
// 5-char code, retried on the (rare) code collision, with ON CONFLICT
// (referrer_id) DO NOTHING so a concurrent mint/racing link-page visit keeps
// whichever row landed first.
func (s *Service) mintLink(ctx context.Context, referrerID string) error {
	const ins = `
		INSERT INTO public.referral_links (referrer_id, code)
		VALUES ($1, $2)
		ON CONFLICT (referrer_id) DO NOTHING`
	for range 10 {
		code, err := referrals.GenerateCode()
		if err != nil {
			return err
		}
		if _, err := s.pool.Exec(ctx, ins, referrerID, code); err != nil {
			if isDuplicateCodeErr(err) {
				continue // that CODE is taken; draw another
			}
			return err
		}
		return nil
	}
	return errors.New("commissionsplit: no free referral code in 10 attempts")
}

// isDuplicateCodeErr reports a unique-violation on referral_links.code (SQLSTATE
// 23505). The referrer_id conflict is folded into ON CONFLICT ... DO NOTHING in
// mintLink, so any 23505 surfacing here is the code collision to retry on.
func isDuplicateCodeErr(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
