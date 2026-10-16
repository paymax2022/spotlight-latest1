package onboarding

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
)

// NormalizedAccountEvent is a provider-agnostic account-lifecycle event
// (account.approved / account.rejected / account.suspended / T&C). It is only
// a hint that something changed: HandleProviderStatus never trusts its status.
type NormalizedAccountEvent struct {
	EventID string
	// Name is the normalized event name, e.g. "account.approved".
	Name string
	// ProviderStatus is the raw status carried by the webhook (informational).
	ProviderStatus string
	// Reason is the rejection/suspension reason when the provider supplies one.
	Reason string
}

const defaultRejectionReason = "rejected by provider"

// maxApplyAttempts bounds the compare-and-set retry loop.
const maxApplyAttempts = 3

// HandleProviderStatus applies a provider account-lifecycle webhook.
//
// V6 gate (Verto webhook signing unconfirmed): the event is treated purely as
// a trigger. The authoritative status is re-read from the provider with
// GetSubAccount and THAT is what is applied, never the raw event payload.
// Remove only once V6 is closed and signing is verified.
//
// Transitions are monotonic (CanTransition + repository compare-and-set), a
// redelivery is a no-op, and wallets are provisioned (idempotently) on ACTIVE.
func (s *Service) HandleProviderStatus(ctx context.Context, companyID string, ev NormalizedAccountEvent) error {
	if strings.TrimSpace(companyID) == "" {
		log.Printf("onboarding webhook: %q has no company id — ignored", ev.Name)
		return nil
	}
	acct, err := s.d.Store.GetAccountByCompanyID(ctx, ProviderName, companyID)
	if err != nil {
		return err
	}
	if acct == nil {
		log.Printf("onboarding webhook: no account for company %q (event %q) — acknowledged", companyID, ev.Name)
		return nil
	}

	pa, err := s.d.Accounts.GetSubAccount(ctx, companyID) // GET-confirm (V6)
	if err != nil {
		return fmt.Errorf("onboarding webhook: confirm status: %w", err) // transient: let the provider redeliver
	}
	target := MapProviderStatus(pa.Status)
	if target == StatusNotStarted {
		log.Printf("onboarding webhook: company %q event %q confirmed status %q unmapped — no-op", companyID, ev.Name, pa.Status)
		return nil
	}

	defer s.locks.lock("user:" + acct.UserID)()
	for attempt := 0; attempt < maxApplyAttempts; attempt++ {
		cur, err := s.d.Store.GetAccountByCompanyID(ctx, ProviderName, companyID)
		if err != nil {
			return err
		}
		if cur == nil {
			return nil
		}
		err = s.applyStatus(ctx, cur, target, ev)
		if errors.Is(err, ErrStaleStatus) {
			continue // lost a race; re-read and re-evaluate
		}
		return err
	}
	return fmt.Errorf("onboarding webhook: company %q: status kept changing under us", companyID)
}

func (s *Service) applyStatus(ctx context.Context, cur *GlobalAccount, target Status, ev NormalizedAccountEvent) error {
	if cur.Status == target {
		if target == StatusActive {
			return s.ensureWallets(ctx, cur) // idempotent; also retries a failed provisioning
		}
		return nil
	}

	// Un-suspend: reinstate to where the account was, not to what the
	// provider happens to call "active". Only an ACTIVE confirmation is an
	// un-suspension; any other confirmed status (REJECTED, PENDING) is applied
	// as-is, subject to CanTransition, never overridden by PriorStatus.
	if cur.Status == StatusSuspended && target == StatusActive {
		if cur.PriorStatus != "" && CanTransition(StatusSuspended, cur.PriorStatus) {
			target = cur.PriorStatus
		}
	}

	// The provider may have advanced past states whose events we missed.
	if cur.Status == StatusSubmitted && (target == StatusActive || target == StatusRejected || target == StatusAwaitingTnC) {
		if err := s.step(ctx, cur, StatusInReview, StatusUpdate{}); err != nil {
			return err
		}
	}

	if !CanTransition(cur.Status, target) {
		// Stale/regressing event, or one we cannot honour (e.g. SUSPENDED for an
		// account we hold as NOT_STARTED/REJECTED). Never silent.
		log.Printf("onboarding webhook: refused %s -> %s for company %q (event %q) — no change",
			cur.Status, target, cur.ProviderCompanyID, ev.Name)
		return nil
	}

	var u StatusUpdate
	switch target {
	case StatusRejected:
		u.RejectionReason = ev.Reason
		if strings.TrimSpace(u.RejectionReason) == "" {
			u.RejectionReason = defaultRejectionReason
		}
	case StatusSuspended:
		u.PriorStatus = cur.Status
	case StatusActive:
		if cur.ApprovedAt == nil {
			now := s.d.Clock.Now()
			u.ApprovedAt = &now
		}
	}
	// NOTE: consent is NOT recorded on the no-T&C approval path (approved ->
	// ACTIVE). AcceptTnC/onboarding_consents are dormant in SP-2 — pending the
	// compliance decision (see the ADR-PR800 go-live gate; pinned by
	// TestHandleProviderStatus_ApprovalRecordsNoConsent).
	if err := s.step(ctx, cur, target, u); err != nil {
		return err
	}
	if target == StatusActive {
		return s.ensureWallets(ctx, cur)
	}
	return nil
}

// step performs one compare-and-set transition and mirrors it on cur.
func (s *Service) step(ctx context.Context, cur *GlobalAccount, to Status, u StatusUpdate) error {
	if err := s.d.Store.UpdateStatus(ctx, cur.ID, cur.Status, to, u); err != nil {
		return err
	}
	cur.Status = to
	return nil
}
