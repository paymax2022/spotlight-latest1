package marketplace

import (
	"context"
	"strconv"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// Service is the single entry point for the marketplace domain. It owns the four
// guarded FSMs (listing/order/dispute/boost) and REUSES the finance double-entry
// ledger for every money movement (§ doctrine: the marketplace never stores a
// balance; escrow is a ledger posting into ledger.AccountEscrow).
//
// Constructed in internal/app via NewService(pool, ledger, redis).
type Service struct {
	repo     *Repository
	ledger   *ledger.Service
	redis    *goredis.Client // optional; nil ⇒ DB-unique idempotency backstop only
	notify   Notifier
	audit    Auditor
	searcher Searcher // optional; nil ⇒ GET /search returns 501 SEARCH_NOT_WIRED
	// referralEmitter was removed in the listings-and-connect pivot (ADR-023): the
	// marketplace no longer settles purchases (no escrow release), so there is nothing
	// to emit to the Direct Referral Rewards engine. See marketplace_routes.go, where
	// the RegisterMarketplace referralRewards param is now a no-op.
}

// Notifier emits buyer/seller notifications. Nil-safe.
type Notifier interface {
	Notify(ctx context.Context, userID, kind, message string)
}

// NewService constructs the marketplace service. redis may be nil (dev/CI): the
// durable idempotency backstop is the DB-side UNIQUE on mkt_orders.idempotency_key
// and the ledger's own unique idempotency_key, so a nil redis never risks a double
// money movement — it only forgoes cheap cached-body replay.
func NewService(pool *pgxpool.Pool, ledgerSvc *ledger.Service, rdb *goredis.Client) *Service {
	return &Service{
		repo:   NewRepository(pool),
		ledger: ledgerSvc,
		redis:  rdb,
	}
}

// WithNotifier attaches an optional notification sink.
func (s *Service) WithNotifier(n Notifier) *Service { s.notify = n; return s }

// WithAuditor attaches an optional secondary audit sink (the primary immutable
// trail is always mkt_admin_audit_log).
func (s *Service) WithAuditor(a Auditor) *Service { s.audit = a; return s }

// WithReferralEmitter was removed in the listings-and-connect pivot (ADR-023).

// notifySafe is a nil-safe notification fan-out.
func (s *Service) notifySafe(ctx context.Context, userID, kind, message string) {
	if s.notify != nil {
		s.notify.Notify(ctx, userID, kind, message)
	}
}

// ─── Search seam (§ integration contract) ────────────────────────────────────
//
// To avoid a compile cycle (`marketplace` must NOT import `search`), A defines this
// tiny local interface and app-wiring injects Agent B's *search.Client, which must
// satisfy Search(ctx, req) (results, error) with the documented signature:
//
//	Search(ctx context.Context, req search.SearchRequest) (search.SearchResults, error)
//
// Here the request/results are modeled as `any` so the two packages never share a
// type at compile time; app-wiring adapts B's concrete client to this seam. When no
// searcher is injected the GET /search handler returns 501 SEARCH_NOT_WIRED.
type Searcher interface {
	Search(ctx context.Context, req any) (any, error)
}

// SetSearcher injects the search read-model client (app-wiring, post-construction).
func (s *Service) SetSearcher(sr Searcher) { s.searcher = sr }

// ─── Category + search read paths ────────────────────────────────────────────

// ListCategories returns active categories for the market.
func (s *Service) ListCategories(ctx context.Context, marketID string) ([]Category, error) {
	if marketID == "" {
		marketID = DefaultMarketID
	}
	return s.repo.ListCategories(ctx, marketID)
}

// GetCategory returns one category.
func (s *Service) GetCategory(ctx context.Context, id string) (*Category, error) {
	return s.repo.GetCategory(ctx, id)
}

// Search proxies to the injected Elasticsearch read-model client when one is wired.
// When ELASTICSEARCH_URL is unset (no searcher), it degrades to a minimal Postgres
// fallback (ILIKE title + category/condition/state/price filters, newest-first,
// LIMIT-bounded) so the mobile search screen still returns real active listings
// instead of a 501 dead-end. Full facets/relevance/geo ranking only ship with ES.
func (s *Service) Search(ctx context.Context, req any) (any, error) {
	if s.searcher != nil {
		return s.searcher.Search(ctx, req)
	}
	f := parseSearchFallback(req)
	listings, err := s.repo.SearchListingsFallback(ctx, f)
	if err != nil {
		return nil, err
	}
	// Shape a search-response-like envelope the mobile client already understands
	// (results + empty facets + no cursor). `degraded` flags the reduced mode.
	return map[string]any{
		"results":     listings,
		"facets":      map[string]any{"categories": []any{}, "conditions": []any{}, "price_ranges": []any{}},
		"next_cursor": nil,
		"took_ms":     0,
		"degraded":    true,
	}, nil
}

// parseSearchFallback extracts the Postgres-fallback filter set from the handler's
// provider-agnostic request map (values are the raw query-param strings).
func parseSearchFallback(req any) SearchFallbackFilter {
	m, _ := req.(map[string]any)
	f := SearchFallbackFilter{}
	if m == nil {
		return f
	}
	getStr := func(k string) string {
		if v, ok := m[k]; ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
		return ""
	}
	getKobo := func(k string) *int64 {
		s := getStr(k)
		if s == "" {
			return nil
		}
		if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			return &n
		}
		return nil
	}
	f.Q = getStr("q")
	f.CategoryID = getStr("category_id")
	f.Condition = getStr("condition")
	f.State = getStr("state")
	f.LGA = getStr("lga")
	f.PriceMin = getKobo("price_min")
	f.PriceMax = getKobo("price_max")
	if v, ok := m["limit"]; ok {
		switch n := v.(type) {
		case int:
			f.Limit = n
		case int64:
			f.Limit = int(n)
		case float64:
			f.Limit = int(n)
		}
	}
	return f
}

