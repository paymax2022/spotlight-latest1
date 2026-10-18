package buskyb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/jsonx"
)

// Service is the bus-operator KYB domain service. It owns the application
// lifecycle tables written by migration 20271053000000 and mirrors review
// outcomes onto bus_providers.verification_status — never the other way round.
type Service struct {
	pool     *pgxpool.Pool
	registry CompanyRegistryVerifier // nil → RunCACVerification fails closed
	tierSrc  TierSource              // nil → pgxTierSource over user_profiles
}

// TierSource reads a user's current KYC tier (user_profiles.kyc_tier, the same
// column internal/finance/tiers gates money movement on). A port so tests can
// stub it and a future wiring could front it with a cache.
type TierSource interface {
	UserTier(ctx context.Context, userID string) (int, error)
}

// pgxTierSource is the production TierSource: a direct read of
// user_profiles.kyc_tier, fail-closed (a read error propagates — the caller
// must never treat "couldn't read the tier" as "tier met").
type pgxTierSource struct{ pool *pgxpool.Pool }

func (p pgxTierSource) UserTier(ctx context.Context, userID string) (int, error) {
	var t int
	if err := p.pool.QueryRow(ctx,
		`SELECT COALESCE(kyc_tier, 0) FROM user_profiles WHERE id=$1`, userID).Scan(&t); err != nil {
		return 0, fmt.Errorf("buskyb: get kyc tier for %s (fail closed): %w", userID, err)
	}
	return t, nil
}

// Deps bundles the service dependencies.
type Deps struct {
	Pool *pgxpool.Pool
	// Registry verifies a company's CAC RC/BN number. Wrap the existing adapter:
	// buskyb.NewCACRegistryAdapter(cac.New(cfg)). Nil is allowed — the service
	// still serves submit/status/review, but RunCACVerification returns
	// ErrRegistryUnavailable (fail closed; never fabricates a match).
	Registry CompanyRegistryVerifier
	// TierSource reads the owner KYC tier. Nil → pgxTierSource over Pool.
	TierSource TierSource
}

// NewService builds the service.
func NewService(d Deps) *Service {
	ts := d.TierSource
	if ts == nil {
		ts = pgxTierSource{d.Pool}
	}
	return &Service{pool: d.Pool, registry: d.Registry, tierSrc: ts}
}

// Application is one operator's KYB application row.
type Application struct {
	ID             string     `json:"id"`
	ProviderID     string     `json:"provider_id"`
	SubmittedBy    string     `json:"submitted_by"`
	LegalName      string     `json:"legal_name"`
	RCNumber       string     `json:"rc_number"`
	State          State      `json:"state"`
	TermsAccepted  *time.Time `json:"terms_accepted_at,omitempty"`
	TermsVersion   *string    `json:"terms_version,omitempty"`
	SubmittedAt    *time.Time `json:"submitted_at,omitempty"`
	DecidedAt      *time.Time `json:"decided_at,omitempty"`
	DecidedBy      *string    `json:"decided_by,omitempty"`
	DecisionReason *string    `json:"decision_reason,omitempty"`
	Version        int        `json:"version"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// Verification is one recorded check attempt on an application.
type Verification struct {
	ID            string          `json:"id"`
	ApplicationID string          `json:"application_id"`
	CheckType     CheckType       `json:"check_type"`
	Provider      *string         `json:"provider,omitempty"`
	ProviderRef   *string         `json:"provider_ref,omitempty"`
	Status        CheckStatus     `json:"status"`
	ResultCode    *string         `json:"result_code,omitempty"`
	Snapshot      json.RawMessage `json:"payload_snapshot,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
}

