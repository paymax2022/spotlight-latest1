package symptomsearch

// Review-case engine (pharmacy_review_cases) — the gated state machine that
// keeps the licence (PRD §6):
//
//	SUBMITTED → AUTO_CLEARED (T1) | PHARMACIST_REVIEW (T2/POM)
//	PHARMACIST_REVIEW → APPROVED | REJECTED | NEEDS_INFO
//	NEEDS_INFO → PHARMACIST_REVIEW
//
// Every transition is guarded (explicit edge map), idempotent (re-applying the
// current state is a no-op), optimistic-locked (version CAS in the repo) and
// audit-logged with the actor. REJECTED signals the pharmacy order flow to run
// its refund path (escrow.Refund → ledger reversal entries); the money side
// effect is owned by the order module, never by this package.

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// reviewSLA is the pharmacist decision window (median target <10 min; the
// deadline drives SLA-sorted queue views and the idx_review_cases_sla index).
const reviewSLA = 30 * time.Minute

// maxDecisionNoteLen bounds the pharmacist decision note (bounded-input rule;
// the note rides on the case row, the event row and API responses).
const maxDecisionNoteLen = 2000

// CreateReviewCaseForOrder opens (or idempotently returns) the review case for
// a pharmacy order and auto-routes it: T1 ⇒ AUTO_CLEARED, anything else ⇒
// PHARMACIST_REVIEW.
//
// EXPORTED INTEGRATION POINT: the pharmacy order flow calls this at order
// submission time (see the comment in internal/app/health_symptom_routes.go).
// It is safe to call more than once per order — one case per order (UNIQUE
// order_id) and replays return the existing case unchanged.
func (s *Service) CreateReviewCaseForOrder(ctx context.Context, actorID, orderID, pharmacyProviderID string, tier Tier) (*PharmacyReviewCase, error) {
	return s.createReviewCase(ctx, actorID, orderID, pharmacyProviderID, tier, nil)
}

// CreateReviewCaseForOrderFromContext is the order-flow seam (PRD §10): the
// pharmacy CreateOrder path invokes it (via healthpharmacy's optional
// ReviewCaseOpener collaborator) after a successful order creation. The triage
// tier is resolved SERVER-SIDE, never re-declared by the client:
//
//   - search context linked  ⇒ tier read from the symptom_search_events row;
//     an unknown event or a missing tier fails CLOSED to T2 pharmacist review
//     (and the dangling id is NOT linked onto the case);
//   - any rx_required line   ⇒ at least T2 — the POM gate applies regardless
//     of entry path (catalogue orders included, PRD §10 risk 2);
//   - no context and no POM  ⇒ no case at all (plain OTC catalogue order —
//     existing behavior unchanged; returns (nil, nil)).
//
// Idempotent per order like CreateReviewCaseForOrder.
func (s *Service) CreateReviewCaseForOrderFromContext(ctx context.Context, actorID, orderID, pharmacyProviderID string, searchEventID *string, rxRequired bool) (*PharmacyReviewCase, error) {
	if searchEventID != nil && *searchEventID == "" {
		searchEventID = nil
	}
	if searchEventID == nil && !rxRequired {
		return nil, nil // no search context, no POM line — nothing to gate
	}
	tier := TierT1
	if rxRequired {
		tier = TierT2 // POM gate: never below pharmacist review
	}
	var link *string
	if searchEventID != nil {
		evc, err := s.repo.SearchEventContext(ctx, *searchEventID)
		if err != nil {
			return nil, err
		}
		// Ownership: a client-supplied search_event_id must belong to the
		// ordering user — another user's event (leaked/shared id) is treated as
		// unlinkable so its symptom terms never attach to this order's case.
		foreign := evc != nil && evc.UserID != nil && actorID != "" && *evc.UserID != actorID
		if evc == nil || evc.ResolvedTier == nil || foreign {
			tier = maxTier(tier, TierT2) // unlinkable context fails closed
		} else {
			tier = maxTier(tier, Tier(*evc.ResolvedTier))
			link = searchEventID
		}
	}
	return s.createReviewCase(ctx, actorID, orderID, pharmacyProviderID, tier, link)
}

