package webhooks

import (
	"context"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log"
	"net/http"
	"spotlight/backend/go-common/strutil"
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

// Register wires the UNAUTHENTICATED, signature-verified provider webhook routes.
//   - webhooks (no auth; provider-signed; idempotent on (provider, external_event_id)):
//     POST /internal/webhooks/mycover
//     POST /internal/webhooks/octamile
func Register(webhooks *gin.RouterGroup, h *Handler) {
	g := webhooks.Group("/internal/webhooks")
	g.POST("/mycover", h.MyCover)
	g.POST("/octamile", h.Octamile)
}

// Handler exposes the provider webhook ingestion routes. These routes are
// UNAUTHENTICATED (the provider calls them directly) but every request is
// signature-verified via the adapter before any state change.
type Handler struct {
	svc *Service
}

// NewHandler constructs the webhooks handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// MyCover (webhook): POST /internal/webhooks/mycover
func (h *Handler) MyCover(c *gin.Context) { h.ingest(c, "mycover") }

// Octamile (webhook): POST /internal/webhooks/octamile
func (h *Handler) Octamile(c *gin.Context) { h.ingest(c, "octamile") }

// ingest reads the raw body, pulls the signature header and hands off to the
// service. The raw body is never logged.
// The signature header name comes from the ADAPTER, not from the URL slug.
// Deriving it from the slug is what broke this before: MyCover is mounted at
// /internal/webhooks/mycover but signs with "x-mycoverai-signature", so a
// derived "X-mycover-Signature" never matched, the signature arrived empty, and
// every genuine delivery was rejected with a 401 that named no cause. Generic
// header names remain as fallbacks for adapters that declare none.
func (h *Handler) ingest(c *gin.Context, provider string) {
	payload, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot read body"})
		return
	}
	signature := ""
	if hdr := h.svc.SignatureHeaderFor(provider); hdr != "" {
		signature = c.GetHeader(hdr)
	}
	signature = strutil.FirstNonEmpty(
		signature,
		c.GetHeader("X-Signature"),
		c.GetHeader("X-Webhook-Signature"),
	)
	out, err := h.svc.Ingest(c.Request.Context(), provider, payload, signature)
	if err != nil {
		switch {
		case errors.Is(err, ErrUnknownProvider):
			c.JSON(http.StatusNotFound, gin.H{"error": "unknown provider"})
		case errors.Is(err, ErrBadSignature):
			// Reject unverified events (do NOT 200 — provider must retry/alert).
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}
	// Always 200 once verified + recorded (duplicates included) so the provider
	// stops retrying.
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Repository persists the provider-event idempotency ledger and applies
// provider-driven POLICY state changes (claim state changes are delegated to the
// claims service). All queries are parameterized; raw provider JSON is never
// written (only the external_event_id + normalised type + refs).
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the webhooks repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// RecordEvent inserts the (provider, external_event_id) idempotency row. It
// returns inserted=false when the event was already seen (duplicate webhook), so
// the caller can drop it. UNIQUE(provider, external_event_id) is the hard guard.
func (r *Repository) RecordEvent(ctx context.Context, provider, externalEventID, eventType string) (bool, error) {
	var err error

	// Guard the RECEIVER, not just the pool: this is reached from an
	// UNAUTHENTICATED endpoint, so a nil repository must return an error the
	// handler can turn into a 4xx/5xx, never a panic that takes the process with
	// it. `r.db` alone dereferences nil.
	if r == nil || r.db == nil {
		return false, errors.New("webhooks: repository not configured")
	}
	ct, err := r.db.Exec(ctx, `
		INSERT INTO public.insurance_provider_event (provider, external_event_id, event_type)
		VALUES ($1,$2,$3)
		ON CONFLICT (provider, external_event_id) DO NOTHING`,
		provider, externalEventID, eventType)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() == 1, nil
}

// PolicyByProviderRef returns (policyID, state, version, found) for a policy by
// its (provider, provider_policy_ref).
func (r *Repository) PolicyByProviderRef(ctx context.Context, provider, ref string) (string, string, int, bool, error) {
	var id string
	var state string
	var version int
	var err error

	if r == nil || r.db == nil {
		return "", "", 0, false, errors.New("webhooks: repository not configured")
	}
	err = r.db.QueryRow(ctx, `
		SELECT id, state, version FROM public.insurance_policy
		WHERE provider = $1 AND provider_policy_ref = $2 LIMIT 1`, provider, ref).Scan(&id, &state, &version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", 0, false, nil
		}
		return "", "", 0, false, err
	}
	return id, state, version, true, nil
}

// SetPolicyState applies a provider-driven policy state change (version-guarded).
// Used for policy.bound/cancelled/lapsed/expired. Returns false when the guard
// (version) did not match (a concurrent update won — safe to ignore).
func (r *Repository) SetPolicyState(ctx context.Context, id, toState string, expectVersion int) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("webhooks: repository not configured")
	}
	ct, err := r.db.Exec(ctx, `
		UPDATE public.insurance_policy
		SET state = $2, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $3`, id, toState, expectVersion)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() == 1, nil
}
