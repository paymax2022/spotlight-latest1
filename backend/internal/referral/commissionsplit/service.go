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
// from a module-specific proxy and is wired to exactly one path (utility bill
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
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	referralevents "spotlight/backend/internal/referral/events"
	referralledger "spotlight/backend/internal/referral/ledger"
)

// RateBps is the flat referral commission-split rate: 20% of Spotlight's
// realized commission on the purchase. Never tiered, unlike the older engine.
const RateBps = 2000

// rewardLedger is the slice of the RB0 referral reward ledger
// (referral_reward_ledger) this package needs. A split is accrued there and
// walked to 'eligible', so the referrer sees it as withdrawable and moves it to
// their wallet through POST /api/finance/referral/withdraw — the wallet credit
// (balanced double-entry against the standing referral-reward account, KYC and
// account-status gates, Idempotency-Key) happens in that one place, at
// withdraw time, never here. Kept as an interface for testability.
type rewardLedger interface {
	Accrue(ctx context.Context, in referralledger.AccrueInput) (string, error)
	Transition(ctx context.Context, rewardID, nextState, idempotencyKey string) error
}

// accrualPath is the forward walk from a fresh accrual to withdrawable. A
// commission split is paid on an already-settled purchase, so there is no
// qualifying action or vesting period left to wait for.
var accrualPath = []string{referralledger.StatePending, referralledger.StateVesting, referralledger.StateEligible}

// eventTypeCredited is the referral_engine_events row appended after a split
// actually lands (CREDITED). Money mutations must emit an audit event; the
// event_type is distinct from the §7A engine's own types so analytics grouping
// by event_type never mixes the two engines' semantics.
const eventTypeCredited = "commission_split_reward_credited"

// Service implements commission.ReferralHook.
type Service struct {
	pool    *pgxpool.Pool
	rewards rewardLedger
	events  *referralevents.Service
	enabled bool
}

// NewService builds the referral commission-split hook. enabled mirrors
// config.FeatureReferralCommissionSplitEnabled — checked here (not just at the
// call site) so a caller that forgets the flag check still gets a safe no-op,
// never a live payout.
//
// financeLedger is the finance ledger the RB0 reward ledger pays out through at
// withdraw time; nil leaves the split record-only (no accrual).
func NewService(pool *pgxpool.Pool, financeLedger *ledger.Service, enabled bool) *Service {
	var ev *referralevents.Service
	var rewards rewardLedger
	if pool != nil {
		ev = referralevents.NewService(pool)
		if financeLedger != nil {
			rewards = referralledger.NewService(pool, financeLedger)
		}
	}
	return &Service{pool: pool, rewards: rewards, events: ev, enabled: enabled}
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

	// 3. Make sure the referrer has a code row to claim against. A referrer with
	// NO referral_links row at all is NOT retired — they simply never minted a
	// code: referral_links is only created by GetOrCreateLink when the referrer
	// opens their link page, yet attribution can already point at them via the
	// legacy finance_referral_codes table (RewardService.Attribute resolves both
	// code tables). Without a lazy mint here, every purchase under such an
	// attribution would silently pay the house while the other engine
	// (OnPurchaseSettled) pays the same referrer from the same attribution row.
	if err := s.ensureLink(ctx, *referrerID); err != nil {
		return err
	}

	// 4. Reward record + cap slot, in ONE transaction. The reward row is
	// inserted first (ON CONFLICT DO NOTHING on the UNIQUE source_transaction_id)
	// and the slot is claimed only if that insert won, so a concurrent call for
	// the same earning (live hook vs catch-up sweep), or a failed insert retried
	// by the sweep, can never burn a cap slot without a reward row to show for
	// it. The slot claim is a single UPDATE ... WHERE reward_count < reward_cap,
	// so two purchases under the same code can never both pass the cap. A
	// retired code rolls the reward row back: no payout, no record (defaults to
	// admin — there is nothing to move).
	//
	// The row is PENDING (never CREDITED up front): if the ledger credit below
	// fails it must honestly say so, and RetryPending picks it up later.
	// source_transaction_id is namespaced "commission:<earning id>" so it can
	// never collide with the older engine's own (unprefixed) transaction ids.
	rewardID, err := s.reserveReward(ctx, *referrerID, *e.UserID, sourceTxnID, e.SourceModule, e.SpotlightRevenueKobo, rewardKobo)
	if err != nil || rewardID == "" {
		return err
	}

	return s.creditReward(ctx, pendingReward{
		ID:                  rewardID,
		ReferrerID:          *referrerID,
		ReferredUserID:      *e.UserID,
		SourceTransactionID: sourceTxnID,
		Module:              e.SourceModule,
		MarginKobo:          e.SpotlightRevenueKobo,
		RewardKobo:          rewardKobo,
	})
}

// pendingReward is a referral_rewards row that holds a cap slot and still
// needs (or is getting) its ledger credit.
type pendingReward struct {
	ID                  string
	ReferrerID          string
	ReferredUserID      string
	SourceTransactionID string // "commission:<earning id>"
	Module              string
	MarginKobo          int64
	RewardKobo          int64
}

