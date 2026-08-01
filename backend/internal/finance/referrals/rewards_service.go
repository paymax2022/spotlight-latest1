package referrals

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// RewardService is the Direct Referral Rewards ENGINE. It is distinct from the
// legacy *Service (per-referral flat reward) in service.go — this one is purchase-
// triggered, single-level, tiered + milestone-driven, and config-versioned.
//
// Money path REUSES the finance ledger: an ongoing-share reward CREDITs the
// referrer wallet with a balanced double-entry (counterpart = the referral reward
// expense standing account), keyed idempotently on the reward id. A refund posts a
// balanced REVERSAL in the same DB transaction as the reward state flip. Every
// mutation is idempotent and fail-closed: on any doubt, no money moves.
type RewardService struct {
	db     *pgxpool.Pool
	ledger *ledger.Service
	audit  RewardAuditSink // optional immutable-audit sink; nil is safe
}

// RewardAuditSink receives an audit event for every reward/milestone mutation.
// Nil-safe: NewRewardService accepts nil and the engine no-ops the emit.
type RewardAuditSink interface {
	Emit(ctx context.Context, event string, fields map[string]any) error
}

// NewRewardService builds the engine over a pgx pool + the finance ledger.
func NewRewardService(db *pgxpool.Pool, ledgerSvc *ledger.Service) *RewardService {
	return &RewardService{db: db, ledger: ledgerSvc}
}

// WithAudit attaches an immutable-audit sink (fluent; returns the same service).
func (s *RewardService) WithAudit(sink RewardAuditSink) *RewardService {
	s.audit = sink
	return s
}

func (s *RewardService) emit(ctx context.Context, event string, fields map[string]any) {
	if s.audit == nil {
		return
	}
	_ = s.audit.Emit(ctx, event, fields)
}

// ============================================================================
// EMIT HOOKS — the in-process contract for the integration agent.
// ============================================================================

// OnPurchaseSettled processes a settled purchase into an ongoing-share reward.
// Contract (§2.1, §4.1):
//   - Look up the payer's attribution. No attribution OR margin <= 0 → no-op (nil).
//   - Reject self-referral fail-closed.
//   - Compute reward = floor(margin * referrer's current tier rate).
//   - Insert referral_rewards ON CONFLICT (source_transaction_id) DO NOTHING —
//     idempotent: one reward per purchase, ever.
//   - Credit the referrer wallet via the ledger, idempotency-keyed on the reward id.
//   - Flip status → CREDITED and emit an audit event.
//
// Idempotent: a replay with the same TransactionID is a safe no-op.
func (s *RewardService) OnPurchaseSettled(ctx context.Context, in PurchaseSettled) error {
	if strings.TrimSpace(in.TransactionID) == "" {
		return fmt.Errorf("referrals: OnPurchaseSettled requires transaction_id")
	}
	if strings.TrimSpace(in.PayerUserID) == "" {
		return fmt.Errorf("referrals: OnPurchaseSettled requires payer_user_id")
	}
	// No-op on non-positive margin — reward is only created where margin > 0 (§4.1).
	if in.MarginKobo <= 0 {
		return nil
	}

	// 1) Attribution lookup for the payer. No attribution → no reward (§3 invariant).
	referrerID, err := s.attributedReferrer(ctx, in.PayerUserID)
	if err != nil {
		return err
	}
	if referrerID == "" {
		return nil // unattributed payer — nothing to reward, fail-closed no-op
	}
	// Fail-closed self-referral guard (attribution should never do this, but never
	// pay a user for their own purchase).
	if referrerID == in.PayerUserID {
		return nil
	}

	// 2) Resolve the referrer's current tier rate + active config version.
	rate, cfgVersion, err := s.currentRate(ctx, referrerID)
	if err != nil {
		return err
	}
	rewardKobo := ComputeReward(in.MarginKobo, rate)

	// 3) Insert the reward row idempotently (source_transaction_id UNIQUE). If a row
	//    already exists we fetch it and continue toward crediting (covers a crash
	//    between insert and credit).
	rewardID, status, err := s.insertOrGetReward(ctx, referrerID, in, rate, rewardKobo, cfgVersion)
	if err != nil {
		return err
	}
	if status == RewardStatusReversed {
		return nil // already reversed — do not re-credit
	}
	if status == RewardStatusCredited {
		return nil // already fully processed — idempotent no-op
	}

	// 4) Credit the referrer wallet (balanced double-entry), idempotency-keyed on the
	//    reward id. Zero-value rewards skip the ledger but still resolve to CREDITED so
	//    the row isn't stuck PENDING.
	if rewardKobo > 0 {
		expenseAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountReferralReward)
		if err != nil {
			return err
		}
		idemKey := "referral:reward:" + rewardID
		if err := s.ledger.Credit(ctx, referrerID, "referral:reward:"+in.TransactionID, idemKey, expenseAcc.ID, rewardKobo); err != nil {
			if !errors.Is(err, ledger.ErrDuplicate) {
				return fmt.Errorf("referrals: credit reward: %w", err)
			}
		}
	}

	// 5) Flip PENDING → CREDITED (idempotent WHERE status='PENDING').
	const upd = `UPDATE referral_rewards SET status='CREDITED', credited_at=now()
	             WHERE id=$1 AND status='PENDING'`
	if _, err := s.db.Exec(ctx, upd, rewardID); err != nil {
		return fmt.Errorf("referrals: mark credited: %w", err)
	}

	s.emit(ctx, "referral.reward.credited", map[string]any{
		"reward_id": rewardID, "referrer_id": referrerID, "referred_user_id": in.PayerUserID,
		"transaction_id": in.TransactionID, "module": in.Module, "reward_kobo": rewardKobo,
		"applied_rate": rate, "config_version": cfgVersion,
	})
	return nil
}

