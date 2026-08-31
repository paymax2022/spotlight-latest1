package marketplace

import (
	"context"
	"log"
	"strings"
	"time"
)

// service_listing.go implements the §2.1 Listing FSM guarded transitions + CRUD.

// minDescriptionWords is the §2.1 submit guard (description ≥ 8 words).
const minDescriptionWords = 8

// autoApproveTrustScore is the §2.1 auto-approve guard threshold (seller ≥ 0.6).
const autoApproveTrustScore = 0.6

// CreateListing creates a DRAFT listing after validating title/description/attrs.
func (s *Service) CreateListing(ctx context.Context, sellerID string, in CreateListingInput) (*Listing, error) {
	if sellerID == "" {
		return nil, ErrUnauthenticated
	}
	if n := len(strings.TrimSpace(in.Title)); n < 10 || n > 100 {
		return nil, fieldErr(CodeValidation, "title must be 10–100 characters", "title")
	}
	if wordCount(in.Description) < minDescriptionWords {
		return nil, newErr(422, CodeDescriptionTooShort, "description must be at least 8 words")
	}
	if in.CategoryID == "" {
		return nil, fieldErr(CodeValidation, "category_id is required", "category_id")
	}
	if in.State == "" {
		return nil, fieldErr(CodeValidation, "state is required", "state")
	}
	if in.PriceKobo < 0 {
		return nil, fieldErr(CodeValidation, "price_kobo must be non-negative", "price_kobo")
	}
	// §1: attrs are validated against the category's attribute_schema at write time.
	// Fetching the category also surfaces a clean 422 for a bad category_id instead
	// of a raw FK violation from InsertListing.
	cat, cerr := s.repo.GetCategory(ctx, in.CategoryID)
	if cerr != nil {
		return nil, fieldErr(CodeValidation, "unknown category_id", "category_id")
	}
	if !cat.IsActive {
		return nil, fieldErr(CodeValidation, "category is not active", "category_id")
	}
	// The listing below is stamped DefaultMarketID while category_id is whatever the
	// caller sent, so without this the two could disagree — and they did: 210 of 229
	// local listings sit in market NG under a category from another market. Market is
	// this module's tenancy boundary (categories and search are both scoped to one),
	// so such a listing shows up in one half of a market's UI and not the other.
	//
	// The category is already loaded for the attrs check, so this costs no extra
	// query. The composite FK added in 20270119000000 is the backstop; this exists so
	// the caller gets a field error naming category_id instead of a raw FK violation.
	if cat.MarketID != DefaultMarketID {
		return nil, fieldErr(CodeValidation, "category belongs to a different market", "category_id")
	}
	if err := validateAttrs(cat.AttributeSchema, in.Attrs); err != nil {
		return nil, err
	}
	escrowEligible := true
	if in.EscrowEligible != nil {
		escrowEligible = *in.EscrowEligible
	}

	l := &Listing{
		MarketID:       DefaultMarketID,
		SellerID:       sellerID,
		CategoryID:     in.CategoryID,
		Title:          in.Title,
		Description:    in.Description,
		PriceKobo:      in.PriceKobo,
		Condition:      orStr(in.Condition, "used"),
		Attrs:          in.Attrs,
		Status:         ListingDraft,
		EscrowEligible: escrowEligible,
		State:          in.State,
		LGA:            in.LGA,
	}
	return s.repo.InsertListing(ctx, l)
}

// GetListing returns a listing (public detail).
func (s *Service) GetListing(ctx context.Context, id string) (*Listing, error) {
	return s.repo.GetListing(ctx, id)
}

