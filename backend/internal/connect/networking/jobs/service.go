package connectjobs

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"
)

// ── Narrow local dependency ports (mirror connect/monetization) ─────────────
// Each is the minimal slice of a shared service this package needs. The real
// implementations (finance wallet/ledger, loyalty, connect safety audit) are wired
// by the orchestrator in Register's caller; this package never imports them.

// WalletDebiter is the finance wallet slice: it enforces the tier limit fail-closed
// and posts a BALANCED double-entry (DR user_wallet → CR the given account), keyed by
// idempotencyKey. Implemented by finance/wallet.Service.Debit.
type WalletDebiter interface {
	Debit(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error
}

// LedgerCrediter is the finance ledger slice for the bounty payout: it posts a CREDIT
// to the referrer's wallet (money in) with the counterpart debit to debitAccountID,
// keyed idempotently by idempotencyKey. Implemented by finance/ledger.Service.Credit.
type LedgerCrediter interface {
	Credit(ctx context.Context, userID, reference, idempotencyKey, debitAccountID string, amountKobo int64) error
}

// RevenueResolver resolves the standing ledger accounts this module posts against.
// Implemented over ledger.Service.GetOrCreateStandingAccount(...) by the orchestrator.
type RevenueResolver interface {
	// RevenueAccountID → paymax_revenue: credited when a paid job posting fee is debited.
	RevenueAccountID(ctx context.Context) (string, error)
	// ReferralExpenseAccountID → referral_reward_expense: debited when a bounty is paid out
	// (the counterpart of the CREDIT to the referrer's wallet).
	ReferralExpenseAccountID(ctx context.Context) (string, error)
}

// LoyaltyAwarder emits a Paymax Black loyalty event (PN-8: single currency). The
// orchestrator wraps loyalty.Service.AwardFor + points.EarnContext behind this port.
type LoyaltyAwarder interface {
	AwardFor(ctx context.Context, userID, module, trigger, ref string) error
}

// Auditor writes an immutable audit entry (mirrors connect safety WriteAudit). Every
// mutation emits one.
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module. app-wiring injects a thin adapter over the finance commission service; when
// the commission feature is off (or no recorder is wired) the field is nil and
// recording is a silent no-op. Modeled as a LOCAL interface so this package never
// imports the commission package at compile time (mirrors transport/service.go). It
// records realized profit ONLY; it never moves money. The injected recorder is built
// WITHOUT a ledger so RecordFor never re-posts (the paid-posting fee debit above
// already books the full fee into paymax_revenue) — it appends the immutable earning
// row used by profit reports.
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
	RecordExact(ctx context.Context, category, service, subtype string, grossKobo, recordedRevenueKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
}

// ── Sentinel errors ─────────────────────────────────────────────────────────
var (
	ErrMissingIdem        = errors.New("connect: Idempotency-Key required")
	ErrInvalidAmount      = errors.New("connect: amount must be positive kobo")
	ErrCompanyNotVerified = errors.New("connect: company page must be verified to post paid jobs")
	ErrIllegalTransition  = errors.New("connect: illegal state transition")
	ErrForbidden          = errors.New("connect: not authorized for this company page")
	ErrJobNotActive       = errors.New("connect: job is not open for applications")
)

// Service orchestrates the jobs / company-page / referral-bounty flows. It owns NO
// balance state: the paid-posting fee is delegated to the wallet and the bounty payout
// to the ledger. State transitions are guarded (validTransition helpers) and every
// mutation writes an audit event.
type Service struct {
	repo       *Repository
	wallet     WalletDebiter
	ledger     LedgerCrediter
	accounts   RevenueResolver
	loyalty    LoyaltyAwarder
	audit      Auditor
	commission CommissionRecorder // optional; nil ⇒ realized-profit recording is a no-op

	// Overridable seams so the money/state paths are unit-testable without a live DB
	// (mirrors connect/monetization's planLookup). Default to the repository.
	claimStateFn   func(ctx context.Context, companyPageID string) (ClaimState, error)
	getJobFn       func(ctx context.Context, id string) (*Job, error)
	getBountyFn    func(ctx context.Context, id string) (*ReferralBounty, error)
	markBountyPaid func(ctx context.Context, id, ledgerRef string) (bool, error)
	hasGrantFn     func(ctx context.Context, companyPageID, actorID string, roles ...string) (bool, error)
	now            func() time.Time
}

func NewService(repo *Repository, wallet WalletDebiter, ledger LedgerCrediter, accounts RevenueResolver, loyalty LoyaltyAwarder, audit Auditor) *Service {
	s := &Service{repo: repo, wallet: wallet, ledger: ledger, accounts: accounts, loyalty: loyalty, audit: audit}
	s.claimStateFn = repo.ClaimState
	s.getJobFn = repo.GetJob
	s.getBountyFn = repo.GetBounty
	s.markBountyPaid = repo.MarkBountyPaid
	s.hasGrantFn = repo.HasCompanyGrant
	s.now = func() time.Time { return time.Now().UTC() }
	return s
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *Service) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// recordCommissionSafe records realized Spotlight profit for a paid job activation.
// It is best-effort and MUST NEVER affect the caller's outcome: a nil recorder is a
// no-op, and any error is logged and swallowed so a profit-registry failure can never
// fail or reverse the paid-posting fee. The job id doubles as source ref + idempotency
// key so retries / re-activations never double-count. The module's ACTUAL take is 100%
// of the paid-posting fee (the full fee booked into paymax_revenue), NOT a % of it, so
// we record the EXACT earnedKobo via RecordExact (grossKobo is passed for context).
func (s *Service) recordCommissionSafe(ctx context.Context, category, service, subtype string, grossKobo, earnedKobo int64,
	sourceRef string, userID *string) {
	if s.commission == nil || earnedKobo <= 0 {
		return
	}
	if err := s.commission.RecordExact(ctx, category, service, subtype, grossKobo, earnedKobo,
		"connect_jobs", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[connect-jobs] commission record (source=%s gross=%d earned=%d) failed, continuing: %v", sourceRef, grossKobo, earnedKobo, err)
	}
}

func (s *Service) writeAudit(ctx context.Context, action, actorID, entityType, entityID string, v map[string]any) {
	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, action, actorID, entityType, entityID, v)
	}
}