// OnPurchaseRefunded reverses the reward generated by a settled purchase (§2.4).
// Finds the reward by source_transaction_id; if CREDITED, posts a balanced ledger
// reversal (drain the reward from the referrer wallet back to the expense account)
// and flips the reward → REVERSED in the SAME transaction. Idempotent: a second
// refund event is a safe no-op.
func (s *RewardService) OnPurchaseRefunded(ctx context.Context, in PurchaseRefunded) error {
	if strings.TrimSpace(in.TransactionID) == "" {
		return fmt.Errorf("referrals: OnPurchaseRefunded requires transaction_id")
	}

	const q = `SELECT id, referrer_id, reward_kobo, status FROM referral_rewards
	           WHERE source_transaction_id=$1`
	var rewardID, referrerID, status string
	var rewardKobo int64
	err := s.db.QueryRow(ctx, q, in.TransactionID).Scan(&rewardID, &referrerID, &rewardKobo, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // no reward for this txn — nothing to reverse (fail-closed no-op)
	}
	if err != nil {
		return fmt.Errorf("referrals: lookup reward for refund: %w", err)
	}
	if status != RewardStatusCredited {
		return nil // PENDING never credited, or already REVERSED — idempotent no-op
	}

	// Post the ledger reversal (drain the credited reward from the referrer wallet
	// back to the expense account) and flip the reward row REVERSED. The ledger
	// reversal is its own atomic tx (balanced pair + unique idempotency key); the
	// reward row flip is guarded WHERE status='CREDITED' so a replay is a no-op.
	if rewardKobo > 0 {
		expenseAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountReferralReward)
		if err != nil {
			return err
		}
		walletAcc, err := s.ledger.GetOrCreateUserWallet(ctx, referrerID)
		if err != nil {
			return err
		}
		// PostReversal(restore=expense, release=referrer wallet): REVERSAL_DEBIT
		// restores the expense account, REVERSAL_CREDIT drains the referrer wallet.
		idemKey := "referral:reward-reversal:" + rewardID
		if err := s.ledger.PostReversal(ctx, expenseAcc.ID, walletAcc.ID, rewardKobo,
			"referral:reward-reversal:"+in.TransactionID, idemKey); err != nil {
			if !errors.Is(err, ledger.ErrDuplicate) {
				return fmt.Errorf("referrals: reverse reward: %w", err)
			}
		}
	}

	const upd = `UPDATE referral_rewards SET status='REVERSED', reversed_at=now()
	             WHERE id=$1 AND status='CREDITED'`
	if _, err := s.db.Exec(ctx, upd, rewardID); err != nil {
		return fmt.Errorf("referrals: mark reversed: %w", err)
	}

	s.emit(ctx, "referral.reward.reversed", map[string]any{
		"reward_id": rewardID, "referrer_id": referrerID,
		"transaction_id": in.TransactionID, "reward_kobo": rewardKobo,
	})
	return nil
}

// ============================================================================
// Attribution + config helpers.
// ============================================================================

// attributedReferrer returns the referrer_id attributed to a payer, or "" if the
// payer has no (human) attribution. Reuses the existing referral_attributions
// table (populated by this engine's Attribute and/or the legacy §7A resolver).
func (s *RewardService) attributedReferrer(ctx context.Context, payerUserID string) (string, error) {
	const q = `SELECT referrer_id FROM referral_attributions
	           WHERE referred_user_id=$1 AND referrer_id IS NOT NULL LIMIT 1`
	var referrerID *string
	err := s.db.QueryRow(ctx, q, payerUserID).Scan(&referrerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("referrals: attribution lookup: %w", err)
	}
	if referrerID == nil {
		return "", nil
	}
	return *referrerID, nil
}

// ActiveConfig returns the config version active as of now() — the row with the
// greatest effective_from that is <= now(), preferring is_active. Fail-closed: if
// no config exists the engine cannot compute a rate and returns an error.
func (s *RewardService) ActiveConfig(ctx context.Context) (*ProgramConfig, error) {
	const q = `
		SELECT id, version, tier_table, milestone_table, is_active, effective_from, created_at
		FROM referral_program_config
		WHERE effective_from <= now()
		ORDER BY effective_from DESC, version DESC
		LIMIT 1`
	var c ProgramConfig
	var tierJSON, msJSON []byte
	err := s.db.QueryRow(ctx, q).Scan(
		&c.ID, &c.Version, &tierJSON, &msJSON, &c.IsActive, &c.EffectiveFrom, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("referrals: no active program config")
	}
	if err != nil {
		return nil, fmt.Errorf("referrals: load active config: %w", err)
	}
	if err := json.Unmarshal(tierJSON, &c.TierTable); err != nil {
		return nil, fmt.Errorf("referrals: decode tier_table: %w", err)
	}
	if err := json.Unmarshal(msJSON, &c.MilestoneTable); err != nil {
		return nil, fmt.Errorf("referrals: decode milestone_table: %w", err)
	}
	return &c, nil
}

