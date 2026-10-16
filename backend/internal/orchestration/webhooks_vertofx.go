package orchestration

import (
	"context"
	"encoding/json"
	"log"
	"strings"

	"spotlight/backend/internal/crossborder/onboarding"
)

// VertoFX webhook ingestion (SP-1 Task 6).
//
// Signature policy: Verto's signing scheme is still an OPEN gate (V6 in
// docs/superpowers/plans/2026-10-16-vertofx-spotlight-global-program.md). Until
// it is confirmed the adapter verifies HMAC-SHA256 over the raw body and FAILS
// CLOSED on an empty secret or signature. The intended belt-and-braces policy —
// IP allowlist plus a GET-confirm of every event against Verto before state is
// applied — is NOT implemented in SP-1; the route stays dark behind
// FEATURE_VERTOFX. Do not enable it for real money before V6 is closed.
//
// Verto documents THREE conflicting event vocabularies (spec §11.1, V7):
//
//	1. iban_to_wallet / remittance_complete / wallet_to_account
//	2. funds.received / payment.* / fx.*
//	3. sub_account_approved / transaction_state_change / inbound_payment
//
// NormalizeVertoEvent folds all of them into one provider-agnostic set.

// Normalized Verto event names.
const (
	vevCollectionRequested = "collection.requested"
	vevCollectionCompleted = "collection.completed"
	vevCollectionReturned  = "collection.returned"
	vevFXExecuted          = "fx.executed"
	vevFXFailed            = "fx.failed"
	vevPayoutRequested     = "payout.requested"
	vevPayoutProcessing    = "payout.processing"
	vevPayoutCompleted     = "payout.completed"
	vevPayoutFailed        = "payout.failed"
	vevPayoutCancelled     = "payout.cancelled"
	vevComplianceHold      = "compliance.hold"
	vevRefundCompleted     = "refund.completed"
)

func vertoKey(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	return strings.NewReplacer(" ", "_", "-", "_").Replace(s)
}

// NormalizeVertoEvent maps a Verto event name (and, for the state-change style
// events, its status) to the normalized set. It returns "" for an unknown name
// or status; callers must log and ignore it, never guess a state.
func NormalizeVertoEvent(event, status string) string {
	ev, st := vertoKey(event), vertoKey(status)
	switch ev {
	// Vocabulary 1.
	case "iban_to_wallet":
		return vevCollectionCompleted
	case "remittance_complete":
		return vevPayoutCompleted
	case "wallet_to_account":
		return vevPayoutRequested
	// Vocabulary 2.
	case "funds.received":
		return vevCollectionRequested
	case "payment.requested":
		return vevPayoutRequested
	case "payment.processing":
		return vevPayoutProcessing
	case "payment.completed":
		return vevPayoutCompleted
	case "payment.failed":
		return vevPayoutFailed
	case "payment.cancelled", "payment.canceled":
		return vevPayoutCancelled
	case "fx.executed":
		return vevFXExecuted
	case "fx.failed":
		return vevFXFailed
	// Vocabulary 3.
	case "sub_account_approved":
		return "account.approved"
	case "transaction_state_change":
		return vertoPayoutStatus(st)
	case "inbound_payment":
		switch st {
		case "requested":
			return vevCollectionRequested
		case "completed":
			return vevCollectionCompleted
		case "returned":
			return vevCollectionReturned
		}
		return ""
	// Already-normalized names.
	case vevCollectionRequested, vevCollectionCompleted, vevCollectionReturned,
		vevPayoutRequested, vevPayoutProcessing, vevPayoutCompleted, vevPayoutFailed, vevPayoutCancelled,
		vevComplianceHold, vevRefundCompleted, "account.approved", "account.rejected", "account.suspended":
		return ev
	}
	return ""
}

// vertoPayoutStatus maps a transaction_state_change status (spec §23.3).
func vertoPayoutStatus(st string) string {
	switch st {
	case "inward_remittance_pending":
		return vevPayoutRequested
	case "confirmed", "inward_remittance_confirmed", "inwardsettlementdone", "requested":
		return vevPayoutProcessing
	case "outwardsettlementdone", "outward_remittance_complete", "completed":
		return vevPayoutCompleted
	// `archived` covers cancellations AND outward failures (V7): cause unknown,
	// funds return to the wallet either way.
	case "archived", "refunded":
		return vevPayoutFailed
	}
	if strings.Contains(st, "hold") || strings.Contains(st, "review") || strings.Contains(st, "rfi") {
		return vevComplianceHold
	}
	return ""
}

// AccountLifecycleApplier applies a normalized account-lifecycle event
// (SP-2); satisfied by *onboarding.Service.
type AccountLifecycleApplier interface {
	HandleProviderStatus(ctx context.Context, companyID string, ev onboarding.NormalizedAccountEvent) error
}

// WithAccountLifecycle attaches the applier for account.* webhooks.
func WithAccountLifecycle(a AccountLifecycleApplier) ServiceOption {
	return func(s *Service) { s.accountEvents = a }
}

// handleVertoAccountEvent routes an account.* event to the onboarding service.
// The event is only a trigger; the applier GET-confirms the status.
func (s *Service) handleVertoAccountEvent(ctx context.Context, id, norm, status, companyID, reason string) error {
	if strings.TrimSpace(companyID) == "" {
		log.Printf("[fx] vertofx webhook: %s without a company id (id=%q) — logged, no state change", norm, id)
		return nil
	}
	if s.accountEvents == nil {
		log.Printf("[fx] vertofx webhook: %s (company=%q) recognised, no onboarding applier wired", norm, companyID)
		return nil
	}
	return s.accountEvents.HandleProviderStatus(ctx, companyID, onboarding.NormalizedAccountEvent{
		EventID: id, Name: norm, ProviderStatus: status, Reason: reason,
	})
}

