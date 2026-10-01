package marketplace

import (
	"context"
	"github.com/gin-gonic/gin"
	"net/http"
	"spotlight/backend/go-common/strutil"
	"strings"
	"time"
)

// messaging_service.go implements the ADR-023 listings-and-connect "connect" model:
// thin, participant-authorized methods over the messaging store. This is NOT a money
// path — no ledger, no idempotency key. Object-level authorization (only a thread's
// buyer or seller may read/write) is MANDATORY and is enforced by the repository's
// participant-scoped queries, re-asserted here where a coded error is returned.

// maxMessageBodyLen bounds a single free-text message (defense against unbounded blobs;
// messages are metadata, not documents).
const maxMessageBodyLen = 4000

// StartOrGetThread resolves (or opens) the caller's 1:1 conversation about a listing and
// returns the caller-relative DealThread. It rejects self-messaging and a non-existent
// listing (both surfaced by the store). An optional first message is sent when non-empty.
func (s *Service) StartOrGetThread(ctx context.Context, buyerID, listingID, firstMessage string) (*DealThread, error) {
	if buyerID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(listingID) == "" {
		return nil, fieldErr(CodeValidation, "listing_id is required", "listing_id")
	}
	tr, err := s.repo.GetOrCreateThread(ctx, listingID, buyerID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(firstMessage) != "" {
		if _, err := s.SendMessage(ctx, buyerID, tr.ID, firstMessage); err != nil {
			return nil, err
		}
	}
	return s.GetThread(ctx, buyerID, tr.ID)
}

// ListThreads returns the caller's conversations, newest-activity-first.
func (s *Service) ListThreads(ctx context.Context, userID string, limit, offset int) ([]DealThread, error) {
	if userID == "" {
		return nil, ErrUnauthenticated
	}
	return s.repo.ListThreadsForUser(ctx, userID, limit, offset)
}

// GetThread returns one caller-relative thread, or ErrThreadNotFound when the caller is
// not a participant (participant-scoped: a non-participant cannot tell "missing" from
// "not yours").
func (s *Service) GetThread(ctx context.Context, userID, threadID string) (*DealThread, error) {
	if userID == "" {
		return nil, ErrUnauthenticated
	}
	d, ok, err := s.repo.GetThread(ctx, userID, threadID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrThreadNotFound
	}
	return d, nil
}

// ListMessages returns a thread's messages (participant-scoped) and marks the thread
// read for the caller.
func (s *Service) ListMessages(ctx context.Context, userID, threadID string, limit, offset int) ([]Message, error) {
	if userID == "" {
		return nil, ErrUnauthenticated
	}
	return s.repo.ListMessages(ctx, userID, threadID, limit, offset)
}

// SendMessage posts a free-text message into a thread (participant-scoped). It validates
// the body is non-empty and within the length bound before writing.
func (s *Service) SendMessage(ctx context.Context, userID, threadID, body string) (*Message, error) {
	if userID == "" {
		return nil, ErrUnauthenticated
	}
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		return nil, newErr(400, CodeMessageBodyRequired, "message body is required")
	}
	if len(trimmed) > maxMessageBodyLen {
		return nil, newErr(422, CodeMessageBodyTooLong, "message body is too long")
	}
	msg, err := s.repo.SendMessage(ctx, userID, threadID, trimmed)
	if err != nil {
		return nil, err
	}
	s.pushMessage(ctx, userID, threadID, msg)
	return msg, nil
}

// ─── Deal reviews (ADR-023: thread-keyed reviews behind the "mark met" signal) ──
// A "deal" == a thread. A participant marks the deal met (they transacted
// off-platform), after which EITHER participant may review the OTHER once. Reviews
// are metadata (NO money path), but participant-level authorization is MANDATORY —
// every method loads the thread participant-scoped first (ErrThreadNotFound for a
// non-participant) before touching a review.

// MarkDealMet flips the caller's thread to "met" (participant-scoped, idempotent).
// A non-participant gets ErrThreadNotFound.
func (s *Service) MarkDealMet(ctx context.Context, userID, threadID string) error {
	if userID == "" {
		return ErrUnauthenticated
	}
	_, err := s.repo.MarkDealMet(ctx, userID, threadID)
	return err
}