func (s *Service) award(ctx context.Context, userID, trigger, ref string) {
	if s.loyalty != nil {
		_ = s.loyalty.AwardFor(ctx, userID, "connect_networking", trigger, ref) // best-effort (PN-8)
	}
}

// ── Company pages ───────────────────────────────────────────────────────────

// ClaimCompanyPage starts the CompanyPageClaim FSM (CLAIM_SUBMITTED).
func (s *Service) ClaimCompanyPage(ctx context.Context, actorID string, in ClaimCompanyInput) (*CompanyPage, error) {
	cp, err := s.repo.CreateClaim(ctx, in)
	if err != nil {
		return nil, err
	}
	// Bootstrap: the claimant becomes the page admin (an object-scoped grant, PN-9).
	if _, err := s.repo.GrantAdmin(ctx, cp.ID, actorID, "company_page_admin"); err != nil {
		return nil, err
	}
	s.writeAudit(ctx, "connect.company.claim", actorID, "connect_company_page", cp.ID,
		map[string]any{"name": cp.Name, "claim_state": cp.ClaimState})
	return cp, nil
}

// GetCompanyPage returns a page with its derived follower count.
func (s *Service) GetCompanyPage(ctx context.Context, id string) (*CompanyPage, error) {
	return s.repo.GetCompanyPage(ctx, id)
}

// ReviewClaim performs a guarded CompanyPageClaim transition (admin/reviewer).
func (s *Service) ReviewClaim(ctx context.Context, reviewerID, companyPageID string, to ClaimState) (*CompanyPage, error) {
	from, err := s.claimStateFn(ctx, companyPageID)
	if err != nil {
		return nil, err
	}
	if !validClaimTransition(from, to) {
		return nil, ErrIllegalTransition
	}
	ok, err := s.repo.TransitionClaim(ctx, companyPageID, from, to)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrIllegalTransition // concurrent transition lost the race
	}
	s.writeAudit(ctx, "connect.company.claim.review", reviewerID, "connect_company_page", companyPageID,
		map[string]any{"from": string(from), "to": string(to)})
	return s.repo.GetCompanyPage(ctx, companyPageID)
}

// GrantCapability adds an independently revocable object-scoped grant (PN-9).
func (s *Service) GrantCapability(ctx context.Context, actorID, companyPageID string, in GrantAdminInput) (*CompanyAdmin, error) {
	if in.Role != "company_page_admin" && in.Role != "recruiter" {
		return nil, fmt.Errorf("connect: invalid capability role %q", in.Role)
	}
	a, err := s.repo.GrantAdmin(ctx, companyPageID, in.UserID, in.Role)
	if err != nil {
		return nil, err
	}
	s.writeAudit(ctx, "connect.company.grant", actorID, "connect_company_admin", a.ID,
		map[string]any{"company_page_id": companyPageID, "user_id": in.UserID, "role": in.Role})
	return a, nil
}

