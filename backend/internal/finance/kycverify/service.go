package kycverify

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/fsm"
	"spotlight/backend/internal/platform/crypto"
	"spotlight/backend/internal/provider"
)

// Service is the KYC verification domain service (ADR-013). It composes:
//   - the pgx repository (sessions / checks / routing / webhook dedupe),
//   - the encrypted PII store + consent store,
//   - the capability gateway (routing + failover + breaker),
//   - the orchestrator (session state machine + tier elevation),
//
// depending on the provider PORTS only (via the Registry) — never a provider SDK.
// INVARIANTS enforced here:
//   - consent is REQUIRED before any check (RunCheck fails closed without it),
//   - every provider call is idempotent on client_ref,
//   - raw provider payloads are encrypted at rest (PIIStore) — never logged,
//   - object-level authz: a caller only reads/mutates their own session.
type Service struct {
	pool    *pgxpool.Pool
	repo    *Repository
	reg     *Registry
	pii     *PIIStore
	consent *ConsentStore
	orch    *Orchestrator

	seed          RoutingSeed // env seed, folded with DB rules per run
	facialDefault int
}

// Deps bundles the KYC verification service dependencies.
type Deps struct {
	Pool     *pgxpool.Pool
	Registry *Registry
	Cipher   *crypto.Cipher
	Elevator TierElevator
	Seed     RoutingSeed
	// FacialThreshold seeds the default facial gate when a routing rule omits it.
	FacialThreshold int
}

// NewService builds the KYC verification service.
func NewService(d Deps) *Service {
	repo := NewRepository(d.Pool)
	return &Service{
		pool:          d.Pool,
		repo:          repo,
		reg:           d.Registry,
		pii:           NewPIIStore(d.Pool, d.Cipher),
		consent:       NewConsentStore(d.Pool),
		orch:          NewOrchestrator(d.Pool, repo, d.Elevator),
		seed:          d.Seed,
		facialDefault: d.FacialThreshold,
	}
}

// routingTable loads the admin-editable rules from the DB, folded over the env
// seed / ADR defaults, so provider swaps take effect without a redeploy.
func (s *Service) routingTable(ctx context.Context) RoutingTable {
	if t, err := s.repo.LoadRoutingTable(ctx); err == nil && t != nil {
		return t
	}
	return TableFromSeed(s.seed)
}

// StartSession creates a verification session for a target CBN tier (1..3).
func (s *Service) StartSession(ctx context.Context, userID string, targetTier int) (*Session, error) {
	if userID == "" {
		return nil, ErrForbidden
	}
	if targetTier < 1 || targetTier > 3 {
		return nil, ErrInvalidTier
	}
	sess, err := s.repo.CreateSession(ctx, userID, targetTier)
	if err != nil {
		return nil, err
	}
	s.audit(ctx, "kycverify.session.started", userID, sess.ID, fmt.Sprintf("tier=%d", targetTier))
	return sess, nil
}

// GetSession returns a session, enforcing object-level authz (a user only reads
// their own session).
func (s *Service) GetSession(ctx context.Context, userID, sessionID string) (*Session, []Check, error) {
	sess, err := s.repo.GetSession(ctx, sessionID)
	if err != nil {
		return nil, nil, err
	}
	if sess.UserID != userID {
		return nil, nil, ErrForbidden
	}
	checks, err := s.repo.ListChecksForSession(ctx, sessionID)
	if err != nil {
		return nil, nil, err
	}
	return sess, checks, nil
}

// RecordConsent appends an immutable NDPA/CBN consent record for the caller.
func (s *Service) RecordConsent(ctx context.Context, userID, scope, version, ip string) (*Consent, error) {
	if userID == "" {
		return nil, ErrForbidden
	}
	if scope == "" || version == "" {
		return nil, ErrInvalidRequest
	}
	rec, err := s.consent.Record(ctx, userID, scope, version, ip)
	if err != nil {
		return nil, err
	}
	s.audit(ctx, "kycverify.consent.recorded", userID, rec.ID, "scope="+scope)
	return rec, nil
}