// GetDealReview returns the caller's OWN review for a deal (participant-scoped),
// or ok=false when the caller has not reviewed it. The thread is loaded first so a
// non-participant gets ErrThreadNotFound rather than an empty result.
func (s *Service) GetDealReview(ctx context.Context, userID, threadID string) (DealReview, bool, error) {
	if userID == "" {
		return DealReview{}, false, ErrUnauthenticated
	}
	if _, err := s.GetThread(ctx, userID, threadID); err != nil {
		return DealReview{}, false, err
	}
	return s.repo.GetDealReviewByReviewer(ctx, threadID, userID)
}

// SubmitDealReview records the caller's review of the counterparty for a deal.
// Guards, in order: participant scope (GetThread ⇒ ErrThreadNotFound), the deal is
// marked met (else 409 CodeDealNotMet), rating in 1..5 (else fieldErr). The
// reviewee is the caller-relative counterparty. A duplicate (already reviewed) is
// mapped to 409 by the repo (ErrReviewExists). Returns the created Review.
// productQualityRating is nil when the reviewer skipped the item-quality
// sub-score (validated 1..5 when present, same range as the overall rating).
func (s *Service) SubmitDealReview(ctx context.Context, userID, threadID string, rating int, productQualityRating *int, tags []string, comment string) (DealReview, error) {
	if userID == "" {
		return DealReview{}, ErrUnauthenticated
	}
	thread, err := s.GetThread(ctx, userID, threadID)
	if err != nil {
		return DealReview{}, err
	}
	if !thread.Met {
		return DealReview{}, newErr(409, CodeDealNotMet, "mark the deal as met before reviewing")
	}
	if rating < 1 || rating > 5 {
		return DealReview{}, fieldErr(CodeValidation, "rating must be between 1 and 5", "rating")
	}
	if productQualityRating != nil && (*productQualityRating < 1 || *productQualityRating > 5) {
		return DealReview{}, fieldErr(CodeValidation, "product_quality_rating must be between 1 and 5", "product_quality_rating")
	}
	return s.repo.InsertDealReview(ctx, threadID, userID, thread.CounterpartyID, rating, productQualityRating, strings.TrimSpace(comment), tags)
}

// pushMessage best-effort live-delivers a new message to both participants (the
// sender's other devices + the recipient). Never affects the request outcome — the
// message is already durably persisted; a missed push is caught by client polling.
func (s *Service) pushMessage(ctx context.Context, senderID, threadID string, msg *Message) {
	if s.realtime == nil {
		return
	}
	// Resolve the counterparty (relative to the sender) to address the recipient.
	t, ok, terr := s.repo.GetThread(ctx, senderID, threadID)
	if terr != nil || !ok {
		return
	}
	payload := map[string]any{"threadId": threadID, "message": msg}
	_ = s.realtime.PublishToUser(ctx, senderID, "mkt.message.created", payload)
	if t.CounterpartyID != "" {
		_ = s.realtime.PublishToUser(ctx, t.CounterpartyID, "mkt.message.created", payload)
	}
}

// messaging_handler.go exposes the member (auth-required) "connect" messaging endpoints
// (ADR-023 listings-and-connect). Every handler reads the caller via requireUser (the
// same helper the other member handlers use) and every service call is participant-
// scoped — a non-participant gets THREAD_NOT_FOUND, never another party's data.

// CreateThread POST /threads — body {listing_id, message?}. Opens (or returns) the 1:1
// conversation between the caller (buyer) and the listing's seller; sends the optional
// first message when present. Returns the caller-relative DealThread.
func (h *Handler) CreateThread(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body createThreadRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	t, err := h.svc.StartOrGetThread(c.Request.Context(), uid, body.listingID(), body.Message)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusCreated, t)
}

// ListThreads GET /threads — the caller's conversations, newest-activity-first.
func (h *Handler) ListThreads(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	limit, offset := pageParams(c)
	ts, err := h.svc.ListThreads(c.Request.Context(), uid, limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, ts)
}

// GetThread GET /threads/:id — one caller-relative thread (404 THREAD_NOT_FOUND if the
// caller is not a participant).
func (h *Handler) GetThread(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	t, err := h.svc.GetThread(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, t)
}

