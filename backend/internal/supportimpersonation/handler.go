package supportimpersonation

import (
	"errors"
	"log"
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
)

// Envelope field/code names — consts keep goconst from counting bare
// literals package-wide.
const (
	codeKey            = "code"
	errKey             = "error"
	successKey         = "success"
	fieldSession       = "session"
	codeUnavailable    = "unavailable"
	msgUnauthenticated = "unauthenticated"
)

// Handler serves the support view-as surface and the user's notice.
type Handler struct {
	svc     *Service
	enabled bool
}

// NewHandler wraps the service. enabled is FEATURE_SUPPORT_IMPERSONATION_ENABLED;
// the agent routes answer 503 feature_disabled while it is off. The user's own
// notice (MyNotices) stays readable regardless, so history is never hidden.
func NewHandler(svc *Service, enabled bool) *Handler { return &Handler{svc: svc, enabled: enabled} }

func actorFrom(c *gin.Context) (Actor, bool) {
	u, ok := middleware.GetAuthenticatedUser(c)
	token := strings.TrimSpace(c.GetString(middleware.AuthTokenContextKey))
	if !ok || u.ID == "" || token == "" {
		return Actor{}, false
	}
	return Actor{UserID: u.ID, Token: token, IPAddress: c.ClientIP(), UserAgent: c.Request.UserAgent()}, true
}

func (h *Handler) gate(c *gin.Context) (Actor, bool) {
	if !h.enabled {
		c.JSON(http.StatusServiceUnavailable, gin.H{successKey: false, errKey: "support impersonation is disabled", codeKey: "feature_disabled"})
		return Actor{}, false
	}
	if h.svc == nil || !h.svc.ready() {
		c.JSON(http.StatusServiceUnavailable, gin.H{successKey: false, errKey: "support impersonation is not available", codeKey: codeUnavailable})
		return Actor{}, false
	}
	a, ok := actorFrom(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{successKey: false, errKey: msgUnauthenticated})
		return Actor{}, false
	}
	return a, true
}

// Start — POST /api/support/impersonation. Mounted behind
// RequireExplicitPermission(Permission) and an always-enforced RequireStepUp.
func (h *Handler) Start(c *gin.Context) {
	a, ok := h.gate(c)
	if !ok {
		return
	}
	var req StartRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{successKey: false, errKey: "invalid request", codeKey: "invalid_request"})
		return
	}
	sess, err := h.svc.Start(c.Request.Context(), a, req)
	if err != nil {
		writeErr(c, err)
		return
	}
	routes := middleware.SupportImpersonationReadRoutes()
	sort.Strings(routes)
	c.JSON(http.StatusCreated, gin.H{
		successKey:   true,
		fieldSession: sess,
		"usage": gin.H{
			"header":      middleware.SupportImpersonationHeader,
			"read_only":   true,
			"read_routes": routes,
		},
	})
}

// Stop — POST /api/support/impersonation/:id/stop. Only the agent who opened
// the session can stop it; no permission is needed so a de-provisioned agent
// can still close what they opened.
func (h *Handler) Stop(c *gin.Context) {
	a, ok := h.gate(c)
	if !ok {
		return
	}
	sess, err := h.svc.Stop(c.Request.Context(), a, c.Param("id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{successKey: true, fieldSession: sess})
}

// Active — GET /api/support/impersonation/active.
func (h *Handler) Active(c *gin.Context) {
	a, ok := h.gate(c)
	if !ok {
		return
	}
	sess, err := h.svc.Active(c.Request.Context(), a.UserID)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{successKey: true, fieldSession: sess})
}

// MyNotices — GET /api/auth/support-access. The impersonated user's notice:
// every support view-as of their account (who, why, ticket, when, until).
func (h *Handler) MyNotices(c *gin.Context) {
	if h.svc == nil || !h.svc.ready() {
		c.JSON(http.StatusServiceUnavailable, gin.H{successKey: false, errKey: "support access history is not available", codeKey: codeUnavailable})
		return
	}
	u, ok := middleware.GetAuthenticatedUser(c)
	if !ok || u.ID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{successKey: false, errKey: msgUnauthenticated})
		return
	}
	list, err := h.svc.NoticesFor(c.Request.Context(), u.ID)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{successKey: true, "support_access": list})
}

func writeErr(c *gin.Context, err error) {
	type m struct {
		status int
		code   string
	}
	table := []struct {
		err error
		m   m
	}{
		{ErrInvalidTarget, m{http.StatusBadRequest, "invalid_target"}},
		{ErrSelf, m{http.StatusBadRequest, "cannot_impersonate_self"}},
		{ErrReasonRequired, m{http.StatusBadRequest, "reason_required"}},
		{ErrTicketRequired, m{http.StatusBadRequest, "ticket_ref_required"}},
		{ErrDuration, m{http.StatusBadRequest, "invalid_duration"}},
		{ErrTargetNotFound, m{http.StatusNotFound, "target_not_found"}},
		{ErrTargetProtected, m{http.StatusForbidden, "target_protected"}},
		{ErrSessionNotFound, m{http.StatusNotFound, "session_not_found"}},
		{ErrServiceUnwired, m{http.StatusServiceUnavailable, codeUnavailable}},
		{ErrTargetRolesCheck, m{http.StatusServiceUnavailable, "target_check_unavailable"}},
	}
	for _, row := range table {
		if errors.Is(err, row.err) {
			c.JSON(row.m.status, gin.H{successKey: false, errKey: err.Error(), codeKey: row.m.code})
			return
		}
	}
	log.Printf("[impersonation] internal error: %v", err)
	c.JSON(http.StatusInternalServerError, gin.H{successKey: false, errKey: "internal error", codeKey: "internal"})
}
