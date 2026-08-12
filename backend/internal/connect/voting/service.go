package connectvoting

import (
	"context"
	"errors"
	"log"
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

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module (§ profit registry). app-wiring injects a thin adapter over the finance
// commission service; when the commission feature is off (or no recorder is wired)
// the field is nil and recording is a silent no-op. Modeled as a LOCAL interface so
// voting never imports the commission package at compile time (mirrors the
// WalletDebiter / RevenueAccountResolver seams) — the adapter, which lives in
// app-wiring, discards the returned earning row and surfaces only the error.
//
// This records realized profit ONLY; it never moves money. The paid-vote debit
// above already posts the balanced double-entry into paymax_revenue, so the injected
// recorder is deliberately constructed WITHOUT a ledger — RecordFor never re-posts to
// the ledger (no double count of the revenue account); it appends the immutable
// earning row used by profit reports.
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
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
	commission   CommissionRecorder // optional; nil ⇒ realized-profit recording is a no-op
}

// NewService builds the voting service. solicitation may be nil.
func NewService(repo *Repository, wallet WalletDebiter, revenue RevenueAccountResolver, audit Auditor, solicitation SolicitationFlagger) *Service {
	return &Service{repo: repo, wallet: wallet, revenue: revenue, audit: audit, solicitation: solicitation}
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *Service) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// recordCommissionSafe records realized Spotlight profit for a settled paid vote.
// It is best-effort and MUST NEVER affect the caller's outcome: a nil recorder is a
// no-op, and any error is logged and swallowed so a profit-registry failure can never
// fail or reverse the paid vote. The recorded breakdown is resolved server-side from
// the central rate card; the vote id doubles as the source ref + idempotency key so
// retries / reconciliation never double-count.
func (s *Service) recordCommissionSafe(ctx context.Context, category, service, subtype string, grossKobo int64,
	sourceRef string, userID *string) {
	if s.commission == nil || grossKobo <= 0 {
		return
	}
	if err := s.commission.RecordFor(ctx, category, service, subtype, grossKobo,
		"connect-voting", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[connect-voting] commission record (source=%s gross=%d) failed, continuing: %v", sourceRef, grossKobo, err)
	}
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

// GetStages retrieves all stages for a contest.
func (s *Service) GetStages(ctx context.Context, contestID string) ([]ContestStage, error) {
	return s.repo.GetStages(ctx, contestID)
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
// ErrNotOnRoster is returned when a vote targets something that is not an
// active contestant of a contest that HAS a roster.
var ErrNotOnRoster = errors.New("voting: option is not an active contestant in this contest")

// checkRosterTarget validates the vote target against the contest's roster.
//
// Contests without a roster are plain polls whose option_ref is a free-form
// label, so they are left alone. Once a contest has contestants, though, an
// arbitrary option_ref would create a tally row no roster entry can account
// for — a phantom candidate accumulating real votes. Fail-closed: a lookup
// error rejects the vote rather than admitting an unverifiable target.
func (s *Service) checkRosterTarget(ctx context.Context, contestID, optionRef string) error {
	roster, err := s.repo.ListRoster(ctx, contestID, true)
	if err != nil {
		return err
	}
	if len(roster) == 0 {
		return nil // poll-style contest, no roster to enforce
	}
	ok, err := s.repo.IsOnRoster(ctx, contestID, optionRef)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotOnRoster
	}
	return nil
}

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
	if err := s.checkRosterTarget(ctx, contestID, req.OptionRef); err != nil {
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

	// Validate the target BEFORE any money moves: a debit for a vote that then
	// fails validation would have to be reversed.
	if err := s.checkRosterTarget(ctx, contestID, req.OptionRef); err != nil {
		return nil, err
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

	// Record realized Spotlight profit into the central Commission & Profit registry.
	// This is the paid-vote settlement point (money has moved: the wallet debit above
	// posted the balanced double-entry into paymax_revenue and the immutable vote row
	// is persisted). Best-effort + idempotent: the vote id doubles as source ref +
	// idempotency key, so retries never double-count. gross = the full amount the voter
	// paid (price_per_unit × quantity). A recorder failure is logged and swallowed — it
	// must NEVER fail or reverse the paid vote (voting's own debit already posted the
	// revenue to the ledger; this appends the earning row only).
	s.recordCommissionSafe(ctx, "Contest", "Voting", "", totalKobo, v.ID, &voterID)
	return v, nil
}

// ListRoster returns a contest's active contestants ranked by total votes.
func (s *Service) ListRoster(ctx context.Context, contestID string, includeInactive bool) ([]RosterEntry, error) {
	if _, err := s.repo.GetContest(ctx, contestID); err != nil {
		return nil, ErrNotFound
	}
	return s.repo.ListRoster(ctx, contestID, includeInactive)
}

// FreeVoteAllowance reports how many free votes a user has left in a contest.
// Returned alongside a cast vote so the client never has to guess the remaining
// count (or read it from a different voting plane that may disagree).
type FreeVoteAllowance struct {
	Total     int `json:"total"`
	Used      int `json:"used"`
	Remaining int `json:"remaining"`
}

// FreeVoteAllowanceFor computes the caller's remaining free-vote allowance.
func (s *Service) FreeVoteAllowanceFor(ctx context.Context, contestID, voterID string) (FreeVoteAllowance, error) {
	c, err := s.repo.GetContest(ctx, contestID)
	if err != nil {
		return FreeVoteAllowance{}, ErrNotFound
	}
	total := c.FreeVotesPerUser
	if total <= 0 {
		total = 1
	}
	used, err := s.repo.CountFreeVotes(ctx, contestID, voterID)
	if err != nil {
		return FreeVoteAllowance{}, err
	}
	remaining := total - used
	if remaining < 0 {
		remaining = 0
	}
	return FreeVoteAllowance{Total: total, Used: used, Remaining: remaining}, nil
}

// GetContestant returns one contestant with its live tally and rank, or
// ErrNotFound when no such contestant exists.
func (s *Service) GetContestant(ctx context.Context, contestantID string) (*RosterEntry, error) {
	e, err := s.repo.GetRosterEntry(ctx, contestantID)
	if err != nil {
		return nil, err
	}
	if e == nil {
		return nil, ErrNotFound
	}
	return e, nil
}
