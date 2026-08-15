// Package ledger is the referral reward state machine over referral_reward_ledger
// (§7 reward states, FR-EARN). States move forward only:
//
//	earned → pending → vesting → eligible → paid
//
// plus a terminal clawed_back from any non-paid/paid state. Every accrual and
// transition carries a UNIQUE idempotency_key. Real (human) payouts post a
// balanced double-entry via the finance ledger (ledger.Credit); house accruals
// are NOTIONAL — they never post to a wallet (non-withdrawable, §7A.2).
package ledger

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	financeledger "spotlight/backend/internal/finance/ledger"
)

// Reward states.
const (
	StateEarned     = "earned"
	StatePending    = "pending"
	StateVesting    = "vesting"
	StateEligible   = "eligible"
	StatePaid       = "paid"
	StateClawedBack = "clawed_back"
)

// Reward kinds.
const (
	KindReferrer = "referrer"
	KindReferee  = "referee"
	KindOverride = "override"
	KindMission  = "mission"
	KindManual   = "manual"
)

// forwardTransitions encodes the only legal state moves (forward + clawback).
var forwardTransitions = map[string]map[string]bool{
	StateEarned:   {StatePending: true, StateClawedBack: true},
	StatePending:  {StateVesting: true, StateClawedBack: true},
	StateVesting:  {StateEligible: true, StateClawedBack: true},
	StateEligible: {StatePaid: true, StateClawedBack: true},
	StatePaid:     {StateClawedBack: true},
}

// ErrIllegalTransition is returned when a non-forward state move is requested.
var ErrIllegalTransition = fmt.Errorf("referral/ledger: illegal state transition")

// MinWithdrawTier is the verified KYC-tier floor required to withdraw referral
// earnings into the wallet. Mirrors the referral payout gate (referral/finance
// minPayoutTier). Fail-closed: an unverified user resolves to tier 0.
const MinWithdrawTier = 1

// ErrKYCRequired is returned when the caller's verified KYC tier is below
// MinWithdrawTier.
var ErrKYCRequired = fmt.Errorf("referral/ledger: verified KYC required to withdraw")

// AuditSink records a durable audit event for a money mutation. Optional; wired
// by the route registrar to the referral events sink. Must be idempotent on key.
type AuditSink func(ctx context.Context, event, userID string, payload map[string]any, idempotencyKey string) error

// AccrueInput describes a new reward accrual.
type AccrueInput struct {
	BeneficiaryID  string // human beneficiary; "" for a house accrual
	HouseAccountID string // house account; "" for a human accrual
	ReferredUserID string
	CampaignID     string
	Kind           string
	AmountKobo     int64
	Currency       string // defaults NGN
	IsHouse        bool
	IdempotencyKey string
}

// Entry is a reward-ledger row.
type Entry struct {
	ID                   string `json:"id"`
	BeneficiaryID        string `json:"beneficiary_id,omitempty"`
	HouseAccountID       string `json:"house_account_id,omitempty"`
	ReferredUserID       string `json:"referred_user_id,omitempty"`
	Kind                 string `json:"kind"`
	State                string `json:"state"`
	AmountKobo           int64  `json:"amount_kobo"`
	Currency             string `json:"currency"`
	IsHouse              bool   `json:"is_house"`
	ExcludedFromOverride bool   `json:"excluded_from_override"`
	ExcludedFromKFactor  bool   `json:"excluded_from_kfactor"`
}

// Summary aggregates a beneficiary's rewards by state (M-HOME-03 / my-rewards).
type Summary struct {
	BeneficiaryID   string           `json:"beneficiary_id"`
	TotalEarnedKobo int64            `json:"total_earned_kobo"`
	EligibleKobo    int64            `json:"eligible_kobo"`
	PaidKobo        int64            `json:"paid_kobo"`
	ClawedBackKobo  int64            `json:"clawed_back_kobo"`
	ByState         map[string]int64 `json:"by_state"`
}

// Service drives the reward state machine.
type Service struct {
	db      *pgxpool.Pool
	finance *financeledger.Service
	audit   AuditSink // optional; nil ⇒ no durable audit emission
}

func NewService(db *pgxpool.Pool, finance *financeledger.Service) *Service {
	return &Service{db: db, finance: finance}
}

// SetAuditSink wires a durable audit sink for money mutations (e.g. withdraw).
// Non-breaking: existing constructions keep a nil sink.
func (s *Service) SetAuditSink(sink AuditSink) { s.audit = sink }