// RevokeCapability removes ONE grant row (PN-9 independent revocation).
func (s *Service) RevokeCapability(ctx context.Context, actorID, companyPageID, userID string) error {
	ok, err := s.repo.RevokeAdmin(ctx, companyPageID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	s.writeAudit(ctx, "connect.company.revoke", actorID, "connect_company_admin", companyPageID,
		map[string]any{"company_page_id": companyPageID, "user_id": userID})
	return nil
}

// ── Jobs ────────────────────────────────────────────────────────────────────

// CreateJob drafts a job for a company page. Recruiter/admin capability is enforced
// defence-in-depth (in addition to the RBAC scoped middleware, PN-9).
func (s *Service) CreateJob(ctx context.Context, actorID, companyPageID string, in CreateJobInput) (*Job, error) {
	if err := s.requireCompanyGrant(ctx, companyPageID, actorID); err != nil {
		return nil, err
	}
	if in.FeeKobo < 0 || (in.SalaryMinKobo != nil && *in.SalaryMinKobo < 0) || (in.SalaryMaxKobo != nil && *in.SalaryMaxKobo < 0) {
		return nil, ErrInvalidAmount
	}
	j, err := s.repo.CreateJob(ctx, companyPageID, actorID, in)
	if err != nil {
		return nil, err
	}
	s.writeAudit(ctx, "connect.job.create", actorID, "connect_job", j.ID,
		map[string]any{"company_page_id": companyPageID, "fee_kobo": j.FeeKobo})
	return j, nil
}

// ActivateJob transitions a job to ACTIVE. If fee_kobo > 0 it is a MONEY PATH:
//   - PN-6: BLOCKED server-side unless the company page claim_state = 'verified';
//   - the fee is a wallet debit (DR poster wallet → CR paymax_revenue), tier-checked,
//     idempotent by idemKey. Only after the debit succeeds is the status advanced.
func (s *Service) ActivateJob(ctx context.Context, actorID, companyPageID, jobID, idemKey string) (*Job, error) {
	if err := s.requireCompanyGrant(ctx, companyPageID, actorID); err != nil {
		return nil, err
	}
	job, err := s.getJobFn(ctx, jobID)
	if err != nil {
		return nil, err
	}
	if job.CompanyPageID != companyPageID {
		return nil, ErrForbidden
	}
	if !validJobTransition(JobStatus(job.Status), JobActive) {
		return nil, ErrIllegalTransition
	}

	if job.FeeKobo > 0 {
		// PN-6 — fail-closed on unverified company page BEFORE any money moves.
		claim, err := s.claimStateFn(ctx, companyPageID)
		if err != nil {
			return nil, err
		}
		if claim != ClaimVerified {
			return nil, ErrCompanyNotVerified
		}
		if idemKey == "" {
			return nil, ErrMissingIdem
		}
		revAcc, err := s.accounts.RevenueAccountID(ctx)
		if err != nil {
			return nil, fmt.Errorf("connect: resolve revenue account: %w", err)
		}
		if err := s.wallet.Debit(ctx, actorID, "connect:job:fee", idemKey, revAcc, job.FeeKobo); err != nil {
			return nil, err // insufficient funds / tier / duplicate bubble up
		}
	}

	ok, err := s.repo.SetJobStatus(ctx, jobID, JobStatus(job.Status), JobActive)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrIllegalTransition
	}
	s.writeAudit(ctx, "connect.job.activate", actorID, "connect_job", jobID,
		map[string]any{"company_page_id": companyPageID, "fee_kobo": job.FeeKobo, "idempotency_key": idemKey})
	// Record realized Spotlight profit into the central Commission & Profit registry.
	// This is the paid-posting settlement point (the fee debit above booked the full
	// fee into paymax_revenue). Best-effort + idempotent: the job id doubles as source
	// ref + idempotency key. gross = the fee the poster paid (job.FeeKobo). A free post
	// (FeeKobo==0) is skipped inside recordCommissionSafe (grossKobo<=0 guard), so no
	// fabricated profit is recorded. A recorder failure is logged and swallowed — it
	// must NEVER fail or reverse the activation above.
	s.recordCommissionSafe(ctx, "Community", "Job", "", job.FeeKobo, job.FeeKobo, jobID, &actorID)
	return s.repo.GetJob(ctx, jobID)
}

// ListJobs is the public jobs feed (JB-01).
func (s *Service) ListJobs(ctx context.Context, limit int) ([]Job, error) {
	return s.repo.ListActiveJobs(ctx, limit)
}

