package middleware

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/services"
)

// Support "view-as" (ESTD-D028 / EST-UAT-0422, ADR-PR<pr-number>).
//
// A support agent never receives a token for the user. The agent keeps their
// OWN bearer token and adds `X-Support-Impersonation: <session id>`, naming a
// backend-issued, time-boxed session (internal/supportimpersonation) that is
// bound to the agent's token. Two guards make it read-only by construction:
//
//  1. GuardSupportImpersonation runs engine-wide, before routing reaches any
//     group. A request carrying the header is refused unless it is a GET/HEAD
//     on an explicitly allow-listed read route. Every mutation — and every
//     route not on the list, money paths included — is refused here, before
//     authentication, a handler or a service ever runs.
//  2. ApplySupportImpersonation runs inside the (only) group that hosts the
//     allow-listed routes, AFTER RequireAuthContext has authenticated the
//     agent. It re-checks the allow-list, validates the session against the
//     agent and their token, writes the per-request audit row (fail closed: no
//     audit row, no response), and only then swaps the request identity to the
//     target user — with no roles, no permissions and no token.

// SupportImpersonationHeader names the session a request wants to view as.
const SupportImpersonationHeader = "X-Support-Impersonation"

// Machine-readable refusal codes for impersonated requests.
const (
	CodeImpersonationDisabled   = "impersonation_disabled"
	CodeImpersonationReadOnly   = "impersonation_read_only"
	CodeImpersonationNotAllowed = "impersonation_route_not_allowed"
	CodeImpersonationInvalid    = "impersonation_session_invalid"
	CodeImpersonationExpired    = "impersonation_session_expired"
	CodeImpersonationAuditFail  = "impersonation_audit_unavailable"
)

// Errors an ImpersonationSessions implementation returns from Resolve.
var (
	ErrImpersonationNotFound = errors.New("impersonation: session not found for this actor")
	ErrImpersonationExpired  = errors.New("impersonation: session expired or ended")
)

// supportImpersonationReadRoutes is the explicit allow-list of read endpoints
// that honour a view-as session: "<METHOD> <gin FullPath>". Scope is the
// resident estate account (EST-UAT-0422). Each handler was checked to be a pure
// read (no INSERT/UPDATE on the path — e.g. GET /:id/settings is excluded
// because it upserts a default row). Every entry MUST live under a group that
// mounts ApplySupportImpersonation (TestSupportImpersonationAllowListIsUnderFinance).
var supportImpersonationReadRoutes = map[string]bool{
	"GET /api/finance/estate/:id/dashboard":         true,
	"GET /api/finance/estate/:id/profile":           true,
	"GET /api/finance/estate/:id/dues/invoices":     true,
	"GET /api/finance/estate/:id/notifications":     true,
	"GET /api/finance/estate/:id/access-request/me": true,
	"GET /api/finance/estate/:id/bookings":          true,
	"GET /api/finance/estate/:id/access-codes":      true,
}

// SupportImpersonationReadRoutes returns a copy of the allow-list (for docs,
// tests and the start response).
func SupportImpersonationReadRoutes() []string {
	out := make([]string, 0, len(supportImpersonationReadRoutes))
	for k := range supportImpersonationReadRoutes {
		out = append(out, k)
	}
	return out
}

func impersonationRouteAllowed(method, fullPath string) bool {
	if fullPath == "" {
		return false
	}
	if method == http.MethodHead {
		method = http.MethodGet
	}
	return supportImpersonationReadRoutes[method+" "+fullPath]
}

// SupportImpersonation is a validated, live view-as session.
type SupportImpersonation struct {
	SessionID    string
	ActorUserID  string
	TargetUserID string
}

// ImpersonationRequestEvent is one audited request (or refusal).
type ImpersonationRequestEvent struct {
	Method    string
	Path      string
	Route     string
	Detail    string
	IPAddress string
	UserAgent string
}

// ImpersonationSessions is the store seam the guards use. Implemented by
// internal/supportimpersonation.PostgresStore.
type ImpersonationSessions interface {
	// Resolve returns the session iff it exists, belongs to actorUserID, is
	// bound to actorTokenHash, has not ended and has not expired.
	Resolve(ctx context.Context, sessionID, actorUserID, actorTokenHash string) (SupportImpersonation, error)
	// RecordRequest appends a 'request' event and returns its id.
	RecordRequest(ctx context.Context, s SupportImpersonation, ev ImpersonationRequestEvent) (int64, error)
	// FinishRequest stamps the response status onto a recorded request event.
	FinishRequest(ctx context.Context, eventID int64, status int) error
	// RecordRefusal appends a 'refused' (or 'expired') event for a session id
	// that exists; unknown ids are a silent no-op (nothing to attach it to).
	RecordRefusal(ctx context.Context, sessionID, event string, ev ImpersonationRequestEvent) error
}

// SupportImpersonationOptions configures both guards.
type SupportImpersonationOptions struct {
	// Enabled is FEATURE_SUPPORT_IMPERSONATION_ENABLED. When false any request
	// carrying the header is refused outright (never silently ignored — the
	// agent must not believe they are viewing as someone when they are not).
	Enabled bool
	// Sessions is resolved per request (routes mount before the pool exists).
	Sessions func() ImpersonationSessions
}

func (o SupportImpersonationOptions) sessions() ImpersonationSessions {
	if o.Sessions == nil {
		return nil
	}
	return o.Sessions()
}