// UpdateListing edits the mutable subset. §8: while any non-terminal order
// references the listing, price changes are blocked (LISTING_HAS_ACTIVE_ORDER);
// description/attr fixes are still allowed. OLA: caller must own the listing.
func (s *Service) UpdateListing(ctx context.Context, sellerID, id string, in UpdateListingInput) (*Listing, error) {
	l, err := s.repo.GetListing(ctx, id)
	if err != nil {
		return nil, err
	}
	if l.SellerID != sellerID {
		return nil, ErrForbidden
	}
	// §1: a supplied attrs edit must satisfy the category's attribute_schema.
	if in.Attrs != nil {
		if cat, cerr := s.repo.GetCategory(ctx, l.CategoryID); cerr == nil {
			if verr := validateAttrs(cat.AttributeSchema, in.Attrs); verr != nil {
				return nil, verr
			}
		}
	}
	if in.PriceKobo != nil {
		n, err := s.repo.CountNonTerminalOrdersForListing(ctx, id)
		if err != nil {
			return nil, err
		}
		if n > 0 {
			return nil, newErr(409, CodeListingHasActiveOrder, "cannot change price while an active order references this listing")
		}
	}
	if err := s.repo.UpdateListingMutable(ctx, id, in); err != nil {
		return nil, err
	}
	updated, err := s.repo.GetListing(ctx, id)
	if err != nil {
		return nil, err
	}
	// EDIT-AFTER-APPROVE RE-MODERATION (trust backbone, LM-002/MOD-010/EC-010): a content
	// edit (title/description/attributes) to a LIVE listing must re-enter pending_review
	// and be pulled from discovery until re-approved — otherwise a seller can bait-and-
	// switch an approved ad into banned content. A price-only edit (already guarded against
	// active orders above) is a normal seller action and does NOT re-moderate.
	if updated.Status == ListingActive && requiresRemoderation(in) {
		if err := guardListingTransition(ListingActive, ListingPendingReview); err != nil {
			return nil, err
		}
		reason := "content_edited"
		if err := s.repo.SetListingStatus(ctx, id, ListingActive, ListingPendingReview, &reason); err != nil {
			return nil, err
		}
		updated.Status = ListingPendingReview
		_ = s.repo.InsertOutbox(ctx, nil, id, OutboxDelete, map[string]any{"listing_id": id})
		_ = s.writeAudit(ctx, AuditEntry{
			AdminID: sellerID, Action: "mkt.listing.edit_remoderate", TargetType: "listing", TargetID: id, ReasonCode: reason,
			BeforeState: map[string]any{"status": string(ListingActive)},
			AfterState:  map[string]any{"status": string(ListingPendingReview)},
		})
		s.notifySafe(ctx, updated.SellerID, "mkt.listing.remoderation", "Your edit is under review before your listing goes live again.")
		return updated, nil
	}
	// Non-sensitive edit (or non-live listing): if still live, refresh search.
	if updated.Status == ListingActive {
		_ = s.repo.InsertOutbox(ctx, nil, id, OutboxUpsert, s.searchPayload(ctx, updated))
	}
	return updated, nil
}

// requiresRemoderation reports whether an edit changes moderation-relevant CONTENT
// (title, description, or attributes) as opposed to a price-only change — so a live
// listing must re-enter pending_review. Pure/testable.
func requiresRemoderation(in UpdateListingInput) bool {
	return in.Title != nil || in.Description != nil || in.Attrs != nil
}

// SubmitListing runs the §2.1 submit guard and either auto-approves (risk_tier 0 AND
// seller trust ≥ 0.6 → active) or routes to review (pending_review). OLA: owner.
func (s *Service) SubmitListing(ctx context.Context, sellerID, id string) (*Listing, error) {
	l, err := s.repo.GetListing(ctx, id)
	if err != nil {
		return nil, err
	}
	if l.SellerID != sellerID {
		return nil, ErrForbidden
	}
	if l.Status != ListingDraft {
		return nil, guardListingTransition(l.Status, ListingPendingReview)
	}
	if wordCount(l.Description) < minDescriptionWords {
		return nil, newErr(422, CodeDescriptionTooShort, "description must be at least 8 words")
	}

	// Auto-moderation pre-filter (§2.1): prohibited content NEVER takes the
	// auto-approve fast-path, no matter how trusted the seller is — it is routed to
	// human review with a reason. The screen is conservative (a hit routes to review,
	// it does not auto-reject).
	flagReason := screenListingContent(l.Title, l.Description, l.Attrs)

	// Auto-approve guard: NOT flagged AND risk_tier 0 AND seller trust ≥ 0.6.
	autoApprove := false
	if flagReason == "" {
		if cat, cerr := s.repo.GetCategory(ctx, l.CategoryID); cerr == nil && cat.RiskTier == 0 {
			if tp, terr := s.repo.GetTrustProfile(ctx, sellerID); terr == nil && tp.TrustScore >= autoApproveTrustScore {
				autoApprove = true
			}
		}
	}

	if autoApprove {
		if err := s.repo.SetListingStatus(ctx, id, ListingDraft, ListingActive, nil); err != nil {
			return nil, err
		}
		l.Status = ListingActive
		_ = s.repo.InsertOutbox(ctx, nil, id, OutboxUpsert, s.searchPayload(ctx, l))
		s.notifySafe(ctx, sellerID, "mkt.listing.active", "Your listing is live.")
		return l, nil
	}

	// Route to review. If auto-mod flagged it, persist the reason so the moderation
	// queue shows why, and record an audit trail of the automated decision.
	var reasonPtr *string
	if flagReason != "" {
		reasonPtr = &flagReason
	}
	if err := s.repo.SetListingStatus(ctx, id, ListingDraft, ListingPendingReview, reasonPtr); err != nil {
		return nil, err
	}
	l.Status = ListingPendingReview
	if flagReason != "" {
		_ = s.writeAudit(ctx, AuditEntry{
			AdminID: systemActorID, AdminRole: "system", Action: "mkt.listing.automod_flag", TargetType: "listing", TargetID: id, ReasonCode: flagReason,
			BeforeState: map[string]any{"status": string(ListingDraft)},
			AfterState:  map[string]any{"status": string(ListingPendingReview), "auto_flag": flagReason},
		})
	}
	s.notifySafe(ctx, sellerID, "mkt.listing.pending", "Your listing is under review.")
	return l, nil
}

