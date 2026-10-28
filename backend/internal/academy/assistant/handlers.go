package assistant

// handlers.go — the HTTP surface.
//
// Two envelope shapes, because two different clients read them: the learner
// surface returns the bare payload (the mobile API wrapper unwraps
// `res.data?.data ?? res.data`, and every other in-app AI route already returns
// bare), while the admin/staff surface returns `{"data": ...}` to match the
// Academy console. Errors are always `{"error": "..."}`.
//
// The handlers do four things and nothing else: pull the authenticated subject
// out of the gin context, bind and shape the request, call the service, and map
// the domain error onto a status. All behaviour lives in the service.

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	keyError          = "error"
	keyUnauth         = "unauthenticated"
	defaultListLimit  = 50
	defaultHistoryLen = 100
)

// errMap is the whole error policy for this module. The mapping is one-to-one so
// a client can branch on the status: 404 for "not yours or not there", 409 for a
// ticket that moved, 429 for the budget, 400 for input the academy can name.
var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusNotFound, ErrNotFound),
	httperr.R(http.StatusBadRequest, ErrBadInput, ErrEmptyQuestion, ErrQuestionLong),
	httperr.R(http.StatusTooManyRequests, ErrRateLimited),
	httperr.R(http.StatusConflict, ErrConflict, ErrClosedTicket, ErrBadTransition),
	httperr.R(http.StatusUnprocessableEntity, ErrNotPublishable),
)

// writeErr emits the mapped status. An unmapped error is a 500 with a generic
// body and the detail logged: a student must never see a SQLSTATE, and a support
// agent should not see one either.
func writeErr(c *gin.Context, err error) {
	code := errMap.Code(err)
	if code >= http.StatusInternalServerError {
		log.Printf("academy assistant: %v (path=%s)", err, c.FullPath())
		c.JSON(code, gin.H{keyError: "something went wrong"})
		return
	}
	c.JSON(code, gin.H{keyError: httperr.Msg(c, code, err)})
}

// actor resolves the caller's subject. RequireAuthContext has already validated
// the JWT and mirrored `user_id` onto the context; a value that is not a uuid is
// treated as unauthenticated rather than parsed optimistically.
func actor(c *gin.Context) (uuid.UUID, bool) {
	raw := ginutil.UserID(c)
	if raw == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauth})
		return uuid.Nil, false
	}
	id, err := ParseUserID(raw)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauth})
		return uuid.Nil, false
	}
	return id, true
}

// pathUUID reads a required uuid route parameter.
func pathUUID(c *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: name + " must be a uuid"})
		return uuid.Nil, false
	}
	return id, true
}

func queryInt(c *gin.Context, name string, def int) int {
	if v := c.Query(name); v != "" {
		if n := strconvAtoi(v); n > 0 {
			return n
		}
	}
	return def
}

// Handler serves the Academy Assistant.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// --- learner surface ---------------------------------------------------------

// Chat — POST /chat { message, conversation_id? } → ChatResponse
func (h *Handler) Chat(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeErr(c, ErrBadInput)
		return
	}
	res, err := h.svc.Chat(c.Request.Context(), uid, req)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// Handoff — POST /handoff { conversation_id, reason? } → HandoffResponse
func (h *Handler) Handoff(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	var req HandoffRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeErr(c, ErrBadInput)
		return
	}
	if req.ConversationID == uuid.Nil {
		writeErr(c, ErrBadInput)
		return
	}
	res, err := h.svc.Handoff(c.Request.Context(), uid, req)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// Feedback — POST /conversations/:id/feedback { message_id, note? } → HandoffResponse
func (h *Handler) Feedback(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	convoID, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	var req FeedbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeErr(c, ErrBadInput)
		return
	}
	if req.MessageID == uuid.Nil {
		writeErr(c, ErrBadInput)
		return
	}
	res, err := h.svc.Flag(c.Request.Context(), uid, convoID, req)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// Conversations — GET /conversations?limit= → [ Conversation ]
func (h *Handler) Conversations(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	items, err := h.svc.Conversations(c.Request.Context(), uid, queryInt(c, "limit", 20))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, items)
}

// Messages — GET /conversations/:id/messages?limit= → [ Message ]
func (h *Handler) Messages(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	convoID, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	items, err := h.svc.History(c.Request.Context(), uid, convoID, queryInt(c, "limit", defaultHistoryLen))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, items)
}

// Suggestions — GET /suggestions?limit= → [ string ]
func (h *Handler) Suggestions(c *gin.Context) {
	if _, ok := actor(c); !ok {
		return
	}
	items, err := h.svc.Suggestions(c.Request.Context(), queryInt(c, "limit", 5))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, items)
}