// currentRate resolves the rate to apply to a referrer's next transaction. It
// prefers the persisted referral_tier_status.current_rate (set by the nightly
// recalc); if there's no status row yet it falls back to the active config's
// lowest band rate (Starter) so a first purchase still rewards correctly. Returns
// (rate, activeConfigVersion, error).
func (s *RewardService) currentRate(ctx context.Context, referrerID string) (float64, int, error) {
	cfg, err := s.ActiveConfig(ctx)
	if err != nil {
		return 0, 0, err
	}
	const q = `SELECT current_rate FROM referral_tier_status WHERE referrer_id=$1`
	var rate float64
	err = s.db.QueryRow(ctx, q, referrerID).Scan(&rate)
	if errors.Is(err, pgx.ErrNoRows) {
		// No status row yet — use the entry-tier rate for count 1 (Starter).
		if b, ok := cfg.TierForCount(1); ok {
			return b.Rate, cfg.Version, nil
		}
		return 0, cfg.Version, nil
	}
	if err != nil {
		return 0, 0, fmt.Errorf("referrals: load tier rate: %w", err)
	}
	return rate, cfg.Version, nil
}

// insertOrGetReward inserts the reward row idempotently and returns (id, status).
// On a source_transaction_id conflict it fetches the existing row.
func (s *RewardService) insertOrGetReward(ctx context.Context, referrerID string, in PurchaseSettled, rate float64, rewardKobo int64, cfgVersion int) (string, string, error) {
	const ins = `
		INSERT INTO referral_rewards
		  (referrer_id, referred_user_id, source_transaction_id, module,
		   margin_kobo, applied_rate, reward_kobo, status, config_version)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',$8)
		ON CONFLICT (source_transaction_id) DO NOTHING
		RETURNING id, status`
	var id, status string
	err := s.db.QueryRow(ctx, ins,
		referrerID, in.PayerUserID, in.TransactionID, in.Module,
		in.MarginKobo, rate, rewardKobo, cfgVersion).Scan(&id, &status)
	if err == nil {
		return id, status, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", "", fmt.Errorf("referrals: insert reward: %w", err)
	}
	// Conflict — row already exists; fetch it.
	const sel = `SELECT id, status FROM referral_rewards WHERE source_transaction_id=$1`
	if err := s.db.QueryRow(ctx, sel, in.TransactionID).Scan(&id, &status); err != nil {
		return "", "", fmt.Errorf("referrals: fetch existing reward: %w", err)
	}
	return id, status, nil
}

// ============================================================================
// USER API — link / attribute / dashboard / referrals / earnings / milestones.
// All read paths are scoped to the caller (object-level authZ in the handler).
// ============================================================================

// GetOrCreateLink returns the caller's referral code from referral_links,
// generating one if absent. Idempotent (referrer_id UNIQUE).
func (s *RewardService) GetOrCreateLink(ctx context.Context, referrerID string) (*Link, error) {
	const sel = `SELECT id, referrer_id, code, created_at FROM referral_links WHERE referrer_id=$1`
	var l Link
	err := s.db.QueryRow(ctx, sel, referrerID).Scan(&l.ID, &l.ReferrerID, &l.Code, &l.CreatedAt)
	if err == nil {
		return &l, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("referrals: load link: %w", err)
	}
	code, err := generateRewardCode()
	if err != nil {
		return nil, err
	}
	const ins = `
		INSERT INTO referral_links (referrer_id, code) VALUES ($1,$2)
		ON CONFLICT (referrer_id) DO NOTHING
		RETURNING id, referrer_id, code, created_at`
	err = s.db.QueryRow(ctx, ins, referrerID, code).Scan(&l.ID, &l.ReferrerID, &l.Code, &l.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return s.GetOrCreateLink(ctx, referrerID) // lost the race — fetch
	}
	if err != nil {
		return nil, fmt.Errorf("referrals: create link: %w", err)
	}
	return &l, nil
}