// RunCheck routes one check for a session:
//  1. authz: the session must belong to the caller,
//  2. CONSENT GATE (fail-closed): no consent → ErrConsentRequired,
//  3. idempotent check row on client_ref (a retry returns the stored outcome),
//  4. move the session UNVERIFIED→TIER_PENDING (guarded) on the first check,
//  5. route via the gateway (failover + breaker); persist encrypted raw payload,
//  6. guarded per-check status write + normalized result,
//  7. recompute the session via the orchestrator (may elevate the tier).
//
// The sync return is the persisted Check; a PENDING check completes later via the
// provider webhook (handler.go).
func (s *Service) RunCheck(ctx context.Context, userID, sessionID string, ct provider.KycCheckType, req provider.KycVerifyRequest) (*Check, error) {
	if userID == "" {
		return nil, ErrForbidden
	}
	if s.reg == nil {
		return nil, ErrProviderUnavailable
	}
	sess, err := s.repo.GetSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if sess.UserID != userID {
		return nil, ErrForbidden
	}

	// CONSENT GATE — fail closed, and SCOPE-AWARE (NDPA/CBN): biometric checks
	// require biometric consent; data checks require data-processing consent.
	has, err := s.consent.HasConsent(ctx, userID, requiredConsentScope(ct))
	if err != nil {
		return nil, err
	}
	if err := consentGate(has); err != nil {
		return nil, err
	}

	if req.ClientRef == "" {
		return nil, ErrInvalidRequest
	}
	req.UserID = userID
	req.Type = ct

	// Idempotent check row keyed by client_ref. A replay returns the stored row
	// without re-invoking the provider.
	stored, inserted, err := s.repo.InsertCheck(ctx, Check{
		SessionID: sessionID,
		UserID:    userID,
		Type:      ct,
		ClientRef: req.ClientRef,
	})
	if err != nil {
		return nil, err
	}
	if !inserted {
		if stored.UserID != userID {
			return nil, ErrForbidden
		}
		return stored, nil // idempotent replay
	}

	// First check moves the session into TIER_PENDING (guarded, idempotent).
	if sess.Status == SessUnverified && CanTransitionSession(SessUnverified, SessTierPending) {
		if err := s.repo.UpdateSessionStatus(ctx, sessionID, SessTierPending); err != nil {
			return nil, err
		}
	}

	// Route through the gateway (failover + breaker + facial gate).
	table := s.routingTable(ctx)
	gw := NewGateway(s.reg, table)
	gr, gerr := gw.Run(ctx, ct, req)
	if gerr != nil {
		// No provider answered — record the check as FAILED (guarded) so the
		// session can resolve; never leave it dangling at INITIATED.
		if terr := applyCheckTransition(stored.Status, provider.KycFailed); terr == nil {
			_ = s.repo.SetCheckStatus(ctx, stored.ID, provider.KycFailed, "no provider available")
		}
		return nil, gerr
	}

	// Encrypt + store the raw provider payload (AAD = check id). Never logged.
	rawRef := ""
	if len(gr.Result.Raw) > 0 {
		ref, perr := s.pii.Put(ctx, stored.ID, userID, gr.Provider, gr.Result.Raw)
		if perr != nil {
			// Fail closed: we do not persist a result whose raw payload could not
			// be sealed (compliance — raw PII is never stored in the clear).
			return nil, perr
		}
		rawRef = ref
	}

	// Guarded per-check status write.
	if err := applyCheckTransition(stored.Status, gr.Result.Status); err != nil {
		return nil, err
	}
	stored.Provider = gr.Provider
	stored.ProviderRef = gr.Result.ProviderRef
	stored.Status = gr.Result.Status
	stored.Match = gr.Result.Match
	stored.Confidence = gr.Result.Confidence
	stored.ExtractedFields = gr.Result.ExtractedFields
	stored.Reason = gr.Result.Reason
	stored.RawPayloadRef = rawRef
	if err := s.repo.UpdateCheckResult(ctx, stored); err != nil {
		return nil, err
	}
	s.audit(ctx, "kycverify.check.completed", userID, stored.ID,
		fmt.Sprintf("type=%s provider=%s status=%s", ct, gr.Provider, stored.Status))

	// Recompute the session (may elevate the tier when the full set passed).
	if _, err := s.orch.Recompute(ctx, sessionID); err != nil {
		// The check itself is persisted; surface the orchestration error so the
		// caller can retry (Recompute is idempotent).
		log.Printf("kycverify: recompute session=%s: %v", sessionID, err)
		return stored, err
	}
	return s.repo.GetCheck(ctx, stored.ID)
}

