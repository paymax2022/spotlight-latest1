package marketplace

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"
	"net/http"
	"path"
	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/platform/r2"
	"strconv"
	"strings"
	"time"
)

// Handler exposes the member (auth) + public marketplace routes. Admin routes live
// in admin_handler.go; inbound webhooks in webhook_handler.go. All share this struct.
type Handler struct {
	svc           *Service
	webhookSecret string        // HMAC secret for inbound logistics/payments webhooks
	presigner     *r2.Presigner // optional; nil/unconfigured ⇒ media presign 503
	presignBucket string        // R2 bucket echoed back in the presign response
}

// NewHandler constructs the marketplace handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// WithWebhookSecret sets the shared inbound-webhook HMAC secret.
func (h *Handler) WithWebhookSecret(secret string) *Handler { h.webhookSecret = secret; return h }

// viewerIDForCounting returns the caller's user id for VIEW-COUNTING ONLY.
// ⚠️ NOT AUTHENTICATION. With no auth middleware it reads the `sub` claim
// WITHOUT verifying the signature, so the value is attacker-controllable — it
// is deliberately never written into the gin context, which every authz check
// in this package trusts. Acceptable here because it gates only a counter
// increment on the auth-optional GET /listings/:id (a forged token can at most
// suppress counting of the forger's own views); the verified alternative,
// supabase.AuthUser(), is a GoTrue round trip on the hottest public read.
// Pass it straight to RecordListingView, nowhere else.
func viewerIDForCounting(c *gin.Context) string {
	if id := ginutil.UserID(c); id != "" {
		return id // a real middleware ran — trust that instead
	}
	h := strings.TrimSpace(c.GetHeader("Authorization"))
	if !strings.HasPrefix(strings.ToLower(h), "bearer ") {
		return ""
	}
	parts := strings.Split(strings.TrimSpace(h[7:]), ".")
	if len(parts) != 3 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims struct {
		Sub string `json:"sub"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ""
	}
	// Shape-check before it reaches a ::uuid cast: a malformed sub would abort the
	// UPDATE, which would silently stop counting views for that request.
	if _, err := uuid.Parse(claims.Sub); err != nil {
		return ""
	}
	return claims.Sub
}

// respond writes the uniform success envelope.
func respond(c *gin.Context, status int, data any) {
	c.JSON(status, gin.H{"data": data})
}

// fail maps any error to the frozen uniform error shape
// {"error":{code,message,field,request_id}}. A replayError replays the original
// cached 2xx body (§3: 409 IDEMPOTENCY_KEY_REPLAY returns the original response).
func fail(c *gin.Context, err error) {
	var re replayError
	if errors.As(err, &re) {
		c.Data(re.Stored.Status, "application/json; charset=utf-8", re.Stored.Body)
		return
	}
	ce := asCoded(err)
	requestID := c.GetString("request_id")
	if requestID == "" {
		requestID = c.GetHeader("X-Request-Id")
	}
	c.JSON(ce.Status, gin.H{"error": gin.H{
		"code":       ce.Code,
		"message":    httperr.Sanitize(c, ce.Status, ce.Message),
		"field":      ce.Field,
		"request_id": requestID,
	}})
}

func pageParams(c *gin.Context) (limit, offset int) {
	limit, _ = strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ = strconv.Atoi(c.DefaultQuery("offset", "0"))
	return
}

// requireUser aborts with 401 when unauthenticated; returns the uid otherwise.
func requireUser(c *gin.Context) (string, bool) {
	uid := ginutil.UserID(c)
	if uid == "" {
		fail(c, ErrUnauthenticated)
		return "", false
	}
	return uid, true
}

// CreateListing POST /listings
func (h *Handler) CreateListing(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var in CreateListingInput
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	l, err := h.svc.CreateListing(c.Request.Context(), uid, in)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusCreated, l)
}

// GetListing GET /listings/:id
func (h *Handler) GetListing(c *gin.Context) {
	l, err := h.svc.GetListing(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	// Tombstone gate (E2E-SOC-037): a soft-deleted listing answers
	// LISTING_NOT_FOUND, identical to a row that never existed — the public
	// read path must not leak removed_user/removed_policy rows. Checked before
	// RecordListingView so a removed listing does not keep counting views.
	if listingTombstoned(l.Status) {
		fail(c, ErrListingNotFound)
		return
	}
	// Count the view only after a successful read, and never on the error path.
	// Best effort by design: a failed counter bump must not fail loading a
	// listing. Anonymous browsers (this route is tier0_browse) resolve to "" and
	// still count — only the seller's own visits are excluded, inside the UPDATE.
	// Called before respond so the request context is still live.
	// viewerIDForCounting, NOT userID: no auth middleware runs on this route, so
	// userID is always "". See its doc for why an unverified id is sound for a
	// counter and why it must never reach the gin context.
	h.svc.RecordListingView(c.Request.Context(), c.Param("id"), viewerIDForCounting(c))
	respond(c, http.StatusOK, l)
}

// UpdateListing PUT /listings/:id
func (h *Handler) UpdateListing(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var in UpdateListingInput
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	l, err := h.svc.UpdateListing(c.Request.Context(), uid, c.Param("id"), in)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, l)
}

// AddListingMediaRequest is POST /listings/:id/media.
type AddListingMediaRequest struct {
	MediaIDs []string `json:"media_ids" binding:"required"`
}

// AddListingMedia POST /listings/:id/media
func (h *Handler) AddListingMedia(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var in AddListingMediaRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), "media_ids"))
		return
	}
	l, err := h.svc.AddListingMedia(c.Request.Context(), uid, c.Param("id"), in.MediaIDs)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, l)
}

// RemoveListingMedia DELETE /listings/:id/media/:mediaId
func (h *Handler) RemoveListingMedia(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	l, err := h.svc.RemoveListingMedia(c.Request.Context(), uid, c.Param("id"), c.Param("mediaId"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, l)
}

// ReorderListingMediaRequest is PUT /listings/:id/media/reorder.
type ReorderListingMediaRequest struct {
	MediaIDs []string `json:"media_ids" binding:"required"`
}

// ReorderListingMedia PUT /listings/:id/media/reorder
func (h *Handler) ReorderListingMedia(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var in ReorderListingMediaRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), "media_ids"))
		return
	}
	l, err := h.svc.ReorderListingMedia(c.Request.Context(), uid, c.Param("id"), in.MediaIDs)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, l)
}

// SubmitListing POST /listings/:id/submit
func (h *Handler) SubmitListing(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	l, err := h.svc.SubmitListing(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, l)
}

// PauseListing POST /listings/:id/pause
func (h *Handler) PauseListing(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	l, err := h.svc.PauseListing(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, l)
}

// ResumeListing POST /listings/:id/resume
func (h *Handler) ResumeListing(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	l, err := h.svc.ResumeListing(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, l)
}

// MarkSoldListing POST /listings/:id/mark-sold
func (h *Handler) RenewListing(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	l, err := h.svc.RenewListing(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, l)
}

func (h *Handler) MarkSoldListing(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	l, err := h.svc.MarkSoldListing(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, l)
}

// RevealSellerContact POST /listings/:id/contact
func (h *Handler) RevealSellerContact(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	contact, err := h.svc.RevealSellerContact(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, contact)
}

// DeleteListing DELETE /listings/:id
func (h *Handler) DeleteListing(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	l, err := h.svc.DeleteListing(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, l)
}

// PurgeListing DELETE /listings/:id/permanent — IRREVERSIBLE, unlike
// DeleteListing which only flips status to removed_user. Refused with 409
// LISTING_HAS_HISTORY when the listing carries orders, boosts, offers or threads.
func (h *Handler) PurgeListing(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	if err := h.svc.PurgeListing(c.Request.Context(), uid, c.Param("id")); err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, gin.H{"purged": true, "listing_id": c.Param("id")})
}

// Search GET /search — calls the injected searcher; 501 when unwired.
func (h *Handler) Search(c *gin.Context) {
	// Build a provider-agnostic request map from the query (§3.2 params). Agent B's
	// injected client adapts this to its own search.SearchRequest.
	// limit only — offset used to be read here via pageParams and stuffed into
	// this map under "offset", but NOTHING downstream ever reads that key: both
	// consumers (app-wiring's toSearchRequest for the ES path, and
	// parseSearchFallback for the Postgres degraded path) read "cursor", a
	// STRING, not "offset", an int. c.Query("cursor") itself was never read at
	// all. Net effect: the ?cursor= a paging client sent was silently dropped
	// at the HTTP boundary and every page request executed as if it were page
	// 1, no matter what the query builder/repo below did with Cursor — the
	// same bug shape as the query builder never reading SearchRequest.Cursor.
	limit, _ := pageParams(c)
	req := map[string]any{
		"q":           c.Query("q"),
		"category_id": c.Query("category_id"),
		"price_min":   c.Query("price_min"),
		"price_max":   c.Query("price_max"),
		"condition":   c.Query("condition"),
		"state":       c.Query("state"),
		"lga":         c.Query("lga"),
		"lat":         c.Query("lat"),
		"lng":         c.Query("lng"),
		"radius_km":   c.Query("radius_km"),
		"sort":        c.DefaultQuery("sort", "relevance"),
		"limit":       limit,
		"cursor":      c.Query("cursor"),
		// Same shape as Categories on the line below: one screen, one market, and the
		// same way of asking for a different one.
		"market_id": c.DefaultQuery("market_id", DefaultMarketID),
	}
	res, err := h.svc.Search(c.Request.Context(), req)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, res)
}

// Categories GET /categories
func (h *Handler) Categories(c *gin.Context) {
	cats, err := h.svc.ListCategories(c.Request.Context(), c.DefaultQuery("market_id", DefaultMarketID))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, cats)
}

// GetCategory GET /categories/:id
func (h *Handler) GetCategory(c *gin.Context) {
	cat, err := h.svc.GetCategory(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, cat)
}

// CreateOffer POST /offers
func (h *Handler) CreateOffer(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body createOfferRequest // wire_requests.go — snake_case, per the contract
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	o, err := h.svc.CreateOffer(c.Request.Context(), uid, body.listingID(), body.priceKobo(), body.Message)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusCreated, o)
}

// AcceptOffer POST /offers/:id/accept
func (h *Handler) AcceptOffer(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	o, err := h.svc.AcceptOffer(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, o)
}

// CounterOffer POST /offers/:id/counter
func (h *Handler) CounterOffer(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body counterOfferRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	o, err := h.svc.CounterOffer(c.Request.Context(), uid, c.Param("id"), body.priceKobo())
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusCreated, o)
}

// DeclineOffer POST /offers/:id/decline
func (h *Handler) DeclineOffer(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	o, err := h.svc.DeclineOffer(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, o)
}

// ListOffers GET /offers?listing_id=… — negotiation history for a listing, scoped
// to the caller: the listing's seller sees every offer; a buyer sees only their own.
func (h *Handler) ListOffers(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	listingID := listingIDQuery(c) // wire_requests.go
	if listingID == "" {
		fail(c, fieldErr(CodeValidation, "listing_id is required", "listing_id"))
		return
	}
	offers, err := h.svc.ListOffersForListing(c.Request.Context(), uid, listingID)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, offers)
}

// ─── Orders/Disputes REMOVED (ADR-023 listings-and-connect pivot) ────────────
// The escrow order money-path and dispute endpoints were retired; parties transact
// off-platform (Meetup Mode). Their handlers, the order/dispute FSM, and the
// logistics/payments webhooks have been deleted. mkt_orders/mkt_disputes tables are
// retained (additive-only) but unused.

// BoostTiers GET /boosts/tiers
func (h *Handler) BoostTiers(c *gin.Context) {
	tiers, err := h.svc.ListBoostTiers(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, tiers)
}

// GetBoostQuote GET /boosts/quote?tier=<pkg>  OR  ?ends_at=<RFC3339> — a
// live, authoritative price preview so the client can show "5 days × ₦100 =
// ₦500" before the user commits to POST /boosts. Public (no auth): pricing
// info alone, no listing/wallet access.
func (h *Handler) GetBoostQuote(c *gin.Context) {
	var endsAt *time.Time
	if raw := c.Query("ends_at"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			fail(c, fieldErr(CodeValidation, "ends_at must be an RFC3339 timestamp", "ends_at"))
			return
		}
		endsAt = &t
	}
	q, err := h.svc.ComputeBoostQuote(c.Request.Context(), c.Query("tier"), endsAt)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, q)
}

// CreateBoost POST /boosts (Idempotency-Key)
func (h *Handler) CreateBoost(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var in CreateBoostInput
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	b, err := h.svc.PurchaseBoost(c.Request.Context(), uid, ginutil.IdempotencyKey(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusCreated, b)
}

// GetBoost GET /boosts/:id — OLA: owner.
func (h *Handler) GetBoost(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	b, err := h.svc.GetBoost(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	if b.SellerID != uid {
		fail(c, ErrForbidden)
		return
	}
	respond(c, http.StatusOK, b)
}

// CreateSavedSearch POST /saved-searches
func (h *Handler) CreateSavedSearch(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body struct {
		Query        *string        `json:"query"`
		Filters      map[string]any `json:"filters"`
		AlertEnabled bool           `json:"alert_enabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	s, err := h.svc.CreateSavedSearch(c.Request.Context(), uid, SavedSearch{Query: body.Query, Filters: body.Filters, AlertEnabled: body.AlertEnabled})
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusCreated, s)
}