// --- knowledge base (academy.faq.manage) -------------------------------------

// ListFaqs — GET /?q=&category=&published=&limit=&offset= → { data, total }
func (h *Handler) ListFaqs(c *gin.Context) {
	if _, ok := actor(c); !ok {
		return
	}
	q := FaqListQuery{
		Q:        c.Query("q"),
		Category: c.Query("category"),
		Limit:    queryInt(c, "limit", defaultListLimit),
		Offset:   queryIntOffset(c, "offset"),
	}
	if raw := c.Query("published"); raw != "" {
		if v, ok := parseBool(raw); ok {
			q.Published = &v
		}
	}
	items, total, err := h.svc.ListFaqs(c.Request.Context(), q)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items, "total": total})
}

// GetFaq — GET /:id → { data }
func (h *Handler) GetFaq(c *gin.Context) {
	if _, ok := actor(c); !ok {
		return
	}
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	faq, err := h.svc.Faq(c.Request.Context(), id)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": faq})
}

// CreateFaq — POST / → { data }. A new entry starts unpublished unless the admin
// explicitly publishes it, and publishing an unapproved answer is a 422.
func (h *Handler) CreateFaq(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	var in FaqInput
	if err := c.ShouldBindJSON(&in); err != nil {
		writeErr(c, ErrBadInput)
		return
	}
	faq, err := h.svc.CreateFaq(c.Request.Context(), uid, in)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": faq})
}

// UpdateFaq — PUT /:id → { data }
func (h *Handler) UpdateFaq(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	var in FaqInput
	if err := c.ShouldBindJSON(&in); err != nil {
		writeErr(c, ErrBadInput)
		return
	}
	faq, err := h.svc.UpdateFaq(c.Request.Context(), id, uid, in)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": faq})
}

// DeleteFaq — DELETE /:id → { data }. Soft delete: the entry stops answering
// immediately and stays on the row for audit.
func (h *Handler) DeleteFaq(c *gin.Context) {
	if _, ok := actor(c); !ok {
		return
	}
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	faq, err := h.svc.DeleteFaq(c.Request.Context(), id)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": faq})
}

// FaqCategories — GET /categories → { data: [ string ] }
func (h *Handler) FaqCategories(c *gin.Context) {
	if _, ok := actor(c); !ok {
		return
	}
	items, err := h.svc.FaqCategories(c.Request.Context())
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// --- support queue (academy.support.view / .manage) --------------------------

// ListTickets — GET /?status=&category=&q=&unanswered=&limit=&offset=
//
// Returns the queue and the badge counts together, so the console header cannot
// disagree with the list beside it.
func (h *Handler) ListTickets(c *gin.Context) {
	if _, ok := actor(c); !ok {
		return
	}
	q := TicketListQuery{
		Status:   c.Query("status"),
		Category: c.Query("category"),
		Q:        c.Query("q"),
		Limit:    queryInt(c, "limit", defaultListLimit),
		Offset:   queryIntOffset(c, "offset"),
	}
	if raw := c.Query("unanswered"); raw != "" {
		if v, ok := parseBool(raw); ok {
			q.Unanswered = &v
		}
	}
	items, sum, err := h.svc.Queue(c.Request.Context(), q)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items, "summary": sum})
}

// GetTicket — GET /:id → { data, messages }
func (h *Handler) GetTicket(c *gin.Context) {
	if _, ok := actor(c); !ok {
		return
	}
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	ticket, msgs, err := h.svc.TicketDetail(c.Request.Context(), id)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ticket, "messages": msgs})
}

// Reply — POST /:id/reply { body } → { data }. The student sees this in their
// chat as an Academy Staff message.
func (h *Handler) Reply(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	var req StaffReplyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeErr(c, ErrBadInput)
		return
	}
	ticket, err := h.svc.Reply(c.Request.Context(), uid, id, req.Body)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ticket})
}

// SetStatus — POST /:id/status { status, resolution_notes? } → { data }
func (h *Handler) SetStatus(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	var req StatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeErr(c, ErrBadInput)
		return
	}
	ticket, err := h.svc.MoveStatus(c.Request.Context(), uid, id, req)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ticket})
}

// --- query helpers -----------------------------------------------------------

func queryIntOffset(c *gin.Context, name string) int {
	if v := c.Query(name); v != "" {
		if n := strconvAtoi(v); n > 0 {
			return n
		}
	}
	return 0
}

func strconvAtoi(s string) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0
	}
	return n
}

// parseBool accepts the forms a query string actually carries. An unrecognised
// value returns ok=false so the filter is simply not applied rather than being
// silently read as false.
func parseBool(s string) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes":
		return true, true
	case "0", "false", "no":
		return false, true
	}
	return false, false
}
