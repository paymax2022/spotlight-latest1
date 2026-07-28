package claims

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/insurance/gateway"
)

// PolicyView is the slice of a policy the claims engine needs: it must verify the
// claimant owns an ACTIVE policy and resolve the provider policy ref for the
// FNOL hand-off. The policy package satisfies this; keeping it an interface
// avoids an import cycle (policy does not import claims).
type PolicyView struct {
	ID                string
	PolicyholderID    string
	Provider          string
	ProviderPolicyRef string // empty until the policy is bound at the provider
	State             string
	Currency          string
}

// PolicyReader resolves a policy for object-level authZ + provider hand-off.
type PolicyReader interface {
	// PolicyForClaim returns the policy view for a policy the caller owns, or an
	// error (ownership / not-found). It MUST enforce object-level authZ.
	PolicyForClaim(ctx context.Context, userID, policyID string) (PolicyView, error)
}

// DocumentStore issues signed-URL references for evidence objects. It is nil-safe:
// when nil the service stores the supplied storage_ref verbatim and skips signing.
type DocumentStore interface {
	// SignUpload returns a signed upload URL + the object key the client should
	// reference after upload. fileName/contentType drive the object key + headers.
	SignUpload(ctx context.Context, claimID, fileName, contentType string) (signedURL, storageRef string, err error)
}

// Notifier emits user-facing notifications (FNOL received / payout settled).
type Notifier interface {
	Notify(ctx context.Context, userID, kind, message string)
}

// Auditor appends an immutable audit event.
type Auditor interface {
	Audit(ctx context.Context, userID, action string, detail map[string]any)
}

// Service owns the claim lifecycle, the provider FNOL hand-off, evidence refs and
// the idempotent payout-on-settle money move. It REUSES the finance wallet/ledger
// (no new money primitives) and the gateway Router (provider-agnostic). It
// performs object-level authZ (the claimant must own the underlying policy).
type Service struct {
	repo   *Repository
	router *gateway.Router
	policy PolicyReader
	docs   DocumentStore
	wallet *wallet.Service
	ledger *ledger.Service
	notify Notifier
	audit  Auditor
}

// Deps bundles the service dependencies.
type Deps struct {
	Repo     *Repository
	Router   *gateway.Router
	Policy   PolicyReader
	Docs     DocumentStore
	Wallet   *wallet.Service
	Ledger   *ledger.Service
	Notifier Notifier
	Auditor  Auditor
}

// NewService constructs the claims service.
func NewService(d Deps) *Service {
	return &Service{
		repo:   d.Repo,
		router: d.Router,
		policy: d.Policy,
		docs:   d.Docs,
		wallet: d.Wallet,
		ledger: d.Ledger,
		notify: d.Notifier,
		audit:  d.Auditor,
	}
}

// Sentinel errors surfaced to handlers (mapped to HTTP codes there).
var (
	ErrForbidden       = errors.New("claims: caller does not own this claim/policy")
	ErrBadState        = errors.New("claims: illegal state transition")
	ErrPolicyNotActive = errors.New("claims: policy is not active")
	ErrNotBound        = errors.New("claims: policy has no provider reference")
)

// FNOLInput is the First-Notice-Of-Loss input from a claimant.
type FNOLInput struct {
	PolicyID          string
	LossEventAt       time.Time
	ClaimedAmountKobo int64
	Description       string
	Inputs            map[string]any
}

