// Package ginutil provides the request-scoped helpers that were previously
// copy-pasted into nearly every internal module: reading the authenticated
// user id out of the gin context, enforcing the Idempotency-Key header on
// money paths, and parsing the shared ?limit/?offset pagination pair.
//
// Everything here is pure context extraction — no business logic, no internal
// package dependencies — so it stays safe to import from any module.
package ginutil

import (
	"maps"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	// errKey and successKey are the JSON envelope field names every module
	// envelope shares — constants keep goconst quiet and the shape uniform.
	errKey     = "error"
	successKey = "success"
)

// UserID returns the authenticated user's id stored on the context by auth
// middleware ("user_id" key). Optional fallbacks are consulted in order when
// the context key is empty — pass any provider such as a wrapper around
// middleware.GetAuthenticatedUser without coupling this package to it.
func UserID(c *gin.Context, fallbacks ...func(*gin.Context) string) string {
	if v := strings.TrimSpace(c.GetString("user_id")); v != "" {
		return v
	}
	for _, fb := range fallbacks {
		if fb == nil {
			continue
		}
		if v := strings.TrimSpace(fb(c)); v != "" {
			return v
		}
	}
	return ""
}

// RequireUser is UserID plus the standard 401 response, shaped for the
// `u, ok := ginutil.RequireUser(c); if !ok { return }` handler idiom.
func RequireUser(c *gin.Context) (string, bool) {
	u := strings.TrimSpace(c.GetString("user_id"))
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{errKey: "unauthenticated"})
		return "", false
	}
	return u, true
}

// IdempotencyKey reads the Idempotency-Key header, falling back to the legacy
// X-Idempotency-Key spelling. The value is trimmed; empty means "not supplied".
// Every money mutation must require it — see RequireIdempotencyKey.
func IdempotencyKey(c *gin.Context) string {
	if k := strings.TrimSpace(c.GetHeader("Idempotency-Key")); k != "" {
		return k
	}
	return strings.TrimSpace(c.GetHeader("X-Idempotency-Key"))
}

// RequireIdempotencyKey returns the key or writes the standard 400 body and
// false. Money-path handlers use it as `k, ok := RequireIdempotencyKey(c)`.
func RequireIdempotencyKey(c *gin.Context) (string, bool) {
	k := IdempotencyKey(c)
	if k == "" {
		c.JSON(http.StatusBadRequest, gin.H{errKey: "Idempotency-Key required"})
		return "", false
	}
	return k, true
}

// RequireIdempotencyKeyOK is RequireIdempotencyKey with the {"success": false}
// envelope used by modules that expose a success flag (savings, crypto, ...).
func RequireIdempotencyKeyOK(c *gin.Context) (string, bool) {
	k := IdempotencyKey(c)
	if k == "" {
		c.JSON(http.StatusBadRequest, gin.H{successKey: false, errKey: "Idempotency-Key required"})
		return "", false
	}
	return k, true
}

// PageParams parses the shared ?limit/?offset pair. limit defaults to
// defLimit and is capped at maxLimit (0 or negative maxLimit means uncapped);
// offset defaults to 0. Invalid or negative input falls back to the defaults,
// matching the most common copy-pasted variant.
func PageParams(c *gin.Context, defLimit, maxLimit int) (int, int) {
	limit, offset := defLimit, 0
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 {
		if maxLimit <= 0 || v <= maxLimit {
			limit = v
		}
	}
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v >= 0 {
		offset = v
	}
	return limit, offset
}

// LimitOffset is the zero-default variant for services that apply their own
// limits downstream: both values clamp to >= 0 and 0 means "unset".
func LimitOffset(c *gin.Context) (int, int) {
	limit, offset := 0, 0
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 {
		limit = v
	}
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v > 0 {
		offset = v
	}
	return limit, offset
}

// BoolParam reads an optional tri-state boolean query param: absent or
// unparseable yields nil so "unset" stays distinguishable from "false".
func BoolParam(c *gin.Context, name string) *bool {
	raw := strings.TrimSpace(c.Query(name))
	if raw == "" {
		return nil
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		return nil
	}
	return &v
}

// IntParam reads an optional integer query param; nil when absent or invalid.
func IntParam(c *gin.Context, name string) *int {
	raw := strings.TrimSpace(c.Query(name))
	if raw == "" {
		return nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return nil
	}
	return &v
}

// Query returns a trimmed query parameter; empty string when absent.
func Query(c *gin.Context, name string) string {
	return strings.TrimSpace(c.Query(name))
}

// QueryOr returns a trimmed query parameter or def when absent/blank.
func QueryOr(c *gin.Context, name, def string) string {
	if v := Query(c, name); v != "" {
		return v
	}
	return def
}

// PathID returns a trimmed :name path parameter.
func PathID(c *gin.Context, name string) string {
	return strings.TrimSpace(c.Param(name))
}

// Header returns a trimmed request header value.
func Header(c *gin.Context, name string) string {
	return strings.TrimSpace(c.GetHeader(name))
}

// BearerToken extracts the token from "Authorization: Bearer <t>".
func BearerToken(c *gin.Context) string {
	const prefix = "Bearer "
	h := strings.TrimSpace(c.GetHeader("Authorization"))
	if len(h) <= len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(h[len(prefix):])
}

// Fail writes the {"error": msg} envelope — the most common error shape.
func Fail(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{errKey: msg})
}

// FailErr is Fail with err.Error() as the message.
func FailErr(c *gin.Context, status int, err error) {
	c.JSON(status, gin.H{errKey: err.Error()})
}

// FailOK writes the {"success": false, "error": msg} envelope used by modules
// whose success responses carry a success flag.
func FailOK(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{successKey: false, errKey: msg})
}

// OK writes the {"success": true, ...} envelope. Extra fields are merged in.
func OK(c *gin.Context, status int, fields gin.H) {
	body := gin.H{successKey: true}
	maps.Copy(body, fields)
	c.JSON(status, body)
}

// SortDir reads ?sort=|?dir= as "ASC" or "DESC" — the recurring pattern of
// normalizing user sort input to a safe SQL direction token (never inject
// the raw param into SQL).
func SortDir(c *gin.Context) string {
	v := strings.ToLower(strings.TrimSpace(FirstOf(c.Query("dir"), c.Query("sort"))))
	if v == "asc" || v == "ascending" {
		return "ASC"
	}
	return "DESC"
}

// FirstOf returns the first non-empty string — local copy kept tiny so this
// package has no cross-package dependency for a one-liner.
func FirstOf(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// Search reads the ?q=|?search= full-text param, trimmed.
func Search(c *gin.Context) string {
	return strings.TrimSpace(FirstOf(c.Query("q"), c.Query("search")))
}

// AdminID reads the admin identity key set by admin-auth middleware —
// distinct from "user_id" so member/admin contexts never alias.
func AdminID(c *gin.Context) string {
	if v := strings.TrimSpace(c.GetString("admin_id")); v != "" {
		return v
	}
	return strings.TrimSpace(c.GetString("user_id"))
}

// ClientIP returns the best client IP the context reports (honours gin's
// trusted-proxy handling rather than reading X-Forwarded-For raw).
func ClientIP(c *gin.Context) string {
	return c.ClientIP()
}
