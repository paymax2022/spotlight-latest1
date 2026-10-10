package marketplace

import (
	"context"
	"log"
	"regexp"
	"spotlight/backend/internal/finance/ledger"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"
)

// Service is the single entry point for the marketplace domain. It owns the four
// guarded FSMs (listing/order/dispute/boost) and REUSES the finance double-entry
// ledger for every money movement (§ doctrine: the marketplace never stores a
// balance; escrow is a ledger posting into ledger.AccountEscrow).
// Constructed in internal/app via NewService(pool, ledger, redis).
type Service struct {
	repo       *Repository
	ledger     boostLedger     // concrete *ledger.Service in prod; a fake in unit tests
	redis      *goredis.Client // optional; nil ⇒ DB-unique idempotency backstop only
	notify     Notifier
	audit      Auditor
	searcher   Searcher           // optional; nil ⇒ GET /search returns 501 SEARCH_NOT_WIRED
	commission CommissionRecorder // optional; nil ⇒ realized-profit recording is a no-op
	realtime   RealtimePublisher  // optional; nil ⇒ no live push (clients poll instead)
	thumbs     ThumbPresigner     // optional; nil ⇒ listings serve without images
	tiers      TierEnforcer       // REQUIRED for PurchaseBoost; nil ⇒ fail-closed refusal (ErrTierGateUnwired)
	// referralEmitter was removed in the listings-and-connect pivot (ADR-023): the
	// marketplace no longer settles purchases (no escrow release), so there is nothing
	// to emit to the Direct Referral Rewards engine. See marketplace_routes.go, where
	// the RegisterMarketplace referralRewards param is now a no-op.
}

// Notifier emits buyer/seller notifications. Nil-safe.
type Notifier interface {
	Notify(ctx context.Context, userID, kind, message string)
}

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module (§ profit registry). app-wiring injects a thin adapter over the finance
// commission service; when the commission feature is off (or no recorder is wired)
// the field is nil and recording is a silent no-op. Modeled as a LOCAL interface so
// marketplace never imports the commission package at compile time (mirrors the
// Searcher/Notifier seams) — the adapter, which lives in app-wiring, discards the
// returned earning row and surfaces only the error.
// This records realized profit ONLY; it never moves money. The marketplace's own
// money movements (e.g. the boost wallet charge into ledger.AccountCommission) are
// unchanged, and the injected recorder is deliberately constructed WITHOUT a ledger
// so RecordFor never re-posts to the ledger (no double count of the commission
// revenue account) — it appends the immutable earning row used by profit reports.
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *Service) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// recordCommissionSafe records realized Spotlight profit for a marketplace money
// event. It is best-effort and MUST NEVER affect the caller's outcome: a nil
// recorder is a no-op, and any error is logged and swallowed so a profit-registry
// failure can never fail or reverse the underlying marketplace transaction. The
// recorded breakdown is resolved server-side from the central rate card; the source
// ref doubles as the idempotency key so retries never double-count.
func (s *Service) recordCommissionSafe(ctx context.Context, category, service, subtype string, grossKobo int64,
	sourceRef string, userID *string) {
	if s.commission == nil || grossKobo <= 0 {
		return
	}
	if err := s.commission.RecordFor(ctx, category, service, subtype, grossKobo,
		"marketplace", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[marketplace] commission record (source=%s gross=%d) failed, continuing: %v", sourceRef, grossKobo, err)
	}
}

