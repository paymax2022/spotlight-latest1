package marketplace

import (
	"context"
	"strings"
)

// service_account.go — business logic for the Trust & Account gap endpoints. Pure
// metadata (no ledger, no idempotency). OLA is enforced here; the repo carries the
// SQL. Safe-spots are a static in-code seed (small, slowly-changing partner list).

// ─── Saved items ─────────────────────────────────────────────────────────────

// SaveListing adds a listing to the caller's wishlist, snapshotting the current
// price so the mobile "price changed" badge can compare later. Idempotent: a repeat
// save on the same listing returns ALREADY_SAVED (409) rather than duplicating.
func (s *Service) SaveListing(ctx context.Context, userID, listingID string) (*SavedItem, error) {
	l, err := s.repo.GetListing(ctx, listingID)
	if err != nil {
		return nil, err
	}
	return s.repo.InsertSavedItem(ctx, userID, listingID, l.PriceKobo)
}

// UnsaveListing removes a listing from the caller's wishlist (no-op-safe: missing
// rows return SAVED_ITEM_NOT_FOUND).
func (s *Service) UnsaveListing(ctx context.Context, userID, listingID string) error {
	return s.repo.DeleteSavedItem(ctx, userID, listingID)
}

// ListSavedItems returns the caller's saved listings (newest first), each joined
// to its current listing row so the client can render cards + price-change badges.
func (s *Service) ListSavedItems(ctx context.Context, userID string, limit, offset int) ([]SavedItem, error) {
	return s.repo.ListSavedItems(ctx, userID, limit, offset)
}

// ─── Reports ─────────────────────────────────────────────────────────────────

