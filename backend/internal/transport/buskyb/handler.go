package buskyb

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// Handler exposes the operator-KYB surface over gin.
//
// NOT WIRED — when routes are registered they must sit behind the module
// feature flag, and the review endpoints (ListPendingReview / Review) MUST be
// mounted under the admin/reviewer RBAC middleware: the service enforces
// maker-checker (reviewer ≠ submitter) but "is a reviewer at all" is a route
// concern, not a service one.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// errCode maps domain errors onto HTTP statuses.
func errCode(err error) int {
	switch {
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrProviderNotFound), errors.Is(err, ErrForbidden),
		errors.Is(err, ErrMakerChecker):
		return http.StatusForbidden
	case errors.Is(err, ErrIllegalTransition), errors.Is(err, ErrInvalidState):
		return http.StatusConflict
	case errors.Is(err, ErrRegistryUnavailable):
		return http.StatusServiceUnavailable
	case errors.Is(err, ErrTermsRequired), errors.Is(err, ErrInvalidAction),
		errors.Is(err, ErrInvalidRequest):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func respondErr(c *gin.Context, err error) {
	code := errCode(err)
	c.JSON(code, gin.H{"error": httperr.Msg(c, code, err)})
}

// SubmitKyb → POST /bus/provider/kyb/submit (operator; resolves the caller's
// provider row internally — provider_id is never client input).
func (h *Handler) SubmitKyb(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req SubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	app, err := h.svc.SubmitApplication(c.Request.Context(), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"application": app})
}

// KybStatus → GET /bus/provider/kyb (operator). Returns
// {application|null, verifications, transitions}.
func (h *Handler) KybStatus(c *gin.Context) {
	userID := ginutil.UserID(c)
	out, err := h.svc.StatusForUser(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// ListPendingReview → GET /admin/bus/kyb/pending (platform reviewer — mount
// behind admin RBAC).
func (h *Handler) ListPendingReview(c *gin.Context) {
	apps, err := h.svc.ListPendingReview(c.Request.Context())
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"applications": apps})
}

// ReviewKyb → POST /admin/bus/kyb/:id/review (platform reviewer — mount behind
// admin RBAC). Body: {action, reason}.
func (h *Handler) ReviewKyb(c *gin.Context) {
	reviewerID := ginutil.UserID(c)
	var req struct {
		Action ReviewAction `json:"action" binding:"required"`
		Reason string       `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	app, err := h.svc.Review(c.Request.Context(), c.Param("id"), reviewerID, req.Action, req.Reason)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"application": app})
}
