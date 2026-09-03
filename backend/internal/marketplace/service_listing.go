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

// validConditions are the item conditions this module accepts. `condition` is
// a free TEXT column (20260905000000_marketplace_v1.sql, documented only by a
// comment) with no CHECK constraint, so nothing previously caught a typo or an
// invented value before it became a fact on a listing.
var validConditions = map[string]bool{
	"new": true, "used": true, "refurbished": true, "foreign_used": true, "local_used": true,
}

// vehicleOnlyConditions is the "foreign used" (Tokunbo) vs. "local used" split
// — meaningful only for a listing filed under the Vehicles category tree; every
// other category just gets new/used/refurbished.
var vehicleOnlyConditions = map[string]bool{"foreign_used": true, "local_used": true}

// validateCondition checks a listing's condition value is known, and that a
// vehicle-only condition is confined to a listing filed under Vehicles. Pure/
// testable — the DB-backed "is this a Vehicles category" check that produces
// isVehicleCategory lives in CreateListing, one level up.
func validateCondition(condition string, isVehicleCategory bool) error {
	if !validConditions[condition] {
		return fieldErr(CodeValidation, "invalid condition", "condition")
	}
	if vehicleOnlyConditions[condition] && !isVehicleCategory {
		return fieldErr(CodeValidation, "foreign_used/local_used only applies to Vehicles categories", "condition")
	}
	return nil
}

// autoApproveTrustScore is the §2.1 auto-approve guard threshold (seller ≥ 0.6).
const autoApproveTrustScore = 0.6

// CreateListing creates a DRAFT listing after validating title/description/attrs.
func (s *Service) CreateListing(ctx context.Context, sellerID string, in CreateListingInput) (*Listing, error) {
	if sellerID == "" {
		return nil, ErrUnauthenticated
	}
	// No minimum beyond non-empty: "iPhone 15", "Sofa" and "Bike" are all real
	// titles under ten characters. The 100 ceiling stays — it is what keeps a title
	// inside the fixed-height listing card. See migration 20270157000000.
	if n := len(strings.TrimSpace(in.Title)); n < 1 || n > 100 {
		return nil, fieldErr(CodeValidation, "title must be 1–100 characters", "title")
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
	condition := orStr(in.Condition, "used")
	// Only spend the ancestor-walk query when the condition actually needs it.
	isVehicle := false
	if vehicleOnlyConditions[condition] {
		var verr error
		isVehicle, verr = s.repo.IsCategoryDescendantOfSlug(ctx, in.CategoryID, "vehicles")
		if verr != nil {
			return nil, verr
		}
	}
	if err := validateCondition(condition, isVehicle); err != nil {
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
		Condition:      condition,
		Attrs:          in.Attrs,
		Status:         ListingDraft,
		EscrowEligible: escrowEligible,
		State:          in.State,
		LGA:            in.LGA,
	}
	created, err := s.repo.InsertListing(ctx, l)
	if err != nil {
		return nil, err
	}
	// Persist the photos. MediaIDs was parsed and thrown away before this, so
	// mkt_listing_media stayed empty and every listing rendered without an image.
	//
	// A failure here does NOT fail the create: the listing itself is valid and
	// already written, and losing a draft because a photo row would not insert is
	// the worse outcome. It is logged so the gap is visible rather than silent.
	if keys := ownedMediaKeys(sellerID, in.MediaIDs); len(keys) > 0 {
		if merr := s.repo.InsertListingMedia(ctx, created.ID, keys); merr != nil {
			log.Printf("[marketplace] listing %s created but media not saved: %v", created.ID, merr)
		} else {
			created.ThumbURL = s.presignThumb(keys[0])
		}
	}
	return created, nil
}

// ownedMediaKeys filters client-supplied media ids down to object keys this
// seller actually uploaded.
//
// Two things make this necessary. The composer sends `fileUrl ?? photo.id` — so
// when an upload fails it posts a LOCAL photo id, which would otherwise be stored
// as if it were an object key and render as a broken image forever. And a key is
// just a string from the client, so without the ownership check a caller could
// claim another seller's object by guessing its path.
//
// The shape is the one presign mints: marketplace/<seller-uuid>/<32 hex><ext>.
func ownedMediaKeys(sellerID string, ids []string) []string {
	prefix := "marketplace/" + sellerID + "/"
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if !strings.HasPrefix(id, prefix) {
			continue
		}
		if name := strings.TrimPrefix(id, prefix); name == "" || strings.Contains(name, "/") {
			continue
		}
		out = append(out, id)
	}
	return out
}

// GetListing returns a listing (public detail).
func (s *Service) GetListing(ctx context.Context, id string) (*Listing, error) {
	l, err := s.repo.GetListing(ctx, id)
	if err != nil {
		return nil, err
	}
	s.attachThumbs(ctx, []*Listing{l})
	return l, nil
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

// MarkSoldListing (seller) active → sold. Terminal: the FSM has no outgoing edge
// from sold, which is deliberate — a sold listing must not silently return to
// discovery. SetListingStatus stamps sold_at, and the outbox delete removes it
// from search.
//
// The mobile client has called POST /listings/:id/mark-sold since the Sell group
// was built; the route was never registered, so "Mark as sold" 404ed and the
// listing stayed live with the item gone.
//
// A PAUSED listing cannot be marked sold: paused only leads to active, expired or
// removed_user. A seller who paused and then sold has to resume first, which is a
// product question rather than a bug — widening the FSM is a deliberate decision
// and this does not take it.
func (s *Service) MarkSoldListing(ctx context.Context, sellerID, id string) (*Listing, error) {
	return s.sellerListingTransition(ctx, sellerID, id, ListingActive, ListingSold)
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

// maxBoostWeight returns the largest weight among the given (already active +
// unexpired) boosts, or 0 if none. Pure/testable. §4: boost_mode:sum, so a
// listing gets the single strongest boost's additive weight, not the sum of
// stacked boosts (stacking must not let a seller buy their way to unbounded
// dominance).
//
// Reads Boost.Weight — frozen on the row at purchase time by
// ComputeBoostQuote/PurchaseBoost — rather than looking the tier up against
// the current catalog. A live lookup would let an admin's later price/weight
// change on mkt_boost_packages silently reweight an already-purchased boost,
// which contradicts the pricing console's own disclosure that config changes
// apply to new purchases only (ADM-001).
func maxBoostWeight(boosts []Boost) float64 {
	var max float64
	for i := range boosts {
		if boosts[i].Weight > max {
			max = boosts[i].Weight
		}
	}
	return max
}

// wordCount counts whitespace-delimited words (matches the §1 generated column intent).
func wordCount(s string) int {
	return len(strings.Fields(s))
}
