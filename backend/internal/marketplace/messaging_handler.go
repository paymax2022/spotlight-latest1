package marketplace

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// messaging_handler.go exposes the member (auth-required) "connect" messaging endpoints
// (ADR-023 listings-and-connect). Every handler reads the caller via requireUser (the
// same helper the other member handlers use) and every service call is participant-
// scoped — a non-participant gets THREAD_NOT_FOUND, never another party's data.

// CreateThread POST /threads — body {listingId, message?}. Opens (or returns) the 1:1
// conversation between the caller (buyer) and the listing's seller; sends the optional
// first message when present. Returns the caller-relative DealThread.
func (h *Handler) CreateThread(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body struct {
		ListingID string `json:"listingId"`
		Message   string `json:"message"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	t, err := h.svc.StartOrGetThread(c.Request.Context(), uid, body.ListingID, body.Message)
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
		Rating int      `json:"rating"`
		Tags   []string `json:"tags"`
		Text   string   `json:"text"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	rv, err := h.svc.SubmitDealReview(c.Request.Context(), uid, c.Param("id"), body.Rating, body.Tags, body.Text)
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