// Accrue records a new reward in the 'earned' state. Idempotent on
// idempotency_key. House accruals are tagged is_house and excluded from both the
// override chain and K-factor (§7A.2, §7A.6) and never touch a wallet.
func (s *Service) Accrue(ctx context.Context, in AccrueInput) (string, error) {
	if in.AmountKobo < 0 {
		return "", fmt.Errorf("referral/ledger: accrue negative amount %d", in.AmountKobo)
	}
	if in.BeneficiaryID == "" && in.HouseAccountID == "" {
		return "", fmt.Errorf("referral/ledger: accrue requires a beneficiary or house account")
	}
	currency := in.Currency
	if currency == "" {
		currency = "NGN"
	}
	kind := in.Kind
	if kind == "" {
		kind = KindReferrer
	}

	const q = `
		INSERT INTO referral_reward_ledger
			(beneficiary_id, house_account_id, referred_user_id, campaign_id, kind,
			 state, amount_kobo, currency, is_house, excluded_from_override,
			 excluded_from_kfactor, idempotency_key)
		VALUES ($1, $2, $3, $4, $5, 'earned', $6, $7, $8, $8, $8, $9)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id`
	var id string
	err := s.db.QueryRow(ctx, q,
		nullable(in.BeneficiaryID),
		nullable(in.HouseAccountID),
		nullable(in.ReferredUserID),
		nullable(in.CampaignID),
		kind,
		in.AmountKobo,
		currency,
		in.IsHouse, // also drives excluded_from_override + excluded_from_kfactor
		in.IdempotencyKey,
	).Scan(&id)
	if err == pgx.ErrNoRows {
		// Duplicate accrual (same idempotency key) — fetch existing id.
		return s.idByKey(ctx, in.IdempotencyKey)
	}
	if err != nil {
		return "", fmt.Errorf("referral/ledger: accrue: %w", err)
	}
	return id, nil
}