// transferRank orders transfer states so webhooks can only move forward.
func transferRank(s TransferStatus) int {
	switch s {
	case TransferQueued:
		return 0
	case TransferProcessing:
		return 1
	default: // paid, failed, reversed — terminal
		return 2
	}
}

// handleVertoFXEvent applies a Verto webhook. Verto's envelope is flat
// ({id,event,paymentId,status}); the record is found by provider ref. Only
// forward transitions apply and terminal states are never rewritten, so
// out-of-order or redelivered events are harmless.
func (s *Service) handleVertoFXEvent(ctx context.Context, payload []byte) error {
	var ev struct {
		ID        string `json:"id"`
		Event     string `json:"event"`
		Type      string `json:"type"`
		PaymentID string `json:"paymentId"`
		Status    string `json:"status"`
		CompanyID string `json:"companyId"`
		Reason    string `json:"reason"`
		Data      struct {
			PaymentID string `json:"paymentId"`
			Status    string `json:"status"`
			CompanyID string `json:"companyId"`
			Reason    string `json:"reason"`
		} `json:"data"`
	}
	if err := json.Unmarshal(payload, &ev); err != nil {
		return err
	}
	name := ev.Event
	if strings.TrimSpace(name) == "" {
		name = ev.Type
	}
	status, ref := ev.Status, ev.PaymentID
	if status == "" {
		status = ev.Data.Status
	}
	if ref == "" {
		ref = ev.Data.PaymentID
	}

	norm := NormalizeVertoEvent(name, status)
	if norm == "" {
		log.Printf("[fx] vertofx webhook: unknown event %q status %q (id=%q) — logged, no state change", name, status, ev.ID)
		return nil
	}
	if strings.HasPrefix(norm, "account.") {
		company, reason := ev.CompanyID, ev.Reason
		if company == "" {
			company = ev.Data.CompanyID
		}
		if reason == "" {
			reason = ev.Data.Reason
		}
		return s.handleVertoAccountEvent(ctx, ev.ID, norm, status, company, reason)
	}
	if strings.TrimSpace(ref) == "" {
		return nil // nothing actionable
	}

	switch norm {
	case vevPayoutRequested, vevPayoutProcessing, vevPayoutCompleted, vevPayoutFailed, vevPayoutCancelled:
		return s.applyVertoPayout(ctx, ref, norm)
	case vevFXExecuted, vevFXFailed:
		return s.applyVertoFX(ctx, ref, norm)
	default:
		// collection.*, account.*, compliance.hold, refund.completed: recognised
		// and acknowledged, deliberately NOT applied in SP-1. Crediting inbound
		// money needs V6 (signature) + GET-confirm and the SP-5 collections work.
		log.Printf("[fx] vertofx webhook: %s (ref=%q) recognised, not applied in SP-1", norm, ref)
		return nil
	}
}

func (s *Service) applyVertoPayout(ctx context.Context, ref, norm string) error {
	all, err := s.store.AllTransfers(ctx)
	if err != nil {
		return err
	}
	var tr *Transfer
	for _, t := range all {
		if t.ProviderRef == ref || t.Reference == ref {
			tr = t
			break
		}
	}
	if tr == nil {
		log.Printf("[fx] vertofx webhook: no transfer for ref %q — acknowledged", ref)
		return nil
	}
	var target TransferStatus
	switch norm {
	case vevPayoutRequested:
		target = TransferQueued
	case vevPayoutProcessing:
		target = TransferProcessing
	case vevPayoutCompleted:
		target = TransferPaid
	default: // failed, cancelled
		target = TransferFailed
	}
	if transferRank(tr.Status) >= 2 || transferRank(target) <= transferRank(tr.Status) {
		return nil // terminal already, or not a forward move
	}
	if target == TransferFailed {
		if _, err := s.store.RefundTransfer(ctx, tr.Reference, string(target)); err != nil {
			return err // transient: let Verto redeliver
		}
	} else if err := s.store.UpdateTransferStatus(ctx, tr.Reference, string(target)); err != nil {
		return err
	}
	s.emit(ctx, "transfer."+string(target), map[string]any{"reference": tr.Reference, "status": string(target), "provider": "vertofx"})
	return nil
}

func (s *Service) applyVertoFX(ctx context.Context, ref, norm string) error {
	all, err := s.store.AllConversions(ctx)
	if err != nil {
		return err
	}
	for _, c := range all {
		if c.ProviderRef != ref && c.Reference != ref {
			continue
		}
		if c.Status != ConvPending {
			return nil // settled/failed are terminal
		}
		target := ConvSettled
		if norm == vevFXFailed {
			target = ConvFailed
		}
		if err := s.store.UpdateConversionStatus(ctx, c.Reference, string(target)); err != nil {
			return err
		}
		s.emit(ctx, "conversion."+string(target), map[string]any{"reference": c.Reference, "status": string(target), "provider": "vertofx"})
		return nil
	}
	log.Printf("[fx] vertofx webhook: no conversion for ref %q — acknowledged", ref)
	return nil
}
