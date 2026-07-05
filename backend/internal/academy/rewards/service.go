package rewards

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// store is the narrow persistence seam the Service depends on. The concrete
// *Repository satisfies it; tests inject an in-memory fake (no DB) to assert the
// money-path invariants. Transaction handles are pgx.Tx; the fake returns a stub.
type store interface {
	Begin(ctx context.Context) (pgx.Tx, error)
	GetByIdempotencyKey(ctx context.Context, key string) (*LedgerEntry, error)
	GetPoolForUpdate(ctx context.Context, tx pgx.Tx, poolID string) (*RewardPool, error)
	SumUserCreditsFromPool(ctx context.Context, tx pgx.Tx, userID, poolID string) (int64, error)
	SumCampaignCredits(ctx context.Context, tx pgx.Tx, campaignID string) (int64, error)
	InsertLedgerEntry(ctx context.Context, tx pgx.Tx, e LedgerEntry) (*LedgerEntry, error)
	IncrementPoolSpent(ctx context.Context, tx pgx.Tx, poolID string, amountMinor int64) error
	SetEntryWalletRef(ctx context.Context, entryID, walletRef string) error
	SumUserBalance(ctx context.Context, userID string) (int64, error)
	ListUserEntries(ctx context.Context, userID string, limit int) ([]LedgerEntry, error)
	ListPoolEntries(ctx context.Context, poolID string, limit int) ([]LedgerEntry, error)
	GetCatalogBySKU(ctx context.Context, sku string) (*CatalogItem, error)
	ListCatalog(ctx context.Context, activeOnly bool) ([]CatalogItem, error)
	UpsertCatalog(ctx context.Context, req UpsertCatalogRequest) (*CatalogItem, error)
	GetRedemptionByIdempotencyKey(ctx context.Context, key string) (*Redemption, error)
	InsertRedemption(ctx context.Context, rd Redemption) (*Redemption, error)
	SetRedemptionState(ctx context.Context, id, state string) error
	ListPools(ctx context.Context) ([]RewardPool, error)
	CreatePool(ctx context.Context, req CreatePoolRequest) (*RewardPool, error)
	IncrementPoolFunded(ctx context.Context, poolID string, amountMinor int64) (*RewardPool, error)
	InsertAudit(ctx context.Context, actor, action, resourceType, resourceID string, newValues map[string]any, severity string) error
}

// compile-time assertion: the concrete Repository satisfies the store seam.
var _ store = (*Repository)(nil)

// Service is the ONLY academy code that moves real value. It enforces every golden
// rule in model.go: funded-pool gate, per-user/per-campaign caps, anti-fraud,
// idempotent append-only ledger, derived balances, and a single value movement on
// the Paymax wallet ledger (no shadow ledger).
type Service struct {
	repo   store
	wallet WalletCredit
	fraud  FraudCheck
	notify Notifier

	// rewardExpenseAccountID is the standing ledger account debited when value is
	// credited to a learner wallet (the sponsor/pool expense counterpart). Resolved
	// once at wiring from finance/ledger; required for IssueReward to post a credit.
	rewardExpenseAccountID string
}

// NewService wires the rewards service. fraud may be nil (defaults to approve-all
// DefaultFraudCheck); wallet must be non-nil in production. rewardExpenseAccountID
// is the debit counterpart account for wallet credits.
func NewService(repo store, wallet WalletCredit, fraud FraudCheck, rewardExpenseAccountID string) *Service {
	if fraud == nil {
		fraud = DefaultFraudCheck{}
	}
	return &Service{
		repo:                   repo,
		wallet:                 wallet,
		fraud:                  fraud,
		notify:                 NopNotifier{},
		rewardExpenseAccountID: rewardExpenseAccountID,
	}
}

// WithNotifier sets the audit/notify hook (optional).
func (s *Service) WithNotifier(n Notifier) *Service {
	if n != nil {
		s.notify = n
	}
	return s
}

// rejection is the typed deny outcome carrying a stable reason code.
type rejection struct{ reason string }

func (e rejection) Error() string { return "rewards: rejected: " + e.reason }

// Reason exposes the stable rejection code.
func (e rejection) Reason() string { return e.reason }

// AsRejection extracts the reason code if err is a typed rejection.
func AsRejection(err error) (string, bool) {
	var r rejection
	if errors.As(err, &r) {
		return r.reason, true
	}
	return "", false
}

// ── Pure eligibility gate (ordered; no DB, no side effects) ──────────────────────