// ListThreadMessages GET /threads/:id/messages — a thread's messages (participant-
// scoped); marks the thread read for the caller.
func (h *Handler) ListThreadMessages(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	limit, offset := pageParams(c)
	ms, err := h.svc.ListMessages(c.Request.Context(), uid, c.Param("id"), limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, ms)
}

// SendThreadMessage POST /threads/:id/messages — body {body}. Posts a free-text message
// into the thread (participant-scoped).
func (h *Handler) SendThreadMessage(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body struct {
		Body string `json:"body"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	m, err := h.svc.SendMessage(c.Request.Context(), uid, c.Param("id"), body.Body)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusCreated, m)
}

// ─── Deal reviews (ADR-023: thread-keyed reviews behind the "mark met" signal) ──
// :id is the THREAD id (dealId == threadId). Every handler is participant-scoped
// in the service (a non-participant gets THREAD_NOT_FOUND, never another party's
// data) — reviews are metadata, no Idempotency-Key.

// MarkDealMet POST /deals/:id/mark-met — flip the thread's "met" signal
// (participant-scoped, idempotent). Returns the caller-relative thread so the
// client can re-render the review CTA immediately.
func (h *Handler) MarkDealMet(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	if err := h.svc.MarkDealMet(c.Request.Context(), uid, c.Param("id")); err != nil {
		fail(c, err)
		return
	}
	t, err := h.svc.GetThread(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, t)
}

// SubmitDealReview POST /deals/:id/review — body {rating, tags, text}. Records the
// caller's review of the counterparty (requires the deal be marked met first).
func (h *Handler) SubmitDealReview(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body struct {
		Rating               int      `json:"rating"`
		ProductQualityRating *int     `json:"product_quality_rating"`
		Tags                 []string `json:"tags"`
		Text                 string   `json:"text"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	rv, err := h.svc.SubmitDealReview(c.Request.Context(), uid, c.Param("id"), body.Rating, body.ProductQualityRating, body.Tags, body.Text)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusCreated, rv)
}