// ─── Seller profile read paths ───────────────────────────────────────────────

// SellerProfile returns a seller's trust card.
func (s *Service) SellerProfile(ctx context.Context, sellerID string) (*TrustProfile, error) {
	return s.repo.GetTrustProfile(ctx, sellerID)
}

// SellerListings returns a seller's listings.
func (s *Service) SellerListings(ctx context.Context, sellerID string, limit, offset int) ([]Listing, error) {
	return s.repo.ListSellerListings(ctx, sellerID, limit, offset)
}

// SellerReviews returns a seller's visible reviews.
func (s *Service) SellerReviews(ctx context.Context, sellerID string, limit, offset int) ([]Review, error) {
	return s.repo.ListSellerReviews(ctx, sellerID, limit, offset)
}

// ─── Verification (delegates to KYC provider elsewhere; badges are PERMANENT) ──

// VerifyID marks the caller's verified_id_badge (§ trust_scores: permanent once true).
// The real ID document check delegates to the existing SmileID/Dojah adapter; here we
// record the badge grant. Idempotent (upsert).
func (s *Service) VerifyID(ctx context.Context, userID string) error {
	return s.repo.SetVerifiedBadge(ctx, userID, false)
}

// VerifyBusiness marks the caller's verified_business_badge (permanent).
func (s *Service) VerifyBusiness(ctx context.Context, userID string) error {
	return s.repo.SetVerifiedBadge(ctx, userID, true)
}

// ─── Offers (§3.3; guards + status, extrapolated from exemplar) ──────────────

// CreateOffer places a pending offer on a listing.
func (s *Service) CreateOffer(ctx context.Context, buyerID, listingID string, offerKobo int64) (*Offer, error) {
	l, err := s.repo.GetListing(ctx, listingID)
	if err != nil {
		return nil, err
	}
	if l.Status != ListingActive {
		return nil, newErr(422, CodeListingNotActive, "listing is not active")
	}
	if l.SellerID == buyerID {
		return nil, newErr(422, CodeSelfPurchaseNotAllowed, "cannot make an offer on your own listing")
	}
	if offerKobo <= 0 {
		return nil, fieldErr(CodeValidation, "offer_price_kobo must be positive", "offer_price_kobo")
	}
	return s.repo.InsertOffer(ctx, &Offer{ListingID: listingID, BuyerID: buyerID, OfferPriceKobo: offerKobo})
}

// AcceptOffer (seller) accepts a pending offer. OLA: caller must own the listing.
// NON-BINDING (ADR-023 listings-and-connect pivot): accepting an offer ONLY marks it
// "accepted" — it agrees a price for the two parties to meet on and does NOT create
// an escrow order or move any money (the marketplace no longer holds funds). The old
// order-creation link (CreateOrder reading an accepted offer's price) is gone with the
// order routes; this transition has no money side-effect and never did in this method.
func (s *Service) AcceptOffer(ctx context.Context, sellerID, offerID string) (*Offer, error) {
	return s.transitionOffer(ctx, sellerID, offerID, "accepted", true)
}

// DeclineOffer (seller) declines a pending offer.
func (s *Service) DeclineOffer(ctx context.Context, sellerID, offerID string) (*Offer, error) {
	return s.transitionOffer(ctx, sellerID, offerID, "declined", true)
}