// ReviewQueue returns sessions awaiting human review with their checks.
func (s *Service) ReviewQueue(ctx context.Context, limit, offset int) ([]ReviewCase, error) {
	sessions, err := s.repo.ListReviewQueue(ctx, limit, offset)
	if err != nil {
		return nil, err
	}
	out := make([]ReviewCase, 0, len(sessions))
	for _, sess := range sessions {
		checks, err := s.repo.ListChecksForSession(ctx, sess.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, ReviewCase{Session: sess, Checks: checks})
	}
	return out, nil
}

// GetCase returns a single session + its checks for admin review (no owner check
// — the caller is RBAC-gated).
func (s *Service) GetCase(ctx context.Context, sessionID string) (*ReviewCase, error) {
	sess, err := s.repo.GetSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	checks, err := s.repo.ListChecksForSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	return &ReviewCase{Session: *sess, Checks: checks}, nil
}

// ApproveCase resolves a review to approval (may elevate tier), audited by admin.
func (s *Service) ApproveCase(ctx context.Context, sessionID, actorID, reason string) (SessionStatus, error) {
	st, err := s.orch.ResolveReview(ctx, sessionID, true, actorID)
	if err != nil {
		return "", err
	}
	s.audit(ctx, "kycverify.admin.approved", actorID, sessionID, reason)
	return st, nil
}

// RejectCase resolves a review to rejection, audited by admin.
func (s *Service) RejectCase(ctx context.Context, sessionID, actorID, reason string) (SessionStatus, error) {
	st, err := s.orch.ResolveReview(ctx, sessionID, false, actorID)
	if err != nil {
		return "", err
	}
	s.audit(ctx, "kycverify.admin.rejected", actorID, sessionID, reason)
	return st, nil
}

// ListRoutingRules returns the current routing rules for the admin console.
func (s *Service) ListRoutingRules(ctx context.Context) ([]RoutingRule, error) {
	return s.repo.ListRoutingRules(ctx)
}

// UpdateRoutingRule persists an admin edit to a routing rule.
func (s *Service) UpdateRoutingRule(ctx context.Context, actorID string, rule RoutingRule) error {
	if err := s.repo.UpsertRoutingRule(ctx, rule); err != nil {
		return err
	}
	s.audit(ctx, "kycverify.admin.routing_updated", actorID, string(rule.CheckType), fmt.Sprintf("providers=%v", rule.OrderedProviders))
	return nil
}

// consentGate is the pure fail-closed consent check: a check may only run when
// consent has been recorded. Extracted so the gate is unit-testable without a DB.
func consentGate(hasConsent bool) error {
	if !hasConsent {
		return ErrConsentRequired
	}
	return nil
}

// requiredConsentScope maps a check type to the consent scope it requires
// (NDPA/CBN purpose-binding). Biometric captures need biometric consent; data
// lookups need data-processing consent. These strings match what the mobile
// consent screen records (kyc-biometric / kyc-data-processing).
func requiredConsentScope(ct provider.KycCheckType) string {
	switch ct {
	case provider.KycIDFacial, provider.KycLiveness:
		return "kyc-biometric"
	default: // ID_NUMBER, DOCUMENT, AML
		return "kyc-data-processing"
	}
}

// audit emits a structured, log-style audit line. NEVER logs PII (BVN/NIN/
// selfies/document images). Only ids, types, statuses, provider names.
func (s *Service) audit(_ context.Context, event, userID, id, detail string) {
	log.Printf("audit kycverify event=%s user=%s id=%s detail=%s", event, userID, id, detail)
}

