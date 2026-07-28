package marketplace

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/platform/r2"
)

// Handler exposes the member (auth) + public marketplace routes. Admin routes live
// in admin_handler.go; inbound webhooks in webhook_handler.go. All share this struct.
type Handler struct {
	svc           *Service
	webhookSecret string       // HMAC secret for inbound logistics/payments webhooks
	presigner     *r2.Presigner // optional; nil/unconfigured ⇒ media presign 503
	presignBucket string        // R2 bucket echoed back in the presign response
}

// NewHandler constructs the marketplace handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// WithWebhookSecret sets the shared inbound-webhook HMAC secret.
func (h *Handler) WithWebhookSecret(secret string) *Handler { h.webhookSecret = secret; return h }

func userID(c *gin.Context) string { return c.GetString("user_id") }

func idemKeyOf(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

// respond writes the uniform success envelope.
func respond(c *gin.Context, status int, data any) {
	c.JSON(status, gin.H{"data": data})
}

// fail maps any error to the frozen uniform error shape
// {"error":{code,message,field,request_id}}. A replayError replays the original
// cached 2xx body (§3: 409 IDEMPOTENCY_KEY_REPLAY returns the original response).
func fail(c *gin.Context, err error) {
	if stored, ok := asReplay(err); ok && stored != nil {
		c.Data(stored.Status, "application/json; charset=utf-8", stored.Body)
		return
	}
	ce := asCoded(err)
	c.JSON(ce.Status, gin.H{"error": gin.H{
		"code":       ce.Code,
		"message":    ce.Message,
		"field":      ce.Field,
		"request_id": requestID(c),
	}})
}

func requestID(c *gin.Context) string {
	if id := c.GetString("request_id"); id != "" {
		return id
	}
	return c.GetHeader("X-Request-Id")
}

func pageParams(c *gin.Context) (limit, offset int) {
	limit, _ = strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ = strconv.Atoi(c.DefaultQuery("offset", "0"))
	return
}

// requireUser aborts with 401 when unauthenticated; returns the uid otherwise.
func requireUser(c *gin.Context) (string, bool) {
	uid := userID(c)
	if uid == "" {
		fail(c, ErrUnauthenticated)
		return "", false
	}
	return uid, true
}

// ─── Listings ────────────────────────────────────────────────────────────────

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

// ─── Search + categories ─────────────────────────────────────────────────────

// Search GET /search — calls the injected searcher; 501 when unwired.
func (h *Handler) Search(c *gin.Context) {
	// Build a provider-agnostic request map from the query (§3.2 params). Agent B's
	// injected client adapts this to its own search.SearchRequest.
	limit, offset := pageParams(c)
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
		"offset":      offset,
		"market_id":   DefaultMarketID,
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

// ─── Offers ──────────────────────────────────────────────────────────────────

// CreateOffer POST /offers
func (h *Handler) CreateOffer(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body struct {
		ListingID      string `json:"listing_id"`
		OfferPriceKobo int64  `json:"offer_price_kobo"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	o, err := h.svc.CreateOffer(c.Request.Context(), uid, body.ListingID, body.OfferPriceKobo)
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
	var body struct {
		OfferPriceKobo int64 `json:"offer_price_kobo"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	o, err := h.svc.CounterOffer(c.Request.Context(), uid, c.Param("id"), body.OfferPriceKobo)
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

// ─── Orders/Disputes REMOVED (ADR-023 listings-and-connect pivot) ────────────
// The escrow order money-path and dispute endpoints were retired; parties transact
// off-platform (Meetup Mode). Their handlers, the order/dispute FSM, and the
// logistics/payments webhooks have been deleted. mkt_orders/mkt_disputes tables are
// retained (additive-only) but unused.

// ─── Boosts ──────────────────────────────────────────────────────────────────

// BoostTiers GET /boosts/tiers
func (h *Handler) BoostTiers(c *gin.Context) {
	respond(c, http.StatusOK, h.svc.ListBoostTiers())
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
	b, err := h.svc.PurchaseBoost(c.Request.Context(), uid, idemKeyOf(c), in)
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

// ─── Saved searches ──────────────────────────────────────────────────────────

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

// ─── Sellers ─────────────────────────────────────────────────────────────────

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

// ─── Verification ────────────────────────────────────────────────────────────

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
