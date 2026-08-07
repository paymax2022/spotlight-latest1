package tutor

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// tutorStore is the data-access surface the Service depends on. *Repository is the
// production implementation; tests inject a pure in-memory fake. Keeping this an
// interface lets the KYC-gate, payout-idempotency, and balance-derivation behaviours be
// exercised without a DB.
type tutorStore interface {
	InsertTutor(ctx context.Context, userID, bio string, subjects []string) (*Tutor, error)
	GetTutor(ctx context.Context, id string) (*Tutor, error)
	GetTutorByUser(ctx context.Context, userID string) (*Tutor, error)
	ListTutors(ctx context.Context, subject string) ([]Tutor, error)
	SetTutorStatus(ctx context.Context, actor, tutorID string, to TutorStatus, kycState string, detail map[string]any) (*Tutor, error)

	InsertAssignment(ctx context.Context, actor string, a Assignment) (*Assignment, error)
	ListAssignmentsByTutor(ctx context.Context, tutorID string) ([]Assignment, error)

	GradeAssignment(ctx context.Context, actor, assignmentID, learnerID string, score *float64, feedback string, tutorID string, earnMinor int64) (*Grade, *Earning, error)

	AppendEarning(ctx context.Context, actor, tutorID, source, refID string, amountMinor int64) (*Earning, error)
	SumPending(ctx context.Context, tutorID string) (int64, error)
	ListEarnings(ctx context.Context, tutorID string) ([]Earning, error)

	FindPayoutByIdem(ctx context.Context, idemKey string) (*Payout, error)
	InsertPayoutRequested(ctx context.Context, actor, tutorID, idemKey string, amountMinor int64) (*Payout, bool, error)
	SettlePayout(ctx context.Context, actor, payoutID string, to PayoutState, payoutRef string, amountMinor int64, tutorID string) (*Payout, error)
	ListPayouts(ctx context.Context, tutorID string) ([]Payout, error)
}

// Compile-time assertion: *Repository satisfies tutorStore (production implementation).
var _ tutorStore = (*Repository)(nil)

// Service is the Spotlight Academy tutor-marketplace domain. It owns the GUARDED payout
// state machine (requested→paid|failed), the KYC gate on tutor verification, and the
// append-only earnings ledger whose withdrawable balance is DERIVED via SUM(pending).
// The actual value movement is delegated to the INJECTED PayoutRail (no vendor leak);
// KYC tier is read from the EXISTING finance/kyc flow via the injected KYCChecker. Every
// mutating path is audit-logged (module 'academy.tutor').
type Service struct {
	repo   tutorStore
	kyc    KYCChecker
	payout PayoutRail
	// reader is the concrete pgx repository, used ONLY by the additive reads that need
	// queries beyond the tutorStore contract (admin list-all-tutors, owner-scoped cohorts
	// and submissions). nil in the unit-test seam (which injects a fake tutorStore and
	// never exercises those reads).
	reader *Repository
}

// NewService wires the tutor service. nil deps fall back to deterministic dev stubs so
// the package runs end-to-end without KYC/payout adapters bound (nil kyc → allow at
// tier 1; nil payout → instant deterministic stub).
func NewService(db *pgxpool.Pool, kyc KYCChecker, payout PayoutRail) *Service {
	if kyc == nil {
		kyc = stubKYCChecker{}
	}
	if payout == nil {
		payout = stubPayoutRail{}
	}
	repo := NewRepository(db)
	return &Service{repo: repo, kyc: kyc, payout: payout, reader: repo}
}

// MinVerifyTier is the minimum KYC tier required to verify a tutor (screens.md T1).
const MinVerifyTier = 1

// Sentinel errors mapped to stable snake_case codes / HTTP statuses by the handler.
// (ErrNotFound is declared in repository.go.)
var (
	ErrIllegalTransition   = errors.New("illegal_transition")
	ErrIdempotencyRequired = errors.New("idempotency_key_required")
	ErrInvalidInput        = errors.New("invalid_input")
	ErrInvalidAmount       = errors.New("invalid_amount")
	ErrKYCNotMet           = errors.New("kyc_tier_not_met")
	ErrInsufficientBalance = errors.New("insufficient_balance")
)

// ── Onboard / verify / vetting ────────────────────────────────────────────────────

// OnboardTutor onboards the caller as a tutor in status 'pending'. Idempotent on the
// user (academy_tutors.user_id is UNIQUE): a re-onboard updates bio/subjects and returns
// the existing tutor. Audited.
func (s *Service) OnboardTutor(ctx context.Context, userID, bio string, subjects []string) (*Tutor, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.InsertTutor(ctx, userID, bio, subjects)
}