// GetJob returns one posting (JB-02).
func (s *Service) GetJob(ctx context.Context, id string) (*Job, error) { return s.repo.GetJob(ctx, id) }

// ── Applications ────────────────────────────────────────────────────────────

// Apply creates a submitted application (JB-03). One active application per (job,
// user) is enforced by the unique constraint (a duplicate bubbles up as an error).
func (s *Service) Apply(ctx context.Context, userID, jobID string, in ApplyInput) (*JobApplication, error) {
	job, err := s.repo.GetJob(ctx, jobID)
	if err != nil {
		return nil, err
	}
	if job.Status != string(JobActive) {
		return nil, ErrJobNotActive
	}
	a, err := s.repo.CreateApplication(ctx, jobID, userID, in)
	if err != nil {
		return nil, err
	}
	s.writeAudit(ctx, "connect.job.apply", userID, "connect_job_application", a.ID,
		map[string]any{"job_id": jobID})
	return a, nil
}

// MyApplications is the applicant tracker (JB-04).
func (s *Service) MyApplications(ctx context.Context, userID string) ([]JobApplication, error) {
	return s.repo.ListApplicationsForUser(ctx, userID)
}

// Pipeline is the recruiter kanban feed (JB-06).
func (s *Service) Pipeline(ctx context.Context, actorID, companyPageID, jobID string) ([]JobApplication, error) {
	if err := s.requireCompanyGrant(ctx, companyPageID, actorID); err != nil {
		return nil, err
	}
	job, err := s.repo.GetJob(ctx, jobID)
	if err != nil {
		return nil, err
	}
	if job.CompanyPageID != companyPageID {
		return nil, ErrForbidden
	}
	return s.repo.ListApplicationsForJob(ctx, jobID)
}

// TransitionApplication is the guarded recruiter/applicant pipeline transition. HIRED
// routes through the atomic hire path (positions, linked bounty, payout). WITHDRAWN is
// applicant-initiated; all other transitions require a company grant.
func (s *Service) TransitionApplication(ctx context.Context, actorID, companyPageID, appID string, to AppState, idemKey string) (*JobApplication, error) {
	app, err := s.repo.GetApplication(ctx, appID)
	if err != nil {
		return nil, err
	}
	if !validAppTransition(AppState(app.State), to) {
		return nil, ErrIllegalTransition
	}

	if to == AppWithdrawn {
		// Applicant-initiated: only the applicant may withdraw their own application.
		if app.ApplicantUserID != actorID {
			return nil, ErrForbidden
		}
	} else {
		// Recruiter/admin transitions require an object-scoped grant on the job's page.
		if err := s.requireCompanyGrant(ctx, companyPageID, actorID); err != nil {
			return nil, err
		}
		job, err := s.repo.GetJob(ctx, app.JobID)
		if err != nil {
			return nil, err
		}
		if job.CompanyPageID != companyPageID {
			return nil, ErrForbidden
		}
	}

	if to == AppHired {
		return s.hire(ctx, actorID, app, idemKey)
	}

	ok, err := s.repo.SetApplicationState(ctx, appID, AppState(app.State), to)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrIllegalTransition
	}
	// When a posting closes out an application without a hire, expire pre-hire bounties
	// is handled elsewhere; here we simply record the transition.
	s.writeAudit(ctx, "connect.job.application.transition", actorID, "connect_job_application", appID,
		map[string]any{"from": app.State, "to": string(to)})
	return s.repo.GetApplication(ctx, appID)
}

// hire performs the HIRED transition and the atomic side effects (§4), then runs the
// ledger-writing bounty payout (PN-10).
func (s *Service) hire(ctx context.Context, actorID string, app *JobApplication, idemKey string) (*JobApplication, error) {
	bountyID, err := s.repo.HireApplicant(ctx, app.ID, AppState(app.State))
	if err != nil {
		return nil, err
	}
	s.writeAudit(ctx, "connect.job.application.hired", actorID, "connect_job_application", app.ID,
		map[string]any{"from": app.State, "to": string(AppHired), "bounty_id": bountyID})
	// Loyalty for the hired applicant (event_stamp-style networking milestone, PN-8).
	s.award(ctx, app.ApplicantUserID, "job_hired", app.ID)

	// PN-10 — pay the linked bounty (ledger credit, idempotent by bounty id). Safe to
	// retry: if this crashes, re-running the hire is a no-op and the payout keyed by
	// bounty id will not double-credit.
	if bountyID != "" {
		if _, err := s.PayReferralBounty(ctx, actorID, bountyID); err != nil {
			return nil, fmt.Errorf("connect: hire: bounty payout: %w", err)
		}
	}
	return s.repo.GetApplication(ctx, app.ID)
}

