package kycverify

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"

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
//
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

// ── StartSession ─────────────────────────────────────────────────────────────

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

// ── RecordConsent ────────────────────────────────────────────────────────────

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

// ── RunCheck ─────────────────────────────────────────────────────────────────

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
// provider webhook (webhook.go).
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

// ── admin ────────────────────────────────────────────────────────────────────

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