// ListSavedSearches GET /saved-searches
func (h *Handler) ListSavedSearches(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	ss, err := h.svc.ListSavedSearches(c.Request.Context(), uid)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, ss)
}

// DeleteSavedSearch DELETE /saved-searches/:id
func (h *Handler) DeleteSavedSearch(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	if err := h.svc.DeleteSavedSearch(c.Request.Context(), uid, c.Param("id")); err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, gin.H{"ok": true})
}

// ToggleSavedSearch PATCH /saved-searches/:id
func (h *Handler) ToggleSavedSearch(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body struct {
		AlertEnabled bool `json:"alert_enabled"`
	}
	_ = c.ShouldBindJSON(&body)
	if err := h.svc.ToggleSavedSearchAlert(c.Request.Context(), uid, c.Param("id"), body.AlertEnabled); err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, gin.H{"ok": true})
}

// SellerProfile GET /sellers/:id/profile
func (h *Handler) SellerProfile(c *gin.Context) {
	p, err := h.svc.SellerProfile(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, p)
}

// SellerListings GET /sellers/:id/listings
func (h *Handler) SellerListings(c *gin.Context) {
	limit, offset := pageParams(c)
	ls, err := h.svc.SellerListings(c.Request.Context(), c.Param("id"), limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, ls)
}