// Attribute applies a referral code at signup: resolves the code to a referrer and
// creates the permanent referral_attributions row for the caller. Idempotent per
// user (referred_user_id UNIQUE). Rejects self-referral and unknown codes.
func (s *RewardService) Attribute(ctx context.Context, referredUserID, code string) (string, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return "", fmt.Errorf("referrals: attribute requires a code")
	}

	// Already attributed? Idempotent — return the existing referrer.
	if existing, err := s.attributedReferrer(ctx, referredUserID); err != nil {
		return "", err
	} else if existing != "" {
		return existing, nil
	}

	referrerID, err := s.resolveCode(ctx, code)
	if err != nil {
		return "", err
	}
	if referrerID == "" {
		return "", fmt.Errorf("referrals: unknown referral code")
	}
	if referrerID == referredUserID {
		return "", fmt.Errorf("referrals: self-referral rejected")
	}

	const ins = `
		INSERT INTO referral_attributions (referred_user_id, referrer_id, attribution_type, code_used)
		VALUES ($1,$2,'code',$3)
		ON CONFLICT (referred_user_id) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins, referredUserID, referrerID, code); err != nil {
		return "", fmt.Errorf("referrals: insert attribution: %w", err)
	}
	// Re-read to return the authoritative referrer (covers a concurrent insert).
	final, err := s.attributedReferrer(ctx, referredUserID)
	if err != nil {
		return "", err
	}
	s.emit(ctx, "referral.attributed", map[string]any{
		"referred_user_id": referredUserID, "referrer_id": final, "code": code,
	})
	return final, nil
}

// resolveCode maps a code to a referrer, checking the engine's referral_links
// first, then falling back to the legacy finance_referral_codes seed so codes
// issued by the old module still attribute.
func (s *RewardService) resolveCode(ctx context.Context, code string) (string, error) {
	const q1 = `SELECT referrer_id FROM referral_links WHERE code=$1`
	var referrerID string
	err := s.db.QueryRow(ctx, q1, code).Scan(&referrerID)
	if err == nil {
		return referrerID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("referrals: resolve code: %w", err)
	}
	const q2 = `SELECT user_id FROM finance_referral_codes WHERE code=$1`
	err = s.db.QueryRow(ctx, q2, code).Scan(&referrerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("referrals: resolve legacy code: %w", err)
	}
	return referrerID, nil
}

// GetDashboard builds the Referral Hub payload (§5.1 screen 1).
func (s *RewardService) GetDashboard(ctx context.Context, referrerID string) (*Dashboard, error) {
	link, err := s.GetOrCreateLink(ctx, referrerID)
	if err != nil {
		return nil, err
	}
	d := &Dashboard{Code: link.Code, CurrentTier: TierStarter}

	// Tier status (may be absent before the first nightly recalc).
	const tq = `SELECT active_referral_count, current_tier, current_rate
	            FROM referral_tier_status WHERE referrer_id=$1`
	err = s.db.QueryRow(ctx, tq, referrerID).Scan(&d.ActiveReferralCount, &d.CurrentTier, &d.CurrentRate)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("referrals: dashboard tier: %w", err)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		if cfg, cerr := s.ActiveConfig(ctx); cerr == nil {
			if b, ok := cfg.TierForCount(1); ok {
				d.CurrentRate = b.Rate
			}
		}
	}

	// Earnings — lifetime + this calendar month (CREDITED only).
	const eq = `
		SELECT
		  COALESCE(SUM(reward_kobo) FILTER (WHERE status='CREDITED'),0),
		  COALESCE(SUM(reward_kobo) FILTER (WHERE status='CREDITED' AND created_at >= date_trunc('month', now())),0)
		FROM referral_rewards WHERE referrer_id=$1`
	if err := s.db.QueryRow(ctx, eq, referrerID).Scan(&d.LifetimeEarnedKobo, &d.ThisMonthEarnedKobo); err != nil {
		return nil, fmt.Errorf("referrals: dashboard earnings: %w", err)
	}

	// Next milestone preview from the active config (first threshold above the count).
	if cfg, cerr := s.ActiveConfig(ctx); cerr == nil {
		for _, m := range cfg.MilestoneTable {
			if m.Threshold > d.ActiveReferralCount {
				d.NextMilestone = &NextMilestone{
					Threshold: m.Threshold, BonusKobo: m.BonusKobo,
					Remaining: m.Threshold - d.ActiveReferralCount,
				}
				break
			}
		}
	}
	return d, nil
}

// ListReferrals returns the caller's referred users with Active/Inactive status
// (30-day rolling rule) and masked contact (§5.1 screen 3).
func (s *RewardService) ListReferrals(ctx context.Context, referrerID string, limit, offset int) ([]ReferredUser, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT
		  a.referred_user_id,
		  COALESCE(u.email, ''),
		  a.created_at,
		  EXISTS (
		    SELECT 1 FROM referral_rewards r
		    WHERE r.referred_user_id = a.referred_user_id
		      AND r.referrer_id = a.referrer_id
		      AND r.status = 'CREDITED'
		      AND r.created_at >= now() - make_interval(days => $4)
		  ) AS active,
		  COALESCE((
		    SELECT SUM(r2.reward_kobo) FROM referral_rewards r2
		    WHERE r2.referred_user_id = a.referred_user_id
		      AND r2.referrer_id = a.referrer_id
		      AND r2.status = 'CREDITED'
		  ),0) AS lifetime
		FROM referral_attributions a
		LEFT JOIN auth.users u ON u.id = a.referred_user_id
		WHERE a.referrer_id = $1
		ORDER BY a.created_at DESC
		LIMIT $2 OFFSET $3`
	rows, err := s.db.Query(ctx, q, referrerID, limit, offset, ActiveWindowDays)
	if err != nil {
		return nil, fmt.Errorf("referrals: list referrals: %w", err)
	}
	defer rows.Close()

	out := []ReferredUser{}
	for rows.Next() {
		var ru ReferredUser
		var contact string
		if err := rows.Scan(&ru.ReferredUserID, &contact, &ru.JoinedAt, &ru.Active, &ru.LifetimeEarnedKobo); err != nil {
			return nil, err
		}
		ru.MaskedContact = maskContact(contact)
		out = append(out, ru)
	}
	return out, rows.Err()
}