// reserveReward inserts the PENDING reward row and claims a cap slot in one
// transaction. Returns "" (and nil) when the earning already has a reward row
// or the code is retired — in both cases nothing is written.
func (s *Service) reserveReward(ctx context.Context, referrerID, referredID, sourceTxnID, module string, marginKobo, rewardKobo int64) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	var rewardID string
	err = tx.QueryRow(ctx, `
		INSERT INTO public.referral_rewards
			(referrer_id, referred_user_id, source_transaction_id, module, margin_kobo, applied_rate, reward_kobo, status, config_version)
		VALUES ($1, $2, $3, $4, $5, 0.20, $6, 'PENDING', 0)
		ON CONFLICT (source_transaction_id) DO NOTHING
		RETURNING id`,
		referrerID, referredID, sourceTxnID, module, marginKobo, rewardKobo,
	).Scan(&rewardID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil // already rewarded (or being rewarded) — nothing to do
	}
	if err != nil {
		return "", err
	}

	var linkID string
	err = tx.QueryRow(ctx, `
		UPDATE public.referral_links
		SET reward_count = reward_count + 1
		WHERE referrer_id = $1 AND reward_count < reward_cap
		RETURNING id`,
		referrerID,
	).Scan(&linkID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil // code retired — rollback drops the reward row
	}
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return rewardID, nil
}

// creditReward credits a reserved reward to the referrer's referral balance:
// it accrues one referral_reward_ledger row (idempotency key derived from the
// reward id, so a retry finds the same row) and walks it forward to
// 'eligible'. No wallet money moves here — those transitions are state-only in
// the RB0 ledger; the balanced wallet credit is posted when the referrer
// withdraws. On success the referral_rewards row flips to CREDITED ("credited
// to the referral balance") and an audit event is appended; on any failure it
// stays PENDING and RetryPending re-drives it from wherever the walk stopped.
func (s *Service) creditReward(ctx context.Context, r pendingReward) error {
	if s.rewards == nil {
		return nil
	}
	ledgerKey := "referral:commission-split:" + r.ID
	ledgerID, err := s.rewards.Accrue(ctx, referralledger.AccrueInput{
		BeneficiaryID:  r.ReferrerID,
		ReferredUserID: r.ReferredUserID,
		Kind:           referralledger.KindReferrer,
		AmountKobo:     r.RewardKobo,
		Currency:       "NGN",
		IdempotencyKey: ledgerKey,
	})
	if err != nil {
		return err
	}
	if err := s.walkToEligible(ctx, ledgerID, ledgerKey); err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx,
		`UPDATE public.referral_rewards SET status = 'CREDITED', credited_at = now() WHERE id = $1 AND status = 'PENDING'`,
		r.ID,
	); err != nil {
		return err
	}

	// Audit event — append-only referral_engine_events row, keyed on the reward
	// id so a replay dedupes instead of double-recording. Best-effort: the
	// accrual is already committed, so a failed event write is logged, never
	// treated as a split failure.
	if s.events != nil {
		if err := s.events.Record(ctx, referralevents.Input{
			EventType:  eventTypeCredited,
			UserID:     r.ReferredUserID,
			ReferrerID: r.ReferrerID,
			Payload: map[string]any{
				"reward_id":             r.ID,
				"reward_ledger_id":      ledgerID,
				"earning_id":            strings.TrimPrefix(r.SourceTransactionID, "commission:"),
				"source_transaction_id": r.SourceTransactionID,
				"module":                r.Module,
				"margin_kobo":           r.MarginKobo,
				"reward_kobo":           r.RewardKobo,
				"rate_bps":              RateBps,
			},
			IdempotencyKey: "commission-split:credited:" + r.ID,
		}); err != nil {
			log.Printf("[referral/commissionsplit] audit event failed (reward=%s): %v", r.ID, err)
		}
	}
	return nil
}

// walkToEligible moves an accrual from wherever it currently is to 'eligible'.
// It starts from the row's CURRENT state so a retry after a partial walk only
// takes the remaining steps (Transition refuses a backward move, so replaying
// the whole path would fail). A row already eligible, paid or clawed back is
// left alone: paid means the referrer already withdrew it, and a clawback is
// final.
func (s *Service) walkToEligible(ctx context.Context, ledgerID, ledgerKey string) error {
	var state string
	if err := s.pool.QueryRow(ctx,
		`SELECT state FROM public.referral_reward_ledger WHERE id = $1`, ledgerID,
	).Scan(&state); err != nil {
		return err
	}
	step := -1
	if state == referralledger.StateEarned {
		step = 0
	}
	for i, st := range accrualPath {
		if st == state {
			step = i + 1
		}
	}
	if step < 0 {
		return nil // eligible-or-beyond (paid / clawed_back): nothing to do
	}
	for _, next := range accrualPath[step:] {
		if err := s.rewards.Transition(ctx, ledgerID, next, ledgerKey+":"+next); err != nil {
			return err
		}
	}
	return nil
}

// ensureLink lazily mints a referral_links row for a referrer who has none (a
// legacy-code referrer — see step 3 in trySplit). Idempotent.
func (s *Service) ensureLink(ctx context.Context, referrerID string) error {
	var hasLink bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM public.referral_links WHERE referrer_id = $1)`,
		referrerID,
	).Scan(&hasLink); err != nil {
		return err
	}
	if hasLink {
		return nil
	}
	return s.mintLink(ctx, referrerID)
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
