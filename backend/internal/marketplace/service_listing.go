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
	// If the listing is live, re-emit an upsert so search stays current.
	if updated.Status == ListingActive {
		_ = s.repo.InsertOutbox(ctx, nil, id, OutboxUpsert, s.searchPayload(updated))
	}
	return updated, nil
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

	// Auto-approve guard: risk_tier 0 AND seller trust ≥ 0.6.
	autoApprove := false
	if cat, cerr := s.repo.GetCategory(ctx, l.CategoryID); cerr == nil && cat.RiskTier == 0 {
		if tp, terr := s.repo.GetTrustProfile(ctx, sellerID); terr == nil && tp.TrustScore >= autoApproveTrustScore {
			autoApprove = true
		}
	}

	if autoApprove {
		if err := s.repo.SetListingStatus(ctx, id, ListingDraft, ListingActive, nil); err != nil {
			return nil, err
		}
		l.Status = ListingActive
		_ = s.repo.InsertOutbox(ctx, nil, id, OutboxUpsert, s.searchPayload(l))
		s.notifySafe(ctx, sellerID, "mkt.listing.active", "Your listing is live.")
		return l, nil
	}

	if err := s.repo.SetListingStatus(ctx, id, ListingDraft, ListingPendingReview, nil); err != nil {
		return nil, err
	}
	l.Status = ListingPendingReview
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
			payload = s.searchPayload(l)
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
	_ = s.repo.InsertOutbox(ctx, nil, id, OutboxUpsert, s.searchPayload(l))
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
	due, err := s.repo.ExpiredActiveListings(ctx, time.Now(), 200)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, l := range due {
		if err := s.repo.SetListingStatus(ctx, l.ID, ListingActive, ListingExpired, nil); err == nil {
			_ = s.repo.InsertOutbox(ctx, nil, l.ID, OutboxDelete, map[string]any{"listing_id": l.ID})
			n++
		}
	}
	return n, nil
}

// searchPayload builds the outbox upsert payload Agent B's indexer consumes (mirrors
// the §4 ES mapping fields).
func (s *Service) searchPayload(l *Listing) map[string]any {
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
		"status":          string(l.Status),
		"created_at":      l.CreatedAt,
		"freshness_ts":    l.UpdatedAt,
	}
}

// wordCount counts whitespace-delimited words (matches the §1 generated column intent).
func wordCount(s string) int {
	return len(strings.Fields(s))
}