// VerifyTutor (admin vetting) flips a tutor pending→verified ONLY when the KYCChecker
// reports tier >= MinVerifyTier (fail-closed: any error or sub-tier rejects + audits).
// On success kyc_state is recorded as 'verified'. Reuses the EXISTING finance/kyc flow.
func (s *Service) VerifyTutor(ctx context.Context, adminID, tutorID string) (*Tutor, error) {
	if tutorID == "" {
		return nil, ErrInvalidInput
	}
	t, err := s.repo.GetTutor(ctx, tutorID)
	if err != nil {
		return nil, err
	}

	// KYC GATE — fail-closed: tier read error OR tier < min rejects the verification.
	tier, kerr := s.kyc.Tier(ctx, t.UserID)
	if kerr != nil || tier < MinVerifyTier {
		// Record the rejection (does not flip status). Best-effort, non-fatal audit.
		_, _ = s.repo.SetTutorStatus(ctx, adminID, tutorID, t.Status, "rejected",
			map[string]any{"reason": "kyc_tier_not_met", "tier": tier})
		return nil, ErrKYCNotMet
	}

	return s.repo.SetTutorStatus(ctx, adminID, tutorID, TutorVerified, "verified",
		map[string]any{"tier": tier})
}

// SuspendTutor (admin vetting) flips a tutor to suspended. Audited.
func (s *Service) SuspendTutor(ctx context.Context, adminID, tutorID string) (*Tutor, error) {
	if tutorID == "" {
		return nil, ErrInvalidInput
	}
	if _, err := s.repo.GetTutor(ctx, tutorID); err != nil {
		return nil, err
	}
	return s.repo.SetTutorStatus(ctx, adminID, tutorID, TutorSuspended, "", nil)
}

// ── Reads ────────────────────────────────────────────────────────────────────────

// ListTutors returns verified tutors, optionally filtered by subject (public).
func (s *Service) ListTutors(ctx context.Context, subject string) ([]Tutor, error) {
	return s.repo.ListTutors(ctx, subject)
}

func (s *Service) GetTutor(ctx context.Context, id string) (*Tutor, error) {
	if id == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.GetTutor(ctx, id)
}

// GetMyTutor resolves the caller's tutor profile.
func (s *Service) GetMyTutor(ctx context.Context, userID string) (*Tutor, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.GetTutorByUser(ctx, userID)
}

// AdminListTutors lists ALL tutors regardless of status (admin oversight read).
func (s *Service) AdminListTutors(ctx context.Context) ([]Tutor, error) {
	return s.reader.ListAllTutors(ctx)
}

// ListMyCohorts lists the class groups the caller (a tutor) teaches (owner-scoped,
// derived from their assignments).
func (s *Service) ListMyCohorts(ctx context.Context, userID string) ([]Cohort, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	t, err := s.repo.GetTutorByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.reader.ListCohortsByTutor(ctx, t.ID)
}

// ListMyAssignments lists the caller's OWN assignments (owner-scoped). Reuses the
// existing ListAssignmentsByTutor read after resolving the caller's tutor profile.
func (s *Service) ListMyAssignments(ctx context.Context, userID string) ([]Assignment, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	t, err := s.repo.GetTutorByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.repo.ListAssignmentsByTutor(ctx, t.ID)
}

// ListMySubmissions lists the graded submissions across the caller's OWN assignments
// (owner-scoped).
func (s *Service) ListMySubmissions(ctx context.Context, userID string) ([]Grade, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	t, err := s.repo.GetTutorByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.reader.ListGradesByTutor(ctx, t.ID)
}

// ── Assignments / grading ──────────────────────────────────────────────────────────

// Assign creates an assignment for the caller's tutor profile targeting a class group
// and/or a single learner. Audited.
func (s *Service) Assign(ctx context.Context, userID, classGroupID, learnerID, kind, title, contentRef string, dueAt *time.Time) (*Assignment, error) {
	if userID == "" || title == "" {
		return nil, ErrInvalidInput
	}
	if classGroupID == "" && learnerID == "" {
		return nil, ErrInvalidInput
	}
	t, err := s.repo.GetTutorByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	a := Assignment{
		TutorID:      t.ID,
		ClassGroupID: ptrOrNil(classGroupID),
		LearnerID:    ptrOrNil(learnerID),
		Kind:         kind,
		Title:        title,
		ContentRef:   ptrOrNil(contentRef),
		DueAt:        dueAt,
	}
	return s.repo.InsertAssignment(ctx, userID, a)
}

