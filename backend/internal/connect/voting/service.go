package connectvoting

import (
	"context"
	"errors"
	"time"
)

// WalletDebiter debits the voter's wallet and credits the given standing account
// (paymax_revenue) — a balanced double-entry, tier-checked fail-closed, keyed by
// idempotencyKey. Implemented by internal/finance/wallet.Service.Debit. We never
// touch the ledger here.
type WalletDebiter interface {
	Debit(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error
}

// RevenueAccountResolver returns the standing paymax_revenue account id to credit
// for paid-vote revenue. Implemented by the ledger service.
type RevenueAccountResolver interface {
	RevenueAccountID(ctx context.Context) (string, error)
}

// Auditor writes an immutable audit entry (connect_audit_log).
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// SolicitationFlagger reports paid votes to AML monitoring (best-effort).
type SolicitationFlagger interface {
	FlagPaidVote(ctx context.Context, voterID string, amountKobo int64, ref string) error
}

// Sentinel errors.
var (
	ErrMissingIdem     = errors.New("connect: Idempotency-Key required")
	ErrInvalidAmount   = errors.New("connect: amount must be positive kobo")
	ErrContestClosed   = errors.New("connect: contest is not open for voting")
	ErrFreeVoteUsed    = errors.New("connect: free vote already used for this contest")
	ErrVelocity        = errors.New("connect: voting too fast — slow down")
	ErrNotFound        = errors.New("connect: contest not found")
	ErrPaidUnavailable = errors.New("connect: paid voting not enabled for this contest")
	ErrInvalidQuantity = errors.New("connect: quantity must be a positive integer")
)

// Service orchestrates free polls and paid voting. It owns NO balance state —
// paid-vote money movement is delegated to the wallet (ledger); votes are
// immutable projections recorded after the integrity checks (and, for paid
// votes, after a successful idempotent debit).
type Service struct {
	repo         *Repository
	wallet       WalletDebiter
	revenue      RevenueAccountResolver
	audit        Auditor
	solicitation SolicitationFlagger
}

// NewService builds the voting service. solicitation may be nil.
func NewService(repo *Repository, wallet WalletDebiter, revenue RevenueAccountResolver, audit Auditor, solicitation SolicitationFlagger) *Service {
	return &Service{repo: repo, wallet: wallet, revenue: revenue, audit: audit, solicitation: solicitation}
}

// ListContests returns open/closed contests.
func (s *Service) ListContests(ctx context.Context, limit int) ([]Contest, error) {
	return s.repo.ListContests(ctx, limit)
}

// GetContest returns one contest.
func (s *Service) GetContest(ctx context.Context, id string) (*Contest, error) {
	c, err := s.repo.GetContest(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	return c, nil
}

// Results returns the live tally for a contest.
func (s *Service) Results(ctx context.Context, contestID string) ([]ResultRow, error) {
	return s.repo.Results(ctx, contestID)
}

// votingOpen reports whether a contest currently accepts votes.
func votingOpen(c *Contest, now time.Time) bool {
	if c.Status != "open" {
		return false
	}
	if c.OpensAt != nil && now.Before(*c.OpensAt) {
		return false
	}
	if c.ClosesAt != nil && now.After(*c.ClosesAt) {
		return false
	}
	return true
}

// enforceVelocity blocks bursts that exceed the contest's per-minute cap.
func (s *Service) enforceVelocity(ctx context.Context, c *Contest, voterID string, now time.Time) error {
	if c.VelocityPerMinute <= 0 {
		return nil
	}
	recent, err := s.repo.CountRecentVotes(ctx, c.ID, voterID, now.Add(-time.Minute))
	if err != nil {
		// Fail closed: if we cannot verify velocity, block.
		return ErrVelocity
	}
	if recent >= c.VelocityPerMinute {
		return ErrVelocity
	}
	return nil
}

// FreeVote casts a single free poll vote with integrity guards: contest must be
// open, the user must not have exceeded the free-vote allowance, and the
// per-minute velocity cap is enforced. No money moves.
func (s *Service) FreeVote(ctx context.Context, contestID, voterID string, req FreeVoteRequest) (*Vote, error) {
	c, err := s.repo.GetContest(ctx, contestID)
	if err != nil {
		return nil, ErrNotFound
	}
	now := time.Now().UTC()
	if !votingOpen(c, now) {
		return nil, ErrContestClosed
	}

	allowance := c.FreeVotesPerUser
	if allowance <= 0 {
		allowance = 1 // default one free vote per user per contest
	}
	used, err := s.repo.CountFreeVotes(ctx, contestID, voterID)
	if err != nil {
		return nil, ErrFreeVoteUsed // fail closed
	}
	if used >= allowance {
		return nil, ErrFreeVoteUsed
	}
	if err := s.enforceVelocity(ctx, c, voterID, now); err != nil {
		return nil, err
	}

	v, err := s.repo.InsertVote(ctx, &Vote{
		ContestID:  contestID,
		VoterID:    voterID,
		OptionRef:  req.OptionRef,
		Paid:       false,
		Quantity:   1,
		AmountKobo: 0,
	})
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.vote.free", voterID, "connect_vote", v.ID, map[string]any{
		"contest_id": contestID, "option_ref": req.OptionRef,
	})
	return v, nil
}

