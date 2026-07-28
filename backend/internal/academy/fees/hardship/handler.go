package feeshardship

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

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
func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := uid(c)
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
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden", "message": err.Error()})
	case errors.Is(err, ErrMissingInvoice):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_invoice", "message": err.Error()})
	case errors.Is(err, ErrMissingReason):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_reason", "message": err.Error()})
	case errors.Is(err, ErrAlreadyReviewed):
		c.JSON(http.StatusConflict, gin.H{"error": "already_reviewed", "message": err.Error()})
	case errors.Is(err, ErrInvoiceNotFreezable):
		c.JSON(http.StatusConflict, gin.H{"error": "invoice_not_freezable", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterFeesHardship wires the hardship routes. member routes use the /hardship subpath on
// the passed member group; admin routes are grouped under /hardship/admin and RBAC-gated with
// academy.fees.hardship.review (SF-9 human review). nil pool / groups are skipped. The
// QA/integration task calls this from RegisterAcademy and injects the InvoiceFreezer (adapter
// over feesinvoice.Service) + ReviewerAuthorizer (over the RBAC service) — see NOTE below.
//
//	member: POST /hardship                       submit a hardship/freeze request (→ pending)
//	        GET  /hardship/:id                    get a request
//	admin : POST /hardship/admin/:id/approve     HUMAN approve → freezes invoice (overdue→frozen)
//	        POST /hardship/admin/:id/deny         HUMAN deny → invoice unchanged
//	        GET  /hardship/admin?schoolId=…       school pending review queue
//
// NOTE: to keep the register signature byte-for-byte identical to the other fees packages'
// Register* (pool + rbac only), this constructor builds a service with the DB store but WITHOUT
// the InvoiceFreezer/ReviewerAuthorizer ports. Approve/Deny are therefore fail-closed here
// (no authorizer ⇒ ErrForbidden). The integration task should re-wire the service via
// NewServiceWithDeps (or NewService) with the real invoice adapter + RBAC-backed authorizer
// and register the handler with that service — the RBAC middleware on the admin group is a
// second, defense-in-depth gate. This mirrors how feesscholarship takes an already-assembled
// Service; the fixed signature is preserved for the automated router-integration check.
func RegisterFeesHardship(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) *Handler {
	if pool == nil {
		return nil
	}
	// Ports left nil here (see NOTE): the integration task injects them via NewServiceWithDeps.
	h := NewHandler(NewService(pool, nil, nil))

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

// ── Member handler (guardian submission — SF-9: only ever creates `pending`) ──────

func (h *Handler) Submit(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req SubmitRequestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
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

// ── Admin handlers (RBAC academy.fees.hardship.review — HUMAN review, SF-9) ───────

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