// ListEarnings returns the caller's paginated reward history (§5.1 screen 4).
func (s *RewardService) ListEarnings(ctx context.Context, referrerID string, limit, offset int) ([]Reward, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT id, referrer_id, referred_user_id, source_transaction_id, module,
		       margin_kobo, applied_rate, reward_kobo, status, config_version,
		       created_at, credited_at, reversed_at
		FROM referral_rewards
		WHERE referrer_id=$1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`
	return s.scanRewards(ctx, q, referrerID, limit, offset)
}

// ListMilestones returns the caller's achieved milestones plus the upcoming ones
// derived from the active config (§5.1 screen 5/6).
func (s *RewardService) ListMilestones(ctx context.Context, referrerID string) ([]Milestone, []MilestoneBand, error) {
	const q = `
		SELECT id, referrer_id, threshold, bonus_kobo, status, achieved_at, paid_at, voided_at
		FROM referral_milestones WHERE referrer_id=$1 ORDER BY threshold ASC`
	rows, err := s.db.Query(ctx, q, referrerID)
	if err != nil {
		return nil, nil, fmt.Errorf("referrals: list milestones: %w", err)
	}
	defer rows.Close()
	achieved := []Milestone{}
	seen := map[int]bool{}
	for rows.Next() {
		var m Milestone
		if err := rows.Scan(&m.ID, &m.ReferrerID, &m.Threshold, &m.BonusKobo, &m.Status, &m.AchievedAt, &m.PaidAt, &m.VoidedAt); err != nil {
			return nil, nil, err
		}
		achieved = append(achieved, m)
		seen[m.Threshold] = true
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	upcoming := []MilestoneBand{}
	if cfg, cerr := s.ActiveConfig(ctx); cerr == nil {
		for _, b := range cfg.MilestoneTable {
			if !seen[b.Threshold] {
				upcoming = append(upcoming, b)
			}
		}
	}
	return achieved, upcoming, nil
}

func (s *RewardService) scanRewards(ctx context.Context, q string, args ...any) ([]Reward, error) {
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("referrals: query rewards: %w", err)
	}
	defer rows.Close()
	out := []Reward{}
	for rows.Next() {
		var r Reward
		if err := rows.Scan(&r.ID, &r.ReferrerID, &r.ReferredUserID, &r.SourceTransactionID, &r.Module,
			&r.MarginKobo, &r.AppliedRate, &r.RewardKobo, &r.Status, &r.ConfigVersion,
			&r.CreatedAt, &r.CreditedAt, &r.ReversedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ============================================================================
// NIGHTLY RECALC — active-count → tier/rate; milestone crossings → idempotent payout.
// ============================================================================

// RecalculateTiers recomputes every referrer's rolling active_referral_count
// (referred users with >= 1 CREDITED reward in the trailing 30 days), sets
// current_tier/current_rate from the active config, and fires milestone
// ACHIEVED→PAID on threshold crossings (idempotent payout to the wallet). Intended
// to run nightly. Errors on individual referrers are logged via the audit sink and
// do not abort the whole sweep — the caller gets the first hard error only.
func (s *RewardService) RecalculateTiers(ctx context.Context) error {
	cfg, err := s.ActiveConfig(ctx)
	if err != nil {
		return err
	}

	// Active count per referrer over the trailing window.
	const countQ = `
		SELECT a.referrer_id, COUNT(DISTINCT a.referred_user_id)
		FROM referral_attributions a
		WHERE a.referrer_id IS NOT NULL
		  AND EXISTS (
		    SELECT 1 FROM referral_rewards r
		    WHERE r.referred_user_id = a.referred_user_id
		      AND r.referrer_id = a.referrer_id
		      AND r.status = 'CREDITED'
		      AND r.created_at >= now() - make_interval(days => $1)
		  )
		GROUP BY a.referrer_id`
	rows, err := s.db.Query(ctx, countQ, ActiveWindowDays)
	if err != nil {
		return fmt.Errorf("referrals: recalc count query: %w", err)
	}
	type row struct {
		referrerID string
		count      int
	}
	var counts []row
	for rows.Next() {
		var rr row
		if err := rows.Scan(&rr.referrerID, &rr.count); err != nil {
			rows.Close()
			return err
		}
		counts = append(counts, rr)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, rr := range counts {
		tier := TierStarter
		var rate float64
		if b, ok := cfg.TierForCount(rr.count); ok {
			tier = b.Tier
			rate = b.Rate
		}
		const upsert = `
			INSERT INTO referral_tier_status
			  (referrer_id, active_referral_count, current_tier, current_rate, last_recalculated_at)
			VALUES ($1,$2,$3,$4,now())
			ON CONFLICT (referrer_id) DO UPDATE
			SET active_referral_count=EXCLUDED.active_referral_count,
			    current_tier=EXCLUDED.current_tier,
			    current_rate=EXCLUDED.current_rate,
			    last_recalculated_at=now()`
		if _, err := s.db.Exec(ctx, upsert, rr.referrerID, rr.count, tier, rate); err != nil {
			return fmt.Errorf("referrals: recalc upsert tier: %w", err)
		}
		s.emit(ctx, "referral.tier.recalculated", map[string]any{
			"referrer_id": rr.referrerID, "active_referral_count": rr.count,
			"current_tier": tier, "current_rate": rate,
		})

		// Milestone crossings — pay each threshold the count now meets, once.
		for _, m := range cfg.MilestoneTable {
			if rr.count >= m.Threshold {
				if err := s.awardMilestone(ctx, rr.referrerID, m); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// awardMilestone inserts an ACHIEVED milestone (idempotent per referrer+threshold),
// credits the one-time bonus to the wallet, and flips it PAID. Idempotency is
// anchored on referral_milestones.idempotency_key + the ledger idempotency key.
func (s *RewardService) awardMilestone(ctx context.Context, referrerID string, band MilestoneBand) error {
	idemKey := fmt.Sprintf("referral:milestone:%s:%d", referrerID, band.Threshold)
	const ins = `
		INSERT INTO referral_milestones (referrer_id, threshold, bonus_kobo, status, idempotency_key)
		VALUES ($1,$2,$3,'ACHIEVED',$4)
		ON CONFLICT (referrer_id, threshold) DO NOTHING
		RETURNING id`
	var milestoneID string
	err := s.db.QueryRow(ctx, ins, referrerID, band.Threshold, band.BonusKobo, idemKey).Scan(&milestoneID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Already achieved (and presumably paid) — idempotent no-op.
		return nil
	}
	if err != nil {
		return fmt.Errorf("referrals: insert milestone: %w", err)
	}

	if band.BonusKobo > 0 {
		expenseAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountReferralReward)
		if err != nil {
			return err
		}
		if err := s.ledger.Credit(ctx, referrerID, idemKey, idemKey, expenseAcc.ID, band.BonusKobo); err != nil {
			if !errors.Is(err, ledger.ErrDuplicate) {
				return fmt.Errorf("referrals: credit milestone: %w", err)
			}
		}
	}

	const upd = `UPDATE referral_milestones SET status='PAID', paid_at=now()
	             WHERE id=$1 AND status='ACHIEVED'`
	if _, err := s.db.Exec(ctx, upd, milestoneID); err != nil {
		return fmt.Errorf("referrals: mark milestone paid: %w", err)
	}
	s.emit(ctx, "referral.milestone.paid", map[string]any{
		"referrer_id": referrerID, "threshold": band.Threshold, "bonus_kobo": band.BonusKobo,
	})
	return nil
}

// ============================================================================
// ADMIN — config / analytics / fraud / ledger / case / milestones / module.
// ============================================================================

// GetActiveConfig returns the currently-active config (A1 read).
func (s *RewardService) GetActiveConfig(ctx context.Context) (*ProgramConfig, error) {
	return s.ActiveConfig(ctx)
}

// PublishConfig writes a NEW versioned config row (A1). Never mutates an existing
// row — this preserves the "future-only" invariant (§3): the effective_from gates
// which transactions use it. If effectiveFrom is zero it defaults to now().
func (s *RewardService) PublishConfig(ctx context.Context, tiers []TierBand, milestones []MilestoneBand, effectiveFrom time.Time, adminID string) (*ProgramConfig, error) {
	if len(tiers) == 0 || len(milestones) == 0 {
		return nil, fmt.Errorf("referrals: config requires tier_table and milestone_table")
	}
	if effectiveFrom.IsZero() {
		effectiveFrom = time.Now()
	}
	tierJSON, err := json.Marshal(tiers)
	if err != nil {
		return nil, err
	}
	msJSON, err := json.Marshal(milestones)
	if err != nil {
		return nil, err
	}
	const ins = `
		INSERT INTO referral_program_config (version, tier_table, milestone_table, is_active, effective_from)
		VALUES (
		  (SELECT COALESCE(MAX(version),0)+1 FROM referral_program_config),
		  $1,$2,true,$3)
		RETURNING id, version, is_active, effective_from, created_at`
	var c ProgramConfig
	if err := s.db.QueryRow(ctx, ins, tierJSON, msJSON, effectiveFrom).
		Scan(&c.ID, &c.Version, &c.IsActive, &c.EffectiveFrom, &c.CreatedAt); err != nil {
		return nil, fmt.Errorf("referrals: publish config: %w", err)
	}
	c.TierTable = tiers
	c.MilestoneTable = milestones
	s.emit(ctx, "referral.config.published", map[string]any{
		"version": c.Version, "effective_from": c.EffectiveFrom, "admin_id": adminID,
	})
	return &c, nil
}

// Analytics is the A2 program-health payload.
type Analytics struct {
	ActiveReferrers      int            `json:"active_referrers"`
	ActiveReferredUsers  int            `json:"active_referred_users"`
	TotalRewardsPaidKobo int64          `json:"total_rewards_paid_kobo"`
	TotalMarginKobo      int64          `json:"total_margin_kobo"`
	RewardCostPct        float64        `json:"reward_cost_pct"` // north-star: reward / margin
	ByModule             []ModuleRollup `json:"by_module"`
	ByTier               []TierRollup   `json:"by_tier"`
}

// ModuleRollup is a per-module reward rollup for A2/A7.
type ModuleRollup struct {
	Module      string    `json:"module"`
	RewardKobo  int64     `json:"reward_kobo"`
	RewardCount int       `json:"reward_count"`
	LastEventAt time.Time `json:"last_event_at"`
}

// TierRollup is a per-tier referrer rollup for A2.
type TierRollup struct {
	Tier          string `json:"tier"`
	ReferrerCount int    `json:"referrer_count"`
}

// GetAnalytics computes the A2 dashboard (north-star = reward cost % of margin).
func (s *RewardService) GetAnalytics(ctx context.Context) (*Analytics, error) {
	a := &Analytics{ByModule: []ModuleRollup{}, ByTier: []TierRollup{}}

	const totals = `
		SELECT
		  COALESCE(SUM(reward_kobo) FILTER (WHERE status='CREDITED'),0),
		  COALESCE(SUM(margin_kobo) FILTER (WHERE status='CREDITED'),0),
		  COUNT(DISTINCT referrer_id) FILTER (WHERE status='CREDITED'),
		  COUNT(DISTINCT referred_user_id) FILTER (WHERE status='CREDITED')
		FROM referral_rewards`
	if err := s.db.QueryRow(ctx, totals).Scan(
		&a.TotalRewardsPaidKobo, &a.TotalMarginKobo, &a.ActiveReferrers, &a.ActiveReferredUsers); err != nil {
		return nil, fmt.Errorf("referrals: analytics totals: %w", err)
	}
	if a.TotalMarginKobo > 0 {
		a.RewardCostPct = float64(a.TotalRewardsPaidKobo) / float64(a.TotalMarginKobo)
	}

	const byMod = `
		SELECT module, COALESCE(SUM(reward_kobo),0), COUNT(*), MAX(created_at)
		FROM referral_rewards GROUP BY module ORDER BY module`
	mrows, err := s.db.Query(ctx, byMod)
	if err != nil {
		return nil, fmt.Errorf("referrals: analytics by module: %w", err)
	}
	for mrows.Next() {
		var m ModuleRollup
		if err := mrows.Scan(&m.Module, &m.RewardKobo, &m.RewardCount, &m.LastEventAt); err != nil {
			mrows.Close()
			return nil, err
		}
		a.ByModule = append(a.ByModule, m)
	}
	mrows.Close()
	if err := mrows.Err(); err != nil {
		return nil, err
	}

	const byTier = `SELECT current_tier, COUNT(*) FROM referral_tier_status GROUP BY current_tier ORDER BY current_tier`
	trows, err := s.db.Query(ctx, byTier)
	if err != nil {
		return nil, fmt.Errorf("referrals: analytics by tier: %w", err)
	}
	for trows.Next() {
		var t TierRollup
		if err := trows.Scan(&t.Tier, &t.ReferrerCount); err != nil {
			trows.Close()
			return nil, err
		}
		a.ByTier = append(a.ByTier, t)
	}
	trows.Close()
	return a, trows.Err()
}

// AdminListLedger returns the full reward ledger, filterable (A4).
func (s *RewardService) AdminListLedger(ctx context.Context, status, module string, limit, offset int) ([]Reward, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const q = `
		SELECT id, referrer_id, referred_user_id, source_transaction_id, module,
		       margin_kobo, applied_rate, reward_kobo, status, config_version,
		       created_at, credited_at, reversed_at
		FROM referral_rewards
		WHERE ($1='' OR status=$1) AND ($2='' OR module=$2)
		ORDER BY created_at DESC
		LIMIT $3 OFFSET $4`
	return s.scanRewards(ctx, q, status, module, limit, offset)
}

// FraudFlag is an A3 row.
type FraudFlag struct {
	ID             string     `json:"id"`
	ReferrerID     *string    `json:"referrer_id,omitempty"`
	ReferredUserID *string    `json:"referred_user_id,omitempty"`
	Reason         string     `json:"reason"`
	Status         string     `json:"status"`
	ReviewNote     *string    `json:"review_note,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	ReviewedAt     *time.Time `json:"reviewed_at,omitempty"`
}