// SubmitFNOL files a claim: DRAFT → FNOL_SUBMITTED → provider hand-off. It is
// IDEMPOTENT on idempotencyKey — a retried FNOL with the same key returns the
// existing claim, never a second one. Object-level authZ: the claimant must own
// the underlying (ACTIVE, bound) policy.
func (s *Service) SubmitFNOL(ctx context.Context, userID string, in FNOLInput, idempotencyKey string) (*Claim, error) {
	if idempotencyKey == "" {
		return nil, fmt.Errorf("claims: Idempotency-Key required for FNOL")
	}

	// Idempotency: a retried FNOL returns the existing claim.
	if existing, err := s.repo.GetByIdempotencyKey(ctx, idempotencyKey); err == nil && existing != nil {
		if existing.ClaimantID != userID {
			return nil, ErrForbidden
		}
		return existing, nil
	}

	// Object-level authZ: claimant must own the policy.
	pv, err := s.policy.PolicyForClaim(ctx, userID, in.PolicyID)
	if err != nil {
		return nil, err
	}
	if pv.State != "ACTIVE" {
		return nil, ErrPolicyNotActive
	}
	if pv.ProviderPolicyRef == "" {
		return nil, ErrNotBound
	}

	currency := pv.Currency
	if currency == "" {
		currency = "NGN"
	}

	// (1) Create the claim in DRAFT.
	c, err := s.repo.Create(ctx, &Claim{
		PolicyID:          in.PolicyID,
		ClaimantID:        userID,
		Provider:          pv.Provider,
		State:             StateDraft,
		LossEventAt:       in.LossEventAt,
		ReportedAt:        time.Now().UTC(),
		Description:       in.Description,
		ClaimedAmountKobo: in.ClaimedAmountKobo,
		Currency:          currency,
		IdempotencyKey:    idempotencyKey,
	})
	if err != nil {
		// A racing duplicate may have inserted first — re-read by key.
		if existing, gErr := s.repo.GetByIdempotencyKey(ctx, idempotencyKey); gErr == nil && existing != nil {
			return existing, nil
		}
		return nil, err
	}

	// (2) Provider FNOL hand-off (idempotent at the provider on idempotencyKey).
	gw, ok := s.router.Adapter(pv.Provider)
	if !ok {
		// No adapter — leave the claim in DRAFT for an admin/reconciliation retry.
		s.auditSafe(ctx, userID, "insurance.claim.fnol_no_adapter", map[string]any{"claim_id": c.ID})
		return c, fmt.Errorf("claims: no adapter for provider %q", pv.Provider)
	}
	pc, fErr := gw.SubmitClaim(ctx, gateway.ClaimRequest{
		ProviderPolicyRef: pv.ProviderPolicyRef,
		LossEventAt:       in.LossEventAt,
		ClaimedAmountKobo: in.ClaimedAmountKobo,
		Description:       in.Description,
		IdempotencyKey:    idempotencyKey,
		Inputs:            in.Inputs,
	})
	if fErr != nil {
		// Provider hand-off failed; the claim stays in DRAFT (provider call is
		// idempotent on the key, so a retry is safe). Surface the error.
		s.auditSafe(ctx, userID, "insurance.claim.fnol_failed", map[string]any{"claim_id": c.ID})
		return c, fmt.Errorf("claims: provider FNOL failed: %w", fErr)
	}

	// (3) Record provider ref + advance DRAFT → FNOL_SUBMITTED atomically.
	if err := s.repo.SetProviderRef(ctx, c.ID, pc.ProviderClaimRef, StateFNOLSubmitted, c.Version); err != nil {
		log.Printf("[insurance] WARN: FNOL submitted at provider but persist failed for claim %s: %v", c.ID, err)
		return s.repo.Get(ctx, c.ID)
	}
	s.auditSafe(ctx, userID, "insurance.claim.fnol_submitted", map[string]any{
		"claim_id": c.ID, "provider": pv.Provider,
	})
	s.notifySafe(ctx, userID, "insurance.claim.received", "We've received your claim and it's now under review.")
	return s.repo.Get(ctx, c.ID)
}

