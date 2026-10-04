// Package dbutil holds the Postgres-facing helpers that were copy-pasted
// across internal modules: empty-to-NULL converters for optional columns and
// SQLSTATE classification for the pgx error chain.
//
// The Null* family exists because optional text/uuid/timestamp columns must
// store SQL NULL — never the zero value — so inserts do not fail uuid parsing
// or leak empty strings into NOT NULL-adjacent fields.
package dbutil

import (
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// sqlStater is implemented by pgconn.PgError and driver adapters that expose
// the Postgres SQLSTATE code.
type sqlStater interface {
	SQLState() string
}

// SQLState extracts the SQLSTATE code from anywhere in the error chain —
// covering pgconn.PgError (pgx), pq-style drivers, and wrapped errors.
// Returns "" when the chain carries no state.
func SQLState(err error) string {
	var ss sqlStater
	if errors.As(err, &ss) {
		return ss.SQLState()
	}
	if pgErr, ok := errors.AsType[*pgconn.PgError](err); ok {
		return pgErr.Code
	}
	return ""
}

// IsUniqueViolation reports SQLSTATE 23505 — unique_violation. Use it to make
// "insert that may already exist" paths idempotent instead of erroring.
func IsUniqueViolation(err error) bool {
	return SQLState(err) == "23505"
}

// IsCheckViolation reports SQLSTATE 23514 — check_violation.
func IsCheckViolation(err error) bool {
	return SQLState(err) == "23514"
}

// NullStr maps "" to nil so optional text/varchar columns store SQL NULL.
func NullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// NullUUID maps "" to nil so optional uuid columns store NULL instead of
// failing uuid parsing on insert. Non-empty values pass through verbatim.
func NullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// NullTime maps the zero Time to nil for optional timestamptz columns.
func NullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}

// NullInt maps 0 to nil for optional integer columns where 0 is "unset".
func NullInt(v int64) any {
	if v == 0 {
		return nil
	}
	return v
}

// NullStrP dereferences a *string or yields nil — for nullable text columns
// scanned into pointers.
func NullStrP(s *string) any {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}

// DerefString reads a scanned *string column into a plain string.
func DerefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// DerefTime reads a scanned *time.Time column into a plain Time.
func DerefTime(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}

// StrPtr returns a *string or nil for empty — inverse of DerefString, for
// request DTOs that keep optional fields as pointers.
func StrPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