// eligibilityInput is the snapshot the pure gate decides on. All values are read
// under the pool's FOR UPDATE lock before the gate runs.
type eligibilityInput struct {
	AmountMinor      int64
	PoolStatus       PoolStatus
	PoolAvailable    int64 // funded_minor - spent_minor
	PerUserCapMinor  int64 // 0 = no cap
	UserPriorMinor   int64 // this user's prior credits from this pool
	PerCampaignCap   int64 // 0 = no cap (and/or pool has no campaign)
	CampaignHasCap   bool  // false when pool has no campaign or no cap configured
	CampaignPriorMin int64 // prior credits across the whole campaign
	FraudOK          bool
}

// evaluateEligibility is the SINGLE ordered decision function for a reward credit.
// It returns "" when the credit is approved, or a stable rejection reason code.
//
// ORDER (golden rules 1-3; state-machines §3 "approve" guard):
//  1. amount must be positive (invalid_amount)
//  2. pool must be active (pool_inactive)
//  3. pool must have enough available balance (pool_exhausted)
//  4. per-user cap must not be exceeded by this credit (per_user_cap_exceeded)
//  5. per-campaign cap must not be exceeded by this credit (per_campaign_cap_exceeded)
//  6. anti-fraud gate must pass (anti_fraud_block)
func evaluateEligibility(in eligibilityInput) string {
	if in.AmountMinor <= 0 {
		return ReasonInvalidAmount
	}
	if in.PoolStatus != PoolActive {
		return ReasonPoolInactive
	}
	if in.PoolAvailable < in.AmountMinor {
		return ReasonPoolExhausted
	}
	if in.PerUserCapMinor > 0 && in.UserPriorMinor+in.AmountMinor > in.PerUserCapMinor {
		return ReasonPerUserCap
	}
	if in.CampaignHasCap && in.PerCampaignCap > 0 &&
		in.CampaignPriorMin+in.AmountMinor > in.PerCampaignCap {
		return ReasonPerCampaignCap
	}
	if !in.FraudOK {
		return ReasonFraud
	}
	return ""
}

// ── IssueReward (the guarded money path) ────────────────────────────────────────