// Transition is one immutable state-change history row.
type Transition struct {
	ID            string    `json:"id"`
	ApplicationID string    `json:"application_id"`
	FromState     *string   `json:"from_state,omitempty"`
	ToState       string    `json:"to_state"`
	Actor         *string   `json:"actor,omitempty"`
	Reason        *string   `json:"reason,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// SubmitRequest is the operator's KYB submission payload.
type SubmitRequest struct {
	LegalName     string `json:"legal_name"`
	RCNumber      string `json:"rc_number"` // CAC RC/BN; empty → needs_information
	TermsAccepted bool   `json:"terms_accepted"`
	TermsVersion  string `json:"terms_version"`
}

// resubmittable states are the ones an owner may (re)submit from — must match
// the fsm table's incoming edges to 'submitted'.
func resubmittable(s State) bool {
	return transitions.Can(s, StateSubmitted)
}

// providerIDForUser resolves the caller's bus_providers row (owner gate, same
// rule as transport's providerForUser: owner_user_id = caller).
func (s *Service) providerIDForUser(ctx context.Context, userID string) (string, error) {
	var id string
	if err := s.pool.QueryRow(ctx,
		`SELECT id FROM bus_providers WHERE owner_user_id=$1`, userID).Scan(&id); err != nil {
		return "", ErrProviderNotFound
	}
	return id, nil
}

const appCols = `id, provider_id, submitted_by, COALESCE(legal_name,''), COALESCE(rc_number,''),
    state, terms_accepted_at, terms_version, submitted_at, decided_at, decided_by,
    decision_reason, version, created_at, updated_at`

func scanApp(row pgx.Row) (*Application, error) {
	var a Application
	err := row.Scan(&a.ID, &a.ProviderID, &a.SubmittedBy, &a.LegalName, &a.RCNumber,
		&a.State, &a.TermsAccepted, &a.TermsVersion, &a.SubmittedAt, &a.DecidedAt,
		&a.DecidedBy, &a.DecisionReason, &a.Version, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// loadApp reads one application; forUpdate takes a row lock inside a tx.
func loadApp(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, id string, forUpdate bool) (*Application, error) {
	qstr := `SELECT ` + appCols + ` FROM bus_operator_application WHERE id=$1`
	if forUpdate {
		qstr += ` FOR UPDATE`
	}
	a, err := scanApp(q.QueryRow(ctx, qstr, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

func loadAppByProvider(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, providerID string) (*Application, error) {
	a, err := scanApp(q.QueryRow(ctx,
		`SELECT `+appCols+` FROM bus_operator_application WHERE provider_id=$1`, providerID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

// SubmitApplication creates (or resubmits) the caller's KYB application and
// advances it as far as the automated pipeline can take it in one call:
// draft → submitted → cac_verification_pending (rc present) or
// needs_information (no rc). Idempotent on provider_id: one application row per
// provider, so a retry of an in-flight submission returns the current state
// unchanged rather than duplicating or regressing it.
func (s *Service) SubmitApplication(ctx context.Context, actorUserID string, req SubmitRequest) (*Application, error) {
	if strings.TrimSpace(actorUserID) == "" {
		return nil, ErrForbidden
	}
	if !req.TermsAccepted {
		return nil, ErrTermsRequired
	}
	if strings.TrimSpace(req.LegalName) == "" {
		return nil, fmt.Errorf("%w: legal_name is required", ErrInvalidRequest)
	}
	providerID, err := s.providerIDForUser(ctx, actorUserID)
	if err != nil {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	app, err := loadAppByProvider(ctx, tx, providerID)
	switch {
	case errors.Is(err, ErrNotFound):
		// First submission — create at draft, then walk the legal moves.
		var appID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO bus_operator_application (provider_id, submitted_by, legal_name, rc_number, state)
			VALUES ($1,$2,$3,$4,'draft') RETURNING id`,
			providerID, actorUserID, req.LegalName, dbutil.NullStr(req.RCNumber)).Scan(&appID); err != nil {
			return nil, fmt.Errorf("buskyb: create application: %w", err)
		}
		if err := recordTransition(ctx, tx, appID, "", StateDraft, actorUserID, "application created"); err != nil {
			return nil, err
		}
		app = &Application{ID: appID, ProviderID: providerID, State: StateDraft}
	case err != nil:
		return nil, err
	default:
		// Existing row. In-flight or decided applications are an idempotent
		// replay: return the current state untouched.
		if !resubmittable(app.State) {
			return app, tx.Commit(ctx)
		}
		// Resubmission may carry corrected details (e.g. a fixed RC number after
		// needs_information). submitted_by is deliberately NOT updated — the
		// original submitter stays the maker-checker "maker" for this round.
		if _, err := tx.Exec(ctx, `
			UPDATE bus_operator_application
			SET legal_name=$2, rc_number=$3, decided_at=NULL, decided_by=NULL, decision_reason=NULL
			WHERE id=$1`, app.ID, req.LegalName, dbutil.NullStr(req.RCNumber)); err != nil {
			return nil, err
		}
	}

	// draft → submitted (records terms + submitted_at).
	if err := setTermsAndSubmit(ctx, tx, app.ID, actorUserID, req.TermsVersion); err != nil {
		return nil, err
	}
	// submitted → cac_verification_pending when an RC number exists to verify,
	// else → needs_information (the CAC gate cannot run without one).
	next := StateCACPending
	reason := "rc number supplied — queued for CAC verification"
	if strings.TrimSpace(req.RCNumber) == "" {
		next = StateNeedsInfo
		reason = "no CAC RC/BN number supplied"
	}
	if err := applyTransition(ctx, tx, app.ID, StateSubmitted, next, actorUserID, reason); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.audit(ctx, actorUserID, "buskyb.application.submitted", app.ID,
		nil, map[string]any{"state": next, "provider_id": providerID})
	return loadApp(ctx, s.pool, app.ID, false)
}