// Domain errors for the KYC verification gateway. The handler maps these to HTTP
// status codes (handler.go). Mirrors the maplerad model.go error vocabulary.
var (
	// ErrForbidden — object-level authz: caller does not own the resource. 403.
	ErrForbidden = errors.New("kycverify: not authorized for this resource")
	// ErrConsentRequired — a check was attempted before consent was recorded. 403.
	ErrConsentRequired = errors.New("kycverify: NDPA/CBN consent required before verification")
	// ErrNoProvider — the routing chain for a check type has no usable provider. 503.
	ErrNoProvider = errors.New("kycverify: no provider available for check type")
	// ErrProviderUnavailable — the gateway/registry is not configured. 503.
	ErrProviderUnavailable = errors.New("kycverify: provider gateway not configured")
	// ErrInvalidTier — target tier outside the 1..3 CBN range. 400.
	ErrInvalidTier = errors.New("kycverify: target tier must be between 1 and 3")
	// ErrNotFound — no session/check row for the lookup. 404.
	ErrNotFound = errors.New("kycverify: not found")
	// ErrIllegalTransition — a guarded state transition was rejected. 409.
	ErrIllegalTransition = errors.New("kycverify: illegal state transition")
	// ErrInvalidRequest — malformed / missing required field. 400.
	ErrInvalidRequest = errors.New("kycverify: invalid request")
)

// ReviewCase is the admin review-queue projection: a session plus its checks.
type ReviewCase struct {
	Session Session `json:"session"`
	Checks  []Check `json:"checks"`
}

// SessionStatus is the verification-session lifecycle (matches DB CHECK).
type SessionStatus string

const (
	SessUnverified   SessionStatus = "UNVERIFIED"
	SessTierPending  SessionStatus = "TIER_PENDING"
	SessTierVerified SessionStatus = "TIER_VERIFIED"
	SessTierFailed   SessionStatus = "TIER_FAILED"
	SessNeedsReview  SessionStatus = "NEEDS_REVIEW"
	SessApproved     SessionStatus = "APPROVED"
	SessRejected     SessionStatus = "REJECTED"
)

// Session is a user's attempt to reach a target CBN tier.
type Session struct {
	ID         string        `json:"id"`
	UserID     string        `json:"user_id"`
	TargetTier int           `json:"target_tier"`
	Status     SessionStatus `json:"status"`
	CreatedAt  time.Time     `json:"created_at"`
	UpdatedAt  time.Time     `json:"updated_at"`
}

// Check is the normalized result of one provider check (persisted).
type Check struct {
	ID              string                  `json:"id"`
	SessionID       string                  `json:"session_id"`
	UserID          string                  `json:"user_id"`
	Type            provider.KycCheckType   `json:"type"`
	Provider        string                  `json:"provider"`
	ProviderRef     string                  `json:"provider_ref"`
	ClientRef       string                  `json:"client_ref"`
	Status          provider.KycCheckStatus `json:"status"`
	Match           bool                    `json:"match"`
	Confidence      float64                 `json:"confidence"`
	ExtractedFields map[string]string       `json:"extracted_fields"`
	Reason          string                  `json:"reason"`
	RawPayloadRef   string                  `json:"raw_payload_ref,omitempty"`
	CreatedAt       time.Time               `json:"created_at"`
	UpdatedAt       time.Time               `json:"updated_at"`
}

// Consent is an NDPA/CBN consent record captured before any check.
type Consent struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Scope     string    `json:"scope"`
	Version   string    `json:"version"`
	GrantedAt time.Time `json:"granted_at"`
	IP        string    `json:"ip,omitempty"`
}

// Pure webhook-pipeline decision logic (no DB, no network). The webhook handler
// applies these decisions; keeping them pure makes the dedupe rule + terminal
// mapping independently unit-testable (mirrors maplerad/service.go).