// PaidVote is the money path: it charges the voter's wallet for `quantity` paid
// vote units (price-per-unit from the contest) and records the votes.
//
// Ordering (correctness > convenience):
//  1. validate input + load contest; paid voting must be enabled and open;
//  2. require an Idempotency-Key;
//  3. resolve total = price_per_unit * quantity SERVER-SIDE;
//  4. velocity guard;
//  5. debit the wallet (tier-checked fail-closed, balanced double-entry,
//     idempotent — a retry is a safe no-op via the ledger unique constraint);
//  6. record the immutable paid vote;
//  7. emit an audit event + fire the AML hook.
func (s *Service) PaidVote(ctx context.Context, contestID, voterID, idemKey string, req PaidVoteRequest) (*Vote, error) {
	if idemKey == "" {
		return nil, ErrMissingIdem
	}
	c, err := s.repo.GetContest(ctx, contestID)
	if err != nil {
		return nil, ErrNotFound
	}
	now := time.Now().UTC()
	if !votingOpen(c, now) {
		return nil, ErrContestClosed
	}
	if c.PaidVoteKobo <= 0 {
		return nil, ErrPaidUnavailable
	}

	qty := req.Quantity
	if qty == 0 {
		qty = 1
	}
	if qty < 0 {
		return nil, ErrInvalidQuantity
	}
	totalKobo := c.PaidVoteKobo * int64(qty)
	if totalKobo <= 0 {
		return nil, ErrInvalidAmount
	}

	if err := s.enforceVelocity(ctx, c, voterID, now); err != nil {
		return nil, err
	}

	revAcc, err := s.revenue.RevenueAccountID(ctx)
	if err != nil {
		return nil, err
	}
	ref := "connect:paidvote:" + contestID
	// Money mutation — tier-checked, balanced double-entry, idempotent.
	if err := s.wallet.Debit(ctx, voterID, ref, idemKey, revAcc, totalKobo); err != nil {
		return nil, err
	}

	v, err := s.repo.InsertVote(ctx, &Vote{
		ContestID:      contestID,
		VoterID:        voterID,
		OptionRef:      req.OptionRef,
		Paid:           true,
		Quantity:       qty,
		AmountKobo:     totalKobo,
		IdempotencyKey: &idemKey,
		LedgerRef:      &ref,
	})
	if err != nil {
		// Debit succeeded but projection failed: surface loudly for reconciliation.
		return nil, err
	}

	_ = s.audit.WriteAudit(ctx, "connect.vote.paid", voterID, "connect_vote", v.ID, map[string]any{
		"contest_id": contestID, "option_ref": req.OptionRef, "quantity": qty,
		"amount_kobo": totalKobo, "idempotency_key": idemKey, "ledger_ref": ref,
	})
	if s.solicitation != nil {
		_ = s.solicitation.FlagPaidVote(ctx, voterID, totalKobo, ref)
	}
	return v, nil
}