// GetDealReview GET /deals/:id/review — the caller's OWN review for this deal, or
// {"data":null} (200) when the caller has not reviewed it. Participant-scoped: a
// non-participant gets THREAD_NOT_FOUND. The mobile getReviewForDeal treats a null
// payload (and any error) as "no review yet".
func (h *Handler) GetDealReview(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	rv, found, err := h.svc.GetDealReview(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	if !found {
		respond(c, http.StatusOK, nil)
		return
	}
	respond(c, http.StatusOK, rv)
}

// Contact reveal budget. Any signed-in user may reveal a seller's phone, so this
// window is the whole defence against harvesting every number in the market.
// Counted per DISTINCT listing: looking at the same listing twice is one number,
// and charging for the second look would punish someone who backgrounded the app
// rather than someone scraping. Breadth is what the limit is aimed at.
const (
	contactRevealWindow  = time.Hour
	contactRevealPerHour = 10
)

// RevealSellerContact returns the seller's phone for a listing, subject to a
// per-viewer hourly budget, and records who was given the number.
// The listing screen previously had a reveal control that only flipped local
// state — no number was ever fetched. This is the endpoint behind it.
// Deliberately available to ANY signed-in viewer rather than only to someone with
// an open thread: requiring a conversation first would mean messaging a seller to
// get the number you needed in order to call instead of messaging, which is the
// wrong way round for the "call the seller" path this exists to serve.
func (s *Service) RevealSellerContact(ctx context.Context, viewerID, listingID string) (*SellerContact, error) {
	if viewerID == "" {
		return nil, ErrUnauthenticated
	}

	l, err := s.repo.GetListing(ctx, listingID)
	if err != nil {
		return nil, err
	}

	// Your own listing needs no reveal and must not spend budget.
	if l.SellerID == viewerID {
		c, cerr := s.repo.sellerPhoneForListing(ctx, listingID)
		if cerr != nil {
			return nil, cerr
		}
		if c.Phone == "" {
			return nil, newErr(http.StatusNotFound, CodeSellerHasNoPhone, "you have not added a phone number to your profile")
		}
		return &c, nil
	}

	since := time.Now().Add(-contactRevealWindow)

	// A listing already revealed in this window is free to look at again — the
	// viewer has seen the number, and re-charging for it protects nothing.
	seen, err := s.repo.hasRevealedListing(ctx, viewerID, listingID, since)
	if err != nil {
		return nil, err
	}
	if !seen {
		n, cerr := s.repo.countDistinctRevealsSince(ctx, viewerID, since)
		if cerr != nil {
			return nil, cerr
		}
		if n >= contactRevealPerHour {
			return nil, newErr(http.StatusTooManyRequests, CodeContactRevealLimit,
				"you have revealed too many seller numbers in the last hour; try again later")
		}
	}

	c, err := s.repo.sellerPhoneForListing(ctx, listingID)
	if err != nil {
		return nil, err
	}
	if c.Phone == "" {
		// No number to give, so nothing is recorded and no budget is spent —
		// otherwise a listing whose seller has no phone would silently drain the
		// viewer's quota.
		return nil, newErr(http.StatusNotFound, CodeSellerHasNoPhone, "this seller has not added a phone number")
	}

	// Recorded even on a repeat: the second look is a separate event, and the
	// seller is entitled to see it when reporting abuse.
	if err := s.repo.recordReveal(ctx, listingID, viewerID, c.SellerID); err != nil {
		return nil, err
	}
	return &c, nil
}

// Request wire shapes for the offers/threads negotiation endpoints.
// These are named types rather than anonymous structs inside the handlers so
// the decoding can be tested against the exact bytes the mobile client emits —
// which is the half that was never checked, and the reason every one of these
// endpoints was unreachable in production:
// The mobile client (mobile-app/reactnative/src/features/marketplace/api/
// client.ts) transforms in BOTH directions — deepSnake on every outbound body
// and query, deepCamel on every response. The handlers here were written with
// camelCase request tags, reasoning from the camelCase RESPONSE type. Responses
// survived that (deepCamel accepts either), but no camelCase REQUEST field could
// ever be populated, so offers bound an empty listing and a zero price.
// Canonical names are the contract's (contracts/openapi.yaml
// MktOfferCreateRequest: listing_id, offer_price_kobo). The camelCase aliases
// accept builds that predate this fix; they cost one field each and mean an
// older app degrades to working rather than to a silent zero.

// createOfferRequest is the POST /offers body.
type createOfferRequest struct {
	ListingID      string `json:"listing_id"`
	ListingIDAlias string `json:"listingId"`
	OfferPriceKobo int64  `json:"offer_price_kobo"`
	PriceKobo      int64  `json:"price_kobo"`
	PriceKoboAlias int64  `json:"priceKobo"`
	Message        string `json:"message"`
}

func (r createOfferRequest) listingID() string {
	return strutil.FirstNonBlank(r.ListingID, r.ListingIDAlias)
}

func (r createOfferRequest) priceKobo() int64 {
	return firstNonZero(r.OfferPriceKobo, r.PriceKobo, r.PriceKoboAlias)
}

// counterOfferRequest is the POST /offers/:id/counter body.
type counterOfferRequest struct {
	OfferPriceKobo int64 `json:"offer_price_kobo"`
	PriceKobo      int64 `json:"price_kobo"`
	PriceKoboAlias int64 `json:"priceKobo"`
}

func (r counterOfferRequest) priceKobo() int64 {
	return firstNonZero(r.OfferPriceKobo, r.PriceKobo, r.PriceKoboAlias)
}

// createThreadRequest is the POST /threads body.
type createThreadRequest struct {
	ListingID      string `json:"listing_id"`
	ListingIDAlias string `json:"listingId"`
	Message        string `json:"message"`
}

func (r createThreadRequest) listingID() string {
	return strutil.FirstNonBlank(r.ListingID, r.ListingIDAlias)
}

// listingIDQuery reads the listing_id query param for GET /offers. Every other
// query param in this module is snake_case (market_id, category_id, price_min,
// target_type…); this one was the lone camelCase outlier, so it matched nothing
// the client sent and 400'd every negotiation-history fetch. Extracted so the
// wire name is testable without a database.
func listingIDQuery(c *gin.Context) string {
	return strutil.FirstNonBlank(c.Query("listing_id"), c.Query("listingId"))
}

func firstNonZero(vals ...int64) int64 {
	for _, v := range vals {
		if v != 0 {
			return v
		}
	}
	return 0
}