// DedupeDecision is the pure outcome of the dedupe step. The handler INSERTs into
// webhook_event ON CONFLICT (provider,event_id) DO NOTHING; rowsInserted reports
// whether this delivery was new (1) or a redelivery (0).
type DedupeDecision struct {
	// Process is true only for a first-seen event (rowsInserted == 1).
	Process bool
	// AckNoOp is true for a redelivery — ACK 200 with no domain effect.
	AckNoOp bool
}

// DecideDedupe turns the INSERT … ON CONFLICT row count into a process/ack
// decision. Exactly one delivery of a given (provider,event_id) processes; every
// redelivery is a benign ACK no-op (idempotent).
func DecideDedupe(rowsInserted int64) DedupeDecision {
	if rowsInserted >= 1 {
		return DedupeDecision{Process: true}
	}
	return DedupeDecision{AckNoOp: true}
}

// TerminalDecision is the pure outcome of mapping a normalized webhook status to
// a check transition target.
type TerminalDecision struct {
	// Apply is true when the webhook carries a terminal status to persist.
	Apply bool
	// Target is the terminal check status to transition to (valid iff Apply).
	Target provider.KycCheckStatus
}

// DecideTerminal maps a normalized webhook status onto a terminal transition. A
// still-pending status (PENDING/INITIATED/empty) is a no-op (Apply=false) — the
// check stays PENDING until an authoritative terminal event arrives. PASSED,
// FAILED and REVIEW are terminal-ish targets applied through the guard.
func DecideTerminal(status provider.KycCheckStatus) TerminalDecision {
	switch status {
	case provider.KycPassed, provider.KycFailed, provider.KycReview:
		return TerminalDecision{Apply: true, Target: status}
	default:
		return TerminalDecision{Apply: false}
	}
}

// Capability routing + failover (pure). The resolver returns the ordered
// provider list for a check type; the gateway walks it, advancing to the next
// provider on adapter error or open circuit breaker. Rules are seeded from env
// and are admin-editable (kyc_routing_rule) — swapping a provider is config-only.

// RoutingRule is one admin-editable rule.
type RoutingRule struct {
	CheckType        provider.KycCheckType `json:"check_type"`
	OrderedProviders []string              `json:"ordered_providers"`
	Threshold        int                   `json:"threshold"`
	Enabled          bool                  `json:"enabled"`
}

// RoutingTable maps each check type to its rule.
type RoutingTable map[provider.KycCheckType]RoutingRule

// DefaultRoutingTable is the ADR-013 §1 default (used when the DB has no rows and
// no env override is present).
func DefaultRoutingTable() RoutingTable {
	return RoutingTable{
		provider.KycIDNumber: {CheckType: provider.KycIDNumber, OrderedProviders: []string{"dojah", "youverify"}, Threshold: 70, Enabled: true},
		provider.KycIDFacial: {CheckType: provider.KycIDFacial, OrderedProviders: []string{"dojah", "smileid"}, Threshold: 70, Enabled: true},
		provider.KycLiveness: {CheckType: provider.KycLiveness, OrderedProviders: []string{"dojah", "smileid"}, Threshold: 70, Enabled: true},
		provider.KycDocument: {CheckType: provider.KycDocument, OrderedProviders: []string{"dojah", "smileid"}, Threshold: 70, Enabled: true},
		provider.KycAML:      {CheckType: provider.KycAML, OrderedProviders: []string{"dojah", "youverify"}, Threshold: 70, Enabled: true},
	}
}

// parseOrder turns "youverify,dojah" into ["youverify","dojah"], trimming blanks.
func parseOrder(csv string) []string {
	parts := strings.Split(csv, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if s := strings.TrimSpace(p); s != "" {
			out = append(out, strings.ToLower(s))
		}
	}
	return out
}

// RoutingSeed carries the env-provided order strings (from config).
type RoutingSeed struct {
	IDNumber, IDFacial, Liveness, Document, AML string
	Threshold                                   int
}