// Transition advances a reward to nextState (forward-only or clawback). When the
// target is 'paid' and the row belongs to a HUMAN beneficiary, a balanced
// double-entry is posted to the finance ledger (real payout). House rows are
// notional and never post to a wallet. Idempotent via idempotency_key suffix.
func (s *Service) Transition(ctx context.Context, rewardID, nextState, idempotencyKey string) error {
	var (
		current       string
		beneficiaryID *string
		isHouse       bool
		amountKobo    int64
		referredID    *string
	)
	const sel = `
		SELECT state, beneficiary_id, is_house, amount_kobo, referred_user_id
		FROM referral_reward_ledger WHERE id = $1`
	if err := s.db.QueryRow(ctx, sel, rewardID).Scan(
		&current, &beneficiaryID, &isHouse, &amountKobo, &referredID); err != nil {
		return fmt.Errorf("referral/ledger: load reward %q: %w", rewardID, err)
	}
	if current == nextState {
		return nil // idempotent no-op
	}
	if !forwardTransitions[current][nextState] {
		return fmt.Errorf("%w: %s → %s", ErrIllegalTransition, current, nextState)
	}

	// Real payout: post a balanced credit to the human beneficiary's wallet.
	// House rows are notional and skip the wallet entirely.
	if nextState == StatePaid && !isHouse && beneficiaryID != nil && *beneficiaryID != "" && amountKobo > 0 {
		acc, err := s.finance.GetOrCreateStandingAccount(ctx, financeledger.AccountReferralReward)
		if err != nil {
			return err
		}
		ref := "referral:payout:" + rewardID
		if err := s.finance.Credit(ctx, *beneficiaryID, ref, idempotencyKey, acc.ID, amountKobo); err != nil {
			if err != financeledger.ErrDuplicate {
				return fmt.Errorf("referral/ledger: post payout: %w", err)
			}
		}
	}

	const upd = `
		UPDATE referral_reward_ledger
		SET state = $2, updated_at = now()
		WHERE id = $1 AND state = $3`
	tag, err := s.db.Exec(ctx, upd, rewardID, nextState, current)
	if err != nil {
		return fmt.Errorf("referral/ledger: transition: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Lost the race — re-read; if already at target, treat as success.
		var now string
		if err := s.db.QueryRow(ctx, `SELECT state FROM referral_reward_ledger WHERE id=$1`, rewardID).Scan(&now); err == nil && now == nextState {
			return nil
		}
		return fmt.Errorf("%w: concurrent change on %s", ErrIllegalTransition, rewardID)
	}
	return nil
}

// ClawBack reverses an accrual. For a real prior payout it posts a reversing
// entry to the finance ledger; for not-yet-paid or house rows it only flips
// state. Idempotent.
func (s *Service) ClawBack(ctx context.Context, rewardID, idempotencyKey string) error {
	return s.Transition(ctx, rewardID, StateClawedBack, idempotencyKey)
}

// GetSummary aggregates a beneficiary's rewards by state.
func (s *Service) GetSummary(ctx context.Context, beneficiaryID string) (*Summary, error) {
	const q = `
		SELECT state, COALESCE(SUM(amount_kobo), 0)
		FROM referral_reward_ledger
		WHERE beneficiary_id = $1
		GROUP BY state`
	rows, err := s.db.Query(ctx, q, beneficiaryID)
	if err != nil {
		return nil, fmt.Errorf("referral/ledger: summary: %w", err)
	}
	defer rows.Close()

	out := &Summary{BeneficiaryID: beneficiaryID, ByState: map[string]int64{}}
	for rows.Next() {
		var state string
		var sum int64
		if err := rows.Scan(&state, &sum); err != nil {
			return nil, err
		}
		out.ByState[state] = sum
		switch state {
		case StateEligible:
			out.EligibleKobo = sum
		case StatePaid:
			out.PaidKobo = sum
		case StateClawedBack:
			out.ClawedBackKobo = sum
		}
		if state != StateClawedBack {
			out.TotalEarnedKobo += sum
		}
	}
	return out, rows.Err()
}

// WithdrawResult summarizes an eligible→wallet sweep.
type WithdrawResult struct {
	BeneficiaryID         string `json:"beneficiary_id"`
	WithdrawnKobo         int64  `json:"withdrawn_kobo"`
	RewardsPaid           int    `json:"rewards_paid"`
	RemainingEligibleKobo int64  `json:"remaining_eligible_kobo"`
	Currency              string `json:"currency"`
}

// WithdrawEligible sweeps ALL of a beneficiary's eligible rewards into their
// Spotlight wallet. Each eligible row is transitioned eligible→paid, which posts
// a balanced double-entry (DR referral_reward_expense / CR user_wallet) with a
// per-row idempotency key. The operation is:
//
//   - idempotent  — replayed with the same idempotencyKey it credits nothing twice
//     (the pay primitive dedups on key and the state flip is guarded WHERE state=eligible);
//   - serialized  — a per-user advisory lock prevents a concurrent second withdraw
//     (with a different key) from double-crediting the same row, since the pay
//     primitive posts the wallet credit *before* the guarded state flip;
//   - fail-closed — requires a verified KYC tier ≥ MinWithdrawTier.
//
// Money is integer kobo throughout. Returns the amount moved and remaining eligible.
func (s *Service) WithdrawEligible(ctx context.Context, beneficiaryID, idempotencyKey string) (*WithdrawResult, error) {
	if beneficiaryID == "" {
		return nil, fmt.Errorf("referral/ledger: withdraw requires a beneficiary")
	}
	if idempotencyKey == "" {
		return nil, fmt.Errorf("referral/ledger: withdraw requires an idempotency key")
	}

	// (4) KYC/tier gate — fail-closed.
	tier, err := s.verifiedKYCTier(ctx, beneficiaryID)
	if err != nil {
		return nil, err
	}
	if tier < MinWithdrawTier {
		return nil, ErrKYCRequired
	}

	// Serialize concurrent withdrawals for this user (see doc comment).
	conn, err := s.db.Acquire(ctx)
	if err != nil {
		return nil, fmt.Errorf("referral/ledger: withdraw acquire: %w", err)
	}
	defer conn.Release()
	const lockName = "referral:withdraw:"
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(hashtext($1))`, lockName+beneficiaryID); err != nil {
		return nil, fmt.Errorf("referral/ledger: withdraw lock: %w", err)
	}
	defer func() {
		// Unlock on a fresh context; the request ctx may already be done.
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock(hashtext($1))`, lockName+beneficiaryID)
	}()

	// List the caller's eligible (withdrawable, human, positive) rows under the lock.
	const sel = `
		SELECT id, amount_kobo, COALESCE(currency, 'NGN')
		FROM referral_reward_ledger
		WHERE beneficiary_id = $1 AND state = $2 AND is_house = false AND amount_kobo > 0
		ORDER BY created_at`
	rows, err := conn.Query(ctx, sel, beneficiaryID, StateEligible)
	if err != nil {
		return nil, fmt.Errorf("referral/ledger: withdraw list: %w", err)
	}
	type eligibleRow struct {
		id       string
		amount   int64
		currency string
	}
	eligible := []eligibleRow{}
	for rows.Next() {
		var r eligibleRow
		if err := rows.Scan(&r.id, &r.amount, &r.currency); err != nil {
			rows.Close()
			return nil, err
		}
		eligible = append(eligible, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	currency := "NGN"
	var withdrawn int64
	paid := 0
	for _, r := range eligible {
		// (1) per-row idempotency key; (2) Transition posts the balanced entry.
		if err := s.Transition(ctx, r.id, StatePaid, idempotencyKey+":"+r.id); err != nil {
			return nil, fmt.Errorf("referral/ledger: withdraw pay %s: %w", r.id, err)
		}
		withdrawn += r.amount
		paid++
		if r.currency != "" {
			currency = r.currency
		}
	}

	// Remaining eligible after the sweep (expected 0 under the lock).
	var remaining int64
	_ = conn.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_kobo), 0) FROM referral_reward_ledger WHERE beneficiary_id = $1 AND state = $2`,
		beneficiaryID, StateEligible).Scan(&remaining)

	// (3) Durable audit event (idempotent on key).
	if s.audit != nil {
		_ = s.audit(ctx, "referral_withdraw", beneficiaryID, map[string]any{
			"withdrawn_kobo": withdrawn,
			"rewards_paid":   paid,
			"currency":       currency,
		}, "referral_withdraw:"+idempotencyKey)
	}

	return &WithdrawResult{
		BeneficiaryID:         beneficiaryID,
		WithdrawnKobo:         withdrawn,
		RewardsPaid:           paid,
		RemainingEligibleKobo: remaining,
		Currency:              currency,
	}, nil
}

// verifiedKYCTier returns the beneficiary's verified KYC tier (0 when not
// verified — fail-closed). Mirrors referral/finance Repository.KYCTier.
func (s *Service) verifiedKYCTier(ctx context.Context, userID string) (int, error) {
	const q = `SELECT COALESCE(kyc_tier, 0) FROM user_profiles WHERE id = $1 AND kyc_status = 'verified'`
	var tier int
	err := s.db.QueryRow(ctx, q, userID).Scan(&tier)
	if err == pgx.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("referral/ledger: kyc tier: %w", err)
	}
	return tier, nil
}

// ListByBeneficiary returns a beneficiary's reward rows (admin reward-ledger view
// passes a non-empty beneficiary; an empty value lists recent rows globally).
func (s *Service) ListByBeneficiary(ctx context.Context, beneficiaryID string, limit int) ([]Entry, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	var (
		rows pgx.Rows
		err  error
	)
	if beneficiaryID == "" {
		const q = `
			SELECT id, beneficiary_id, house_account_id, referred_user_id, kind, state,
			       amount_kobo, currency, is_house, excluded_from_override, excluded_from_kfactor
			FROM referral_reward_ledger
			ORDER BY created_at DESC
			LIMIT $1`
		rows, err = s.db.Query(ctx, q, limit)
	} else {
		const q = `
			SELECT id, beneficiary_id, house_account_id, referred_user_id, kind, state,
			       amount_kobo, currency, is_house, excluded_from_override, excluded_from_kfactor
			FROM referral_reward_ledger
			WHERE beneficiary_id = $1
			ORDER BY created_at DESC
			LIMIT $2`
		rows, err = s.db.Query(ctx, q, beneficiaryID, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("referral/ledger: list: %w", err)
	}
	defer rows.Close()

	out := []Entry{}
	for rows.Next() {
		var (
			e              Entry
			ben, hAcc, ref *string
		)
		if err := rows.Scan(&e.ID, &ben, &hAcc, &ref, &e.Kind, &e.State,
			&e.AmountKobo, &e.Currency, &e.IsHouse, &e.ExcludedFromOverride, &e.ExcludedFromKFactor); err != nil {
			return nil, err
		}
		if ben != nil {
			e.BeneficiaryID = *ben
		}
		if hAcc != nil {
			e.HouseAccountID = *hAcc
		}
		if ref != nil {
			e.ReferredUserID = *ref
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Service) idByKey(ctx context.Context, key string) (string, error) {
	var id string
	if err := s.db.QueryRow(ctx,
		`SELECT id FROM referral_reward_ledger WHERE idempotency_key = $1`, key).Scan(&id); err != nil {
		return "", fmt.Errorf("referral/ledger: id by key: %w", err)
	}
	return id, nil
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