// createReviewCase is the single case-creation write path shared by both
// exported entry points.
func (s *Service) createReviewCase(ctx context.Context, actorID, orderID, pharmacyProviderID string, tier Tier, searchEventID *string) (*PharmacyReviewCase, error) {
	if orderID == "" || pharmacyProviderID == "" {
		return nil, fmt.Errorf("%w: order_id and pharmacy_provider_id are required", ErrValidation)
	}
	if tierRank(tier) == 0 {
		return nil, fmt.Errorf("%w: unknown tier %q", ErrValidation, tier)
	}
	// Idempotent replay: one case per order.
	if existing, err := s.repo.ReviewCaseByOrder(ctx, orderID); err != nil {
		return nil, err
	} else if existing != nil {
		return existing, nil
	}

	now := s.now()
	rc := &PharmacyReviewCase{
		ID:                 uuid.New().String(),
		OrderID:            orderID,
		PharmacyProviderID: pharmacyProviderID,
		Tier:               tier,
		State:              ReviewSubmitted,
		SLADeadline:        now.Add(reviewSLA),
		SearchEventID:      searchEventID,
		Version:            0,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	// The repo writes the case row + its creation event (NULL → SUBMITTED) in
	// one transaction — the evented history starts with the case itself.
	if err := s.repo.InsertReviewCase(ctx, rc, actorID); err != nil {
		return nil, err
	}
	newV := map[string]any{"state": string(ReviewSubmitted), "tier": string(tier), "order_id": orderID}
	if searchEventID != nil {
		newV["search_event_id"] = *searchEventID
	}
	s.audited(actorID, "", "health.pharmacy.symptom.review.create", "pharmacy_review_case", rc.ID, nil, newV)

	// Auto-route. Auto-clear expansion happens ONLY via approved rule changes —
	// in code, only base T1 ever auto-clears.
	target := ReviewPharmacistReview
	if tier == TierT1 {
		target = ReviewAutoCleared
	}
	return s.transitionReview(ctx, actorID, rc, target, nil, nil)
}

// DecideReviewCase is the pharmacist decision (POST /reviews/:id/decision):
// APPROVE | REJECT | NEEDS_INFO. A note is REQUIRED for REJECT and NEEDS_INFO
// (also CHECK-enforced in the schema). Object-level authz: unless
// tenantOverride (superintendent), the pharmacist must belong to the case's
// premises tenant — foreign cases read as not-found (no tenant enumeration).
// Replaying the same decision is idempotent.
func (s *Service) DecideReviewCase(ctx context.Context, pharmacistID, caseID, decision, note string, tenantOverride bool) (*PharmacyReviewCase, error) {
	if pharmacistID == "" {
		return nil, fmt.Errorf("%w: unauthenticated", ErrForbidden)
	}
	rc, err := s.repo.ReviewCaseByID(ctx, caseID)
	if err != nil {
		return nil, err
	}
	if rc == nil {
		return nil, fmt.Errorf("%w: review case", ErrNotFound)
	}
	if !tenantOverride {
		ok, err := s.repo.IsProviderPharmacist(ctx, pharmacistID, rc.PharmacyProviderID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("%w: review case", ErrNotFound) // outside caller's premises tenant
		}
	}

	var target ReviewState
	switch decision {
	case "APPROVE":
		target = ReviewApproved
	case "REJECT":
		target = ReviewRejected
	case "NEEDS_INFO":
		target = ReviewNeedsInfo
	default:
		return nil, fmt.Errorf("%w: decision must be APPROVE, REJECT or NEEDS_INFO", ErrValidation)
	}

	trimmed := strings.TrimSpace(note)
	if (target == ReviewRejected || target == ReviewNeedsInfo) && trimmed == "" {
		return nil, fmt.Errorf("%w: a note is required for REJECT and NEEDS_INFO", ErrValidation)
	}
	if len(trimmed) > maxDecisionNoteLen {
		return nil, fmt.Errorf("%w: note must be at most %d characters", ErrValidation, maxDecisionNoteLen)
	}

	// Idempotent replay of the same decision.
	if rc.State == target {
		return rc, nil
	}

	var notePtr *string
	if trimmed != "" {
		notePtr = &trimmed
	}
	pid := pharmacistID
	return s.transitionReview(ctx, pharmacistID, rc, target, &pid, notePtr)
}

// ResumeReviewCase moves NEEDS_INFO back to PHARMACIST_REVIEW once the member
// has supplied the requested information (the NEEDS_INFO ↔ PHARMACIST_REVIEW
// loop). Exported integration point for the member-facing order surface.
func (s *Service) ResumeReviewCase(ctx context.Context, actorID, caseID string) (*PharmacyReviewCase, error) {
	rc, err := s.repo.ReviewCaseByID(ctx, caseID)
	if err != nil {
		return nil, err
	}
	if rc == nil {
		return nil, fmt.Errorf("%w: review case", ErrNotFound)
	}
	return s.transitionReview(ctx, actorID, rc, ReviewPharmacistReview, nil, nil)
}

// ListReviewCases is the SLA-sorted pharmacist queue read (RBAC-gated route).
// Object-level authz: without tenantOverride (superintendent) the caller must
// pass their own premises tenant as providerID and own it — a foreign tenant
// reads as an empty queue (no tenant enumeration), and an unscoped query is
// rejected fail-closed.
func (s *Service) ListReviewCases(ctx context.Context, callerID, state, providerID string, tenantOverride bool) ([]PharmacyReviewCase, error) {
	if state != "" && !CanBeReviewState(state) {
		return nil, fmt.Errorf("%w: unknown review state filter", ErrValidation)
	}
	if !tenantOverride {
		if providerID == "" {
			return nil, fmt.Errorf("%w: pharmacy_provider_id is required", ErrValidation)
		}
		ok, err := s.repo.IsProviderPharmacist(ctx, callerID, providerID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return []PharmacyReviewCase{}, nil // outside caller's premises tenant
		}
	}
	return s.repo.ListReviewCases(ctx, state, providerID, 200)
}

// CanBeReviewState reports whether s is a known review state value.
func CanBeReviewState(s string) bool {
	switch ReviewState(s) {
	case ReviewSubmitted, ReviewAutoCleared, ReviewPharmacistReview, ReviewNeedsInfo, ReviewApproved, ReviewRejected:
		return true
	}
	return false
}

// transitionReview is the single guarded write path: idempotent on same-state,
// explicit-edge guarded, version-CAS'd, audit-logged with actor + old/new. The
// repo appends the pharmacy_review_case_events row in the same transaction as
// the state change (evented history, never derived drift).
func (s *Service) transitionReview(ctx context.Context, actorID string, rc *PharmacyReviewCase, to ReviewState, pharmacistID, note *string) (*PharmacyReviewCase, error) {
	if rc.State == to {
		return rc, nil // idempotent re-apply — no event row either
	}
	if !CanTransitionReview(rc.State, to) {
		return nil, fmt.Errorf("%w: illegal review transition %s -> %s", ErrConflict, rc.State, to)
	}
	ok, err := s.repo.TransitionReviewCase(ctx, rc.ID, rc.Version, rc.State, to, actorID, pharmacistID, note)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("%w: review case was decided concurrently — reload and retry", ErrConflict)
	}
	from := rc.State
	rc.State = to
	rc.Version++
	rc.UpdatedAt = s.now()
	if pharmacistID != nil {
		rc.PharmacistID = pharmacistID
	}
	if note != nil {
		rc.DecisionNote = note
	}
	s.audited(actorID, "", "health.pharmacy.symptom.review.transition", "pharmacy_review_case", rc.ID,
		map[string]any{"state": string(from)}, map[string]any{"state": string(to)})
	return rc, nil
}