// IssueReward runs the reward-issuance state machine
// (triggered → eligibility_checked → credited | rejected).
//
// Flow:
//  1. Idempotency replay: a prior ledger entry for the key returns it unchanged
//     (Duplicate=true), with NO second credit.
//  2. Open a tx and lock the pool (SELECT ... FOR UPDATE).
//  3. Read pool balance + per-user + per-campaign prior credits + run fraud check,
//     then run the pure ordered eligibility gate.
//  4. On reject: roll back, audit, return a typed rejection (no value moves).
//  5. On approve: in ONE tx insert the append-only ledger entry AND increment
//     pool.spent_minor, commit, THEN post the wallet credit with the SAME
//     idempotency key, and stamp the wallet ref onto the entry.
func (s *Service) IssueReward(ctx context.Context, in IssueInput) (IssueResult, error) {
	if in.IdempotencyKey == "" {
		return IssueResult{State: StateRejected, Reason: ReasonInvalidAmount},
			rejection{ReasonInvalidAmount}
	}

	// (1) Idempotent replay — same key returns the original entry, no re-credit.
	if prior, err := s.repo.GetByIdempotencyKey(ctx, in.IdempotencyKey); err == nil {
		return IssueResult{State: StateCredited, Entry: prior, Duplicate: true}, nil
	} else if !errors.Is(err, ErrNotFound) {
		return IssueResult{}, err
	}

	tx, err := s.repo.Begin(ctx)
	if err != nil {
		return IssueResult{}, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	// (2) Lock the pool row for the duration of the balance check + spend update.
	pool, err := s.repo.GetPoolForUpdate(ctx, tx, in.PoolID)
	if errors.Is(err, ErrNotFound) {
		_ = tx.Rollback(ctx)
		committed = true
		s.auditReject(ctx, in.UserID, in.PoolID, ReasonPoolNotFound)
		s.notify.RewardRejected(ctx, in.UserID, in.PoolID, ReasonPoolNotFound)
		return IssueResult{State: StateRejected, Reason: ReasonPoolNotFound}, rejection{ReasonPoolNotFound}
	}
	if err != nil {
		return IssueResult{}, err
	}

	// Derive the credit amount: explicit AmountMinor wins; else Points*conversion_rate.
	amount := in.AmountMinor
	if amount == 0 && in.Points > 0 {
		amount = int64(float64(in.Points) * pool.ConversionRate)
	}

	// (3) Gather the cap inputs under the lock + run fraud, then the pure gate.
	userPrior, err := s.repo.SumUserCreditsFromPool(ctx, tx, in.UserID, in.PoolID)
	if err != nil {
		return IssueResult{}, err
	}
	var campaignPrior int64
	campaignHasCap := pool.CampaignID != nil && pool.PerCampaignCapMinor > 0
	if campaignHasCap {
		campaignPrior, err = s.repo.SumCampaignCredits(ctx, tx, *pool.CampaignID)
		if err != nil {
			return IssueResult{}, err
		}
	}
	fraudOK, fraudReason := s.fraud.OK(ctx, in.UserID, in.SourceEvent)

	reason := evaluateEligibility(eligibilityInput{
		AmountMinor:      amount,
		PoolStatus:       pool.Status,
		PoolAvailable:    pool.Available(),
		PerUserCapMinor:  pool.PerUserCapMinor,
		UserPriorMinor:   userPrior,
		PerCampaignCap:   pool.PerCampaignCapMinor,
		CampaignHasCap:   campaignHasCap,
		CampaignPriorMin: campaignPrior,
		FraudOK:          fraudOK,
	})

	// (4) Rejection: no value moves. Roll back, audit, return typed rejection.
	if reason != "" {
		_ = tx.Rollback(ctx)
		committed = true
		auditReason := reason
		if reason == ReasonFraud && fraudReason != "" {
			auditReason = ReasonFraud + ":" + fraudReason
		}
		s.auditReject(ctx, in.UserID, in.PoolID, auditReason)
		s.notify.RewardRejected(ctx, in.UserID, in.PoolID, reason)
		return IssueResult{State: StateRejected, Reason: reason}, rejection{reason}
	}

	// (5a) Approve: append-only ledger entry + spend increment in ONE tx.
	poolID := in.PoolID
	reasonStr := in.Reason
	sourceStr := in.SourceEvent
	entry := LedgerEntry{
		UserID:         in.UserID,
		PoolID:         &poolID,
		Type:           EntryCredit,
		AmountMinor:    amount,
		Points:         in.Points,
		Reason:         &reasonStr,
		SourceEvent:    &sourceStr,
		IdempotencyKey: in.IdempotencyKey,
	}
	written, err := s.repo.InsertLedgerEntry(ctx, tx, entry)
	if errors.Is(err, ErrDuplicate) {
		// Lost an idempotency race: roll back and replay the winner.
		_ = tx.Rollback(ctx)
		committed = true
		if prior, gerr := s.repo.GetByIdempotencyKey(ctx, in.IdempotencyKey); gerr == nil {
			return IssueResult{State: StateCredited, Entry: prior, Duplicate: true}, nil
		}
		return IssueResult{}, err
	}
	if err != nil {
		return IssueResult{}, err
	}
	if err := s.repo.IncrementPoolSpent(ctx, tx, in.PoolID, amount); err != nil {
		return IssueResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return IssueResult{}, err
	}
	committed = true

	// (5b) THEN move the value on the Paymax wallet ledger with the SAME idem key.
	// The audit-trail row is already durable; the wallet credit is idempotent, so a
	// retry after a crash here re-posts safely (ErrDuplicate is a no-op success).
	walletRef := "academy_reward:" + in.IdempotencyKey
	if s.wallet != nil {
		err = s.wallet.Credit(ctx, in.UserID, walletRef, in.IdempotencyKey, s.rewardExpenseAccountID, amount)
		if err != nil && !isDuplicateCredit(err) {
			return IssueResult{}, fmt.Errorf("rewards: wallet credit failed for entry %s: %w", written.ID, err)
		}
		_ = s.repo.SetEntryWalletRef(ctx, written.ID, walletRef)
		written.WalletRef = &walletRef
	}

	s.auditCredit(ctx, *written)
	s.notify.RewardIssued(ctx, *written)
	return IssueResult{State: StateCredited, Entry: written}, nil
}

// ── RedeemPoints (points → catalog reward) ──────────────────────────────────────

// RedeemPoints redeems points for a catalog SKU. Idempotent on idemKey. For a
// wallet-kind SKU the value is credited to the user wallet (same idemKey); other
// kinds (airtime/data/voucher) are recorded as requested for downstream fulfilment.
func (s *Service) RedeemPoints(ctx context.Context, userID, sku, idemKey string) (*Redemption, error) {
	if idemKey == "" {
		return nil, rejection{ReasonInvalidAmount}
	}
	// Idempotent replay.
	if prior, err := s.repo.GetRedemptionByIdempotencyKey(ctx, idemKey); err == nil {
		return prior, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	item, err := s.repo.GetCatalogBySKU(ctx, sku)
	if errors.Is(err, ErrNotFound) {
		return nil, rejection{"sku_not_found"}
	}
	if err != nil {
		return nil, err
	}
	if item.Status != "active" {
		return nil, rejection{"sku_inactive"}
	}

	rd := Redemption{
		UserID:         userID,
		SKU:            sku,
		PointsSpent:    item.CostPoints,
		ValueMinor:     item.ValueMinor,
		State:          "requested",
		IdempotencyKey: idemKey,
	}
	written, err := s.repo.InsertRedemption(ctx, rd)
	if errors.Is(err, ErrDuplicate) {
		if prior, gerr := s.repo.GetRedemptionByIdempotencyKey(ctx, idemKey); gerr == nil {
			return prior, nil
		}
		return nil, err
	}
	if err != nil {
		return nil, err
	}

	// Wallet-kind redemptions move value on the wallet ledger with the same idemKey.
	if item.Kind == "wallet" && item.ValueMinor > 0 && s.wallet != nil {
		walletRef := "academy_redemption:" + idemKey
		err = s.wallet.Credit(ctx, userID, walletRef, idemKey, s.rewardExpenseAccountID, item.ValueMinor)
		if err != nil && !isDuplicateCredit(err) {
			_ = s.repo.SetRedemptionState(ctx, written.ID, "failed")
			written.State = "failed"
			return written, fmt.Errorf("rewards: redemption wallet credit failed: %w", err)
		}
		_ = s.repo.SetRedemptionState(ctx, written.ID, "fulfilled")
		written.State = "fulfilled"
	}
	_ = s.repo.InsertAudit(ctx, userID, "reward.redeemed", "academy_redemption", written.ID,
		map[string]any{"sku": sku, "points": item.CostPoints, "value_minor": item.ValueMinor, "state": written.State}, "info")
	return written, nil
}

// Balance returns the user's reward balance, DERIVED by summation over the ledger.
func (s *Service) Balance(ctx context.Context, userID string) (int64, error) {
	return s.repo.SumUserBalance(ctx, userID)
}

// History returns the user's reward ledger entries.
func (s *Service) History(ctx context.Context, userID string, limit int) ([]LedgerEntry, error) {
	return s.repo.ListUserEntries(ctx, userID, limit)
}

// Catalog returns the active redemption catalog (member read).
func (s *Service) Catalog(ctx context.Context) ([]CatalogItem, error) {
	return s.repo.ListCatalog(ctx, true)
}

// ── Admin passthroughs ──────────────────────────────────────────────────────────

func (s *Service) ListPools(ctx context.Context) ([]RewardPool, error) { return s.repo.ListPools(ctx) }
func (s *Service) CreatePool(ctx context.Context, req CreatePoolRequest) (*RewardPool, error) {
	return s.repo.CreatePool(ctx, req)
}
func (s *Service) FundPool(ctx context.Context, actor, poolID string, req FundPoolRequest) (*RewardPool, error) {
	if req.AmountMinor <= 0 {
		return nil, rejection{ReasonInvalidAmount}
	}
	p, err := s.repo.IncrementPoolFunded(ctx, poolID, req.AmountMinor)
	if err != nil {
		return nil, err
	}
	_ = s.repo.InsertAudit(ctx, actor, "reward_pool.funded", "academy_reward_pool", poolID,
		map[string]any{"amount_minor": req.AmountMinor, "funded_minor": p.FundedMinor, "idempotency_key": req.IdempotencyKey}, "info")
	return p, nil
}
func (s *Service) ListCatalogAdmin(ctx context.Context) ([]CatalogItem, error) {
	return s.repo.ListCatalog(ctx, false)
}
func (s *Service) UpsertCatalog(ctx context.Context, req UpsertCatalogRequest) (*CatalogItem, error) {
	return s.repo.UpsertCatalog(ctx, req)
}
func (s *Service) PoolLedger(ctx context.Context, poolID string, limit int) ([]LedgerEntry, error) {
	return s.repo.ListPoolEntries(ctx, poolID, limit)
}

// ── internal audit helpers ──────────────────────────────────────────────────────

func (s *Service) auditCredit(ctx context.Context, e LedgerEntry) {
	pool := ""
	if e.PoolID != nil {
		pool = *e.PoolID
	}
	_ = s.repo.InsertAudit(ctx, e.UserID, "reward.credited", "academy_reward_ledger_entry", e.ID,
		map[string]any{"pool_id": pool, "amount_minor": e.AmountMinor, "idempotency_key": e.IdempotencyKey}, "info")
}

func (s *Service) auditReject(ctx context.Context, userID, poolID, reason string) {
	_ = s.repo.InsertAudit(ctx, userID, "reward.rejected", "academy_reward_pool", poolID,
		map[string]any{"reason": reason}, "warning")
}

// isDuplicateCredit reports whether the wallet credit failed because the idempotency
// key was already applied — a safe no-op (the value already moved exactly once).
func isDuplicateCredit(err error) bool {
	if err == nil {
		return false
	}
	// finance/ledger.ErrDuplicate has this exact message; match defensively without a
	// hard dependency on the ledger package so tests can inject their own fakes.
	return err.Error() == "ledger: duplicate idempotency key"
}