// MyListings GET /listings/mine (authenticated) — the seller's own "My
// Listings" screen, every status. SellerListings above is the public
// storefront counterpart and only ever returns active listings; this is the
// one place a seller sees their drafts/pending_review/paused/removed rows.
// CancelBoost POST /boosts/:id/cancel (seller) — stops the caller's own active
// boost early, with a prorated refund. See RejectBoost (admin group) for the
// full-refund policy-violation counterpart.
func (h *Handler) CancelBoost(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	b, err := h.svc.CancelBoost(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, b)
}

func (h *Handler) MyListings(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	limit, offset := pageParams(c)
	ls, err := h.svc.MyListingsForSeller(c.Request.Context(), uid, limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, ls)
}

// SellerReviews GET /sellers/:id/reviews
func (h *Handler) SellerReviews(c *gin.Context) {
	limit, offset := pageParams(c)
	rs, err := h.svc.SellerReviews(c.Request.Context(), c.Param("id"), limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, rs)
}

// VerifyID POST /verification/id
func (h *Handler) VerifyID(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	if err := h.svc.VerifyID(c.Request.Context(), uid); err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, gin.H{"verified_id_badge": true})
}

// VerifyBusiness POST /verification/business
func (h *Handler) VerifyBusiness(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	if err := h.svc.VerifyBusiness(c.Request.Context(), uid); err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, gin.H{"verified_business_badge": true})
}