// CreateReport files a safety report against a listing, seller, or chat. Validates
// the closed target-type set and a non-empty reason; the row lands in `open` for
// the admin moderation queue to triage.
func (s *Service) CreateReport(ctx context.Context, reporterID string, in CreateReportInput) (*Report, error) {
	tt := strings.ToLower(strings.TrimSpace(in.TargetType))
	if !validReportTargets[tt] {
		return nil, fieldErr(CodeInvalidReportTarget, "target_type must be listing, seller, or chat", "target_type")
	}
	if strings.TrimSpace(in.TargetID) == "" {
		return nil, fieldErr(CodeValidation, "target_id is required", "target_id")
	}
	if strings.TrimSpace(in.Reason) == "" {
		return nil, fieldErr(CodeValidation, "reason is required", "reason")
	}
	rep := &Report{
		ReporterID:  reporterID,
		TargetType:  tt,
		TargetID:    in.TargetID,
		Reason:      in.Reason,
		EvidenceURL: in.EvidenceURL,
		Note:        in.Note,
	}
	return s.repo.InsertReport(ctx, rep)
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

// BlockUser blocks another user. Rejects self-blocks; a repeat block returns
// ALREADY_BLOCKED (409).
func (s *Service) BlockUser(ctx context.Context, userID, blockedUserID string) (*Block, error) {
	blockedUserID = strings.TrimSpace(blockedUserID)
	if blockedUserID == "" {
		return nil, fieldErr(CodeValidation, "blocked_user_id is required", "blocked_user_id")
	}
	if blockedUserID == userID {
		return nil, newErr(422, CodeCannotBlockSelf, "you cannot block yourself")
	}
	return s.repo.InsertBlock(ctx, userID, blockedUserID)
}

// UnblockUser removes a block after an OLA check (the block row must belong to the
// caller). A missing/foreign row returns BLOCK_NOT_FOUND / FORBIDDEN.
func (s *Service) UnblockUser(ctx context.Context, userID, blockID string) error {
	owner, err := s.repo.GetBlockOwner(ctx, blockID)
	if err != nil {
		return err
	}
	if owner != userID {
		return ErrForbidden
	}
	return s.repo.DeleteBlock(ctx, blockID)
}

// ListBlocks returns the caller's blocked users.
func (s *Service) ListBlocks(ctx context.Context, userID string) ([]Block, error) {
	return s.repo.ListBlocks(ctx, userID)
}

// ─── Followed sellers ────────────────────────────────────────────────────────

// FollowSeller follows a seller. Idempotent (see InsertFollow).
func (s *Service) FollowSeller(ctx context.Context, followerID, sellerID string) error {
	sellerID = strings.TrimSpace(sellerID)
	if sellerID == "" {
		return fieldErr(CodeValidation, "seller_id is required", "seller_id")
	}
	if sellerID == followerID {
		return ErrCannotFollowSelf
	}
	return s.repo.InsertFollow(ctx, followerID, sellerID)
}

// UnfollowSeller removes a follow. Idempotent (see DeleteFollow) — no OLA
// lookup needed since the delete is already scoped to the caller's own id.
func (s *Service) UnfollowSeller(ctx context.Context, followerID, sellerID string) error {
	return s.repo.DeleteFollow(ctx, followerID, sellerID)
}

// ListFollowedSellers returns the caller's followed sellers.
func (s *Service) ListFollowedSellers(ctx context.Context, followerID string) ([]FollowedSeller, error) {
	return s.repo.ListFollows(ctx, followerID)
}

// ─── Notification preferences ────────────────────────────────────────────────

// GetNotificationPrefs returns the caller's toggles, defaulting to all-on (except
// promotional) when no row exists yet.
func (s *Service) GetNotificationPrefs(ctx context.Context, userID string) (*NotificationPrefs, error) {
	return s.repo.GetNotificationPrefs(ctx, userID)
}

// UpdateNotificationPrefs applies a partial toggle update (upsert), leaving omitted
// categories unchanged.
func (s *Service) UpdateNotificationPrefs(ctx context.Context, userID string, patch NotificationPrefsPatch) (*NotificationPrefs, error) {
	return s.repo.UpsertNotificationPrefs(ctx, userID, patch)
}

// ─── Meetup safe-spots ───────────────────────────────────────────────────────

// MeetupSafeSpots returns curated verified-safe meetup locations, optionally
// filtered by state / LGA (case-insensitive). Static seed — no DB round-trip.
func (s *Service) MeetupSafeSpots(state, lga string) []SafeSpot {
	state = strings.ToLower(strings.TrimSpace(state))
	lga = strings.ToLower(strings.TrimSpace(lga))
	out := make([]SafeSpot, 0, len(seedSafeSpots))
	for _, sp := range seedSafeSpots {
		if state != "" && strings.ToLower(sp.State) != state {
			continue
		}
		if lga != "" && strings.ToLower(sp.LGA) != lga {
			continue
		}
		out = append(out, sp)
	}
	return out
}

// seedSafeSpots is the day-one curated partner list (§27: police-station forecourts,
// bank branches, well-lit public spots). Expandable later without a schema change.
var seedSafeSpots = []SafeSpot{
	{ID: "ss-lag-01", Name: "Lagos State Police Command HQ Forecourt", Kind: "police_station", Address: "Louis Edet House, Ikeja", State: "Lagos", LGA: "Ikeja", Lat: 6.6018, Lng: 3.3515, Verified: true},
	{ID: "ss-lag-02", Name: "GTBank Ikeja City Mall Branch", Kind: "bank_branch", Address: "Obafemi Awolowo Way, Ikeja", State: "Lagos", LGA: "Ikeja", Lat: 6.6210, Lng: 3.3573, Verified: true},
	{ID: "ss-lag-03", Name: "Ikeja City Mall Security Point", Kind: "mall", Address: "Alausa, Ikeja", State: "Lagos", LGA: "Ikeja", Lat: 6.6142, Lng: 3.3585, Verified: true},
	{ID: "ss-lag-04", Name: "Lekki Phase 1 Police Station", Kind: "police_station", Address: "Admiralty Way, Lekki", State: "Lagos", LGA: "Eti-Osa", Lat: 6.4415, Lng: 3.4720, Verified: true},
	{ID: "ss-abj-01", Name: "FCT Police Command Forecourt, Garki", Kind: "police_station", Address: "Area 11, Garki", State: "FCT", LGA: "Municipal", Lat: 9.0361, Lng: 7.4895, Verified: true},
	{ID: "ss-abj-02", Name: "Jabi Lake Mall Security Point", Kind: "mall", Address: "Jabi District", State: "FCT", LGA: "Municipal", Lat: 9.0700, Lng: 7.4247, Verified: true},
	{ID: "ss-abj-03", Name: "Access Bank Wuse 2 Branch", Kind: "bank_branch", Address: "Aminu Kano Crescent, Wuse 2", State: "FCT", LGA: "Municipal", Lat: 9.0778, Lng: 7.4880, Verified: true},
	{ID: "ss-riv-01", Name: "Rivers State Police HQ Forecourt", Kind: "police_station", Address: "Moscow Road, Port Harcourt", State: "Rivers", LGA: "Port Harcourt", Lat: 4.7920, Lng: 7.0134, Verified: true},
	{ID: "ss-riv-02", Name: "Port Harcourt Mall Security Point", Kind: "mall", Address: "Aba Road, Port Harcourt", State: "Rivers", LGA: "Port Harcourt", Lat: 4.8156, Lng: 7.0498, Verified: true},
	{ID: "ss-oyo-01", Name: "Oyo State Police Command, Eleyele", Kind: "police_station", Address: "Eleyele, Ibadan", State: "Oyo", LGA: "Ibadan North", Lat: 7.4165, Lng: 3.8570, Verified: true},
	{ID: "ss-oyo-02", Name: "Ventura Mall Security Point", Kind: "mall", Address: "Samonda, Ibadan", State: "Oyo", LGA: "Ibadan North", Lat: 7.4390, Lng: 3.9020, Verified: true},
	{ID: "ss-kan-01", Name: "Kano State Police Command Forecourt", Kind: "police_station", Address: "Bompai Road, Kano", State: "Kano", LGA: "Nassarawa", Lat: 12.0022, Lng: 8.5460, Verified: true},
}
