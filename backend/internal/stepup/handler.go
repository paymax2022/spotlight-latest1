package stepup

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/otp"
)

// Envelope field/message names — consts keep goconst from counting bare
// literals package-wide.
const (
	codeKey            = "code"
	errKey             = "error"
	successKey         = "success"
	msgUnauthenticated = "unauthenticated"
)

// Handler serves /api/auth/step-up/*. Every route sits behind
// middleware.RequireAuthContext; the identity is never taken from the body.
type Handler struct{ svc *Service }

// NewHandler wraps the service; a nil or unavailable service answers 503.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func callerFrom(c *gin.Context) (Caller, bool) {
	u, ok := middleware.GetAuthenticatedUser(c)
	token := strings.TrimSpace(c.GetString(middleware.AuthTokenContextKey))
	if !ok || u.ID == "" || token == "" {
		return Caller{}, false
	}
	return Caller{UserID: u.ID, Email: u.Email, Token: token, IPAddress: c.ClientIP(), UserAgent: c.Request.UserAgent()}, true
}

func unavailable(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{successKey: false, errKey: "step-up verification is not available", codeKey: middleware.CodeStepUpUnavailable})
}

// Challenge — POST /api/auth/step-up/challenge. Sends a code to the account email.
func (h *Handler) Challenge(c *gin.Context) {
	if h.svc == nil || !h.svc.Available() {
		unavailable(c)
		return
	}
	caller, ok := callerFrom(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{successKey: false, errKey: msgUnauthenticated})
		return
	}
	err := h.svc.Challenge(c.Request.Context(), caller)
	switch {
	case err == nil:
		c.JSON(http.StatusAccepted, gin.H{successKey: true, "channel": "email"})
	case errors.Is(err, ErrNoEmail):
		c.JSON(http.StatusBadRequest, gin.H{successKey: false, errKey: "no email on this account to send a code to", codeKey: "step_up_no_channel"})
	case errors.Is(err, otp.ErrRateLimited):
		c.JSON(http.StatusTooManyRequests, gin.H{successKey: false, errKey: "too many requests; wait before asking for another code", codeKey: "rate_limited"})
	default:
		log.Printf("[stepup] challenge failed: %v", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{successKey: false, errKey: "could not send a step-up code", codeKey: middleware.CodeStepUpUnavailable})
	}
}

type verifyBody struct {
	Code string `json:"code"`
}

// Verify — POST /api/auth/step-up/verify {code}. Issues the grant on success.
func (h *Handler) Verify(c *gin.Context) {
	if h.svc == nil || !h.svc.Available() {
		unavailable(c)
		return
	}
	caller, ok := callerFrom(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{successKey: false, errKey: msgUnauthenticated})
		return
	}
	var body verifyBody
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Code) == "" {
		c.JSON(http.StatusBadRequest, gin.H{successKey: false, errKey: "code is required", codeKey: "invalid_request"})
		return
	}
	exp, err := h.svc.Verify(c.Request.Context(), caller, body.Code)
	switch {
	case err == nil:
		c.JSON(http.StatusOK, gin.H{successKey: true, "step_up": gin.H{"active": true, "expires_at": exp, "ttl_seconds": int(h.svc.TTL().Seconds())}})
	case errors.Is(err, ErrNoEmail):
		c.JSON(http.StatusBadRequest, gin.H{successKey: false, errKey: "no email on this account", codeKey: "step_up_no_channel"})
	case errors.Is(err, otp.ErrInvalidCode):
		c.JSON(http.StatusBadRequest, gin.H{successKey: false, errKey: "invalid code", codeKey: "invalid_code"})
	case errors.Is(err, otp.ErrExpired):
		c.JSON(http.StatusBadRequest, gin.H{successKey: false, errKey: "code expired; request a new one", codeKey: "code_expired"})
	case errors.Is(err, otp.ErrTooManyAttempts), errors.Is(err, otp.ErrRateLimited):
		c.JSON(http.StatusTooManyRequests, gin.H{successKey: false, errKey: "too many attempts; request a new code", codeKey: "rate_limited"})
	default:
		log.Printf("[stepup] verify failed: %v", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{successKey: false, errKey: "step-up verification could not be completed", codeKey: middleware.CodeStepUpUnavailable})
	}
}

// Status — GET /api/auth/step-up/status. Whether this session holds a live grant.
func (h *Handler) Status(c *gin.Context) {
	if h.svc == nil || !h.svc.Available() {
		unavailable(c)
		return
	}
	caller, ok := callerFrom(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{successKey: false, errKey: msgUnauthenticated})
		return
	}
	st, err := h.svc.Status(c.Request.Context(), caller)
	if err != nil {
		log.Printf("[stepup] status failed: %v", err)
		unavailable(c)
		return
	}
	resp := gin.H{"active": st.Found && st.Active}
	if st.Found {
		resp["expires_at"] = st.ExpiresAt
	}
	c.JSON(http.StatusOK, gin.H{successKey: true, "step_up": resp})
}