// CounterOffer (seller) counters with a new price, chaining the parent offer.
func (s *Service) CounterOffer(ctx context.Context, sellerID, offerID string, counterKobo int64) (*Offer, error) {
	o, err := s.repo.GetOffer(ctx, offerID)
	if err != nil {
		return nil, err
	}
	l, err := s.repo.GetListing(ctx, o.ListingID)
	if err != nil {
		return nil, err
	}
	if l.SellerID != sellerID {
		return nil, ErrForbidden
	}
	if counterKobo <= 0 {
		return nil, fieldErr(CodeValidation, "counter price must be positive", "offer_price_kobo")
	}
	_ = s.repo.SetOfferStatus(ctx, offerID, "countered")
	parent := o.ID
	return s.repo.InsertOffer(ctx, &Offer{ListingID: o.ListingID, BuyerID: o.BuyerID, OfferPriceKobo: counterKobo, ParentOfferID: &parent})
}

// transitionOffer applies an offer status change after an OLA check.
func (s *Service) transitionOffer(ctx context.Context, sellerID, offerID, status string, requireSeller bool) (*Offer, error) {
	o, err := s.repo.GetOffer(ctx, offerID)
	if err != nil {
		return nil, err
	}
	l, err := s.repo.GetListing(ctx, o.ListingID)
	if err != nil {
		return nil, err
	}
	if requireSeller && l.SellerID != sellerID {
		return nil, ErrForbidden
	}
	if err := s.repo.SetOfferStatus(ctx, offerID, status); err != nil {
		return nil, err
	}
	o.Status = status
	return o, nil
}

// ─── Saved searches (§3.3) ───────────────────────────────────────────────────

// CreateSavedSearch stores a saved search for the user.
func (s *Service) CreateSavedSearch(ctx context.Context, userID string, in SavedSearch) (*SavedSearch, error) {
	in.UserID = userID
	if in.MarketID == "" {
		in.MarketID = DefaultMarketID
	}
	return s.repo.InsertSavedSearch(ctx, &in)
}

// ListSavedSearches returns the user's saved searches.
func (s *Service) ListSavedSearches(ctx context.Context, userID string) ([]SavedSearch, error) {
	return s.repo.ListSavedSearches(ctx, userID)
}

// DeleteSavedSearch removes a saved search after an OLA check.
func (s *Service) DeleteSavedSearch(ctx context.Context, userID, id string) error {
	owner, err := s.repo.GetSavedSearchOwner(ctx, id)
	if err != nil {
		return err
	}
	if owner != userID {
		return ErrForbidden
	}
	return s.repo.DeleteSavedSearch(ctx, id)
}

// ToggleSavedSearchAlert flips a saved search's alert flag after an OLA check.
func (s *Service) ToggleSavedSearchAlert(ctx context.Context, userID, id string, enabled bool) error {
	owner, err := s.repo.GetSavedSearchOwner(ctx, id)
	if err != nil {
		return err
	}
	if owner != userID {
		return ErrForbidden
	}
	return s.repo.SetSavedSearchAlert(ctx, id, enabled)
}

// ─── Reviews (§3.3; only after order released) ───────────────────────────────

// ─── Admin: flags + aging (thin wrappers with audit) ────────────────────────

// ActionFlag records an admin action on a moderation flag (audited).
func (s *Service) ActionFlag(ctx context.Context, adminID, flagID, status, reasonCode string) error {
	if err := requireReason(reasonCode); err != nil {
		return err
	}
	if err := s.repo.ActionFlag(ctx, flagID, status, adminID); err != nil {
		return err
	}
	return s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, Action: "mkt.flag.action", TargetType: "flag", TargetID: flagID, ReasonCode: reasonCode,
		AfterState: map[string]any{"status": status},
	})
}

// AgingOrders returns non-terminal orders older than 72h (§8 admin aging board).
func (s *Service) AgingOrders(ctx context.Context, limit, offset int) ([]Order, error) {
	cutoff := time.Now().Add(-72 * time.Hour)
	return s.repo.AgingOrders(ctx, cutoff, limit, offset)
}

// SubmitReview records a buyer review for a released order. Transaction-gated by the
// UNIQUE(order_id) constraint + the order-status guard here.
func (s *Service) SubmitReview(ctx context.Context, buyerID, orderID string, rating *int, comment *string) (*Review, error) {
	o, err := s.repo.GetOrder(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if o.BuyerID != buyerID {
		return nil, newErr(403, CodeNotOrderBuyer, "only the buyer may review this order")
	}
	if o.Status != OrderReleased {
		return nil, newErr(422, CodeOrderNotAcceptable, "reviews are only allowed after release")
	}
	rev := &Review{OrderID: orderID, ReviewerID: buyerID, RevieweeID: o.SellerID, Rating: rating, Comment: comment}
	if err := s.repo.InsertReview(ctx, rev); err != nil {
		return nil, err
	}
	return rev, nil
}