// TableFromSeed builds a routing table from env seed strings, falling back to the
// ADR default for any check whose seed is empty.
func TableFromSeed(s RoutingSeed) RoutingTable {
	t := DefaultRoutingTable()
	th := s.Threshold
	if th <= 0 {
		th = 70
	}
	set := func(ct provider.KycCheckType, csv string) {
		if order := parseOrder(csv); len(order) > 0 {
			t[ct] = RoutingRule{CheckType: ct, OrderedProviders: order, Threshold: th, Enabled: true}
		} else {
			r := t[ct]
			r.Threshold = th
			t[ct] = r
		}
	}
	set(provider.KycIDNumber, s.IDNumber)
	set(provider.KycIDFacial, s.IDFacial)
	set(provider.KycLiveness, s.Liveness)
	set(provider.KycDocument, s.Document)
	set(provider.KycAML, s.AML)
	return t
}

// Resolve returns the ordered provider chain for a check type. Disabled rules and
// unknown types yield an empty chain (the gateway then reports no-provider).
func (t RoutingTable) Resolve(ct provider.KycCheckType) []string {
	r, ok := t[ct]
	if !ok || !r.Enabled {
		return nil
	}
	return r.OrderedProviders
}

// ThresholdFor returns the PASS/REVIEW confidence gate for a check type.
func (t RoutingTable) ThresholdFor(ct provider.KycCheckType) int {
	if r, ok := t[ct]; ok && r.Threshold > 0 {
		return r.Threshold
	}
	return 70
}

// TierElevator elevates a user's KYC tier. The kycverify package depends only on
// this narrow shape (never on the kyc package's concrete *Service / Profile type)
// so it stays decoupled and independently testable. It is satisfied by a thin
// adapter over *kyc.Service.Approve, wired in finance_routes.go (which UPDATEs
// user_profiles.kyc_tier/kyc_status + emits a kyc_events audit).
type TierElevator interface {
	ElevateTier(ctx context.Context, userID string, newTier int, actorID *string) error
}

// Orchestrator recomputes a session's status from its checks and drives the
// session state machine, elevating the user's tier ONLY when the full required
// check set for the target tier has passed (ResolveSessionStatus == TIER_VERIFIED).
// Every session write is guarded by CanTransitionSession.
type Orchestrator struct {
	pool     *pgxpool.Pool
	repo     *Repository
	elevator TierElevator
}

// NewOrchestrator builds the orchestrator. elevator may be nil (tier elevation
// is then skipped and logged — the session still resolves to TIER_VERIFIED, but
// the profile is not upgraded; this is only a degraded/dev configuration).
func NewOrchestrator(pool *pgxpool.Pool, repo *Repository, elevator TierElevator) *Orchestrator {
	return &Orchestrator{pool: pool, repo: repo, elevator: elevator}
}

// Recompute reloads the session's status-by-type, resolves the new session
// status, applies the guarded transition, and (only on TIER_VERIFIED) elevates
// the user's tier. Idempotent: a session already at the resolved status is a
// no-op. Returns the resolved status.
func (o *Orchestrator) Recompute(ctx context.Context, sessionID string) (SessionStatus, error) {
	sess, err := o.repo.GetSession(ctx, sessionID)
	if err != nil {
		return "", err
	}
	byType, err := o.repo.StatusByType(ctx, sessionID)
	if err != nil {
		return "", err
	}

	resolved := ResolveSessionStatus(sess.TargetTier, byType)

	// No change → nothing to persist (idempotent replay).
	if resolved == sess.Status {
		return resolved, nil
	}

	// Guard every session write. An unexpected edge is a hard error (never a
	// silent skip) so illegal orchestration is caught, not swallowed.
	if !CanTransitionSession(sess.Status, resolved) {
		return "", fmt.Errorf("%w: session %s→%s", ErrIllegalTransition, sess.Status, resolved)
	}

	if err := o.repo.UpdateSessionStatus(ctx, sessionID, resolved); err != nil {
		return "", err
	}
	o.audit(ctx, "kycverify.session.transition", sess.UserID, sessionID, string(resolved))

	// GUARD: elevate the tier ONLY on a fully-passed required set. This is the
	// single place a tier is raised, and it is unreachable unless resolved is
	// exactly TIER_VERIFIED (never on PENDING/REVIEW/FAILED).
	if resolved == SessTierVerified {
		if err := o.elevate(ctx, sess.UserID, sess.TargetTier, nil); err != nil {
			// Elevation failure must NOT leave the session claiming verified while
			// the profile lags — but the ledger/profile UPDATE is idempotent and
			// self-heals; log loudly and surface the error so the caller retries.
			return resolved, fmt.Errorf("kycverify: tier elevation for user=%s tier=%d: %w", sess.UserID, sess.TargetTier, err)
		}
	}
	return resolved, nil
}