// PauseListing (seller) active → paused, removing it from search.
func (s *Service) PauseListing(ctx context.Context, sellerID, id string) (*Listing, error) {
	return s.sellerListingTransition(ctx, sellerID, id, ListingActive, ListingPaused)
}

// ResumeListing (seller) paused → active if not expired, re-adding to search.
func (s *Service) ResumeListing(ctx context.Context, sellerID, id string) (*Listing, error) {
	l, err := s.repo.GetListing(ctx, id)
	if err != nil {
		return nil, err
	}
	if l.SellerID != sellerID {
		return nil, ErrForbidden
	}
	if !l.ExpiresAt.IsZero() && time.Now().After(l.ExpiresAt) {
		return nil, newErr(422, CodeListingNotActive, "listing has expired; renew instead")
	}
	return s.sellerListingTransition(ctx, sellerID, id, ListingPaused, ListingActive)
}

// DeleteListing (owner) any → removed_user, removing from search.
func (s *Service) DeleteListing(ctx context.Context, sellerID, id string) (*Listing, error) {
	l, err := s.repo.GetListing(ctx, id)
	if err != nil {
		return nil, err
	}
	if l.SellerID != sellerID {
		return nil, ErrForbidden
	}
	if err := guardListingTransition(l.Status, ListingRemovedUser); err != nil {
		return nil, err
	}
	if err := s.repo.SetListingStatus(ctx, id, l.Status, ListingRemovedUser, nil); err != nil {
		return nil, err
	}
	l.Status = ListingRemovedUser
	_ = s.repo.InsertOutbox(ctx, nil, id, OutboxDelete, map[string]any{"listing_id": id})
	return l, nil
}

// sellerListingTransition applies an owner-initiated guarded listing transition and
// emits the appropriate outbox op.
func (s *Service) sellerListingTransition(ctx context.Context, sellerID, id string, from, to ListingStatus) (*Listing, error) {
	l, err := s.repo.GetListing(ctx, id)
	if err != nil {
		return nil, err
	}
	if l.SellerID != sellerID {
		return nil, ErrForbidden
	}
	if err := guardListingTransition(l.Status, to); err != nil {
		return nil, err
	}
	if err := s.repo.SetListingStatus(ctx, id, from, to, nil); err != nil {
		return nil, err
	}
	l.Status = to
	if op, emit := listingOutboxOp(to); emit {
		var payload any = map[string]any{"listing_id": id}
		if op == OutboxUpsert {
			payload = s.searchPayload(ctx, l)
		}
		_ = s.repo.InsertOutbox(ctx, nil, id, op, payload)
	}
	return l, nil
}

// ─── Admin moderation (§2.1 approve/reject; writes mkt_admin_audit_log) ───────

// ModerationQueue returns pending_review listings (admin).
func (s *Service) ModerationQueue(ctx context.Context, limit, offset int) ([]Listing, error) {
	return s.repo.ModerationQueue(ctx, limit, offset)
}

// ApproveListing (admin) pending_review → active. reason_code optional (§2.1:
// approval doesn't require one) but the admin action is still audited.
func (s *Service) ApproveListing(ctx context.Context, adminID, id, reasonCode string) (*Listing, error) {
	l, err := s.repo.GetListing(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := guardListingTransition(l.Status, ListingActive); err != nil {
		return nil, err
	}
	if err := s.repo.SetListingStatus(ctx, id, ListingPendingReview, ListingActive, nil); err != nil {
		return nil, err
	}
	l.Status = ListingActive
	_ = s.repo.InsertOutbox(ctx, nil, id, OutboxUpsert, s.searchPayload(ctx, l))
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, Action: "mkt.listing.approve", TargetType: "listing", TargetID: id,
		ReasonCode:  orStr(reasonCode, "approved"),
		BeforeState: map[string]any{"status": string(ListingPendingReview)},
		AfterState:  map[string]any{"status": string(ListingActive)},
	})
	s.notifySafe(ctx, l.SellerID, "mkt.listing.active", "Your listing was approved and is live.")
	return l, nil
}