// idempotency implements the §5 `idem:{key}` 24h replay cache. On the first
// request for a key we store the serialized response; a replay returns that exact
// original response body (§3: 409 IDEMPOTENCY_KEY_REPLAY returns the original 201,
// not an error).
// Redis is the fast path; when Redis is nil (dev/CI) the durable correctness
// backstop is the DB-side natural uniqueness — mkt_orders.idempotency_key UNIQUE
// and the ledger's own unique idempotency_key. So a nil redis never means a double
// money movement, only that we cannot cheaply replay the cached body.

const idemTTL = 24 * time.Hour

// storedResponse is the cached idempotent response envelope.
type storedResponse struct {
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
}

// idemKeyRedis is the §5 key pattern.
func idemKeyRedis(key string) string { return "idem:" + key }

// checkIdempotent returns (stored, true, nil) when a prior response is cached for
// the key. When nothing is cached (or Redis is nil) it returns (_, false, nil).
func checkIdempotent(ctx context.Context, rdb *goredis.Client, key string) (*storedResponse, bool, error) {
	if rdb == nil || key == "" {
		return nil, false, nil
	}
	raw, err := rdb.Get(ctx, idemKeyRedis(key)).Result()
	if errors.Is(err, goredis.Nil) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, nil // treat cache miss on error; DB unique is the backstop
	}
	var sr storedResponse
	if err := json.Unmarshal([]byte(raw), &sr); err != nil {
		return nil, false, nil
	}
	return &sr, true, nil
}

