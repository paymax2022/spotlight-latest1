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
	"net/http"

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

// MatchFunc binds a status to an arbitrary predicate — for errors that are
// classified by shape rather than sentinel identity (pgx.ErrNoRows, typed
// errors, wrapped validation errors, ...).
type MatchFunc struct {
	Status int
	Test   func(error) bool
}

// F builds a predicate rule: `httperr.F(404, func(e) bool { return e == sql.ErrNoRows })` —
// prefer R plus errors.Is when the errors are plain sentinels.
func F(status int, test func(error) bool) MatchFunc {
	return MatchFunc{Status: status, Test: test}
}

// Mapper maps errors to HTTP responses. Rules are evaluated in declaration
// order; the first match wins. Unmatched errors get the default status.
type Mapper struct {
	def   int
	rules []Rule
	funcs []MatchFunc
}

// New builds a Mapper. defaultStatus is almost always 500 — never leak
// unexpected internals as 4xx (AUD-REL-006 error-leak class of bugs).
func New(defaultStatus int, rules ...Rule) *Mapper {
	m := &Mapper{def: defaultStatus}
	m.rules = append(m.rules, rules...)
	return m
}

// NewF is New plus predicate rules evaluated after the sentinel rules.
func NewF(defaultStatus int, rules []Rule, funcs ...MatchFunc) *Mapper {
	m := New(defaultStatus, rules...)
	m.funcs = append(m.funcs, funcs...)
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
	for _, f := range m.funcs {
		if f.Test != nil && f.Test(err) {
			return f.Status
		}
	}
	return m.def
}

// Write sends {"error": err.Error()} at the mapped status.
func (m *Mapper) Write(c *gin.Context, err error) {
	c.JSON(m.Code(err), gin.H{errKey: err.Error()})
}

// WriteOK sends {"success": false, "error": err.Error()} for modules whose
// envelopes carry a success flag.
func (m *Mapper) WriteOK(c *gin.Context, err error) {
	c.JSON(m.Code(err), gin.H{"success": false, "error": err.Error()})
}

// Coder is any error that exposes a machine-readable code — for the
// BUILD-CONTRACT error-code conventions used by modules like transport.
type Coder interface {
	Code() string
}

// WriteCode resolves the status via the mapper and writes {"error": code}
// when err implements Coder, else the plain message.
func (m *Mapper) WriteCode(c *gin.Context, err error) {
	var ce Coder
	if errors.As(err, &ce) {
		c.JSON(m.Code(err), gin.H{errKey: ce.Code()})
		return
	}
	m.Write(c, err)
}

// Simple is the drop-in for modules that only ever mapped a handful of
// sentinels inline: `httperr.Simple(400, ErrValidation, ErrBadInput)` returns
// a func usable directly as `func(err) int` inside a switch default.
func Simple(status int, errs ...error) func(error) int {
	return func(err error) int {
		for _, e := range errs {
			if errors.Is(err, e) {
				return status
			}
		}
		return 0
	}
}

// FieldError is one entry in a validation-failure envelope.
type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// WriteFields sends a structured validation envelope:
// {"error": msg, "fields": [{"field": ..., "message": ...}]}. Modules that
// surface per-field validation (registration, KYC forms) hand the collected
// failures here instead of hand-building the map.
func WriteFields(c *gin.Context, status int, msg string, fields []FieldError) {
	c.JSON(status, gin.H{errKey: msg, "fields": fields})
}

// Problem writes an RFC 7807-style problem body — for new endpoints that
// want a documented error contract rather than the ad-hoc {"error"} shape.
// typeURI should be a stable slug, e.g. "urn:spotlight:problem:wallet-frozen".
func Problem(c *gin.Context, status int, typeURI, title, detail string) {
	c.JSON(status, gin.H{
		"type":   typeURI,
		"title":  title,
		"status": status,
		"detail": detail,
	})
}
