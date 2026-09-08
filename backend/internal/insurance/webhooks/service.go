package webhooks

import (
	"context"
	"fmt"
	"log"

	"spotlight/backend/internal/insurance/claims"
	"spotlight/backend/internal/insurance/gateway"
)

// ClaimSync is the slice of the claims service the webhook engine needs to apply
// provider-driven claim events. The claims package satisfies this; keeping it an
// interface avoids a hard dependency direction problem and keeps webhooks thin.
type ClaimSync interface {
	ClaimByProviderRef(ctx context.Context, provider, ref string) (*claims.Claim, error)
	ApplyProviderClaimEvent(ctx context.Context, claimID, eventType string, approvedKobo int64) error
}

// Service ingests signature-verified provider webhooks and applies the normalised
// events to policy/claim state. It is IDEMPOTENT on (provider, external_event_id):
// a duplicate webhook is recorded once and dropped. The raw provider JSON never
// crosses the adapter boundary (VerifyWebhook returns a normalised event) and is
// never logged.
type Service struct {
	router *gateway.Router
	repo   *Repository
	claims ClaimSync
}

// NewService constructs the webhook ingestion service.
func NewService(router *gateway.Router, repo *Repository, claimSync ClaimSync) *Service {
	return &Service{router: router, repo: repo, claims: claimSync}
}

// SignatureHeaderFor returns the HTTP header the named aggregator delivers its
// webhook signature in, or "" when the provider is unknown or declares none.
// The handler uses it to read the right header instead of guessing one from the
// route.
func (s *Service) SignatureHeaderFor(provider string) string {
	if s == nil || s.router == nil {
		return ""
	}
	gw, ok := s.router.Adapter(provider)
	if !ok {
		return ""
	}
	return gw.WebhookSignatureHeader()
}

// Sentinel errors.
var (
	ErrUnknownProvider = fmt.Errorf("webhooks: unknown provider")
	ErrBadSignature    = fmt.Errorf("webhooks: signature verification failed")
)

// Outcome describes how an inbound webhook was handled (for the HTTP response;
// it carries NO PII).
type Outcome struct {
	Provider  string `json:"provider"`
	EventType string `json:"event_type"`
	Applied   bool   `json:"applied"`
	Duplicate bool   `json:"duplicate"`
	Reason    string `json:"reason,omitempty"`
}

// Ingest verifies + applies a provider webhook. provider is taken from the route
// path (mycover|octamile); the adapter VerifyWebhook validates the signature and
// returns the normalised event. Unverified events are rejected.
func (s *Service) Ingest(ctx context.Context, provider string, payload []byte, signature string) (*Outcome, error) {
	gw, ok := s.router.Adapter(provider)
	if !ok {
		return nil, ErrUnknownProvider
	}

	ev, err := gw.VerifyWebhook(ctx, payload, signature)
	if err != nil {
		return nil, fmt.Errorf("webhooks: verify: %w", err)
	}
	if !ev.SignatureValid {
		return nil, ErrBadSignature
	}
	if ev.ExternalEventID == "" {
		return nil, fmt.Errorf("webhooks: missing external_event_id")
	}

	// Idempotency: record (provider, external_event_id). Duplicate → drop.
	inserted, err := s.repo.RecordEvent(ctx, provider, ev.ExternalEventID, ev.EventType)
	if err != nil {
		return nil, err
	}
	if !inserted {
		return &Outcome{Provider: provider, EventType: ev.EventType, Duplicate: true}, nil
	}

	out := &Outcome{Provider: provider, EventType: ev.EventType}
	switch normaliseFamily(ev.EventType) {
	case familyPolicy:
		applied, reason := s.applyPolicyEvent(ctx, provider, ev)
		out.Applied = applied
		out.Reason = reason
	case familyClaim:
		applied, reason := s.applyClaimEvent(ctx, provider, ev)
		out.Applied = applied
		out.Reason = reason
	default:
		out.Reason = "unhandled event type"
		log.Printf("[insurance][webhook] unhandled event type %q from %s", ev.EventType, provider)
	}
	return out, nil
}

// applyPolicyEvent maps a normalised policy event to a policy state change.
//
//	policy.bound     -> ACTIVE
//	policy.cancelled -> CANCELLED
//	policy.lapsed    -> EXPIRED
//	policy.expired   -> EXPIRED
func (s *Service) applyPolicyEvent(ctx context.Context, provider string, ev gateway.WebhookEvent) (bool, string) {
	if ev.ProviderPolicyRef == "" {
		return false, "missing provider_policy_ref"
	}
	id, _, version, found, err := s.repo.PolicyByProviderRef(ctx, provider, ev.ProviderPolicyRef)
	if err != nil {
		log.Printf("[insurance][webhook] policy lookup failed: %v", err)
		return false, "policy lookup failed"
	}
	if !found {
		return false, "policy not found for provider ref"
	}
	target, ok := policyTargetState(ev.EventType)
	if !ok {
		return false, "no policy state for event"
	}
	applied, err := s.repo.SetPolicyState(ctx, id, target, version)
	if err != nil {
		log.Printf("[insurance][webhook] policy state update failed: %v", err)
		return false, "policy state update failed"
	}
	if !applied {
		// version mismatch — a concurrent update won; treat as applied-elsewhere.
		return false, "policy already updated"
	}
	return true, ""
}

// applyClaimEvent maps a normalised claim event onto the claim state machine.
func (s *Service) applyClaimEvent(ctx context.Context, provider string, ev gateway.WebhookEvent) (bool, string) {
	if s.claims == nil {
		return false, "claim sync not wired"
	}
	if ev.ProviderClaimRef == "" {
		return false, "missing provider_claim_ref"
	}
	cl, err := s.claims.ClaimByProviderRef(ctx, provider, ev.ProviderClaimRef)
	if err != nil || cl == nil {
		return false, "claim not found for provider ref"
	}
	// approved amount is carried on the claim row (set by the provider FNOL/quote)
	// — for claim.approved the provider's approved amount is already normalised by
	// the adapter into the claim via GetClaim sync; here we pass the claimed amount
	// as the floor so a payout is never zero. The claims service clamps to the
	// approved amount when present.
	approvedKobo := cl.ApprovedAmountKobo
	if approvedKobo <= 0 {
		approvedKobo = cl.ClaimedAmountKobo
	}
	if err := s.claims.ApplyProviderClaimEvent(ctx, cl.ID, ev.EventType, approvedKobo); err != nil {
		log.Printf("[insurance][webhook] claim event apply failed: %v", err)
		return false, "claim event apply failed"
	}
	return true, ""
}

// --- event family classification + state mapping ---

type family int

const (
	familyUnknown family = iota
	familyPolicy
	familyClaim
)

func normaliseFamily(eventType string) family {
	switch eventType {
	case "policy.bound", "policy.cancelled", "policy.lapsed", "policy.expired":
		return familyPolicy
	case "claim.updated", "claim.needs_info", "claim.approved", "claim.rejected", "claim.settled":
		return familyClaim
	default:
		return familyUnknown
	}
}

func policyTargetState(eventType string) (string, bool) {
	switch eventType {
	case "policy.bound":
		return "ACTIVE", true
	case "policy.cancelled":
		return "CANCELLED", true
	case "policy.lapsed", "policy.expired":
		return "EXPIRED", true
	default:
		return "", false
	}
}