// UploadEvidence attaches an evidence object reference to a claim the caller owns
// and forwards the ref to the provider. nil-safe document store: when no store is
// wired the supplied storageRef is stored verbatim.
func (s *Service) UploadEvidence(ctx context.Context, userID, claimID, fileName, contentType, storageRef string) (*Evidence, error) {
	c, err := s.ownedClaim(ctx, userID, claimID)
	if err != nil {
		return nil, err
	}

	ref := storageRef
	if s.docs != nil {
		_, signedRef, sErr := s.docs.SignUpload(ctx, claimID, fileName, contentType)
		if sErr == nil && signedRef != "" {
			ref = signedRef
		}
	}

	ev, err := s.repo.AddEvidence(ctx, &Evidence{
		ClaimID:     claimID,
		FileName:    fileName,
		ContentType: contentType,
		StorageRef:  ref,
	})
	if err != nil {
		return nil, err
	}

	// Forward the ref to the provider (best-effort; never the bytes, never PII).
	if c.ProviderClaimRef != nil && *c.ProviderClaimRef != "" {
		if gw, ok := s.router.Adapter(c.Provider); ok {
			_ = gw.UploadEvidence(ctx, gateway.EvidenceUpload{
				ProviderClaimRef: *c.ProviderClaimRef,
				FileName:         fileName,
				ContentType:      contentType,
				StorageRef:       ref,
			})
		}
	}
	s.auditSafe(ctx, userID, "insurance.claim.evidence_added", map[string]any{"claim_id": claimID})
	return ev, nil
}

// --- queries + object-level authZ ---

// GetClaim returns a claim the caller owns.
func (s *Service) GetClaim(ctx context.Context, userID, claimID string) (*Claim, error) {
	return s.ownedClaim(ctx, userID, claimID)
}

// ListClaims returns the caller's claims.
func (s *Service) ListClaims(ctx context.Context, userID string, limit, offset int) ([]Claim, error) {
	return s.repo.ListByUser(ctx, userID, limit, offset)
}

// ListEvidence returns the evidence refs for a claim the caller owns.
func (s *Service) ListEvidence(ctx context.Context, userID, claimID string) ([]Evidence, error) {
	if _, err := s.ownedClaim(ctx, userID, claimID); err != nil {
		return nil, err
	}
	return s.repo.ListEvidence(ctx, claimID)
}