// ResolveReview applies an admin review decision (APPROVED/REJECTED) to a session
// under review, guarded, and elevates the tier when the decision approves the
// full set. actorID is the admin id for the audit trail.
func (o *Orchestrator) ResolveReview(ctx context.Context, sessionID string, approve bool, actorID string) (SessionStatus, error) {
	sess, err := o.repo.GetSession(ctx, sessionID)
	if err != nil {
		return "", err
	}
	target := SessRejected
	if approve {
		// Approving a review is a manual override to TIER_VERIFIED (the state
		// machine allows NEEDS_REVIEW→TIER_VERIFIED).
		target = SessTierVerified
	}
	if !CanTransitionSession(sess.Status, target) {
		return "", fmt.Errorf("%w: review %s→%s", ErrIllegalTransition, sess.Status, target)
	}
	if err := o.repo.UpdateSessionStatus(ctx, sessionID, target); err != nil {
		return "", err
	}
	o.audit(ctx, "kycverify.review.resolved", sess.UserID, sessionID, string(target))

	if target == SessTierVerified {
		aid := actorID
		if err := o.elevate(ctx, sess.UserID, sess.TargetTier, &aid); err != nil {
			return target, fmt.Errorf("kycverify: review tier elevation user=%s: %w", sess.UserID, err)
		}
	}
	return target, nil
}

// elevate raises the user's tier via the injected elevator, guarded by a nil
// check. It is only ever called from a TIER_VERIFIED branch above.
func (o *Orchestrator) elevate(ctx context.Context, userID string, tier int, actorID *string) error {
	if o.elevator == nil {
		log.Printf("kycverify: tier elevator not configured — user=%s reached tier %d but profile NOT upgraded", userID, tier)
		return nil
	}
	if err := o.elevator.ElevateTier(ctx, userID, tier, actorID); err != nil {
		return err
	}
	o.audit(ctx, "kycverify.tier.elevated", userID, "", fmt.Sprintf("tier=%d", tier))
	return nil
}

// applyCheckTransition guards a per-check status change before persisting. Used by
// the webhook + admin review paths. A same-status write is idempotent; an illegal
// edge is ErrIllegalTransition.
func applyCheckTransition(from, to provider.KycCheckStatus) error {
	if !CanTransitionCheck(from, to) {
		return fmt.Errorf("%w: check %s→%s", ErrIllegalTransition, from, to)
	}
	return nil
}

// audit emits a structured, log-style audit line. Never logs PII.
func (o *Orchestrator) audit(_ context.Context, event, userID, id, detail string) {
	log.Printf("audit kycverify event=%s user=%s id=%s detail=%s", event, userID, id, detail)
}

// Guarded state machines (pure logic — no DB/network, unit-tested). Illegal
// transitions are structurally blocked; a tier never elevates without its full
// required check set passing.

// checkTransitions is the allowed per-check status graph.
//
//	INITIATED → PENDING → PASSED | FAILED | REVIEW  (terminal)
var checkTransitions = fsm.Table[provider.KycCheckStatus]{
	provider.KycInitiated: fsm.Set(provider.KycPending, provider.KycPassed, provider.KycFailed, provider.KycReview),
	provider.KycPending:   fsm.Set(provider.KycPassed, provider.KycFailed, provider.KycReview),
	provider.KycPassed:    nil,                                             // terminal
	provider.KycFailed:    nil,                                             // terminal
	provider.KycReview:    fsm.Set(provider.KycPassed, provider.KycFailed), // admin resolves a review
}

