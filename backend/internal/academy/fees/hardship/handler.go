package feeshardship

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

const keyMessage = "message"

// Handler exposes the SF-9 hardship/freeze request surface over Gin.
//   - member: a guardian SUBMITS a hardship request (creates a `pending` review-queue item).
//     Submission never approves/denies and never freezes the invoice.
//   - admin (RBAC academy.fees.hardship.review): a HUMAN reviewer approves (→ freezes the
//     invoice overdue→frozen via the state machine) or denies (invoice unchanged) a request,
//     and lists a school's pending review queue.
//
// Router wiring into RegisterAcademy is owned by the QA/integration task — see
// RegisterFeesHardship for the exact groups + injection this package expects.
type Handler struct {
	svc *Service
}

// NewHandler builds the hardship handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid resolves the authenticated user (RequireAuthContext sets c.Set("user_id", …)).
// authUserID adapts middleware.GetAuthenticatedUser to ginutil.UserID’s
// fallback signature for contexts missing the "user_id" key.
func authUserID(c *gin.Context) string {
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := ginutil.UserID(c, authUserID)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return u, true
}

// fail maps sentinel errors to stable snake_case codes + HTTP statuses (mirrors the sibling
// fees packages).
func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", keyMessage: httperr.Msg(c, http.StatusNotFound, err)})
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", keyMessage: httperr.Msg(c, http.StatusUnauthorized, err)})
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden", keyMessage: httperr.Msg(c, http.StatusForbidden, err)})
	case errors.Is(err, ErrMissingInvoice):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_invoice", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrMissingReason):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_reason", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrAlreadyReviewed):
		c.JSON(http.StatusConflict, gin.H{"error": "already_reviewed", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrInvoiceNotFreezable):
		c.JSON(http.StatusConflict, gin.H{"error": "invoice_not_freezable", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", keyMessage: httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

// RegisterFeesHardship wires the hardship routes. member routes use the /hardship subpath on
// the passed member group; admin routes are grouped under /hardship/admin and RBAC-gated with
// academy.fees.hardship.review (SF-9 human review). Takes an already-assembled
// *Service built by the integration layer with the real ports; nil svc/groups skip.
//
//	member: POST /hardship                       submit a hardship/freeze request (→ pending)
//	        GET  /hardship/:id                    get a request
//	admin : POST /hardship/admin/:id/approve     HUMAN approve → freezes invoice (overdue→frozen)
//	        POST /hardship/admin/:id/deny         HUMAN deny → invoice unchanged
//	        GET  /hardship/admin?schoolId=…       school pending review queue
func RegisterFeesHardship(member, admin *gin.RouterGroup, svc *Service, rbac services.RBACService) *Handler {
	if svc == nil {
		return nil
	}
	h := NewHandler(svc)

	if member != nil {
		mg := member.Group("/hardship")
		mg.POST("", h.Submit)
		mg.GET("/:id", h.Get)
	}

	if admin != nil {
		ag := admin.Group("/hardship/admin")
		ag.Use(middleware.RequirePermission(rbac, "academy.fees.hardship.review"))
		ag.POST("/:id/approve", h.Approve)
		ag.POST("/:id/deny", h.Deny)
		ag.GET("", h.ListPending)
	}
	return h
}

func (h *Handler) Submit(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req SubmitRequestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.SubmitRequest(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) Get(c *gin.Context) {
	out, err := h.svc.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Approve(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req ReviewRequest
	_ = c.ShouldBindJSON(&req) // note is optional
	out, err := h.svc.Approve(c.Request.Context(), u, c.Param("id"), req.Note)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Deny(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req ReviewRequest
	_ = c.ShouldBindJSON(&req) // note is optional
	out, err := h.svc.Deny(c.Request.Context(), u, c.Param("id"), req.Note)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListPending(c *gin.Context) {
	out, err := h.svc.ListPending(c.Request.Context(), c.Query("schoolId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