func (s *Service) ownedClaim(ctx context.Context, userID, claimID string) (*Claim, error) {
	c, err := s.repo.Get(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if c.ClaimantID != userID {
		return nil, ErrForbidden
	}
	return c, nil
}

// --- transitions (admin/decisioning + provider-driven sync) ---

// transition applies a guarded state change with optimistic version.
func (s *Service) transition(ctx context.Context, c *Claim, to State) error {
	if !canTransition(c.State, to) {
		return fmt.Errorf("%w: %s → %s", ErrBadState, c.State, to)
	}
	if err := s.repo.SetState(ctx, c.ID, to, c.Version); err != nil {
		return err
	}
	c.State = to
	c.Version++
	return nil
}

// MoveToAssessment advances FNOL_SUBMITTED → UNDER_ASSESSMENT (provider/admin).
func (s *Service) MoveToAssessment(ctx context.Context, claimID string) (*Claim, error) {
	c, err := s.repo.Get(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if err := s.transition(ctx, c, StateUnderAssess); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, c.ID)
}

// RequestMoreInfo moves UNDER_ASSESSMENT → NEEDS_MORE_INFO.
func (s *Service) RequestMoreInfo(ctx context.Context, claimID string) (*Claim, error) {
	c, err := s.repo.Get(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if err := s.transition(ctx, c, StateNeedsMoreInfo); err != nil {
		return nil, err
	}
	s.notifySafe(ctx, c.ClaimantID, "insurance.claim.needs_info", "Your claim needs more information.")
	return s.repo.Get(ctx, c.ID)
}

// ResumeAssessment moves NEEDS_MORE_INFO → UNDER_ASSESSMENT (claimant supplied
// the requested info).
func (s *Service) ResumeAssessment(ctx context.Context, claimID string) (*Claim, error) {
	c, err := s.repo.Get(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if err := s.transition(ctx, c, StateUnderAssess); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, c.ID)
}

// Approve moves UNDER_ASSESSMENT → APPROVED with a provider-approved amount, then
// straight to PAYOUT_PENDING (ready for settlement).
func (s *Service) Approve(ctx context.Context, claimID string, approvedKobo int64) (*Claim, error) {
	c, err := s.repo.Get(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if !canTransition(c.State, StateApproved) {
		return nil, fmt.Errorf("%w: %s → APPROVED", ErrBadState, c.State)
	}
	if err := s.repo.SetApprovedAmount(ctx, c.ID, approvedKobo, c.Version); err != nil {
		return nil, err
	}
	c.State = StateApproved
	c.Version++
	c.ApprovedAmountKobo = approvedKobo
	if err := s.transition(ctx, c, StatePayoutPending); err != nil {
		return nil, err
	}
	s.auditSafe(ctx, c.ClaimantID, "insurance.claim.approved", map[string]any{
		"claim_id": c.ID, "approved_amount": approvedKobo,
	})
	return s.repo.Get(ctx, c.ID)
}

// Reject moves UNDER_ASSESSMENT → REJECTED (terminal; no money moves).
func (s *Service) Reject(ctx context.Context, claimID, reason string) (*Claim, error) {
	c, err := s.repo.Get(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if err := s.transition(ctx, c, StateRejected); err != nil {
		return nil, err
	}
	s.auditSafe(ctx, c.ClaimantID, "insurance.claim.rejected", map[string]any{"claim_id": c.ID, "reason": reason})
	s.notifySafe(ctx, c.ClaimantID, "insurance.claim.rejected", "Your claim could not be approved.")
	return s.repo.Get(ctx, c.ID)
}

// Settle executes the IDEMPOTENT payout money-move: PAYOUT_PENDING → SETTLED.
//
// The payout posts a CREDIT to the claimant's wallet via wallet.Credit (the same
// payout rail Paystack charges use: DR provider_clearing → CR user_wallet). It is
// idempotent on the CLAIM'S idempotency_key (suffixed ":payout"): the ledger
// unique constraint + insurance_claim_payout UNIQUE(idempotency_key) make a
// retried settlement a safe no-op. The payout amount is the provider-approved
// amount (claimed amount fallback). Money moves ONLY in this method, ONLY when
// the claim is PAYOUT_PENDING.
func (s *Service) Settle(ctx context.Context, claimID string) (*Claim, error) {
	c, err := s.repo.Get(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if c.State != StatePayoutPending {
		return nil, fmt.Errorf("%w: payout only from PAYOUT_PENDING, got %s", ErrBadState, c.State)
	}

	amount := c.ApprovedAmountKobo
	if amount <= 0 {
		amount = c.ClaimedAmountKobo
	}
	if amount <= 0 {
		return nil, fmt.Errorf("claims: nothing to pay out (amount=0) for claim %s", c.ID)
	}

	payoutKey := c.IdempotencyKey + ":payout"
	payoutRef := "insurance:claim_payout:" + c.ID

	// Pre-check the payout guard: if a payout already posted for this key, do not
	// re-credit; just ensure the claim is SETTLED.
	already, _ := s.repo.PayoutExists(ctx, payoutKey)
	if !already {
		// Idempotent CREDIT to the claimant's wallet via the existing payout rail.
		credErr := s.wallet.Credit(ctx, c.ClaimantID, payoutRef, payoutKey, amount)
		if credErr != nil && !errors.Is(credErr, ledger.ErrDuplicate) {
			s.auditSafe(ctx, c.ClaimantID, "insurance.claim.payout_failed", map[string]any{
				"claim_id": c.ID, "err": credErr.Error(),
			})
			return c, fmt.Errorf("claims: payout credit failed: %w", credErr)
		}
		if pErr := s.repo.InsertPayout(ctx, Payout{
			ClaimID:         c.ID,
			WalletLedgerRef: payoutRef,
			IdempotencyKey:  payoutKey,
			AmountKobo:      amount,
			Status:          "posted",
		}); pErr != nil {
			log.Printf("[insurance] WARN: payout credited but payout-row persist failed for claim %s: %v", c.ID, pErr)
		}
	}

	// Record the payout ledger ref + move to SETTLED atomically.
	if err := s.repo.SetSettled(ctx, c.ID, payoutRef, c.Version); err != nil {
		// A concurrent settle already moved the row; treat as success on re-read.
		if errors.Is(err, ErrConflict) {
			return s.repo.Get(ctx, c.ID)
		}
		return nil, err
	}
	s.auditSafe(ctx, c.ClaimantID, "insurance.claim.settled", map[string]any{
		"claim_id": c.ID, "amount": amount, "payout_ledger_ref": payoutRef,
	})
	s.notifySafe(ctx, c.ClaimantID, "insurance.claim.settled", "Your claim has been paid to your wallet.")
	return s.repo.Get(ctx, c.ID)
}

// --- admin ---

// SearchAdmin returns claims across users (admin; RBAC gated at the route).
func (s *Service) SearchAdmin(ctx context.Context, state, policyID string, limit, offset int) ([]Claim, error) {
	return s.repo.SearchAdmin(ctx, state, policyID, limit, offset)
}

// AdminGet returns a single claim (admin; RBAC gated at the route).
func (s *Service) AdminGet(ctx context.Context, claimID string) (*Claim, error) {
	return s.repo.Get(ctx, claimID)
}

// --- provider-driven sync (called by the webhooks package) ---

// ClaimByProviderRef resolves a claim from a (provider, provider_claim_ref) pair.
// Used by webhook ingestion to map a provider claim event back to our row.
func (s *Service) ClaimByProviderRef(ctx context.Context, provider, ref string) (*Claim, error) {
	return s.repo.GetByProviderRef(ctx, provider, ref)
}

// ApplyProviderClaimEvent applies a normalised provider claim event to the claim
// state machine. eventType is the gateway-normalised token
// (claim.updated|needs_info|approved|rejected|settled). It is tolerant of
// out-of-order/duplicate provider events: a transition that is not currently
// legal is logged and skipped (the webhook layer drops true duplicates upstream).
// approvedKobo is used only for claim.approved.
func (s *Service) ApplyProviderClaimEvent(ctx context.Context, claimID, eventType string, approvedKobo int64) error {
	c, err := s.repo.Get(ctx, claimID)
	if err != nil {
		return err
	}
	if isTerminal(c.State) {
		return nil // already SETTLED/REJECTED — nothing to apply.
	}
	switch eventType {
	case "claim.updated":
		// Provider acknowledged + began assessing.
		if canTransition(c.State, StateUnderAssess) {
			_, e := s.MoveToAssessment(ctx, claimID)
			return e
		}
	case "claim.needs_info":
		if canTransition(c.State, StateNeedsMoreInfo) {
			_, e := s.RequestMoreInfo(ctx, claimID)
			return e
		}
	case "claim.approved":
		if canTransition(c.State, StateApproved) {
			_, e := s.Approve(ctx, claimID, approvedKobo)
			return e
		}
	case "claim.rejected":
		if canTransition(c.State, StateRejected) {
			_, e := s.Reject(ctx, claimID, "provider rejected")
			return e
		}
	case "claim.settled":
		// Provider confirmed settlement — run the idempotent payout.
		if c.State == StatePayoutPending {
			_, e := s.Settle(ctx, claimID)
			return e
		}
	}
	log.Printf("[insurance] claim webhook %q not applicable in state %s for claim %s", eventType, c.State, claimID)
	return nil
}

// --- safe side-effect helpers (never fail the flow) ---

func (s *Service) auditSafe(ctx context.Context, userID, action string, detail map[string]any) {
	if s.audit != nil {
		s.audit.Audit(ctx, userID, action, detail)
	}
}

func (s *Service) notifySafe(ctx context.Context, userID, kind, message string) {
	if s.notify != nil {
		s.notify.Notify(ctx, userID, kind, message)
	}
}