// saveIdempotent caches a response body under the key for 24h. Best-effort: a
// Redis failure is swallowed (DB-unique remains the correctness backstop).
func saveIdempotent(ctx context.Context, rdb *goredis.Client, key string, status int, body any) {
	if rdb == nil || key == "" {
		return
	}
	b, err := json.Marshal(body)
	if err != nil {
		return
	}
	sr := storedResponse{Status: status, Body: b}
	raw, err := json.Marshal(sr)
	if err != nil {
		return
	}
	// SetNX so a concurrent double-submit does not clobber the first stored body.
	_ = rdb.SetNX(ctx, idemKeyRedis(key), raw, idemTTL).Err()
}

// replayError is returned by the service to signal the handler to replay the cached
// body (HTTP 409 semantics but with the original 2xx payload).
type replayError struct {
	Stored *storedResponse
}

func (replayError) Error() string { return "idempotency replay" }

// presign.go — backend-owned presigned Cloudflare R2 uploads for listing photos.
// Gap endpoint the Sell agent's Smart Composer needs: the client cannot upload a
// binary through our JSON API, so it asks for a short-lived presigned PUT URL and
// PUTs the image straight to R2. This mirrors the estate module's presign pattern
// (backend/internal/estate/presign.go) exactly — server-controlled object key,
// Content-Type bound into the signature, fail-closed 503 when R2 is unconfigured
// (NEVER a fabricated URL).
// Object key is scoped to the authenticated seller:
//   marketplace/<userID>/<rand>.<ext>
// so a client can neither overwrite another seller's objects nor smuggle a path.

// listingMediaPresignTTL bounds how long an issued upload URL is valid.
const listingMediaPresignTTL = 10 * time.Minute