// CanTransitionCheck reports whether a check may move from → to.
func CanTransitionCheck(from, to provider.KycCheckStatus) bool {
	if from == to {
		return true // idempotent re-write of the same terminal status
	}
	return checkTransitions[from][to]
}

// sessionTransitions is the allowed session status graph.
var sessionTransitions = fsm.Table[SessionStatus]{
	SessUnverified:   fsm.Set(SessTierPending),
	SessTierPending:  fsm.Set(SessTierVerified, SessTierFailed, SessNeedsReview),
	SessNeedsReview:  fsm.Set(SessApproved, SessRejected, SessTierVerified, SessTierFailed),
	SessTierFailed:   fsm.Set(SessTierPending), // retry
	SessRejected:     fsm.Set(SessTierPending), // retry after rejection
	SessTierVerified: nil,                      // terminal (for this target tier)
	SessApproved:     nil,
}

// CanTransitionSession reports whether a session may move from → to.
func CanTransitionSession(from, to SessionStatus) bool {
	if from == to {
		return true
	}
	return sessionTransitions[from][to]
}

// RequiredChecks returns the check groups a target tier needs. Each inner group
// is an OR-set: at least one check in the group must PASS. All groups must be
// satisfied for the tier (§3 CBN model).
//
//	Tier 1: ID_NUMBER
//	Tier 2: Tier 1 + (ID_FACIAL OR LIVENESS)
//	Tier 3: Tier 2 + DOCUMENT + AML
func RequiredChecks(targetTier int) [][]provider.KycCheckType {
	switch targetTier {
	case 1:
		return [][]provider.KycCheckType{{provider.KycIDNumber}}
	case 2:
		return [][]provider.KycCheckType{
			{provider.KycIDNumber},
			{provider.KycIDFacial, provider.KycLiveness},
		}
	case 3:
		return [][]provider.KycCheckType{
			{provider.KycIDNumber},
			{provider.KycIDFacial, provider.KycLiveness},
			{provider.KycDocument},
			{provider.KycAML},
		}
	default:
		return nil
	}
}

// ResolveSessionStatus computes the session status from the current check
// statuses for a target tier. Precedence:
//   - any relevant check in REVIEW → NEEDS_REVIEW (human decides)
//   - every required group has a PASSED check → TIER_VERIFIED
//   - a required group is impossible (all its checks FAILED, none pending/review)
//     → TIER_FAILED
//   - otherwise → TIER_PENDING
//
// statusByType is the best-known status per check type in the session.
func ResolveSessionStatus(targetTier int, statusByType map[provider.KycCheckType]provider.KycCheckStatus) SessionStatus {
	groups := RequiredChecks(targetTier)
	if len(groups) == 0 {
		return SessUnverified
	}

	// Any review among relevant checks halts to human review.
	for _, g := range groups {
		for _, ct := range g {
			if statusByType[ct] == provider.KycReview {
				return SessNeedsReview
			}
		}
	}

	allGroupsPassed := true
	anyGroupImpossible := false
	for _, g := range groups {
		groupPassed := false
		groupCanStillPass := false
		for _, ct := range g {
			switch statusByType[ct] {
			case provider.KycPassed:
				groupPassed = true
			case provider.KycInitiated, provider.KycPending, "":
				groupCanStillPass = true
			}
		}
		if !groupPassed {
			allGroupsPassed = false
			if !groupCanStillPass {
				anyGroupImpossible = true // every option in the group failed
			}
		}
	}

	switch {
	case allGroupsPassed:
		return SessTierVerified
	case anyGroupImpossible:
		return SessTierFailed
	default:
		return SessTierPending
	}
}

// GateFacial applies the confidence threshold to a facial/document result:
// at/above threshold with a match → PASSED; a positive-but-low score → REVIEW
// (never a silent fail); an explicit non-match → FAILED.
func GateFacial(match bool, confidence float64, threshold int) provider.KycCheckStatus {
	if match && confidence >= float64(threshold) {
		return provider.KycPassed
	}
	if confidence > 0 {
		return provider.KycReview
	}
	return provider.KycFailed
}