// RejectListing (admin) pending_review → removed_policy. reason_code MANDATORY
// (§2.1); the seller is notified with the reason verbatim.
func (s *Service) RejectListing(ctx context.Context, adminID, id, reasonCode string) (*Listing, error) {
	if err := requireReason(reasonCode); err != nil {
		return nil, err
	}
	l, err := s.repo.GetListing(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := guardListingTransition(l.Status, ListingRemovedPolicy); err != nil {
		return nil, err
	}
	if err := s.repo.SetListingStatus(ctx, id, ListingPendingReview, ListingRemovedPolicy, &reasonCode); err != nil {
		return nil, err
	}
	l.Status = ListingRemovedPolicy
	_ = s.repo.InsertOutbox(ctx, nil, id, OutboxDelete, map[string]any{"listing_id": id})

	// §8 BOOST CASCADE: a listing rejected to removed_policy must auto-transition every
	// active/purchased boost on it rejected_with_reason → auto_refunded (RejectBoost does
	// both legs + the seller refund + its own audit). The seller must not keep paying for
	// a boost promoting a policy-removed listing. Best-effort per boost so one refund
	// hiccup never leaves the listing un-rejected; failures are logged, not swallowed
	// silently.
	if boosts, berr := s.repo.ActiveBoostsForListing(ctx, id); berr == nil {
		for i := range boosts {
			if _, rerr := s.RejectBoost(ctx, adminID, boosts[i].ID, "listing_"+reasonCode); rerr != nil {
				log.Printf("[marketplace] boost cascade: reject boost %s for listing %s failed: %v", boosts[i].ID, id, rerr)
			}
		}
	} else {
		log.Printf("[marketplace] boost cascade: lookup for listing %s failed: %v", id, berr)
	}

	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, Action: "mkt.listing.reject", TargetType: "listing", TargetID: id, ReasonCode: reasonCode,
		BeforeState: map[string]any{"status": string(ListingPendingReview)},
		AfterState:  map[string]any{"status": string(ListingRemovedPolicy), "reason_code": reasonCode},
	})
	s.notifySafe(ctx, l.SellerID, "mkt.listing.rejected", "Your listing was removed: "+reasonCode)
	return l, nil
}

// ExpireDueListings is the cron helper (§2.1 auto_expire): active listings past
// expires_at → expired, emitting search-delete outbox rows. Returns count expired.
func (s *Service) ExpireDueListings(ctx context.Context) (int, error) {
	ids, err := s.repo.ExpireDueListings(ctx, time.Now(), 200)
	if err != nil {
		return 0, err
	}
	return len(ids), nil
}

// CompleteDueBoosts is the cron helper (§2.4 boost completion): active boosts past
// ends_at → completed. Returns count completed. Affected listing IDs are returned
// (for re-indexing), but no outbox rows are emitted (boost_weight drops on next index).
func (s *Service) CompleteDueBoosts(ctx context.Context) (int, error) {
	ids, err := s.repo.CompleteDueBoosts(ctx, time.Now(), 200)
	if err != nil {
		return 0, err
	}
	return len(ids), nil
}

// searchPayload builds the outbox upsert payload Agent B's indexer consumes (mirrors
// the §4 ES mapping fields). It includes boost_weight so paid boosts actually affect
// ranking (§4 field_value_factor on boost_weight) — the weight is the strongest
// currently-effective boost on the listing (0 when none). A boost lookup hiccup
// defaults the weight to 0 rather than blocking the re-index (fail-open).
func (s *Service) searchPayload(ctx context.Context, l *Listing) map[string]any {
	var boostWeight float64
	if boosts, berr := s.repo.ActiveBoostsForListing(ctx, l.ID); berr == nil {
		boostWeight = maxBoostWeight(boosts)
	}
	return map[string]any{
		"listing_id":      l.ID,
		"market_id":       l.MarketID,
		"seller_id":       l.SellerID,
		"category_id":     l.CategoryID,
		"title":           l.Title,
		"description":     l.Description,
		"attrs":           l.Attrs,
		"price_kobo":      l.PriceKobo,
		"condition":       l.Condition,
		"state":           l.State,
		"lga":             l.LGA,
		"quality_score":   l.QualityScore,
		"escrow_eligible": l.EscrowEligible,
		"boost_weight":    boostWeight,
		"status":          string(l.Status),
		"created_at":      l.CreatedAt,
		"freshness_ts":    l.UpdatedAt,
	}
}

// maxBoostWeight returns the largest catalog weight among the given (already
// active + unexpired) boosts, or 0 if none. Pure/testable. §4: boost_mode:sum, so a
// listing gets the single strongest boost's additive weight, not the sum of stacked
// boosts (stacking must not let a seller buy their way to unbounded dominance).
func maxBoostWeight(boosts []Boost) float64 {
	var max float64
	for i := range boosts {
		if t, ok := lookupBoostTier(boosts[i].Tier); ok && t.Weight > max {
			max = t.Weight
		}
	}
	return max
}

// wordCount counts whitespace-delimited words (matches the §1 generated column intent).
func wordCount(s string) int {
	return len(strings.Fields(s))
}