// boostLedger is the NARROW finance-ledger seam the boost money-path (§2.4)
// depends on — the sole live marketplace revenue path. Purchase debits the seller
// wallet into the commission (ad-revenue) standing account; reject/auto-refund
// posts a balanced reversal back to the seller wallet. The concrete
// *ledger.Service (injected by app-wiring via NewService) satisfies it, and a small
// in-memory fake implements it in service_boost_test.go so the charge/refund ledger
// effect has an EXECUTED, DB-free unit test. Modeled as a LOCAL interface (mirrors
// the Notifier/Searcher/CommissionRecorder seams); it is the ONLY finance-ledger
// surface the marketplace uses (grep: s.ledger appears only in service_boost.go).
type boostLedger interface {
	GetOrCreateStandingAccount(ctx context.Context, accountType ledger.AccountType) (*ledger.Account, error)
	GetOrCreateUserWallet(ctx context.Context, userID string) (*ledger.Account, error)
	Debit(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error
	// DebitGated is Debit with the strict KYC-tier daily-debit cap evaluated
	// INSIDE the posting tx under the wallet advisory lock — the F7-serialised
	// half of TierEnforcer's pooled EnforceWalletDebitLimit.
	DebitGated(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error
	// Posted reports whether the journal under baseIdempotencyKey already
	// committed — the pooled advisory cap is skipped for a committed key so a
	// replay reaches the in-tx verification instead of refusing at-cap (F2).
	Posted(ctx context.Context, baseIdempotencyKey string) (bool, error)
	PostReversal(ctx context.Context, restoreAccountID, releaseAccountID string, amountKobo int64, reference, idempotencyKey string) error
}

// TierEnforcer is the fail-closed KYC-tier / daily-spend gate on the boost
// purchase money path (§6 FINDING: the boost charge used to call s.ledger.Debit
// directly with no tier-limit/KYC gate at all, unlike every sibling wallet-debit
// money path — estate dues, restaurant escrow/withdrawal, transport, doctor,
// fractionalre). Modeled as a LOCAL interface (mirrors boostLedger/Notifier/
// Searcher/CommissionRecorder) so marketplace depends on the behaviour, not on
// finance/tiers directly. Satisfied by *tiers.Service.
// A boost purchase is a direct wallet debit (not a checkout/escrow allowance
// case), so it uses EnforceWalletDebitLimit — the same choice restaurant
// withdrawals and doctor/fractionalre wallet debits make, never the relaxed
// Tier-0 EnforceCheckoutDebitLimit path.
type TierEnforcer interface {
	EnforceWalletDebitLimit(ctx context.Context, userID string, amountKobo int64) error
}

// WithTiers attaches the fail-closed tier-limit gate used by boost purchases.
// REQUIRED for the money path: without it PurchaseBoost refuses with
// ErrTierGateUnwired rather than silently skipping the check (CLAUDE.md iron
// rule: every money mutation must pass a fail-closed tier-limit check).
func (s *Service) WithTiers(t TierEnforcer) *Service {
	s.tiers = t
	return s
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

// RealtimePublisher pushes a live event to a user's connected clients (SSE). It is
// satisfied by internal/platform/realtime.Hub. Optional — when nil, chat still works
// via the clients' polling/refetch; realtime is a best-effort accelerator.
type RealtimePublisher interface {
	PublishToUser(ctx context.Context, userID, eventType string, payload any) error
}

// WithRealtime attaches an optional live-push sink for chat events.
func (s *Service) WithRealtime(p RealtimePublisher) *Service { s.realtime = p; return s }

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

// listingThumbTTL is how long a thumbnail URL stays valid. Long enough that a
// browse session never sees an image expire mid-scroll, short enough that a
// leaked URL is not a durable handle on the object.
const listingThumbTTL = 6 * time.Hour

// WithThumbPresigner attaches the R2 presigner used to turn a stored object key
// into a fetchable thumbnail URL. Without it listings still serve correctly, just
// with no images — the same behaviour as before thumbnails existed, rather than
// a hard failure on a display concern.
func (s *Service) WithThumbPresigner(p ThumbPresigner) *Service {
	s.thumbs = p
	return s
}

// ThumbPresigner is the slice of the R2 presigner this needs, so the marketplace
// package does not take a dependency on the whole platform client.
type ThumbPresigner interface {
	PresignGet(key string, expiry time.Duration) (string, error)
	Configured() bool
}

// presignThumb converts one stored object key into a fetchable URL, or "" when
// there is no presigner, no key, or signing fails. Never an error: a listing that
// cannot show its photo is still a listing worth returning.
func (s *Service) presignThumb(key string) string {
	if key == "" || s.thumbs == nil || !s.thumbs.Configured() {
		return ""
	}
	url, err := s.thumbs.PresignGet(key, listingThumbTTL)
	if err != nil {
		return ""
	}
	return url
}

// attachThumbs fills ThumbURL for a page of listings in ONE media query plus a
// local signature each (signing is HMAC, no network).
// The objects sit in a private R2 bucket, so the client cannot fetch a raw key —
// it needs a signed URL, which is why this happens on read rather than being
// stored. If a public bucket or CDN binding is configured later, this is the one
// place that changes.
func (s *Service) attachThumbs(ctx context.Context, listings []*Listing) {
	if len(listings) == 0 || s.thumbs == nil || !s.thumbs.Configured() {
		return
	}
	ids := make([]string, 0, len(listings))
	for _, l := range listings {
		if l != nil {
			ids = append(ids, l.ID)
		}
	}
	keys, err := s.repo.ThumbKeysFor(ctx, ids)
	if err != nil {
		// Display-only: a listing page must not fail because a thumbnail lookup did.
		log.Printf("[marketplace] thumbnail lookup failed for %d listing(s): %v", len(ids), err)
		return
	}
	for _, l := range listings {
		if l != nil {
			l.ThumbURL = s.presignThumb(keys[l.ID])
		}
	}
}

// attachFullMedia fills Media with every photo on a SINGLE listing, for the
// detail screen's gallery. Deliberately separate from attachThumbs (which runs
// on pages of results and only ever needs one thumbnail per card) — a detail
// view is one listing, so one extra query here costs nothing search/list can't
// afford to pay per row.
func (s *Service) attachFullMedia(ctx context.Context, l *Listing) {
	if l == nil || s.thumbs == nil || !s.thumbs.Configured() {
		return
	}
	rows, err := s.repo.ListMediaForListing(ctx, l.ID)
	if err != nil {
		// Display-only, same contract as attachThumbs: a listing must still load
		// if its gallery lookup fails.
		log.Printf("[marketplace] full media lookup failed for listing %s: %v", l.ID, err)
		return
	}
	media := make([]ListingMediaItem, 0, len(rows))
	for _, r := range rows {
		url := s.presignThumb(r.Key)
		if url == "" {
			continue
		}
		media = append(media, ListingMediaItem{
			ID: r.ID, URLThumb: url, URLCard: url, URLFull: url,
			Blurhash: r.Blurhash, SortOrder: r.SortOrder,
		})
	}
	l.Media = media
}

// attachMediaForPage is attachFullMedia's batched counterpart, for a PAGE of
// listings rather than one — the "My Listings" screen (SellerListings) reads
// listing.media[] per card, same as the detail gallery, not thumb_url like
// search/browse cards do. One extra query for the whole page, like attachThumbs.
func (s *Service) attachMediaForPage(ctx context.Context, listings []*Listing) {
	if len(listings) == 0 || s.thumbs == nil || !s.thumbs.Configured() {
		return
	}
	ids := make([]string, 0, len(listings))
	for _, l := range listings {
		if l != nil {
			ids = append(ids, l.ID)
		}
	}
	rowsByListing, err := s.repo.MediaForListings(ctx, ids)
	if err != nil {
		log.Printf("[marketplace] page media lookup failed for %d listing(s): %v", len(ids), err)
		return
	}
	for _, l := range listings {
		if l == nil {
			continue
		}
		rows := rowsByListing[l.ID]
		if len(rows) == 0 {
			continue
		}
		media := make([]ListingMediaItem, 0, len(rows))
		for _, r := range rows {
			url := s.presignThumb(r.Key)
			if url == "" {
				continue
			}
			media = append(media, ListingMediaItem{
				ID: r.ID, URLThumb: url, URLCard: url, URLFull: url,
				Blurhash: r.Blurhash, SortOrder: r.SortOrder,
			})
		}
		l.Media = media
	}
}

func (s *Service) Search(ctx context.Context, req any) (any, error) {
	if s.searcher != nil {
		return s.searcher.Search(ctx, req)
	}
	f := parseSearchFallback(req)
	listings, err := s.repo.SearchListingsFallback(ctx, f)
	if err != nil {
		return nil, err
	}
	// A nil slice marshals to `results: null`, and the client maps over it. That was
	// survivable while the fallback answered every market and practically never came
	// back empty; now that it is scoped, an empty market is an ordinary outcome, so
	// the empty case has to be a well-formed empty list rather than null.
	if listings == nil {
		listings = []Listing{}
	}
	ptrs := make([]*Listing, len(listings))
	for i := range listings {
		ptrs[i] = &listings[i]
	}
	s.attachThumbs(ctx, ptrs)
	// Shape a search-response-like envelope the mobile client already understands
	// (results + empty facets + cursor). `degraded` flags the reduced mode.
	// next_cursor used to be hardcoded nil, so the degraded path could only ever
	// serve page 1 no matter how many active listings existed beyond the first
	// LIMIT-bounded page (the repo query had no OFFSET at all — see
	// SearchListingsFallback). A full page implies there may be more; emit the
	// real next offset (current offset + page size) the same way the ES client
	// does, so the two search backends share one cursor format.
	var nextCursor any
	if len(listings) == clampLimit(f.Limit) {
		nextCursor = strconv.Itoa(f.Offset + clampLimit(f.Limit))
	}
	return map[string]any{
		"results":     listings,
		"facets":      map[string]any{"categories": []any{}, "conditions": []any{}, "price_ranges": []any{}},
		"next_cursor": nextCursor,
		"took_ms":     0,
		"degraded":    true,
	}, nil
}

// parseSearchFallback extracts the Postgres-fallback filter set from the handler's
// provider-agnostic request map (values are the raw query-param strings).
func parseSearchFallback(req any) SearchFallbackFilter {
	m, _ := req.(map[string]any)
	// Seeded with the market scope so EVERY return path below carries one. The nil
	// return used to leave MarketID empty, which is the unscoped-search bug again by
	// the back door — a caller passing a non-map got every market's listings.
	f := SearchFallbackFilter{MarketID: DefaultMarketID}
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
	// The handler has always put market_id in this map; nothing read it, so the
	// Postgres fallback searched every market. Default rather than leave it empty:
	// an unscoped search is the bug, so a caller that forgets the key gets the
	// default market, never all of them.
	f.MarketID = getStr("market_id")
	if f.MarketID == "" {
		f.MarketID = DefaultMarketID
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
	// Cursor mirrors the ES client's opaque cursor: a plain base-10 offset.
	// A missing/malformed/negative cursor degrades to page 1 (offset 0)
	// rather than erroring.
	if cur := getStr("cursor"); cur != "" {
		if n, err := strconv.Atoi(cur); err == nil && n > 0 {
			f.Offset = n
		}
	}
	return f
}

// SellerProfile returns a seller's trust card.
func (s *Service) SellerProfile(ctx context.Context, sellerID string) (*TrustProfile, error) {
	return s.repo.GetTrustProfile(ctx, sellerID)
}

// SellerListings returns a seller's listings.
// SellerListings is the PUBLIC storefront read (GET /sellers/:id/listings, no
// auth) — a buyer browsing a seller's portfolio, so only ever active listings
// (never a draft/pending_review/paused/removed_user row a buyer has no
// business seeing). This route has no auth middleware at all (base group,
// marketplace_routes.go), so there is no caller identity to compare against
// :id here — see MyListingsForSeller for the seller's own, all-statuses view.
func (s *Service) SellerListings(ctx context.Context, sellerID string, limit, offset int) ([]Listing, error) {
	return s.sellerListingsWithMedia(ctx, sellerID, limit, offset, true)
}

// MyListingsForSeller is the AUTHENTICATED self-view (GET /listings/mine) —
// the seller managing their own listings needs every status (draft awaiting
// submit, pending_review, paused, expired, sold, removed) to act on it, which
// is exactly what a buyer must never see through SellerListings above.
func (s *Service) MyListingsForSeller(ctx context.Context, sellerID string, limit, offset int) ([]Listing, error) {
	return s.sellerListingsWithMedia(ctx, sellerID, limit, offset, false)
}

func (s *Service) sellerListingsWithMedia(ctx context.Context, sellerID string, limit, offset int, onlyActive bool) ([]Listing, error) {
	ls, err := s.repo.ListSellerListings(ctx, sellerID, limit, offset, onlyActive)
	if err != nil {
		return nil, err
	}
	// This backs the "My listings" screen too — the one a seller checks right
	// after uploading photos, so it is the last place that should show a
	// placeholder. attachThumbs covers thumb_url; attachMediaForPage
	// additionally covers media[], which is what the screen actually reads for
	// its card photo.
	ptrs := make([]*Listing, len(ls))
	for i := range ls {
		ptrs[i] = &ls[i]
	}
	s.attachThumbs(ctx, ptrs)
	s.attachMediaForPage(ctx, ptrs)
	return ls, nil
}

// SellerReviews returns a seller's visible reviews — mkt_deal_reviews
// (thread-keyed, ADR-023), NOT the dead order-keyed mkt_reviews table
// ListSellerReviews still reads. Every review since ADR-023 removed escrow
// orders has been written via SubmitDealReview into mkt_deal_reviews; the old
// table has taken no new rows since, so a seller's real reviews were never
// reaching this endpoint (and the JSON shape didn't even match the mobile
// Review type's camelCase contract — see ListRevieweeDealReviews's doc).
func (s *Service) SellerReviews(ctx context.Context, sellerID string, limit, offset int) ([]DealReview, error) {
	return s.repo.ListRevieweeDealReviews(ctx, sellerID, limit, offset)
}

// Self-serve verification submission lives in verification.go
// (SubmitIDVerification / SubmitBusinessVerification). The badge grant itself
// moved behind admin review — see ReviewKYC in service_admin.go, the ONLY
// path that calls repo.SetVerifiedBadge now.

// CreateOffer places a pending offer on a listing.
func (s *Service) CreateOffer(ctx context.Context, buyerID, listingID string, offerKobo int64, message string) (*Offer, error) {
	// Guard before the fetch: an empty listingID would reach the repository and
	// surface as 500 "invalid input syntax for type uuid" — an empty id is a
	// caller error (400), not a DB error.
	if strings.TrimSpace(listingID) == "" {
		return nil, fieldErr(CodeValidation, "listing_id is required", "listing_id")
	}
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
	o, err := s.repo.InsertOffer(ctx, &Offer{ListingID: listingID, BuyerID: buyerID, OfferPriceKobo: offerKobo})
	if err != nil {
		return nil, err
	}
	// Best-effort: post an optional buyer note into the buyer↔seller deal thread so
	// the offer and its message live together in the deal room. Never fail the offer
	// if messaging errors — the offer is the durable record.
	if strings.TrimSpace(message) != "" {
		_, _ = s.StartOrGetThread(ctx, buyerID, listingID, message)
	}
	return o, nil
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

// ListOffersForListing returns the negotiation history for a listing, scoped to the
// caller (object-level auth): the listing's seller sees every offer; any other caller
// (a buyer) sees only the offers they themselves made. Ordered oldest→newest so the
// deal room can render the counter-offer chain in sequence.
func (s *Service) ListOffersForListing(ctx context.Context, callerID, listingID string) ([]Offer, error) {
	l, err := s.repo.GetListing(ctx, listingID)
	if err != nil {
		return nil, err
	}
	if l.SellerID == callerID {
		return s.repo.ListOffersByListing(ctx, listingID, "")
	}
	// Buyer view: only their own offers on this listing.
	return s.repo.ListOffersByListing(ctx, listingID, callerID)
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

// Auto-moderation pre-filter (§2.1 submit). Risk-tier-0 categories auto-approve for
// trusted sellers straight to `active` with no human review — so a content screen
// MUST run first, or a trusted account can publish prohibited content instantly.
// This is a conservative, dependency-free keyword screen: a hit does NOT auto-reject
// (a human decides) — it only DENIES the auto-approve fast-path and routes the listing
// to pending_review with a reason. The keyword set is a deliberately small,
// high-precision starter list; admins extend the real policy list over time.

// systemActorID is the nil-UUID actor recorded in the immutable audit trail for
// automated (non-human) decisions such as the auto-moderation flag. admin_id is a
// NOT-NULL uuid column, so automated writes attribute to the all-zeros UUID.
const systemActorID = "00000000-0000-0000-0000-000000000000"

// prohibitedPatterns maps a moderation reason code to the terms that trip it. Terms
// are matched case-insensitively on word boundaries so "gun" does not match "began".
var prohibitedPatterns = map[string][]string{
	"weapons":             {"ak47", "ak-47", "handgun", "handguns", "firearm", "firearms", "ammunition", "ammo", "grenade", "grenades"},
	"drugs":               {"cocaine", "heroin", "mdma", "meth", "methamphetamine", "tramadol", "codeine syrup"},
	"counterfeit":         {"counterfeit", "fake currency", "cloned card", "cloned cards", "cvv dump", "cvv dumps"},
	"human_harm":          {"human organ", "human organs", "kidney for sale"},
	"payment_evasion":     {"pay outside", "cash only no escrow", "bypass escrow", "send to my account first"},
	"prohibited_wildlife": {"ivory tusk", "pangolin scales", "elephant tusk"},
}

// compiledProhibited is prohibitedPatterns compiled once into word-boundary regexps.
var compiledProhibited = func() map[string]*regexp.Regexp {
	out := make(map[string]*regexp.Regexp, len(prohibitedPatterns))
	for reason, terms := range prohibitedPatterns {
		quoted := make([]string, len(terms))
		for i, t := range terms {
			quoted[i] = regexp.QuoteMeta(t)
		}
		// \b works for the alnum-boundary terms; phrases with spaces still match.
		out[reason] = regexp.MustCompile(`(?i)\b(` + strings.Join(quoted, "|") + `)\b`)
	}
	return out
}()

// screenText reports the first prohibited-content reason found in text, or "" if clean.
// Deterministic order is not guaranteed across reasons (map iteration), but any hit is
// sufficient to route to review, so the exact reason among multiple hits is not
// safety-critical.
func screenText(text string) string {
	if strings.TrimSpace(text) == "" {
		return ""
	}
	for reason, re := range compiledProhibited {
		if re.MatchString(text) {
			return reason
		}
	}
	return ""
}

// screenListingContent screens a listing's user-authored surface (title, description,
// and string-valued attrs) and returns a reason code if anything trips the filter.
// Pure and testable — no I/O.
func screenListingContent(title, description string, attrs map[string]any) string {
	if r := screenText(title); r != "" {
		return r
	}
	if r := screenText(description); r != "" {
		return r
	}
	for _, v := range attrs {
		if sv, ok := v.(string); ok {
			if r := screenText(sv); r != "" {
				return r
			}
		}
	}
	return ""
}