// setTermsAndSubmit stamps terms/submitted_at and moves draft|needs_information|
// rejected|expired → submitted. The caller holds the tx.
func setTermsAndSubmit(ctx context.Context, tx pgx.Tx, appID, actor, termsVersion string) error {
	if _, err := tx.Exec(ctx, `
		UPDATE bus_operator_application
		SET terms_accepted_at=NOW(), terms_version=NULLIF($2,'')
		WHERE id=$1`, appID, termsVersion); err != nil {
		return err
	}
	// Read current state to drive the guarded move (submitted_at set with it).
	var cur State
	if err := tx.QueryRow(ctx, `SELECT state FROM bus_operator_application WHERE id=$1`, appID).Scan(&cur); err != nil {
		return err
	}
	if cur == StateDraft || resubmittable(cur) {
		if _, err := tx.Exec(ctx, `
			UPDATE bus_operator_application SET submitted_at=NOW() WHERE id=$1`, appID); err != nil {
			return err
		}
		return applyTransition(ctx, tx, appID, cur, StateSubmitted, actor, "terms accepted; submitted for verification")
	}
	return ErrInvalidState
}

// applyTransition performs one guarded state move + history insert inside tx.
// The Go table fails fast; the bus_operator_kyb_guard trigger is the backstop.
// The UPDATE's state=$3 guard also makes a concurrent move surface as
// ErrInvalidState rather than silently overwriting it.
func applyTransition(ctx context.Context, tx pgx.Tx, appID string, from, to State, actor, reason string) error {
	if !transitions.Can(from, to) {
		return fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, from, to)
	}
	tag, err := tx.Exec(ctx,
		`UPDATE bus_operator_application SET state=$2 WHERE id=$1 AND state=$3`,
		appID, string(to), string(from))
	if err != nil {
		return fmt.Errorf("buskyb: transition %s -> %s: %w", from, to, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: expected state %s", ErrInvalidState, from)
	}
	return recordTransition(ctx, tx, appID, string(from), to, actor, reason)
}