// ── Referral bounties (single-level, PN-2) ──────────────────────────────────

// CreateReferral records a single-level referral bounty for one application (JB-08).
// There is no way to reference a parent bounty — a referral-of-referral is not
// representable (PN-2).
func (s *Service) CreateReferral(ctx context.Context, referrerID, jobApplicationID string, in ReferInput) (*ReferralBounty, error) {
	if in.AmountKobo <= 0 {
		return nil, ErrInvalidAmount
	}
	b, err := s.repo.CreateBounty(ctx, referrerID, jobApplicationID, in.AmountKobo)
	if err != nil {
		return nil, err
	}
	s.writeAudit(ctx, "connect.referral.create", referrerID, "connect_referral_bounty", b.ID,
		map[string]any{"job_application_id": jobApplicationID, "amount_kobo": in.AmountKobo})
	return b, nil
}

// MyReferrals is the GM-04 single-level referral tracker.
func (s *Service) MyReferrals(ctx context.Context, referrerID string) ([]ReferralBounty, error) {
	return s.repo.ListBountiesForReferrer(ctx, referrerID)
}

// PayReferralBounty is the ledger-writing BOUNTY_PAYABLE → PAID transition (PN-10).
// It is idempotent by referral_bounty_id: the ledger Credit is keyed by the bounty id
// (a retry is a safe no-op via the ledger's unique constraint) and the projection
// transition to PAID is guarded so a second call after PAID is a no-op.
func (s *Service) PayReferralBounty(ctx context.Context, actorID, bountyID string) (*ReferralBounty, error) {
	b, err := s.getBountyFn(ctx, bountyID)
	if err != nil {
		return nil, err
	}
	switch BountyState(b.State) {
	case BountyPaid:
		return b, nil // already paid — idempotent no-op
	case BountyHireConfirmed, BountyPayable:
		// payable — proceed
	default:
		return nil, ErrIllegalTransition
	}
	if b.AmountKobo <= 0 {
		return nil, ErrInvalidAmount
	}

	expenseAcc, err := s.accounts.ReferralExpenseAccountID(ctx)
	if err != nil {
		return nil, fmt.Errorf("connect: resolve referral expense account: %w", err)
	}
	// Ledger credit — money in to the referrer, DR referral_reward_expense. Idempotency
	// key is the bounty id itself, so this is the single source of double-credit safety.
	if err := s.ledger.Credit(ctx, b.ReferrerUserID, "connect:referral:bounty", b.ID, expenseAcc, b.AmountKobo); err != nil {
		return nil, err
	}

	ledgerRef := "connect:referral:bounty:" + b.ID
	if _, err := s.markBountyPaid(ctx, b.ID, ledgerRef); err != nil {
		return nil, fmt.Errorf("connect: stamp bounty paid after credit: %w", err)
	}
	s.writeAudit(ctx, "connect.referral.paid", actorID, "connect_referral_bounty", b.ID,
		map[string]any{"amount_kobo": b.AmountKobo, "ledger_entry_ref": ledgerRef, "idempotency_key": b.ID})
	// Loyalty event referral_bounty_paid (PN-8, §8).
	s.award(ctx, b.ReferrerUserID, "referral_bounty_paid", b.ID)
	return s.getBountyFn(ctx, b.ID)
}

// ── Followers & open-to-work ────────────────────────────────────────────────

func (s *Service) Follow(ctx context.Context, userID, companyPageID string) error {
	return s.repo.Follow(ctx, companyPageID, userID)
}

func (s *Service) SetOpenToWork(ctx context.Context, userID string, in OpenToWorkInput) error {
	if err := s.repo.SetOpenToWork(ctx, userID, in); err != nil {
		return err
	}
	s.writeAudit(ctx, "connect.open_to_work.set", userID, "connect_open_to_work", userID,
		map[string]any{"open": in.Open})
	return nil
}

// requireCompanyGrant is the defence-in-depth object-scoped check (PN-9): the actor must
// hold a company_page_admin or recruiter grant on this page. Runs in addition to the
// RBAC scoped middleware so a revoked grant is honoured even if a stale token exists.
func (s *Service) requireCompanyGrant(ctx context.Context, companyPageID, actorID string) error {
	ok, err := s.hasGrantFn(ctx, companyPageID, actorID, "company_page_admin", "recruiter")
	if err != nil {
		return err
	}
	if !ok {
		return ErrForbidden
	}
	return nil
}
