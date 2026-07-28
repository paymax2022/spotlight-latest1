package kycverify

import (
	"context"
	"fmt"
	"log"

	"spotlight/backend/internal/provider"
)

// WebhookService ingests provider callbacks/webhooks. Pipeline (hardened):
//  1. verify the signature via the provider's registered KycWebhookParser,
//  2. dedupe via webhook_event ON CONFLICT (provider,event_id) — redelivery is a
//     200 no-op,
//  3. parse into the normalized KycWebhookEvent,
//  4. find the check by client_ref,
//  5. guarded transition to the terminal status + persist normalized fields,
//  6. run the orchestrator (may elevate the tier),
//  7. audit.
//
// Idempotent: a redelivery of the same (provider,event_id) processes nothing.
type WebhookService struct {
	repo *Repository
	reg  *Registry
	pii  *PIIStore
	orch *Orchestrator
}

// NewWebhookService builds the webhook ingestion service. It shares the repo,
// registry, PII store and orchestrator with the member Service.
func (s *Service) NewWebhookService() *WebhookService {
	return &WebhookService{repo: s.repo, reg: s.reg, pii: s.pii, orch: s.orch}
}

// Verify reports whether the raw payload's signature is valid for a provider. A
// provider with no registered parser fails closed (unknown provider → false).
func (w *WebhookService) Verify(providerName string, payload []byte, signature string) bool {
	parser, ok := w.reg.ParserFor(providerName)
	if !ok {
		return false
	}
	return parser.VerifyKycSignature(payload, signature)
}

// Ingest processes one verified webhook delivery. The signature MUST already have
// been checked (handler calls Verify first). Returns nil for both a successful
// process and a benign redelivery no-op; a non-nil error is a genuine processing
// failure (the handler still ACKs 200 to stop provider retries, recording
// status=failed).
func (w *WebhookService) Ingest(ctx context.Context, providerName string, payload []byte) error {
	parser, ok := w.reg.ParserFor(providerName)
	if !ok {
		return fmt.Errorf("%w: unknown provider %q", ErrProviderUnavailable, providerName)
	}
	ev, err := parser.ParseKycWebhook(payload)
	if err != nil {
		return fmt.Errorf("kycverify: parse webhook %s: %w", providerName, err)
	}
	if ev == nil {
		return nil
	}

	eventID := ev.EventID
	if eventID == "" {
		// No event id surfaced — fall back to a deterministic dedupe key so we
		// still dedupe. Never drop.
		eventID = ev.ClientRef + ":" + string(ev.Status)
	}

	inserted, err := w.repo.InsertWebhookEvent(ctx, providerName, eventID, "kyc", payload)
	if err != nil {
		return err
	}
	if dec := DecideDedupe(boolToRows(inserted)); dec.AckNoOp {
		return nil // redelivery → ACK no-op
	}

	procErr := w.process(ctx, providerName, ev)

	status := "processed"
	if procErr != nil {
		status = "failed"
	}
	if merr := w.repo.MarkWebhookProcessed(ctx, providerName, eventID, status); merr != nil {
		log.Printf("kycverify: mark webhook processed provider=%s event=%s: %v", providerName, eventID, merr)
	}
	return procErr
}

// process correlates the event to a check by client_ref, applies the guarded
// terminal transition, and recomputes the session.
func (w *WebhookService) process(ctx context.Context, providerName string, ev *provider.KycWebhookEvent) error {
	if ev.ClientRef == "" {
		log.Printf("kycverify: webhook provider=%s missing client_ref — stored, no action", providerName)
		return nil
	}
	ch, err := w.repo.GetCheckByClientRef(ctx, ev.ClientRef)
	if err != nil {
		return err
	}

	dec := DecideTerminal(ev.Status)
	if !dec.Apply {
		return nil // still pending — leave the check as-is
	}
	// Idempotent: a redelivered terminal for an already-terminal check is a no-op
	// via the state machine's same-status rule.
	if err := applyCheckTransition(ch.Status, dec.Target); err != nil {
		return err
	}

	// Seal any raw payload the webhook carried (AAD = check id). Never logged.
	if len(ev.Raw) > 0 {
		if ref, perr := w.pii.Put(ctx, ch.ID, ch.UserID, providerName, ev.Raw); perr == nil {
			ch.RawPayloadRef = ref
		} else {
			log.Printf("kycverify: seal webhook payload check=%s: %v", ch.ID, perr)
		}
	}
	ch.Provider = providerName
	ch.ProviderRef = ev.ProviderRef
	ch.Status = dec.Target
	ch.Match = ev.Match
	ch.Confidence = ev.Confidence
	ch.Reason = ev.Reason
	if err := w.repo.UpdateCheckResult(ctx, ch); err != nil {
		return err
	}
	log.Printf("audit kycverify event=kycverify.webhook.applied user=%s id=%s detail=provider=%s status=%s",
		ch.UserID, ch.ID, providerName, dec.Target)

	// Recompute the session (may elevate the tier when the full set passed).
	if _, err := w.orch.Recompute(ctx, ch.SessionID); err != nil {
		return err
	}
	return nil
}

func boolToRows(b bool) int64 {
	if b {
		return 1
	}
	return 0
}