// listingMediaContentTypes restricts what a presigned PUT may upload (bound into
// the signature, so the client must send exactly this Content-Type).
var listingMediaContentTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/webp": true,
}

// listingMediaExt restricts the file extension appended to the derived key. The
// extension is inferred from either the client-declared MIME type or the file
// name (whichever resolves) so the key always carries a safe, known suffix.
var listingMediaExt = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
}

var listingMediaAllowedExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".webp": true,
}

// WithPresigner attaches an R2 presigner (+ bucket) so the listing-media upload
// endpoint can mint presigned PUT URLs. A nil/unconfigured presigner makes the
// endpoint fail closed with 503.
func (h *Handler) WithPresigner(p *r2.Presigner, bucket string) *Handler {
	h.presigner = p
	h.presignBucket = bucket
	return h
}

// PresignMediaRequest is the body for POST /listings/media/presign.
type PresignMediaRequest struct {
	FileName string `json:"file_name"`
	MimeType string `json:"mime_type"`
}

// PresignMedia issues a presigned R2 PUT URL scoped to the authenticated seller.
// POST /v1/marketplace/media/presign
// Body:  { file_name, mime_type }
// Reply: { upload_url, file_url, object_key, mime_type, expires_in, method }
func (h *Handler) PresignMedia(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	if h.presigner == nil || !h.presigner.Configured() {
		fail(c, newErr(http.StatusServiceUnavailable, CodeUploadsNotConfigured, "listing media uploads are not configured"))
		return
	}

	var req PresignMediaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}

	mime := strings.ToLower(strings.TrimSpace(req.MimeType))
	if !listingMediaContentTypes[mime] {
		fail(c, fieldErr(CodeValidation, "unsupported mime_type (png, jpeg, webp only)", "mime_type"))
		return
	}

	// Extension: prefer the MIME-derived one; fall back to the file name's ext.
	ext := listingMediaExt[mime]
	if ext == "" {
		fnExt := strings.ToLower(path.Ext(req.FileName))
		if listingMediaAllowedExt[fnExt] {
			ext = fnExt
		}
	}
	if ext == "" {
		fail(c, fieldErr(CodeValidation, "unsupported file extension", "file_name"))
		return
	}

	// Server-controlled key: the client cannot influence the path beyond its own
	// scope; the random component prevents guessing/overwrite.
	key := "marketplace/" + uid + "/" + cryptox.Token() + ext

	url, err := h.presigner.PresignPut(key, mime, listingMediaPresignTTL)
	if err != nil {
		if errors.Is(err, r2.ErrNotConfigured) {
			fail(c, newErr(http.StatusServiceUnavailable, CodeUploadsNotConfigured, "listing media uploads are not configured"))
			return
		}
		fail(c, newErr(http.StatusInternalServerError, CodeInternal, "could not issue upload url"))
		return
	}

	respond(c, http.StatusOK, gin.H{
		"upload_url": url,
		// file_url is the canonical object reference the client echoes back on
		// listing create (media_ids). It is the object key, not a public URL —
		// public delivery is served through the R2/CDN binding, not from here.
		"file_url":   key,
		"object_key": key,
		"bucket":     h.presignBucket,
		"mime_type":  mime,
		"expires_in": int(listingMediaPresignTTL.Seconds()),
		"method":     "PUT",
	})
}

// VerifyHMAC reports whether sigHex is a valid HMAC-SHA512 (hex-encoded)
// signature of body under secret. It is the gate that runs BEFORE any handler
// logic on inbound logistics/payments webhooks.
// Fail-closed by contract: an empty secret or empty signature returns false
// even though the underlying comparison would already reject them — an empty
// secret would make the MAC forgeable by anyone. The final comparison is
// constant-time (subtle.ConstantTimeCompare) to avoid timing side channels.
func VerifyHMAC(secret string, body []byte, sigHex string) bool {
	if secret == "" || sigHex == "" {
		return false
	}
	return cryptox.VerifyHMACSHA512(secret, body, sigHex)
}