func recordTransition(ctx context.Context, tx pgx.Tx, appID, from string, to State, actor, reason string) error {
	var fromV any
	if from != "" {
		fromV = from
	}
	var actorV any
	if actor != "" {
		actorV = actor
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO bus_operator_transition (application_id, from_state, to_state, actor, reason)
		VALUES ($1,$2,$3,$4,NULLIF($5,''))`,
		appID, fromV, string(to), actorV, reason)
	return err
}

// snapshotWhitelist is every key allowed into bus_operator_verification.
// payload_snapshot — a MINIMIZED, non-PII view of the registry/KYC answer. The
// raw provider payload never lands here (same rule as kycverify's PII store).
var snapshotWhitelist = map[string]bool{
	"found": true, "name": true, "status": true, "type": true,
	"rc_number": true, "registered_at": true, "kyc_tier": true,
	"required_tier": true, "reason": true,
}

func minimizeSnapshot(in map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range in {
		if snapshotWhitelist[k] {
			out[k] = v
		}
	}
	return out
}

func recordCheck(ctx context.Context, tx pgx.Tx, appID string, ct CheckType,
	provider, providerRef string, status CheckStatus, resultCode string, snapshot map[string]any) error {
	var snap []byte
	if snapshot != nil {
		snap = jsonx.Marshal(minimizeSnapshot(snapshot))
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO bus_operator_verification
			(application_id, check_type, provider, provider_ref, status, result_code, payload_snapshot)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
		appID, string(ct), dbutil.NullStr(provider), dbutil.NullStr(providerRef),
		string(status), dbutil.NullStr(resultCode), snap)
	return err
}

// CACResult is the normalized registry outcome a caller records. Prefer
// RunCACVerification (which invokes the configured verifier and derives this
// for you); RecordCACResult exists for webhook/job-driven flows where the
// provider call already happened elsewhere.
type CACResult struct {
	Code        CACResultCode  `json:"code"`
	Provider    string         `json:"provider"`
	ProviderRef string         `json:"provider_ref"`
	Snapshot    map[string]any `json:"snapshot"` // minimized — whitelisted keys only
}

// cacDecision is the pure mapping from a registry outcome onto (check status,
// next application state). next == "" means NO move — provider_unavailable
// records an 'error' check and leaves the application in
// cac_verification_pending so the job can retry; every other non-match routes
// to under_review for a human (never auto-approve, never auto-reject on a
// single provider answer).
func cacDecision(code CACResultCode) (CheckStatus, State, error) {
	switch code {
	case CACMatch:
		return CheckPassed, StateKYCPending, nil
	case CACProviderUnavailable:
		return CheckError, "", nil
	case CACCompanyNotFound, CACMismatch, CACInvalidRegistration, CACPolicyRejected:
		return CheckFailed, StateUnderReview, nil
	default:
		return "", "", fmt.Errorf("%w: unknown CAC result code %q", ErrInvalidRequest, code)
	}
}

// RecordCACResult persists a registry outcome for an application parked in
// cac_verification_pending and moves it per cacDecision. actor is the driving
// principal recorded on the transition ('system' for automated runs).
func (s *Service) RecordCACResult(ctx context.Context, appID, actor string, res CACResult) (*Application, error) {
	status, next, err := cacDecision(res.Code)
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	app, err := loadApp(ctx, tx, appID, true)
	if err != nil {
		return nil, err
	}
	if app.State != StateCACPending {
		return nil, fmt.Errorf("%w: application is %s, not cac_verification_pending", ErrInvalidState, app.State)
	}
	if err := recordCheck(ctx, tx, appID, CheckCAC, res.Provider, res.ProviderRef,
		status, string(res.Code), res.Snapshot); err != nil {
		return nil, err
	}
	if next != "" {
		reason := "cac check: " + string(res.Code)
		if err := applyTransition(ctx, tx, appID, app.State, next, actor, reason); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.audit(ctx, actor, "buskyb.cac.recorded", appID,
		map[string]any{"state": app.State}, map[string]any{"result": res.Code, "status": status})
	return loadApp(ctx, s.pool, appID, false)
}

// RunCACVerification invokes the configured CompanyRegistryVerifier against the
// application's RC number and records the outcome via RecordCACResult. A
// verifier error maps to provider_unavailable (inconclusive — retryable), never
// to a fabricated answer. Nil registry → ErrRegistryUnavailable (fail closed).
func (s *Service) RunCACVerification(ctx context.Context, appID string) (*Application, error) {
	if s.registry == nil {
		return nil, ErrRegistryUnavailable
	}
	app, err := loadApp(ctx, s.pool, appID, false)
	if err != nil {
		return nil, err
	}
	if app.State != StateCACPending {
		return nil, fmt.Errorf("%w: application is %s, not cac_verification_pending", ErrInvalidState, app.State)
	}
	m, verr := s.registry.VerifyCompany(ctx, app.RCNumber, app.LegalName)
	res := CACResult{
		Provider: s.registry.Name(),
		Snapshot: map[string]any{
			"found": m.Found, "name": m.Name, "status": m.Status, "rc_number": app.RCNumber,
		},
	}
	if verr != nil {
		res.Code = CACProviderUnavailable
		res.Snapshot["reason"] = "provider call failed"
	} else {
		res.Code = classifyRegistryResult(m, app.LegalName)
	}
	return s.RecordCACResult(ctx, appID, "system", res)
}

// kycDecision is the pure tier gate: ≥ RequiredOperatorTier passes and advances
// to under_review; below it fails and bounces to needs_information so the
// operator can complete KYC and resubmit (needs_information → submitted).
func kycDecision(tier int) (CheckStatus, State) {
	if tier >= RequiredOperatorTier {
		return CheckPassed, StateUnderReview
	}
	return CheckFailed, StateNeedsInfo
}

// RecordKYCTier reads the applicant owner's KYC tier via TierSource and records
// a 'kyc' check on an application parked in kyc_verification_pending. The tier
// read fails closed (a read error aborts without moving the application).
func (s *Service) RecordKYCTier(ctx context.Context, appID, actor string) (*Application, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	app, err := loadApp(ctx, tx, appID, true)
	if err != nil {
		return nil, err
	}
	if app.State != StateKYCPending {
		return nil, fmt.Errorf("%w: application is %s, not kyc_verification_pending", ErrInvalidState, app.State)
	}
	tier, err := s.tierSrc.UserTier(ctx, app.SubmittedBy)
	if err != nil {
		return nil, err
	}
	status, next := kycDecision(tier)
	code := fmt.Sprintf("kyc_tier_%d", tier)
	if err := recordCheck(ctx, tx, appID, CheckKYC, "kycverify", "",
		status, code, map[string]any{"kyc_tier": tier, "required_tier": RequiredOperatorTier}); err != nil {
		return nil, err
	}
	reason := fmt.Sprintf("owner kyc tier %d (required %d)", tier, RequiredOperatorTier)
	if err := applyTransition(ctx, tx, appID, app.State, next, actor, reason); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.audit(ctx, actor, "buskyb.kyc.recorded", appID,
		map[string]any{"state": app.State}, map[string]any{"kyc_tier": tier, "status": status})
	return loadApp(ctx, s.pool, appID, false)
}

// decideReview is the pure review-decision guard — unit-tested without a DB:
// valid action → maker-checker (reviewer ≠ submitter) → reason required →
// legal move. It never sees the DB.
func decideReview(submittedBy, reviewerID string, from State, action ReviewAction, reason string) (State, error) {
	target, ok := reviewTargets[action]
	if !ok {
		return "", fmt.Errorf("%w: %q", ErrInvalidAction, action)
	}
	if reviewerID == "" {
		return "", ErrForbidden
	}
	if submittedBy != "" && reviewerID == submittedBy {
		return "", ErrMakerChecker
	}
	if reasonRequired[action] && strings.TrimSpace(reason) == "" {
		return "", fmt.Errorf("%w: %s requires a reason", ErrInvalidAction, action)
	}
	if !transitions.Can(from, target) {
		return "", fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, from, target)
	}
	return target, nil
}

// providerMirrorFor maps a decided application state onto the
// bus_providers.verification_status mirror — the column the existing
// SearchBusTrips gate reads. "" means "leave unchanged".
func providerMirrorFor(to State) string {
	switch to {
	case StateApproved:
		return "verified"
	case StateSuspended:
		return "suspended"
	case StateExpired:
		return "pending" // approval lapsed — back to unverified
	default:
		return ""
	}
}

// Review records a platform reviewer's decision. Maker-checker is enforced in
// decideReview AND by the decided_by <> submitted_by CHECK in the schema. All
// writes (state, decided_*, transition history, provider mirror, audit) commit
// or roll back together.
func (s *Service) Review(ctx context.Context, appID, reviewerID string, action ReviewAction, reason string) (*Application, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	app, err := loadApp(ctx, tx, appID, true)
	if err != nil {
		return nil, err
	}
	target, err := decideReview(app.SubmittedBy, reviewerID, app.State, action, reason)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE bus_operator_application
		SET decided_at=NOW(), decided_by=$2, decision_reason=NULLIF($3,'')
		WHERE id=$1`, appID, reviewerID, reason); err != nil {
		return nil, err
	}
	if err := applyTransition(ctx, tx, appID, app.State, target, reviewerID, reason); err != nil {
		return nil, err
	}
	// Mirror the decision onto the provider row the public-search gate reads.
	if mirror := providerMirrorFor(target); mirror != "" {
		if _, err := tx.Exec(ctx,
			`UPDATE bus_providers SET verification_status=$2, updated_at=NOW() WHERE id=$1`,
			app.ProviderID, mirror); err != nil {
			return nil, fmt.Errorf("buskyb: mirror provider verification_status: %w", err)
		}
	}
	if err := writeAudit(ctx, tx, reviewerID, "buskyb.review."+string(action),
		"bus_operator_application", appID,
		map[string]any{"state": app.State}, map[string]any{"state": target}, reason); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return loadApp(ctx, s.pool, appID, false)
}