func impersonationEvent(c *gin.Context, detail string) ImpersonationRequestEvent {
	return ImpersonationRequestEvent{
		Method:    c.Request.Method,
		Path:      c.Request.URL.Path,
		Route:     c.FullPath(),
		Detail:    detail,
		IPAddress: c.ClientIP(),
		UserAgent: c.Request.UserAgent(),
	}
}

func impersonationRefuse(c *gin.Context, status int, code, msg string) {
	c.AbortWithStatusJSON(status, gin.H{rlSuccessKey: false, rlErrKey: msg, secCodeKey: code})
}

// GuardSupportImpersonation is the engine-wide read-only gate. Mount it with
// r.Use BEFORE any route is registered. Requests without the header pass
// untouched.
func GuardSupportImpersonation(opts SupportImpersonationOptions) gin.HandlerFunc {
	return func(c *gin.Context) {
		sid := strings.TrimSpace(c.GetHeader(SupportImpersonationHeader))
		if sid == "" {
			c.Next()
			return
		}
		if !opts.Enabled {
			impersonationRefuse(c, http.StatusForbidden, CodeImpersonationDisabled, "support impersonation is disabled")
			return
		}
		method := c.Request.Method
		var code, msg, detail string
		switch {
		case method != http.MethodGet && method != http.MethodHead:
			code, msg, detail = CodeImpersonationReadOnly, "support impersonation is read-only; mutations are refused", "mutation_refused"
		case !impersonationRouteAllowed(method, c.FullPath()):
			code, msg, detail = CodeImpersonationNotAllowed, "this endpoint is not available while viewing as a user", "route_not_allowed"
		default:
			c.Next()
			return
		}
		// Audit the refused attempt against the named session (best effort: the
		// refusal itself never depends on the write succeeding).
		if s := opts.sessions(); s != nil {
			if err := s.RecordRefusal(c.Request.Context(), sid, "refused", impersonationEvent(c, detail)); err != nil {
				log.Printf("[impersonation] could not record refusal (session=%s): %v", sid, err)
			}
		}
		log.Printf("[impersonation] refused %s %s (session=%s, %s)", method, c.Request.URL.Path, sid, detail)
		impersonationRefuse(c, http.StatusForbidden, code, msg)
	}
}

// ApplySupportImpersonation validates the session and swaps the identity.
// Mount it on the group hosting the allow-listed routes, after
// RequireAuthContext. Requests without the header pass untouched.
func ApplySupportImpersonation(opts SupportImpersonationOptions) gin.HandlerFunc {
	return func(c *gin.Context) {
		sid := strings.TrimSpace(c.GetHeader(SupportImpersonationHeader))
		if sid == "" {
			c.Next()
			return
		}
		// Belt and braces: never trust that the engine guard is mounted.
		if !opts.Enabled {
			impersonationRefuse(c, http.StatusForbidden, CodeImpersonationDisabled, "support impersonation is disabled")
			return
		}
		if !impersonationRouteAllowed(c.Request.Method, c.FullPath()) {
			impersonationRefuse(c, http.StatusForbidden, CodeImpersonationReadOnly, "support impersonation is read-only; this endpoint is not available")
			return
		}
		store := opts.sessions()
		if store == nil {
			impersonationRefuse(c, http.StatusServiceUnavailable, CodeImpersonationAuditFail, "support impersonation is unavailable")
			return
		}
		actor, ok := GetAuthenticatedUser(c)
		token := strings.TrimSpace(c.GetString(AuthTokenContextKey))
		if !ok || actor.ID == "" || token == "" {
			impersonationRefuse(c, http.StatusUnauthorized, CodeImpersonationInvalid, secMsgUnauth)
			return
		}
		ctx := c.Request.Context()
		sess, err := store.Resolve(ctx, sid, actor.ID, services.HashToken(token))
		if err != nil {
			if errors.Is(err, ErrImpersonationExpired) {
				_ = store.RecordRefusal(ctx, sid, "expired", impersonationEvent(c, "session_expired"))
				impersonationRefuse(c, http.StatusForbidden, CodeImpersonationExpired, "support impersonation session has expired or ended")
				return
			}
			if !errors.Is(err, ErrImpersonationNotFound) {
				log.Printf("[impersonation] resolve failed (session=%s): %v", sid, err)
			}
			impersonationRefuse(c, http.StatusForbidden, CodeImpersonationInvalid, "support impersonation session is not valid for this caller")
			return
		}
		eventID, err := store.RecordRequest(ctx, sess, impersonationEvent(c, ""))
		if err != nil {
			// Fail closed: an un-audited view-as request must not be served.
			log.Printf("[impersonation] audit write failed (session=%s): %v", sid, err)
			impersonationRefuse(c, http.StatusServiceUnavailable, CodeImpersonationAuditFail, "support impersonation audit unavailable")
			return
		}

		// Identity swap: the target, with NO roles, NO permissions and NO token,
		// so nothing downstream can act with either party's privileges.
		c.Set(AuthUserContextKey, domain.AuthenticatedUser{ID: sess.TargetUserID, Status: "impersonated"})
		c.Set(AuthTokenContextKey, "")
		c.Set("user_id", sess.TargetUserID)
		c.Set("user_email", "")
		c.Header("X-Support-Impersonation-Active", sess.SessionID)

		c.Next()

		if err := store.FinishRequest(context.WithoutCancel(ctx), eventID, c.Writer.Status()); err != nil {
			log.Printf("[impersonation] could not stamp status on audit event %d: %v", eventID, err)
		}
	}
}