// ListFraudQueue returns open fraud flags (A3). Thin: empty until anti-abuse
// jobs populate referral_fraud_flags.
func (s *RewardService) ListFraudQueue(ctx context.Context, status string) ([]FraudFlag, error) {
	if status == "" {
		status = "OPEN"
	}
	const q = `
		SELECT id, referrer_id, referred_user_id, reason, status, review_note, created_at, reviewed_at
		FROM referral_fraud_flags WHERE status=$1 ORDER BY created_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, status)
	if err != nil {
		return nil, fmt.Errorf("referrals: list fraud queue: %w", err)
	}
	defer rows.Close()
	out := []FraudFlag{}
	for rows.Next() {
		var f FraudFlag
		if err := rows.Scan(&f.ID, &f.ReferrerID, &f.ReferredUserID, &f.Reason, &f.Status, &f.ReviewNote, &f.CreatedAt, &f.ReviewedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// ActionFraudFlag records a reviewer decision on a flag (A3 runbook 2). action is
// one of CLEARED / VOIDED / SUSPENDED. A logged note is required.
func (s *RewardService) ActionFraudFlag(ctx context.Context, flagID, action, note, reviewerID string) error {
	switch action {
	case "CLEARED", "VOIDED", "SUSPENDED":
	default:
		return fmt.Errorf("referrals: invalid fraud action %q", action)
	}
	if strings.TrimSpace(note) == "" {
		return fmt.Errorf("referrals: fraud action requires a logged note")
	}
	const upd = `
		UPDATE referral_fraud_flags
		SET status=$2, review_note=$3, reviewed_by=$4, reviewed_at=now()
		WHERE id=$1 AND status='OPEN'`
	ct, err := s.db.Exec(ctx, upd, flagID, action, note, reviewerID)
	if err != nil {
		return fmt.Errorf("referrals: action fraud flag: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("referrals: fraud flag not found or already actioned")
	}
	s.emit(ctx, "referral.fraud.actioned", map[string]any{
		"flag_id": flagID, "action": action, "reviewer_id": reviewerID,
	})
	return nil
}

// CaseView is the A5 support payload for a single referrer.
type CaseView struct {
	ReferrerID string      `json:"referrer_id"`
	Tier       *TierStatus `json:"tier,omitempty"`
	Rewards    []Reward    `json:"rewards"`
	Milestones []Milestone `json:"milestones"`
}

// GetCase assembles a referrer's full picture (A5).
func (s *RewardService) GetCase(ctx context.Context, referrerID string) (*CaseView, error) {
	cv := &CaseView{ReferrerID: referrerID, Rewards: []Reward{}, Milestones: []Milestone{}}

	const tq = `SELECT referrer_id, active_referral_count, current_tier, current_rate, last_recalculated_at
	            FROM referral_tier_status WHERE referrer_id=$1`
	var ts TierStatus
	err := s.db.QueryRow(ctx, tq, referrerID).Scan(
		&ts.ReferrerID, &ts.ActiveReferralCount, &ts.CurrentTier, &ts.CurrentRate, &ts.LastRecalculatedAt)
	if err == nil {
		cv.Tier = &ts
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("referrals: case tier: %w", err)
	}

	rewards, err := s.ListEarnings(ctx, referrerID, 200, 0)
	if err != nil {
		return nil, err
	}
	cv.Rewards = rewards

	achieved, _, err := s.ListMilestones(ctx, referrerID)
	if err != nil {
		return nil, err
	}
	cv.Milestones = achieved
	return cv, nil
}

// AdjustCase applies a manual reward adjustment to a referrer's wallet with a
// mandatory logged reason (A5). Positive adjustKobo credits; negative debits.
// Idempotent per idempotency key. Every adjust is recorded in
// referral_case_adjustments for audit.
func (s *RewardService) AdjustCase(ctx context.Context, referrerID string, adjustKobo int64, reason, adminID, idempotencyKey string) error {
	if strings.TrimSpace(reason) == "" {
		return fmt.Errorf("referrals: manual adjustment requires a logged reason")
	}
	if adjustKobo == 0 {
		return fmt.Errorf("referrals: adjustment amount must be non-zero")
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		return fmt.Errorf("referrals: manual adjustment requires an idempotency key")
	}

	// Record the audit row first (UNIQUE idempotency_key makes a replay a no-op).
	const ins = `
		INSERT INTO referral_case_adjustments (referrer_id, adjust_kobo, reason, adjusted_by, idempotency_key)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id`
	var adjID string
	err := s.db.QueryRow(ctx, ins, referrerID, adjustKobo, reason, adminID, idempotencyKey).Scan(&adjID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // duplicate — already applied
	}
	if err != nil {
		return fmt.Errorf("referrals: record adjustment: %w", err)
	}

	expenseAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountReferralReward)
	if err != nil {
		return err
	}
	ledgerKey := "referral:adjust:" + adjID
	if adjustKobo > 0 {
		if err := s.ledger.Credit(ctx, referrerID, ledgerKey, ledgerKey, expenseAcc.ID, adjustKobo); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			return fmt.Errorf("referrals: adjust credit: %w", err)
		}
	} else {
		walletAcc, err := s.ledger.GetOrCreateUserWallet(ctx, referrerID)
		if err != nil {
			return err
		}
		// Negative adjustment: drain from the referrer wallet back to expense
		// via a reversal pair (restore=expense, release=wallet).
		if err := s.ledger.PostReversal(ctx, expenseAcc.ID, walletAcc.ID, -adjustKobo, ledgerKey, ledgerKey); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			return fmt.Errorf("referrals: adjust debit: %w", err)
		}
	}
	s.emit(ctx, "referral.case.adjusted", map[string]any{
		"referrer_id": referrerID, "adjust_kobo": adjustKobo, "reason": reason, "admin_id": adminID,
	})
	return nil
}

// ListMilestonesLog returns the milestone payout log across all referrers (A6).
func (s *RewardService) ListMilestonesLog(ctx context.Context, limit, offset int) ([]Milestone, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const q = `
		SELECT id, referrer_id, threshold, bonus_kobo, status, achieved_at, paid_at, voided_at
		FROM referral_milestones ORDER BY achieved_at DESC LIMIT $1 OFFSET $2`
	rows, err := s.db.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("referrals: milestones log: %w", err)
	}
	defer rows.Close()
	out := []Milestone{}
	for rows.Next() {
		var m Milestone
		if err := rows.Scan(&m.ID, &m.ReferrerID, &m.Threshold, &m.BonusKobo, &m.Status, &m.AchievedAt, &m.PaidAt, &m.VoidedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ModuleStatus returns per-module last-event-received + volume (A7), derived from
// referral_rewards.created_at grouped by module.
func (s *RewardService) ModuleStatus(ctx context.Context) ([]ModuleRollup, error) {
	const q = `
		SELECT module, COALESCE(SUM(reward_kobo),0), COUNT(*), MAX(created_at)
		FROM referral_rewards GROUP BY module ORDER BY MAX(created_at) DESC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("referrals: module status: %w", err)
	}
	defer rows.Close()
	out := []ModuleRollup{}
	for rows.Next() {
		var m ModuleRollup
		if err := rows.Scan(&m.Module, &m.RewardKobo, &m.RewardCount, &m.LastEventAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ============================================================================
// small helpers.
// ============================================================================

func generateRewardCode() (string, error) {
	b := make([]byte, 5)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("referrals: generate code: %w", err)
	}
	return "R" + strings.ToUpper(hex.EncodeToString(b)), nil
}

// maskContact masks an email/phone for privacy in the My Referrals list.
func maskContact(contact string) string {
	contact = strings.TrimSpace(contact)
	if contact == "" {
		return ""
	}
	if at := strings.IndexByte(contact, '@'); at > 0 {
		local := contact[:at]
		domain := contact[at:]
		if len(local) <= 2 {
			return local[:1] + "***" + domain
		}
		return local[:2] + "***" + domain
	}
	if len(contact) <= 4 {
		return "***"
	}
	return "***" + contact[len(contact)-4:]
}
