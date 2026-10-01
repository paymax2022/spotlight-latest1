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

// Write sends {"error": err.Error()} at the mapped status.
func (m *Mapper) Write(c *gin.Context, err error) {
	c.JSON(m.Code(err), gin.H{errKey: err.Error()})
}

// WriteOK sends {"success": false, "error": err.Error()} for modules whose
// envelopes carry a success flag.
func (m *Mapper) WriteOK(c *gin.Context, err error) {
	c.JSON(m.Code(err), gin.H{"success": false, "error": err.Error()})
}