// publishable is CanPublish's pure predicate — approved application AND the two
// required checks (cac, kyc) passed. payout/document checks are recorded for
// the reviewer but are not publish gates.
func publishable(state State, cacPassed, kycPassed bool) bool {
	return state == StateApproved && cacPassed && kycPassed
}

// CanPublish is the gate buscatalog/busfleet call before letting an operator
// publish routes, schedules, or fares. True only when the provider's
// application is approved AND its cac + kyc checks passed. Unknown provider →
// (false, nil): no application means "not verified", not an error.
func (s *Service) CanPublish(ctx context.Context, providerID string) (bool, error) {
	var state State
	var cacOK, kycOK bool
	err := s.pool.QueryRow(ctx, `
		SELECT a.state,
		       EXISTS (SELECT 1 FROM bus_operator_verification v
		               WHERE v.application_id=a.id AND v.check_type='cac' AND v.status='passed'),
		       EXISTS (SELECT 1 FROM bus_operator_verification v
		               WHERE v.application_id=a.id AND v.check_type='kyc' AND v.status='passed')
		FROM bus_operator_application a WHERE a.provider_id=$1`, providerID).
		Scan(&state, &cacOK, &kycOK)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return publishable(state, cacOK, kycOK), nil
}

// StatusForUser returns the caller's application plus its check + transition
// history. application is nil when the provider has never applied (200 shape,
// like GetMyBusProvider's provider:null).
func (s *Service) StatusForUser(ctx context.Context, userID string) (map[string]any, error) {
	providerID, err := s.providerIDForUser(ctx, userID)
	if err != nil {
		return map[string]any{"application": nil, "verifications": []any{}, "transitions": []any{}}, nil
	}
	app, err := loadAppByProvider(ctx, s.pool, providerID)
	if errors.Is(err, ErrNotFound) {
		return map[string]any{"application": nil, "verifications": []any{}, "transitions": []any{}}, nil
	}
	if err != nil {
		return nil, err
	}
	checks, err := s.listChecks(ctx, app.ID)
	if err != nil {
		return nil, err
	}
	history, err := s.listTransitions(ctx, app.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"application": app, "verifications": checks, "transitions": history}, nil
}

