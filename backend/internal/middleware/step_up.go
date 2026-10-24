package middleware

import (
	"context"
	"log"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/services"
)

// Step-up gate for privileged actions (ESTD-D014 / EST-UAT-0385, ADR-PR<pr-number>).
//
// estate_member_settings.two_factor_enabled was a stored preference nothing
// enforced. RequireStepUp is the enforcement: a high-risk route mounted behind
// it refuses the request unless the caller completed a fresh second-factor
// challenge (POST /api/auth/step-up/verify) in THIS session a few minutes ago.
// The grant is bound to the user AND the sha256 of the exact bearer token it was
// completed with (services.HashToken), so a token minted by a different login —
// or a stolen refresh that rotates the access token — does not inherit it.
//
// Every failure is closed: no identity, no verifier, a lookup error, no grant
// and an expired grant all refuse. Each refusal carries a machine-readable
// `code` so clients can drive the challenge UI without string matching.

// Machine-readable refusal codes (the `code` field of the 403/503 body).
const (
	CodeStepUpRequired    = "step_up_required"
	CodeStepUpExpired     = "step_up_expired"
	CodeStepUpUnavailable = "step_up_unavailable"
)

// Envelope field/message names shared with support_impersonation.go — consts
// keep goconst from counting bare literals package-wide (rlErrKey precedent).
const (
	secCodeKey      = "code"
	secMsgForbidden = "forbidden"
	secMsgUnauth    = "unauthenticated"
)

// StepUpGrantState is what a verifier knows about the newest grant for a
// (user, token-hash) pair. Found=false means no grant was ever issued for it.
type StepUpGrantState struct {
	Found     bool
	Active    bool
	ExpiresAt time.Time
}

// StepUpVerifier looks up the newest step-up grant bound to (userID, tokenHash).
// Implemented by internal/stepup.PostgresStore; declared here so the middleware
// does not import the store.
type StepUpVerifier interface {
	GrantState(ctx context.Context, userID, accessTokenHash string) (StepUpGrantState, error)
}

// StepUpOptions configures RequireStepUp.
type StepUpOptions struct {
	// Enforce is the rollout switch (FEATURE_STEP_UP_ENFORCED). When false the
	// gate is a pass-through and behaviour is exactly as before this change.
	Enforce bool
	// Verifier is resolved per request because routes mount before the shared
	// pool and OTP service exist (router.go ordering). A nil verifier while
	// enforcing means step-up cannot be satisfied → 503 step_up_unavailable.
	Verifier func() StepUpVerifier
	// Action names the protected action in logs and the refusal body.
	Action string
}

// RequireStepUp returns the gate. Mount it AFTER the authentication and
// permission middleware of the route so an unauthorised caller is refused for
// that reason first.
func RequireStepUp(opts StepUpOptions) gin.HandlerFunc {
	action := strings.TrimSpace(opts.Action)
	return func(c *gin.Context) {
		if !opts.Enforce {
			c.Next()
			return
		}
		userID, token, ok := stepUpIdentity(c)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{rlSuccessKey: false, rlErrKey: secMsgUnauth, secCodeKey: CodeStepUpRequired})
			return
		}
		var v StepUpVerifier
		if opts.Verifier != nil {
			v = opts.Verifier()
		}
		if v == nil {
			stepUpRefuse(c, http.StatusServiceUnavailable, CodeStepUpUnavailable, action,
				"step-up verification is required for this action but is not available on this deployment")
			return
		}
		st, err := v.GrantState(c.Request.Context(), userID, services.HashToken(token))
		if err != nil {
			log.Printf("[stepup] grant lookup failed (action=%s): %v", action, err)
			stepUpRefuse(c, http.StatusServiceUnavailable, CodeStepUpUnavailable, action, "step-up verification could not be checked")
			return
		}
		switch {
		case st.Found && st.Active:
			c.Next()
		case st.Found:
			stepUpRefuse(c, http.StatusForbidden, CodeStepUpExpired, action, "step-up verification expired; verify again")
		default:
			stepUpRefuse(c, http.StatusForbidden, CodeStepUpRequired, action, "step-up verification required")
		}
	}
}

func stepUpRefuse(c *gin.Context, status int, code, action, msg string) {
	c.AbortWithStatusJSON(status, gin.H{
		rlSuccessKey: false,
		rlErrKey:     msg,
		secCodeKey:   code,
		"action":     action,
		"step_up": gin.H{
			"challenge": "/api/auth/step-up/challenge",
			"verify":    "/api/auth/step-up/verify",
		},
	})
}

// stepUpIdentity returns the verified caller and the bearer token the request
// was authenticated with. RequireAuthContext sets authUser/authToken;
// RequireAdminConsoleRole / RequireVerifiedIdentity set only adminUserID (the
// token is then the same Authorization header they just verified). Anything
// else — no upstream verification at all — is refused.
func stepUpIdentity(c *gin.Context) (string, string, bool) {
	userID := ""
	if au, ok := GetAuthenticatedUser(c); ok {
		userID = strings.TrimSpace(au.ID)
	}
	if userID == "" {
		userID = strings.TrimSpace(c.GetString("adminUserID"))
	}
	if userID == "" {
		return "", "", false
	}
	token := strings.TrimSpace(c.GetString(AuthTokenContextKey))
	if token == "" {
		h := strings.TrimSpace(c.GetHeader("Authorization"))
		if strings.HasPrefix(strings.ToLower(h), "bearer ") {
			token = strings.TrimSpace(h[7:])
		}
	}
	if token == "" {
		return "", "", false
	}
	return userID, token, true
}

// RequireExplicitPermission refuses unless the permission is in the caller's
// EFFECTIVE permission set as resolved by RequireAuthContext
// (effective_permissions RPC). Unlike RequirePermission it deliberately does
// NOT honour the super-admin bypass nor fall back to user_has_permission():
// it is for capabilities that must be granted on purpose, never inherited from
// a broad admin role (support impersonation, ESTD-D028). A failed permissions
// fetch upstream leaves Permissions nil and is therefore a refusal.
func RequireExplicitPermission(permission string) gin.HandlerFunc {
	return func(c *gin.Context) {
		u, ok := GetAuthenticatedUser(c)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{rlSuccessKey: false, rlErrKey: secMsgUnauth})
			return
		}
		if !slices.Contains(u.Permissions, permission) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{rlSuccessKey: false, rlErrKey: secMsgForbidden, secCodeKey: "permission_required", "permission": permission})
			return
		}
		c.Next()
	}
}
