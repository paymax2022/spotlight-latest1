// Package httperr replaces the per-module statusFor / httpErr / writeErr
// switch statements that map sentinel errors onto HTTP statuses. Each module
// declares its rules once at package level:
//
//	var errMap = httperr.New(http.StatusInternalServerError,
//		httperr.R(http.StatusBadRequest, ErrValidation, ErrIdempotencyKey),
//		httperr.R(http.StatusNotFound, ErrNotFound),
//		httperr.R(http.StatusConflict, ErrConflict),
//	)
//
// then handlers call `errMap.Write(c, err)` — or read `errMap.Code(err)` when
// they need to shape the body themselves.
package httperr

import (
	"errors"
	"log"
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"
)

const errKey = "error"

// Rule binds one HTTP status to a set of sentinel errors. A rule matches when
// errors.Is reports a match against any listed sentinel.
type Rule struct {
	Status int
	Errs   []error
}

// R builds a Rule: `httperr.R(http.StatusNotFound, ErrNotFound)`.
func R(status int, errs ...error) Rule {
	return Rule{Status: status, Errs: errs}
}

// Mapper maps errors to HTTP responses. Rules are evaluated in declaration
// order; the first match wins. Unmatched errors get the default status.
type Mapper struct {
	def   int
	rules []Rule
}

// New builds a Mapper. defaultStatus is almost always 500 — never leak
// unexpected internals as 4xx (AUD-REL-006 error-leak class of bugs).
func New(defaultStatus int, rules ...Rule) *Mapper {
	m := &Mapper{def: defaultStatus}
	m.rules = append(m.rules, rules...)
	return m
}

// Code resolves the HTTP status for err. A nil err maps to 200 so a Mapper
// can also drive `if code := m.Code(err); code >= 400 { ... }` guards.
func (m *Mapper) Code(err error) int {
	if err == nil {
		return http.StatusOK
	}
	for _, r := range m.rules {
		for _, e := range r.Errs {
			if errors.Is(err, e) {
				return r.Status
			}
		}
	}
	return m.def
}

// internalSignature matches error text that must never reach a client
// (security.md F4 / E2E-SEC-056): Postgres SQLSTATE errors, pgx/pq driver
// strings, encoding/json decode failures (which disclose Go struct field
// names), panic/runtime text, file:line references, and raw dial errors.
// Deliberately case-sensitive on "ERROR:" — the all-caps prefix is the
// Postgres signature; ordinary lowercase copy like "error: name required"
// stays verbatim.
var internalSignature = regexp.MustCompile(
	`SQLSTATE|ERROR:|pgconn|pgx|lib/pq|pq:|sql: |json: cannot unmarshal|panic:|runtime error:|\.go:\d+|dial tcp|connection refused`,
)

// genericMessage is the client-visible string substituted for a sanitized
// error. 4xx statuses get a matching generic; anything else (and all 5xx)
// collapses to "internal server error".
func genericMessage(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "invalid request"
	case http.StatusUnauthorized:
		return "unauthorized"
	case http.StatusForbidden:
		return "forbidden"
	case http.StatusNotFound:
		return "not found"
	case http.StatusConflict:
		return "conflict"
	case http.StatusTooManyRequests:
		return "too many requests"
	default:
		return "internal server error"
	}
}

// publicMessage returns err.Error() verbatim only when it is safe to disclose:
// the error mapped to a client (4xx) status — module-authored sentinel copy —
// AND carries no internal signature. Everything else is replaced by a generic
// string and the raw detail is logged server-side tagged with the request id,
// so operators keep the detail and clients keep the envelope.
func (m *Mapper) publicMessage(c *gin.Context, status int, err error) string {
	raw := err.Error()
	if status < 500 && !internalSignature.MatchString(raw) {
		return raw
	}
	reqID := c.Writer.Header().Get("X-Request-Id")
	method, path := "", ""
	if c.Request != nil && c.Request.URL != nil {
		method, path = c.Request.Method, c.Request.URL.Path
	}
	log.Printf("[httperr] sanitized %d response for %s %s (request_id=%s): %v",
		status, method, path, reqID, raw)
	return genericMessage(status)
}

// Write sends {"error": <message>} at the mapped status. Unlike the original
// verbatim passthrough, the message runs through publicMessage so wrapped
// Postgres/driver/runtime internals never reach the client. NOTE: handlers
// that read m.Code(err) and shape their own body bypass this sanitizer —
// they must route the message through the same discipline (or call Write).
func (m *Mapper) Write(c *gin.Context, err error) {
	status := m.Code(err)
	c.JSON(status, gin.H{errKey: m.publicMessage(c, status, err)})
}

// WriteOK sends {"success": false, "error": <message>} for modules whose
// envelopes carry a success flag. Same sanitization as Write.
func (m *Mapper) WriteOK(c *gin.Context, err error) {
	status := m.Code(err)
	c.JSON(status, gin.H{"success": false, "error": m.publicMessage(c, status, err)})
}