// ListPendingReview returns applications awaiting a platform reviewer,
// oldest-submitted first. The handler that serves this MUST sit behind admin/
// reviewer RBAC — it is not self-gating.
func (s *Service) ListPendingReview(ctx context.Context) ([]Application, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+appCols+` FROM bus_operator_application
		WHERE state='under_review' ORDER BY submitted_at NULLS LAST, created_at LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Application{}
	for rows.Next() {
		var a Application
		if err := rows.Scan(&a.ID, &a.ProviderID, &a.SubmittedBy, &a.LegalName, &a.RCNumber,
			&a.State, &a.TermsAccepted, &a.TermsVersion, &a.SubmittedAt, &a.DecidedAt,
			&a.DecidedBy, &a.DecisionReason, &a.Version, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Service) listChecks(ctx context.Context, appID string) ([]Verification, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, application_id, check_type, provider, provider_ref, status, result_code,
		       payload_snapshot, created_at
		FROM bus_operator_verification WHERE application_id=$1 ORDER BY created_at`, appID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Verification{}
	for rows.Next() {
		var v Verification
		var snap []byte
		if err := rows.Scan(&v.ID, &v.ApplicationID, &v.CheckType, &v.Provider, &v.ProviderRef,
			&v.Status, &v.ResultCode, &snap, &v.CreatedAt); err != nil {
			return nil, err
		}
		v.Snapshot = snap
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Service) listTransitions(ctx context.Context, appID string) ([]Transition, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, application_id, from_state, to_state, actor, reason, created_at
		FROM bus_operator_transition WHERE application_id=$1 ORDER BY created_at`, appID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Transition{}
	for rows.Next() {
		var t Transition
		if err := rows.Scan(&t.ID, &t.ApplicationID, &t.FromState, &t.ToState, &t.Actor, &t.Reason, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// audit is best-effort for non-mutating observations (submit/check recorded) —
// the durable decision audit in Review goes through writeAudit inside the tx.
func (s *Service) audit(ctx context.Context, actorID, action, entityID string, oldVal, newVal any) {
	// transport_audit_log.admin_id is UUID NOT NULL; system actors fall back to
	// the nil principal only when no user id exists at all.
	if actorID == "" || actorID == "system" {
		actorID = "00000000-0000-0000-0000-000000000000"
	}
	_ = writeAuditRow(ctx, s.pool, actorID, action, "bus_operator_application", entityID, oldVal, newVal, "")
}

// writeAudit lands the review-decision audit row inside the caller's tx so the
// decision and its audit commit or roll back together.
func writeAudit(ctx context.Context, tx pgx.Tx, actorID, action, entityType, entityID string, oldVal, newVal any, reason string) error {
	return writeAuditRow(ctx, tx, actorID, action, entityType, entityID, oldVal, newVal, reason)
}

// writeAuditRow inserts into transport_audit_log (the shared transport audit
// sink). The Exec signature is satisfied by both *pgxpool.Pool and pgx.Tx.
func writeAuditRow(ctx context.Context, db interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, actorID, action, entityType, entityID string, oldVal, newVal any, reason string) error {
	var oldJSON, newJSON []byte
	if oldVal != nil {
		oldJSON = jsonx.Marshal(oldVal)
	}
	if newVal != nil {
		newJSON = jsonx.Marshal(newVal)
	}
	_, err := db.Exec(ctx, `
		INSERT INTO transport_audit_log (admin_id, action, entity_type, entity_id, old_value, new_value, reason)
		VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,NULLIF($7,''))`,
		actorID, action, entityType, dbutil.NullStr(entityID), oldJSON, newJSON, reason)
	return err
}