// Grade marks a learner's assignment work graded (with score + feedback) and, when
// earnMinor > 0, accrues an assignment earning for the tutor in the SAME transaction.
// Audited.
func (s *Service) Grade(ctx context.Context, userID, assignmentID, learnerID string, score *float64, feedback string, earnMinor int64) (*Grade, *Earning, error) {
	if userID == "" || assignmentID == "" || learnerID == "" {
		return nil, nil, ErrInvalidInput
	}
	if earnMinor < 0 {
		return nil, nil, ErrInvalidAmount
	}
	t, err := s.repo.GetTutorByUser(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	return s.repo.GradeAssignment(ctx, userID, assignmentID, learnerID, score, feedback, t.ID, earnMinor)
}

// ── Earnings ───────────────────────────────────────────────────────────────────────

// AccrueEarning APPENDS a pending earning for a tutor (consult / class / assignment).
// Append-only: never mutates an existing entry. Audited.
func (s *Service) AccrueEarning(ctx context.Context, actorID, tutorID, source, refID string, amountMinor int64) (*Earning, error) {
	if tutorID == "" {
		return nil, ErrInvalidInput
	}
	if amountMinor <= 0 {
		return nil, ErrInvalidAmount
	}
	switch source {
	case SourceConsult, SourceClass, SourceAssignment:
	default:
		return nil, ErrInvalidInput
	}
	return s.repo.AppendEarning(ctx, actorID, tutorID, source, refID, amountMinor)
}

// EarningsBalance returns the DERIVED withdrawable balance for a tutor: SUM(amount_minor)
// over pending earnings (never a stored shadow balance).
func (s *Service) EarningsBalance(ctx context.Context, tutorID string) (int64, error) {
	if tutorID == "" {
		return 0, ErrInvalidInput
	}
	return s.repo.SumPending(ctx, tutorID)
}

// GetMyEarnings is the member earnings dashboard: append-only entries, the DERIVED
// pending balance, and the payout history.
func (s *Service) GetMyEarnings(ctx context.Context, userID string) (*Earnings, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	t, err := s.repo.GetTutorByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	entries, err := s.repo.ListEarnings(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	pending, err := s.repo.SumPending(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	payouts, err := s.repo.ListPayouts(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	return &Earnings{Entries: entries, PendingMinor: pending, Payouts: payouts}, nil
}

// ── Payouts (guarded SM; idempotent; money via rail) ──────────────────────────────

// RequestPayout withdraws funds from the tutor's DERIVED pending balance via the injected
// PayoutRail. It honours the money rules:
//  1. requires an Idempotency-Key (idempotent: a replay returns the SAME payout, ONE rail call);
//  2. validates the amount (positive minor units);
//  3. checks the DERIVED pending balance >= amount (no shadow balance);
//  4. creates the payout 'requested';
//  5. calls PayoutRail.Payout → requested→paid (covered pending earnings flip to 'paid'
//     in the SAME logical op), or on rail error → requested→failed;
//  6. every step is audited.
func (s *Service) RequestPayout(ctx context.Context, tutorUserID string, amountMinor int64, idemKey string) (*PayoutResult, error) {
	// (1) Idempotency-Key required.
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	// (2) Amount guard.
	if amountMinor <= 0 {
		return nil, ErrInvalidAmount
	}
	if tutorUserID == "" {
		return nil, ErrInvalidInput
	}

	// (1) Replay: a prior payout for this key short-circuits with NO second rail call.
	if prior, err := s.repo.FindPayoutByIdem(ctx, idemKey); err == nil {
		return &PayoutResult{Payout: prior, Ref: derefStr(prior.PayoutRef), Replayed: true}, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	t, err := s.repo.GetTutorByUser(ctx, tutorUserID)
	if err != nil {
		return nil, err
	}

	// (3) DERIVED balance check — SUM(pending) must cover the requested amount.
	pending, err := s.repo.SumPending(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	if pending < amountMinor {
		return nil, ErrInsufficientBalance
	}

	// (4) Create the payout REQUEST row (state='requested') + audit, atomically.
	payout, inserted, err := s.repo.InsertPayoutRequested(ctx, tutorUserID, t.ID, idemKey, amountMinor)
	if err != nil {
		return nil, err
	}
	if !inserted {
		// Lost the idem race with a concurrent request → return the durable winner (one rail call).
		if winner, ferr := s.repo.FindPayoutByIdem(ctx, idemKey); ferr == nil {
			return &PayoutResult{Payout: winner, Ref: derefStr(winner.PayoutRef), Replayed: true}, nil
		}
		return nil, err
	}

	// (5) Call the PayoutRail (idempotent on idemKey). On error, drive requested→failed.
	ref, perr := s.payout.Payout(ctx, tutorUserID, payout.ID, idemKey, amountMinor)
	if perr != nil {
		failed, ferr := s.repo.SettlePayout(ctx, tutorUserID, payout.ID, PayoutFailed, "", amountMinor, t.ID)
		if ferr != nil {
			return nil, ferr
		}
		return &PayoutResult{Payout: failed, Replayed: false}, perr
	}

	// (5) Rail confirmed → requested→paid; covered pending earnings flip to 'paid'.
	paid, err := s.repo.SettlePayout(ctx, tutorUserID, payout.ID, PayoutPaid, ref, amountMinor, t.ID)
	if err != nil {
		return nil, err
	}
	return &PayoutResult{Payout: paid, Ref: ref, Replayed: false}, nil
}

// ── Admin ──────────────────────────────────────────────────────────────────────────

// ListPayouts (admin) lists all payouts, optionally for one tutor.
func (s *Service) ListPayouts(ctx context.Context, tutorID string) ([]Payout, error) {
	return s.repo.ListPayouts(ctx, tutorID)
}

// ── helpers ──────────────────────────────────────────────────────────────────────

func ptrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	v := s
	return &v
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
